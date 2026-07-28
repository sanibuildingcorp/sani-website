// netlify/functions/upload-photo.js  (v2 - Jul 27 2026)
// Accepts a base64 data URI (images AND documents such as PDF drawings),
// uploads it to Supabase Storage (bucket: estimate-photos), returns a public URL.
// Keeps estimate records small - files stored as links, not embedded data.

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };

  try {
    const { base64, ref } = JSON.parse(event.body || "{}");
    if (!base64) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing base64" }) };
    }
    const url = await uploadDataUri(base64, ref || "misc");
    if (!url) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Unsupported or invalid file type" }) };
    }
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ success: true, url }) };
  } catch (err) {
    console.error("upload-photo error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

const BUCKET = "estimate-photos";

async function uploadDataUri(dataUri, ref) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !KEY) throw new Error("Supabase env vars not set");

  const m = /^data:([a-zA-Z0-9.+\/-]+);base64,([\s\S]+)$/.exec(dataUri);
  if (!m) return null;

  const mime = m[1];

  // Allowlist: any image, plus the document types a customer may send as a drawing.
  const DOC_EXT = {
    "application/pdf": "pdf",
    "application/acad": "dwg",
    "image/vnd.dwg": "dwg",
    "application/dxf": "dxf",
    "image/vnd.dxf": "dxf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx"
  };
  const isImage = /^image\//.test(mime);
  if (!isImage && !DOC_EXT[mime]) return null;

  const ext = isImage
    ? (mime.split("/")[1] || "jpg").replace("jpeg", "jpg").replace("svg+xml", "svg")
    : DOC_EXT[mime];

  const buf = Buffer.from(m[2], "base64");
  const MAX_BYTES = 15 * 1024 * 1024;
  if (buf.length > MAX_BYTES) throw new Error("File too large (max 15 MB)");
  const safeRef = String(ref).replace(/[^a-zA-Z0-9_-]/g, "") || "misc";
  const path = `${safeRef}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const putUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`;

  const res = await fetch(putUrl, {
    method: "POST",
    headers: {
      "apikey": KEY,
      "Authorization": `Bearer ${KEY}`,
      "Content-Type": mime,
      "x-upsert": "true"
    },
    body: buf
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Storage upload ${res.status}: ${t}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };
}
