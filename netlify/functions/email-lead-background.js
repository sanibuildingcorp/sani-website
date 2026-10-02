// netlify/functions/email-lead-background.js — emails asking for work become requests.
//
// inbox-sync files mail from senders we do not know yet into the assistant's
// inbox (kind "other") and pokes this job with their ids. For each one, once:
//
//   1. Claude reads the email and says whether it asks Sani to price or do
//      work (lib/email-lead.js holds the question).
//   2. If it does: the photos - links in the text and real photo attachments,
//      never the signature logo - are copied into the estimate-photos bucket,
//      and a request record is written to the estimates store, status "new",
//      source "email". The same shape the contact form writes.
//   3. Either way a mark is left (inbox store, "lead-<hash>") so the email is
//      never read twice.
//
// It also picks up the last few days of unknown-sender mail with no mark yet,
// so an email offered while this job failed is not lost.
//
// It sends no email and generates no estimate. Contractor-only (x-sbc-key).

"use strict";

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const inbox = require("./lib/inbox-store");
const claude = require("./lib/claude");
const lead = require("./lib/email-lead");

const MODEL = "claude-sonnet-5";
const PER_RUN = 8;
const LOOKBACK_MS = 4 * 24 * 3600 * 1000;
const BUCKET = "estimate-photos";
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const MAX_MAIL_BYTES = 40 * 1024 * 1024;

function str(v) { return String(v == null ? "" : v).trim(); }
function arr(v) { return Array.isArray(v) ? v : []; }
function json(code, obj) { return { statusCode: code, headers: cors(), body: JSON.stringify(obj) }; }
function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
}
function markKey(id) { return "lead-" + inbox.keyFor(id).slice(2); }

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: "ANTHROPIC_API_KEY is not set in Netlify." });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) { body = {}; }
  const out = { checked: 0, created: [], notRequests: 0, errors: [] };
  try {
    const ids = await candidates(arr(body.ids).map(str).filter(Boolean));
    for (const id of ids) {
      out.checked++;
      try {
        const r = await handle(apiKey, id);
        if (r && r.created) out.created.push(r.ref);
        else if (r && r.decision === "no") out.notRequests++;
      } catch (e) {
        out.errors.push(String((e && e.message) || e).slice(0, 160));
      }
    }
  } catch (e) {
    out.errors.push(String((e && e.message) || e).slice(0, 160));
  }
  console.log("email-lead-background", JSON.stringify(out));
  return json(200, out);
};

/* The ids offered, then recent unknown-sender mail with no mark yet. */
async function candidates(offered) {
  const s = inbox.store();
  const idx = await inbox.loadIndex();
  const since = Date.now() - LOOKBACK_MS;
  const recent = idx.items.filter(function (x) {
    return x && x.kind === "other" && Date.parse(x.at) >= since;
  }).map(function (x) { return x.id; });
  const out = [];
  for (const id of offered.concat(recent)) {
    if (out.length >= PER_RUN) break;
    if (out.indexOf(id) > -1) continue;
    const mark = await s.get(markKey(id), { type: "json" });
    if (mark) continue;
    out.push(id);
  }
  return out;
}

async function handle(apiKey, id) {
  const s = inbox.store();
  const mail = await inbox.loadMail(inbox.keyFor(id));
  if (!mail || mail.kind !== "other") {
    await s.set(markKey(id), JSON.stringify({ decision: "skip", at: new Date().toISOString() }));
    return { decision: "skip" };
  }
  const ref = lead.refForMail(mail.id, mail.at);
  const estimates = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
  if (await estimates.get(ref, { type: "json" })) {
    await s.set(markKey(id), JSON.stringify({ decision: "yes", ref: ref, at: new Date().toISOString() }));
    return { decision: "yes", ref: ref };
  }
  /* claimed before the model is asked: a second run offered the same id
     sees the mark and leaves it */
  await s.set(markKey(id), JSON.stringify({ decision: "pending", at: new Date().toISOString() }));

  let verdict;
  try {
    const msg = await claude.messages(apiKey, { model: MODEL, max_tokens: 1500, system: lead.SYSTEM, messages: [{ role: "user", content: lead.userPrompt(mail) }] }, 90000);
    verdict = lead.readVerdict(claude.jsonOf(claude.textOf(msg)));
  } catch (e) {
    await s.delete(markKey(id)); // let the next run try again
    throw e;
  }
  if (!verdict.isRequest) {
    await s.set(markKey(id), JSON.stringify({ decision: "no", reason: verdict.reason, at: new Date().toISOString() }));
    return { decision: "no" };
  }

  const links = lead.linksIn(mail.text);
  const photos = [], missed = [];
  for (const url of links.photos) {
    if (photos.length >= lead.MAX_PHOTOS) break;
    try { photos.push(await copyLink(url, ref)); } catch (_) { missed.push(url); }
  }
  try {
    for (const a of await mailAttachments(mail.id)) {
      if (photos.length >= lead.MAX_PHOTOS) break;
      try { photos.push(await upload(a.content, a.contentType, ref)); } catch (_) {}
    }
  } catch (e) {
    console.log("email-lead attachments", ref, String((e && e.message) || e).slice(0, 160));
  }

  const record = lead.buildRecord({ ref: ref, mail: mail, verdict: verdict, photos: photos, videos: links.videos, missedPhotos: missed });
  await estimates.setJSON(ref, record);
  await s.set(markKey(id), JSON.stringify({ decision: "yes", ref: ref, at: new Date().toISOString() }));
  return { created: true, ref: ref };
}

