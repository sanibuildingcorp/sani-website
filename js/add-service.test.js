/* add-service.test.js — run: node js/add-service.test.js
 *
 *   "i need freeze current previous generated estimate for bathroom but i
 *    want generate additional painting service price and scope of work
 *    which will add in same estimate with own scope of work and price"
 *
 * ➕ Add a service to this estimate: the estimator runs on the new work
 * ALONE and the result is appended as its own section(s) - lines, card,
 * scope, price. The agreed sections are not regenerated: every existing
 * line, rate, bullet, the markup and the frozen sent version read back
 * exactly as they were. The merge is pure (lib/add-service.js) and is run
 * here without an AI; the generator's wiring and the page's flow are
 * exercised with the AI and the network stubbed.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const BG = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
function ext(src, name) {
  const s = src.search(new RegExp('(?:async )?function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = src.indexOf('{', s); j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) return src.slice(s, j + 1); } }
  throw new Error('unbalanced ' + name);
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const lib = require(path.join(ROOT, 'netlify/functions/lib/add-service.js'));

/* The agreed estimate: a bathroom, sent, accepted, its scope published, a stamped total. */
const BASE = {
  ref: 'SBC-260901-ARWQ', status: 'accepted', sentAt: '2026-09-05T10:00:00Z', acceptedAt: '2026-09-08T10:00:00Z', customerFinalTotal: 12697.7,
  scopeFingerprint: 'fp-bath', projectAnalysis: { selected_trades: ['Bathroom'], pricing_readiness: { status: 'READY_TO_ESTIMATE' } },
  customer: { name: 'May Chen', email: 'rmchen882@gmail.com', address: '100 Riverside Blvd, New York, NY' },
  request: { service: 'Bathroom', propertyType: 'Apartment', timeline: '2-4 weeks', description: 'Water damage bathroom, replace tub, vanity, tile.', serviceAnswers: { size: '5x8' }, answerTopics: { size: 'Bathroom' }, answerLabels: { size: 'How big?' }, photos: [{ url: 'x.jpg' }], photoCount: 1, customerSupplies: ['vanity'] },
  thread: [{ id: 't1', from: 'customer', text: 'Ok', at: '2026-09-08T09:00:00Z' }],
  estimate: {
    projectTitle: 'Riverside Blvd Bathroom Upgrade', summary: 'Bathroom.', timelineText: '5-7 working days', scopeOfWork: 'BATHROOM:\n• Remove the tub', markupPct: 25,
    labor: [{ item: 'Bathtub removal', qty: 8, unit: 'hrs', rate: 62.4, section: 'Bathroom' }, { item: 'Tile installation', qty: 40, unit: 'hrs', rate: 62.4, section: 'Bathroom' }],
    materials: [{ item: 'Thinset and grout', qty: 4, unit: 'bag', rate: 28, section: 'Bathroom' }],
    customerSupplied: [{ item: 'Vanity', section: 'Bathroom', note: 'Installation included' }],
    serviceBreakdown: [{ title: 'Bathroom', included: ['Remove the tub', 'Set new tile'], customerSupplies: ['Vanity'], notIncluded: ['Plumbing relocation'], subtotal: 3884, options: [{ label: 'Frameless glass door', description: '', price: 900 }] }],
    scopeSections: [], customerPresentationVersion: 'v9.0-deterministic-services', showSectionSubtotals: true,
    customerScopePublished: true,
    publishedCustomerScope: { services: [{ name: 'Bathroom', subtotal: 3884, included: ['Remove the tub', 'Set new tile'], supplied: ['Vanity'], excluded: ['Plumbing relocation'], includedOff: [], suppliedOff: [], excludedOff: [] }], updatedAt: '2026-09-04T10:00:00Z' },
    manualCustomerScopeDraft: { services: [{ name: 'Bathroom', subtotal: 3884, included: ['Remove the tub', 'Set new tile'], supplied: ['Vanity'], excluded: ['Plumbing relocation'], includedOff: [], suppliedOff: [], excludedOff: [] }], updatedAt: '2026-09-04T10:00:00Z' },
    offeredOptions: [], quotePhotos: [{ url: 'q.jpg' }],
  },
  sentVersion: { at: '2026-09-05T10:00:00Z', estimate: { projectTitle: 'Riverside Blvd Bathroom Upgrade', labor: [{ item: 'Bathtub removal', qty: 8, unit: 'hrs', rate: 62.4, section: 'Bathroom' }], serviceBreakdown: [{ title: 'Bathroom', subtotal: 3884 }] }, offeredOptions: [] },
};
/* What the estimator produced for the painting alone, at ITS markup (20). */
const FRESH = {
  projectTitle: 'Painting - May Chen', summary: 'Painting.', markupPct: 20, timelineText: '2 days',
  labor: [{ item: 'Prep, mask and protect the bathroom', qty: 3, unit: 'hrs', rate: 55, section: 'Painting' }, { item: 'Paint walls, ceiling and trim, two coats', qty: 12, unit: 'hrs', rate: 55, section: 'Painting' }, { item: 'Daily cleanup', qty: 1, unit: 'hrs', rate: 55, section: 'General' }],
  materials: [{ item: 'Benjamin Moore Regal Select, Honey Badger 920', qty: 3, unit: 'gal', rate: 85, section: 'Painting' }, { item: 'Louisburg Green HC-113 for the doors', qty: 1, unit: 'gal', rate: 85, section: 'Painting' }],
  customerSupplied: [], exclusions: ['Wallpaper removal'], options: [],
  serviceBreakdown: [{ title: 'Painting', included: ['Prepare and mask the room', 'Two coats on walls, ceiling and trim in Honey Badger 920', 'Doors in Louisburg Green HC-113'], customerSupplies: [], notIncluded: ['Wallpaper removal'], subtotal: 1464, options: [] }],
  scopeSections: [], customerPresentationVersion: 'v9.0-deterministic-services',
};

