// netlify/functions/generate-render.js
// Generates a photorealistic AI renovation render using DALL-E 3
// Step 1: GPT-4o analyzes customer photo to understand the space
// Step 2: DALL-E 3 generates a photorealistic "after" render

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

    // ── STEP 1: Analyze the customer photo with GPT-4o vision ──────────────────
    let spaceDescription = "";
    let existingFeatures = "";
    if (photoBase64 && photoBase64.startsWith("data:image")) {
      try {
        const visionRes = await openaiRequest(openaiKey, "POST", "/v1/chat/completions", {
          model: "gpt-4o-mini",
          max_tokens: 200,
          messages: [{
            role: "user",
            content: [
              { type: "image_url", image_url: { url: photoBase64, detail: "low" } },
              {
                type: "text",
                text: "You are helping create a renovation render. Analyze this room photo and describe: 1) The room type and approximate dimensions 2) Current wall, floor and ceiling materials/colors 3) Key structural features (windows, doorways, alcoves). Be concise, 3 sentences max. Focus on what's architecturally fixed vs what can be renovated."
              }
            ]
          }]
        });
        const visionData = JSON.parse(visionRes);
        spaceDescription = visionData.choices?.[0]?.message?.content || "";
        existingFeatures = spaceDescription ? `\nExisting space: ${spaceDescription}` : "";
      } catch (e) {
        console.log("Vision analysis skipped:", e.message);
      }
    }

    // ── STEP 2: Build a detailed render prompt ─────────────────────────────────
    const serviceType = service || "room";
    const scopeText = scopeOfWork
      ? scopeOfWork.replace(/^(CATEGORY:|[A-Z\s]+:)/gm, "").replace(/\n[-•]\s*/g, ", ").replace(/\n+/g, " ").trim().slice(0, 300)
      : projectTitle || "full renovation";

    // Extract any service-specific answers for better prompting
    const answersText = serviceAnswers
      ? Object.entries(serviceAnswers)
          .filter(([, v]) => v && String(v).trim())
          .map(([, v]) => v)
          .join(", ")
          .slice(0, 150)
      : "";

    const styleHints = answersText ? ` ${answersText}.` : "";

    const renderPrompt = `Photorealistic high-end interior design "after renovation" render for a New York City ${serviceType} renovation.${existingFeatures}

The completed renovation features: ${scopeText}.${styleHints}

Style: Professional architectural visualization. Modern luxury finishes. Warm, natural lighting from windows. Immaculate workmanship. Clean lines. High-end materials. Shot with a wide-angle architectural lens showing the full space.

Technical: 8K photorealistic render, physically-based rendering, ultra-detailed surfaces, professional staging, no people. The kind of photo you would see in Architectural Digest. Bright and inviting.`;

    // ── STEP 3: Generate the render with DALL-E 3 ──────────────────────────────
    const dalleRes = await openaiRequest(openaiKey, "POST", "/v1/images/generations", {
      model: "dall-e-3",
      prompt: renderPrompt,
      n: 1,
      size: "1792x1024",
      quality: "hd",
      style: "natural",
      response_format: "url"
    });

    const dalleData = JSON.parse(dalleRes);
    const imageUrl = dalleData.data?.[0]?.url;
    const revisedPrompt = dalleData.data?.[0]?.revised_prompt || renderPrompt;

    if (!imageUrl) {
      throw new Error("No image returned from DALL-E");
    }

    // ── STEP 4: Download and convert to base64 (so it can be saved) ────────────
    const imageBase64 = await downloadImageAsBase64(imageUrl);

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({
        success: true,
        imageBase64,         // data:image/png;base64,... — ready to embed
        imageUrl,            // temporary OpenAI URL
        spaceDescription,   // what GPT-4o saw in the photo
        revisedPrompt        // what DALL-E actually used
      })
    };

  } catch (err) {
    console.error("generate-render error:", err.message);
    return {
      statusCode: 500,
      headers: cors(),
      body: JSON.stringify({ error: err.message || "Render generation failed" })
    };
  }
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function openaiRequest(apiKey, method, path, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const options = {
      hostname: "api.openai.com",
      port: 443,
      path,
      method,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData)
      }
    };
    const req = https.request(options, res => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

function downloadImageAsBase64(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : require("http");
    proto.get(url, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        const b64 = "data:image/png;base64," + buffer.toString("base64");
        resolve(b64);
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
