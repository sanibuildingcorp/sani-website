/* sent-version-notice.test.js — run: node js/sent-version-notice.test.js
 *
 *   "Nothing was changed ... it's saying nothing was changed in below text,
 *    yes it's confusing this text"
 *
 * An accepted job, untouched after sending, said "You have changed things
 * since". The real sentVersionHtml runs here on real record shapes: the
 * customer accepting (which stamps the price), the empty options list the
 * send adds, key order - none of these is a change. A new rate, a new line
 * or a different price still is.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const DASH = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const cut = (name) => { const s = DASH.search(new RegExp('^function ' + name + '\\s*\\(', 'm')); let d = 0; for (let j = DASH.indexOf('{', s); j < DASH.length; j++) { if (DASH[j] === '{') d++; else if (DASH[j] === '}') { d--; if (!d) return DASH.slice(s, j + 1); } } };
const ctx = { Math, Number, String, JSON, Object, Array, esc: (x) => String(x), scopeSectionOf: (l) => l.section || '' };
vm.createContext(ctx);
vm.runInContext(['calcTotal', 'calcCustomerView', 'quoteNorm', 'quoteMovedSinceSent', 'sentVersionHtml'].map(cut).join('\n'), ctx);

const est = () => ({ markupPct: 30, showLaborCost: true, showMaterialsCost: false, labor: [{ section: 'Windows', item: 'Reverse the curtain track', qty: 2, unit: 'hrs', rate: 75.1 }], materials: [{ section: 'Windows', item: 'Track stop', qty: 1, unit: 'ea', rate: 120.26 }], projectIncluded: [] });
const quoted = Math.round(vm.runInContext('calcCustomerView', ctx)(est()).customerTotal * 100) / 100;
const record = (live, sent, extra) => Object.assign({ estimate: live, sentVersion: { n: 1, at: '2026-09-25T16:30:00Z', estimate: sent, customerFinalTotal: null } }, extra || {});
const says = (r) => ctx.sentVersionHtml(r);
const matches = (h) => /Same as your draft\./.test(h) && !/changed/.test(h);

ok('nothing changed: "Your draft matches it"', matches(says(record(est(), est()))));
{
  const sent = est(); sent.offeredOptions = [];
  ok('THE SEND\'S EMPTY OPTIONS LIST IS NOT A CHANGE (the draft has no such key)', matches(says(record(est(), sent))));
}
ok('THE CUSTOMER ACCEPTING - the price stamped after sending - IS NOT A CHANGE', matches(says(record(est(), est(), { status: 'accepted', customerFinalTotal: quoted }))), String(quoted));
{
  const a = est(), b = {}; Object.keys(a).reverse().forEach((k) => { b[k] = a[k]; });
  ok('the same quote with its fields in another order is not a change', matches(says(record(a, b))));
}
{
  const a = est(); a.notes = ''; a.hiddenQuotePhotos = [];
  ok('empty fields added later (a blank note, an empty photo list) are not a change', matches(says(record(a, est()))));
}
{
  const a = est(); a.labor[0].rate = 80;
  ok('A NEW RATE IS A CHANGE - and it says so plainly', /You changed it\./.test(says(record(a, est()))) && /Press Send to update\./.test(says(record(a, est()))));
}
{
  const a = est(); a.labor.push({ section: 'Windows', item: 'Tidy the cords', qty: 1, unit: 'hrs', rate: 75 });
  ok('a new line is a change', !matches(says(record(a, est()))));
}
ok('a price stamped after sending that is NOT the quoted one is a change', !matches(says(record(est(), est(), { customerFinalTotal: quoted + 50 }))));
{
  const r = record(est(), est(), { customerFinalTotal: 600 }); r.sentVersion.customerFinalTotal = 500;
  ok('a set total changed after sending is a change', !matches(says(r)));
}
ok('the old confusing wording is gone', !/You have changed things since|Nothing you have edited is visible to them/.test(DASH));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
