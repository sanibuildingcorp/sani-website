/* one-scope.test.js — run: node js/one-scope.test.js
 *
 *   "Look whats shows customer side and whats shows in my dashboard, check
 *    and see if you can found unmatched between them ... in my dashboard
 *    shows me too many texts and each estimate i spend a lot time for
 *    understanding what's generated and then ... headache to read on
 *    customer side too."
 *
 * Three texts for one job. The dashboard box held the analyst's raw scope
 * blocks plus the price lines (the same work twice, "BATHROOM:" then
 * "BATHROOM — DEMOLITION:", "— WATERPROOFING:" ...); the customer's card held
 * the scope writer's sentences, cut at eight so the tile was never set; and
 * "Not included" said asbestos twice. Now: the box is built from the cards
 * and only the cards, a longer job keeps its steps up to twelve, a reworded
 * card line is reworded in the box, and a repeated exclusion is one line.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const SW = require(path.join(ROOT, 'netlify/functions/lib/scope-writer.js'));
const ST = require(path.join(ROOT, 'netlify/functions/lib/scope-text.js'));
const R = require(path.join(ROOT, 'netlify/functions/lib/reword.js'));
const GEN = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'), 'utf8');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

const STEPS = [
  'We cover the fixtures, the wall tile and the hallway to the elevator.',
  'We take off the glass shower door and panel, and put them back after the tile work.',
  'We remove the shower floor tile and the mortar bed below it.',
  'We bag the debris and carry it out by elevator.',
  'We reset the shower drain to the height of the new floor.',
  'We build a new mortar bed sloped toward the drain.',
  'We build a small bench inside the shower, anchored to the walls and floor.',
  'We apply a liquid waterproofing membrane to the floor, wall base, curb and bench.',
  'We set new mosaic tile on the shower floor, the bench top and the bench faces.',
  'We grout the new tile and run flexible sealant at the corners and curb.',
  'We patch the wall tile at the floor line and where the bench meets the wall.',
];
const DUMP = 'BATHROOM:\n• Protection of bathroom fixtures\n• Take off glass shower door\n\nBATHROOM — DEMOLITION (SHOWER FLOOR ONLY):\n• Remove existing shower floor tile within the shower enclosure\n\nBATHROOM — WATERPROOFING:\n• Install new sloped setting bed / pre-slope pitched to the existing drain';
function est() {
  return {
    scopeOfWork: DUMP,
    serviceBreakdown: [{ title: 'Bathroom', subtotal: 4500.01, included: ['Protect the work area; remove finishes; dispose of debris', 'Prepare substrates and install tile'], notIncluded: ['Asbestos or mold testing and removal', 'Structural work'] }],
    labor: [{ section: 'Bathroom', item: 'Shower floor rebuild', qty: 24, unit: 'hrs', rate: 95 }], materials: [],
  };
}

console.log('\n1. The text is the cards\n');
{
  const e = { serviceBreakdown: [{ title: 'Bathroom', included: ['Set the tile.', 'Grout it.'] }, { title: 'Painting', included: [{ item: 'Two coats.' }] }, { title: 'Empty', included: [] }] };
  ok('one header per service, one bullet per line, an empty card skipped', ST.scopeTextFromCards(e) === 'BATHROOM:\n• Set the tile.\n• Grout it.\n\nPAINTING:\n• Two coats.', JSON.stringify(ST.scopeTextFromCards(e)));
  const blank = { scopeOfWork: 'keep me', serviceBreakdown: [] };
  ST.syncScopeText(blank);
  ok('no cards: the box is left as it was, never blanked', blank.scopeOfWork === 'keep me' && ST.scopeTextFromCards({}) === '');
  ok('mirrorsCards: a box that equals the cards (any case) or is empty is a mirror; hand-written text is not', ST.mirrorsCards({ scopeOfWork: 'bathroom:\n• set the tile.', serviceBreakdown: [{ title: 'Bathroom', included: ['Set the tile.'] }] }) === true && ST.mirrorsCards({ scopeOfWork: '', serviceBreakdown: [] }) === true && ST.mirrorsCards({ scopeOfWork: 'My own words', serviceBreakdown: [{ title: 'Bathroom', included: ['Set the tile.'] }] }) === false);
}

console.log('\n2. The scope writer: the box follows the cards, the job is not cut short, an exclusion is said once\n');
{
  const e = est();
  SW.applyScopeToEstimate(e, { services: [{ service: 'Bathroom', included: STEPS.slice(), notIncluded: ['Asbestos or mold testing, abatement or remediation', 'Permits or building department filings'] }], timeline: '' });
  const card = e.serviceBreakdown[0];
  ok('ELEVEN STEPS STAY ELEVEN: the tile is set, grouted and the wall patched - not cut at eight after the waterproofing', card.included.length === 11 && /set new mosaic tile/i.test(card.included[8]) && /patch the wall tile/i.test(card.included[10]), card.included.length + ' ' + card.included[card.included.length - 1]);
  ok('THE BOX IS THE CARD: scopeOfWork is exactly the card, header and bullets; the analyst dump is gone', e.scopeOfWork === ST.scopeTextFromCards(e) && /^BATHROOM:\n• We cover the fixtures/.test(e.scopeOfWork) && e.scopeOfWork.indexOf('DEMOLITION') === -1 && e.scopeOfWork.indexOf('WATERPROOFING:') === -1 && e.scopeOfWork.split('•').length === 12, e.scopeOfWork.slice(0, 120));
  ok('ASBESTOS ONCE: the pipeline\'s line stays, the writer\'s rewording of it is dropped, the other exclusions stay', card.notIncluded.length === 3 && card.notIncluded[0] === 'Asbestos or mold testing and removal.' && card.notIncluded[1] === 'Structural work.' && /^Permits or building department filings\.$/.test(card.notIncluded[2]), JSON.stringify(card.notIncluded));
  ok('two work lines that share their words are two steps, not one', SW.nearDedupe(['Remove the existing shower floor tile and mortar bed', 'Set the new shower floor tile on the sloped bed']).length === 2 && SW.nearDedupe(['Asbestos or mold testing and removal', 'Asbestos or mold testing, abatement or remediation']).length === 1);
  const many = est();
  SW.applyScopeToEstimate(many, { services: [{ service: 'Bathroom', included: STEPS.concat(['Extra step one here.', 'Extra step two here.', 'Extra step three here.']) }] });
  ok('fourteen lines stop at twelve; the prompt still asks for eight', many.serviceBreakdown[0].included.length === 12 && SW.HARD_MAX_BULLETS === 12 && SW.MAX_BULLETS === 8 && /3 to 8 bullets|\$\{jobSize\.isRepair\(analysis\) \? 4 : MAX_BULLETS\} bullets/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/lib/scope-writer.js'), 'utf8')));
  const failed = est();
  SW.applyScopeToEstimate(failed, null, 'model failed');
  ok('when the writer fails the box still follows the cards (phrase-library wording), not the dump', failed.scopeOfWork === 'BATHROOM:\n• Protect the work area; remove finishes; dispose of debris.\n• Prepare substrates and install tile.' && failed.scopeWriter.note === 'model failed', failed.scopeOfWork);
}

console.log('\n3. The generator writes the cards into the box before and after the writer\n');
{
  ok('syncScopeText is required and runs right after consolidateCustomerPresentation, before the scope writer', /const \{ syncScopeText \} = require\("\.\/lib\/scope-text"\);/.test(GEN) && /estimate = consolidateCustomerPresentation\(estimate, projectAnalysis, input\);[\s\S]{0,900}?syncScopeText\(estimate\);[\s\S]*?await writeCustomerScope\(/.test(GEN));
  ok('the dashboard box says what it is', /Scope of Work \(the same lines the customer reads on each service card\)/.test(DASH) && !/Use CATEGORY: headers/.test(DASH));
}

console.log('\n4. A reworded card line is reworded in the box; a hand-written box is left alone\n');
{
  const rec = { estimate: { serviceBreakdown: [{ title: 'Bathroom', subtotal: 4500.01, included: ['We grout the new tile.', 'We patch the wall tile.'], notIncluded: [] }], labor: [{ section: 'Bathroom', item: 'Tile', qty: 1, unit: 'ls', rate: 4000 }], materials: [] } };
  rec.estimate.scopeOfWork = ST.scopeTextFromCards(rec.estimate);
  const out = R.applyEdits(rec, [{ where: 'included', service: 'Bathroom', from: 'We grout the new tile.', to: 'We grout the new tile and seal the corners.' }]);
  ok('the card line changed, and the box changed with it', out.applied.length === 1 && rec.estimate.serviceBreakdown[0].included[0] === 'We grout the new tile and seal the corners.' && rec.estimate.scopeOfWork === 'BATHROOM:\n• We grout the new tile and seal the corners.\n• We patch the wall tile.', rec.estimate.scopeOfWork);
  const out2 = R.applyEdits(rec, [{ where: 'included', service: 'Bathroom', from: 'We patch the wall tile.', to: '' }]);
  ok('a removed card line leaves the box too', out2.applied.length === 1 && rec.estimate.scopeOfWork === 'BATHROOM:\n• We grout the new tile and seal the corners.', rec.estimate.scopeOfWork);
  const hand = { estimate: { scopeOfWork: 'Zura wrote this himself', serviceBreakdown: [{ title: 'Bathroom', subtotal: 100, included: ['We grout the new tile.'], notIncluded: [] }], labor: [], materials: [] } };
  R.applyEdits(hand, [{ where: 'included', service: 'Bathroom', from: 'We grout the new tile.', to: 'We grout it.' }]);
  ok('a hand-written box is his: the card changes, the box does not', hand.estimate.serviceBreakdown[0].included[0] === 'We grout it.' && hand.estimate.scopeOfWork === 'Zura wrote this himself');
  const ex = { estimate: { serviceBreakdown: [{ title: 'Bathroom', subtotal: 100, included: ['We grout.'], notIncluded: ['Permits'] }], labor: [], materials: [] } };
  ex.estimate.scopeOfWork = ST.scopeTextFromCards(ex.estimate);
  R.applyEdits(ex, [{ where: 'excluded', service: 'Bathroom', from: 'Permits', to: 'Permits and filings' }]);
  ok('an exclusion edit does not touch the box (the box lists the work, not the limits)', ex.estimate.serviceBreakdown[0].notIncluded[0] === 'Permits and filings' && ex.estimate.scopeOfWork === 'BATHROOM:\n• We grout.');
}
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
