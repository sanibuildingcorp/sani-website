// netlify/functions/gmail-sync.js — every connected Gmail, into the assistant's inbox.
//
//   "where AI can read direct from there full list of emails"
//
// For each mailbox he connected (lib/gmail-accounts.js): a fresh access
// token from its refresh token, the ids of the last two weeks of inbox mail
// from Google, and the full text of every id not filed yet - a dozen per
// mailbox per run, the fifteen-minute schedule catches up. Each mail goes
// into the "inbox" Blobs store the way info@ mail does (lib/inbox-store.js):
// matched to an estimate by ref, address or name; noise kept out of the
// prompt; customer mail handed to the alert job. The mailbox it came from
// is written on it ("box"), so the assistant can say which account.
//
// The CRM log (Supabase) and the estimate threads are info@'s (inbox-sync);
// a connected mailbox feeds the assistant. Mail he sent himself is skipped.
//
// CONTRACTOR ONLY (x-sbc-key): every run spends Google quota and, through
// the alerts, money. gmail-sync-scheduled calls it with the key from env.

"use strict";

const { requireDashboardKey } = require("./lib/require-dashboard-key");
const gmail = require("./lib/gmail-accounts");
const inbox = require("./lib/inbox-store");

const BUDGET_MS = 8000;
const LIST_MAX = 40;
const DOWNLOADS_PER_BOX = 12;
const QUERY = "in:inbox newer_than:14d -in:spam -in:trash";
const ALERT_MS = 2500;
const OWN = ["@sanibuildingcorp.com", "sanibuildingcorp@gmail.com"];

