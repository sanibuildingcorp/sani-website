// netlify/functions/email-import.js — pick an email, make it an estimate request.
//
//   "how can we move in dashboard estimate direct from the email? ... click,
//    open, choose and move to estimate with full customer details"
//
//   { action: "list", q }            -> { items: [{ src, id, from, name, subject, at, messageId, ref, imported }], errors }
//        searches info@ (IMAP, where contact@ lands) and every connected Gmail
//   { action: "read", src, id }      -> { jobId }  (email-import-background reads it, ~20-40 s)
//   { action: "status", jobId }      -> { status: "working" | "done" | "error", draft, photos, mail, error }
//   { action: "create", jobId, draft, photos, parentRef } -> { ref, existed }
//
// Nothing is sent to anyone. Contractor only (x-sbc-key).
"use strict";

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const gmail = require("./lib/gmail-accounts");
const inbox = require("./lib/inbox-store");
const lead = require("./lib/email-lead");
const imp = require("./lib/email-import");

function str(v) { return String(v == null ? "" : v).trim(); }
function arr(v) { return Array.isArray(v) ? v : []; }
function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" }; }
function json(code, obj) { return { statusCode: code, headers: cors(), body: JSON.stringify(obj) }; }
function within(p, ms) { return new Promise(function (ok, no) { const t = setTimeout(function () { no(new Error("timed out")); }, ms); p.then(function (v) { clearTimeout(t); ok(v); }, function (e) { clearTimeout(t); no(e); }); }); }
function estimates() { return getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN }); }

/* info@ over IMAP: the newest matches of a Gmail search. */
async function imapList(q) {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return [];
  const { ImapFlow } = require("imapflow");
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: user, pass: pass }, logger: false });
  await client.connect();
  const out = [];
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      let uids = await client.search({ gmailRaw: imp.queryFor(q) }, { uid: true });
      uids = arr(uids).slice(-20);
      if (uids.length) for await (const m of client.fetch(uids, { envelope: true, internalDate: true }, { uid: true })) {
        const e = m.envelope || {}, f = arr(e.from)[0] || {};
        out.push({ src: "imap", id: String(m.uid), from: str(f.address).toLowerCase(), name: str(f.name), subject: str(e.subject) || "(no subject)", at: new Date(m.internalDate || e.date || Date.now()).toISOString(), messageId: str(e.messageId), box: user });
      }
    } finally { lock.release(); }
  } finally { try { await client.logout(); } catch (_) {} }
  return out;
}

