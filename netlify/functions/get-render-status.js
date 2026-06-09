// netlify/functions/get-render-status.js
// Polling endpoint — checks Supabase render_jobs table for render job result.
// Matches generate-render-background.js which WRITES to Supabase (not Netlify Blobs).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

exports.handler = async function (event) {
  const cors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "" };
  }

  const jobId = (event.queryStringParameters || {}).jobId;
  if (!jobId) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Missing jobId" }) };
  }

  try {
    const url = SUPABASE_URL
      + "/rest/v1/render_jobs?id=eq." + encodeURIComponent(jobId)
      + "&select=status,image_base64,space_description,revised_prompt,error";

    const res = await fetch(url, {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY
      }
    });

    if (!res.ok) {
      const txt = await res.text();
      console.error("Supabase read failed:", res.status, txt.slice(0, 200));
      return { statusCode: 200, headers: cors, body: JSON.stringify({ status: "pending" }) };
    }

    const rows = await res.json();
    const row = rows && rows[0];

    // No row yet = background function hasn't written the first status. Still pending.
    if (!row) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ status: "pending" }) };
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        status: row.status || "pending",
        imageBase64: row.image_base64 || null,
        spaceDescription: row.space_description || "",
        revisedPrompt: row.revised_prompt || "",
        error: row.error || null
      })
    };

  } catch (e) {
    console.error("get-render-status error:", e.message);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ status: "pending" }) };
  }
};
