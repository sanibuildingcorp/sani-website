// netlify/functions/handyman-update.js
// Updates a handyman booking from the dashboard (status, contractor_notes, etc.)
//
// Usage: POST { ref, updates: { status, contractor_notes, ... } }

const https = require("https");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { ref, updates } = body;

    if (!ref || !updates) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing ref or updates" }) };
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "Supabase env vars not set" }) };
    }

    // Whitelist allowed updates
    const ALLOWED = ["status", "contractor_notes", "preferred_date", "preferred_time", "confirmed_at", "completed_at"];
    const safeUpdates = {};
    Object.keys(updates).forEach(function(k) {
      if (ALLOWED.includes(k)) safeUpdates[k] = updates[k];
    });

    if (Object.keys(safeUpdates).length === 0) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "No allowed fields to update" }) };
    }

    // Auto-set timestamps based on status
    if (safeUpdates.status === "confirmed" && !safeUpdates.confirmed_at) {
      safeUpdates.confirmed_at = new Date().toISOString();
    }
    if (safeUpdates.status === "completed" && !safeUpdates.completed_at) {
      safeUpdates.completed_at = new Date().toISOString();
    }

    // Always update the updated_at timestamp
    safeUpdates.updated_at = new Date().toISOString();

    const result = await supabaseRequest(
      supabaseUrl,
      supabaseKey,
      "PATCH",
      `/rest/v1/bookings?ref=eq.${encodeURIComponent(ref)}`,
      safeUpdates
    );

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({ success: true, updated: result })
    };
  } catch (err) {
    console.error("handyman-update error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

function supabaseRequest(supabaseUrl, supabaseKey, method, path, body) {
  const data = body ? JSON.stringify(body) : null;
  return new Promise(function(resolve, reject) {
    const u = new URL(supabaseUrl + path);
    const headers = {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    };
    if (data) headers["Content-Length"] = Buffer.byteLength(data);

    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: method,
      headers: headers
    }, function(res) {
      const chunks = [];
      res.on("data", function(c) { chunks.push(c); });
      res.on("end", function() {
        const respBody = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(respBody ? JSON.parse(respBody) : null); }
          catch (e) { resolve(respBody); }
        } else {
          reject(new Error(`Supabase ${res.statusCode}: ${respBody.slice(0, 300)}`));
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
