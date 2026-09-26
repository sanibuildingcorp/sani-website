// netlify/functions/lib/job-emails.js
//
// THE EMAILS THAT BELONG TO ONE JOB, IN FULL.
//
//   "I shared attached pdf plan to the ChatGPT ... i asked ChatGPT for
//    description for my dashboard ai estimate generator"
//
// On 409 Suydam St the description was a rewrite of three emails - and the
// rewrite added what the customer never asked for (4-foot wainscot, an
// add-alternate, "plumbing fixtures by others") while the estimate never
// answered what she did ask (identify extra prep, identify owner-supplied
// items, earliest start). The customer's own words are the source. This
// finds them in his inbox (lib/inbox-store.js, synced every 15 minutes) and
// hands them - oldest first, in full - to the generator and to the
// estimator chat.
//
// An email belongs to the job when the inbox tied it to this estimate (by
// ref, by the customer's address, by the customer's name), or when its
// subject or opening names the job's street address ("409 Suydam St - Bid
// Request" from the general contractor, who is not the customer on the
// record). Notifications never. Capped: MAX_EMAILS emails, each cut at
// EMAIL_CHARS, and TOTAL_CHARS in all, newest kept when the cap bites.

"use strict";

const inbox = require("./inbox-store");

const MAX_EMAILS = 8;
const EMAIL_CHARS = 3500;
const TOTAL_CHARS = 16000;

function str(v) { return String(v == null ? "" : v).trim(); }

/* "409 Suydam street, Brooklyn" -> "409 suydam": the house number and the
   first word of the street, the part every email about the job repeats. */
function streetKey(address) {
  const m = /(\d+[a-z]?)\s+(?:(?:north|south|east|west|n|s|e|w)\.?\s+)?([a-z]{3,})/i.exec(str(address));
  return m ? (m[1] + " " + m[2]).toLowerCase() : "";
}

function mentions(line, key) {
  if (!key) return false;
  const hay = (str(line.subject) + " " + str(line.snippet)).toLowerCase().replace(/\s+/g, " ");
  return hay.indexOf(key) !== -1;
}

/**
 * The index lines of the emails that belong to this record, oldest first.
 * @param {object} index  inbox.loadIndex()
 * @param {object} record the estimate record
 */
function pickJobEmails(index, record) {
  const r = record || {};
  const ref = str(r.ref);
  const key = streetKey(str(r.customer && r.customer.address) || str(r.request && r.request.address));
  const items = ((index && index.items) || []).filter(function (x) {
    if (!x || x.kind === "notification") return false;
    return (ref && x.ref === ref) || mentions(x, key);
  });
  items.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
  return items.slice(0, MAX_EMAILS).reverse();
}

/**
 * The job's emails in full: [{ id, at, from, name, subject, text }], oldest
 * first, within the caps. Never throws: a missing store gives [].
 * @param {object} record
 * @param {object} [io] { loadIndex, loadMail } - for tests
 */
async function jobEmails(record, io) {
  const load = (io && io.loadIndex) || inbox.loadIndex;
  const mail = (io && io.loadMail) || inbox.loadMail;
  try {
    const picked = pickJobEmails(await load(), record);
    const full = await Promise.all(picked.map(function (x) { return mail(x.key).catch(function () { return null; }); }));
    const out = [];
    let budget = TOTAL_CHARS;
    /* newest first while counting, so the latest word always fits */
    for (let i = full.length - 1; i >= 0; i--) {
      const m = full[i];
      if (!m || !str(m.text)) continue;
      const text = str(m.text).slice(0, Math.min(EMAIL_CHARS, budget));
      if (!text) break;
      budget -= text.length;
      out.unshift({ id: str(m.id || picked[i].id), at: str(m.at).slice(0, 16), from: str(m.from), name: str(m.name), subject: str(m.subject), text: text });
    }
    return out;
  } catch (e) { return []; }
}

/* The emails as a block of text, for a prompt. */
function emailsText(list) {
  return (list || []).map(function (e) {
    return "--- " + str(e.at).replace("T", " ") + " | " + (e.name ? e.name + " <" + e.from + ">" : e.from) + " | " + (e.subject || "(no subject)") + "\n" + str(e.text);
  }).join("\n\n");
}

module.exports = { jobEmails, pickJobEmails, emailsText, streetKey, MAX_EMAILS, EMAIL_CHARS, TOTAL_CHARS };
