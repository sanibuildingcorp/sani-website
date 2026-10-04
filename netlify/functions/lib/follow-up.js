// netlify/functions/lib/follow-up.js
//
// A SHORT REMINDER WHEN A SENT ESTIMATE HEARS NOTHING BACK.
//
//   Perplexity's list: "Auto follow-ups: day 2, day 5, day 10 if not opened /
//   approved." -> "1-2": day 2, 5 and 10; on for every sent estimate, a
//   switch to turn it off per job.
//
// The rules, with no network (follow-ups-background sends):
//   - only an estimate that was SENT, still "sent" or "opened";
//   - never once the customer approved, declined, asked for changes, wrote
//     back (thread or email), or he switched it off for the job;
//   - day 2, 5 and 10 after the send, one email per run, at least two days
//     apart, then it stops;
//   - sent again (a new version) starts the count again from that send;
//   - only estimates sent after the feature started, so the old quotes in
//     the dashboard do not all get an email the first morning.
// No price in the email: the link shows the estimate.

"use strict";

const DAYS = [2, 5, 10];
const DAY_MS = 24 * 3600 * 1000;
const MIN_GAP_MS = 2 * DAY_MS - 3600 * 1000;
/* The day this started. Estimates sent before it never get a follow-up. */
const SINCE = "2026-10-04T00:00:00Z";
const ACTIVE = ["sent", "opened"];

function str(v) { return String(v == null ? "" : v).trim(); }
function arr(v) { return Array.isArray(v) ? v : []; }
function t(iso) { const n = Date.parse(iso || ""); return Number.isFinite(n) ? n : NaN; }

/* The follow-ups already sent for THIS send. */
function sentFor(record) {
  return arr(record && record.followUps).filter(function (f) { return f && f.basis === str(record.sentAt); });
}

/* Why this record gets no follow-up now, or "" when one is due. */
function blocked(record, now) {
  const r = record || {};
  const sentAt = t(r.sentAt);
  if (r.followUpOff === true) return "switched off";
  if (!Number.isFinite(sentAt)) return "never sent";
  if (sentAt < t(SINCE)) return "sent before follow-ups started";
  if (ACTIVE.indexOf(str(r.status)) === -1) return "status " + (str(r.status) || "none");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str((r.customer || {}).email))) return "no customer email";
  const after = function (iso) { return Number.isFinite(t(iso)) && t(iso) > sentAt; };
  if (after(r.acceptedAt) || after(r.declinedAt)) return "customer answered";
  if (after(r.lastCustomerMessageAt)) return "customer wrote back";
  if (arr(r.thread).some(function (m) { return m && str(m.from) === "customer" && after(m.at); })) return "customer wrote back";
  return "";
}

/* The step due now (1, 2 or 3), or 0. */
function due(record, now) {
  const r = record || {};
  const nowMs = Number.isFinite(t(now)) ? t(now) : (typeof now === "number" ? now : Date.now());
  if (blocked(r, nowMs)) return 0;
  const done = sentFor(r);
  if (done.length >= DAYS.length) return 0;
  const sentAt = t(r.sentAt);
  if (nowMs - sentAt < DAYS[done.length] * DAY_MS) return 0;
  const last = done.length ? t(done[done.length - 1].at) : NaN;
  if (Number.isFinite(last) && nowMs - last < MIN_GAP_MS) return 0;
  return done.length + 1;
}

function firstName(record) { return (str(((record || {}).customer || {}).name).split(/\s+/)[0]) || "there"; }
function title(record) { const e = (record && record.estimate) || {}, q = (record && record.request) || {}; return str(e.projectTitle) || str(q.service) || "your project"; }

/* The email for one step. Plain, short, from Zurabi; no price. */
function message(record, step, quoteUrl) {
  const name = firstName(record), what = title(record);
  const bodies = {
    1: ["Hi " + name + ",", "Just checking that you received our estimate for " + what + ". If anything is unclear, or you would like something changed, reply to this email and we will adjust it."],
    2: ["Hi " + name + ",", "Do you have any questions about the estimate for " + what + "? We are happy to go through it with you by phone, or change the scope to fit what you need."],
    3: ["Hi " + name + ",", "This is our last reminder about the estimate for " + what + ". It stays open - whenever you are ready, you can approve it online or simply reply to this email."],
  };
  const lines = bodies[step] || bodies[1];
  const subject = step === 3 ? "Your estimate is still open - " + what : step === 2 ? "Any questions about your estimate? - " + what : "Did you get our estimate? - " + what;
  const sign = ["Zurabi", "Sani Building Corp", "(332) 277-0990"];
  const text = lines.join("\n\n") + "\n\nView your estimate: " + quoteUrl + "\n\n" + sign.join("\n");
  const esc = function (s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };
  const html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a2433;max-width:560px">' +
    lines.map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("") +
    '<p><a href="' + esc(quoteUrl) + '" style="display:inline-block;background:#c8860a;color:#fff;text-decoration:none;font-weight:bold;padding:12px 26px;border-radius:8px">View your estimate &rarr;</a></p>' +
    "<p>" + sign.map(esc).join("<br>") + "</p></div>";
  return { subject: subject, text: text, html: html };
}

/* What the dashboard shows: "1 of 3 sent", "off", "stopped - customer answered". */
function summary(record, now) {
  const r = record || {};
  const done = sentFor(r).length;
  if (r.followUpOff === true) return { state: "off", sent: done, total: DAYS.length };
  const why = blocked(r, now == null ? Date.now() : now);
  if (why === "never sent" || why === "sent before follow-ups started") return { state: "none", sent: 0, total: DAYS.length, why: why };
  if (why) return { state: "stopped", sent: done, total: DAYS.length, why: why };
  if (done >= DAYS.length) return { state: "done", sent: done, total: DAYS.length };
  return { state: "on", sent: done, total: DAYS.length, nextDay: DAYS[done] };
}

module.exports = { DAYS, SINCE, due, blocked, sentFor, message, summary };
