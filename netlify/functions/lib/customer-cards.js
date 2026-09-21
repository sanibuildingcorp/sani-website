// netlify/functions/lib/customer-cards.js
//
// THE SERVICE CARDS AS THE CUSTOMER SEES THEM - names and PRICES.
//
//   "Yesterday you said it will now read live fresh estimate but look at
//    him it's still reading old information!!!"
//
// The assistant told him the Bathroom card "shows $46,836.43" while the
// customer total was $26,836.43, and called it a $20k mismatch to fix
// before sending. There was no mismatch. It had read
// estimate.serviceBreakdown[].subtotal - a number the dashboard writes at
// publish time and never reads back ("a publish artifact"). The customer's
// page (quote.html) builds the cards from the published scope and then
// reconciles them to the headline total, proportionally, so they always add
// up to what the customer pays - and when he sets the total by hand
// (customerFinalTotal), every card is scaled with it. On a one-card job the
// card IS the total.
//
// This file is that arithmetic, on the server, so the assistant quotes the
// number the customer reads:
//
//   customerCards(record) -> { total, published, cards: [{ title, subtotal,
//                              included, supplied, excluded, folded }] }
//
//   1. The card list is the published customer scope when it is published
//      with prices (the "only truth" on the customer's page); otherwise the
//      estimator's cards priced from the lines the way the dashboard prices
//      them (own lines by section, loose lines spread by labor weight over
//      the cards that were there before any added service, markup on top).
//   2. A card with no price is folded into the largest one, as the page does.
//   3. The cards are scaled so they sum to the customer total exactly, the
//      sub-dollar remainder on the largest card.
//
// Money never leaves this file for a customer: it is for the assistant, the
// dashboard's own tools, and tests.

"use strict";

const customerTotals = require("./customer-total");

