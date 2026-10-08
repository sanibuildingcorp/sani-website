// netlify/functions/polish-reply.js
//
// ✨ POLISH: his reply to the customer, rewritten short, friendly and clear.
//
// POST { ref, text } -> { text }      CONTRACTOR ONLY (x-sbc-key)
//
// Nothing is sent: the polished words go back into his reply box and he
// presses Send himself. Same meaning, same facts, no new promises, no prices
// he did not write, never "licensed".

"use strict";

const { requireDashboardKey } = require("./lib/require-dashboard-key");
const claude = require("./lib/claude");

const MODEL = process.env.ESTIMATOR_MODEL || "claude-opus-5";

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Unreadable request" }); }
  const text = String(body.text || "").trim().slice(0, 3000);
  if (!text) return json(400, { error: "Write the reply first" });
  if (!process.env.ANTHROPIC_API_KEY) return json(500, { error: "ANTHROPIC_API_KEY is not set" });
  try {
    const msg = await claude.messages(process.env.ANTHROPIC_API_KEY, {
      model: MODEL, max_tokens: 600,
      system: "You polish a renovation contractor's message to his customer. Keep the same meaning, the same facts and numbers, and speak for the company as \"we\" (we, us, our team - never I, me, my; e.g. \"I will send\" becomes \"We will send\"). Make it short, friendly and clear, in plain words. Do not add promises, prices, dates or details he did not write. Never use the word \"licensed\". Return only the message text.",
      messages: [{ role: "user", content: text }],
    }, 9000);
    const out = claude.textOf(msg).replace(/licens\w*/gi, "insured").trim();
    if (!out) return json(502, { error: "No answer came back" });
    return json(200, { text: out });
  } catch (err) {
    return json(502, { error: "Polish failed: " + String((err && err.message) || err).slice(0, 120) });
  }
};

function cors() { return { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Access-Control-Allow-Methods": "POST,OPTIONS" }; }
function json(code, obj) { return { statusCode: code, headers: cors(), body: JSON.stringify(obj) }; }
