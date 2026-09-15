/* quote-breakdown.test.js — run: node js/quote-breakdown.test.js
 *
 *   "when i wanna show customers the materials brake down what's including
 *    it's shows uneven"
 *
 * WHAT WENT WRONG, AND WHY ONLY SOMETIMES. The breakdown table has three
 * columns when prices are shown: what kind of line it is, what it is, what it
 * costs. The stylesheet formatted the money column the way a money column
 * should be formatted:
 *
 *   .lines td:last-child { text-align: right; white-space: nowrap }
 *
 * But the contractor can publish the list WITHOUT the prices — that is the
 * whole point of the "…WITH PRICES / off" switch, so a customer can see WHICH
 * materials are going in without seeing what each one cost. With prices off
 * there is no money cell, so the DESCRIPTION became the last child and
 * inherited both rules:
 *
 *   right-aligned  -> every line starts at a different place down the left,
 *                     which is exactly the "uneven" in the report
 *   nowrap         -> "Plumbing rough materials — supply and waste…" cannot
 *                     break, so it runs off the right edge and is cut in half
 *
 * Turn prices on and the table looks perfect, because the money cell is last
 * again. The layout was only broken in the mode the contractor actually uses.
 *
 * Money is now matched by class rather than by position, so the description is
 * never formatted as a price no matter which columns exist.
 *
 * The real details() is lifted out of quote.html and executed. calc() is the
 * one stub here — details() reads exactly three fields off it — and the stub is
 * asserted against the live function so it cannot drift silently.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const QUOTE = fs.readFileSync(path.join(ROOT, 'quote.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

function ext(name) {
  const s = QUOTE.search(new RegExp('function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = QUOTE.indexOf('{', s); j < QUOTE.length; j++) {
    if (QUOTE[j] === '{') d++;
    else if (QUOTE[j] === '}') { d--; if (!d) return QUOTE.slice(s, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

const ctx = { console, String, Number, Array, Object, JSON, RegExp };
ctx.window = ctx; vm.createContext(ctx);
const helpers = QUOTE.split('\n').find(l => l.startsWith('const A=v=>Array.isArray'));
if (!helpers) throw new Error('quote.html no longer declares A/E/M/C/N/LT on one line');
vm.runInContext(helpers, ctx);
['itemText', 'isOption', 'inSvc', 'trade', 'details'].forEach(function (n) {
  try { vm.runInContext(ext(n), ctx); } catch (e) { if (n !== 'trade') throw e; }
});
/* details() reads only these three off calc(). Asserted below. */
vm.runInContext('function calc(e){return {showLabor:true,showMat:true,k:1}}', ctx);
ok('the calc() stub still covers everything details() reads off it',
  ['showLabor', 'showMat', 'k'].every(f => new RegExp('ct\\.' + f + '\\b').test(ext('details'))) &&
  (ext('details').match(/ct\.[a-zA-Z]+/g) || []).every(m => ['ct.showLabor', 'ct.showMat', 'ct.k'].indexOf(m) !== -1),
  (ext('details').match(/ct\.[a-zA-Z]+/g) || []).join(' '));

const SERVICE = { title: 'Bathroom' };
const MATERIALS = [
  { item: 'Plumbing rough materials — supply and waste lines, valves and fittings', section: 'Bathroom', qty: 1, rate: 1840 },
  { item: 'Tile allowance — porcelain wall and floor tile', section: 'Bathroom', qty: 1, rate: 3200 },
  { item: 'Shower enclosure — clear tempered frameless glass', section: 'Bathroom', qty: 1, rate: 2100 }
];
const LABOR = [{ item: 'Tile installation', section: 'Bathroom', qty: 40, rate: 95 }];
const rows = (html) => html.match(/<tr>[\s\S]*?<\/tr>/g) || [];
const cells = (tr) => tr.match(/<td[^>]*>[\s\S]*?<\/td>/g) || [];

/* ══ THE MODE THE CONTRACTOR ACTUALLY USES ════════════════════════════════ */
console.log('\nmaterials listed WITHOUT prices — the switch that was broken\n');
{
  ctx.est = { showMaterialLines: true, showMaterialLinePrices: false, materials: MATERIALS, labor: [] };
  ctx.svc = SERVICE;
  const html = vm.runInContext('details(est,svc)', ctx);
  const rs = rows(html);
  ok('every material is listed', rs.length === MATERIALS.length, rs.length + ' rows');

  const desc = rs.map(r => cells(r)[1]);
  ok('THE DESCRIPTION IS NOT FORMATTED AS A PRICE — this is the "uneven"',
    desc.every(c => !/class="[^"]*\bamt\b/.test(c)), desc[0]);
  ok('NO PRICE CELL EXISTS, so nothing can be right-aligned by accident',
    !/\bamt\b/.test(html) && !/\$/.test(html), (html.match(/\$[\d,.]+/g) || []).join(' '));
  ok('each row is two cells: what kind of line, and what it is',
    rs.every(r => cells(r).length === 2));
  ok('the long material name survives in full, uncut',
    html.indexOf('supply and waste lines, valves and fittings') !== -1);
}

