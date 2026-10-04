/* stamped-total.test.js — run: node js/stamped-total.test.js
 *
 *   "Still regenerating with old price 10,000 and my updated is 20,000"
 *
 * THE PRICE THAT OVERRODE EVERY OTHER PRICE, INVISIBLY.
 *
 * record.customerFinalTotal is stamped when a customer accepts, or when they add
 * a paid option. From that moment quote.html, send-quote and
 * generate-contract-background ALL prefer it over the line items. It IS the
 * price.
 *
 * It could be written by the customer accepting and by adopt-option, and by
 * NOTHING ELSE. save-estimate did not accept the field at all. So a contractor
 * could raise a price by every means the interface offers — rescale the lines,
 * type a new total with "Set total to a number", regenerate the whole estimate —
 * and the customer's quote page and every regenerated contract went on quoting
 * the old figure. Silently: the totals panel showed the LINES, so the screen
 * said $20,000.03 while the customer was being charged $10,000.01.
 *
 * On SBC-260821-KQNQ that ran for hours, through three rounds of "it's still
 * regenerate with old price", with a customer waiting.
 *
 * Two things had to be true and neither was:
 *   - the contractor must be able to change it;
 *   - it must never be able to disagree with the screen in silence.
 *
 * The panel is run here in a context holding ONLY what its own script block
 * defines — the lesson from "Can't find variable: escAttr", which took the whole
 * dashboard down because a panel reached for a helper in a different block.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

function ext(name) {
  const s = HTML.search(new RegExp('(async )?function ' + name + '\\('));
  if (s < 0) throw new Error('missing ' + name);
  let d = 0;
  for (let j = HTML.indexOf('{', s); j < HTML.length; j++) {
    if (HTML[j] === '{') d++;
    else if (HTML[j] === '}') { d--; if (!d) return HTML.slice(s, j + 1); }
  }
}

/* Deliberately spartan: fmt, esc and calcCustomerView are lifted from the file,
   and NOTHING from any other script block is provided. That absence is the test.
   fmt2 lives in a different block — reaching for it here would throw, exactly as
   escAttr did in the contractor's hands. */
const ctx = { console, String, Number, Array, Object, Boolean, Math, JSON, isFinite };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
['fmt', 'esc', 'calcTotal', 'calcCustomerView', 'stampedTotalHtml'].forEach(function (n) {
  vm.runInContext(ext(n), ctx);
});
const panel = (r) => vm.runInContext('stampedTotalHtml(' + JSON.stringify(r) + ')', ctx);
/* What the LINES actually come to, computed rather than worked out on paper.
   Three times today a hand-derived figure in a fixture was wrong where the code
   was right; this asks the code. */
const linesTotal = (r) => vm.runInContext('calcCustomerView(' + JSON.stringify(r.estimate) + ').customerTotal', ctx);
const money = (n) => vm.runInContext('fmt(' + n + ')', ctx);

/* The live record. Lines total $20,000.03; the stamp still says $10,000.01. */
function kqnq(over) {
  return Object.assign({
    ref: 'SBC-260821-KQNQ',
    customerFinalTotal: 10000.01,
    estimate: {
      markupPct: 25, showLaborCost: true, showMaterialsCost: true,
      labor: [{ item: 'Squeak elimination', qty: 1, rate: 13115.85 }],
      materials: [{ item: 'Fasteners', qty: 1, rate: 2884.38 }],
    },
  }, over || {});
}

console.log('\nthe stamped price is no longer invisible\n');

ok('the panel renders without reaching outside its own script block',
  (function () { try { panel(kqnq()); return true; } catch (e) { return 'threw: ' + e.message; } })() === true,
  (function () { try { panel(kqnq()); return ''; } catch (e) { return e.message; } })());

{
  const h = panel(kqnq());
  const lines = money(linesTotal(kqnq()));
  ok('THE LIVE CASE IS CALLED OUT: quoted $10,000.01 while the lines say ' + lines,
    h.indexOf('$10,000.01') !== -1 && h.indexOf(lines) !== -1, h.slice(0, 240));
  ok('...and it says plainly which one the customer sees',
    /customer is being quoted/i.test(h), h.slice(0, 160));
  ok('...and that changing the lines alone will not move it',
    /does not move it/i.test(h));
  ok('...and names the places it overrides, so the reason is obvious',
    /quote page/i.test(h) && /contract/i.test(h));
  ok('there is one button that makes them agree', /onclick="restampCustomerTotal\(\)"/.test(h));
  ok('...labelled with the number it will charge',
    h.indexOf('Charge ' + lines + ' instead') !== -1, h.slice(-220));
}

