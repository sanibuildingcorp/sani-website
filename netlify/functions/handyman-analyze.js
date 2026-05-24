// netlify/functions/handyman-analyze.js
// OpenAI Vision API analyzes customer photos + answers and returns:
//   1. Customer-friendly estimate (time, labor, materials, deposit)
//   2. Internal handyman brief (tools, materials, special orders, warnings, confidence)
//
// Usage: POST { service, answers, photoBase64Array, urgency, description }

const https = require("https");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  try {
    const startTime = Date.now();
    const body = JSON.parse(event.body || "{}");
    const { service, serviceName, answers, photoBase64Array, urgency, description } = body;

    if (!service) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing service" }) };
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "OPENAI_API_KEY not set" }) };
    }

    // Build the multimodal user message (text + images)
    const userContent = [
      {
        type: "text",
        text: buildUserPrompt(service, serviceName, answers, urgency, description, photoBase64Array)
      }
    ];

    // Add photos (up to 5 to control cost)
    const photos = Array.isArray(photoBase64Array) ? photoBase64Array.slice(0, 5) : [];
    photos.forEach(function(b64) {
      // Accepts either pure base64 or data URI
      const url = b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`;
      userContent.push({
        type: "image_url",
        image_url: { url: url, detail: "low" }  // 'low' = ~85 tokens per image (cheap)
      });
    });

    const payload = {
      model: "gpt-4o-mini",  // Cheaper, supports vision, fast
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent }
      ],
      max_tokens: 1500,
      temperature: 0.3,  // Lower = more consistent
      response_format: { type: "json_object" }  // Force JSON output
    };

    const aiResponse = await callOpenAI(openaiKey, payload);
    const duration = Date.now() - startTime;

    // Parse the AI response
    let parsed;
    try {
      const content = aiResponse.choices[0].message.content;
      parsed = JSON.parse(content);
    } catch (e) {
      console.error("Failed to parse AI response:", aiResponse);
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "AI returned invalid JSON" }) };
    }

    // Validate the response has required fields
    const validated = validateAndNormalize(parsed, service);

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({
        success: true,
        estimate: validated.customerEstimate,
        internalBrief: validated.internalBrief,
        confidence: validated.confidence,
        rawResponse: parsed,
        meta: {
          model: payload.model,
          promptTokens: aiResponse.usage ? aiResponse.usage.prompt_tokens : null,
          completionTokens: aiResponse.usage ? aiResponse.usage.completion_tokens : null,
          totalTokens: aiResponse.usage ? aiResponse.usage.total_tokens : null,
          durationMs: duration
        }
      })
    };
  } catch (err) {
    console.error("handyman-analyze error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

// ════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT - This is the secret sauce
// ════════════════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `You are an expert handyman estimator for Sani Building Corp, a Brooklyn NYC handyman company with 10+ years of experience. Your job is to analyze customer photos and answers, then generate TWO outputs in JSON:

1. CUSTOMER-FACING ESTIMATE (vague price ranges, friendly tone, professional)
2. INTERNAL HANDYMAN BRIEF (specific tools, specific materials, warnings)

You MUST return valid JSON in this exact structure:

{
  "customerEstimate": {
    "estimatedTimeMin": <hours as decimal>,
    "estimatedTimeMax": <hours as decimal>,
    "estimatedLaborMin": <dollars integer>,
    "estimatedLaborMax": <dollars integer>,
    "estimatedMaterialMin": <dollars integer>,
    "estimatedMaterialMax": <dollars integer>,
    "depositAmount": <dollars integer, 0 if no deposit needed>,
    "depositRequired": <true/false>,
    "customerNotes": "<friendly explanation including: what we'll do, any concerns, why deposit if needed>"
  },
  "internalBrief": {
    "jobSummary": "<2-3 sentence summary for the contractor>",
    "toolsChecklist": ["<tool 1>", "<tool 2>", ...],
    "materialsChecklist": ["<material 1>", "<material 2>", ...],
    "specialOrderFlag": <true/false>,
    "specialOrderItems": ["<item 1>", ...],
    "warnings": ["<warning 1>", ...]
  },
  "confidence": {
    "score": <integer 0-100>,
    "label": "<'ready' (80-100), 'maybe' (50-79), or 'inspection' (0-49)>",
    "reasoning": "<1-sentence why this confidence>"
  }
}

PRICING GUIDELINES (NYC market rates):
- General Repairs: $150-200/hr, 2hr minimum
- Painting Touch-Ups: $180-220/hr
- Furniture Assembly: $120-180/hr
- Leak & Plumbing: $200-250/hr
- Tile & Grout: $160-210/hr
- Light Fixture & Electrical: $170-230/hr
- Full Handyman Day: $750-950/day (8 hours)
- Property Manager: $150-200/hr

CONFIDENCE SCORING RULES:
- 80-100 (READY): Photos are clear, customer described issue well, standard job, you know exactly what's needed → can book immediately
- 50-79 (MAYBE): Some uncertainty about scope, materials, or extent of damage → could book but flag risks
- 0-49 (INSPECTION): Photos unclear/missing, complex issue, unknown variables → recommend inspection visit first

DEPOSIT RULES:
- $0 deposit: standard work, customer has all materials
- $50-100 deposit: if you need to buy materials before arrival
- $150-300 deposit: for plumbing fixtures, light fixtures, or special parts customer hasn't selected

WARNINGS to flag (include in warnings array):
- "Customer should select replacement fixture before visit"
- "Paint color match required - bring sample chip"
- "Time spent purchasing customer-approved materials may be billed"
- "Water damage may indicate larger plumbing issue"
- "Working at heights - may need ladder over 8ft"
- "Possible hidden damage behind affected area"
- "Electrical work requires verifying breaker location"
- Any other professional handyman concerns

BE REALISTIC: Don't underestimate. NYC jobs always take longer than expected. Factor in:
- Travel time / parking in NYC
- 2-hour minimum on most jobs
- Material runs to Home Depot if needed
- Cleanup time

TOOLS LIST - be specific to the job. Common handyman tools:
- Drill, screwdriver set, hammer, level, tape measure, utility knife, putty knife, caulk gun, ladder
- Specific tools as needed: basin wrench (plumbing), wire strippers (electrical), grout float (tile), sander (paint)

MATERIALS LIST - include consumables:
- Spackle, joint compound, sandpaper, primer, caulk, screws, anchors, etc.
- If customer needs to provide something specific, note in warnings`;

// ════════════════════════════════════════════════════════════════════
// USER PROMPT BUILDER
// ════════════════════════════════════════════════════════════════════
function buildUserPrompt(service, serviceName, answers, urgency, description, photos) {
  const photoCount = Array.isArray(photos) ? photos.length : 0;
  let prompt = `SERVICE: ${serviceName || service}\n`;
  if (urgency) prompt += `URGENCY: ${urgency}\n`;
  prompt += `PHOTOS PROVIDED: ${photoCount}\n\n`;

  if (answers && typeof answers === "object") {
    prompt += "CUSTOMER ANSWERS:\n";
    Object.keys(answers).forEach(function(key) {
      const val = Array.isArray(answers[key]) ? answers[key].join(", ") : answers[key];
      if (val) prompt += `- ${humanize(key)}: ${val}\n`;
    });
  }

  if (description && description.trim()) {
    prompt += `\nCUSTOMER DESCRIPTION:\n${description}\n`;
  }

  prompt += `\n\nAnalyze ${photoCount > 0 ? "the photos and " : ""}the customer information above. Return the JSON response with customer estimate, internal brief, and confidence score.`;

  return prompt;
}

function humanize(key) {
  return key.replace(/_/g, " ").replace(/\b\w/g, function(l) { return l.toUpperCase(); });
}

// ════════════════════════════════════════════════════════════════════
// VALIDATE & NORMALIZE OPENAI RESPONSE
// ════════════════════════════════════════════════════════════════════
function validateAndNormalize(parsed, service) {
  const ce = parsed.customerEstimate || {};
  const ib = parsed.internalBrief || {};
  const cf = parsed.confidence || {};

  // Defaults if AI missed something
  return {
    customerEstimate: {
      estimatedTimeMin: Number(ce.estimatedTimeMin) || 1,
      estimatedTimeMax: Number(ce.estimatedTimeMax) || 2,
      estimatedLaborMin: Math.round(Number(ce.estimatedLaborMin)) || 150,
      estimatedLaborMax: Math.round(Number(ce.estimatedLaborMax)) || 300,
      estimatedMaterialMin: Math.round(Number(ce.estimatedMaterialMin)) || 0,
      estimatedMaterialMax: Math.round(Number(ce.estimatedMaterialMax)) || 50,
      depositAmount: Math.round(Number(ce.depositAmount)) || 0,
      depositRequired: !!ce.depositRequired,
      customerNotes: String(ce.customerNotes || "Final price may change after on-site inspection.")
    },
    internalBrief: {
      jobSummary: String(ib.jobSummary || "Standard handyman job. See customer description."),
      toolsChecklist: Array.isArray(ib.toolsChecklist) ? ib.toolsChecklist.map(String) : [],
      materialsChecklist: Array.isArray(ib.materialsChecklist) ? ib.materialsChecklist.map(String) : [],
      specialOrderFlag: !!ib.specialOrderFlag,
      specialOrderItems: Array.isArray(ib.specialOrderItems) ? ib.specialOrderItems.map(String) : [],
      warnings: Array.isArray(ib.warnings) ? ib.warnings.map(String) : []
    },
    confidence: {
      score: Math.max(0, Math.min(100, Math.round(Number(cf.score)) || 50)),
      label: ["ready", "maybe", "inspection"].includes(cf.label) ? cf.label : "maybe",
      reasoning: String(cf.reasoning || "")
    }
  };
}

// ════════════════════════════════════════════════════════════════════
// OPENAI API CALL
// ════════════════════════════════════════════════════════════════════
function callOpenAI(apiKey, payload) {
  const data = JSON.stringify(payload);
  return new Promise(function(resolve, reject) {
    const req = https.request({
      hostname: "api.openai.com",
      port: 443,
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        "Authorization": `Bearer ${apiKey}`
      }
    }, function(res) {
      const chunks = [];
      res.on("data", function(c) { chunks.push(c); });
      res.on("end", function() {
        const body = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error("Invalid JSON from OpenAI: " + body.slice(0, 200))); }
        } else {
          reject(new Error(`OpenAI ${res.statusCode}: ${body.slice(0, 500)}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(60000, function() { req.destroy(new Error("OpenAI timeout (60s)")); });
    req.write(data);
    req.end();
  });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
