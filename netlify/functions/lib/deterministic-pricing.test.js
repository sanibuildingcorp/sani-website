/* deterministic-pricing.test.js — the phantom-card class, both directions.
 *
 * Law 2: `node --check` is not verification. This file EXECUTES the engine.
 * Run:  node netlify/functions/lib/deterministic-pricing.test.js
 *
 * Two halves, and BOTH have to stay green:
 *
 *   FALSE POSITIVES — a service the customer never bought must never become a
 *   card. This is the half that has failed repeatedly, most recently by reading
 *   a negation ("no painting needed") as a purchase.
 *
 *   TRUE POSITIVES — a service the customer DID buy must still become a card.
 *   Every fix to the first half is a chance to break this one, and breaking it
 *   is worse: a phantom card is embarrassing, a missing card is unbilled work.
 */

const path = require('path');
const vm = require('vm');
const fs = require('fs');

const FILE = path.join(__dirname, 'deterministic-pricing.js');
const { applyDeterministicPricing, consolidateCustomerPresentation } = require(FILE);

/* resolveServiceSet and friends are module-private on purpose. Re-evaluating the
   module body in a context we can reach into lets the test address them by name
   instead of inferring them from the outside. */
const ctx = {
  module: { exports: {} }, exports: {}, console, Math, Date, JSON, Object, Array,
  Number, String, Boolean, RegExp, isNaN, isFinite, parseFloat, parseInt,
  require: n => require(n.startsWith('.') ? path.resolve(__dirname, n) : n),
};
ctx.global = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(FILE, 'utf8'), ctx, { filename: FILE });
const priv = n => vm.runInContext(n, ctx);

let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
};

const resolved = (description, trades, estimate) =>
  priv('resolveServiceSet')(
    { selected_trades: trades || ['Stairs'], confirmed_scope: [] },
    { request: { service: (trades || ['Stairs'])[0], description: description } },
    estimate || { labor: [], materials: [] }
  ).slice();

/* ══════════════════════════════════════════════════════════════════════════
   1. FALSE POSITIVES — an incidental noun is not a purchase
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n1. A noun in the customer\'s sentence is not a purchase');

const NEVER = [
  ['a storey is not a floor finish',        'Rebuild the staircase to the second floor.',                        'Flooring'],
  ['...nor is a top-floor walk-up',         'Rebuild the staircase on the top floor of a walk-up.',              'Flooring'],
  ['...nor a parlor floor being protected', 'Rebuild the staircase. Protect the parlor floor while we work.',    'Flooring'],
  ['a prohibition is not an order',         'Rebuild the staircase. Do not touch the bathroom.',                 'Bathroom'],
  ['"no painting needed" is not painting',  'Rebuild the staircase. No painting needed.',                        'Painting'],
  ['work already done is not work bought',  'Rebuild the staircase. The kitchen was done last year, leave it alone.', 'Kitchen'],
  ['an excluded trade stays excluded',      'Rebuild the staircase. Match the existing tile? No tile work.',     'Tile'],
  ['"by others" is not by us',              'Rebuild the staircase. Electrical by others.',                      'Electrical'],
];
for (const [name, desc, forbidden] of NEVER) {
  const set = resolved(desc);
  t(name, !set.includes(forbidden), 'resolved ' + JSON.stringify(set) + '  ← "' + desc + '"');
}

/* ══════════════════════════════════════════════════════════════════════════
   2. TRUE POSITIVES — the customer's real trades must survive every guard
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n2. What the customer actually asked for still gets a card');

const ALWAYS = [
  ['a plain second trade is admitted',   'Rebuild the staircase and paint the hallway walls and trim.', 'Painting'],
  ['hardwood survives the storey strip', 'Refinish the hardwood floors throughout the apartment.',      'Flooring'],
  ['...even alongside a storey number',  'Refinish the hardwood floors on the second floor.',           'Flooring'],
  ['a positive clause after a negative', 'No painting. Replace the three double-hung windows.',         'Windows'],
  ['a trade named before a negation',    'Paint the whole apartment. Do not touch the kitchen.',        'Painting'],
  ['the plural is how customers write it','Replace the doors on the second floor.',                      'Doors'],
];
for (const [name, desc, expected] of ALWAYS) {
  /* Corroboration only applies to services the customer did not pick, so these
     carry a priced line that names the trade in its own right. */
  const est = {
    labor: [{ section: 'X', item: 'Paint walls and trim, two coats', qty: 1, unit: 'ls', rate: 100 },
            { section: 'X', item: 'Refinish hardwood flooring', qty: 1, unit: 'ls', rate: 100 },
            { section: 'X', item: 'Install three double-hung windows', qty: 3, unit: 'ea', rate: 100 },
            { section: 'X', item: 'Hang new interior doors and hardware', qty: 4, unit: 'ea', rate: 100 }],
    materials: [],
  };
  const set = resolved(desc, ['Stairs'], est);
  t(name, set.includes(expected), 'resolved ' + JSON.stringify(set) + '  ← "' + desc + '"');
}

