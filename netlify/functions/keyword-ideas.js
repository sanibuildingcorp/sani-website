// netlify/functions/keyword-ideas.js
// Live keyword search VOLUMES via Google Ads Keyword Planner (GenerateKeywordIdeas).
// Unlike Search Console (only what you already rank for), this shows real demand —
// average monthly searches + competition — including terms you don't rank for yet.
//
// SEMrush-style auto-broadening: from ONE seed it automatically (1) strips city words
// to find the broader root topic, (2) expands to many related alternatives, and
// (3) merges page-related ideas when a URL is given — then dedupes and sorts by volume.
// So "bathroom wall panels nyc" also pulls "bathroom wall panels", "shower wall panels",
// "waterproof wall panels", etc., instead of just the one exact phrase.
//
// POST { seed:"handyman brooklyn, bathroom remodel nyc", url?:"https://www.sanibuildingcorp.com/handyman" }
// Returns { seed, expandedFrom:[...], keywords:[{ keyword, avgMonthlySearches, competition }] } sorted by volume.
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
const MAX_SEEDS = 20;    // Google's hard limit for keywordSeed.keywords
const MAX_RESULTS = 60;  // how many ideas we return (raised from 40 for more alternatives)

// City / area words we strip to reveal the broader "root" topic. The root is searched
// ALONGSIDE what you typed, so you keep the local phrase AND gain the wider idea cluster.
const GEO_WORDS = [
  "new york city", "new york", "staten island", "long island",
  "nassau county", "suffolk county", "nassau", "suffolk",
  "brooklyn", "manhattan", "queens", "bronx",
  "nyc", "ny", "near me", "county"
];

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

    const headers = {
      "Authorization": "Bearer " + token,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      "Content-Type": "application/json",
    };
    if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
      headers["login-customer-id"] = String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(/[^0-9]/g, "");
    }

    // ── Build an expanded seed list: what you typed + the city-stripped root of each ──
    const typed = seed ? seed.split(/[,\n]+/).map(function (s) { return s.trim(); }).filter(Boolean) : [];
    const roots = typed.map(stripGeo).filter(Boolean);
    const seeds = uniqLower(typed.concat(roots)).slice(0, MAX_SEEDS);

    const map = {}; // dedupe store, keyed by lowercased keyword

    // ── Pass 1 — keyword expansion (broadest). No URL here, so it isn't narrowed. ──
    if (seeds.length) {
      const r1 = await ideas(headers, customerId, geo, { keywordSeed: { keywords: seeds } });
      if (r1.error) return json(r1.status, { error: r1.error });
      collect(map, r1.results);
    }

    // ── Pass 2 — page-related ideas. A URL only ADDS ideas (union + dedupe), never cuts. ──
    if (url && Object.keys(map).length < MAX_RESULTS) {
      const seedObj = seeds.length
        ? { keywordAndUrlSeed: { keywords: seeds, url: url } }
        : { urlSeed: { url: url } };
      const r2 = await ideas(headers, customerId, geo, seedObj);
      if (r2.error) {
        // If the URL was the ONLY input and it failed, surface the error; otherwise keep pass-1 results.
        if (!seeds.length) return json(r2.status, { error: r2.error });
      } else {
        collect(map, r2.results);
      }
    }

    const keywords = Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.avgMonthlySearches - a.avgMonthlySearches; })
      .slice(0, MAX_RESULTS);

    return json(200, { seed: seed || url, expandedFrom: seeds, keywords: keywords });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

// Strip city/area words to get the broader root topic (e.g. "bathroom wall panels nyc"
// → "bathroom wall panels"). Returns "" if nothing meaningful is left.
function stripGeo(s) {
  var out = " " + String(s).toLowerCase() + " ";
  GEO_WORDS.forEach(function (w) {
    var safe = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp("\\b" + safe + "\\b", "g"), " ");
  });
  return out.replace(/\s+/g, " ").trim();
}

// De-duplicate a list of strings case-insensitively, preserving first-seen order.
function uniqLower(arr) {
  var seen = {}, out = [];
  arr.forEach(function (s) {
    var k = String(s).toLowerCase();
    if (s && !seen[k]) { seen[k] = 1; out.push(s); }
  });
  return out;
}

// Merge API results into the dedupe map, keeping the highest volume seen per keyword.
function collect(map, results) {
  (results || []).forEach(function (x) {
    if (!x || !x.text) return;
    var key = String(x.text).toLowerCase();
    var m = x.keywordIdeaMetrics || {};
    var vol = Number(m.avgMonthlySearches || 0);
    if (!map[key] || vol > map[key].avgMonthlySearches) {
      map[key] = { keyword: x.text, avgMonthlySearches: vol, competition: m.competition || "UNKNOWN" };
    }
  });
}

// One GenerateKeywordIdeas call. Returns { results } on success or { error, status } on failure.
async function ideas(headers, customerId, geo, seedObj) {
  const reqBody = Object.assign({
    language: "languageConstants/1000",            // English
    geoTargetConstants: ["geoTargetConstants/" + geo],
    includeAdultKeywords: false,
    keywordPlanNetwork: "GOOGLE_SEARCH",
  }, seedObj);

  const r = await fetch("https://googleads.googleapis.com/" + API_VERSION + "/customers/" + customerId + ":generateKeywordIdeas", {
    method: "POST",
    headers: headers,
    body: JSON.stringify(reqBody),
  });
  const data = await r.json().catch(function () { return {}; });

  if (!r.ok) {
    const msg = (data && data.error && data.error.message) || ("Google Ads API returned " + r.status);
    return { error: msg, status: r.status };
  }
  return { results: data.results || [] };
}

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
