// netlify/functions/generate-estimate.js
// AI scope + line-item generator.
// Reads the customer's V3 request from Blobs, asks Claude to draft scope + pricing,
// saves the draft back to Blobs, returns it to the dashboard.

const https = require("https");
const { getStore } = require("@netlify/blobs");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  try {
    const { ref } = JSON.parse(event.body);
    if (!ref) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing ref" }) };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }) };
    }

    // Load the customer's request
    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const record = await store.get(ref, { type: "json" });
    if (!record) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "Estimate not found" }) };
    }

    // Build the prompt
    const customer = record.customer || {};
    const request = record.request || {};
    const answers = request.serviceAnswers || {};
    const answersText = Object.entries(answers)
      .filter(([_, v]) => v && String(v).trim())
      .map(([k, v]) => `- ${k.replace(/-/g, " ")}: ${v}`)
      .join("\n");

    const prompt = `You are an estimator for Sani Building Corp, an NYC-metro general contractor (Manhattan, Brooklyn, Queens, Bronx, Staten Island, Long Island, Nassau). You build detailed estimates from customer requests.

CUSTOMER REQUEST:
Service: ${request.service || "General"}
Property: ${request.propertyType || "Not specified"}
Timeline: ${request.timeline || "Not specified"}
Address: ${customer.address || "Not specified"}
Description: ${request.description || "(none)"}

CUSTOMER ANSWERS TO QUESTIONS:
${answersText || "(no specific answers)"}

YOUR TASK:
Generate a realistic, professional estimate draft for this NYC-area project. Use current NYC labor and material rates. Be specific — itemize labor by trade/task and materials by what's actually needed.

PRICING GUIDELINES (NYC market 2026):
- General handyman labor: $75-95/hr
- Skilled trades (plumber/electrician/tile setter): $110-150/hr
- Painter: $55-75/hr
- Demolition: $60-80/hr per laborer
- Mid-range tile: $5-12/sqft material
- Standard paint: $50-70/gallon
- Bathroom vanity (basic): $300-800
- Toilet (mid-range): $250-450

OUTPUT: Return ONLY a JSON object (no markdown, no commentary) with this exact shape:
{
  "projectTitle": "Short project title for the customer (e.g. 'Master Bathroom Renovation - Brooklyn')",
  "summary": "2-3 sentence summary the customer will see at the top of their quote. Confident, clear, no jargon.",
  "scopeOfWork": "Full scope of work as a single string with line breaks. Cover demolition (if any), prep, main work in trade order, finishing, cleanup. Customer reads this — be clear but professional.",
  "labor": [
    {"item": "Specific labor task description", "qty": 1, "unit": "hrs", "rate": 85}
  ],
  "materials": [
    {"item": "Specific material with brief spec", "qty": 1, "unit": "ea", "rate": 50}
  ],
  "timelineText": "Estimated duration in plain words (e.g. '5-7 business days')",
  "markupPct": 25,
  "notes": "Internal notes to the contractor about assumptions made or things to verify with the customer. Customer will NOT see this."
}

IMPORTANT:
- Use realistic NYC rates. Bathroom remodels typically run $8K-25K. Don't lowball.
- 4-10 labor items, 4-12 material items is typical.
- Unit options: hrs, days, ea, sqft, lf (linear foot), gal, box
- If info is missing, make conservative reasonable assumptions and note them in "notes".
- Return ONLY the JSON. No preamble. No code fences.`;

    // Call Claude API
    const aiResponse = await callClaude(apiKey, prompt);

    // Parse JSON from response
    let parsed;
    try {
      const cleaned = aiResponse.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("Failed to parse AI response:", aiResponse.slice(0, 500));
      return {
        statusCode: 500,
        headers: cors(),
        body: JSON.stringify({ error: "AI returned invalid JSON", raw: aiResponse.slice(0, 500) }),
      };
    }

    // Save to Blobs as a draft
    record.estimate = {
      projectTitle: parsed.projectTitle || `${request.service} - ${customer.name || ""}`,
      summary: parsed.summary || "",
      scopeOfWork: parsed.scopeOfWork || "",
      labor: Array.isArray(parsed.labor) ? parsed.labor : [],
      materials: Array.isArray(parsed.materials) ? parsed.materials : [],
      timelineText: parsed.timelineText || "",
      markupPct: typeof parsed.markupPct === "number" ? parsed.markupPct : 25,
      notes: parsed.notes || "",
    };
    record.status = record.status === "new" ? "drafted" : record.status;
    record.updatedAt = new Date().toISOString();

    await store.setJSON(ref, record);

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({ success: true, estimate: record.estimate, status: record.status }),
    };
  } catch (err) {
    console.error("generate-estimate error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

function callClaude(apiKey, prompt) {
  const payload = JSON.stringify({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        port: 443,
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const json = JSON.parse(body);
              const text = (json.content || []).map((c) => c.text || "").join("");
              resolve(text);
            } catch (e) {
              reject(new Error("Bad Claude response: " + body.slice(0, 200)));
            }
          } else {
            reject(new Error(`Claude ${res.statusCode}: ${body.slice(0, 300)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
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
