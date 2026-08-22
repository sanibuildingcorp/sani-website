const { consolidateCustomerPresentation } = require('./deterministic-pricing.js');

function show(label, est) {
  console.log('\n=== ' + label + ' ===');
  (est.serviceBreakdown || []).forEach(s => {
    console.log(`  ${s.title.padEnd(22)} $${s.subtotal.toFixed(2).padStart(10)}   included:${s.included.length} supplies:${s.customerSupplies.length} notIncl:${s.notIncluded.length}`);
  });
  const sum = (est.serviceBreakdown || []).reduce((a, s) => a + s.subtotal, 0);
  console.log('  ' + '-'.repeat(46));
  console.log('  CARDS TOTAL'.padEnd(24) + '$' + sum.toFixed(2).padStart(10));
  return est.serviceBreakdown || [];
}

/* ---------------------------------------------------------------------------
   CASE 1 — New Leaf Pilates Studio (SBC-260805-Q6CT). The failing job.
   Painting, wall mirrors, floor patching, furniture assembly. No bathroom.
--------------------------------------------------------------------------- */
const pilatesInput = {
  request: {
    service: 'Handyman',
    selectedServices: ['Handyman'],
    description: 'Office space currently a pilates studio that painting (850 sq ft), fabrication and mounting wall mirrors, some patchwork flooring/tiling, hanging/mounting/moving furniture. Painting areas: Ceiling 756 sqft, Walls 1870 sqft, Total 2626 sqft.'
  }
};
const pilatesAnalysis = {
  selected_trades: ['Handyman'],
  confirmed_scope: [
    { trade: 'Painting', scope_items: ['Ceiling painting', 'Wall painting'] },
    { trade: 'Mirror Installation', scope_items: ['Full wall mirror panels, fabricate and mount'] },
    { trade: 'Flooring', scope_items: ['Patch damaged flooring and tile at repair areas'] },
    { trade: 'Furniture', scope_items: ['Mounting, moving and assembly of furniture'] }
  ]
};
const pilatesEstimate = {
  markupPct: 49.4,
  labor: [
    { section: 'Painting', item: 'Ceiling and wall painting, prime and two coats', qty: 96, rate: 48 },
    { section: 'Painting', item: 'Surface prep and spackle patching', qty: 20, rate: 48 },
    { section: 'Mirror Installation', item: 'Fabricate and mount full wall mirror panels', qty: 34, rate: 62 },
    { section: 'Flooring', item: 'Patch damaged flooring and reset tile at repair areas', qty: 26, rate: 55 },
    { section: 'Furniture', item: 'Furniture assembly, mounting and relocation', qty: 22, rate: 45 },
    { section: 'General', item: 'Project coordination and supervision', qty: 14, rate: 55 },
    { section: 'General', item: 'Final cleanup and debris disposal', qty: 8, rate: 45 }
  ],
  materials: [
    { section: 'Painting', item: 'Paint, primer, spackle and sundries', qty: 1, rate: 1420 },
    { section: 'Mirror Installation', item: 'Mirror glass panels and mounting hardware', qty: 1, rate: 2180 },
    { section: 'Flooring', item: 'Replacement tile, thinset and grout for patch areas', qty: 1, rate: 640 },
    { section: 'Furniture', item: 'Anchors, brackets and fasteners', qty: 1, rate: 210 }
  ],
  customerSupplied: [{ item: 'Furniture pieces to be assembled', section: 'Furniture' }],
  exclusions: ['Permits and filings', 'Concealed conditions behind walls'],
  options: []
};

const c1 = show('CASE 1 — Pilates studio (was: Bathroom + Flooring)',
  consolidateCustomerPresentation(JSON.parse(JSON.stringify(pilatesEstimate)), pilatesAnalysis, pilatesInput));

/* ---------------------------------------------------------------------------
   CASE 2 — REGRESSION. Real 5x7 gut bathroom must still be ONE Bathroom card.
--------------------------------------------------------------------------- */
const bathInput = { request: { service: 'Bathroom Renovation', selectedServices: ['Bathroom Renovation'], description: 'Full gut bathroom renovation, 5x7, down to studs.' } };
const bathAnalysis = { selected_trades: ['Bathroom Renovation'], confirmed_scope: [{ trade: 'Bathroom', scope_items: ['Full gut'] }] };
const bathEstimate = {
  markupPct: 49.6,
  labor: [
    { section: 'Bathroom', item: 'Remove the existing bathroom down to the substrate', qty: 24, rate: 55 },
    { section: 'Bathroom', item: 'Waterproofing membrane and flood test', qty: 14, rate: 60 },
    { section: 'Bathroom', item: 'Set floor and wall tile, grout and seal', qty: 46, rate: 62 },
    { section: 'Bathroom', item: 'Rough plumbing and fixture connections', qty: 20, rate: 78 },
    { section: 'General', item: 'Project coordination', qty: 10, rate: 55 }
  ],
  materials: [
    { section: 'Bathroom', item: 'Tile, thinset, grout, backer board and membrane', qty: 1, rate: 2840 },
    { section: 'Bathroom', item: 'Shower glass enclosure', qty: 1, rate: 1180 }
  ],
  customerSupplied: [], exclusions: ['Permits and filings'], options: []
};
const c2 = show('CASE 2 — 5x7 gut bathroom (regression)',
  consolidateCustomerPresentation(JSON.parse(JSON.stringify(bathEstimate)), bathAnalysis, bathInput));

