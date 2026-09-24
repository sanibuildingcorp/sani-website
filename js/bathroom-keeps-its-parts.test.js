/* bathroom-keeps-its-parts.test.js — run: node js/bathroom-keeps-its-parts.test.js
 *
 *   The regenerated Astoria estimate came back with seven cards: Bathroom
 *   $16,817.79, Windows, Painting, Flooring - and Doors $1,258.38,
 *   Electrical $226.51, Plumbing $225.26. "Doors" held the shower glass
 *   enclosure and the floor trim at the doorways; Electrical held the vanity
 *   light and the GFCI; Plumbing the fixture hook-ups. "Yes fix it."
 *
 * With a Bathroom on the job its plumbing, wiring and waterproofing stay in
 * it, unless the CUSTOMER picked that trade as a service of its own (the
 * analyst adding it does not count). A shower door, flooring at a doorway
 * and "paint the doors" are not doors the customer is buying. Same total,
 * four cards.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const DP = require(path.join(ROOT, 'netlify/functions/lib/deterministic-pricing.js'));
const GEN = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

const PICKED = ['Bathroom', 'Flooring', 'Painting', 'Windows'];
function job() {
  return {
    markupPct: 25, showLaborCost: false, showMaterialsCost: false,
    labor: [
      { section: 'Bathroom', item: 'Bathroom demolition', qty: 20, rate: 70 },
      { section: 'Bathroom', item: 'Tile installation, walls and floor', qty: 40, rate: 90 },
      { section: 'Plumbing', item: 'Connect toilet, vanity faucet and shower valve trim', qty: 3, rate: 75 },
      { section: 'Electrical', item: 'Install GFCI outlet and reconnect exhaust fan', qty: 2, rate: 95 },
      { section: 'Electrical', item: 'Wire and install owner-supplied vanity light and switch', qty: 1.5, rate: 95 },
      { section: 'Doors', item: 'Install owner-supplied frameless glass shower door enclosure', qty: 4, rate: 90 },
      { section: 'Doors', item: 'Cut and finish flooring at doorways and door casings', qty: 3, rate: 80 },
      { section: 'Doors', item: 'Set three wood-finish transition strips at doorways', qty: 2, rate: 80 },
      { section: 'Flooring', item: 'Install engineered hardwood flooring', qty: 30, rate: 85 },
      { section: 'Painting', item: 'Paint walls, ceilings, doors and trim, two coats', qty: 40, rate: 65 },
      { section: 'Windows', item: 'Install replacement windows', qty: 12, rate: 90 },
    ],
    materials: [{ section: 'Electrical', item: 'GFCI receptacle and cover plate', qty: 1, rate: 38 }],
    customerSupplied: [], exclusions: [], options: [],
  };
}
const INPUT = { request: { service: 'Bathroom', selectedServices: PICKED, description: 'Gut the bathroom, new shower door and lighting, keep the plumbing layout. Hardwood floors through the apartment with transitions at the doorways. Paint everything, doors and trim included. Replace six windows.' } };
/* the analyst added three trades of its own, as it did on Astoria */
const ANALYSIS = { selected_trades: PICKED.concat(['Plumbing', 'Electrical', 'Doors']), customer_selected_services: PICKED, confirmed_scope: [{ trade: 'Plumbing' }, { trade: 'Electrical' }, { trade: 'Doors' }] };
const lineSum = (e) => [...e.labor, ...e.materials].reduce((t, l) => t + l.qty * l.rate, 0);
const names = (e) => (e.serviceBreakdown || []).map((c) => c.title || c.name).sort().join(',');

console.log('\n1. The Astoria shape: four cards again\n');
{
  const before = lineSum(job());
  const out = DP.consolidateCustomerPresentation(job(), ANALYSIS, INPUT);
  ok('FOUR CARDS: Bathroom, Flooring, Painting, Windows - no Doors, Electrical or Plumbing', names(out) === 'Bathroom,Flooring,Painting,Windows', names(out));
  const sec = (re) => out.labor.concat(out.materials).filter((l) => re.test(l.item)).map((l) => l.section);
  ok('the GFCI, the vanity light and the fixture hook-ups are Bathroom work', sec(/GFCI|vanity light|toilet, vanity faucet/).every((s) => s === 'Bathroom') && sec(/GFCI|vanity light|toilet, vanity faucet/).length === 4, JSON.stringify(sec(/GFCI|vanity light|toilet, vanity faucet/)));
  ok('the shower glass enclosure is Bathroom work', sec(/shower door enclosure/).join() === 'Bathroom', JSON.stringify(sec(/shower door enclosure/)));
  ok('flooring at the doorways and the transition strips are Flooring work', sec(/doorways/).every((s) => s === 'Flooring') && sec(/doorways/).length === 2, JSON.stringify(sec(/doorways/)));
  ok('"paint the doors and trim" is Painting work', sec(/Paint walls/).join() === 'Painting');
  ok('THE TOTAL DOES NOT MOVE - the same lines, regrouped', Math.abs(lineSum(out) - before) < 0.01, lineSum(out) + ' vs ' + before);
}

