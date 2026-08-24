const MR = require('./market-research.js');

let fails = 0;
const t = (n, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n); if (!c) fails++; };

const analysis = {
  selected_trades: ['Painting', 'Flooring', 'Windows'],
  confirmed_scope: [
    { trade: 'Painting', scope_items: ['Walls and ceilings, two coats'], quantities: { paintable_sf: 2626 } },
    { trade: 'Flooring', scope_items: ['Engineered white oak, 640 SF'], quantities: { flooring_sf: 640 } }
  ]
};
const input = { request: { address: 'Astoria, Queens NY', service: 'Renovation', description: '800 SF two-bedroom, 3rd floor walk-up. Painting, engineered hardwood, eight window replacement.' } };

/* ---- 1. The gate: junk a scraper realistically produces ---- */
console.log('=== Sanity gate ===');
const junk = [
  { trade: 'Painting', item: 'Interior repaint', unit: 'sf', low: 2.4, high: 3.2, basis: 'NYC metro', source: 'x.com' },   // good
  { trade: 'Flooring', item: 'Engineered oak install', unit: 'sqft', low: '4.50', high: '$6.25' },                          // good, messy input
  { trade: 'Windows', item: 'Vinyl double hung', unit: 'each', low: 385, high: 415 },                                       // good
  { trade: 'Painting', item: 'Phone number scraped as price', unit: 'sf', low: 3322770990, high: 3322770990 },              // absurd
  { trade: 'Flooring', item: 'Whole project filed as unit cost', unit: 'sf', low: 44460, high: 44460 },                     // absurd
  { trade: 'Painting', item: 'Useless spread', unit: 'sf', low: 1, high: 900 },                                             // range too wide
  { trade: 'Windows', item: 'Negative', unit: 'ea', low: -300, high: 400 },                                                 // invalid
  { trade: 'Painting', item: 'No unit given', low: 3, high: 4 },                                                            // no unit
  { trade: 'Painting', item: 'Interior repaint', unit: 'sf', low: 2.4, high: 3.2 },                                         // duplicate
  { trade: 'Labor', item: 'Hourly rate typo', unit: 'hr', low: 0.05, high: 0.09 },                                          // cents, absurd
  { trade: 'Labor', item: 'Tile setter', unit: 'manhour', low: 85, high: 120 }                                              // good, odd unit spelling
];
const gated = MR.gateAll(junk);
gated.forEach(g => console.log(`   kept: [${g.trade}] ${g.item} $${g.low}-$${g.high}/${g.unit}`));
t('keeps the 4 legitimate findings', gated.length === 4);
t('phone-number price rejected', !gated.some(g => g.low > 100000));
t('whole-project-as-unit-cost rejected', !gated.some(g => /Whole project/.test(g.item)));
t('useless spread rejected', !gated.some(g => /Useless/.test(g.item)));
t('negative rejected', !gated.some(g => /Negative/.test(g.item)));
t('missing unit rejected', !gated.some(g => /No unit/.test(g.item)));
t('cent-denominated hourly rejected', !gated.some(g => /typo/.test(g.item)));
t('duplicate collapsed', gated.filter(g => g.item === 'Interior repaint').length === 1);
t('messy "$6.25" string parsed', gated.some(g => g.unit === 'sf' && g.high === 6.25));
t('"sqft" and "manhour" normalised', gated.some(g => g.unit === 'sf') && gated.some(g => g.unit === 'hr'));

/* ---- 2. The block: precedence must be stated, not implied ---- */
console.log('\n=== Prompt block ===');
const block = MR.buildResearchBlock({ findings: gated, notes: 'Window pricing is national, not NYC.', asOf: '2026-08-23' });
t('house rules declared as outranking research', /HOUSE RULES above outrank/.test(block));
t('actuals declared as outranking research', /actuals outrank/.test(block));
t('fallibility stated plainly', /scraped from the open web and can be/.test(block));
t('does not instruct the model to use the numbers', !/you must use these/i.test(block));
t('warns against inventing line items', /Do NOT add a line item just because/.test(block));
t('caution note carried through', /national, not NYC/.test(block));
t('empty research yields empty block', MR.buildResearchBlock(null) === '' && MR.buildResearchBlock({ findings: [] }) === '');

/* ---- 3. Failure paths — the estimate must never depend on this ---- */
(async () => {
  console.log('\n=== Failure paths ===');
  const boom = async () => { throw new Error('search unavailable'); };
  t('search throwing returns null', (await MR.researchMarketPricing(analysis, input, boom, JSON.parse)) === null);

  const garbage = async () => 'this is not json at all';
  t('unparseable response returns null', (await MR.researchMarketPricing(analysis, input, garbage, JSON.parse)) === null);

  const allJunk = async () => JSON.stringify({ findings: [{ trade: 'X', item: 'bad', unit: 'sf', low: 999999, high: 999999 }] });
  t('all-junk research returns null', (await MR.researchMarketPricing(analysis, input, allJunk, JSON.parse)) === null);

  const empty = async () => JSON.stringify({ findings: [] });
  t('empty findings returns null', (await MR.researchMarketPricing(analysis, input, empty, JSON.parse)) === null);

  t('no trades = no search attempted', (await MR.researchMarketPricing({ selected_trades: [] }, input, boom, JSON.parse)) === null);

  const mixed = async () => JSON.stringify({ findings: junk, notes: 'mixed quality' });
  const ok = await MR.researchMarketPricing(analysis, input, mixed, JSON.parse);
  console.log(`   accepted ${ok.accepted}, rejected ${ok.rejected}`);
  t('good research returns a usable object', !!ok && ok.findings.length === 4);
  t('rejection count is reported, not hidden', ok.rejected === junk.length - 4);
  t('stamped with a date', /^\d{4}-\d{2}-\d{2}$/.test(ok.asOf));

  /* ---- 4. The research prompt itself ---- */
  console.log('\n=== Research prompt ===');
  const p = MR.buildResearchPrompt(analysis, input);
  t('asks for contractor cost, not retail', /what a CONTRACTOR pays/.test(p));
  t('job-specific, not generic', /Astoria, Queens/.test(p) && /2626|2,626/.test(p));
  t('search count bounded', new RegExp('at most ' + MR.MAX_SEARCHES + ' searches').test(p));
  t('omission preferred over guessing', /LEAVE IT OUT/.test(p));
  t('national figures must be labelled', /only find a national figure, say so/.test(p));

  console.log('\n' + (fails === 0 ? 'ALL ASSERTIONS PASSED' : fails + ' FAILED'));
  process.exit(fails ? 1 : 0);
})();
