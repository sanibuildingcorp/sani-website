// netlify/functions/lib/auto-draft.js
//
// A DRAFT IS WAITING WHEN HE OPENS IT.
//
//   Perplexity's list: "Auto-draft on arrival, so when you open the Dashboard
//   the draft is already waiting - you only review and send." -> "1-2",
//   "Estimate form only".
//
// estimate-request.js calls kick() right after a NEW estimate-form request is
// saved. It starts the same estimator the Generate button starts, with his
// house rules, and returns as soon as the background function has accepted it
// (a 202). Nothing reaches the customer: a record never sent shows them no
// price (get-estimate hideUnsentEstimate), and he still reviews and sends.
//
// The contact form and emails never get one: a contact message can be three
// words. Set AUTO_DRAFT=off in Netlify to stop it without a deploy.

"use strict";

const https = require("https");
const { getStore } = require("@netlify/blobs");

const KICK_MS = 8000;
const RULES_MS = 3000;

function str(v) { return String(v == null ? "" : v).trim(); }

/* Enough to price: a description of some length, or answers, or photos. */
function worthDrafting(record) {
  const req = (record && record.request) || {};
  const words = str(req.description).split(/\s+/).filter(Boolean).length;
  const answers = Object.keys(req.serviceAnswers || {}).length;
  const photos = Array.isArray(req.photos) ? req.photos.length : 0;
  return words >= 6 || answers >= 2 || photos >= 1;
}

function enabled() { return str(process.env.AUTO_DRAFT).toLowerCase() !== "off"; }

function jobId() { return "auto-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }

async function houseRules() {
  try {
    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const d = await Promise.race([store.get("house-rules", { type: "json" }), new Promise(function (r) { setTimeout(function () { r(null); }, RULES_MS); })]);
    return str(d && d.rules);
  } catch (e) { return ""; }
}

function post(url, body) {
  return new Promise(function (resolve, reject) {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, function (res) {
      res.resume();
      res.on("end", function () { resolve(res.statusCode); });
    });
    req.on("error", reject);
    req.setTimeout(KICK_MS, function () { req.destroy(new Error("The estimator did not answer in time")); });
    req.write(data);
    req.end();
  });
}

/* Start the estimator on one record. Never throws: a request is saved and
   emailed whether or not the draft starts. Returns what happened. */
async function kick(record) {
  if (!enabled()) return { started: false, reason: "off" };
  if (!record || !str(record.ref)) return { started: false, reason: "no-ref" };
  if (!worthDrafting(record)) return { started: false, reason: "too-little" };
  try {
    const base = (process.env.URL || "https://www.sanibuildingcorp.com").replace(/\/$/, "");
    const code = await post(base + "/.netlify/functions/generate-estimate-background", {
      ref: record.ref, jobId: jobId(), reanalyze: true, useDescription: true, useAnswers: true, extraRequest: "", houseRules: await houseRules(), autoDraft: true,
    });
    return { started: code === 202 || code === 200, reason: "http-" + code };
  } catch (e) {
    return { started: false, reason: str(e && e.message).slice(0, 120) };
  }
}

module.exports = { kick, worthDrafting, enabled };
