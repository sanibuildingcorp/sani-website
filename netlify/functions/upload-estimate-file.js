// netlify/functions/upload-estimate-file.js
//
// POST { ref, fileName, contentType }   (header x-sbc-key)
//   -> { signedUrl, publicUrl }
//
//   "I can't re-upload plans in edit section, i can almost everything edit
//    but no photo upload or pdf."
//
// A signed upload URL for the estimate-photos bucket, so the dashboard puts a
// photo or a PDF plan set straight into storage - the file never passes
// through a function, so Netlify's 6 MB request limit does not apply (the bid
// analyzer's upload-bid-file does the same). The dashboard then saves the
// public link on the estimate through update-customer (addPhotos), where the
// estimator reads it: a PDF as drawings, an image as a photo.
//
// CONTRACTOR ONLY: behind the dashboard key.

"use strict";

const { requireDashboardKey } = require("./lib/require-dashboard-key");

const BUCKET = "estimate-photos";
const TYPES = /^(image\/(jpeg|png|gif|webp|heic|heif)|application\/pdf)$/;

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;

  try {
    const { ref, fileName, contentType } = JSON.parse(event.body || "{}");
    const type = String(contentType || "").toLowerCase();
    if (!ref || !fileName) return json(400, { error: "Missing ref or fileName" });
    if (!TYPES.test(type)) return json(400, { error: "Only photos and PDF files" });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SECRET_KEY;
    if (!SUPABASE_URL || !KEY) return json(500, { error: "Supabase env vars not set" });

    const safeRef = String(ref).replace(/[^a-zA-Z0-9_-]/g, "") || "misc";
    const safeName = String(fileName).toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 80) || "file";
    const path = safeRef + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "-" + safeName;

    const res = await fetch(SUPABASE_URL + "/storage/v1/object/upload/sign/" + BUCKET + "/" + path, {
      method: "POST",
      headers: { "apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error("Signed URL failed " + res.status + ": " + (await res.text()).slice(0, 200));
    const data = await res.json();
    return json(200, {
      success: true,
      signedUrl: SUPABASE_URL + "/storage/v1" + data.url,
      publicUrl: SUPABASE_URL + "/storage/v1/object/public/" + BUCKET + "/" + path,
    });
  } catch (err) {
    console.error("upload-estimate-file error:", err.message);
    return json(500, { error: err.message });
  }
};

function json(status, obj) {
  return { statusCode: status, headers: cors(), body: JSON.stringify(obj) };
}
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-sbc-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}
