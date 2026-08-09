// netlify/functions/lib/thread.js
//
// THE CONVERSATION, AS A RECORD.
//
// One append-only list per estimate, living on the estimate record in Netlify
// Blobs alongside the price it is about. Nothing in here ever deletes, edits or
// reorders a message: if there is ever an argument about what was agreed, this
// list is the answer, and a list that can be rewritten is not evidence.
//
// WHY BLOBS AND NOT lead_messages
//
//   1. quote.html loads no external JavaScript, by design - it is the one page
//      that must render for a customer no matter what. A Supabase-backed thread
//      would need either a key in page JS (this repo is public; page JS is served
//      to every visitor) or a second serverless call on the critical path. The
//      thread being on the record means get-estimate already returns it, in the
//      call the page already makes.
//   2. lead_messages is keyed by EMAIL ADDRESS. A customer with two jobs would
//      see both jobs' messages in one thread - which is exactly the "which job is
//      this?" problem the portal exists to solve. There is no ref column, and
//      adding one would not retro-key the history.
//   3. get-estimate is already gated by ref, so "a customer never sees another
//      customer's thread" is inherited rather than re-implemented.
//   4. One object, one write. A thread stored apart from the estimate is a join
//      that can half-fail, and half of a dispute record is worse than none.
//
// The cost is that a reply Zura types in the Gmail app does not arrive here by
// itself. inbox-sync.js bridges it - see refFromText() below.
//
// IDENTITY, NEVER WORDING. Every message carries an id. A Gmail-ingested message
// uses its RFC Message-ID. Dedupe compares ids and nothing else, because "Thanks,
// sounds good" is a message a customer sends twice in a week and both times
// meant it.

"use strict";

/* A customer typing on a phone does not need 8,000 characters, and this endpoint
   is public. Long enough for a real question, short enough that a thread cannot
   be used to inflate a blob. */
const MAX_MESSAGE_CHARS = 4000;

/* An append-only list still needs a ceiling or a script can grow one record
   without limit. 400 is far past any real job's correspondence. */
const MAX_MESSAGES = 400;

/* Public endpoint: a burst limit per record. Not a substitute for the auth work
   still outstanding on quote-response - it is the floor under it. */
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_IN_WINDOW = 12;

const REF_RE = /\bSBC-\d{6}-[A-Z0-9]{4}\b/i;

function text(v) {
  return String(v == null ? "" : v).trim();
}

function isoOr(v, fallback) {
  const d = new Date(v);
  return isFinite(d.getTime()) ? d.toISOString() : fallback;
}

/**
 * Every reader must call this first. It returns the thread as an array and
 * migrates the old single-string field into it.
 *
 * record.customerQuestion was one string, overwritten on every question, so a
 * second question destroyed the first. Records written before the thread existed
 * still hold one - it becomes message zero rather than disappearing. The old
 * field is deliberately NOT deleted here: nothing may drop it until every read
 * path for it is gone.
 *
 * Pure. Does not mutate the record.
 */
