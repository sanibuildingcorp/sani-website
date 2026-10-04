// netlify/functions/contractor-questions-background.js — his questions, written.
//
// Reads one estimate record and asks Claude what HE still needs to settle
// before pricing (lib/contractor-questions.js). The result is kept in its own
// store ("contractor-questions", keyed by ref) so a save of the estimate while
// it runs can never be overwritten. The dashboard asks contractor-questions
// for it. Contractor-only (x-sbc-key).

"use strict";

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const claude = require("./lib/claude");
const cq = require("./lib/contractor-questions");

const MODEL = "claude-sonnet-5";

function str(v) { return String(v == null ? "" : v).trim(); }
function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
}
function json(code, obj) { return { statusCode: code, headers: cors(), body: JSON.stringify(obj) }; }
function qStore() { return getStore({ name: "contractor-questions", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN }); }

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Unreadable request" }); }
  const ref = str(body.ref);
  const job = /^[A-Za-z0-9_-]{6,60}$/.test(str(body.job)) ? str(body.job) : "";
  if (!ref || !job) return json(400, { error: "ref and job are required" });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: "ANTHROPIC_API_KEY is not set in Netlify." });

  const qs = qStore();
  await qs.set(ref, JSON.stringify({ status: "running", job: job, at: new Date().toISOString() }));
  try {
    const estimates = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const record = await estimates.get(ref, { type: "json" });
    if (!record) throw new Error("Estimate not found");
    const msg = await claude.messages(apiKey, { model: MODEL, max_tokens: 3000, system: cq.SYSTEM, messages: [{ role: "user", content: cq.userPrompt(record) }] }, 120000);
    const questions = cq.cleanQuestions(claude.jsonOf(claude.textOf(msg)));
    await qs.set(ref, JSON.stringify({ status: "done", job: job, at: new Date().toISOString(), questions: questions }));
    return json(200, { ok: true, count: questions.length });
  } catch (e) {
    await qs.set(ref, JSON.stringify({ status: "error", job: job, at: new Date().toISOString(), error: str(e && e.message).slice(0, 200) || "failed" }));
    return json(502, { error: str(e && e.message) });
  }
};
