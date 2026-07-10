// netlify/functions/upload-bid-file.js
// Creates a SIGNED upload URL for Supabase Storage (bucket: bid-documents)
// so the browser can upload large bid PDFs / drawings DIRECTLY to Supabase,
// bypassing Netlify's 6MB request limit entirely.
// Returns: { signedUrl, publicUrl, path }

const BUCKET = "bid-documents";

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };

  try {
    const { fileName } = JSON.parse(event.body || "{}");
    if (!fileName) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing fileName" }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SECRET_KEY;
    if (!SUPABASE_URL || !KEY) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "Supabase env vars not set" }) };
    }

    // Safe unique path: bids/1720540000000-abc123-sow.pdf
    const safeName = String(fileName).toLowerCase().replace(/[^a-z0-9._-]/g, "-").slice(0, 80);
    const path = `bids/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
      method: "POST",
      headers: {
        "apikey": KEY,
        "Authorization": `Bearer ${KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Signed URL failed ${res.status}: ${t}`);
    }

    const data = await res.json();
    // data.url is relative like "/object/upload/sign/bid-documents/bids/...?token=..."
    const signedUrl = `${SUPABASE_URL}/storage/v1${data.url}`;
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({ success: true, signedUrl, publicUrl, path })
    };
  } catch (err) {
    console.error("upload-bid-file error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };
}
