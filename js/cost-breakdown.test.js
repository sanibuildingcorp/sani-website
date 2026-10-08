// node js/cost-breakdown.test.js
const fs = require('fs'), path = require('path');
const b = require('./cost-breakdown.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? 'PASS  ' : 'FAIL  ') + n); };
const e = { markupPct: 20, labor: [{ item: 'Demo', section: 'Bathroom', qty: 10, rate: 65 }, { item: 'Debris disposal', section: 'Bathroom', qty: 1, rate: 350 }, { item: 'Tile install', section: 'Tile', qty: 40, rate: 75 }], materials: [{ item: 'Cement board', section: 'Bathroom', qty: 8, rate: 22.37 }, { item: 'Floor protection', section: 'Tile', qty: 1, rate: 40 }, { item: 'Grab bar', section: 'Nowhere', qty: 2, rate: 30 }] };
const x = b.build(e, ['Bathroom', 'Tile'], 7543.21);
const sum = x.services.reduce((a, r) => a + r.total, 0);
ok('rows add up to the customer total to the cent', Math.abs(sum - 7543.21) < 0.001 && Math.abs(x.totals.labor + x.totals.materials + x.totals.other - 7543.21) < 0.001);
ok('disposal and protection go to Other', x.services[0].other > 0 && x.services[1].other > 0);
ok('a line with an unknown section goes to Whole project', x.services.some((s) => s.title === 'Whole project'));
ok('no raw cost appears (amounts are marked up)', x.services[0].labor !== 650);
ok('nothing to break down -> null', b.build({}, ['A'], 100) === null);
const q = fs.readFileSync(path.join(__dirname, '..', 'quote.html'), 'utf8');
const m = q.match(/\/\* COST-BREAKDOWN START \(copy of js\/cost-breakdown\.js\) \*\/\n([\s\S]*?)\/\* COST-BREAKDOWN END \*\//);
const y = b.build({ labor: [{ item: 'Bathroom demolition to studs + disposal', section: 'A', qty: 1, rate: 1845 }, { item: '10-yard container, delivered', section: 'A', qty: 1, rate: 275 }, { item: 'Daily cleanup, debris removal & final clean', section: 'A', qty: 1, rate: 100 }] }, ['A'], 2220);
ok('demolition with disposal counts as Labor; container and cleanup go to Other', y.services[0].labor === 1845 && y.services[0].other === 375);
ok('quote.html carries an identical copy', m && m[1] === fs.readFileSync(path.join(__dirname, 'cost-breakdown.js'), 'utf8'));
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