/* ── PHOTOS ───────────────────────────────────────────────────────────── */
async function copyLink(href, ref) {
  if (!lead.safeUrl(href)) throw new Error("unsafe link");
  const ctrl = new AbortController();
  const t = setTimeout(function () { ctrl.abort(); }, 20000);
  try {
    /* redirects followed by hand, each hop checked like the first link */
    let url = href, r = null;
    for (let hop = 0; hop < 4; hop++) {
      r = await fetch(url, { redirect: "manual", signal: ctrl.signal });
      if (r.status < 300 || r.status >= 400) break;
      const next = lead.safeUrl(new URL(str(r.headers.get("location")), url).href);
      if (!next) throw new Error("redirected somewhere unsafe");
      url = next.href;
    }
    if (!r || !r.ok) throw new Error("HTTP " + (r ? r.status : "?"));
    const type = str(r.headers.get("content-type")).split(";")[0].toLowerCase();
    if (!/^image\//.test(type)) throw new Error("not an image");
    const len = Number(r.headers.get("content-length")) || 0;
    if (len > MAX_PHOTO_BYTES) throw new Error("too large");
    const buf = Buffer.from(await r.arrayBuffer());
    return await upload(buf, type, ref);
  } finally {
    clearTimeout(t);
  }
}

async function upload(buf, mime, ref) {
  const SUPABASE_URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !KEY) throw new Error("Supabase env vars not set");
  const type = str(mime).toLowerCase();
  if (!/^image\/(jpe?g|png|webp|heic|heif|gif)$/.test(type)) throw new Error("not a photo");
  if (!buf || !buf.length || buf.length > MAX_PHOTO_BYTES) throw new Error("bad size");
  const ext = type.split("/")[1].replace("jpeg", "jpg");
  const safeRef = str(ref).replace(/[^a-zA-Z0-9_-]/g, "") || "misc";
  const path = safeRef + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
  const res = await fetch(SUPABASE_URL + "/storage/v1/object/" + BUCKET + "/" + path, {
    method: "POST",
    headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": type, "x-upsert": "true" },
    body: buf,
  });
  if (!res.ok) throw new Error("Storage upload " + res.status);
  return SUPABASE_URL + "/storage/v1/object/public/" + BUCKET + "/" + path;
}

/* The email's real photo attachments, read again from the mailbox (the
   inbox store keeps text only). Nothing when Gmail is not configured. */
async function mailAttachments(messageId) {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass || !messageId) return [];
  const { ImapFlow } = require("imapflow");
  const { simpleParser } = require("mailparser");
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: user, pass: pass }, logger: false });
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({ header: { "message-id": messageId } });
      if (!Array.isArray(uids) || !uids.length) return [];
      const dl = await client.download(uids[uids.length - 1]);
      if (!dl || !dl.content) return [];
      const chunks = []; let size = 0;
      for await (const ch of dl.content) {
        size += ch.length;
        if (size > MAX_MAIL_BYTES) break;
        chunks.push(ch);
      }
      const parsed = await simpleParser(Buffer.concat(chunks));
      return arr(parsed.attachments).filter(lead.isPhotoAttachment);
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); } catch (_) {}
  }
}
