// netlify/functions/lib/join-lines.js
//
// ONE LINE FOR ONE PIECE OF WORK.
//
//   "There is a so many double times with different prices" - "Bag debris and
//   carry out" at 0.77 hrs and again at 2.23 hrs, both on the Bathroom card.
//
// attributeSharedLines (generate-estimate-background.js) splits shared work
// (protection, debris, cleanup) across the services by labor weight. When the
// pieces land on the SAME card they read as the same line twice at two prices.
// Lines with the same card, words, unit and rate are joined back into one:
// quantities add up, the rate stays, so the money is exactly the same.
// dashboard.html carries the same function (joinSameLines) for estimates
// already saved.

"use strict";

function key(l) {
  const t = (v) => String(v == null ? "" : v).trim().toLowerCase().replace(/\s+/g, " ");
  return [t(l.section), t(l.item), t(l.unit), String(Number(l.rate) || 0)].join("|");
}

function joinSameLines(lines) {
  if (!Array.isArray(lines)) return lines;
  const out = [], at = {};
  lines.forEach(function (l) {
    if (!l || typeof l !== "object" || !String(l.item || "").trim()) { out.push(l); return; }
    const k = key(l);
    if (at[k] === undefined) { at[k] = out.length; out.push(Object.assign({}, l)); return; }
    const first = out[at[k]];
    first.qty = Math.round(((Number(first.qty) || 0) + (Number(l.qty) || 0)) * 10000) / 10000;
  });
  return out;
}

function joinEstimateLines(est) {
  if (!est || typeof est !== "object") return est;
  if (Array.isArray(est.labor)) est.labor = joinSameLines(est.labor);
  if (Array.isArray(est.materials)) est.materials = joinSameLines(est.materials);
  return est;
}

module.exports = { joinSameLines, joinEstimateLines };
