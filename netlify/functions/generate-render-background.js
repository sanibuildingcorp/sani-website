// netlify/functions/generate-render-background.js
// Background function — generates a renovation render with Google Gemini ("Nano Banana").
// Edits the customer's actual photo so the real room is preserved.
// Saves the result to Supabase (render_jobs table) for the dashboard to poll.

const https = require("https");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.5-flash-image";

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
  const { jobId, service, projectTitle, scopeOfWork, photoBase64, customPrompt } = body;

  if (!jobId) return;
  console.log("Render job invoked:", jobId);

  try {
    await saveJob(jobId, { status: "processing" });
    if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY not set");

    // Build the renovation instruction
    const serviceType = service || projectTitle || "interior space";
    const scopeShort = scopeOfWork
      ? scopeOfWork.replace(/^[A-Z\s]+:/gm, "").replace(/[-\u2022\n]+/g, " ").trim().slice(0, 300)
      : "";
    let instruction;
    if (customPrompt && customPrompt.trim()) {
      instruction = customPrompt.trim();
    } else {
      instruction = "Renovate this " + serviceType + " with modern, high-quality finishes."
        + (scopeShort ? " Work includes: " + scopeShort + "." : "");
    }

    const hasPhoto = photoBase64 && photoBase64.indexOf("base64,") !== -1;
    let promptText;
    let parts;

    if (hasPhoto) {
      promptText = "Edit this photo to show the finished renovation. " + instruction
        + " Keep the same room layout, dimensions, window and door positions, and camera viewpoint. "
        + "Photorealistic, professional lighting, clean finished workmanship, no people, no text or watermarks.";
      const idx = photoBase64.indexOf("base64,");
      const meta = photoBase64.slice(5, idx);            // e.g. "image/jpeg;"
      const mime = (meta.split(";")[0]) || "image/jpeg";
      const b64 = photoBase64.slice(idx + 7);
      parts = [
        { text: promptText },
        { inlineData: { mimeType: mime, data: b64 } }
      ];
    } else {
      promptText = "Generate a photorealistic interior render of a beautifully renovated "
        + serviceType + " in a New York City apartment. " + instruction
        + " Bright natural lighting, modern high-quality finishes, wide-angle architectural photo, no people, no text.";
      parts = [ { text: promptText } ];
    }

    console.log("Gemini prompt:", promptText.slice(0, 180), "| photo:", hasPhoto);

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
      space_description: "",
      revised_prompt: promptText.slice(0, 500)
    });

    console.log("Render job done:", jobId);

  } catch (err) {
    console.error("Render job failed:", jobId, err.message);
    try {
      await saveJob(jobId, { status: "error", error: err.message });
    } catch (e) {
      console.error("Could not save error status:", e.message);
    }
  }
};

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
