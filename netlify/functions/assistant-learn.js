// netlify/functions/assistant-learn.js — the brain learns from his history.
//
//   "the main brain can learn from my history too if he will analyze what
//    customers accepted, what price for what job was accepted ... how long
//    was takes this job ... how much i was charged for this job"
//
// SCHEDULED nightly (netlify.toml, 09:30 UTC = 5:30 am New York in summer).
// Reads every estimate record, works out the insights (lib/insights.js) and
// stores them under "insights" in the assistant-memory store. The assistant
// reads that on every call. Nothing here calls an AI: it is arithmetic over
// his own records, so it costs nothing and cannot invent a number.
//
// He can also run it by hand with the dashboard key (POST, x-sbc-key), for
// example right after marking a job completed. Anyone else gets 401. Reading
// ~90 records in parallel takes a second or two; the scheduled limit is 30s.

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const { _readAll } = require("./list-estimates");
const { buildInsights } = require("./lib/insights");

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

exports.handler = async function (event) {
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { body = {}; }
  const scheduled = !!(body && body.next_run);
  const keyed = requireDashboardKey(event) === null;
  if (!scheduled && !keyed) {
    return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "Bad or missing dashboard key" }) };
  }
  try {
    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const listing = await store.list();
    const keys = (listing.blobs || []).map(function (b) { return b.key; });
    const records = await _readAll(store, keys, 12);
    const ins = buildInsights(records, new Date());
    const memory = getStore({ name: "assistant-memory", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    await memory.set("insights", JSON.stringify(ins));
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true, at: ins.at, records: ins.records, accepted: ins.accepted, acceptRate: ins.acceptRate, followUp: ins.followUp.length }) };
  } catch (e) {
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: e.message }) };
  }
};