function str(v) { return String(v == null ? "" : v).trim(); }
function norm(s) { return str(s).toLowerCase(); }
function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    const t = setTimeout(function () { reject(new Error("timed out")); }, ms);
    promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
  });
}
function cleanBody(t) {
  const lines = String(t || "").replace(/\r/g, "").split("\n");
  const out = [];
  for (const ln of lines) {
    if (/^\s*On .{6,80} wrote:\s*$/.test(ln)) break;
    if (/^\s*-{2,}\s*Original Message/i.test(ln)) break;
    if (/^\s*From:\s.+@/.test(ln) && out.length > 0) break;
    if (/^>/.test(ln)) continue;
    out.push(ln);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* Every estimate's customer, for matching - the same list inbox-sync builds. */
async function customersList() {
  try {
    const r = await fetch((process.env.URL || "https://www.sanibuildingcorp.com").replace(/\/$/, "") + "/.netlify/functions/list-estimates", { headers: process.env.DASHBOARD_KEY ? { "x-sbc-key": process.env.DASHBOARD_KEY } : {} });
    const ests = r.ok ? await r.json() : {};
    const arr = (ests && (ests.records || ests.estimates || ests.list)) || (Array.isArray(ests) ? ests : []);
    return arr.map(function (e) {
      const c = (e && e.customer) || {};
      return { ref: e.ref, status: e.status, updatedAt: e.updatedAt, sentAt: e.sentAt, submittedAt: e.submittedAt, name: c.name || "", email: c.email || e.email || "" };
    }).filter(function (c) { return c.ref; });
  } catch (e) { return []; }
}

/* One mailbox. Returns { listed, stored, alerts: [ids], error }. */
async function syncAccount(account, customers, idx, stored, deadline) {
  const out = { email: account.email, listed: 0, stored: 0, alerts: [], error: "" };
  const rec = await gmail.tokenRecord(account.email);
  if (!rec || !rec.refreshToken) { out.error = "no token stored - connect it again"; return out; }
  const seen = new Set(Array.isArray(rec.seen) ? rec.seen : []);
  let access;
  try { access = await gmail.refreshAccess(rec.refreshToken); }
  catch (e) { out.error = "Google refused the saved permission (" + str(e.message).slice(0, 80) + ") - connect it again"; return out; }
  let list = [];
  try { list = await gmail.listMessages(access, QUERY, LIST_MAX); }
  catch (e) { out.error = str(e.message).slice(0, 120); return out; }
  out.listed = list.length;
  let downloads = 0;
  const keep = [];
  for (let i = 0; i < list.length; i++) {
    const gid = str(list[i] && list[i].id);
    if (!gid) continue;
    keep.push(gid);
    if (seen.has(gid)) continue;
    if (Date.now() > deadline || downloads >= DOWNLOADS_PER_BOX) { keep.pop(); continue; }
    downloads++;
    let m;
    try { m = gmail.readMessage(await gmail.getMessage(access, gid)); } catch (e) { keep.pop(); continue; }
    if (!m.from || OWN.some(function (p) { return m.from.indexOf(p) > -1; }) || m.from === norm(account.email)) continue;
    if (!idx || stored.has(m.messageId)) continue;
    const noise = inbox.kindOf(m.from, false) === "notification";
    const clean = noise ? "" : cleanBody(m.text).slice(0, 6000);
    const mail = { id: m.messageId, from: m.from, name: m.name, to: m.to, subject: m.subject, text: clean, raw: str(m.text).slice(0, 20000), at: m.at, box: account.email };
    const match = noise ? { ref: "", by: "" } : inbox.matchEstimate(mail, customers);
    try {
      const line = await inbox.saveMail(mail, match, false, idx);
      stored.add(m.messageId); out.stored++;
      if (line && line.kind === "customer") out.alerts.push(m.messageId);
    } catch (e) { keep.pop(); }
  }
  /* what is filed: the ids we kept plus what was already seen, newest last */
  const merged = Array.from(seen).filter(function (id) { return keep.indexOf(id) === -1; }).concat(keep);
  await gmail.markSync(account.email, out.stored + " new of " + out.listed, "", merged).catch(function () {});
  return out;
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;
  if (!gmail.configured()) return json(200, { ok: true, skipped: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set", accounts: [] });
  const deadline = Date.now() + BUDGET_MS;
  const accounts = await gmail.listAccounts().catch(function () { return []; });
  if (!accounts.length) return json(200, { ok: true, accounts: [], note: "no mailbox connected" });
  const customers = await customersList();
  let idx = null;
  try { idx = await withTimeout(inbox.loadIndex(), 2000); } catch (e) { idx = null; }
  const stored = idx ? inbox.knownIds(idx) : new Set();
  const results = [];
  const alertIds = [];
  for (let i = 0; i < accounts.length; i++) {
    if (Date.now() > deadline) break;
    let r;
    try { r = await syncAccount(accounts[i], customers, idx, stored, deadline); }
    catch (e) { r = { email: accounts[i].email, listed: 0, stored: 0, alerts: [], error: str(e.message).slice(0, 120) }; }
    if (r.error) await gmail.markSync(accounts[i].email, "", r.error).catch(function () {});
    results.push({ email: r.email, listed: r.listed, stored: r.stored, error: r.error });
    alertIds.push.apply(alertIds, r.alerts);
  }
  if (idx && idx.dirty) { try { await withTimeout(inbox.saveIndex(idx), 2000); } catch (e) { /* next run */ } }
  let alerted = 0;
  if (alertIds.length && process.env.DASHBOARD_KEY) {
    const ids = alertIds.slice(0, 5);
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ALERT_MS) : null;
    try {
      await fetch((process.env.URL || "https://www.sanibuildingcorp.com").replace(/\/$/, "") + "/.netlify/functions/inbox-digest-background", {
        method: "POST", headers: { "Content-Type": "application/json", "x-sbc-key": process.env.DASHBOARD_KEY },
        body: JSON.stringify({ mode: "alert", ids: ids }), signal: ctrl ? ctrl.signal : undefined,
      });
      alerted = ids.length;
    } catch (e) { alerted = ids.length; }
    finally { if (timer) clearTimeout(timer); }
  }
  return json(200, { ok: true, accounts: results, indexed: idx ? idx.items.length : null, alertsQueued: alerted });
};

function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
}
function json(code, obj) { return { statusCode: code, headers: cors(), body: JSON.stringify(obj) }; }
