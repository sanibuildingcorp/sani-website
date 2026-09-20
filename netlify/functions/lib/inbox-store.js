// netlify/functions/lib/inbox-store.js
//
// EVERY EMAIL IN HIS INBOX, WHERE THE ASSISTANT CAN READ IT.
//
//   "I have a connected ChatGPT in my gmail and can read all emails, can we
//    connect my AI to the my gmail too same as i have connected ChatGPT?
//    ... Let's my AI read all emails direct from gmail, then AI can pull
//    out any necessary information need for better estimate or update in
//    estimate after customer request by email"
//
// inbox-sync reads the info@ mailbox every 15 minutes. It used to keep only
// mail from addresses it already knew (the CRM's spam wall) and hand the
// assistant only the emails matching the open estimate's address. Everything
// else - a customer writing from a second address, a building manager, a
// supplier, a new lead with no ref - was invisible to it.
//
// This is the assistant's own copy of the inbox, in the "inbox" Blobs store:
//
//   index          one small record: the newest INDEX_MAX emails, one line
//                  each (who, when, subject, a snippet, which estimate it is
//                  about, what kind of mail it is). Read on every question.
//   m-<hash>       one record per email with its full text, read only when
//                  the assistant needs that email's words.
//
// MATCHING. An email is tied to an estimate by, in order: a ref in its text
// (subject, body, quoted header card), the sender's address on an estimate,
// the sender's NAME on an estimate ("Rafael Mendez" writing from a new
// address). By-name matches are for the assistant's eyes: they are never
// written onto the customer's thread, because a name is not proof.
//
// KINDS. "customer" (tied to an estimate or a known address), "notification"
// (no-reply, newsletters, receipts, the platforms we use), "other" (a human
// we do not know yet: a new lead, a manager, a supplier). The assistant sees
// customer and other; notifications are kept but out of the prompt.
//
// The CRM log (Supabase lead_messages) and the estimate threads are NOT
// changed by this file. It is additive: one more place the same mail lives.

"use strict";

const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");
const thread = require("./thread");

const INDEX_MAX = 400;
const SNIPPET_CHARS = 220;
const TEXT_CHARS = 6000;

const NOISE_RE = /no-?reply|do-?not-?reply|notification|notifications|newsletter|mailer-daemon|postmaster|@accounts\.|@mail\.|@email\.|@info\.|@news\.|@marketing\.|@updates?\.|@alerts?\.|@doordash|@uber|@alibaba|@amazon|@apple\.com|@facebook|@instagram|@linkedin|@paypal|@stripe|@intuit|@quickbooks|@verizon|@google\.com|@youtube|@resend\.|@netlify\.|@cloudflare\.|@supabase|@github|@anthropic|@openai/i;

function str(v) { return String(v == null ? "" : v).trim(); }
function norm(s) { return str(s).toLowerCase(); }
function nameKey(s) { return norm(s).replace(/[^a-zÀ-ɏ\s]/g, " ").replace(/\s+/g, " ").trim(); }

