// netlify/functions/migrate-photos.js
// One-time (safe to re-run) repair for an estimate record.
// Reads the record SERVER-SIDE (no browser size limit), uploads every embedded
// base64 image to Supabase Storage (bucket: estimate-photos), replaces each with a
// public URL, and saves the record back. This shrinks oversized records so they
// load and save normally again.
//
// Run it by simply opening this URL in a browser:
//   https://www.sanibuildingcorp.com/.netlify/functions/migrate-photos?ref=SBC-XXXX
// (or POST { "ref": "SBC-XXXX" })

const { getStore } = require("@netlify/blobs");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };

  try {
    let ref = event.queryStringParameters && event.queryStringParameters.ref;
    if (!ref && event.body) {
      try { ref = JSON.parse(event.body).ref; } catch (e) {}
    }
    if (!ref) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing ref" }) };
    }

    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const record = await store.get(ref, { type: "json" });
    if (!record) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "Not found" }) };
    }

    const counter = { count: 0, failed: 0 };
    await walk(record, ref, counter);

    record.updatedAt = new Date().toISOString();
    record.photosMigrated = true;
    await store.setJSON(ref, record);

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({ success: true, ref, converted: counter.count, failed: counter.failed })
    };
  } catch (err) {
    console.error("migrate-photos error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

async function walk(node, ref, counter) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i];
      if (typeof v === "string" && v.startsWith("data:image")) {
        const url = await safeUpload(v, ref, counter);
        if (url) node[i] = url;
      } else if (v && typeof v === "object") {
        await walk(v, ref, counter);
      }
    }
  } else if (node && typeof node === "object") {
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === "string" && v.startsWith("data:image")) {
        const url = await safeUpload(v, ref, counter);
        if (url) node[k] = url;
      } else if (v && typeof v === "object") {
        await walk(v, ref, counter);
      }
    }
  }
}

async function safeUpload(dataUri, ref, counter) {
  try {
    const url = await uploadDataUri(dataUri, ref);
    if (url) { counter.count++; return url; }
    counter.failed++;
    return null;
  } catch (e) {
    counter.failed++;
    console.error("upload fail:", e.message);
    return null;
  }
}

const BUCKET = "estimate-photos";

async function uploadDataUri(dataUri, ref) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !KEY) throw new Error("Supabase env vars not set");

  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(dataUri);
  if (!m) return null;

  const mime = m[1];
  const ext = (mime.split("/")[1] || "jpg").replace("jpeg", "jpg").replace("svg+xml", "svg");
  const buf = Buffer.from(m[2], "base64");
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json"
  };
}
