// netlify/functions/generate-render-background.js
// Background function — Netlify returns 202 immediately, this runs up to 15 min
// Stores result in Netlify Blobs so the dashboard can poll for it (auto-configured)

const https = require("https");
const { getStore } = require("@netlify/blobs");

exports.handler = async function (event) {
  const body = JSON.parse(event.body || "{}");
  const { jobId, service, projectTitle, scopeOfWork, photoBase64, customPrompt } = body;

  if (!jobId) return;

  const store = getStore("render-jobs");

  // Mark as in-progress immediately
  await store.setJSON(jobId, { status: "processing" });

  try {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) throw new Error("OPENAI_API_KEY not set");

    // ── STEP 1: Analyze photo with GPT-4o-mini ─────────────────────────────────
    let spaceDescription = "";
    if (photoBase64 && photoBase64.startsWith("data:image") && !customPrompt) {
      try {
        const vd = JSON.parse(await openaiPost(openaiKey, "/v1/chat/completions", JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 120,
          messages: [{
            role: "user",
            content: [
              { type: "image_url", image_url: { url: photoBase64, detail: "low" } },
              { type: "text", text: "Describe this room in 1-2 sentences for a renovation render: room type, current walls/floors, key structural features. Be brief." }
            ]
          }]
        })));
        spaceDescription = vd.choices?.[0]?.message?.content || "";
        console.log("Space description:", spaceDescription);
      } catch (e) {
        console.log("Vision skipped:", e.message);
      }
    }

    // ── STEP 2: Build prompt ────────────────────────────────────────────────────
    let finalPrompt;
    if (customPrompt && customPrompt.trim()) {
      finalPrompt = customPrompt.trim() + ". Photorealistic architectural interior render, professional lighting, high quality, no people.";
    } else {
      const serviceType = (service || projectTitle || "interior space").toLowerCase();
      const spaceCtx = spaceDescription ? `The space is: ${spaceDescription.trim()}. ` : "";
      const scopeShort = scopeOfWork
        ? scopeOfWork.replace(/^[A-Z\s]+:/gm, "").replace(/[-•\n]+/g, " ").trim().slice(0, 200)
        : "";
      const scopeCtx = scopeShort ? `Renovation includes: ${scopeShort}. ` : "";
      finalPrompt = `Photorealistic interior design render of a beautifully renovated ${serviceType} in a New York City apartment. ${spaceCtx}${scopeCtx}Modern high-quality finishes, bright natural lighting, clean professional workmanship. Wide-angle architectural photography style. Ultra detailed.`;
    }

    console.log("Prompt:", finalPrompt.slice(0, 200));

    // ── STEP 3: DALL-E 3 generation ────────────────────────────────────────────
    const dalleRaw = await openaiPost(openaiKey, "/v1/images/generations", JSON.stringify({
      model: "dall-e-3",
      prompt: finalPrompt,
      n: 1,
      size: "1024x1024",
      quality: "standard",
      response_format: "b64_json"
    }));

    const dalleData = JSON.parse(dalleRaw);
    if (dalleData.error) throw new Error("DALL-E: " + (dalleData.error.message || JSON.stringify(dalleData.error)));

    const b64 = dalleData.data?.[0]?.b64_json;
    const revisedPrompt = dalleData.data?.[0]?.revised_prompt || "";
    if (!b64) throw new Error("No image data returned from DALL-E. Response: " + JSON.stringify(dalleData).slice(0, 200));

    const imageBase64 = "data:image/png;base64," + b64;

    // ── STEP 4: Save result to Blobs ───────────────────────────────────────────
    await store.setJSON(jobId, {
      status: "done",
      imageBase64,
      spaceDescription,
      revisedPrompt
    });

    console.log("Render job done:", jobId);

  } catch (err) {
    console.error("Render job failed:", jobId, err.message);
    await store.setJSON(jobId, { status: "error", error: err.message });
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
      res.on("data", c => { data += c; });
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}
