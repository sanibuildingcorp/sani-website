// netlify/functions/lib/scope-text.js
//
// ONE SCOPE OF WORK. The dashboard's "Scope of Work" box, the contract
// generator and the assistant all read estimate.scopeOfWork; the customer
// reads the service cards (serviceBreakdown[].included). They used to be two
// different texts: the box held the analyst's raw scope blocks and the price
// lines, twice over ("BATHROOM:" then "BATHROOM — DEMOLITION:", "BATHROOM —
// WATERPROOFING:" ...), while the customer saw the scope writer's eight
// sentences. Zura read both and could not tell which one was the estimate.
//
//   "Look whats shows customer side and whats shows in my dashboard ... if i
//    have that too much read and think for every estimate then i will write
//    by hand, why i need this estimate system?"
//
// Now the text is built from the cards, and only from the cards, every time
// the cards are written: one header per service, one bullet per line the
// customer reads. Nothing here touches a price.

"use strict";

function str(v) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim(); }

function lineText(x) { return str(typeof x === "string" ? x : (x && (x.item || x.text))); }

/* "BATHROOM:\n• line\n• line\n\nPAINTING:\n• line" - the same shape the
   dashboard box always used, and the one add-service already writes. */
function scopeTextFromCards(estimate) {
  const cards = Array.isArray(estimate && estimate.serviceBreakdown) ? estimate.serviceBreakdown : [];
  return cards.map(function (c) {
    const title = str(c && (c.title || c.name || c.section)) || "Service";
    const lines = (Array.isArray(c && c.included) ? c.included : []).map(lineText).filter(Boolean);
    if (!lines.length) return "";
    return title.toUpperCase() + ":\n" + lines.map(function (l) { return "• " + l; }).join("\n");
  }).filter(Boolean).join("\n\n");
}

/* Is the box still a mirror of the cards, or did the contractor write his own
   text into it? A hand-written scope is left alone by every later card edit. */
function mirrorsCards(estimate) {
  const text = str(estimate && estimate.scopeOfWork);
  if (!text) return true;
  return text.toLowerCase() === str(scopeTextFromCards(estimate)).toLowerCase();
}

/* Write the cards into the box. When the cards say nothing the box is left as
   it was, so an empty writer result can never blank a scope. */
function syncScopeText(estimate) {
  if (!estimate) return estimate;
  const text = scopeTextFromCards(estimate);
  if (text) estimate.scopeOfWork = text;
  return estimate;
}

module.exports = { scopeTextFromCards, mirrorsCards, syncScopeText };