/* One connected Gmail: ids, then just the headers of each. */
async function gmailList(account, q) {
  const rec = await gmail.tokenRecord(account.email);
  if (!rec || !rec.refreshToken) throw new Error(account.email + ": connect it again");
  const access = await gmail.refreshAccess(rec.refreshToken);
  const ids = (await gmail.listMessages(access, imp.queryFor(q), 15)).map(function (x) { return x.id; });
  const heads = await Promise.all(ids.map(async function (id) {
    try {
      const r = await fetch(gmail.API + "/messages/" + encodeURIComponent(id) + "?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID", { headers: { Authorization: "Bearer " + access } });
      const m = await r.json();
      const h = {}; arr(m.payload && m.payload.headers).forEach(function (x) { h[str(x.name).toLowerCase()] = str(x.value); });
      const f = gmail.parseAddress(h.from);
      return { src: "gmail:" + account.email, id: id, from: f.address, name: f.name, subject: h.subject || "(no subject)", at: new Date(Number(m.internalDate) || Date.now()).toISOString(), messageId: h["message-id"] || ("gmail-" + id), snippet: str(m.snippet).slice(0, 160), box: account.email };
    } catch (_) { return null; }
  }));
  return heads.filter(Boolean);
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
  const denied = requireDashboardKey(event, cors()); if (denied) return denied;
  let b = {}; try { b = JSON.parse(event.body || "{}"); } catch (_) {}
  const s = inbox.store();
  try {
    if (b.action === "list") {
      const errors = [], items = [];
      let accounts = []; try { accounts = await gmail.listAccounts(); } catch (_) {}
      const jobs = [within(imapList(b.q), 8000).catch(function (e) { errors.push("info@: " + e.message); return []; })]
        .concat(arr(accounts).map(function (a) { return within(gmailList(a, b.q), 8000).catch(function (e) { errors.push(str(e.message).slice(0, 120)); return []; }); }));
      (await Promise.all(jobs)).forEach(function (l) { items.push.apply(items, l); });
      /* one row per email (the same mail can sit in two boxes) */
      const seen = new Set(), list = items.filter(function (m) { const k = m.messageId || m.src + m.id; if (seen.has(k)) return false; seen.add(k); return true; })
        .sort(function (a, c) { return Date.parse(c.at) - Date.parse(a.at); }).slice(0, 30);
      const est = estimates();
      await Promise.all(list.map(async function (m) { m.ref = lead.refForMail(m.messageId, m.at); m.imported = !!(await est.get(m.ref, { type: "json" }).catch(function () { return null; })); }));
      return json(200, { items: list, errors: errors, accounts: arr(accounts).map(function (a) { return a.email; }), gmailReady: gmail.configured() });
    }
    if (b.action === "read") {
      const src = str(b.src), id = str(b.id);
      if (!src || !id) return json(400, { error: "Missing email" });
      const jobId = "imp-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await s.setJSON(jobId, { status: "working", at: new Date().toISOString() });
      const base = (process.env.URL || "https://www.sanibuildingcorp.com").replace(/\/$/, "");
      const host = event.headers && (event.headers.host || event.headers.Host);
      const url = (host ? "https://" + host : base) + "/.netlify/functions/email-import-background";
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-sbc-key": process.env.DASHBOARD_KEY || "" }, body: JSON.stringify({ jobId: jobId, src: src, id: id }) });
      if (r.status !== 202 && !r.ok) return json(502, { error: "Could not start reading (" + r.status + ")" });
      return json(200, { jobId: jobId });
    }
    if (b.action === "status") {
      const j = await s.get(str(b.jobId), { type: "json" });
      return json(200, j || { status: "working" });
    }
    if (b.action === "create") {
      const j = await s.get(str(b.jobId), { type: "json" });
      if (!j || j.status !== "done" || !j.mail) return json(400, { error: "Read the email first" });
      const d = Object.assign({}, j.draft || {}, b.draft || {});
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(d.email))) return json(400, { error: "The customer's email is needed" });
      if (!str(d.name)) return json(400, { error: "The customer's name is needed" });
      const ref = lead.refForMail(j.mail.messageId, j.mail.at);
      const est = estimates();
      if (await est.get(ref, { type: "json" })) return json(200, { ref: ref, existed: true });
      const photos = arr(b.photos).filter(function (u) { return arr(j.photos).indexOf(u) > -1; });
      let parent = null;
      if (str(b.parentRef)) { parent = await est.get(str(b.parentRef).toUpperCase(), { type: "json" }); if (!parent) return json(404, { error: "That customer job was not found" }); }
      const rec = imp.buildRecord(ref, d, j.mail, photos, parent ? parent.ref : "");
      await est.setJSON(ref, rec);
      if (parent) { parent.addonRefs = arr(parent.addonRefs).filter(function (x) { return x !== ref; }).concat([ref]); await est.setJSON(parent.ref, parent); }
      /* the automatic email-to-request job must not make a second copy */
      try { await s.set("lead-" + inbox.keyFor(j.mail.messageId).slice(2), JSON.stringify({ decision: "yes", ref: ref, by: "import", at: new Date().toISOString() })); } catch (_) {}
      return json(200, { ref: ref, existed: false });
    }
    return json(400, { error: "Unknown action" });
  } catch (e) {
    return json(500, { error: str(e && e.message).slice(0, 200) });
  }
};
