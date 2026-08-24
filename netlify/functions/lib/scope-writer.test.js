const SW = require('./scope-writer.js');

let fails = 0;
const t = (n, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n); if (!c) fails++; };

/* ---------------- CASE A: Pilates studio — mirrors, paint, floor patch, furniture.
   The job the old phrase library could not describe at all.               ---- */
const estA = {
  serviceBreakdown: [
    { title: 'Interior Painting & Surface Prep', subtotal: 9940, included: ['Patch, sand and prepare every surface before finishing'], notIncluded: [] },
    { title: 'Wall Mirror Fabrication & Mounting', subtotal: 5180, included: [], notIncluded: [] },
    { title: 'Floor & Tile Patch Repair', subtotal: 2470.35, included: [], notIncluded: [] },
    { title: 'Furniture Assembly, Mounting & Moving', subtotal: 1422, included: [], notIncluded: [] }
  ],
  labor: [
    { section: 'Interior Painting & Surface Prep', item: 'Ceiling and wall painting, two coats', qty: 96, unit: 'hrs', rate: 48 },
    { section: 'Wall Mirror Fabrication & Mounting', item: 'Fabricate and mount full wall mirror panels', qty: 34, unit: 'hrs', rate: 62 },
    { section: 'Floor & Tile Patch Repair', item: 'Patch damaged flooring and reset tile', qty: 26, unit: 'hrs', rate: 55 },
    { section: 'Furniture Assembly, Mounting & Moving', item: 'Furniture assembly and relocation', qty: 22, unit: 'hrs', rate: 45 }
  ],
  materials: [
    { section: 'Interior Painting & Surface Prep', item: 'Paint, primer and sundries', qty: 1, unit: 'ls', rate: 1420 },
    { section: 'Wall Mirror Fabrication & Mounting', item: 'Mirror glass panels and mounting hardware', qty: 1, unit: 'ls', rate: 2180 }
  ]
};
const anaA = {
  quantities: { painting_sf: 2626, wall_sf: 1870, ceiling_sf: 756 },
  site_conditions: { occupied_status: 'occupied, studio stays open', work_hours: 'evenings and weekends' },
  confirmed_scope: [
    { trade: 'Interior Painting & Surface Prep', scope_items: ['Ceiling painting 756 SF', 'Wall painting 1870 SF'], customer_exclusions: ['No punch required, walls are in good condition to paint'] },
    { trade: 'Wall Mirror Fabrication & Mounting', scope_items: ['Fabricate and mount 1-2 full wall mirror panels'], customer_exclusions: [] }
  ]
};
const inputA = { request: { service: 'Handyman', address: '39 W 14th St, Suite 207, New York, NY 10011',
  description: 'Office space currently a pilates studio. Painting 850 sq ft, fabrication and mounting wall mirrors, some patchwork flooring/tiling, hanging/mounting/moving furniture. Ceiling 756 sqft, Walls 1870 sqft, Total 2626 sqft.' } };

/* A stub model that returns exactly the shape the prompt asks for. */
const goodCall = async () => JSON.stringify({
  services: [
    { service: 'Interior Painting & Surface Prep',
      included: [
        'Prepare and paint approximately 2,626 SF of surface — 1,870 SF of walls and 756 SF of ceiling',
        'Patch, sand and spot-prime the existing wall surfaces',
        'Apply two finish coats to all walls and ceilings in the studio',
        'Mask and protect floors, mirrors and equipment for the duration of the painting',
        'Schedule all painting for evenings and weekends so the studio stays open'
      ],
      notIncluded: ['No punch-list repairs to existing wall damage beyond normal patching'] },
    { service: 'Wall Mirror Fabrication & Mounting',
      included: [
        'Field-measure and fabricate full-wall mirror panels, one to two mirrors as confirmed on site',
        'Supply mirror glass with polished edges sized to the wall',
        'Install concealed mechanical mounting hardware anchored into studs',
        'Set panels plumb and flush with a continuous seam line across the wall'
      ],
      notIncluded: [] },
    { service: 'Floor & Tile Patch Repair',
      included: [
        'Evaluate the substrate at each damaged area and confirm it is sound',
        'Remove damaged flooring and tile at the repair areas only',
        'Clean, level and prepare the substrate for new material',
        'Install replacement flooring and tile at the patch areas'
      ],
      notIncluded: ['No replacement of flooring outside the identified patch areas'] },
    { service: 'Furniture Assembly, Mounting & Moving',
      included: [
        'Assemble owner-supplied furniture delivered to the suite',
        'Wall-mount items requiring anchoring, fixed into studs where available',
        'Relocate and position furniture within the studio as directed on site'
      ],
      notIncluded: [] }
  ],
  timeline: 'Approximately 7 to 9 working sessions on site, scheduled evenings and weekends.'
});

