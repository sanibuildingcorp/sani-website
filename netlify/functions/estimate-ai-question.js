// netlify/functions/estimate-ai-question.js
// AI generates the next question card based on customer's answers so far.
// Returns JSON describing the question to display (label, type, options).

const https = require("https");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);
    const { service, serviceLabel, answers, questionCount, serviceCount } = body;
    const svcN = Math.max(1, Math.min(parseInt(serviceCount) || 1, 5));

    if (!service) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "Missing service" }),
      };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }),
      };
    }

    // Decide if we should keep asking or stop
    // Min 2 questions, max 5 questions per service
    const minQs = Math.min(1 + svcN, 4);            // 1 svc: 2 · 2 svc: 3 · 3+: 4
    const maxQs = Math.min(3 + 2 * svcN, 9);        // 1 svc: 5 · 2 svc: 7 · 3+: 9
    const askedCount = questionCount || 0;

    const answersStr = Object.entries(answers || {})
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");

    const prompt = `You are a contractor's intake assistant for Sani Building Corp in NYC. Your job: ask ONE smart next question to gather what's needed for an accurate construction estimate.

SERVICE SELECTED: ${serviceLabel || service}

ANSWERS SO FAR:
${answersStr || "(none yet)"}

QUESTIONS ALREADY ASKED: ${askedCount}
MINIMUM: ${minQs}, MAXIMUM: ${maxQs}
The customer selected ${svcN} service(s): ${serviceLabel}. If more than one service, make sure your questions cover EACH selected service before finishing — do not focus on only one.

Return ONLY valid JSON, no markdown, no backticks, no explanation. Use this exact structure:

If you have enough info OR have asked ${maxQs} questions, return:
{"done": true}

Otherwise return next question:
{
  "done": false,
  "questionId": "shortName",
  "label": "Short question text (max 60 chars)",
  "type": "options-stack" | "options-grid" | "text",
  "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
  "placeholder": "Only for type=text — hint text"
}

RULES:
- "options-stack" = 3-5 options, full width buttons (use for descriptive options)
- "options-grid" = 2-4 short options, 2-column grid (use for short choices)
- "text" = free-text input (use only when truly necessary, like "approximate area" or "describe other")
- Options array empty/omitted if type=text
- NO "replace fixtures" question for bathroom
- NO "tools" question for handyman
- TV Wall is about DECORATIVE feature walls (wood panels, stone, shelves) NOT mounting/cables
- For Stair service: include noise fix as a sub-option, not separate service
- Ask about scope, size, materials, condition, special requirements
- Avoid asking what was already answered
- Be specific to the service — bathroom asks about tile/fixtures/scope, painting asks about rooms/prep/walls, etc.
- After ${minQs} questions, return done:true if you have enough OR keep asking if critical info missing
- ALWAYS done:true after ${maxQs} questions

Now respond with the next question or done:true.`;

    const requestData = JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });

    const responseBody = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "api.anthropic.com",
          port: 443,
          path: "/v1/messages",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(requestData),
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          timeout: 15000,
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
          res.on("error", reject);
        }
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Timeout"));
      });
      req.write(requestData);
      req.end();
    });

    const apiResponse = JSON.parse(responseBody);
    if (apiResponse.error) {
      throw new Error(apiResponse.error.message || "API error");
    }

    const rawText = (apiResponse.content || []).map((b) => b.text || "").join("");
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const question = JSON.parse(jsonMatch[0]);

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify(question),
    };
  } catch (err) {
    console.error("AI question error:", err.message);
    // Fallback: skip AI questions, continue to next step
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ done: true, fallback: true, error: err.message }),
    };
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
