// netlify/functions/get-bid-analysis.js
// Polls a bid analysis job. GET ?id=<jobId>
// Returns { status: "processing"|"done"|"error", result?, error? }

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };

  try {
    const id = (event.queryStringParameters || {}).id;
    if (!id) return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing id" }) };

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SECRET_KEY;
    if (!SUPABASE_URL || !KEY) throw new Error("Supabase env vars not set");

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/bid_jobs?id=eq.${encodeURIComponent(id)}&select=id,status,result,error,file_name,created_at`,
      { headers: { "apikey": KEY, "Authorization": `Bearer ${KEY}` } }
    );
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);

    const rows = await res.json();
    if (!rows.length) {
      // Job row may not exist yet in the first seconds after trigger — report as processing
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ status: "processing" }) };
    }
    const row = rows[0];
    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({ status: row.status, result: row.result || null, error: row.error || null, file_name: row.file_name })
    };
  } catch (err) {
    console.error("get-bid-analysis error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json"
  };
}
