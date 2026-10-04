// netlify/functions/contractor-questions.js — read his questions, save his answers.
//
//   GET  ?ref=...                      -> { status, job, questions, answers }
//   POST { ref, answers: [{id, question, answer}] }
//        -> record.contractorAnswers, one line in record.history
//
// The questions are written by contractor-questions-background. The answers go
// on the record, where the generator reads them as contractor notes.
// Contractor-only (x-sbc-key).

"use strict";

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const cq = require("./lib/contractor-questions");
const history = require("./lib/history");

function str(v) { return String(v == null ? "" : v).trim(); }
function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
}
function json(code, obj) { return { statusCode: code, headers: cors(), body: JSON.stringify(obj) }; }
function store(name) { return getStore({ name: name, siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN }); }

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;
  try {
    if (event.httpMethod === "GET") {
      const ref = str((event.queryStringParameters || {}).ref);
      if (!ref) return json(400, { error: "ref is required" });
      const q = (await store("contractor-questions").get(ref, { type: "json" })) || {};
      const record = await store("estimates").get(ref, { type: "json" });
      return json(200, { status: q.status || "none", job: q.job || "", at: q.at || "", error: q.error || "", questions: q.questions || [], answers: (record && record.contractorAnswers) || [] });
    }
    if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Unreadable request" }); }
    const ref = str(body.ref);
    if (!ref) return json(400, { error: "ref is required" });
    const answers = cq.cleanAnswers(body.answers);
    const estimates = store("estimates");
    const record = await estimates.get(ref, { type: "json" });
    if (!record) return json(404, { error: "Estimate not found" });
    /* A question answered again replaces its old answer; the rest stay. */
    const byQ = {};
    (Array.isArray(record.contractorAnswers) ? record.contractorAnswers : []).forEach(function (a) { if (a && a.question) byQ[a.question.toLowerCase()] = a; });
    answers.forEach(function (a) { byQ[a.question.toLowerCase()] = Object.assign({}, a, { at: new Date().toISOString() }); });
    record.contractorAnswers = Object.keys(byQ).map(function (k) { return byQ[k]; }).slice(-30);
    history.note(record, "saved", "Answered " + answers.length + " question" + (answers.length === 1 ? "" : "s") + " before pricing");
    record.updatedAt = new Date().toISOString();
    await estimates.setJSON(ref, record);
    return json(200, { ok: true, answers: record.contractorAnswers });
  } catch (e) {
    return json(500, { error: str(e && e.message) || "failed" });
  }
};
