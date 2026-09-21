// netlify/functions/lib/scope-dedupe.js
//
// REPEATED LINES OUT OF A SCOPE OF WORK. ONE PASS, EVERY COPY.
//
//   "this is a text what i ask to my ai to check if there is duplicate
//    services, or texts and remove all duplicated but he don't do it"
//
// The generated scope carried "Site setup", "Building common-area
// protection", "Project coordination" and "Building coordination" under
// every one of eight headings, the three protection-material lines under
// five, the plumbing work under BATHROOM and again under PLUMBING. Asking
// the assistant to remove them one reword at a time meant forty edits,
// each quoted exactly; it could not, and said so at length.
//
// This is the mechanical job, done mechanically:
//
//   dedupeScope(record) -> { changed, count, lines: [{text, count}],
//                            removed: [{where, section, text}], similar }
//
//   - a bullet that already appeared, in any earlier section or card, with
//     the same words (lib/reword loose: dashes, quotes, case, spacing and
//     end punctuation forgiven), is dropped; the first stays where it is;
//   - in the scope text, a heading left with no bullets goes with them;
//   - the same rule runs over the estimator's cards, the published customer
//     scope, the private draft and the scope sections, each list type
//     (included / supplied / excluded) on its own, so no copy disagrees;
//   - `similar` lists pairs that say the same work in different words (one
//     line's words nearly all inside another's) for a reword to merge -
//     never removed here, because that is a judgement;
//   - money is fingerprinted before and after; a difference throws.

"use strict";

const { loose, moneyFingerprint } = require("./reword");

function str(v) { return String(v == null ? "" : v).trim(); }
function arr(v) { return Array.isArray(v) ? v : []; }
function lineText(x) { return typeof x === "string" ? x : str(x && (x.text || x.item || x.label || x.name)); }

const BULLET = /^\s*[•\-–—*·]\s*/;
const CARD_KEYS = {
  breakdown: { included: ["included", "items", "scope"], supplied: ["customerSupplies", "customerSupplied", "supplied"], excluded: ["notIncluded", "exclusions", "excluded"] },
  published: { included: ["included"], supplied: ["supplied", "customerSupplies"], excluded: ["excluded", "notIncluded"] },
  sections: { included: ["items"] },
};

function dedupeList(list, seen, where, section, removed) {
  for (let i = 0; i < list.length; i++) {
    const key = loose(lineText(list[i]));
    if (!key) continue;
    if (seen[key]) { removed.push({ where: where, section: section, text: lineText(list[i]) }); list.splice(i, 1); i--; }
    else seen[key] = 1;
  }
}

function dedupeCards(services, keys, removed) {
  const seen = { included: {}, supplied: {}, excluded: {} };
  arr(services).forEach(function (s) {
    if (!s || typeof s !== "object") return;
    const name = str(s.title || s.name || s.service || s.section);
    Object.keys(keys).forEach(function (type) {
      keys[type].forEach(function (k) { if (Array.isArray(s[k])) dedupeList(s[k], seen[type], type, name, removed); });
    });
  });
}

/* "TITLE:\n• line\n• line" blocks separated by blank lines. Prose is kept. */
function dedupeText(text, removed) {
  const src = str(text);
  if (!src) return src;
  const seen = {};
  const out = [];
  src.split(/\n\s*\n/).forEach(function (block) {
    const lines = block.split("\n");
    let title = "", hadBullets = false;
    const keep = [];
    lines.forEach(function (line) {
      if (BULLET.test(line)) {
        hadBullets = true;
        const key = loose(line.replace(BULLET, ""));
        if (key && seen[key]) { removed.push({ where: "scope", section: title, text: str(line.replace(BULLET, "")) }); return; }
        if (key) seen[key] = 1;
        keep.push(line);
      } else {
        if (/:\s*$/.test(line) && str(line)) title = str(line).replace(/:\s*$/, "");
        keep.push(line);
      }
    });
    if (hadBullets && !keep.some(function (l) { return BULLET.test(l); })) return; /* heading with nothing left under it */
    out.push(keep.join("\n"));
  });
  return out.join("\n\n").trim();
}

/* Words of a line for the "same work, different words" check. */
function words(s) {
  const stop = { the: 1, and: 1, for: 1, with: 1, that: 1, this: 1, are: 1, not: 1, from: 1, into: 1, all: 1, any: 1, new: 1, per: 1, its: 1, our: 1, your: 1, will: 1, was: 1, were: 1, has: 1, have: 1, had: 1, than: 1, then: 1, use: 1, provide: 1 };
  const o = {};
  loose(s).replace(/["'.]/g, "").replace(/[^a-z0-9$%]+/g, " ").split(/\s+/).forEach(function (w) { if (w.length > 2 && !stop[w]) o[w] = 1; });
  return Object.keys(o);
}
function containment(a, b) {
  const A = words(a), B = words(b);
  if (A.length < 4 || B.length < 4) return 0;
  const set = {}; B.forEach(function (w) { set[w] = 1; });
  let both = 0; A.forEach(function (w) { if (set[w]) both++; });
  return both / Math.min(A.length, B.length);
}
const SIMILAR = 0.8;
function similarLines(est) {
  const items = [];
  arr(est.serviceBreakdown).forEach(function (s) {
    if (!s) return;
    const name = str(s.title || s.name);
    CARD_KEYS.breakdown.included.forEach(function (k) { arr(s[k]).forEach(function (x) { const t = lineText(x); if (t) items.push({ section: name, text: t }); }); });
  });
  const pairs = [];
  for (let i = 0; i < items.length && pairs.length < 15; i++) {
    for (let j = i + 1; j < items.length && pairs.length < 15; j++) {
      if (loose(items[i].text) === loose(items[j].text)) continue;
      if (containment(items[i].text, items[j].text) >= SIMILAR) pairs.push({ a: items[i].text, aIn: items[i].section, b: items[j].text, bIn: items[j].section });
    }
  }
  return pairs;
}

function dedupeScope(record) {
  if (!record || typeof record !== "object") throw new Error("No record");
  const est = record.estimate || (record.estimate = {});
  const before = moneyFingerprint(record);
  const removed = [];
  dedupeCards(est.serviceBreakdown, CARD_KEYS.breakdown, removed);
  [est.publishedCustomerScope, est.manualCustomerScopeDraft].forEach(function (scope) { if (scope && Array.isArray(scope.services)) dedupeCards(scope.services, CARD_KEYS.published, removed); });
  if (Array.isArray(est.scopeSections)) dedupeCards(est.scopeSections, CARD_KEYS.sections, removed);
  if (str(est.scopeOfWork)) est.scopeOfWork = dedupeText(est.scopeOfWork, removed);
  if (moneyFingerprint(record) !== before) throw new Error("Removing repeated lines would have changed a price. Nothing was saved.");
  /* one entry per distinct line, with how many places it was repeated in */
  const byKey = {}, lines = [];
  removed.forEach(function (r) {
    const k = loose(r.text);
    if (!byKey[k]) { byKey[k] = { text: r.text, count: 0 }; lines.push(byKey[k]); }
    byKey[k].count++;
  });
  return { changed: removed.length > 0, count: lines.length, lines: lines, removed: removed, similar: similarLines(est) };
}

module.exports = { dedupeScope, dedupeText, similarLines, containment };
