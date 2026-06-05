// netlify/functions/find-finishes.js
// Reads the AI render image (vision) + scope → returns finishing-material GROUPS.
// Each group = one visible finish (tile, vanity, fixtures…), with the material
// shown in the render marked as Default + 2-3 similar options & prices.
// Output maps 1:1 to the dashboard's Finishing Options (finishGroups).

const https = require("https");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  try {
    const { image, scopeOfWork, serviceLabel, projectTitle } = JSON.parse(event.body || "{}");
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!openaiKey) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "OPENAI_API_KEY not set" }) };
    }
    if (!image || typeof image !== "string") {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "No render image provided. Generate an AI render first." }) };
    }

    // Accept full data URL or raw base64
    const imageUrl = image.indexOf("data:") === 0 ? image : ("data:image/jpeg;base64," + image);

    const prompt = `You are a NYC renovation contractor's finishing-materials assistant.
You are looking at an AI-generated render of a FINISHED renovation.

Identify ONLY the visible FINISHING materials — things the customer chooses by look:
wall tile, floor tile, countertop, backsplash, vanity, cabinets, faucet/fixtures, paint color, lighting fixtures, shower glass/hardware. Ignore structural, hidden, or labor items.

PROJECT: ${projectTitle || serviceLabel || "Renovation"}
${serviceLabel ? "SERVICE: " + serviceLabel : ""}
${scopeOfWork ? "SCOPE:\n" + String(scopeOfWork).slice(0, 700) : ""}

For EACH distinct finishing material you can actually see, return one group. In each group:
- The material shown in the render is the FIRST option, with "isDefault": true.
- Add 2-3 similar real-world alternatives the customer could pick instead (different color, style, or grade) — realistic products.
- Give each option a realistic estimated TOTAL material cost in USD for THIS project (NYC retail prices; if the area is unknown, estimate sensibly so the price difference between options is meaningful).

Return ONLY a valid JSON array, no markdown, no other text. Each element:
{
  "name": "<finish/group name, e.g. Floor Tile>",
  "options": [
    { "name": "<product or style name>", "spec": "<size/type/finish — 1 short line>", "price": <number>, "isDefault": true },
    { "name": "...", "spec": "...", "price": <number>, "isDefault": false }
  ]
}
Rules: 2-5 groups max. Exactly ONE option per group has "isDefault": true (the one shown in the render). Prices are plain numbers (no $).`;

    const raw = await openaiPost(openaiKey, JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 2000,
      temperature: 0.4,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageUrl, detail: "low" } }
        ]
      }]
    }));

    const data = JSON.parse(raw);
    if (data.error) {
      console.error("OpenAI error:", data.error.message);
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: data.error.message || "OpenAI error" }) };
    }

    let content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "[]";
    content = content.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

    let groups;
    try {
      groups = JSON.parse(content);
      if (!Array.isArray(groups)) throw new Error("Not an array");
    } catch (e) {
      console.error("Parse failed:", content.slice(0, 300));
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "Failed to parse finishes" }) };
    }

    // Normalize: ensure shape + exactly one default per group
    groups = groups
      .filter(function (g) { return g && g.name && Array.isArray(g.options) && g.options.length; })
      .map(function (g) {
        var opts = g.options.map(function (o) {
          return {
            name: String(o.name || "").trim(),
            spec: String(o.spec || "").trim(),
            price: Math.round((parseFloat(o.price) || 0) * 100) / 100,
            isDefault: !!o.isDefault
          };
        });
        if (!opts.some(function (o) { return o.isDefault; })) opts[0].isDefault = true;
        else {
          var seen = false;
          opts.forEach(function (o) { if (o.isDefault && !seen) { seen = true; } else { o.isDefault = false; } });
        }
        return { name: String(g.name).trim(), options: opts };
      });

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({ success: true, groups: groups })
    };

  } catch (err) {
    console.error("find-finishes error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

function openaiPost(apiKey, bodyStr) {
  return new Promise(function (resolve, reject) {
    const opts = {
      hostname: "api.openai.com",
      port: 443,
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyStr)
      }
    };
    const req = https.request(opts, function (res) {
      let d = "";
      res.on("data", function (c) { d += c; });
      res.on("end", function () { resolve(d); });
    });
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

function cors() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}