console.log('\n3. A container-only ticket still splits from the customer\'s words');
{
  /* "Handyman" names no trade. Evidence is the only thing this ticket has, so
     the corroboration rule is deliberately not applied to it. */
  const set = resolved('Mount six wall mirrors, assemble the furniture and patch the floor.', ['Handyman']);
  t('Mirrors & Glass admitted from the description alone', set.includes('Mirrors & Glass'), JSON.stringify(set));
  t('Furniture Assembly admitted from the description alone', set.includes('Furniture Assembly'), JSON.stringify(set));
  t('the container itself does not linger as a card', !set.includes('Handyman'), JSON.stringify(set));
}

/* ══════════════════════════════════════════════════════════════════════════
   4. PROTECTION CONSUMABLES belong to no trade
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n4. Drop cloths and painters tape do not name a trade');
{
  const g = priv('genericOperation');
  t('"Canvas drop cloths, rosin paper, painters and masking tape" is general',
    g('Canvas drop cloths, rosin paper, poly sheeting, painters and masking tape'));
  t('"Ram board floor protection" is general', g('Ram board floor protection'));
  t('"Paint, primer and sundries" is NOT general (it is real painting material)',
    !g('Paint, primer and sundries'));
  t('"Ceiling and wall painting, two coats" is NOT general',
    !g('Ceiling and wall painting, two coats'));
}

/* ══════════════════════════════════════════════════════════════════════════
   5. END TO END — the money
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n5. End to end: the phantom is gone and the total has not moved');

function stairJob(description) {
  return {
    input: { request: { service: 'Stairs', description: description, selectedServices: ['Stairs'] } },
    analysis: { selected_trades: ['Stairs'], confirmed_scope: [{ trade: 'Stairs' }] },
    estimate: {
      labor: [
        { section: 'Stairs', item: 'Demo existing treads, risers and balustrade', qty: 1, unit: 'ls', rate: 1800 },
        { section: 'Stairs', item: 'Install new oak treads and risers', qty: 14, unit: 'ea', rate: 240 },
        { section: 'Stairs', item: 'Install newel post, balusters and handrail', qty: 1, unit: 'ls', rate: 3200 },
        { section: 'Stairs', item: 'Sand and finish new stair, three coats', qty: 1, unit: 'ls', rate: 2400 },
        { section: 'Stairs', item: 'Site protection and daily cleanup', qty: 1, unit: 'ls', rate: 900 },
      ],
      materials: [
        { section: 'Stairs', item: 'Red oak treads, risers, newel, balusters, handrail', qty: 1, unit: 'ls', rate: 4200 },
        { section: 'Stairs', item: 'Canvas drop cloths, rosin paper, poly sheeting, painters and masking tape', qty: 1, unit: 'ls', rate: 380 },
      ],
    },
  };
}
function run(desc) {
  const j = stairJob(desc);
  const priced = applyDeterministicPricing(JSON.parse(JSON.stringify(j.estimate)), j.analysis, j.input);
  const out = consolidateCustomerPresentation(priced, j.analysis, j.input);
  const cards = out.serviceBreakdown || [];
  return { cards: cards.map(c => c.title), total: cards.reduce((s, c) => s + (Number(c.subtotal) || 0), 0) };
}

const baseline = run('Rebuild the interior staircase. New oak treads, risers, newel post, balusters and handrail.');
t('the clean job produces exactly one card', baseline.cards.length === 1 && baseline.cards[0] === 'Stairs',
  JSON.stringify(baseline.cards));

for (const desc of [
  'Rebuild the interior staircase. Stain the new stair to match the painted trim in the hall.',
  'Rebuild the interior staircase from the parlor to the second floor.',
  'Rebuild the interior staircase. Do not touch the bathroom on the second floor.',
  'Rebuild the interior staircase. No painting needed.',
]) {
  const r = run(desc);
  t('no phantom card: "' + desc.slice(30, 72) + '"',
    r.cards.length === 1 && r.cards[0] === 'Stairs', JSON.stringify(r.cards));
  t('   ...and the total is unchanged to the cent',
    Math.abs(r.total - baseline.total) < 0.005,
    'baseline $' + baseline.total.toFixed(2) + '   this $' + r.total.toFixed(2));
}

/* ══════════════════════════════════════════════════════════════════════════
   6. THE GATE THAT COULD NOT GATE
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n6. selectedCustomerServices actually narrows');
{
  /* The old filter read `set.includes(x) || lines.includes(x)`. `candidates` is
     derived from `set`, so the first clause was true for every element and the
     filter was a no-op. A service the customer never picked and that owns no
     priced line must not survive. */
  const sel = priv('selectedCustomerServices');
  const set = ['Stairs', 'Painting'];
  Object.defineProperty(set, '__sbcResolved', { value: true, enumerable: false });
  const est = {
    labor: [{ section: 'Stairs', item: 'Install new oak treads and risers', qty: 1, unit: 'ls', rate: 100 }],
    materials: [],
  };
  const out = sel({ selected_trades: ['Stairs'] }, est, { request: { selectedServices: ['Stairs'] } }, set);
  t('an unpicked, unearned service is dropped', !out.includes('Painting'), JSON.stringify(out));
  t('the picked service survives', out.includes('Stairs'), JSON.stringify(out));
}

console.log('\n──────────────────────────────');
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('──────────────────────────────');
process.exit(fail ? 1 : 0);
