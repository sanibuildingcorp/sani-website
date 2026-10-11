// netlify/functions/handyman-brain.js
//
// Contractor only (x-sbc-key).
//   GET  ?ref=SBC-H-...   -> the brain's state for that booking
//                            { status, plan, chat, error, rates, send }
//   GET  ?rates=1         -> his handyman rates
//   POST { rates: {...} } -> saves his rates (hourly, minimumCharge, materialMarkupPct)
//
// The brain itself runs in handyman-brain-background.js.

"use strict";

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const brain = require("./lib/handyman-brain");

const H = { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key" };
const out = (code, body) => ({ statusCode: code, headers: H, body: JSON.stringify(body) });
const settings = () => getStore({ name: "settings", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
const brainStore = () => getStore({ name: "handyman-brain", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: H, body: "" };
  const denied = requireDashboardKey(event);
  if (denied) return denied;
  try {
    const q = event.queryStringParameters || {};
    const rates = brain.cleanRates(await settings().get("handyman-rates", { type: "json" }).catch(() => null));
    if (event.httpMethod === "POST") {
      const b = JSON.parse(event.body || "{}");
      if (!b.rates) return out(400, { error: "Nothing to save" });
      const r = brain.cleanRates(Object.assign({}, b.rates, { draft: false }));
      await settings().setJSON("handyman-rates", r);
      return out(200, { rates: r });
    }
    if (q.rates) return out(200, { rates });
    /* The list view: each booking's brain price and title, one call. */
    if (q.list) {
      const st = brainStore(); const prices = {};
      const { blobs } = await st.list();
      await Promise.all((blobs || []).slice(0, 300).map(async (x) => {
        const v = await st.get(x.key, { type: "json" }).catch(() => null);
        if (v && v.plan) prices[x.key] = { total: brain.priceOf(v.plan, rates).total, title: v.plan.title, confidence: v.plan.confidence, visitHours: v.plan.visitHours };
      }));
      return out(200, { prices });
    }
    const ref = String(q.ref || "");
    if (!/^SBC-H-[A-Z0-9-]+$/i.test(ref)) return out(400, { error: "bad ref" });
    const st = (await brainStore().get(ref, { type: "json" }).catch(() => null)) || { status: "none", chat: [] };
    /* Re-price with his CURRENT rates, so changing a rate shows right away. */
    if (st.plan) st.plan.price = brain.priceOf(st.plan, rates);
    /* A run that died without saving (over 15 min) is not "running" forever. */
    if (st.status === "running" && Date.now() - new Date(st.updatedAt || 0).getTime() > 16 * 60 * 1000) { st.status = "error"; st.error = "The brain stopped. Try again."; }
    return out(200, Object.assign(st, { rates, send: st.plan ? brain.sendFields(st.plan) : null }));
  } catch (e) {
    return out(500, { error: String(e && e.message || e) });
  }
};
