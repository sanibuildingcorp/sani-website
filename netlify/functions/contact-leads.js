// netlify/functions/contact-leads.js
// Returns recent contact-form submissions (Netlify Forms) so the dashboard
// can show website leads next to estimates. Read-only.

const https = require("https");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  const siteId = process.env.MY_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN || process.env.MY_BLOBS_TOKEN;
  if (!siteId || !token) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "Missing MY_SITE_ID / token env vars" }) };
  }

  try {
    const forms = await apiGet("/api/v1/sites/" + siteId + "/forms", token);
    let leads = [];
    for (const form of forms || []) {
      const subs = await apiGet("/api/v1/forms/" + form.id + "/submissions?per_page=100", token);
      (subs || []).forEach(function (s) {
        const d = s.data || {};
        leads.push({
          id: s.id,
          form: form.name || "",
          name: s.name || d.name || "",
          email: s.email || d.email || "",
          phone: d.phone || "",
          service: d.service || "",
          borough: d.borough || d.area || "",
          address: d.address || "",
          message: d.message || d.description || s.body || "",
          createdAt: s.created_at,
        });
      });
    }
    leads.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    leads = leads.slice(0, 100);

    return { statusCode: 200, headers: cors(), body: JSON.stringify({ leads: leads }) };
  } catch (err) {
    console.error("contact-leads error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

function apiGet(path, token) {
  return new Promise(function (resolve, reject) {
    const req = https.request(
      { hostname: "api.netlify.com", path: path, method: "GET", headers: { Authorization: "Bearer " + token } },
      function (res) {
        let body = "";
        res.on("data", function (c) { body += c; });
        res.on("end", function () {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(body)); } catch (e) { reject(new Error("Bad JSON from Netlify API")); }
          } else {
            reject(new Error("Netlify API " + res.statusCode + (res.statusCode === 401 ? " — token lacks Forms access; add a NETLIFY_AUTH_TOKEN env var (Personal Access Token)" : "")));
          }
        });
      }
    );
    req.on("error", reject);
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
