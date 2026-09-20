// netlify/functions/inbox-digest-background.js — the inbox, read for him.
//
//   "Rafael followed up again at 6:53 PM today asking for the promised
//    corrected estimate" ... "Customer action list — Sunday, September 20"
//
// The notifications his ChatGPT sends him, from his own inbox and his own
// estimates. Two modes, one function, contractor-only (x-sbc-key):
//
//   { mode: "daily" }         the morning "Customer action list": every
//                             customer email of the last day, every estimate
//                             waiting on him, what to do about each. Emailed
//                             to him and kept as inbox/digest-latest so the
//                             assistant can quote it. Sent only when there is
//                             something on it. Called by inbox-digest-
//                             scheduled on the cron in netlify.toml.
//
//   { mode: "alert", ids }    new customer mail just filed by inbox-sync.
//                             Claude reads each one with its estimate and
//                             says whether he needs to hear about it now
//                             (a follow-up, a request for a correction, a
//                             question, an acceptance) - if so, one short
//                             email per mail, with what was asked and what
//                             to do. A thank-you or "got it" makes no alert.
//
// A background function: fifteen minutes allowed, a minute used. It reads
// the inbox store and the estimate list; it writes only the digest record
// and an "alerted" mark on the index line. It never emails a customer.

"use strict";

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const inbox = require("./lib/inbox-store");
const claude = require("./lib/claude");
const { sendResend, esc } = require("./lib/send-email");
const ADDR = require("./lib/addresses");

const MODEL = "claude-sonnet-5";
const DAY_MS = 24 * 3600 * 1000;
const ALERT_MAX = 5;
const TZ = "America/New_York";

function str(v) { return String(v == null ? "" : v).trim(); }
function arr(v) { return Array.isArray(v) ? v : []; }
function json(code, obj) { return { statusCode: code, headers: cors(), body: JSON.stringify(obj) }; }
function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
}
function nyDate(d) { return new Date(d || Date.now()).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TZ }); }
function nyTime(d) { return new Date(d || Date.now()).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ }); }

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Unreadable request" }); }
  const mode = str(body.mode);
  if (mode !== "daily" && mode !== "alert") return json(400, { error: "mode must be daily or alert" });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: "ANTHROPIC_API_KEY is not set in Netlify." });

  try {
    const out = mode === "daily" ? await daily(apiKey, body) : await alerts(apiKey, arr(body.ids));
    return json(200, out);
  } catch (e) {
    console.error("inbox-digest error:", e && e.message);
    return json(502, { error: str(e && e.message) || "digest failed" });
  }
};

/* ── THE ESTIMATES, ONE LINE EACH ─────────────────────────────────────── */
async function estimateLines() {
  const base = (process.env.URL || "https://www.sanibuildingcorp.com").replace(/\/$/, "");
  let list = [];
  try {
    const r = await fetch(base + "/.netlify/functions/list-estimates", { headers: { "x-sbc-key": process.env.DASHBOARD_KEY || "" } });
    const j = r.ok ? await r.json() : {};
    list = arr(j && j.estimates);
  } catch (e) { list = []; }
  const byRef = {};
  const lines = list.filter(function (e) { return e && ["completed", "declined"].indexOf(str(e.status)) === -1; }).slice(0, 80).map(function (e) {
    byRef[e.ref] = e;
    const c = e.customer || {}, est = e.estimate || {};
    return "  " + [e.ref, c.name || "?", str(est.projectTitle) || str(e.request && e.request.service), e.status,
      est.customerTotal != null ? "$" + Math.round(Number(est.customerTotal) || 0) : "-",
      e.sentAt ? "sent " + str(e.sentAt).slice(0, 10) : "not sent",
      e.needsReply ? "CUSTOMER WAITING FOR A REPLY" : ""].filter(Boolean).join(" | ");
  });
  return { lines: lines, byRef: byRef };
}

