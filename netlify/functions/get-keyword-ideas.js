// netlify/functions/get-keyword-ideas.js
// Sani Building Corp — Google Ads Keyword Planner fetcher
// Returns real keyword data (avg monthly searches, competition, top-of-page bid)
// via KeywordPlanIdeaService.GenerateKeywordIdeas, using existing Netlify env vars.
// Synchronous + fast (one API call) — NOT a background function.
//
// Uses env vars already set in Netlify:
//   GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
//   GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_LOGIN_CUSTOMER_ID,
//   GOOGLE_ADS_GEO (default 21167), VISITS_KEY (auth gate)
// Optional override: GOOGLE_ADS_API_VERSION (default "v23")
//
// Call (GET or POST):
//   ?keywords=bathroom renovation brooklyn,kitchen remodel nyc
//   ?url=https://www.sanibuildingcorp.com/bathroom-renovation
//   plus &key=<dashboard password>  (or header x-sbc-key)

const API_VERSION = process.env.GOOGLE_ADS_API_VERSION || "v23";
const LANGUAGE_ID = "1000"; // English
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const J = (statusCode, obj) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-sbc-key",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store"
  },
  body: JSON.stringify(obj)
});

const digits = (s) => String(s || "").replace(/\D/g, "");
const toUSD = (m) => (m ? Math.round((Number(m) / 1e6) * 100) / 100 : 0);

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return J(200, { ok: true });

  // ---- gather input (GET query or POST JSON body) ----
  let body = {};
  if (event.body) { try { body = JSON.parse(event.body); } catch (e) { body = {}; } }
  const q = event.queryStringParameters || {};
  const h = event.headers || {};

  // ---- auth gate (reuses VISITS_KEY, like the other tools) ----
  const need = process.env.VISITS_KEY;
  if (need) {
    const got = h["x-sbc-key"] || h["X-Sbc-Key"] || q.key || body.key || "";
    if (got !== need) return J(401, { ok: false, error: "Unauthorized — pass the dashboard key (?key= or x-sbc-key header)." });
  }

  // ---- seeds ----
  let keywords = body.keywords || q.keywords || [];
  if (typeof keywords === "string") keywords = keywords.split(",").map(s => s.trim()).filter(Boolean);
  const url = body.url || body.pageUrl || q.url || q.pageUrl || "";
  if ((!keywords || keywords.length === 0) && !url) {
    return J(400, { ok: false, error: "Provide 'keywords' (comma-separated) and/or a 'url' seed." });
  }
  keywords = (keywords || []).slice(0, 20); // API allows up to 20 seed keywords

  const geo = digits(body.geo || q.geo || process.env.GOOGLE_ADS_GEO || "21167");
  const network = (body.network || q.network || "GOOGLE_SEARCH").toUpperCase() === "GOOGLE_SEARCH_AND_PARTNERS"
    ? "GOOGLE_SEARCH_AND_PARTNERS" : "GOOGLE_SEARCH";
  const limit = Math.min(Number(body.limit || q.limit || 60) || 60, 200);

  // ---- credentials ----
  const devToken = (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
  const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
  const refreshToken = (process.env.GOOGLE_ADS_REFRESH_TOKEN || "").trim();
  const customerId = digits(process.env.GOOGLE_ADS_CUSTOMER_ID);
  const loginCustomerId = digits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);

  const missing = [];
  if (!devToken) missing.push("GOOGLE_ADS_DEVELOPER_TOKEN");
  if (!clientId) missing.push("GOOGLE_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  if (!refreshToken) missing.push("GOOGLE_ADS_REFRESH_TOKEN");
  if (!customerId) missing.push("GOOGLE_ADS_CUSTOMER_ID");
  if (missing.length) return J(200, { ok: false, error: "Missing env vars: " + missing.join(", ") });

  try {
    // ---- 1) refresh token -> access token ----
    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    });
    const tokRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString()
    });
    const tokRaw = await tokRes.text();
    let tokJson = {};
    try { tokJson = JSON.parse(tokRaw); } catch (e) { /* non-JSON */ }
    if (!tokRes.ok || !tokJson.access_token) {
      return J(200, {
        ok: false,
        step: "oauth",
        httpStatus: tokRes.status,
        error: tokJson.error || "token_error",
        error_description: tokJson.error_description || null,
        raw: tokRaw.slice(0, 300)
      });
    }
    const accessToken = tokJson.access_token;

    // ---- 2) build the seed ----
    const reqBody = {
      language: `languageConstants/${LANGUAGE_ID}`,
      geoTargetConstants: [`geoTargetConstants/${geo}`],
      includeAdultKeywords: false,
      keywordPlanNetwork: network
    };
    if (keywords.length && url) reqBody.keywordAndUrlSeed = { url, keywords };
    else if (keywords.length) reqBody.keywordSeed = { keywords };
    else reqBody.urlSeed = { url };

    // ---- 3) call generateKeywordIdeas ----
    const endpoint = `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}:generateKeywordIdeas`;
    const headers = {
      "Content-Type": "application/json",
      "developer-token": devToken,
      "Authorization": `Bearer ${accessToken}`
    };
    if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;

    const adsRes = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(reqBody) });
    const adsText = await adsRes.text();
    let adsJson = null;
    try { adsJson = JSON.parse(adsText); } catch (e) { /* keep raw */ }

    if (!adsRes.ok) {
      const msg = adsJson && adsJson.error ? (adsJson.error.message || JSON.stringify(adsJson.error)) : adsText.slice(0, 800);
      return J(200, {
        ok: false, step: "ads", apiVersion: API_VERSION, error: msg,
        hint: "If this mentions an unsupported/invalid version, set env var GOOGLE_ADS_API_VERSION to a current one (e.g. v24 or v22)."
      });
    }

    // ---- 4) shape + sort ----
    const out = (adsJson.results || []).map(r => {
      const m = r.keywordIdeaMetrics || {};
      return {
        keyword: r.text,
        avgMonthlySearches: Number(m.avgMonthlySearches || 0),
        competition: m.competition || "UNSPECIFIED",
        competitionIndex: m.competitionIndex != null ? Number(m.competitionIndex) : null,
        topOfPageBidLow: toUSD(m.lowTopOfPageBidMicros),
        topOfPageBidHigh: toUSD(m.highTopOfPageBidMicros)
      };
    });
    out.sort((a, b) => b.avgMonthlySearches - a.avgMonthlySearches);

    return J(200, {
      ok: true,
      seed: { keywords, url: url || null, geo, network, apiVersion: API_VERSION },
      count: Math.min(out.length, limit),
      total: out.length,
      keywords: out.slice(0, limit)
    });
  } catch (err) {
    return J(200, { ok: false, error: String((err && err.message) || err) });
  }
};
