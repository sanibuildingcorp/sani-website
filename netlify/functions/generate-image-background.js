// netlify/functions/generate-image-background.js
// Background function — generates a website image with Google Gemini "Nano Banana Pro"
// (gemini-3-pro-image) from a free text prompt. Saves the result to Supabase
// (render_jobs table, same one the renovation render uses) so the Image Studio page
// can poll get-render-status for it.
//
// POST { jobId, prompt, orientation, refPhotoBase64? }
// Requires Netlify env vars: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SECRET_KEY
//
// NOTE: gemini-3-pro-image (Nano Banana Pro) is a PAID model — the Google AI / Gemini
// API key must have billing enabled. To fall back to the free model, change
// GEMINI_MODEL to "gemini-2.5-flash-image".

const https = require("https");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-3-pro-image"; // Nano Banana Pro

// Upsert a job row in Supabase (insert or update by primary key "id")
async function saveJob(id, fields) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/render_jobs", {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(Object.assign({ id: id }, fields))
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error("Supabase saveJob failed:", res.status, txt.slice(0, 200));
  }
}

exports.handler = async function (event) {
  const body = JSON.parse(event.body || "{}");
  const jobId = body.jobId;
  const prompt = body.prompt;
  const orientation = body.orientation;
  const refPhotoBase64 = body.refPhotoBase64;

  if (!jobId) return;
  console.log("Image job invoked:", jobId);

  try {
    await saveJob(jobId, { status: "processing" });
    if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY not set");
    if (!prompt || !prompt.trim()) throw new Error("Prompt is empty");

    const orient = orientationText(orientation);
    const promptText = prompt.trim() + " " + orient
      + " Photorealistic, professional architectural and interior photography, sharp focus,"
      + " bright natural lighting, realistic high-quality finishes, no people, no text,"
      + " no watermark, no logos.";

    // Pure text-to-image, OR edit a supplied reference photo if one is given.
    let parts;
    const hasRef = refPhotoBase64 && refPhotoBase64.indexOf("base64,") !== -1;
    if (hasRef) {
      const idx = refPhotoBase64.indexOf("base64,");
      const meta = refPhotoBase64.slice(5, idx);          // e.g. "image/jpeg;"
      const mime = (meta.split(";")[0]) || "image/jpeg";
      const b64 = refPhotoBase64.slice(idx + 7);
      parts = [
        { text: promptText },
        { inlineData: { mimeType: mime, data: b64 } }
      ];
    } else {
      parts = [ { text: promptText } ];
    }

    console.log("Gemini prompt:", promptText.slice(0, 180), "| ref:", !!hasRef);

    const reqBody = JSON.stringify({ contents: [ { parts: parts } ] });
    const raw = await geminiPost(GEMINI_MODEL, reqBody);
    const data = JSON.parse(raw);
    if (data.error) throw new Error("Gemini: " + (data.error.message || JSON.stringify(data.error)));

    // Find the image part (handle camelCase and snake_case responses)
    const cand = data.candidates && data.candidates[0];
    const outParts = (cand && cand.content && cand.content.parts) || [];
    let imgB64 = null, imgMime = "image/png";
    for (let i = 0; i < outParts.length; i++) {
      const inl = outParts[i].inlineData || outParts[i].inline_data;
      if (inl && inl.data) { imgB64 = inl.data; imgMime = inl.mimeType || inl.mime_type || "image/png"; break; }
    }
    if (!imgB64) throw new Error("No image returned from Gemini. Response: " + JSON.stringify(data).slice(0, 300));

    const imageBase64 = "data:" + imgMime + ";base64," + imgB64;

    await saveJob(jobId, {
      status: "done",
      image_base64: imageBase64,
      revised_prompt: promptText.slice(0, 500)
    });

    console.log("Image job done:", jobId);

  } catch (err) {
    console.error("Image job failed:", jobId, err.message);
    try {
      await saveJob(jobId, { status: "error", error: err.message });
    } catch (e) {
      console.error("Could not save error status:", e.message);
    }
  }
};

function orientationText(o) {
  switch (o) {
    case "hero":   return "Ultra-wide cinematic banner composition, 16:9 landscape, with calm negative space on the left side for a text overlay.";
    case "wide":   return "Wide 16:9 landscape composition.";
    case "square": return "Square 1:1 composition.";
    case "tall":   return "Vertical 3:4 portrait composition.";
    default:       return "Wide 16:9 landscape composition.";
  }
}

function geminiPost(model, bodyStr) {
  return new Promise(function (resolve, reject) {
    const options = {
      hostname: "generativelanguage.googleapis.com",
      port: 443,
      path: "/v1beta/models/" + model + ":generateContent",
      method: "POST",
      headers: {
        "x-goog-api-key": GEMINI_KEY,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyStr)
      }
    };
    const req = https.request(options, function (res) {
      let data = "";
      res.on("data", function (c) { data += c; });
      res.on("end", function () { resolve(data); });
    });
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}