function normalizeThread(record) {
  const rec = record || {};
  const raw = Array.isArray(rec.thread) ? rec.thread : [];
  const out = [];
  const seen = new Set();

  raw.forEach(function (m, i) {
    if (!m || typeof m !== "object") return;
    const body = text(m.text);
    if (!body) return;
    const id = text(m.id) || "legacy-" + i;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      id: id,
      from: m.from === "contractor" ? "contractor" : "customer",
      text: body.slice(0, MAX_MESSAGE_CHARS),
      at: isoOr(m.at, new Date(0).toISOString()),
      via: text(m.via) || "quote",
      subject: text(m.subject).slice(0, 300) || undefined,
    });
  });

  // Migration: the pre-thread question, if it is not already in the list.
  const legacy = text(rec.customerQuestion);
  if (legacy && !out.some(function (m) { return m.from === "customer" && m.text === legacy.slice(0, MAX_MESSAGE_CHARS); })) {
    out.push({
      id: "legacy-customerQuestion",
      from: "customer",
      text: legacy.slice(0, MAX_MESSAGE_CHARS),
      at: isoOr(rec.questionAskedAt, isoOr(rec.updatedAt, new Date(0).toISOString())),
      via: "quote",
    });
  }

  /* Oldest first, always. A stable tiebreak on id keeps two messages stamped in
     the same second from swapping places between renders. */
  out.sort(function (a, b) {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
  return out;
}

/**
 * Append one message. Returns { thread, message, added, reason }.
 * `added:false` with a reason is a normal outcome, not an error - a Gmail sync
 * re-reading the same mail must be a no-op, not a duplicate.
 */
function appendMessage(record, input) {
  const thread = normalizeThread(record);
  const body = text(input && input.text);

  if (!body) return { thread: thread, message: null, added: false, reason: "empty" };
  if (thread.length >= MAX_MESSAGES) {
    return { thread: thread, message: null, added: false, reason: "thread_full" };
  }

  const id = text(input && input.id) || makeId(input && input.from);
  if (thread.some(function (m) { return m.id === id; })) {
    return { thread: thread, message: null, added: false, reason: "duplicate" };
  }

  const message = {
    id: id,
    from: (input && input.from) === "contractor" ? "contractor" : "customer",
    text: body.slice(0, MAX_MESSAGE_CHARS),
    at: isoOr(input && input.at, new Date().toISOString()),
    via: text(input && input.via) || "quote",
  };
  const subject = text(input && input.subject).slice(0, 300);
  if (subject) message.subject = subject;

  thread.push(message);
  thread.sort(function (a, b) {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
  return { thread: thread, message: message, added: true, reason: "" };
}

/* Not crypto. It only has to be unique enough that two messages posted in the
   same second do not collide, and Math.random is fine for that. */
function makeId(from) {
  return (from === "contractor" ? "c" : "q") + "-" +
    Date.now().toString(36) + "-" +
    Math.random().toString(36).slice(2, 8);
}

/**
 * Burst limit for the public endpoint, counted on the record itself so it works
 * without any shared store. Returns { allowed, state }. The caller must persist
 * `state` back onto the record.
 */
function checkRate(record, now) {
  const t = Number(now) || Date.now();
  const prev = (record && record.threadRate) || {};
  const start = Number(prev.windowStart) || 0;
  const count = Number(prev.count) || 0;

  if (!start || t - start > RATE_WINDOW_MS) {
    return { allowed: true, state: { windowStart: t, count: 1 } };
  }
  if (count >= RATE_MAX_IN_WINDOW) {
    return { allowed: false, state: { windowStart: start, count: count } };
  }
  return { allowed: true, state: { windowStart: start, count: count + 1 } };
}

/**
 * Pull an estimate ref out of a subject line or a quoted email body.
 *
 * This is the whole Gmail bridge. Outbound message emails put the ref in the
 * subject - "Re: SBC-260809-VUUI — Three Interior Staircases" - and Gmail keeps
 * the subject on reply, so a reply typed in the phone's Gmail app still names
 * the job. If the subject has been rewritten, the quoted original underneath
 * usually still carries it.
 *
 * Honest limit: a customer who starts a brand new email with no ref anywhere
 * cannot be matched. That message still reaches lead_messages and the dashboard
 * inbox; it just does not appear on the portal. Which is why the dashboard reply
 * box is the primary path and this is the fallback.
 */
function refFromText() {
  for (let i = 0; i < arguments.length; i++) {
    const m = REF_RE.exec(String(arguments[i] == null ? "" : arguments[i]));
    if (m) return m[0].toUpperCase();
  }
  return "";
}

/** Who spoke last - drives the dashboard's needs-reply badge. */
function needsReply(record) {
  const thread = normalizeThread(record);
  if (!thread.length) return false;
  return thread[thread.length - 1].from === "customer";
}

module.exports = {
  normalizeThread: normalizeThread,
  appendMessage: appendMessage,
  checkRate: checkRate,
  refFromText: refFromText,
  needsReply: needsReply,
  MAX_MESSAGE_CHARS: MAX_MESSAGE_CHARS,
  MAX_MESSAGES: MAX_MESSAGES,
  RATE_WINDOW_MS: RATE_WINDOW_MS,
  RATE_MAX_IN_WINDOW: RATE_MAX_IN_WINDOW,
};