function store() {
  return getStore({ name: "inbox", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
}

/* A message id is "<...@...>" with any character in it; the blob key is a hash of it. */
function keyFor(messageId) {
  return "m-" + crypto.createHash("sha1").update(str(messageId)).digest("hex").slice(0, 32);
}

function kindOf(fromAddr, matched) {
  if (matched) return "customer";
  return NOISE_RE.test(norm(fromAddr)) ? "notification" : "other";
}

function snippet(text) {
  return str(text).replace(/\s+/g, " ").slice(0, SNIPPET_CHARS);
}

/* ── MATCHING ─────────────────────────────────────────────────────────────
   customers: [{ ref, status, updatedAt, sentAt, submittedAt, name, email }]
   Returns { ref, by } with by in "ref" | "email" | "name", or { ref: "", by: "" }. */
function matchEstimate(mail, customers) {
  const m = mail || {};
  const list = Array.isArray(customers) ? customers : [];
  const ref = thread.refFromText(m.subject, m.text, m.raw);
  if (ref && list.some(function (c) { return c && str(c.ref).toUpperCase() === ref; })) return { ref: ref, by: "ref" };
  if (ref) return { ref: ref, by: "ref" };
  const addr = norm(m.from);
  if (addr) {
    const byAddr = list.filter(function (c) { return c && norm(c.email) === addr; });
    const pick = thread.pickEstimateForEmail(byAddr);
    if (pick) return { ref: pick, by: "email" };
  }
  const nk = nameKey(m.name);
  if (nk && nk.length >= 5 && nk.indexOf(" ") !== -1) {
    const byName = list.filter(function (c) { return c && sameName(nk, nameKey(c.name)); });
    const pick = thread.pickEstimateForEmail(byName);
    if (pick) return { ref: pick, by: "name" };
  }
  return { ref: "", by: "" };
}

/* "rafael mendez" = "Mendez, Rafael" = "rafael mendez jr": two names in
   common, in any order. One-word names never match: a "Jan" is anyone. */
function sameName(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const ta = a.split(" ").filter(function (t) { return t.length > 1; });
  const tb = b.split(" ").filter(function (t) { return t.length > 1; });
  if (ta.length < 2 || tb.length < 2) return false;
  const shared = ta.filter(function (t) { return tb.indexOf(t) !== -1; });
  return shared.length >= 2;
}

/* ── WRITING ──────────────────────────────────────────────────────────────
   One mail in: its record written, the index updated IN MEMORY. `mail`:
   { id, from, name, to, subject, text, raw, at }. `match`: from
   matchEstimate. `idx`: from loadIndex(), mutated; the caller writes it once
   at the end with saveIndex(idx) - a sync files a dozen mails in a run and
   one index write beats a dozen. Returns the index line written. */
async function saveMail(mail, match, known, idx) {
  const m = mail || {};
  const id = str(m.id);
  if (!id) return null;
  const s = store();
  const mt = match || { ref: "", by: "" };
  const matched = !!mt.ref || !!known;
  const line = {
    id: id, key: keyFor(id), at: str(m.at) || new Date().toISOString(),
    from: norm(m.from), name: str(m.name).slice(0, 120), subject: str(m.subject).slice(0, 200),
    snippet: snippet(m.text), ref: str(mt.ref), by: str(mt.by), kind: kindOf(m.from, matched),
  };
  await s.set(line.key, JSON.stringify({
    id: id, at: line.at, from: line.from, name: line.name, to: str(m.to).slice(0, 200), subject: line.subject,
    text: str(m.text).slice(0, TEXT_CHARS), ref: line.ref, by: line.by, kind: line.kind,
  }));
  if (idx && Array.isArray(idx.items)) {
    idx.items = idx.items.filter(function (x) { return x && x.id !== id; });
    idx.items.push(line);
    idx.items.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
    idx.items = idx.items.slice(0, INDEX_MAX);
    idx.dirty = true;
  }
  return line;
}

async function saveIndex(idx) {
  if (!idx || !Array.isArray(idx.items)) return;
  await store().set("index", JSON.stringify({ updatedAt: new Date().toISOString(), items: idx.items.slice(0, INDEX_MAX) }));
  idx.dirty = false;
}

async function loadIndex() {
  const v = await store().get("index", { type: "json" });
  const items = v && Array.isArray(v.items) ? v.items.filter(function (x) { return x && x.id && x.key; }) : [];
  return { updatedAt: v && v.updatedAt ? v.updatedAt : "", items: items };
}

async function loadMail(key) {
  const k = str(key);
  if (!/^m-[0-9a-f]{32}$/.test(k)) return null;
  return store().get(k, { type: "json" });
}

/* Which ids are already stored - so a sync downloads only what is new. */
function knownIds(index) {
  const s = new Set();
  ((index && index.items) || []).forEach(function (x) { if (x && x.id) s.add(x.id); });
  return s;
}

/* ── WHAT THE ASSISTANT IS SHOWN ──────────────────────────────────────────
   The newest `limit` non-notification emails as one line each. */
function indexLines(index, limit) {
  const items = ((index && index.items) || []).filter(function (x) { return x.kind !== "notification"; }).slice(0, limit || 25);
  return items.map(function (x) {
    return "  " + str(x.at).slice(0, 10) + " | " + (x.name ? x.name + " <" + x.from + ">" : x.from) + " | " + (x.subject || "(no subject)") +
      (x.ref ? " | about " + x.ref : "") + (x.kind === "other" ? " | not a customer we know" : "") + (x.snippet ? " | " + x.snippet.slice(0, 140) : "");
  });
}

/* Emails whose words the question uses: names, subject words, addresses.
   A tiny retrieval: score by overlap with the question's tokens. */
const STOP = new Set(["the", "and", "for", "you", "what", "did", "was", "were", "can", "could", "find", "found", "emails", "email", "mail", "from", "send", "sent", "sends", "his", "her", "their", "last", "latest", "about", "with", "that", "this", "they", "them", "does", "have", "has", "any", "please", "check", "read", "look", "again", "new", "one", "ask", "asked", "wrote", "write", "writes", "said", "say", "tell", "told", "want", "wants", "need", "needs", "requirement", "requirements", "customer", "customers", "estimate"]);
function questionTokens(q) {
  return nameKey(q).split(" ").filter(function (t) { return t.length >= 3 && !STOP.has(t); });
}
function pickRelevant(index, question, ref, limit) {
  const toks = questionTokens(question);
  const items = ((index && index.items) || []).filter(function (x) { return x.kind !== "notification"; });
  const scored = items.map(function (x) {
    let score = 0;
    if (ref && x.ref === ref) score += 3;
    const hay = nameKey(x.name + " " + x.from.replace(/[@.]/g, " ") + " " + x.subject + " " + x.snippet);
    toks.forEach(function (t) { if (hay.indexOf(t) !== -1) score += 2; });
    return { x: x, score: score };
  }).filter(function (s) { return s.score > 0; });
  scored.sort(function (a, b) { return b.score - a.score || (a.x.at < b.x.at ? 1 : -1); });
  return scored.slice(0, limit || 3).map(function (s) { return s.x; });
}

module.exports = { store, keyFor, kindOf, snippet, matchEstimate, sameName, nameKey, saveMail, saveIndex, loadIndex, loadMail, knownIds, indexLines, pickRelevant, questionTokens, INDEX_MAX, TEXT_CHARS };