function str(v) { return String(v == null ? "" : v).trim(); }
function arr(v) { return Array.isArray(v) ? v : []; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function key(v) { return str(v).toLowerCase(); }

/* Which card a price line belongs to: its section, else a card whose name
   appears in the line's text, else none (loose). */
function cardOf(line, names) {
  const byKey = {};
  names.forEach(function (nm) { byKey[key(nm)] = nm; });
  const sec = key(line && line.section);
  if (sec && byKey[sec]) return byKey[sec];
  const text = key(line && line.item);
  if (text) { for (let i = 0; i < names.length; i++) { const k = key(names[i]); if (k && text.indexOf(k) !== -1) return names[i]; } }
  return null;
}

/* The dashboard's scopeCardTotals, without the DOM: own cost per card, the
   loose cost spread by labor weight over the cards that were there before
   any added service, then markup. */
function pricedFromLines(est, names) {
  const k = 1 + num(est.markupPct) / 100;
  const own = {}, ownLabor = {};
  names.forEach(function (nm) { own[nm] = 0; ownLabor[nm] = 0; });
  let loose = 0;
  ["labor", "materials"].forEach(function (kind) {
    arr(est[kind]).forEach(function (l) {
      const cost = num(l && l.qty) * num(l && l.rate);
      if (!cost) return;
      const nm = cardOf(l, names);
      if (nm) { own[nm] += cost; if (kind === "labor") ownLabor[nm] += cost; } else loose += cost;
    });
  });
  if (loose > 0 && names.length) {
    const added = [];
    arr(est.addedServices).forEach(function (a) { arr(a && a.titles).forEach(function (t) { added.push(key(t)); }); });
    let share = names.filter(function (nm) { return own[nm] > 0 && added.indexOf(key(nm)) === -1; });
    if (!share.length) share = names.filter(function (nm) { return own[nm] > 0; });
    if (!share.length) share = names.slice();
    const withLabor = share.filter(function (nm) { return ownLabor[nm] > 0; });
    const laborTotal = withLabor.reduce(function (a, nm) { return a + ownLabor[nm]; }, 0);
    if (!withLabor.length || laborTotal <= 0) share.forEach(function (nm) { own[nm] += loose / share.length; });
    else {
      const mean = 1 / withLabor.length, weights = {};
      let wSum = 0;
      share.forEach(function (nm) { weights[nm] = ownLabor[nm] > 0 ? ownLabor[nm] / laborTotal : mean; wSum += weights[nm]; });
      share.forEach(function (nm) { own[nm] += loose * (weights[nm] / wSum); });
    }
  }
  const out = {};
  names.forEach(function (nm) { out[nm] = r2(own[nm] * k); });
  return out;
}

function largest(cards) {
  return cards.reduce(function (a, b) { return (b.subtotal > a.subtotal ? b : a); }, cards[0]);
}

/* The customer's page: a card with no price is folded into the largest. */
function foldZero(cards) {
  const priced = cards.filter(function (c) { return c.subtotal > 0; });
  if (!priced.length || priced.length === cards.length) return cards;
  const main = largest(priced);
  cards.forEach(function (c) {
    if (c.subtotal > 0) return;
    c.folded = main.title;
    ["included", "supplied", "excluded"].forEach(function (k) { c[k].forEach(function (x) { if (main[k].indexOf(x) === -1) main[k].push(x); }); });
  });
  return cards;
}

/* The customer's page: the cards sum to the headline, proportionally. */
function reconcile(cards, total) {
  const live = cards.filter(function (c) { return !c.folded; });
  if (!live.length || !(total > 0)) return cards;
  const sum = live.reduce(function (a, c) { return a + c.subtotal; }, 0);
  if (Math.abs(sum - total) < 1) return cards;
  if (sum > 0) {
    const f = total / sum;
    live.forEach(function (c) { c.subtotal = r2(c.subtotal * f); });
    const s2 = live.reduce(function (a, c) { return a + c.subtotal; }, 0);
    const d = r2(total - s2);
    if (d) { const big = largest(live); big.subtotal = r2(big.subtotal + d); }
  } else {
    const big = largest(live); big.subtotal = r2(big.subtotal + total - sum);
  }
  return cards;
}

function texts(list) {
  return arr(list).map(function (x) { return str(typeof x === "string" ? x : (x && (x.text || x.item || x.label || x.name))); }).filter(Boolean);
}

function customerCards(record) {
  const rec = record || {}, est = rec.estimate || {};
  let total = 0;
  try { total = customerTotals(est, rec).customerTotal; } catch (e) { total = 0; }

  const pub = est.customerScopePublished === true && est.publishedCustomerScope ? arr(est.publishedCustomerScope.services) : [];
  const published = pub.length > 0 && pub.some(function (s) { return s && Number.isFinite(Number(s.subtotal)); });
  let cards;
  if (published) {
    cards = pub.filter(Boolean).map(function (s) {
      return { title: str(s.name || s.title) || "Service", subtotal: r2(num(s.subtotal)), included: texts(s.included), supplied: texts(s.supplied || s.customerSupplies), excluded: texts(s.excluded || s.notIncluded), folded: "" };
    });
  } else {
    const sb = arr(est.serviceBreakdown).filter(Boolean);
    let names = sb.map(function (s) { return str(s.title || s.service || s.section || s.name); }).filter(Boolean);
    if (!names.length) {
      const seen = {};
      ["labor", "materials"].forEach(function (kind) { arr(est[kind]).forEach(function (l) { const s = str(l && l.section); if (s && !seen[key(s)]) { seen[key(s)] = 1; names.push(s); } }); });
    }
    const priced = pricedFromLines(est, names);
    cards = names.map(function (nm) {
      const s = sb.filter(function (x) { return key(x.title || x.service || x.section || x.name) === key(nm); })[0] || {};
      return { title: nm, subtotal: priced[nm] || 0, included: texts(s.included || s.items || s.scope), supplied: texts(s.customerSupplies || s.customerSupplied || s.supplied), excluded: texts(s.notIncluded || s.exclusions || s.excluded), folded: "" };
    });
  }
  foldZero(cards);
  reconcile(cards, total);
  return { total: total, published: published, cards: cards };
}

module.exports = { customerCards, pricedFromLines, reconcile, foldZero };