/* ── DAILY ────────────────────────────────────────────────────────────── */
async function daily(apiKey, body) {
  const now = body && body.now ? new Date(body.now) : new Date();
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const idx = await inbox.loadIndex();
  const recent = idx.items.filter(function (x) { return x.at >= since && x.kind !== "notification"; }).slice(0, 30);
  const full = await Promise.all(recent.filter(function (x) { return x.kind === "customer"; }).slice(0, 12).map(function (x) { return inbox.loadMail(x.key).catch(function () { return null; }); }));
  const ests = await estimateLines();
  const waiting = ests.lines.filter(function (l) { return /CUSTOMER WAITING/.test(l); });

  if (!recent.length && !waiting.length) {
    await inbox.store().set("digest-latest", JSON.stringify({ at: now.toISOString(), sent: false, text: "Nothing needed you on " + nyDate(now) + ": no customer email in the last day and nobody waiting for a reply." }));
    return { ok: true, sent: false, reason: "nothing to report", emails: 0, waiting: 0 };
  }

  const mailBlock = recent.map(function (x, i) {
    const m = full.find(function (f) { return f && f.id === x.id; });
    return (i + 1) + ". " + nyTime(x.at) + " | " + (x.name ? x.name + " <" + x.from + ">" : x.from) + " | " + (x.subject || "(no subject)") + (x.ref ? " | about " + x.ref : " | not tied to an estimate") +
      "\n   " + (m && m.text ? str(m.text).replace(/\s+/g, " ").slice(0, 900) : x.snippet);
  }).join("\n");

  const system = [
    "You write the morning 'Customer action list' for Zurab, who runs Sani Building Corp, a renovation contractor in Brooklyn. He reads it on his phone at breakfast.",
    "From his inbox of the last day and his open estimates below, list what needs him today: a customer who followed up or is waiting, a request to correct or change an estimate, a question, an acceptance, a new lead who wrote in. For each: the name, the estimate ref when there is one, what they asked in one line, and what to do in one line. Most important first. Numbered. Plain English, short sentences. Nothing that does not need him.",
    "If an email asks for a change to the scope or the price, say exactly what was asked so he can update the estimate.",
    "Do not invent anything: only what is in the emails and the list. Never quote a price you are not given. Never use the word 'licensed'. End with one line: how many items, and 'Nothing else needs you today.' if that is true.",
  ].join("\n");
  const user = "TODAY: " + nyDate(now) + "\n\nEMAILS OF THE LAST DAY (newest first):\n" + (mailBlock || "  none") + "\n\nOPEN ESTIMATES:\n" + (ests.lines.join("\n") || "  none");
  const msg = await claude.messages(apiKey, { model: MODEL, max_tokens: 900, system: system, messages: [{ role: "user", content: user }] }, 90000);
  const text = claude.textOf(msg) || "Nothing to report.";

  const subject = "Customer action list — " + nyDate(now);
  const html = "<div style=\"font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#222;line-height:1.55\">" +
    "<div style=\"font-size:12px;letter-spacing:3px;color:#8a6d1a;text-transform:uppercase\">Sani Building Corp · your assistant</div>" +
    "<h2 style=\"margin:8px 0 14px;color:#0a1628\">" + esc(subject) + "</h2>" +
    "<div style=\"white-space:pre-wrap;font-size:15px\">" + esc(text) + "</div>" +
    "<p style=\"margin-top:22px;font-size:13px;color:#777\">From your inbox (info@) and your estimates. Open the dashboard: <a href=\"https://www.sanibuildingcorp.com/dashboard.html\" style=\"color:#0a1628\">sanibuildingcorp.com/dashboard.html</a></p></div>";
  let sent = false, error = "";
  try {
    await sendResend({ from: ADDR.FROM_SYSTEM, to: [ADDR.alertsTo()], subject: subject, html: html, text: text + "\n\nOpen the dashboard: https://www.sanibuildingcorp.com/dashboard.html", headers: { "X-Entity-Ref-ID": "digest-" + now.toISOString().slice(0, 10) } });
    sent = true;
  } catch (e) { error = str(e && e.message); }
  await inbox.store().set("digest-latest", JSON.stringify({ at: now.toISOString(), sent: sent, text: text, error: error || undefined }));
  return { ok: true, sent: sent, error: error || undefined, emails: recent.length, waiting: waiting.length };
}