console.log('\n2. What the customer picks still gets its own card\n');
{
  const input = { request: { service: 'Bathroom', selectedServices: PICKED.concat(['Electrical']), description: INPUT.request.description } };
  const out = DP.consolidateCustomerPresentation(job(), Object.assign({}, ANALYSIS, { customer_selected_services: input.request.selectedServices }), input);
  ok('the customer picked Electrical: it stays its own card', names(out).split(',').indexOf('Electrical') !== -1 && names(out).split(',').indexOf('Plumbing') === -1, names(out));

  const doors = job();
  doors.labor.push({ section: 'Doors', item: 'Hang two new interior door slabs with hinges and lockset', qty: 6, rate: 85 });
  const din = { request: { service: 'Bathroom', selectedServices: PICKED.concat(['Doors']), description: 'Replace two interior doors. ' + INPUT.request.description } };
  const dout = DP.consolidateCustomerPresentation(doors, Object.assign({}, ANALYSIS, { customer_selected_services: din.request.selectedServices }), din);
  const dcard = (dout.serviceBreakdown || []).find((c) => (c.title || c.name) === 'Doors');
  ok('REAL DOORS STILL GET A DOORS CARD, holding only the door work', !!dcard && dout.labor.filter((l) => l.section === 'Doors').map((l) => l.item).join('|') === 'Hang two new interior door slabs with hinges and lockset', JSON.stringify(dout.labor.filter((l) => l.section === 'Doors').map((l) => l.item)));

  const noBath = { markupPct: 25, labor: [{ section: 'Electrical', item: 'Install four recessed lights and a dimmer switch', qty: 6, rate: 95 }, { section: 'Painting', item: 'Paint living room walls', qty: 12, rate: 65 }], materials: [], customerSupplied: [], exclusions: [], options: [] };
  const nin = { request: { service: 'Painting', selectedServices: ['Painting', 'Electrical'], description: 'Paint the living room and add recessed lights' } };
  const nout = DP.consolidateCustomerPresentation(noBath, { selected_trades: ['Painting', 'Electrical'], customer_selected_services: ['Painting', 'Electrical'], confirmed_scope: [] }, nin);
  ok('no bathroom on the job: Electrical is its own card as before', names(nout) === 'Electrical,Painting', names(nout));
}

console.log('\n2b. The second Astoria regenerate: a Doors card of floor prep and dust doors\n');
{
  const j = job();
  j.labor = j.labor.filter((l) => l.section !== 'Doors');
  j.labor.push({ section: 'Doors', item: 'Undercut door casings and jambs', qty: 3, rate: 80 },
               { section: 'Doors', item: 'Trim door bottoms and rehang interior doors', qty: 3, rate: 80 },
               { section: 'Doors', item: 'Temporary zipper dust doors at work areas', qty: 2, rate: 60 });
  const inp = { request: { service: 'Bathroom', selectedServices: PICKED, description: 'Gut the bathroom. New hardwood floors. Patch and paint walls, ceilings, doors and trim (if required). Replace six windows.' } };
  const before = lineSum(j);
  const out = DP.consolidateCustomerPresentation(j, ANALYSIS, inp);
  ok('NO DOORS CARD: undercutting casings, trimming door bottoms and dust doors are not doors being bought', names(out).split(',').indexOf('Doors') === -1, names(out));
  const secOf = (re) => out.labor.filter((l) => re.test(l.item)).map((l) => l.section);
  ok('undercutting the casings and trimming the door bottoms for the new floor are Flooring work', secOf(/Undercut|door bottoms/).every((x) => x === 'Flooring') && secOf(/Undercut|door bottoms/).length === 2, JSON.stringify(secOf(/Undercut|door bottoms/)));
  ok('the zipper dust doors are protection for the whole project, not a Doors line (so no Doors group on the dashboard either)', secOf(/zipper/).join() === 'Whole Project' && out.labor.find((l) => /zipper/.test(l.item)).sectionAsPriced === 'Doors', JSON.stringify(secOf(/zipper/)));
  ok('...and the total does not move', Math.abs(lineSum(out) - before) < 0.01);
}

console.log('\n3. The generator records what the customer picked\n');
{
  ok('customer_selected_services is the customer\'s own picks, apart from the analyst\'s selected_trades', /customer_selected_services: unique\(\[\.\.\.\(input\.request\.selectedServices \|\| \[\]\), input\.request\.service\]\.map\(titleCase\)\.filter\(Boolean\)\),/.test(GEN));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
