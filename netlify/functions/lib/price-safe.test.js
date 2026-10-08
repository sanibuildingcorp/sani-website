// node netlify/functions/lib/price-safe.test.js
const { priceSafe } = require('./price-safe');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? 'PASS  ' : 'FAIL  ') + n); };
const LT = (l) => (+l.qty || 0) * (+l.rate || 0), r2 = (x) => Math.round(x * 100) / 100;
const grand = (e) => r2(e.labor.concat(e.materials).reduce((s, l) => s + LT(l), 0) * (1 + (+e.markupPct || 0) / 100));
const e = { markupPct: 41, totals: { labor: 100, cost: 900, profit: 400, total: 1300 }, ownerNotes: 'x', markupRecommendation: { pct: 30 },
  labor: [{ section: 'Bath', item: 'Demo', qty: 13.3, unit: 'hrs', rate: 27.04, bookId: 'b1', why: 'secret' }, { section: 'Bath', item: 'Tile', qty: 75, unit: 'sf', rate: 7.89, factor: 1.2 }],
  materials: [{ section: 'Bath', item: 'Wall tile', qty: 83, unit: 'sf', rate: 2.53, matKey: 'm', finish: true, link: 'https://x' }],
  parkedLines: [{ custSupplied: true, line: { item: 'Vanity', rate: 400, qty: 1 } }] };
const before = grand(e);
priceSafe(e);
ok('customer total is unchanged to the cent', grand(e) === before);
ok('markup is gone', e.markupPct === 0);
ok('no hours, units, rates per unit, book ids or notes on the lines', e.labor.concat(e.materials).every((l) => l.qty === 1 && !('unit' in l) && !('bookId' in l) && !('why' in l) && !('factor' in l) && !('matKey' in l)));
ok('finish card fields stay', e.materials[0].finish === true && e.materials[0].link === 'https://x' && e.materials[0].item === 'Wall tile');
ok('totals keep only the customer total', JSON.stringify(e.totals) === '{"total":1300}');
ok('owner notes and markup advice removed', !e.ownerNotes && !e.markupRecommendation);
ok('customer-supplied line loses its price', e.parkedLines[0].line.rate === undefined && e.parkedLines[0].line.item === 'Vanity');
ok('timeline computed from the real hours', e.schedule && e.schedule.workDays > 0 && e.pricesBaked === true);
const again = JSON.stringify(e); priceSafe(e); ok('running twice changes nothing', JSON.stringify(e) === again);
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
