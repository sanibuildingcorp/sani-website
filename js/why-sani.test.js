/* why-sani.test.js — run: node js/why-sani.test.js
 *
 *   "I need add something soft text to the customer side estimate...
 *    trustworthy, promising... to let them easily decide positively."
 *
 * A short "Why homeowners choose Sani" box right above the go-ahead button.
 * Four promises, each one true: fully insured, a 3-year workmanship warranty
 * (he confirmed 3 years, and the contract now says 3 years too), nothing
 * extra without their OK, and the price held to the date the terms print.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const Q = fs.readFileSync(path.join(ROOT, 'quote.html'), 'utf8');
const CON = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-contract-background.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
function ext(name) { const s = Q.search(new RegExp('function ' + name + '\\s*\\(')); if (s < 0) throw new Error('missing ' + name); let d = 0; for (let j = Q.indexOf('{', s); j < Q.length; j++) { if (Q[j] === '{') d++; else if (Q[j] === '}') { d--; if (!d) return Q.slice(s, j + 1); } } }
const E = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ctx = { E, encodeURIComponent, Date, Math, isFinite, ref: 'SBC-260806-YX1G', rec: { sentAt: '2026-09-24T01:51:00Z' }, messageBox: () => '<MSGBOX>' };
vm.createContext(ctx);
vm.runInContext('const VALID_DAYS=30;const WARRANTY_YEARS=3;' + ['issuedAt', 'validUntil', 'dayText', 'printRow', 'whyHtml', 'actionHtml'].map(ext).join('\n'), ctx);

console.log('\n1. The box, right where they decide\n');
{
  const h = vm.runInContext('actionHtml({name:"Zurabi"},false,false,true)', ctx);
  const w = h.indexOf('Why homeowners choose Sani'), b = h.indexOf("Yes, I'd like to go ahead");
  ok('IT SITS RIGHT ABOVE "Yes, I\'d like to go ahead"', w !== -1 && b !== -1 && w < b && h.indexOf('<section class="actions">') > w);
  ok('four short promises, with check marks', (h.match(/<li>/g) || []).length === 4 && /<ul class="inlist">/.test(h));
  ok('fully insured', /Fully insured NYC renovation company/.test(h));
  ok('3-YEAR WORKMANSHIP WARRANTY: we come back and fix it', /3-year workmanship warranty: if something we did isn.t right, we come back and fix it/.test(h));
  ok('nothing extra without their OK', /Nothing extra without your OK: the price above covers the work listed/.test(h));
  ok('THE PRICE IS HELD UNTIL THE DATE THE TERMS PRINT (October 23 for a September 23 send)', /Your price is held until October 23, 2026/.test(h), (h.match(/held until [^<]*/) || [''])[0]);
  ok('never the forbidden word', !/licens/i.test(vm.runInContext('whyHtml()', ctx)));
  const c = vm.runInContext('actionHtml({name:"Zurabi"},false,true,true)', ctx);
  ok('also above "Review & sign the contract"', c.indexOf('Why homeowners choose Sani') !== -1 && c.indexOf('Why homeowners choose Sani') < c.indexOf('Review &amp; sign the contract'));
}

console.log('\n2. Not where it does not belong\n');
{
  ok('not once they said yes', vm.runInContext('actionHtml({name:"Z"},true,false,true)', ctx).indexOf('Why homeowners') === -1);
  ok('not on a job with no price yet', vm.runInContext('actionHtml({name:"Z"},false,false,false)', ctx).indexOf('Why homeowners') === -1);
  ctx.rec = { sentAt: '2026-01-01T00:00:00Z' };
  ok('not on an expired estimate (it only asks for an update)', vm.runInContext('actionHtml({name:"Z"},false,false,true)', ctx).indexOf('Why homeowners') === -1);
}

console.log('\n3. The contract says the same warranty\n');
ok('THE CONTRACT\'S WARRANTY CLAUSE IS 3 YEARS, matching the estimate page', /Workmanship warranty clause \(3 years workmanship; manufacturer warranties pass through on materials\)/.test(CON) && !/1 year workmanship/.test(CON));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
