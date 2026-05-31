// netlify/functions/generate-render.js
// Generates a photorealistic AI renovation render using DALL-E 3

const https = require("https");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  try {
    const { service, projectTitle, scopeOfWork, photoBase64, serviceAnswers } = JSON.parse(event.body);
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "OPENAI_API_KEY not set" }) };
    }

    // ── STEP 1: Analyze the customer photo with GPT-4o-mini vision ─────────────
    let spaceDescription = "";
    if (photoBase64 && photoBase64.startsWith("data:image")) {
      try {
        const visionBody = JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 150,
          messages: [{
            role: "user",
            content: [
              { type: "image_url", image_url: { url: photoBase64, detail: "low" } },
              { type: "text", text: "Describe this room briefly for a renovation render: room type, approximate size, current wall/floor materials, key structural features (windows, doors). 2 sentences max." }
            ]
          }]
        });
        const visionRaw = await openaiPost(openaiKey, "/v1/chat/completions", visionBody);
        const visionData = JSON.parse(visionRaw);
        spaceDescription = visionData.choices?.[0]?.message?.content || "";
      } catch (e) {
        console.log("Vision step skipped:", e.message);
      }
    }

    // ── STEP 2: Build a clean, DALL-E-safe render prompt ─────────────────────
    const serviceType = (service || projectTitle || "interior space").toLowerCase();

    // Strip scope to key items, keep it short
    let scopeShort = "";
    if (scopeOfWork) {
      scopeShort = scopeOfWork
        .replace(/^[A-Z\s]+:/gm, "")
        .replace(/[-•]\s*/g, "")
        .replace(/\n+/g, " ")
        .trim()
        .slice(0, 200);
    }

    const spaceCtx = spaceDescription ? `The space is: ${spaceDescription.trim()}. ` : "";
    const scopeCtx = scopeShort ? `Renovation includes: ${scopeShort}. ` : "";

    const prompt = `Photorealistic interior design render of a beautifully renovated ${serviceType} in a New York City apartment. ${spaceCtx}${scopeCtx}Show the completed renovation with modern high-quality finishes, bright natural lighting, clean professional workmanship. Wide-angle architectural photography style. Ultra detailed, 8K quality. Shot for a luxury real estate listing.`;

    console.log("DALL-E prompt:", prompt.slice(0, 200));

    // ── STEP 3: Call DALL-E 3 ─────────────────────────────────────────────────
    const dalleBody = JSON.stringify({
      model: "dall-e-3",
      prompt: prompt,
      n: 1,
      size: "1792x1024",
      quality: "hd",

      response_format: "url"
    });

    const dalleRaw = await openaiPost(openaiKey, "/v1/images/generations", dalleBody);
    const dalleData = JSON.parse(dalleRaw);

    // Log full response for debugging
    console.log("DALL-E response keys:", Object.keys(dalleData));
    if (dalleData.error) {
      console.error("DALL-E error:", JSON.stringify(dalleData.error));
      return {
        statusCode: 500,
        headers: cors(),
        body: JSON.stringify({ error: "DALL-E error: " + (dalleData.error.message || JSON.stringify(dalleData.error)) })
      };
    }

    const imageUrl = dalleData.data?.[0]?.url;
    const revisedPrompt = dalleData.data?.[0]?.revised_prompt || "";

    if (!imageUrl) {
      console.error("No URL in response:", JSON.stringify(dalleData).slice(0, 500));
      return {
        statusCode: 500,
        headers: cors(),
        body: JSON.stringify({ error: "No image URL returned. Response: " + JSON.stringify(dalleData).slice(0, 200) })
      };
    }

    // ── STEP 4: Download image → base64 (so it can be saved with the estimate) ─
    const imageBase64 = await downloadAsBase64(imageUrl);

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({
        success: true,
        imageBase64,
        imageUrl,
        spaceDescription,
        revisedPrompt
      })
    };

  } catch (err) {
    console.error("generate-render error:", err.message, err.stack);
    return {
      statusCode: 500,
      headers: cors(),
      body: JSON.stringify({ error: err.message || "Render generation failed" })
    };
  }
};

// ── HTTP helpers ───────────────────────────────────────────────────────────────

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

function downloadAsBase64(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        resolve("data:image/png;base64," + buf.toString("base64"));
      });
      res.on("error", reject);
    }).on("error", reject);
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