(async () => {
  console.log('\n1. What the estimator is handed: the new work, nothing of the agreed job\n');
  {
    const r = lib.addServiceRequest(BASE, 'Paint the bathroom walls, ceiling, baseboard and trim in Benjamin Moore Honey Badger 920, doors in Louisburg Green HC-113.', 'Painting');
    ok('THE REQUEST IS THE NEW WORK ONLY: his words, the service, no answers, no photos, no thread', /^Paint the bathroom walls/.test(r.request.description) && r.request.service === 'Painting' && JSON.stringify(r.request.selectedServices) === '["Painting"]' && JSON.stringify(r.request.serviceAnswers) === '{}' && r.request.photos.length === 0 && r.request.photoCount === 0 && r.thread.length === 0 && r.request.customerSupplies.length === 0, JSON.stringify(r.request).slice(0, 200));
    ok('...it says what is already priced and that only the new work is to be priced', /ALREADY AGREED TO/.test(r.request.description) && /already has a priced estimate for: Bathroom/.test(r.request.description) && /Price and describe ONLY the additional work/.test(r.request.description) && /named "Painting"/.test(r.request.description));
    ok('...property, timeline and customer come along; the analysis and scope pin do not', r.request.propertyType === 'Apartment' && r.request.timeline === '2-4 weeks' && r.customer.email === 'rmchen882@gmail.com' && r.projectAnalysis === undefined && r.scopeFingerprint === undefined);
    ok('the record itself is not touched', BASE.request.description === 'Water damage bathroom, replace tub, vanity, tile.' && BASE.thread.length === 1);
    let threw = ''; try { lib.addServiceRequest(BASE, '   '); } catch (e) { threw = e.message; }
    ok('no words -> refused', /Say what the additional service is/.test(threw));
  }

  console.log('\n2. The merge: appended as its own section, everything before it untouched\n');
  {
    const rec = clone(BASE);
    const before = clone(rec);
    const out = lib.mergeAddedService(rec, clone(FRESH), { text: 'Paint the bathroom', service: 'Painting' });
    const e = rec.estimate;
    ok('THE OLD LINES READ BACK EXACTLY, then the new ones follow', JSON.stringify(e.labor.slice(0, 2)) === JSON.stringify(before.estimate.labor) && JSON.stringify(e.materials.slice(0, 1)) === JSON.stringify(before.estimate.materials) && e.labor.length === 5 && e.materials.length === 3, e.labor.length + '/' + e.materials.length);
    ok('...every new line is filed under the new card - the "General" cleanup line too, never loose', e.labor.slice(2).every((l) => l.section === 'Painting') && e.materials.slice(1).every((l) => l.section === 'Painting'), JSON.stringify(e.labor.slice(2).map((l) => l.section)));
    ok('THE OLD CARD IS BYTE-FOR-BYTE AS IT WAS', JSON.stringify(e.serviceBreakdown[0]) === JSON.stringify(before.estimate.serviceBreakdown[0]));
    const card = e.serviceBreakdown[1];
    const own = (3 + 12 + 1) * 55 + 4 * 85;
    ok('THE NEW CARD: its own title, its own scope, its own price at THIS estimate\'s markup (25%), not the fresh run\'s 20%', e.serviceBreakdown.length === 2 && card.title === 'Painting' && card.included.length === 3 && /Honey Badger 920/.test(card.included[1]) && card.notIncluded[0] === 'Wallpaper removal' && card.subtotal === Math.round(own * 1.25 * 100) / 100, JSON.stringify(card));
    ok('the markup itself did not move', e.markupPct === 25);
    ok('THE PUBLISHED SCOPE GETS THE SAME CARD, the old one untouched - so the customer\'s page shows it', JSON.stringify(e.publishedCustomerScope.services[0]) === JSON.stringify(before.estimate.publishedCustomerScope.services[0]) && e.publishedCustomerScope.services.length === 2 && e.publishedCustomerScope.services[1].name === 'Painting' && e.publishedCustomerScope.services[1].subtotal === card.subtotal && e.publishedCustomerScope.services[1].included.length === 3 && e.publishedCustomerScope.services[1].excluded[0] === 'Wallpaper removal' && e.customerScopePublished === true, JSON.stringify(e.publishedCustomerScope.services[1]));
    ok('...and the private draft, so Scope Control lists it', e.manualCustomerScopeDraft.services.length === 2 && e.manualCustomerScopeDraft.services[1].name === 'Painting' && JSON.stringify(e.manualCustomerScopeDraft.services[0]) === JSON.stringify(before.estimate.manualCustomerScopeDraft.services[0]));
    ok('the scope text grows under the old text; title, summary, timeline stay', e.scopeOfWork.indexOf('BATHROOM:\n• Remove the tub') === 0 && /\n\nPAINTING:\n• Prepare and mask the room/.test(e.scopeOfWork) && e.projectTitle === 'Riverside Blvd Bathroom Upgrade' && e.summary === 'Bathroom.' && e.timelineText === '5-7 working days');
    ok('THE STAMPED TOTAL SHE WAS SHOWN GROWS BY EXACTLY THE NEW CARD', rec.customerFinalTotal === Math.round((12697.7 + card.subtotal) * 100) / 100 && out.stampedFrom === 12697.7 && out.stampedTo === rec.customerFinalTotal, rec.customerFinalTotal);
    ok('THE FROZEN SENT VERSION IS NOT TOUCHED: she keeps seeing what she accepted until he sends again', JSON.stringify(rec.sentVersion) === JSON.stringify(before.sentVersion));
    ok('status, analysis and scope pin stay', rec.status === 'accepted' && rec.scopeFingerprint === 'fp-bath' && JSON.stringify(rec.projectAnalysis) === JSON.stringify(before.projectAnalysis));
    ok('the contractor\'s own settings stay (quote photos, offered options)', JSON.stringify(e.quotePhotos) === JSON.stringify(before.estimate.quotePhotos) && JSON.stringify(e.offeredOptions) === '[]');
    ok('it is written down: what was added, when, for how much', e.addedServices.length === 1 && JSON.stringify(e.addedServices[0].titles) === '["Painting"]' && e.addedServices[0].subtotal === card.subtotal && e.addedServices[0].text === 'Paint the bathroom' && /^\d{4}-/.test(e.addedServices[0].at) && JSON.stringify(out.titles) === '["Painting"]' && out.laborLines === 3 && out.materialLines === 2, JSON.stringify(out));
    ok('a scope section for it too', e.scopeSections.length === 1 && e.scopeSections[0].title === 'Painting');
    /* the guard, exercised */
    const snap = lib.snapshot(before.estimate);
    ok('THE GUARD: after the merge the old part reads back exactly', lib.prefixFingerprint(e, snap) === lib.baseFingerprint(snap));
    const tampered = clone(e); tampered.labor[0].rate = 70;
    ok('...and would catch a changed old rate', lib.prefixFingerprint(tampered, snap) !== lib.baseFingerprint(snap));
    const tampered2 = clone(e); tampered2.publishedCustomerScope.services[0].included[0] = 'Something else';
    ok('...or a changed old scope bullet', lib.prefixFingerprint(tampered2, snap) !== lib.baseFingerprint(snap));
  }

  console.log('\n3. Edges\n');
  {
    const rec = clone(BASE);
    const fresh = clone(FRESH); fresh.serviceBreakdown[0].title = 'Bathroom'; fresh.labor.forEach((l) => { l.section = 'Bathroom'; }); fresh.materials.forEach((l) => { l.section = 'Bathroom'; });
    lib.mergeAddedService(rec, fresh, { text: 'more bathroom', service: 'Bathroom' });
    ok('A TITLE THAT ALREADY EXISTS BECOMES "… (additional)": the agreed card is never merged into', rec.estimate.serviceBreakdown.length === 2 && rec.estimate.serviceBreakdown[1].title === 'Bathroom (additional)' && rec.estimate.labor.slice(2).every((l) => l.section === 'Bathroom (additional)') && rec.estimate.serviceBreakdown[0].subtotal === 3884, JSON.stringify(rec.estimate.serviceBreakdown.map((c) => c.title)));
    const recD = clone(BASE);
    const freshD = clone(FRESH); freshD.serviceBreakdown.push({ title: 'Doors', included: ['Door leaves in Louisburg Green HC-113', 'Remove and reinstall hardware'], customerSupplies: [], notIncluded: ['Door replacement'], subtotal: 0, options: [{ label: 'Option A — frames too', description: '', price: 300 }] });
    const outD = lib.mergeAddedService(recD, freshD, { text: 'paint', service: 'Painting' });
    const pc = recD.estimate.serviceBreakdown;
    ok('A CARD WITH NO PRICED LINE ("Doors $0.00") IS FOLDED INTO THE NEW PRICED CARD, never left for the customer page to fold into the bathroom', pc.length === 2 && pc[1].title === 'Painting' && pc[1].included.indexOf('Door leaves in Louisburg Green HC-113') !== -1 && pc[1].notIncluded.indexOf('Door replacement') !== -1 && pc[1].options.length === 0 && JSON.stringify(outD.titles) === '["Painting"]' && recD.estimate.publishedCustomerScope.services.length === 2 && !pc.some((c) => c.subtotal === 0), JSON.stringify(pc.map((c) => [c.title, c.subtotal])));
    ok('...and the card price is exactly its own lines at the estimate\'s markup', pc[1].subtotal === Math.round(((3 + 12 + 1) * 55 + 4 * 85) * 1.25 * 100) / 100);
    ok('the button says what is happening: "Adding the service…", not "Generating…"', /watchGeneration\(ref, jobId, startedAt, "Adding the service… \(the rest stays as it is\)"\)/.test(DASH) && /btn\.innerHTML = '<span class="ai-spin"><\/span> ' \+ \(label \|\| "Generating…"\)/.test(DASH));
    const rec2 = clone(BASE);
    const fresh2 = clone(FRESH); fresh2.serviceBreakdown = [];
    lib.mergeAddedService(rec2, fresh2, { text: 'paint', service: 'Painting' });
    ok('an estimator that wrote lines but no card -> one card named after the service, priced from its lines', rec2.estimate.serviceBreakdown.length === 2 && rec2.estimate.serviceBreakdown[1].title === 'Painting' && rec2.estimate.serviceBreakdown[1].subtotal === Math.round(((3 + 12 + 1) * 55 + 4 * 85) * 1.25 * 100) / 100);
    const rec3 = clone(BASE); delete rec3.customerFinalTotal;
    const o3 = lib.mergeAddedService(rec3, clone(FRESH), { text: 'paint' });
    ok('no stamped total -> none invented; the page prices from the lines', rec3.customerFinalTotal === undefined && o3.stampedFrom === null);
    const rec4 = clone(BASE); delete rec4.estimate.publishedCustomerScope; delete rec4.estimate.manualCustomerScopeDraft; rec4.estimate.customerScopePublished = false;
    lib.mergeAddedService(rec4, clone(FRESH), { text: 'paint' });
    ok('no published scope -> none invented; the card and lines carry it', rec4.estimate.publishedCustomerScope === undefined && rec4.estimate.serviceBreakdown.length === 2);
    let threw = ''; try { lib.mergeAddedService(clone(BASE), { labor: [], materials: [] }, {}); } catch (e) { threw = e.message; }
    ok('an estimator that priced nothing -> refused, nothing changed', /priced nothing/.test(threw));
    threw = ''; try { lib.mergeAddedService({ ref: 'x' }, clone(FRESH), {}); } catch (e) { threw = e.message; }
    ok('a record with no estimate yet -> refused', /generate it first/.test(threw));
    const rec5 = clone(BASE); rec5.estimate.addedServices = Array.from({ length: 10 }, () => ({ titles: ['x'] }));
    threw = ''; try { lib.mergeAddedService(rec5, clone(FRESH), {}); } catch (e) { threw = e.message; }
    ok('ten added services is the ceiling', /already has 10/.test(threw));
  }

  console.log('\n4. The generator is wired for it\n');
  {
    ok('body.addService is read, refused without words, refused before the estimate is priced', /const addSvc = body\.addService && typeof body\.addService === "object"/.test(BG) && /Say what the additional service is/.test(BG) && /Generate and price the estimate first, then add a service to it/.test(BG));
    ok('THE ESTIMATOR GETS THE NEW-WORK REQUEST: input, scope pin (re-read, never reused) and photos all come from it', /const sourceRecord = addSvc \? addServiceRequest\(record, addSvc\.text, addSvc\.service\) : record;/.test(BG) && /buildEstimatorInput\(sourceRecord, body\)/.test(BG) && /resolveScopePin\(sourceRecord, input, addSvc \? Object\.assign\(\{\}, body, \{ reanalyze: true \}\) : body\)/.test(BG) && /photoBlocksForClaude\(sourceRecord\.request, sourceRecord\)/.test(BG));
    ok('THE RESULT IS MERGED, NOT WRITTEN OVER: the ordinary path (analysis, pin, preserved fields, status) runs only when nothing is being added', /if \(addSvc\) \{[\s\S]*?addedReport = mergeAddedService\(record, estimate, \{ text: addSvc\.text, service: addSvc\.service \}\);[\s\S]*?\} else \{[\s\S]*?record\.projectAnalysis = projectAnalysis;[\s\S]*?record\.estimate = estimate;[\s\S]*?record\.status = record\.status === "new" \? "drafted" : record\.status;\s*\}/.test(BG) && /added: addedReport,/.test(BG));
    /* the early refusals, through the real handler with storage stubbed */
    const STORES = { estimates: new Map() };
    const noLines = clone(BASE); noLines.estimate.labor = []; noLines.estimate.materials = [];
    STORES.estimates.set(noLines.ref, JSON.stringify(noLines));
    const realLoad = Module._load;
    Module._load = function (r, p, m) { if (r === '@netlify/blobs') return { getStore: (o) => { const nm = typeof o === 'string' ? o : o.name; const mm = STORES[nm] || (STORES[nm] = new Map()); return { get: async (k) => (mm.has(k) ? JSON.parse(mm.get(k)) : null), setJSON: async (k, v) => { mm.set(k, JSON.stringify(v)); }, set: async (k, v) => { mm.set(k, v); } }; } }; return realLoad(r, p, m); };
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const bg = require(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'));
    let r = await bg.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ ref: noLines.ref, jobId: 'ai-1', addService: { text: '' } }) });
    ok('no words -> 400 before any AI call', r.statusCode === 400 && /Say what the additional service is/.test(r.body), r.statusCode + ' ' + String(r.body).slice(0, 100));
    r = await bg.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ ref: noLines.ref, jobId: 'ai-2', addService: { text: 'paint it' } }) });
    ok('an estimate with no priced lines yet -> 400: generate first', r.statusCode === 400 && /Generate and price the estimate first/.test(r.body), r.statusCode + ' ' + String(r.body).slice(0, 100));
    ok('...and the record was not marked running', JSON.parse(STORES.estimates.get(noLines.ref)).aiStatus === undefined);
    Module._load = realLoad;
  }

  console.log('\n5. The page: the button, the flow, the record taken as the server left it\n');
  {
    ok('THE BUTTON sits in the Regenerate box with its own note', /onclick="addServiceAI\(\)">➕ Add a service to this estimate<\/button>/.test(DASH) && /Everything already in this estimate stays exactly as it is\./.test(DASH));
    const calls = []; const toasts = [];
    const ctx = {
      String, JSON, Math, Date, Object, Array, Error, console: { error() {} }, fmt: (n) => '$' + n,
      currentRecord: { ref: 'SBC-260901-ARWQ', customerFinalTotal: 12697.7, estimate: { labor: [{ item: 'x', qty: 1, rate: 1 }], publishedCustomerScope: { services: [{ name: 'Bathroom' }] }, quotePhotos: ['old.jpg'] } },
      prompt: () => 'Paint the bathroom in Honey Badger 920', toast: (m, bad) => toasts.push((bad ? '!' : '') + m), SBC_HOUSE_RULES: 'rules',
      document: { getElementById: (id) => (id === 'house-rules-text' ? { value: '' } : { disabled: false, innerHTML: '', textContent: '' }) },
      fetch: async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); return { ok: true, status: 202 }; },
      aiJobStart: (ref, jobId, at, extra) => calls.push({ start: ref, jobId, extra }),
      watchGeneration: async () => ({ estimate: { labor: [{ item: 'x', qty: 1, rate: 1 }, { item: 'paint', qty: 2, rate: 55, section: 'Painting' }], publishedCustomerScope: { services: [{ name: 'Bathroom' }, { name: 'Painting' }] }, quotePhotos: ['old.jpg'], addedServices: [{ titles: ['Painting'], subtotal: 1830 }] }, status: 'accepted', customerFinalTotal: 14527.7 }),
      normalizeDisplayFlags() {}, renderEdit() { calls.push({ render: true }); }, CONTRACTOR_OWNED_ESTIMATE_FIELDS: ['publishedCustomerScope', 'quotePhotos'],
    };
    vm.createContext(ctx);
    vm.runInContext([ext(DASH, 'addServiceAI'), ext(DASH, 'applyGeneratedEstimate')].join('\n'), ctx);
    await vm.runInContext('addServiceAI()', ctx);
    const kick = calls.find((c) => c.url);
    ok('➕ ASKS WHAT THE SERVICE IS and starts the estimator with addService (never reanalyze/regenerate), house rules along', kick && /generate-estimate-background/.test(kick.url) && kick.body.addService.text === 'Paint the bathroom in Honey Badger 920' && kick.body.ref === 'SBC-260901-ARWQ' && kick.body.houseRules === 'rules' && kick.body.reanalyze === undefined, JSON.stringify(kick && kick.body));
    ok('the run is noted as an added service, so a reconnect after a locked phone applies it the same way', calls.some((c) => c.start === 'SBC-260901-ARWQ' && c.extra && c.extra.addService === true));
    ok('THE RECORD IS TAKEN AS THE SERVER LEFT IT: the published scope with the new card, the stamped total grown, nothing restored over it', ctx.currentRecord.estimate.publishedCustomerScope.services.length === 2 && ctx.currentRecord.customerFinalTotal === 14527.7 && ctx.currentRecord.estimate.addedServices.length === 1 && calls.some((c) => c.render), JSON.stringify(ctx.currentRecord.customerFinalTotal));
    ok('he is told what was added and to review then send', toasts.some((t) => /Painting added as its own section · \$1830\. The earlier services are untouched\. Review it, then Send to Customer\./.test(t)), toasts.join(' | '));
    /* the ordinary path still restores his settings */
    ctx.currentRecord = { ref: 'R', estimate: { publishedCustomerScope: { services: [{ name: 'Old' }] }, quotePhotos: ['old.jpg'] } };
    vm.runInContext('applyGeneratedEstimate({ estimate: { labor: [] }, status: "drafted" })', ctx);
    ok('a plain regeneration still restores the contractor\'s own settings (unchanged behaviour)', ctx.currentRecord.estimate.publishedCustomerScope.services[0].name === 'Old' && ctx.currentRecord.estimate.quotePhotos[0] === 'old.jpg');
    ctx.currentRecord = { ref: 'R', estimate: { labor: [] } }; toasts.length = 0; ctx.prompt = () => '';
    await vm.runInContext('addServiceAI()', ctx);
    ok('nothing priced yet -> told to generate first; no words -> told to say what', toasts.some((t) => /^!Generate and price the estimate first/.test(t)));
    ok('watchGeneration hands back the stamped total too', /return \{ estimate: rec\.estimate, status: rec\.status, customerFinalTotal: rec\.customerFinalTotal \};/.test(DASH));
    ok('the reconnect path applies an added service the merged way', /applyGeneratedEstimate\(await watchGeneration\(ref, job\.jobId, job\.startedAt, job\.addService === true \? "Adding the service… \(the rest stays as it is\)" : ""\), job\.addService === true\);/.test(DASH) && /map\[ref\] = Object\.assign\(\{ jobId: jobId, startedAt: t \}, extra/.test(DASH));
    const wctx = { String, Number, Array, JSON, CUSTOMER_HAS_SEEN: ['sent', 'accepted'], calcCustomerView: () => ({ customerTotal: 100 }) };
    vm.createContext(wctx);
    vm.runInContext('var CUSTOMER_HAS_SEEN = ["sent","accepted"];\n' + ext(DASH, 'regenerateWarning'), wctx);
    const warn = vm.runInContext('regenerateWarning({ status: "drafted", estimate: { addedServices: [{ titles: ["Painting"] }] } }, false)', wctx);
    ok('REGENERATE WARNS when a service was added: every service is rebuilt, use ➕ Add a service instead', /This estimate has 1 added service \(Painting\)\./.test(warn) && /Regenerating rebuilds EVERY service, including the ones already agreed\. To add more work, use ➕ Add a service instead\./.test(warn), warn);
    const hctx = { esc: (s) => String(s), fmt: (n) => '$' + n, Array, String, estimates: [] };
    vm.createContext(hctx);
    vm.runInContext(ext(DASH, 'addonLink') + '\n' + ext(DASH, 'addonHeaderHtml'), hctx);
    ok('the record header names the added section and the untouched earlier ones', /➕ Added as own sections: Painting \$1830 \(2026-09-20\) · the earlier services untouched/.test(vm.runInContext('addonHeaderHtml({ ref: "R", estimate: { addedServices: [{ titles: ["Painting"], subtotal: 1830, at: "2026-09-20T15:00:00Z" }] } })', hctx)));
    const A = fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant.js'), 'utf8');
    ok('THE ASSISTANT points him to ➕ Add a service, never to regenerate, for work added after agreement', /never tell him to regenerate - regenerating rebuilds every service/.test(A) && /➕ ADD A SERVICE TO THIS ESTIMATE/.test(A));
    const blocks = DASH.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    let broken = null;
    blocks.forEach(function (bl, i) { try { new vm.Script(bl.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; } });
    ok('all ' + blocks.length + ' dashboard script blocks parse', broken === null, broken || '');
  }
  console.log('\n6. The brief from the assistant: "can i put description from my AI?"\n');
  {
    /* the server: an addservice action comes back as data with ref, service and the brief */
    const STORES2 = {};
    const realLoad2 = Module._load;
    Module._load = function (r, p, m) { if (r === '@netlify/blobs') return { getStore: (o) => { const mm = STORES2[o.name] || (STORES2[o.name] = new Map()); return { get: async (k) => (mm.has(k) ? JSON.parse(mm.get(k)) : null), set: async (k, v) => { mm.set(k, v); }, delete: async (k) => { mm.delete(k); } }; } }; return realLoad2(r, p, m); };
    const https = require('https');
    const realRequest = https.request;
    let sentSys = '';
    const sse = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
    https.request = function (opts, cb) {
      const res = { statusCode: 200, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
      return { on() { return this; }, write(b) { sentSys = JSON.parse(b).system; }, destroy() {}, end() { setImmediate(() => { cb(res); res._data(Buffer.from(sse({ type: 'message_start' }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Adding the painting May asked for by email.\nACTION: {"type":"addservice","ref":"SBC-260901-ARWQ","service":"Painting","text":"Paint the bathroom walls, ceiling, baseboard and trim in Benjamin Moore Regal Select Honey Badger 920 eggshell; doors in Louisburg Green HC-113 satin. About 8 gallons."}' } }) + sse({ type: 'message_stop' }))); if (res._end) res._end(); }); } };
    };
    process.env.DASHBOARD_KEY = 'k'; process.env.ANTHROPIC_API_KEY = 'sk';
    const fn = require(path.join(ROOT, 'netlify/functions/assistant.js'));
    const r = await fn.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ chat: 'SBC-260901-ARWQ', ref: '', messages: [{ role: 'user', text: 'add the painting she asked for to this estimate' }] }) });
    const b = JSON.parse(r.body);
    ok('THE ASSISTANT CAN HAND OVER THE BRIEF: an addservice action with the ref, the trade and the text, the words kept as words', r.statusCode === 200 && b.actions.length === 1 && b.actions[0].type === 'addservice' && b.actions[0].ref === 'SBC-260901-ARWQ' && b.actions[0].service === 'Painting' && /Honey Badger 920 eggshell/.test(b.actions[0].text) && /Adding the painting/.test(b.reply) && !/ACTION:/.test(b.reply), JSON.stringify(b).slice(0, 300));
    ok('it is told when and how: the brief from the chat, emails and photos; the agreed sections not touched; nothing invented', /ADD A SERVICE TO AN ESTIMATE THE CUSTOMER ALREADY AGREED TO: ACTION: \{"type":"addservice"/.test(sentSys) && /the estimator prices ONLY that work and adds it as its own section; the agreed sections are not touched/.test(sentSys) && /nothing invented/.test(sentSys) && /Do it for him with the addservice action when you know what the work is/.test(sentSys));
    https.request = realRequest; Module._load = realLoad2;

    /* the page: the action confirms the brief and runs the same add-a-service path */
    ok('aiExec has the branch', /if \(t === "addservice"\) \{/.test(DASH));
    const calls = []; const toasts = []; let confirmed = '';
    const ctx = {
      String, JSON, Math, Date, Object, Array, Error, Promise, setTimeout, console: { error() {} }, fmt: (n) => '$' + n,
      currentRecord: { ref: 'SBC-260901-ARWQ', estimate: { labor: [{ item: 'x', qty: 1, rate: 1 }] } }, estimates: [{ ref: 'SBC-260901-ARWQ' }],
      prompt: () => { calls.push({ prompted: true }); return 'never'; }, confirm: (m) => { confirmed = m; return true; }, toast: (m, bad) => toasts.push((bad ? '!' : '') + m), SBC_HOUSE_RULES: '',
      document: { getElementById: () => ({ disabled: false, innerHTML: '', textContent: '', value: '' }) },
      fetch: async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); return { ok: true, status: 202 }; },
      aiJobStart() {}, watchGeneration: async () => ({ estimate: { labor: [], addedServices: [{ titles: ['Painting'], subtotal: 1830 }] }, status: 'accepted' }),
      normalizeDisplayFlags() {}, renderEdit() {}, CONTRACTOR_OWNED_ESTIMATE_FIELDS: [],
    };
    vm.createContext(ctx);
    vm.runInContext([ext(DASH, 'addServiceAI'), ext(DASH, 'applyGeneratedEstimate'), ext(DASH, 'aiExec')].join('\n'), ctx);
    const said = await vm.runInContext('aiExec({ type: "addservice", ref: "SBC-260901-ARWQ", service: "Painting", text: "Paint the bathroom in Honey Badger 920." })', ctx);
    const kick = calls.find((c) => c.url);
    ok('THE BRIEF IS SHOWN WHOLE AND CONFIRMED ONCE - no typing - then the estimator runs on it with the trade name', /Add this as its own section of SBC-260901-ARWQ\?/.test(confirmed) && /Painting\nPaint the bathroom in Honey Badger 920\./.test(confirmed) && /Everything already in this estimate stays exactly as it is/.test(confirmed) && !calls.some((c) => c.prompted) && kick && kick.body.addService.text === 'Paint the bathroom in Honey Badger 920.' && kick.body.addService.service === 'Painting', confirmed + ' | ' + JSON.stringify(kick && kick.body));
    ok('...and the chat says so', /Adding it to SBC-260901-ARWQ as its own section; the earlier services stay as they are\./.test(said), said);
    ctx.confirm = () => false; calls.length = 0;
    ok('a declined brief adds nothing', (await vm.runInContext('aiExec({ type: "addservice", ref: "SBC-260901-ARWQ", text: "x" })', ctx)) === 'OK, not added.' && !calls.some((c) => c.url));
    ok('an unknown ref is refused', /I don't see SBC-000000-NOPE/.test(await vm.runInContext('aiExec({ type: "addservice", ref: "SBC-000000-NOPE", text: "x" })', ctx)));
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
