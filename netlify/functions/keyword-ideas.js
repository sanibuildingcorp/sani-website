// netlify/functions/keyword-ideas.js
// Live keyword search VOLUMES via Google Ads Keyword Planner (GenerateKeywordIdeas).
// Unlike Search Console (only what you already rank for), this shows real demand —
// average monthly searches + competition — including terms you don't rank for yet.
//
// POST { seed:"handyman brooklyn, bathroom remodel nyc", url?:"https://www.sanibuildingcorp.com/handyman" }
// Returns { keywords:[{ keyword, avgMonthlySearches, competition }], ... } sorted by volume.
//
// Requires Netlify env vars (from your Google Ads account):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   (you already have these from Search Console)
//   GOOGLE_ADS_REFRESH_TOKEN                 (OAuth refresh token WITH the adwords scope)
//   GOOGLE_ADS_DEVELOPER_TOKEN               (from Google Ads API Center)
//   GOOGLE_ADS_CUSTOMER_ID                   (your Ads account ID — digits only, no dashes)
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID             (manager/MCC account ID — digits only; optional)
//   GOOGLE_ADS_GEO        (optional geo target id; default US "2840", NY state "21167")
//   GADS_API_VERSION      (optional; default "v24" — bump if Google sunsets it)

const API_VERSION = process.env.GADS_API_VERSION || "v24";

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const need = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN", "GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CUSTOMER_ID"];
  const missing = need.filter(function (k) { return !process.env[k]; });
  if (missing.length) return json(400, { error: "Google Ads not configured yet. Add these Netlify env vars: " + missing.join(", ") });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return json(400, { error: "Invalid request body" }); }

  const seed = String(body.seed || "").trim();
  const url = String(body.url || "").trim();
  if (!seed && !url) return json(400, { error: "Provide a seed term or a page URL." });

  try {
    const token = await accessToken();
    const customerId = String(process.env.GOOGLE_ADS_CUSTOMER_ID).replace(/[^0-9]/g, "");
    const geo = String(process.env.GOOGLE_ADS_GEO || "2840").replace(/[^0-9]/g, "");

    // Build the seed (keywords, url, or both)
    const kws = seed ? seed.split(",").map(function (s) { return s.trim(); }).filter(Boolean) : [];
    const seedObj = {};
    if (kws.length && url) seedObj.keywordAndUrlSeed = { keywords: kws, url: url };
    else if (kws.length) seedObj.keywordSeed = { keywords: kws };
    else seedObj.urlSeed = { url: url };

    const reqBody = Object.assign({
      language: "languageConstants/1000",            // English
      geoTargetConstants: ["geoTargetConstants/" + geo],
      includeAdultKeywords: false,
      keywordPlanNetwork: "GOOGLE_SEARCH",
    }, seedObj);

    const headers = {
      "Authorization": "Bearer " + token,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      "Content-Type": "application/json",
    };
    if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
      headers["login-customer-id"] = String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(/[^0-9]/g, "");
    }

    const r = await fetch("https://googleads.googleapis.com/" + API_VERSION + "/customers/" + customerId + ":generateKeywordIdeas", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(reqBody),
    });
    const data = await r.json().catch(function () { return {}; });

    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || ("Google Ads API returned " + r.status);
      return json(r.status, { error: msg });
    }

    const keywords = (data.results || []).map(function (x) {
      const m = x.keywordIdeaMetrics || {};
      return {
        keyword: x.text,
        avgMonthlySearches: Number(m.avgMonthlySearches || 0),
        competition: m.competition || "UNKNOWN",
      };
    }).filter(function (k) { return k.keyword; })
      .sort(function (a, b) { return b.avgMonthlySearches - a.avgMonthlySearches; })
      .slice(0, 40);

    return json(200, { seed: seed || url, keywords: keywords });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

// Exchange the refresh token for a fresh access token.
async function accessToken() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const d = await r.json().catch(function () { return {}; });
  if (!r.ok || !d.access_token) {
    throw new Error("OAuth refresh failed — check GOOGLE_ADS_REFRESH_TOKEN was created with the 'adwords' scope.");
  }
  return d.access_token;
}

function json(code, obj) {
  return { statusCode: code, headers: cors(), body: JSON.stringify(obj) };
}
function cors() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
