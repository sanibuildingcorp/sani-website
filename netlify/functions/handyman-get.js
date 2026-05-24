// netlify/functions/handyman-get.js
// Loads handyman bookings from Supabase for dashboard view
//
// Usage:
//   GET /.netlify/functions/handyman-get  → returns all bookings
//   GET /.netlify/functions/handyman-get?ref=SBC-H-260524-7K9X  → returns one booking

const https = require("https");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "Supabase env vars not set" }) };
    }

    const params = event.queryStringParameters || {};
    const ref = params.ref;
    const status = params.status;
    const limit = Math.min(parseInt(params.limit || "100", 10) || 100, 500);

    let path;
    if (ref) {
      // Get single booking
      path = `/rest/v1/bookings?ref=eq.${encodeURIComponent(ref)}`;
    } else {
      // Get list, ordered by newest first
      path = `/rest/v1/bookings?order=submitted_at.desc&limit=${limit}`;
      if (status) path += `&status=eq.${encodeURIComponent(status)}`;
    }

    const data = await supabaseRequest(supabaseUrl, supabaseKey, "GET", path, null);

    if (ref) {
      // Return single record (or 404)
      if (!Array.isArray(data) || data.length === 0) {
        return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "Not found" }) };
      }
      return { statusCode: 200, headers: cors(), body: JSON.stringify(data[0]) };
    }

    // Return list
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ bookings: data || [] }) };
  } catch (err) {
    console.error("handyman-get error:", err.message);
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
      "Content-Type": "application/json"
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
    req.setTimeout(30000, function() { req.destroy(new Error("Supabase timeout")); });
    if (data) req.write(data);
    req.end();
  });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };
}
