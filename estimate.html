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

    const prompt = `You are a professional construction cost estimator for Sani Building Corp in NYC. Generate a cost estimate in JSON format. Return ONLY valid JSON with no markdown, no explanation, no backticks. Use exactly this structure: {"projectTitle":"string","laborItems":[{"name":"string","qty":1,"unit":"HRS","rate":1.00,"total":1.00}],"materialItems":[{"name":"string","qty":1,"unit":"PC","rate":1.00,"total":1.00}],"subtotal":1.00,"markup":1.00,"markupPct":25,"tax":0.00,"taxPct":0,"grandTotal":1.00,"notes":"string"}

Project details:
- Description: ${desc}
- Type: ${type || "General construction"}
- Size: ${size || "Not specified"}
- Location: ${location || "Brooklyn NY"}
- Include: ${include || "Both material and labor"}
- Notes: ${notes || "None"}

Use realistic NYC market prices. Apply exactly 25% markup on subtotal. grandTotal = subtotal + markup + tax.`;

    const requestData = JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const apiKey = process.env.ANTHROPIC_API_KEY;

    const responseBody = await new Promise((resolve, reject) => {
      const req = https.request({
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
      }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.write(requestData);
      req.end();
    });

    console.log("API response length:", responseBody.length);
    console.log("API response start:", responseBody.substring(0, 300));

    const apiResponse = JSON.parse(responseBody);

    if (apiResponse.error) {
      throw new Error(apiResponse.error.message || "API error");
    }

    const rawText = (apiResponse.content || []).map(b => b.text || "").join("");
    console.log("Raw text:", rawText.substring(0, 300));

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");

    const estimate = JSON.parse(jsonMatch[0]);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(estimate),
    };
  } catch (err) {
    console.error("Handler error:", err.message);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
