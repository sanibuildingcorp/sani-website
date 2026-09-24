// netlify/functions/lib/shared-once.js
//
// SHARED WORK SAID ONCE, ON EVERY SCREEN.
//
//   "This is one project with multiple services ... protection, supervision
//    or other general preparation going for one time for all services and
//    not for separate for each services."
//
// The generator already takes protection, debris, cleanup and coordination
// off the cards and lists them once under "Included for the whole project".
// But a Services draft saved before that change still carried the four stock
// sentences on every card, and the customer page reads the draft - so the
// Astoria estimate showed the whole-project list AND the same four lines on
// all four cards.
//
// This is the one rule, applied where the cards are shown (customer page,
// dashboard Services panel, scope PDF): when the estimate has a whole-project
// list and more than one card, a card line is dropped if it is
//   - one of the four stock shared sentences, or
//   - word for word a line of the whole-project list, or
//   - shared work (protection, cleanup, debris, coordination...) written word
//     for word on two or more cards.
// A card is never emptied by it. One card, or no whole-project list: nothing
// changes. quote.html and dashboard.html carry identical copies (they load no
// modules); js/shared-once.test.js holds all three to the same answers.

"use strict";

const SHARED_STOCK = [
  "Protect your floors, hallways and adjacent finishes before any work starts",
  "Bag, carry out and legally dispose of all construction debris",
  "Clean the space daily and leave it finished, protected and ready to use",
  "Coordinate and supervise every trade, inspection and delivery",
];
const SHARED_RE = /coordinat|supervis|project manage|protect|clean|debris|disposal|haul|dump|punch ?list|mobiliz/i;

function sharedKey(x) { return String(x == null ? "" : x).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function lineText(x) { return String(typeof x === "string" ? x : (x && (x.text || x.item)) || "").trim(); }

/* cards: [{ included: [...] }]. Changes each card's `included` in place and
   returns the same array. */
function sharedOnce(projectIncluded, cards) {
  const proj = (Array.isArray(projectIncluded) ? projectIncluded : []).map(lineText).filter(Boolean);
  if (!proj.length || !Array.isArray(cards) || cards.length < 2) return cards;
  const stock = SHARED_STOCK.map(sharedKey);
  const pk = proj.map(sharedKey);
  const seen = {};
  cards.forEach(function (c) {
    const mine = {};
    (Array.isArray(c && c.included) ? c.included : []).forEach(function (x) { mine[sharedKey(lineText(x))] = true; });
    Object.keys(mine).forEach(function (k) { seen[k] = (seen[k] || 0) + 1; });
  });
  cards.forEach(function (c) {
    if (!c || !Array.isArray(c.included)) return;
    const keep = c.included.filter(function (x) {
      const t = lineText(x), k = sharedKey(t);
      return !(stock.indexOf(k) !== -1 || pk.indexOf(k) !== -1 || (SHARED_RE.test(t) && seen[k] >= 2));
    });
    if (keep.length) c.included = keep;
  });
  return cards;
}

/* ══ EACH POINT ONCE, AND THE BIGGEST CARD FIRST. ═══════════════════════════
     "Not included repeats Customer supplies; the same thing twice; the card
      order changed - fix all 3."
   On top of sharedOnce, per card:
     - "Not included" drops a line that only restates what the customer
       supplies ("You supply the engineered hardwood...", "...are
       owner-supplied") - but only when the card HAS a Customer supplies list,
       so the fact is still on the page;
     - within "Customer supplies" and within "Not included", two lines that
       say the same thing (most of the shorter line's words are in the other)
       become one, the fuller one kept. Included lines are left alone: "two
       coats on the ceilings" and "two coats on the walls" are two jobs.
   bySize puts the biggest price first. keys names the three lists, because
   the customer page, the dashboard draft and the PDF call them differently. */
const SUPPLY_SAY = /\b(you supply|you provide|you will supply|you'll supply|supplied by (you|the (owner|customer|homeowner))|provided by (you|the (owner|customer|homeowner))|(owner|customer|homeowner)[- ](supplied|provided))\b/i;
const IDEA_STOP = /^(the|and|for|with|will|that|this|from|into|your|all|any|are|new|per|its|our|not|included|include|including|about|only|there|their|them|they|each|every|where|when|than|then|also|such|what|which|while|have|has|been|being|were|would|should|could|onto|over|under|other)$/;
function ideaWords(t) {
  const out = new Set();
  String(t == null ? "" : t).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).forEach(function (w) {
    if (w.length < 4 || IDEA_STOP.test(w)) return;
    if (w.length > 5) w = w.replace(/(ing|es|s)$/, ""); else if (w.length > 4) w = w.replace(/s$/, "");
    out.add(w);
  });
  return out;
}
function sameIdea(a, b) {
  if (a.size < 3 || b.size < 3) return false;
  let both = 0;
  a.forEach(function (k) { if (b.has(k)) both++; });
  return both / Math.min(a.size, b.size) >= 0.7;
}
function onceEach(list) {
  const kept = [], sets = [];
  (Array.isArray(list) ? list : []).forEach(function (x) {
    const w = ideaWords(lineText(x));
    let i = -1;
    for (let j = 0; j < sets.length; j++) if (sameIdea(sets[j], w)) { i = j; break; }
    if (i === -1) { kept.push(x); sets.push(w); return; }
    if (w.size > sets[i].size) { kept[i] = x; sets[i] = w; }
  });
  return kept;
}
function tidyCards(projectIncluded, cards, keys) {
  if (!Array.isArray(cards)) return cards;
  sharedOnce(projectIncluded, cards);
  const sup = keys.sup, exc = keys.exc;
  cards.forEach(function (c) {
    if (!c || typeof c !== "object") return;
    if (Array.isArray(c[sup]) && c[sup].length) c[sup] = onceEach(c[sup]);
    const hasSup = Array.isArray(c[sup]) && c[sup].length > 0;
    if (Array.isArray(c[exc]) && c[exc].length) {
      c[exc] = onceEach(c[exc].filter(function (x) { return !(hasSup && SUPPLY_SAY.test(lineText(x))); }));
    }
  });
  return cards;
}
function bySize(cards, sizeOf) {
  if (!Array.isArray(cards)) return cards;
  const f = typeof sizeOf === "function" ? sizeOf : function (c) { return c && c.subtotal; };
  return cards.sort(function (a, b) { return (Number(f(b)) || 0) - (Number(f(a)) || 0); });
}

module.exports = { sharedOnce, tidyCards, bySize, onceEach, ideaWords, sameIdea, SHARED_STOCK, SHARED_RE, SUPPLY_SAY, sharedKey };