/* ══ THE MODE THAT ALWAYS LOOKED FINE ═════════════════════════════════════ */
console.log('\nmaterials listed WITH prices — must not have regressed\n');
{
  ctx.est = { showMaterialLines: true, showMaterialLinePrices: true, materials: MATERIALS, labor: [] };
  const html = vm.runInContext('details(est,svc)', ctx);
  const rs = rows(html);
  ok('three cells per row now', rs.every(r => cells(r).length === 3));
  ok('THE MONEY CELL IS MARKED AS MONEY, not merely last',
    rs.every(r => /class="[^"]*\bamt\b/.test(cells(r)[2])), cells(rs[0])[2]);
  ok('...and it holds the amount', /\$1,840\.00/.test(html));
  ok('the description is still not marked as money',
    rs.every(r => !/class="[^"]*\bamt\b/.test(cells(r)[1])));
}

/* ══ THE MIXED CASE, WHICH IS REAL ════════════════════════════════════════ */
console.log('\nlabor priced but materials not — the two switches are independent\n');
{
  ctx.est = {
    showLaborLines: true, showLaborLinePrices: true, labor: LABOR,
    showMaterialLines: true, showMaterialLinePrices: false, materials: MATERIALS
  };
  const html = vm.runInContext('details(est,svc)', ctx);
  const rs = rows(html);
  ok('every line is present, labor and materials together', rs.length === 4, rs.length + ' rows');
  const priced = rs.filter(r => /\bamt\b/.test(r));
  ok('only the labor line carries money', priced.length === 1, priced.length + ' priced rows');
  ok('THE UNPRICED ROWS SPAN THE EMPTY MONEY COLUMN instead of leaving a ragged edge',
    rs.filter(r => !/\bamt\b/.test(r)).every(r => /colspan="2"/.test(cells(r)[1])));
  ok('...and the priced row does not span anything',
    !/colspan/.test(priced[0]));
}

/* ══ THE RULE ITSELF ══════════════════════════════════════════════════════ */
console.log('\nthe stylesheet matches money by name, not by position\n');
{
  ok('A CELL IS RIGHT-ALIGNED AND UNWRAPPED ONLY WHEN IT IS MONEY',
    /\.lines td\.amt\s*\{[^}]*text-align:\s*right[^}]*white-space:\s*nowrap/.test(QUOTE),
    (QUOTE.match(/\.lines td[^{]*\{[^}]*\}/g) || []).join('\n        '));
  ok('THE POSITION-BASED RULE IS GONE — it is what broke the description',
    !/\.lines td:last-child\s*\{[^}]*(white-space|text-align)/.test(QUOTE));
  ok('a long material name is allowed to wrap rather than run off the page',
    /\.lines td\s*\{[^}]*overflow-wrap:\s*anywhere/.test(QUOTE));
  ok('the kind-of-line column is held narrow so the description gets the room',
    /\.lines td:first-child\s*\{[^}]*width:/.test(QUOTE));
  ok('the table still cannot push the page sideways',
    /\.lines\s*\{[^}]*table-layout:\s*fixed/.test(QUOTE));
}

/* ══ WHAT MUST NOT HAVE BROKEN ════════════════════════════════════════════ */
console.log('\nthe rest of the breakdown behaves as before\n');
{
  ctx.est = { showMaterialLines: false, showLaborLines: false, materials: MATERIALS, labor: LABOR };
  ok('nothing is shown when both switches are off',
    vm.runInContext('details(est,svc)', ctx) === '');

  ctx.est = { showMaterialLines: true, showMaterialLinePrices: false,
    materials: MATERIALS.concat([{ item: 'Option B — upgraded vanity', section: 'Bathroom', qty: 1, rate: 900 }]), labor: [] };
  ok('priced alternatives stay out of the included list',
    rows(vm.runInContext('details(est,svc)', ctx)).length === MATERIALS.length);

  ctx.est = { showMaterialLines: true, showMaterialLinePrices: false,
    materials: [{ item: 'Tile <b>allowance</b> & grout', section: 'Bathroom', qty: 1, rate: 10 }], labor: [] };
  ok('markup in a material name is escaped, not rendered',
    vm.runInContext('details(est,svc)', ctx).indexOf('<b>allowance</b>') === -1);

  ctx.est = { showMaterialLines: true, showMaterialLinePrices: false, materials: MATERIALS, labor: [] };
  ok('the summary still counts what is inside it',
    /<summary>[^<]*\(3\)<\/summary>/.test(vm.runInContext('details(est,svc)', ctx)));
  ok('...and says "what is included" when no prices are shown',
    /View what is included in detail/.test(vm.runInContext('details(est,svc)', ctx)));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