/* ── when it must stay quiet ────────────────────────────────────────────── */
ok('a record with no stamp says nothing — most jobs never have one',
  panel(kqnq({ customerFinalTotal: null })) === '' && panel({ estimate: {} }) === '' && panel(null) === '');
ok('a stamp that AGREES with the lines says nothing',
  panel(kqnq({ customerFinalTotal: 20000.03 })) === '', panel(kqnq({ customerFinalTotal: 20000.03 })));
ok('...and a cent of rounding is not a disagreement',
  panel(kqnq({ customerFinalTotal: 20000.02 })) === '');
ok('a dollar and a half IS', panel(kqnq({ customerFinalTotal: 20001.6 })) !== '');
ok('a nonsense stamp is ignored rather than quoted as a price',
  panel(kqnq({ customerFinalTotal: 0 })) === '' && panel(kqnq({ customerFinalTotal: -5 })) === ''
  && panel(kqnq({ customerFinalTotal: 'abc' })) === '');
ok('an estimate with no lines says nothing — there is no second number to compare',
  panel(kqnq({ estimate: { labor: [], materials: [], markupPct: 25 } })) === '');
ok('junk does not throw',
  (function () {
    try { panel({}); panel({ customerFinalTotal: 5, estimate: null }); panel({ estimate: 'x', customerFinalTotal: 9 }); return true; }
    catch (e) { return 'threw: ' + e.message; }
  })() === true);
ok('it works when the price went DOWN too, not only up',
  panel(kqnq({ customerFinalTotal: 30000 })).indexOf('$30,000.00') !== -1);

/* ══ THE THREE PLACES IT HAD TO BE FIXED ═══════════════════════════════════ */
console.log('\nthe contractor can now actually change it\n');

const SAVE = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'save-estimate.js'), 'utf8');
ok('SAVE-ESTIMATE ACCEPTS THE FIELD AT ALL — it did not, which is the root of the whole thing',
  /customerFinalTotal,/.test(SAVE) && /existing\.customerFinalTotal = /.test(SAVE));
ok('null clears it and hands the truth back to the line items',
  /customerFinalTotal === null[\s\S]{0,80}delete existing\.customerFinalTotal/.test(SAVE));
ok('A ZERO OR A NaN IS REFUSED, never stored — it would quote $0.00 across the quote, the contract and the invoice at once',
  /Number\.isFinite\(n\) && n > 0/.test(SAVE));
ok('...and it is rounded to cents', /Math\.round\(n \* 100\) \/ 100/.test(SAVE));
ok('the endpoint is still gated', /require-dashboard-key/.test(SAVE));

ok('typing a total re-stamps the agreed price',
  /currentRecord\.customerFinalTotal = Math\.round\(target \* 100\) \/ 100;/.test(HTML));
ok('...but ONLY where a stamp already exists — it must never create one on a job that had none',
  /if \(currentRecord\.customerFinalTotal != null\) \{\s*\n\s*currentRecord\.customerFinalTotal = Math\.round\(target/.test(HTML));
ok('saving a draft carries the stamp with it',
  /currentRecord\.customerFinalTotal != null \? \{ customerFinalTotal: currentRecord\.customerFinalTotal \} : \{\}/.test(HTML));
ok('the warning is rendered beside the totals, where the disagreement is',
  /stampedTotalHtml\(currentRecord\) \+/.test(HTML));

/* ══ WHY IT MATTERED: EVERYTHING DOWNSTREAM PREFERS THE STAMP ══════════════ */
console.log('\nwhat the stamp overrides\n');
const QUOTE = fs.readFileSync(path.join(__dirname, '..', 'quote.html'), 'utf8');
const CT = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'lib', 'customer-total.js'), 'utf8');
const GEN = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'generate-contract-background.js'), 'utf8');
ok('the customer\'s quote page prefers it', /rec\.customerFinalTotal/.test(QUOTE));
ok('the shared total library prefers it', /record\.customerFinalTotal/.test(CT));
ok('THE CONTRACT GENERATOR READS THAT LIBRARY — which is why regenerating kept producing the old price',
  /customerTotals\(est, record\)\.customerTotal/.test(GEN));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
