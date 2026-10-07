const assert = require('assert');
const E = require('../netlify/functions/lib/estimate-engine-v5');
const R = require('../netlify/functions/lib/job-reader-v5');
let pass = 0; const t = (n, f) => { f(); pass++; console.log('ok -', n); };

// 1. Small toilet job stays small
const toilet = E.build(R.validate({ services: [{ name: 'Bathroom', items: [{ id: 'toilet', qty: 1 }] }], site: { floor: 3, elevator: true } }, { request: { services: ['Bathroom'] } }));
t('toilet job is small and never General', () => {
  assert(toilet.totals.total > 600 && toilet.totals.total < 1300, 'toilet total ' + toilet.totals.total);
  assert(!JSON.stringify(toilet).includes('"General"'));
  assert(toilet.smallJob && toilet.exclusions.length === 0);
  assert(toilet.manualCustomerScopeDraft.services[0].excluded.length <= 5);
});

// 2. Customer supplies vanity: material $0, labor kept
const van = E.build(R.validate({ services: [{ name: 'Bathroom', items: [{ id: 'vanity', qty: 1 }] }], customerSupplies: ['vanity'] }, {}));
t('customer-supplied vanity: material 0, labor kept', () => {
  assert(!van.materials.some((x) => x.supplyKey === 'vanity')); assert(van.customerSupplied.some((c) => /vanity/i.test(c.item)));
  assert(van.labor.some((l) => l.bookId === 'vanity' && l.rate > 0));
  assert(van.customerSupplied.length === 1);
});

// 3. Job 1 calibration: 5x7 gut ~ $14,500
const gut = E.build(R.validate({ services: [{ name: 'Bathroom', items: [
  { id: 'bath_demo_gut', qty: 35 }, { id: 'bath_rough_plumb', qty: 1 }, { id: 'bath_backer', qty: 200 }, { id: 'waterproof', qty: 60 },
  { id: 'wall_tile', qty: 60 }, { id: 'floor_tile', qty: 35 }, { id: 'shower_glass', qty: 1 }, { id: 'toilet', qty: 1 }, { id: 'vanity', qty: 1 }, { id: 'door_install', qty: 1 }] },
  { name: 'Painting', items: [{ id: 'paint_walls', qty: 150 }, { id: 'paint_ceiling', qty: 35 }] }],
  customerSupplies: ['vanity', 'faucet'] }, {}));
t('5x7 gut lands near Sani actual $14,500 (±20%)', () => { assert(gut.totals.total > 11600 && gut.totals.total < 17400, 'gut ' + gut.totals.total); });
t('multi-service has Whole Project, steps start with protect, end with clean', () => {
  assert(gut.labor.some((l) => l.section === 'Whole Project'));
  assert.strictEqual(gut.workSteps[0].bookId, 'protect'); assert.strictEqual(gut.workSteps[gut.workSteps.length - 1].bookId, 'cleanup');
  assert(gut.schedule.cureDays >= 2);
});

// 4. Reader validation enforces rules in code
const v = R.validate({ services: [{ name: 'General', items: [{ id: 'made_up', qty: 3 }, { id: 'regrout', qty: 99999 }], custom: [{ name: 'Mount TV' }, { name: 'Replace towel warmer', qty: 1 }] }],
  questions: ['What brand of paint?', 'Option A or B?', 'Is the shower valve leaking?', 'q4', 'q5'], summary: 'We are licensed. Total $5,000.' }, { request: { services: ['Bathroom'] } });
t('validator: no General, unknown ids dropped, qty clamped, TV/brand/options removed, no money in summary', () => {
  assert.strictEqual(v.services[0].name, 'Bathroom'); assert(v.dropped.includes('made_up'));
  assert(v.services[0].items[0].qty <= 3000); assert(v.services[0].custom.length === 1);
  assert(v.questions.length <= 3 && !v.questions.some((q) => /brand|option/i.test(q)));
  assert(!/licensed|\$/.test(v.summary));
});
t('custom items never get an AI price', () => { const e = E.build(v); assert(e.labor.find((l) => l.needsPrice).rate === 0); assert(e.warnings.some((w) => /Needs your price/.test(w))); });

// 5. Chat update keeps hand work and reports changes
const before = E.build(R.validate({ services: [{ name: 'Painting', items: [{ id: 'paint_walls', qty: 300 }] }] }, {}));
before.labor.push({ section: 'Painting', item: 'Move furniture', qty: 1, unit: 'job', rate: 150, byHand: true });
before.labor[0].rate = 1.4; before.labor[0].rateByHand = true;
const after = E.update(before, R.validate({ services: [{ name: 'Painting', items: [{ id: 'paint_walls', qty: 420 }], exclusions: ['Hallway ceiling'] }] }, {}));
t('chat update: hand line + hand rate kept, changes listed', () => {
  assert(after.estimate.labor.some((l) => l.item === 'Move furniture'));
  assert.strictEqual(after.estimate.labor.find((l) => l.bookId === 'paint_walls').rate, 1.4);
  assert(after.changes.some((c) => c.type === 'change' && /Paint walls/.test(c.what)));
  assert(after.changes.some((c) => /Not included: Hallway ceiling/.test(c.what)));
});
t('same reading -> same price every time', () => { const a = E.build(v), b = E.build(v); assert.strictEqual(a.totals.total, b.totals.total); });
t('markup curve: more cost -> higher price', () => { let p = 0; for (let c = 100; c < 40000; c += 50) { const x = c * (1 + E.markupFor(c)); assert(x > p); p = x; } });

console.log('\n' + pass + ' passed');
console.log('toilet', toilet.totals, '\ngut', gut.totals, gut.timelineText, '\nvanity', van.totals);
/* Claude review #3: a hand price on a book line is never charged twice. */
{
  const E2 = require('../netlify/functions/lib/estimate-engine-v5');
  const rd = { services: [{ name: 'Bathroom', items: [{ id: 'toilet', qty: 1 }] }] };
  const a = E2.build(rd); const l = a.labor.find((x) => x.bookId === 'toilet'); l.rate = 250; l.byHand = true;
  const u = E2.update(a, rd).estimate;
  const tl = u.labor.filter((x) => x.bookId === 'toilet');
  require('assert').ok(tl.length === 1 && tl[0].rate === 250, 'toilet hand price charged once');
  require('assert').strictEqual(u.markupPct, a.markupPct);
  console.log('ok - hand price on a book line replaces it (no double charge), markup kept');
}
