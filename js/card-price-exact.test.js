/* card-price-exact.test.js — run: node js/card-price-exact.test.js
 *
 *   "Example in water damage trying decrease price to 700$ but it's
 *    increased, always if i need set my own price each service cards or
 *    even in total then let's set it what i will set"
 *
 * Water Damage showed $2,419.13: $700 of its own line plus $1,719.13 of the
 * shared costs (protection, coordination, cleanup) the Services panel
 * spreads over every card. Typing $700 scaled its own line to $700 - which
 * it already was - and the card stayed $2,419.13.
 *
 * Now a price typed on a card is that card's price, exactly: the card stops
 * taking a share of the shared costs, that share comes off the shared lines,
 * and every other card keeps the price it had. Set Total keeps those cards
 * and moves the rest. Unlock gives the card back to the split. The real
 * dashboard functions run here.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const CC = require(path.join(ROOT, 'netlify/functions/lib/customer-cards.js'));
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
function ext(name) {
  const s = DASH.search(new RegExp('(?:async )?function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = DASH.indexOf('{', s); j < DASH.length; j++) { if (DASH[j] === '{') d++; else if (DASH[j] === '}') { d--; if (!d) return DASH.slice(s, j + 1); } }
  throw new Error('unbalanced ' + name);
}
const FNS = ['scopeAddedTitles', 'scopeSectionOf', 'scopeCardNames', 'scopeCardTotals', 'scopeServiceSubtotal', 'scopeRowsFor', 'scopeRowsRaw', 'scopeScaleRows', 'scopeMarkupK', 'scopeParseMoney', 'scopePinnedNames', 'scopeLooseRows', 'scopePinCard', 'scopeCardParts', 'scopeSetServiceTotal', 'scopeSetKindTotal', 'scopeUnpin', 'scopeUniqueServices'];

function record() {
  return { ref: 'SBC-260920-ECB4', estimate: { markupPct: 25,
    labor: [
      { section: 'Painting', item: 'Paint walls and ceilings, two coats', qty: 40, unit: 'hrs', rate: 60 },
      { section: 'Bathroom', item: 'Re-caulk the tub', qty: 3, unit: 'hrs', rate: 60 },
      { section: 'Electrical', item: 'Repair the outlet and two lights', qty: 4, unit: 'hrs', rate: 90 },
      { section: 'General', item: 'Site protection and daily cleanup', qty: 20, unit: 'hrs', rate: 45 },
      { section: 'General', item: 'Project coordination', qty: 10, unit: 'hrs', rate: 60 },
    ],
    materials: [
      { section: 'Painting', item: 'Paint and primer', qty: 1, unit: 'ls', rate: 600 },
      { section: 'Water Damage', item: 'Zinsser Perma-White mold and mildew-proof paint', qty: 1, unit: 'ls', rate: 560 },
    ],
    manualCustomerScopeDraft: { services: ['Painting', 'Bathroom', 'Electrical', 'Water Damage'].map((n) => ({ name: n, included: ['x'], supplied: [], excluded: [] })) },
  } };
}
function world(rec, answers) {
  const log = { confirms: [], toasts: [] };
  const ctx = { Math, Number, String, Object, Array, JSON, isFinite, Date,
    currentRecord: rec,
    document: { getElementById: () => null },
    confirm: (m) => { log.confirms.push(m); return answers ? answers.shift() !== false : true; },
    alert: (m) => { log.alert = m; }, toast: (m) => log.toasts.push(m),
    renderScopeControl: () => {}, scopeLinesRefresh: () => {},
    fmt: (n) => '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','),
    scopeDraft: () => rec.estimate.manualCustomerScopeDraft,
  };
  vm.createContext(ctx);
  vm.runInContext(FNS.map(ext).join('\n'), ctx);
  return { ctx, log, card: (n) => vm.runInContext('scopeServiceSubtotal(' + JSON.stringify(n) + ')', ctx), total: () => vm.runInContext('scopeCardTotals().grand', ctx), run: (c) => vm.runInContext(c, ctx) };
}
const names = ['Painting', 'Bathroom', 'Electrical', 'Water Damage'];

console.log('\n1. The Water Damage case: $700 own + a share of the shared costs\n');
{
  const rec = record(), w = world(rec);
  const before = {}; names.forEach((n) => { before[n] = w.card(n); });
  const grand0 = w.total();
  ok('BEFORE: Water Damage shows more than its own $700 line (it carries a share of the shared costs)', before['Water Damage'] > 700 + 100, JSON.stringify(before));
  w.run('scopeSetServiceTotal(3, "700")');
  const after = {}; names.forEach((n) => { after[n] = w.card(n); });
  ok('TYPED $700 -> THE CARD SHOWS EXACTLY $700.00', after['Water Damage'] === 700, JSON.stringify(after));
  ok('...EVERY OTHER CARD KEEPS ITS PRICE, to the cent', ['Painting', 'Bathroom', 'Electrical'].every((n) => Math.abs(after[n] - before[n]) < 0.011), JSON.stringify(before) + ' -> ' + JSON.stringify(after));
  ok('...the estimate total drops by exactly the difference', Math.abs((grand0 - w.total()) - (before['Water Damage'] - 700)) < 0.02, grand0 + ' -> ' + w.total());
  ok('...the cards still add up to the total', Math.abs(names.reduce((a, n) => a + after[n], 0) - w.total()) < 0.011);
  ok('THE CONFIRM says what it is now, split into its own lines and its share, and that the other cards stay', /It is \$\d[\d,]*\.\d\d now \(\$700\.00 of its own lines \+ \$[\d,]+\.\d\d share of the shared costs\)\./.test(w.log.confirms[0]) && /Water Damage will show exactly \$700\.00\. The other cards stay as they are\./.test(w.log.confirms[0]), w.log.confirms[0]);
  ok('the card is marked as his (pinned) on the scope draft', rec.estimate.manualCustomerScopeDraft.services[3].pinned === true);
  ok('the shared lines came down by the share; the card\'s own line stayed $560 before markup', rec.estimate.materials[1].rate === 560 && rec.estimate.labor[3].rate < 45);
  ok('THE SERVER\'S CARD MATH (what the assistant and ChatGPT quote) agrees: Water Damage $700', Math.abs(CC.pricedFromLines(rec.estimate, names)['Water Damage'] - 700) < 0.011 && names.every((n) => Math.abs(CC.pricedFromLines(rec.estimate, names)[n] - after[n]) < 0.02), JSON.stringify(CC.pricedFromLines(rec.estimate, names)));
}

console.log('\n2. Setting it again, raising it, a card with labor\n');
{
  const rec = record(), w = world(rec);
  w.run('scopeSetServiceTotal(3, "700")');
  const mid = {}; names.forEach((n) => { mid[n] = w.card(n); });
  w.run('scopeSetServiceTotal(3, "950")');
  ok('a pinned card set again lands exactly, others unchanged', w.card('Water Damage') === 950 && ['Painting', 'Bathroom', 'Electrical'].every((n) => Math.abs(w.card(n) - mid[n]) < 0.011));
  const b = {}; names.forEach((n) => { b[n] = w.card(n); });
  w.run('scopeSetServiceTotal(2, "400")');
  ok('ELECTRICAL (a card with labor) set to $400 shows $400.00; the others keep their price', w.card('Electrical') === 400 && ['Painting', 'Bathroom', 'Water Damage'].every((n) => Math.abs(w.card(n) - b[n]) < 0.02), names.map((n) => n + ' ' + b[n] + '->' + w.card(n)).join(' | '));
  ok('a typed price below zero or text is refused', (() => { const v = w.card('Painting'); w.run('scopeSetServiceTotal(0, "abc")'); return w.card('Painting') === v; })());
}

console.log('\n3. Unlock gives the card back to the split; Set Total keeps the cards he priced\n');
{
  const rec = record(), w = world(rec);
  w.run('scopeSetServiceTotal(3, "700")');
  w.run('scopeUnpin(3)');
  ok('UNLOCK: the card takes its share again (price goes up), its own line did not move', rec.estimate.manualCustomerScopeDraft.services[3].pinned === false && w.card('Water Damage') > 700 && rec.estimate.materials[1].rate === 560);
  ok('the card shows the lock and an Unlock link while pinned', /🔒 Your price — stays exactly this\. <a href="#" onclick="scopeUnpin\(' \+ si \+ '\);return false"/.test(DASH));
  ok('SET TOTAL: the cards he priced keep their lines; the new total is reached by the others; too low is refused', /var _pins = \(typeof scopePinnedNames === "function"\) \? scopePinnedNames\(\) : \[\];/.test(DASH) && /Too low — the cards you priced yourself already add up to /.test(DASH) && /if\(showLabor\) _scale\("labor", t\.labor \* f\);/.test(DASH) && /_scale\("labor", Math\.max\(0,newLaborSub\)\);/.test(DASH));
  ok('the pin travels with Save (the published scope and the draft)', /pinned: s2\.pinned === true \? true : undefined \};/.test(DASH));
  ok('the rounding penny never lands on a card he priced', /if \(pinsR\.indexOf\(nm\.toLowerCase\(\)\) === -1 && \(!biggest \|\| v > \(byCard\[biggest\] \|\| 0\)\)\) biggest = nm;/.test(DASH));
}
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
