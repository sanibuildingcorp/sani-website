// netlify/functions/chat-facts-background.js
//
// WHAT THE AI LEARNED FROM THE CONVERSATION.
//
//   "🧠 AI learned from this chat: list of facts the AI pulled from the
//    messages, each with what it changed in the estimate ... Each has a tick
//    so I can switch a fact off." / "AI suggests asking: 2-3 tap-to-use
//    questions from missing info"
//
// POST { ref }              read the conversation, write record.chatFacts
// POST { ref, off: [ids] }  only switch facts off / on (the ticks)
//
// The estimator already reads every message (newest wins). This makes what it
// takes from them visible, one line per fact, and lets him switch one off: a
// fact switched off goes to the estimator as "do not use" (chatFacts.ignore in
// generate-estimate-background.js). CONTRACTOR ONLY. Background: the answer is
// stored on the record and the dashboard reads it back.

"use strict";

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const thread = require("./lib/thread");
const claude = require("./lib/claude");

const MODEL = process.env.ESTIMATOR_MODEL || "claude-opus-5";
const C = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n || 400);
const key = (t) => C(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function brief(est) {
  const e = est || {};
  const lines = ["labor", "materials"].reduce(function (a, k) {
    return a.concat((Array.isArray(e[k]) ? e[k] : []).slice(0, 60).map(function (l) { return (k === "labor" ? "LAB" : "MAT") + " | " + C(l && l.section, 40) + " | " + C(l && l.item, 120) + " | " + (l && l.qty) + " " + C(l && l.unit, 10); }));
  }, []);
  const notIncl = (Array.isArray(e.serviceBreakdown) ? e.serviceBreakdown : []).map(function (s) { return C(s && (s.title || s.name), 40) + ": " + (Array.isArray(s && s.notIncluded) ? s.notIncluded : []).map(function (x) { return C(x, 120); }).join("; "); });
  return "LINES (kind | service | item | qty unit):\n" + lines.join("\n") + "\n\nNOT INCLUDED:\n" + notIncl.join("\n") + "\n\nWHAT WE NEED FROM THE CUSTOMER:\n" + (Array.isArray(e.customerNeeds) ? e.customerNeeds : []).map(function (x) { return "- " + C(x, 160); }).join("\n");
}

function prompt(record, msgs) {
  const name = C(record.customer && record.customer.name, 60) || "the customer";
  const convo = msgs.map(function (m) {
    const who = m.from === "contractor" ? "Sani" : name;
    const att = Array.isArray(m.attachments) && m.attachments.length ? " [" + m.attachments.length + " attachment" + (m.attachments.length === 1 ? "" : "s") + "]" : "";
    return "[" + C(m.at, 25) + "] " + who + ": " + C(m.text, 1500) + att;
  }).join("\n");
  return "You read the conversation between Sani Building Corp (a fully insured NYC renovation contractor) and a customer about one estimate, and list what the estimator should take from it.\n\n" +
    "REQUEST: " + C(record.request && record.request.description, 1500) + "\n\nCONVERSATION (oldest first; a later message beats an earlier one):\n" + convo + "\n\nCURRENT ESTIMATE:\n" + brief(record.estimate) + "\n\n" +
    "Return JSON only: {\"facts\":[{\"text\":\"\",\"effect\":\"\"}],\"ask\":[\"\"]}\n" +
    "- facts: 0 to 8 facts stated in the conversation that matter for the price or the scope: a size or count, something included or not included, an item the customer supplies, a delivery date, access or building rules, photos sent. Short, in plain words (\"Hallway ~15 ft long\"). Never a fact that is not in the messages.\n" +
    "- effect: what it means for the estimate, short (\"painting qty 120 sf\", \"added to Not included\", \"delivery date set\", \"added to job photos\"). Empty when it changes nothing.\n" +
    "- ask: 0 to 3 short, friendly questions to send the customer about information still missing that would change the price. Never ask what the messages or the request already answer. Never about paint color, brand or sheen. No prices.\n" +
    "Never use the word \"licensed\". No TV mounting, no gas work.";
}

exports.handler = async function (event) {
  const denied = requireDashboardKey(event, { "Content-Type": "application/json" });
  if (denied) return denied;
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return; }
  const ref = C(body.ref, 40);
  if (!ref) return;
  const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
  const record = await store.get(ref, { type: "json" });
  if (!record) return;
  const prev = record.chatFacts && typeof record.chatFacts === "object" ? record.chatFacts : null;

  /* The ticks only. */
  if (Array.isArray(body.off)) {
    if (!prev || !Array.isArray(prev.facts)) return;
    const off = body.off.map(String);
    prev.facts.forEach(function (f) { f.on = off.indexOf(String(f.id)) === -1; });
    record.chatFacts = prev;
    await store.setJSON(ref, record);
    return;
  }

  let msgs = [];
  try { msgs = thread.normalizeThread(record); } catch (e) { msgs = []; }
  const last = msgs.length ? msgs[msgs.length - 1] : null;
  const out = { at: new Date().toISOString(), basedOn: last ? last.at : "", facts: [], ask: [] };
  if (!msgs.some(function (m) { return m.from !== "contractor"; }) || !process.env.ANTHROPIC_API_KEY) {
    record.chatFacts = out;
    await store.setJSON(ref, record);
    return;
  }
  try {
    const msg = await claude.messages(process.env.ANTHROPIC_API_KEY, { model: MODEL, max_tokens: 1200, messages: [{ role: "user", content: prompt(record, msgs) }] }, 120000);
    const j = claude.jsonOf(claude.textOf(msg));
    if (!j || typeof j !== "object") throw new Error("no JSON in the answer");
    const offBefore = {};
    (prev && Array.isArray(prev.facts) ? prev.facts : []).forEach(function (f) { if (f && f.on === false) offBefore[key(f.text)] = true; });
    out.facts = (Array.isArray(j.facts) ? j.facts : []).map(function (f, i) {
      const text = C(f && f.text, 160).replace(/licens\w*/gi, "insured");
      return text ? { id: "f" + (i + 1), text: text, effect: C(f && f.effect, 120).replace(/licens\w*/gi, "insured"), on: !offBefore[key(text)] } : null;
    }).filter(Boolean).slice(0, 8);
    out.ask = (Array.isArray(j.ask) ? j.ask : []).map(function (q) { return C(q, 200); }).filter(function (q) { return q && !/licens/i.test(q); }).slice(0, 3);
  } catch (err) {
    console.error("chat-facts:", err && err.message);
    out.error = "Could not read the chat just now";
    if (prev && Array.isArray(prev.facts)) { out.facts = prev.facts; out.ask = prev.ask || []; }
  }
  /* Read again just before writing: a reply may have landed meanwhile. */
  const fresh = (await store.get(ref, { type: "json" })) || record;
  fresh.chatFacts = out;
  await store.setJSON(ref, fresh);
};

module.exports.prompt = prompt;
