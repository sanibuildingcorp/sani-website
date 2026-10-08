// netlify/functions/email-import-background.js — read the email he picked.
//
// { jobId, src: "imap" | "gmail:<box>", id } (from email-import.js "read").
// Downloads the whole email, copies its real photos (attachments + photo
// links) into estimate-photos, asks Claude for the customer's details and
// the request in their words, and writes { status: "done", draft, photos,
// mail } to the inbox store under jobId. Writes NO estimate: he checks the
// draft and taps Save (email-import.js "create"). Contractor only.
"use strict";

const { requireDashboardKey } = require("./lib/require-dashboard-key");
const gmail = require("./lib/gmail-accounts");
const inbox = require("./lib/inbox-store");
const claude = require("./lib/claude");
const lead = require("./lib/email-lead");
const imp = require("./lib/email-import");

const MODEL = "claude-sonnet-5";
const BUCKET = "estimate-photos";
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const MAX_MAIL_BYTES = 40 * 1024 * 1024;
function str(v) { return String(v == null ? "" : v).trim(); }
function arr(v) { return Array.isArray(v) ? v : []; }
function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Content-Type": "application/json" }; }

async function fromImap(uid) {
  const { ImapFlow } = require("imapflow");
  const { simpleParser } = require("mailparser");
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }, logger: false });
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const dl = await client.download(String(uid), undefined, { uid: true });
      if (!dl || !dl.content) throw new Error("email not found");
      const chunks = []; let size = 0;
      for await (const ch of dl.content) { size += ch.length; if (size > MAX_MAIL_BYTES) break; chunks.push(ch); }
      const p = await simpleParser(Buffer.concat(chunks));
      const f = (p.from && p.from.value && p.from.value[0]) || {};
      return {
        mail: { messageId: str(p.messageId), from: str(f.address).toLowerCase(), name: str(f.name), to: str(p.to && p.to.text), subject: str(p.subject), at: (p.date || new Date()).toISOString(), text: str(p.text) || gmail.stripHtml(p.html || ""), box: process.env.GMAIL_USER },
        attachments: arr(p.attachments).filter(lead.isPhotoAttachment).map(function (a) { return { buf: a.content, type: a.contentType }; }),
      };
    } finally { lock.release(); }
  } finally { try { await client.logout(); } catch (_) {} }
}