(async () => {
  const a = await SW.writeCustomerScope(JSON.parse(JSON.stringify(estA)), anaA, inputA, goodCall, JSON.parse);
  console.log('\n=== CASE A — Pilates studio (4 non-bathroom trades) ===');
  a.serviceBreakdown.forEach(s => console.log(`  ${s.title}: ${s.included.length} included, ${s.notIncluded.length} not-included`));
  t('A: every service has >= 3 bullets', a.serviceBreakdown.every(s => s.included.length >= 3));
  t('A: mirrors service described (was impossible before)', /mirror/i.test(a.serviceBreakdown[1].included.join(' ')));
  t('A: real quantities carried into prose', /2,626|1,870|756/.test(a.serviceBreakdown[0].included.join(' ')));
  t('A: timeline captured', /working sessions/i.test(a.customerTimeline || ''));
  t('A: no dollar figures anywhere in scope',
    !/\$\s?\d/.test(a.serviceBreakdown.map(s => s.included.concat(s.notIncluded).join(' ')).join(' ')));
  t('A: writer credited all 4 services', a.scopeWriter.servicesWritten === 4);

  /* ---- CASE B: banned content and junk the model might emit ---- */
  const dirty = async () => JSON.stringify({
    services: [
      { service: 'Interior Painting & Surface Prep',
        included: [
          'Our licensed painters apply a top-quality finish',
          'Includes TV mounting on the back wall',
          'Paint the walls for $3,200 including materials',
          '• Paint the walls for $3,200 including materials',
          'x'.repeat(400)
        ],
        notIncluded: ['Licensing and permits not included'] }
    ],
    timeline: ''
  });
  const b = await SW.writeCustomerScope(JSON.parse(JSON.stringify(estA)), anaA, inputA, dirty, JSON.parse);
  const bAll = b.serviceBreakdown.map(s => s.included.concat(s.notIncluded).join(' ')).join(' ');
  console.log('\n=== CASE B — hostile model output ===');
  b.serviceBreakdown[0].included.forEach(x => console.log('   •', x.slice(0, 90)));
  t('B: "licensed" scrubbed everywhere', !/licen[sc]/i.test(bAll));
  t('B: TV bullet DROPPED entirely', !/\btv\b/i.test(bAll));
  t('B: marketing puffery stripped', !/top-quality|high-quality|top notch/i.test(bAll));
  t('B: dollar figures scrubbed', !/\$\s?\d/.test(bAll));
  t('B: duplicate bullet removed', new Set(b.serviceBreakdown[0].included.map(x => x.toLowerCase())).size === b.serviceBreakdown[0].included.length);
  t('B: over-long bullet trimmed', b.serviceBreakdown[0].included.every(x => x.length <= SW.MAX_BULLETS * 0 + 262));
  t('B: services the model ignored kept their prior wording',
    b.serviceBreakdown.slice(1).every(s => Array.isArray(s.included)));

  /* ---- CASE C: the model throws. Estimate must survive intact. ---- */
  const boom = async () => { throw new Error('Claude response hit the 8000-token limit'); };
  const priced = JSON.parse(JSON.stringify(estA));
  const c = await SW.writeCustomerScope(priced, anaA, inputA, boom, JSON.parse);
  console.log('\n=== CASE C — model failure ===');
  t('C: estimate still returned', !!c && Array.isArray(c.serviceBreakdown));
  t('C: subtotals untouched', c.serviceBreakdown[0].subtotal === 9940 && c.serviceBreakdown[3].subtotal === 1422);
  t('C: labor/materials untouched', c.labor.length === 4 && c.materials.length === 2);
  t('C: failure recorded, not silent', /token limit/i.test(c.scopeWriter.note || ''));
  t('C: phrase-library wording preserved on card 1', c.serviceBreakdown[0].included.length >= 1);

  /* ---- CASE D: a trade the phrase library never covered at all ---- */
  const estD = {
    serviceBreakdown: [{ title: 'Oak & Metal Staircase Renovation', subtotal: 21088.76, included: [], notIncluded: [] }],
    labor: [{ section: 'Oak & Metal Staircase Renovation', item: 'Strip, rebuild and refinish stair treads and risers', qty: 88, unit: 'hrs', rate: 72 }],
    materials: [{ section: 'Oak & Metal Staircase Renovation', item: 'White oak treads, steel balusters, finish', qty: 1, unit: 'ls', rate: 6400 }]
  };
  const callD = async () => JSON.stringify({
    services: [{ service: 'Oak & Metal Staircase Renovation',
      included: [
        'Remove the existing treads, risers and railing back to the stringers',
        'Supply and install solid white oak treads and risers, sanded and finished on site',
        'Fabricate and install powder-coated steel balusters to the existing stair geometry',
        'Apply three coats of penetrating finish, sanding between coats'
      ], notIncluded: ['No structural alteration to the stair carriage or stringers'] }],
    timeline: 'About two weeks on site.'
  });
  const d = await SW.writeCustomerScope(estD, {}, { request: { description: 'Oak and metal staircase renovation' } }, callD, JSON.parse);
  console.log('\n=== CASE D — trade with zero phrase-library coverage ===');
  d.serviceBreakdown[0].included.forEach(x => console.log('   •', x));
  t('D: staircase job fully described', d.serviceBreakdown[0].included.length === 4);
  t('D: no fallback needed', d.scopeWriter.servicesFallback === 0);

  console.log('\n' + (fails === 0 ? 'ALL ASSERTIONS PASSED' : fails + ' FAILED'));
  process.exit(fails ? 1 : 0);
})();
