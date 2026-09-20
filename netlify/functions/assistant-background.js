// netlify/functions/assistant-background.js — the assistant, with no clock.
//
//   "I can only see what's already loaded on this estimate — I
//    ... (cut short by the time limit — ask "continue" for the rest)"
//
// A synchronous function dies at 10 seconds. The assistant's answer was
// streamed and cut at 8.8, and on a slow round trip to Claude that left a
// sentence and a half. This runs the SAME answer (assistant.js exports it)
// as a background function: fifteen minutes allowed, ninety seconds used.
// The dashboard starts it with a job id, gets a 202 at once, and polls
// assistant.js ({action:"job"}) until the job record says done - exactly
// the way a web search already works. Nothing else changes: the same
// context, the same memory, the same actions, the same saved chats.
//
// CONTRACTOR ONLY, like assistant.js: POST with x-sbc-key.

"use strict";

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const assistant = require("./assistant");

/* Generous, not infinite: a hung socket must still end. */
const ANSWER_MS = 90000;
const RECORD_MS = 6000, MEMORY_MS = 5000, CHAT_WRITE_MS = 4000;
/* No clock here, so the answer may be longer than the sync function's 800
   tokens: a reword action copying six lines exactly is not short. */
const MAX_TOKENS = 2500;

function str(v) { return String(v == null ? "" : v).trim(); }
function jobStore() {
  return getStore({ name: "assistant-jobs", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors(), body: JSON.stringify({ error: "Method Not Allowed" }) };
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Unreadable request" }) }; }
  const id = /^[A-Za-z0-9_-]{6,60}$/.test(str(body.job)) ? str(body.job) : "";
  if (!id) return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "job is required" }) };

  const jobs = jobStore();
  await jobs.set(id, JSON.stringify({ status: "running", kind: "answer", at: new Date().toISOString() }));
  try {
    const out = await assistant.answer(body, { deadline: Date.now() + ANSWER_MS, recordMs: RECORD_MS, memoryMs: MEMORY_MS, chatWriteMs: CHAT_WRITE_MS, maxTokens: MAX_TOKENS });
    await jobs.set(id, JSON.stringify({ status: "done", kind: "answer", reply: out.reply, truncated: out.truncated === true, actions: out.actions, at: new Date().toISOString() }));
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true, job: id }) };
  } catch (e) {
    await jobs.set(id, JSON.stringify({ status: "error", kind: "answer", error: str(e && e.message) || "the assistant failed", at: new Date().toISOString() }));
    return { statusCode: 502, headers: cors(), body: JSON.stringify({ error: str(e && e.message) }) };
  }
};

function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
}