/* ── ALERTS ───────────────────────────────────────────────────────────── */
async function alerts(apiKey, ids) {
  const idx = await inbox.loadIndex();
  const want = ids.map(str).filter(Boolean).slice(0, ALERT_MAX);
  const items = idx.items.filter(function (x) { return want.indexOf(x.id) !== -1 && !x.alerted; });
  if (!items.length) return { ok: true, alerts: 0, reason: "nothing new" };
  const ests = await estimateLines();
  const results = [];
  for (const x of items) {
    const m = await inbox.loadMail(x.key).catch(function () { return null; });
    if (!m) continue;
    const e = x.ref ? ests.byRef[x.ref] : null;
    const about = e ? (e.ref + " | " + str(e.customer && e.customer.name) + " | " + str(e.estimate && e.estimate.projectTitle) + " | status " + e.status + (e.estimate && e.estimate.customerTotal != null ? " | $" + Math.round(Number(e.estimate.customerTotal) || 0) : "") + (e.sentAt ? " | sent " + str(e.sentAt).slice(0, 10) : " | not sent yet")) : "no estimate matched";
    const system = "You read one email that just arrived for Zurab, who runs Sani Building Corp (renovation contractor, Brooklyn), and decide whether he needs to hear about it NOW. Answer ONLY with JSON: {\"alert\": true|false, \"headline\": \"<one line, under 12 words, who and what>\", \"summary\": \"<two or three short sentences: what they asked, what changed, what to do>\", \"change\": \"<if they ask to change the scope or the price of the estimate, exactly what, else empty>\"}. alert is true for a follow-up, a question, a request to correct or change something, an acceptance, a complaint, a new job. alert is false for a plain thank-you, 'got it', 'ok', an out-of-office, a receipt. Never use the word 'licensed'. Never invent a price.";
    const user = "THE EMAIL\nFrom: " + (m.name ? m.name + " <" + m.from + ">" : m.from) + "\nWhen: " + nyTime(m.at) + "\nSubject: " + m.subject + "\n\n" + str(m.text).slice(0, 4000) + "\n\nTHE ESTIMATE IT IS ABOUT: " + about;
    let verdict = null;
    try {
      const msg = await claude.messages(apiKey, { model: MODEL, max_tokens: 400, system: system, messages: [{ role: "user", content: user }] }, 60000);
      verdict = claude.jsonOf(claude.textOf(msg));
    } catch (err) { results.push({ id: x.id, error: str(err && err.message) }); continue; }
    if (!verdict || verdict.alert !== true) { x.alerted = "no"; results.push({ id: x.id, alert: false }); continue; }
    const headline = str(verdict.headline).slice(0, 120) || (str(m.name || m.from) + " wrote");
    const summary = str(verdict.summary).slice(0, 800);
    const change = str(verdict.change).slice(0, 500);
    const subject = "⚡ " + headline;
    const link = "https://www.sanibuildingcorp.com/dashboard.html" + (x.ref ? "?ref=" + encodeURIComponent(x.ref) : "");
    const text = summary + (change ? "\n\nThey ask to change the estimate: " + change : "") + "\n\nFrom: " + (m.name ? m.name + " <" + m.from + ">" : m.from) + "\nSubject: " + m.subject + "\nReceived: " + nyTime(m.at) + (x.ref ? "\nEstimate: " + x.ref : "") + "\n\nOpen: " + link;
    const html = "<div style=\"font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#222;line-height:1.55\">" +
      "<div style=\"font-size:12px;letter-spacing:3px;color:#8a6d1a;text-transform:uppercase\">Sani Building Corp · your assistant</div>" +
      "<h2 style=\"margin:8px 0 12px;color:#0a1628\">" + esc(headline) + "</h2>" +
      "<p style=\"font-size:15px;margin:0 0 12px\">" + esc(summary) + "</p>" +
      (change ? "<p style=\"font-size:14px;margin:0 0 12px;padding:10px 12px;background:#fdf6e3;border:1px solid #ecd9a0;border-radius:8px\"><b>They ask to change the estimate:</b> " + esc(change) + "</p>" : "") +
      "<p style=\"font-size:13px;color:#555;margin:0 0 16px\">From " + esc(m.name ? m.name + " <" + m.from + ">" : m.from) + " · " + esc(m.subject) + " · " + esc(nyTime(m.at)) + (x.ref ? " · " + esc(x.ref) : "") + "</p>" +
      "<a href=\"" + esc(link) + "\" style=\"display:inline-block;background:#c8860a;color:#fff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:9px\">Open in the dashboard &rarr;</a></div>";
    try {
      await sendResend({ from: ADDR.FROM_SYSTEM, to: [ADDR.alertsTo()], subject: subject, html: html, text: text, headers: { "X-Entity-Ref-ID": "alert-" + x.key } });
      x.alerted = "sent";
      results.push({ id: x.id, alert: true, headline: headline });
    } catch (err) { results.push({ id: x.id, alert: true, error: str(err && err.message) }); }
  }
  try { await inbox.saveIndex(idx); } catch (e) { /* the marks are a courtesy */ }
  return { ok: true, alerts: results.filter(function (r) { return r.alert === true && !r.error; }).length, results: results };
}
