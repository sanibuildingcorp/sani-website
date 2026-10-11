// netlify/functions/customer-upload-url.js
//
// POST { ref, fileName, contentType, size } -> { signedUrl, publicUrl }
//
//   "I have couple like this customers who said they uploaded file but i can't
//    see any file"
//
// The forms sent every file through upload-photo as base64 inside a JSON body.
// A Netlify function takes about 6 MB of body, and base64 adds a third, so any
// file over ~4.5 MB was refused - and the forms skipped it without a word and
// still said "sent". Since June the biggest customer file in storage is 4.49 MB,
// while the forms allow 15 MB: every drawing bigger than that was lost.
//
// Now a big file goes STRAIGHT to storage: this hands out a one-time signed
// upload link for the estimate-photos bucket (the same bucket and folder
// upload-photo writes to), the browser PUTs the file there, and only the link
// travels on. Public on purpose, like upload-photo: the customer is the one
// uploading. It only ever issues a link for an allowed file type, under 15 MB,
// in the job's own folder.

"use strict";

const BUCKET = "estimate-photos";
const MAX_BYTES = 15 * 1024 * 1024;
/* The same file types upload-photo takes. */
const DOC_EXT = {
  "application/pdf": "pdf",
  "application/acad": "dwg",
  "image/vnd.dwg": "dwg",
  "application/dxf": "dxf",
  "image/vnd.dxf": "dxf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  /* commercial bid form: the unit matrix usually comes as a spreadsheet */
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
};

function extFor(type) {
  const t = String(type || "").toLowerCase();
  if (/^image\/[a-z0-9.+-]+$/.test(t)) return (t.split("/")[1] || "jpg").replace("jpeg", "jpg").replace("svg+xml", "svg");
  return DOC_EXT[t] || null;
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
  try {
    const b = JSON.parse(event.body || "{}");
    const type = String(b.contentType || "").toLowerCase();
    const ext = extFor(type);
    if (!ext) return json(400, { error: "Only photos, PDF, Word, Excel and drawing files" });
    const size = Number(b.size) || 0;
    if (size > MAX_BYTES) return json(400, { error: "File too large (max 15 MB)" });
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SECRET_KEY;
    if (!SUPABASE_URL || !KEY) return json(500, { error: "Supabase env vars not set" });
    const safeRef = String(b.ref || "misc").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "misc";
    const path = safeRef + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
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
    console.error("customer-upload-url error:", err.message);
    return json(500, { error: err.message });
  }
};

function json(status, obj) { return { statusCode: status, headers: cors(), body: JSON.stringify(obj) }; }
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}
