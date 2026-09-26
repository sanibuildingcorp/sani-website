/* set-total-exact.test.js — run: node js/set-total-exact.test.js
 *
 *   "Why this total set always add or cut some cents. Let me always add
 *    whatever i write"
 *
 * Set Total spread the typed figure over the lines, rounded every rate to a
 * cent, and the markup multiplied the cents: $2,750 became $2,750.03. Now one
 * line takes the leftover. The real applySetTotal runs here on hundreds of
 * estimates, markups, modes and typed totals, and the customer total - read
 * the dashboard's way AND the server's way (lib/customer-total.js) - must be
 * exactly the typed number every time.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const { customerTotals } = require(path.join(ROOT, 'netlify/functions/lib/customer-total.js'));
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const cut = (name) => { const s = DASH.search(new RegExp('^function ' + name + '\\s*\\(', 'm')); let d = 0; for (let j = DASH.indexOf('{', s); j < DASH.length; j++) { if (DASH[j] === '{') d++; else if (DASH[j] === '}') { d--; if (!d) return DASH.slice(s, j + 1); } } };

const els = { 'st-target': { value: '' }, 'st-warn': { style: {}, textContent: '' } };
const ctx = {
  currentRecord: null, _stMode: 'all', Math, Number, String, isNaN, parseFloat,
  document: { getElementById: (id) => els[id] || null, querySelectorAll: () => [] },
  syncLines() {}, renderLines() {}, attachLineListeners() {}, recalc() {}, closeSetTotalModal() {}, toast() {},
  fmt: (n) => '$' + Number(n).toFixed(2), scopeSectionOf: (l) => l.section || '',
};
vm.createContext(ctx);
vm.runInContext(['calcTotal', 'calcCustomerView', '_stShown', '_stModeAvailable', '_stModeReason', '_stCurrentTotal', '_stScaleBucket', '_stLandExact', 'applySetTotal'].map(cut).join('\n') + '\nvar _stMode = "all";', ctx);

let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const line = () => ({ item: 'x', qty: [1, 2, 3, 4.5, 8, 12.5, 24, 40][Math.floor(rnd() * 8)], rate: Math.round((20 + rnd() * 180) * 100) / 100 });
function run(est, target, mode) {
  ctx.currentRecord = { estimate: est };
  vm.runInContext('_stMode = ' + JSON.stringify(mode), ctx);
  els['st-target'].value = String(target);
  els['st-warn'].style.display = 'none';
  vm.runInContext('applySetTotal()', ctx);
  if (els['st-warn'].style.display === 'block') return { refused: true };
  const dash = Math.round(vm.runInContext('calcCustomerView(currentRecord.estimate).customerTotal', ctx) * 100) / 100;
  const server = customerTotals(est).customerTotal;
  return { dash, server };
}

console.log('\nthe total lands on the typed number, to the cent\n');
{
  /* the reported one: 25% markup, typed $2,750 */
  const est = { markupPct: 25, showLaborCost: true, showMaterialsCost: false, labor: [{ qty: 10, rate: 62.4 }, { qty: 8, rate: 62.4 }, { qty: 3, rate: 62.4 }, { qty: 2, rate: 62.4 }], materials: [{ qty: 1, rate: 40 }] };
  const r = run(est, 2750, 'all');
  ok('TYPED $2,750 -> THE CUSTOMER SEES $2,750.00 (dashboard and server agree)', r.dash === 2750 && r.server === 2750, JSON.stringify(r));
  const again = run(est, 2750.02, 'all');
  ok('and a cents figure too: $2,750.02', again.dash === 2750.02 && again.server === 2750.02, JSON.stringify(again));
}
{
  let bad = [], n = 0, refused = 0;
  const markups = [0, 10, 15, 20, 25, 30, 33, 35, 40, 17.5];
  const views = [[true, false], [false, true], [true, true], [false, false]];
  for (let e = 0; e < 60; e++) {
    for (const mk of markups) {
      const [sl, sm] = views[e % 4];
      const modes = ['all'].concat(sl ? ['labor'] : [], sm ? ['mat'] : []);
      for (const mode of modes) {
        const est = { markupPct: mk, showLaborCost: sl, showMaterialsCost: sm, labor: [line(), line(), line()].slice(0, 1 + (e % 3)), materials: [line(), line()].slice(0, (e % 3)) };
        const target = rnd() < 0.5 ? Math.round(1000 + rnd() * 40000) : Math.round((1000 + rnd() * 40000) * 100) / 100;
        const r = run(est, target, mode);
        if (r.refused) { refused++; continue; }  /* "Too low - materials alone are ..." is a refusal, not a total */
        n++;
        if (r.dash !== target || r.server !== target) bad.push({ mk, sl, sm, mode, target, ...r });
      }
    }
  }
  ok(`EVERY ONE OF ${n} estimates / markups / views / modes lands exactly on the typed total (${refused} too-low totals refused, as before)`, bad.length === 0 && n > 900, JSON.stringify(bad.slice(0, 3)));
}
{
  const est = { markupPct: 25, showLaborCost: true, showMaterialsCost: false, labor: [{ qty: 10, rate: 50 }, { qty: 1, rate: 100 }], materials: [] };
  run(est, 2750, 'all');
  const rates = est.labor.map((l) => l.rate);
  ok('the rates stay normal money: 2 decimals where that is enough', rates.every((r) => Math.round(r * 100) / 100 === r), JSON.stringify(rates));
  ok('the fine-tuning is the last step, before the price is re-stamped', DASH.indexOf('_stLandExact(est, target, _stMode, _isPinned);') > DASH.indexOf('if(_stMode === "all"){') && DASH.indexOf('_stLandExact(est, target, _stMode, _isPinned);') < DASH.indexOf('currentRecord.customerFinalTotal = Math.round(target * 100) / 100;'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
