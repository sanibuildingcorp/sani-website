/* recard.test.js — repairing a stored record must never move the money.
 * Run:  node netlify/functions/lib/recard.test.js
 *
 * The whole value of recard.js is its refusal. So most of this file is about
 * making it refuse: the guard is tested harder than the happy path, because a
 * silent repair that shifts an approved total is worse than no repair at all.
 */

const { recardEstimate } = require('./recard');
const customerTotals = require('./customer-total');

let pass = 0, fail = 0;
const t = (n, c, d) => { c ? pass++ : fail++; console.log((c ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* A stair job carrying a phantom Painting card, exactly the shape that reached a
   live customer: the card set is wrong, the money is right. */
function stored(over) {
  return Object.assign({
    ref: 'SBC-260805-XQNQ',
    status: 'accepted',
    customer: { name: 'A Customer', email: 'c@example.com' },
    request: {
      service: 'Stairs',
      selectedServices: ['Stairs'],
      description: 'Rebuild the interior staircase. Stain the new stair to match the painted trim in the hall.',
    },
    projectAnalysis: { selected_trades: ['Stairs'], confirmed_scope: [{ trade: 'Stairs' }] },
    estimate: {
      markupPct: 45,
      showLaborCost: true, showMaterialsCost: true,
      labor: [
        { section: 'Stairs', item: 'Demo existing treads, risers and balustrade', qty: 1, unit: 'ls', rate: 1800 },
        { section: 'Stairs', item: 'Install new oak treads and risers', qty: 14, unit: 'ea', rate: 240 },
        { section: 'Stairs', item: 'Install newel post, balusters and handrail', qty: 1, unit: 'ls', rate: 3200 },
      ],
      materials: [
        { section: 'Stairs', item: 'Red oak treads, risers, newel, balusters, handrail', qty: 1, unit: 'ls', rate: 4200 },
        { section: 'Painting', item: 'Canvas drop cloths, rosin paper, painters and masking tape', qty: 1, unit: 'ls', rate: 380 },
      ],
      serviceBreakdown: [
        { title: 'Painting', subtotal: 551.00, included: ['Drop cloths'], customerSupplies: [], notIncluded: [], options: [] },
        { title: 'Stairs', subtotal: 18719.00, included: ['Stair rebuild'], customerSupplies: [], notIncluded: [], options: [] },
      ],
    },
  }, over || {});
}

console.log('\n1. The repair itself');
{
  const rec = stored();
  const totalBefore = customerTotals(rec.estimate, rec).customerTotal;
  const r = recardEstimate(rec);

  t('the repair is allowed', r.ok, r.reason);
  t('the phantom Painting card is gone',
    !r.cardsAfter.includes('Painting'), JSON.stringify(r.cardsAfter));
  t('the real card survives', r.cardsAfter.includes('Stairs'), JSON.stringify(r.cardsAfter));
  t('the customer-facing total does not move, to the cent',
    Math.abs(r.after - r.before) < 0.005,
    'before $' + r.before.toFixed(2) + '   after $' + r.after.toFixed(2));
  t('it reports that something changed', r.changed === true, r.reason);
  t('the ORIGINAL record was not mutated',
    rec.estimate.serviceBreakdown.some(x => x.title === 'Painting') &&
    Math.abs(customerTotals(rec.estimate, rec).customerTotal - totalBefore) < 0.005,
    JSON.stringify(rec.estimate.serviceBreakdown.map(x => x.title)));
  t('the priced lines are untouched',
    JSON.stringify(r.estimate.labor) === JSON.stringify(rec.estimate.labor) &&
    JSON.stringify(r.estimate.materials) === JSON.stringify(rec.estimate.materials));
}

console.log('\n2. A record that is already correct');
{
  const rec = stored();
  const first = recardEstimate(rec);
  rec.estimate = first.estimate;
  const second = recardEstimate(rec);
  t('running it twice is a no-op the second time', second.ok && second.changed === false, second.reason);
  t('and it is idempotent on the cards',
    JSON.stringify(second.cardsAfter) === JSON.stringify(first.cardsAfter),
    JSON.stringify(first.cardsAfter) + ' vs ' + JSON.stringify(second.cardsAfter));
}

console.log('\n3. The refusals');
{
  t('no estimate at all', !recardEstimate({ ref: 'X' }).ok);
  t('no record at all', !recardEstimate(null).ok);

  const noLines = stored();
  noLines.estimate.labor = [];
  noLines.estimate.materials = [];
  const r = recardEstimate(noLines);
  t('an estimate with no lines is REFUSED, not emptied', !r.ok, r.reason);
  t('   ...and says why', /no labor or materials lines/.test(r.reason), r.reason);
}

console.log('\n4. A stamped customerFinalTotal is honoured, not recomputed');
{
  /* The stamp lives on the RECORD, not on the estimate — customer-total.js reads
     record.customerFinalTotal, and it is written when the customer accepts. */
  const rec = stored();
  rec.customerFinalTotal = 20000;
  const r = recardEstimate(rec);
  t('the stamped total is what is compared', Math.abs(r.before - 20000) < 0.005, 'before $' + r.before);
  t('and it is unchanged by the repair', Math.abs(r.after - 20000) < 0.005, 'after $' + r.after);
  t('the repair is still allowed', r.ok, r.reason);
}

console.log('\n5. The toggle states — the total follows what the contractor shows');
{
  for (const [label, flags] of [
    ['labor only',     { showLaborCost: true,  showMaterialsCost: false }],
    ['materials only', { showLaborCost: false, showMaterialsCost: true  }],
    ['both',           { showLaborCost: true,  showMaterialsCost: true  }],
    ['neither',        { showLaborCost: false, showMaterialsCost: false }],
  ]) {
    const rec = stored();
    Object.assign(rec.estimate, flags);
    const r = recardEstimate(rec);
    t('total unchanged with ' + label,
      r.ok && Math.abs(r.after - r.before) < 0.005,
      'before $' + r.before.toFixed(2) + '   after $' + r.after.toFixed(2) + '   ' + r.reason);
  }
}

console.log('\n──────────────────────────────');
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('──────────────────────────────');
process.exit(fail ? 1 : 0);
