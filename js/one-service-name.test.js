/* one-service-name.test.js — run: node js/one-service-name.test.js
 *
 *   "the service cards prices different" - five cards on the dashboard at
 *   $2,167.45 each, "0 price lines" on every one, while the customer's page
 *   priced the same five cards by the work.
 *
 * consolidateCustomerPresentation files each line under a card by its words
 * and prices the cards from that, but the line kept the section the
 * estimator wrote ("General", "Painting & Patching"), so everything that
 * reads line.section - the dashboard's Services panel, the scope writer,
 * lib/customer-cards - found no line under any card. Now the line is told
 * which card it was priced into, and the project-wide cost is spread the
 * one way the dashboard spreads it (by labor weight), so every reader
 * prices the cards the same.
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DP = require(path.join(ROOT, 'netlify/functions/lib/deterministic-pricing.js'));
const CC = require(path.join(ROOT, 'netlify/functions/lib/customer-cards.js'));
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const r2 = (n) => Math.round(n * 100) / 100;

function job() {
  return {
    estimate: {
      markupPct: 25,
      /* as the generator writes them: the customer sees one total */
      showLaborCost: false, showMaterialsCost: false,
      labor: [
        { section: 'Painting & Patching', item: 'Fill and sand small holes, prime and paint walls and ceiling, two coats', qty: 40, unit: 'hrs', rate: 55 },
        { section: 'General', item: 'Remove old caulk at the tub and re-caulk', qty: 3, unit: 'hrs', rate: 60 },
        { section: 'Drywall Repair', item: 'Patch and skim drywall at the two damaged spots, sand and prime', qty: 8, unit: 'hrs', rate: 55 },
        { section: '', item: 'Repair one outlet and two recessed lights, replace the light switch', qty: 5, unit: 'hrs', rate: 85 },
        { section: 'Water Damage', item: 'Dry out the water-damaged corner and treat the mold', qty: 4, unit: 'hrs', rate: 60 },
        { section: 'General', item: 'Site protection, daily cleanup and debris removal', qty: 6, unit: 'hrs', rate: 45 },
      ],
      materials: [
        { section: 'Paint supplies', item: 'Paint, primer, spackle and sundries', qty: 1, unit: 'ls', rate: 480 },
        { section: 'General', item: 'Silicone tub caulk', qty: 2, unit: 'ea', rate: 12 },
      ],
      customerSupplied: [], exclusions: [], options: [],
    },
    analysis: { selected_trades: ['Painting', 'Bathroom', 'Drywall', 'Electrical', 'Water Damage'], confirmed_scope: [] },
    input: { request: { service: 'Painting Services', selectedServices: ['Painting', 'Bathroom', 'Drywall', 'Electrical', 'Water Damage'], description: 'Studio repaint, patching, minor electrical, caulk the tub, treat a mold spot' } },
  };
}

console.log('\n1. Every line is told which card it was priced into\n');
{
  const j = job();
  const est = DP.consolidateCustomerPresentation(j.estimate, j.analysis, j.input);
  const titles = est.serviceBreakdown.map((s) => s.title);
  const lines = est.labor.concat(est.materials);
  ok('FIVE CARDS, the ones the customer picked', titles.join(',') === 'Painting,Bathroom,Drywall,Electrical,Water Damage', titles.join(','));
  const filed = lines.filter((l) => titles.indexOf(l.section) !== -1);
  ok('EVERY LINE THAT BELONGS TO A CARD CARRIES THAT CARD\'S NAME as its section', filed.length === 7, lines.map((l) => l.section + ' <- ' + (l.sectionAsPriced === undefined ? '(kept)' : JSON.stringify(l.sectionAsPriced))).join(' | '));
  ok('...the caulking line moved from General to Bathroom, the lights from nothing to Electrical, the drywall from "Drywall Repair" to Drywall, and each remembers the name it came with', est.labor[1].section === 'Bathroom' && est.labor[1].sectionAsPriced === 'General' && est.labor[3].section === 'Electrical' && est.labor[3].sectionAsPriced === '' && est.labor[2].section === 'Drywall' && est.labor[2].sectionAsPriced === 'Drywall Repair' && est.materials[1].section === 'Bathroom');
  ok('a line already named right keeps its name and no note', est.labor[4].section === 'Water Damage' && est.labor[4].sectionAsPriced === undefined);
  ok('a project-wide line (protection and cleanup) belongs to no card and keeps its own section', est.labor[5].section === 'General' && est.labor[5].sectionAsPriced === undefined);
  ok('EVERY CARD OWNS AT LEAST ONE LINE by section - the dashboard will show them', titles.every((t) => lines.some((l) => l.section === t)));
}

console.log('\n2. One price per card, wherever it is read\n');
{
  const j = job();
  const est = DP.consolidateCustomerPresentation(j.estimate, j.analysis, j.input);
  const server = {}; est.serviceBreakdown.forEach((s) => { server[s.title] = s.subtotal; });
  const cards = CC.customerCards({ estimate: est }).cards;
  const lib = {}; cards.forEach((c) => { lib[c.title] = c.subtotal; });
  const priced = CC.pricedFromLines(est, est.serviceBreakdown.map((s) => s.title));
  ok('THE CUSTOMER\'S CARDS (consolidation) AND THE DASHBOARD\'S RULE (customer-cards, by section, loose cost by labor weight) GIVE THE SAME PRICES, to the cent', Object.keys(server).every((t) => Math.abs(server[t] - priced[t]) < 0.011), JSON.stringify(server) + ' vs ' + JSON.stringify(priced));
  ok('...and they add up to the customer total', Math.abs(cards.reduce((a, c) => a + c.subtotal, 0) - CC.customerCards({ estimate: est }).total) < 0.011 && Object.keys(lib).every((t) => Math.abs(lib[t] - server[t]) < 1));
  const sum = est.serviceBreakdown.reduce((a, s) => a + s.subtotal, 0);
  const total = r2((est.labor.concat(est.materials)).reduce((a, l) => a + l.qty * l.rate, 0) * 1.25);
  ok('the total never moved', Math.abs(sum - total) < 0.02, sum + ' vs ' + total);
  ok('NOT FIVE EQUAL CARDS: painting is the big one, electrical is small', server.Painting > 2 * server.Electrical && server.Painting > server.Bathroom, JSON.stringify(server));
  ok('the loose protection line is spread by labor weight: Painting gets the most of it', (() => { const own = { Painting: 40 * 55 + 480, Electrical: 5 * 85 }; return (server.Painting / 1.25 - own.Painting) > (server.Electrical / 1.25 - own.Electrical); })());
}
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
