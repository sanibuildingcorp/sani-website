// netlify/functions/lib/search-console.js
//
// GOOGLE SEARCH CONSOLE, READ-ONLY, STRAIGHT FROM GOOGLE.
//
//   "How to connect you directly google search console?" -> "Go start
//   number 2": a Google box in the dashboard, no other company in between.
//
// A Google Cloud service account (its key file uploaded once in the
// dashboard, or GSC_SERVICE_ACCOUNT in Netlify) is added in Search Console
// as a Restricted user. This signs a short JWT with its key, trades it for
// a read-only token (webmasters.readonly) and asks the Search Analytics API
// for the last 28 days against the 28 before. Nothing here can change
// anything in Search Console.
//
// No network of its own: every call goes through the fetch it is handed, so
// the tests run it against a fake Google.

"use strict";

const crypto = require("crypto");

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/webmasters/v3/sites/";
const SITES = ["https://www.sanibuildingcorp.com/", "sc-domain:sanibuildingcorp.com", "https://sanibuildingcorp.com/"];
const DAY = 24 * 3600 * 1000;

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/* The key file, checked: a service account, with an email and a private key. */
function parseKey(raw) {
  let k = raw;
  if (typeof k === "string") {
    const s = k.trim();
    try { k = JSON.parse(s.charAt(0) === "{" ? s : Buffer.from(s, "base64").toString("utf8")); } catch (e) { return null; }
  }
  if (!k || typeof k !== "object") return null;
  const email = String(k.client_email || "").trim();
  const key = String(k.private_key || "").replace(/\\n/g, "\n");
  if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(email) || key.indexOf("PRIVATE KEY") === -1) return null;
  return { client_email: email, private_key: key, project_id: String(k.project_id || "") };
}

function signJwt(creds, nowMs) {
  const now = Math.floor((nowMs || Date.now()) / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: creds.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const sig = crypto.createSign("RSA-SHA256").update(head + "." + body).sign(creds.private_key);
  return head + "." + body + "." + b64url(sig);
}

async function token(fetchFn, creds, nowMs) {
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + encodeURIComponent(signJwt(creds, nowMs)),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error("Google refused the key: " + (j.error_description || j.error || ("HTTP " + res.status)));
  return j.access_token;
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

/* Search Console data is about three days behind: the window ends there. */
function windows(nowMs) {
  const end = (nowMs || Date.now()) - 3 * DAY;
  return {
    now: { startDate: day(end - 27 * DAY), endDate: day(end) },
    before: { startDate: day(end - 55 * DAY), endDate: day(end - 28 * DAY) },
  };
}

async function query(fetchFn, tok, site, body) {
  const res = await fetchFn(API + encodeURIComponent(site) + "/searchAnalytics/query", {
    method: "POST",
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error((j.error && j.error.message) || ("HTTP " + res.status)); e.status = res.status; throw e; }
  return Array.isArray(j.rows) ? j.rows : [];
}

const r1 = (n) => Math.round(n * 10) / 10;
function totals(rows) {
  const x = rows[0] || {};
  return { clicks: x.clicks || 0, impressions: x.impressions || 0, ctr: r1((x.ctr || 0) * 100), position: r1(x.position || 0) };
}

/* The whole report: totals now vs before, top searches, the searches on
   page 2 (position 8-20 - the closest to page 1) with the page Google shows
   for each, and the top pages. */
async function report(fetchFn, creds, opts) {
  const o = opts || {};
  const tok = await token(fetchFn, creds, o.now);
  const w = windows(o.now);
  const tried = [];
  let site = null, nowTot = null;
  for (const s of (o.site ? [o.site] : SITES)) {
    try { nowTot = await query(fetchFn, tok, s, Object.assign({}, w.now, { rowLimit: 1 })); site = s; break; }
    catch (e) { tried.push(s + ": " + e.message); if (e.status !== 403 && e.status !== 404) throw e; }
  }
  if (!site) { const e = new Error("The service account cannot see the site yet. Add " + creds.client_email + " in Search Console > Settings > Users and permissions."); e.code = "no-access"; e.tried = tried; throw e; }
  const beforeTot = await query(fetchFn, tok, site, Object.assign({}, w.before, { rowLimit: 1 }));
  const queries = await query(fetchFn, tok, site, Object.assign({}, w.now, { dimensions: ["query"], rowLimit: 500 }));
  const pairs = await query(fetchFn, tok, site, Object.assign({}, w.now, { dimensions: ["query", "page"], rowLimit: 2000 }));
  const pages = await query(fetchFn, tok, site, Object.assign({}, w.now, { dimensions: ["page"], rowLimit: 25 }));

  const pageOf = {};
  pairs.forEach((p) => { const q = p.keys[0]; if (!pageOf[q] || p.impressions > pageOf[q].impressions) pageOf[q] = { page: p.keys[1], impressions: p.impressions }; });
  const row = (x) => ({ query: x.keys[0], clicks: x.clicks, impressions: x.impressions, ctr: r1(x.ctr * 100), position: r1(x.position), page: (pageOf[x.keys[0]] || {}).page || "" });

  return {
    site: site,
    account: creds.client_email,
    range: w,
    now: totals(nowTot),
    before: totals(beforeTot),
    topQueries: queries.slice().sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 15).map(row),
    almostPage1: queries.filter((x) => x.position >= 8 && x.position <= 20).sort((a, b) => b.impressions - a.impressions).slice(0, 25).map(row),
    topPages: pages.slice().sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).map((x) => ({ page: x.keys[0], clicks: x.clicks, impressions: x.impressions, ctr: r1(x.ctr * 100), position: r1(x.position) })),
  };
}

module.exports = { parseKey, signJwt, token, windows, query, report, SITES, SCOPE };
