// netlify/functions/lib/hand-prices.js
//
// THE PRICES HE TYPED BY HAND SURVIVE AN UPDATE.
//
//   "If the newest message is newer than the estimate: ... Update estimate
//    from chat. Update must keep prices I typed by hand."
//
// The estimate screen marks a line byHand when he types its quantity or rate,
// adds it himself, or adds it from his product library. A regenerate replaces
// the lines wholesale; this puts his numbers back on the line that is the same
// work (same kind, same service, same wording), and keeps a hand line the new
// estimate does not have at all - he added it on purpose.

"use strict";

const A = (v) => (Array.isArray(v) ? v : []);
const norm = (t) => String(t == null ? "" : t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * @param {object} prev  the estimate being replaced
 * @param {object} next  the new estimate (changed in place and returned)
 * @returns {{ estimate: object, kept: number, added: number }}
 */
function keepHandPrices(prev, next) {
  const out = { estimate: next, kept: 0, added: 0 };
  if (!prev || !next || typeof next !== "object") return out;
  ["labor", "materials"].forEach(function (kind) {
    const hand = A(prev[kind]).filter(function (l) { return l && l.byHand === true && norm(l.item); });
    if (!hand.length) return;
    next[kind] = A(next[kind]);
    hand.forEach(function (h) {
      const sec = norm(h.section), item = norm(h.item);
      const m = next[kind].find(function (l) { return l && norm(l.item) === item && (!sec || norm(l.section) === sec); });
      if (m) {
        m.qty = h.qty; m.rate = h.rate; if (h.unit) m.unit = h.unit; m.byHand = true;
        out.kept++;
      } else {
        next[kind].push(Object.assign({}, h));
        out.added++;
      }
    });
  });
  return out;
}

module.exports = { keepHandPrices };
