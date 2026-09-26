// netlify/functions/lib/customer-voice.js
//
// HOW EVERY SENTENCE THE CUSTOMER READS IS WRITTEN.
//
//   "do not use like ( ooo this need protection, ohh this need building
//    approves, ohh it's need time, and always feels hard and scary, don't
//    write long explanations as it is in the timeline! ). I need softness
//    headers and softness timelines, none of the building management
//    approvals required 2-3 weeks! It maximum 1 week and always they
//    approve less then 1 week. Don't write down difficulty texts! Quick
//    understandable simple and easy!"
//
// Two halves. VOICE is the rule block every customer-facing prompt carries
// (the estimator's summary and timeline, the scope writer's lines and
// timeline, the contract's timeline). softenTimeline / softenText are the
// deterministic backstop applied to what comes back: an approval that "takes
// 1-2 weeks" or "2-3 weeks" becomes "under a week", and a timeline longer
// than two sentences is cut to its first two. Nothing here touches a price.

"use strict";

function str(v) { return String(v == null ? "" : v).trim(); }

const VOICE = [
  "CUSTOMER VOICE - every sentence the customer reads:",
  "- Short, calm, plain. One idea per sentence, under 18 words. Say what we do, not what could go wrong.",
  "- Headers are two or three plain words: Bathroom, Painting, Shower glass. Not 'General conditions & co-op building compliance'.",
  "- The summary is two short sentences. The timeline is one or two: how long the work takes once it starts, and, only if the building must approve, 'building approval usually takes under a week'.",
  "- Building or board approval NEVER takes 1-2 weeks, 2-3 weeks or longer in anything the customer reads: it takes under a week. Do not describe the approval paperwork.",
  "- No difficulty, no danger, no warnings, no scolding: never 'strict', 'must', 'required by the building', 'risk', 'hazard', 'complex', 'challenging', 'compliance', 'coordination', 'per the alteration agreement', 'subject to'. Protection and cleanup are one plain line each, not a paragraph.",
  "- No long explanations. If a sentence explains why, cut it.",
  /* "i need more human language and easy for understanding for me and for customers" */
  "- Human words a homeowner uses, like a person talking, warm and polite. No trade shorthand: 'measure', not 'field-measure'; 'final price', not 'firm proposal'; 'visit', not 'walkthrough'; 'shower floor built on site' / 'ready-made shower base', not 'site-built pan' / 'manufactured base'; 'cement board', not 'CBU'. If a trade word is needed, say what it is in a few words. No abbreviations (sf, LF, GC, TBD, w/, approx.): write them out.",
  "- Product names stay exact (brand, model, size) - the words around them are plain. Dates in words: 'October 14', never '2026-10-14'.",
].join("\n");

/* approval words: a sentence about approval is where a long wait is rewritten */
const APPROVAL = /\b(approv|board|co-?op|management|managing agent|alteration|permit|building)\b/i;
/* "1-2 weeks", "2 to 3 weeks", "two to three weeks", "10 business days", "14 days" */
const DURATION = /\b((?:\d+|one|two|three|four|five|six)\s*(?:-|–|—|to)\s*)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|fourteen|twenty)\s*(business\s+|working\s+)?(weeks?|days?)\b/gi;
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fourteen: 14, twenty: 20 };
function num(v) { const s = str(v).toLowerCase(); return WORDS[s] != null ? WORDS[s] : Number(s); }

/* the longest wait a customer reads for an approval: under a week */
function softenApproval(sentence) {
  if (!APPROVAL.test(sentence)) return sentence;
  return sentence.replace(DURATION, function (m, range, n, business, unit) {
    const count = num(n);
    const days = /week/i.test(unit) ? count * 7 : count;
    if (!(days > 7)) return m;
    return "under a week";
  });
}

function sentences(text) {
  return str(text).split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).filter(Boolean);
}

/* Any customer-facing text: the approval rule, sentence by sentence. */
function softenText(text) {
  const t = str(text);
  if (!t) return t;
  return sentences(t).map(softenApproval).join(" ");
}

/* The timeline: the approval rule, then at most two sentences. */
function softenTimeline(text) {
  const t = str(text);
  if (!t) return t;
  const parts = sentences(t).map(softenApproval);
  return parts.slice(0, 2).join(" ");
}

function softenLines(list) {
  return Array.isArray(list) ? list.map(function (x) { return typeof x === "string" ? softenText(x) : x; }) : list;
}

module.exports = { VOICE, softenText, softenTimeline, softenLines, softenApproval };
