const https = require("https");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);
    const { desc, type, size, location, timeline, include, notes } = body;

    const prompt = `You are a professional construction cost estimator for Sani Building Corp in NYC.

Generate a detailed cost estimate in JSON format for:
- Description: ${desc}
- Type: ${type || "General construction"}
- Size/Area: ${size || "Not specified"}
- Location: ${location || "Brooklyn, NY"}
- Timeline: ${timeline || "Flexible"}
- Include: ${include || "Both material and labor"}
- Notes: ${notes || "None"}

Return ONLY valid JSON, no markdown, no explanation, exactly this structure:
{
  "projectTitle": "Short project title",
  "laborItems": [
    {"name": "Labor Carpenter", "qty": 6, "unit": "HRS", "rate": 45.00, "total": 270.00}
  ],
  "materialItems": [
    {"name": "Material name", "qty": 2, "unit": "PC", "rate": 25.00, "total": 50.00}
  ],
  "subtotal": 320.00,
  "markup": 80.00,
  "markupPct": 25,
  "tax": 0.00,
  "taxPct": 0,
  "grandTotal": 400.00,
  "notes": "Brief professional note"
}

Rules: realistic NYC prices, 25% markup, grandTotal = subtotal + markup + tax`;

    const requestData = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    });

    const result = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "api.anthropic.com",
          path: "/v1/messages",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(requestData),
            "x-api-key": process.env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => { data += chunk; });
          res.on("end", () => resolve(JSON.parse(data)));
        }
      );
      req.on("error", reject);
      req.write(requestData);
      req.end();
    });

    const raw = result.content?.map((b) => b.text || "").join("") || "";
    const clean = raw.replace(/```json|```/g, "").trim();
    const estimate = JSON.parse(clean);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(estimate),
    };
  } catch (err) {
    console.error("Error:", err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