async function fromGmail(box, id) {
  const rec = await gmail.tokenRecord(box);
  if (!rec || !rec.refreshToken) throw new Error(box + ": connect it again");
  const access = await gmail.refreshAccess(rec.refreshToken);
  const raw = await gmail.getMessage(access, id);
  const m = gmail.readMessage(raw);
  const parts = [];
  (function walk(p) { if (!p) return; if (p.body && p.body.attachmentId && /^image\//.test(str(p.mimeType))) parts.push(p); arr(p.parts).forEach(walk); })(raw.payload);
  const attachments = [];
  for (const p of parts.slice(0, 12)) {
    const disp = arr(p.headers).find(function (h) { return /content-disposition/i.test(h.name); });
    const cid = arr(p.headers).find(function (h) { return /content-id/i.test(h.name); });
    const meta = { contentType: p.mimeType, size: Number(p.body.size) || 0, contentDisposition: disp && /inline/i.test(disp.value) ? "inline" : "attachment", cid: cid ? cid.value : "" };
    if (!lead.isPhotoAttachment(meta)) continue;
    try {
      const r = await fetch(gmail.API + "/messages/" + encodeURIComponent(id) + "/attachments/" + encodeURIComponent(p.body.attachmentId), { headers: { Authorization: "Bearer " + access } });
      const d = await r.json();
      if (d && d.data) attachments.push({ buf: Buffer.from(String(d.data).replace(/-/g, "+").replace(/_/g, "/"), "base64"), type: p.mimeType });
    } catch (_) {}
  }
  return { mail: { messageId: m.messageId, from: m.from, name: m.name, to: m.to, subject: m.subject, at: m.at, text: m.text, box: box }, attachments: attachments };
}

async function upload(buf, mime, ref) {
  const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SECRET_KEY;
  if (!U || !K) throw new Error("Supabase env vars not set");
  const type = str(mime).toLowerCase();
  if (!/^image\/(jpe?g|png|webp|heic|heif|gif)$/.test(type)) throw new Error("not a photo");
  if (!buf || !buf.length || buf.length > MAX_PHOTO_BYTES) throw new Error("bad size");
  const path = str(ref).replace(/[^a-zA-Z0-9_-]/g, "") + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + type.split("/")[1].replace("jpeg", "jpg");
  const res = await fetch(U + "/storage/v1/object/" + BUCKET + "/" + path, { method: "POST", headers: { apikey: K, Authorization: "Bearer " + K, "Content-Type": type, "x-upsert": "true" }, body: buf });
  if (!res.ok) throw new Error("Storage upload " + res.status);
  return U + "/storage/v1/object/public/" + BUCKET + "/" + path;
}

async function copyLink(href, ref) {
  const u = lead.safeUrl(href); if (!u) throw new Error("unsafe");
  const ctrl = new AbortController(), t = setTimeout(function () { ctrl.abort(); }, 15000);
  try {
    /* redirects by hand, every hop checked like the first link */
    let url = u.href, r = null;
    for (let hop = 0; hop < 4; hop++) {
      r = await fetch(url, { redirect: "manual", signal: ctrl.signal });
      if (r.status < 300 || r.status >= 400) break;
      const next = lead.safeUrl(new URL(str(r.headers.get("location")), url).href);
      if (!next) throw new Error("unsafe redirect");
      url = next.href;
    }
    const type = str(r.headers.get("content-type")).split(";")[0].toLowerCase();
    if (!r.ok || !/^image\//.test(type)) throw new Error("not an image");
    return await upload(Buffer.from(await r.arrayBuffer()), type, ref);
  } finally { clearTimeout(t); }
}

exports.handler = async function (event) {
  const denied = requireDashboardKey(event, cors()); if (denied) return denied;
  let b = {}; try { b = JSON.parse(event.body || "{}"); } catch (_) {}
  const s = inbox.store(), jobId = str(b.jobId);
  if (!/^imp-[a-z0-9]+$/.test(jobId)) return { statusCode: 400, headers: cors(), body: "{}" };
  try {
    const src = str(b.src);
    const got = src === "imap" ? await fromImap(b.id) : src.indexOf("gmail:") === 0 ? await fromGmail(src.slice(6), str(b.id)) : null;
    if (!got) throw new Error("Unknown mailbox");
    const mail = got.mail;
    const ref = lead.refForMail(mail.messageId, mail.at);
    const photos = [];
    for (const a of got.attachments) { if (photos.length >= 12) break; try { photos.push(await upload(a.buf, a.type, ref)); } catch (_) {} }
    for (const url of lead.linksIn(mail.text).photos) { if (photos.length >= 12) break; try { photos.push(await copyLink(url, ref)); } catch (_) {} }
    const msg = await claude.messages(process.env.ANTHROPIC_API_KEY, { model: MODEL, max_tokens: 3000, system: imp.SYSTEM, messages: [{ role: "user", content: imp.userPrompt(mail) }] }, 120000);
    const draft = imp.readDraft(claude.jsonOf(claude.textOf(msg)), mail);
    await s.setJSON(jobId, { status: "done", at: new Date().toISOString(), draft: draft, photos: photos, ref: ref,
      mail: { messageId: mail.messageId, from: mail.from, name: mail.name, subject: mail.subject, at: mail.at, box: mail.box, text: str(mail.text).slice(0, 8000) } });
  } catch (e) {
    await s.setJSON(jobId, { status: "error", error: str(e && e.message).slice(0, 200), at: new Date().toISOString() });
  }
  return { statusCode: 202, headers: cors(), body: "{}" };
};
