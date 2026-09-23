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

module.exports = { sharedOnce, SHARED_STOCK, SHARED_RE, sharedKey };