/* ---------------------------------------------------------------------------
   CASE 3 — REGRESSION. Multi-trade job keeps its four cards.
--------------------------------------------------------------------------- */
const multiInput = { request: { service: 'Renovation', selectedServices: ['Bathroom Renovation', 'Flooring', 'Painting', 'Windows'], description: 'Bathroom renovation plus engineered hardwood flooring in bedroom and living room, painting the whole apartment, and window replacement.' } };
const multiAnalysis = { selected_trades: ['Bathroom Renovation', 'Flooring', 'Painting', 'Windows'] };
const multiEstimate = {
  markupPct: 25,
  labor: [
    { section: 'Bathroom', item: 'Set wall tile and grout', qty: 30, rate: 62 },
    { section: 'Flooring', item: 'Install engineered hardwood flooring', qty: 40, rate: 55 },
    { section: 'Painting', item: 'Prime and paint walls and ceilings', qty: 60, rate: 48 },
    { section: 'Windows', item: 'Window removal and replacement', qty: 24, rate: 70 },
    { section: 'General', item: 'Project coordination and site protection', qty: 12, rate: 55 }
  ],
  materials: [
    { section: 'Bathroom', item: 'Tile, thinset and grout', qty: 1, rate: 1800 },
    { section: 'Flooring', item: 'Engineered hardwood and underlayment', qty: 1, rate: 3200 },
    { section: 'Painting', item: 'Paint and sundries', qty: 1, rate: 900 },
    { section: 'Windows', item: 'Replacement windows', qty: 1, rate: 11880 }
  ],
  customerSupplied: [], exclusions: [], options: []
};
const c3 = show('CASE 3 — four-trade job (regression)',
  consolidateCustomerPresentation(JSON.parse(JSON.stringify(multiEstimate)), multiAnalysis, multiInput));

/* ---------------------------------- asserts ---------------------------------- */
console.log('\n================ ASSERTIONS ================');
let fail = 0;
const t = (name, cond) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) fail++; };

const n1 = c1.map(s => s.title);
t('C1 no Bathroom card', !n1.includes('Bathroom'));
t('C1 has Painting', n1.includes('Painting'));
t('C1 has Mirrors & Glass', n1.includes('Mirrors & Glass'));
t('C1 has Flooring', n1.includes('Flooring'));
t('C1 has Furniture Assembly', n1.includes('Furniture Assembly'));
t('C1 exactly four cards', c1.length === 4);
t('C1 no standalone Tile card', !n1.includes('Tile'));
t('C1 every card has included lines', c1.every(s => s.included.length > 0));
t('C1 every card has non-zero subtotal', c1.every(s => s.subtotal > 0));

const direct1 = 96*48+20*48+34*62+26*55+22*45+14*55+8*45+1420+2180+640+210;
const expect1 = direct1 * 1.494;
const got1 = c1.reduce((a, s) => a + s.subtotal, 0);
t(`C1 cards sum to grand total (${got1.toFixed(2)} vs ${expect1.toFixed(2)})`, Math.abs(got1 - expect1) < 0.05);

const n2 = c2.map(s => s.title);
t('C2 exactly one card', c2.length === 1);
t('C2 that card is Bathroom', n2[0] === 'Bathroom');
t('C2 shower glass did NOT become Mirrors & Glass', !n2.includes('Mirrors & Glass'));

const n3 = c3.map(s => s.title);
t('C3 has all four cards', ['Bathroom','Flooring','Painting','Windows'].every(x => n3.includes(x)));
t('C3 has no extra cards', c3.length === 4);
const direct3 = 30*62+40*55+60*48+24*70+12*55+1800+3200+900+11880;
const got3 = c3.reduce((a, s) => a + s.subtotal, 0);
t(`C3 cards sum to grand total (${got3.toFixed(2)} vs ${(direct3*1.25).toFixed(2)})`, Math.abs(got3 - direct3*1.25) < 0.05);

console.log('\n' + (fail === 0 ? 'ALL ASSERTIONS PASSED' : fail + ' ASSERTION(S) FAILED'));
process.exit(fail ? 1 : 0);
