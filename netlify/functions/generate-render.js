// netlify/functions/generate-render.js
// Generates a photorealistic AI renovation render using DALL-E 3
// Uses b64_json response to avoid second download request
// Timeout: 26s (set in netlify.toml)

const https = require("https");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { service, projectTitle, scopeOfWork, photoBase64, customPrompt } = body;

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "OPENAI_API_KEY not set in Netlify environment variables" }) };
    }

    // ── STEP 1: Analyze photo with GPT-4o-mini (only if photo provided) ────────
    let spaceDescription = "";
    if (photoBase64 && photoBase64.startsWith("data:image") && !customPrompt) {
      try {
        const visionRaw = await openaiPost(openaiKey, "/v1/chat/completions", JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 120,
          messages: [{
            role: "user",
            content: [
              { type: "image_url", image_url: { url: photoBase64, detail: "low" } },
              { type: "text", text: "Describe this room in 1-2 sentences for a renovation render: room type, current walls/floors, key structural features. Be brief and factual." }
            ]
          }]
        }));
        const vd = JSON.parse(visionRaw);
        spaceDescription = vd.choices?.[0]?.message?.content || "";
        console.log("Space description:", spaceDescription);
      } catch (e) {
        console.log("Vision skipped:", e.message);
      }
    }

    // ── STEP 2: Build the final prompt ─────────────────────────────────────────
    let finalPrompt;

    if (customPrompt && customPrompt.trim()) {
      // User wrote their own prompt — just append safety suffix
      finalPrompt = customPrompt.trim() + ". Photorealistic architectural interior render, professional photography, high quality, no people.";
    } else {
      // Auto-build from project data
      const serviceType = (service || projectTitle || "interior space").toLowerCase();
      const spaceCtx = spaceDescription ? `The space is: ${spaceDescription.trim()}. ` : "";
      let scopeShort = "";
      if (scopeOfWork) {
        scopeShort = scopeOfWork
          .replace(/^[A-Z\s]+:/gm, "")
          .replace(/[-•\n]+/g, " ")
          .trim()
          .slice(0, 180);
      }
      const scopeCtx = scopeShort ? `Renovation includes: ${scopeShort}. ` : "";
      finalPrompt = `Photorealistic interior design render of a beautifully renovated ${serviceType} in a New York City apartment. ${spaceCtx}${scopeCtx}Modern high-quality finishes, bright natural lighting, clean professional workmanship. Wide-angle architectural photography. Ultra detailed.`;
    }

    console.log("Final prompt:", finalPrompt.slice(0, 150));

    // ── STEP 3: Call DALL-E 3 — standard quality + 1024x1024 for speed ─────────
    const dalleRaw = await openaiPost(openaiKey, "/v1/images/generations", JSON.stringify({
      model: "dall-e-3",
      prompt: finalPrompt,
      n: 1,
      size: "1024x1024",
      quality: "standard",
      response_format: "b64_json"
    }));

    const dalleData = JSON.parse(dalleRaw);
    console.log("DALL-E response keys:", Object.keys(dalleData));

    if (dalleData.error) {
      const errMsg = dalleData.error.message || JSON.stringify(dalleData.error);
      console.error("DALL-E API error:", errMsg);
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "DALL-E error: " + errMsg }) };
    }

    const b64 = dalleData.data?.[0]?.b64_json;
    const revisedPrompt = dalleData.data?.[0]?.revised_prompt || "";

    if (!b64) {
      console.error("No b64_json in response:", JSON.stringify(dalleData).slice(0, 400));
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "No image data returned. Response: " + JSON.stringify(dalleData).slice(0, 200) }) };
    }

    const imageBase64 = "data:image/png;base64," + b64;

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({ success: true, imageBase64, spaceDescription, revisedPrompt })
    };

  } catch (err) {
    console.error("generate-render error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message || "Render generation failed" }) };
  }
};

function openaiPost(apiKey, path, bodyStr) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.openai.com",
      port: 443,
      path,
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyStr)
      }
    };
    const req = https.request(options, res => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => resolve(data));
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
