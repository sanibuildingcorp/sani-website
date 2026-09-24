/* shared-once.test.js — run: node js/shared-once.test.js
 *
 *   The Astoria estimate, after regenerate and Save: "Included for the whole
 *   project" is there - and every card still says "Protect your floors...",
 *   "Bag, carry out...", "Clean the space daily...", "Coordinate and
 *   supervise..." again.
 *
 * The cards came from a Services draft saved before shared work was moved
 * off the cards, and the customer page reads the draft. Now the same rule
 * runs wherever cards are shown - customer page, dashboard panel, scope
 * PDF: with a whole-project list and 2+ cards, the stock shared sentences,
 * the project list's own lines, and shared work written on 2+ cards come off
 * the cards. A card is never emptied; one card or no project list changes
 * nothing.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const L = require(path.join(ROOT, 'netlify/functions/lib/shared-once.js'));
const PDF = require(path.join(ROOT, 'netlify/functions/lib/scope-pdf.js'));
const C = require(path.join(ROOT, 'netlify/functions/lib/contractor-owned-fields.js'));
const QUOTE = fs.readFileSync(path.join(ROOT, 'quote.html'), 'utf8');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
function extFrom(src, name) {
  const s = src.search(new RegExp('function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = src.indexOf('{', s); j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) return src.slice(s, j + 1); } }
  throw new Error('unbalanced ' + name);
}
function constFrom(src, name) { const m = src.match(new RegExp('(?:const|var) ' + name + '\\s*=\\s*[^\\n]*;')); if (!m) throw new Error('missing ' + name); return m[0]; }
const clone = (o) => JSON.parse(JSON.stringify(o));

const [PROTECT, BAG, CLEAN, COORD] = L.SHARED_STOCK;
const PROJECT = ['We cover the common stairs, hallway and entry on the debris route before anything comes out.', 'We set dust barriers at the bathroom and protect the new hardwood once it is down.', 'We carry all debris down the three flights by hand and load it into our container at the curb.', 'We clean up at the end of each day and leave the apartment clean at the finish.'];
function astoria() {
  return [
    { title: 'Bathroom', included: [PROTECT, 'Remove the existing bathroom down to the substrate', BAG, 'Install a full waterproofing system in the shower and wet areas', 'Install the new door, frame and hardware', CLEAN, COORD] },
    { title: 'Flooring', included: [PROTECT, 'Remove the existing work and prepare the surfaces underneath', BAG, 'Install the new flooring, including cuts, fitting and finish details', 'Install the new door, frame and hardware', CLEAN, COORD] },
    { title: 'Painting', included: [PROTECT, BAG, 'Prepare, prime and paint every included wall, ceiling, door and trim surface', CLEAN, COORD] },
    { title: 'Windows', included: [PROTECT, BAG, 'Remove the existing windows, prepare the openings, install the new units and seal them weathertight', CLEAN, COORD] },
  ];
}
const shared = [PROTECT, BAG, CLEAN, COORD];
/* The Astoria cards after Rebuild draft from AI, in the order the AI gave them. */
function ASTORIA_TIDY() {
  return [
    { title: 'Windows', subtotal: 8748.63, included: ['We remove the six existing windows.'], customerSupplies: [], notIncluded: ['Sidewalk shed, scaffold or lift if the building wants the windows done from the outside.', 'Exterior scaffolding, sidewalk shed or lift rental if the building requires outside access for the windows.'] },
    { title: 'Painting', subtotal: 6976.13, included: ['We apply two coats to all ceilings, about 760 square feet.', 'We apply two coats to all walls, about 2,200 square feet.'], customerSupplies: ['Finish paint for walls, ceilings, doors and trim', 'Paint for the entire apartment'], notIncluded: ['You supply the finish paint; we supply the primer, patching materials and sundries.'] },
    { title: 'Bathroom', subtotal: 15877.83, included: ['We demolish the existing bathroom.'], customerSupplies: ['Wall & floor tile', 'Vanity & sink', 'Toilet'], notIncluded: ['The plumbing layout stays the same, so the shower, toilet and vanity remain in their current spots.', 'No plumbing lines are rerouted and no new lines are run.', 'Tile, vanity, sink, toilet, glass enclosure, mirror and light fixture are owner-supplied.'] },
    { title: 'Flooring', subtotal: 8828.59, included: ['We remove the existing floor covering.'], customerSupplies: ['Engineered hardwood flooring, approx. 800 SF'], notIncluded: ['Hidden conditions found behind walls or under the floor once demolition starts.', 'No baseboards are included.', 'You supply the engineered hardwood; our price covers the labor and install materials.'] },
  ];
}

console.log('\n1. The rule\n');
{
  const cards = L.sharedOnce(PROJECT, astoria());
  ok('THE FOUR STOCK LINES COME OFF EVERY CARD on the Astoria estimate', cards.every((c) => c.included.every((x) => shared.indexOf(x) === -1)), JSON.stringify(cards.map((c) => c.included.length)));
  ok('...and every line that is the card\'s own work stays, in order', cards[0].included.join('|') === 'Remove the existing bathroom down to the substrate|Install a full waterproofing system in the shower and wet areas|Install the new door, frame and hardware' && cards[3].included.length === 1);
  ok('work that is not shared stays even when two cards say it ("Install the new door...")', cards[1].included.indexOf('Install the new door, frame and hardware') !== -1);

  const two = [{ title: 'Bathroom', included: ['Protect the tub with a hard cover', 'Tile the shower'] }, { title: 'Flooring', included: ['Protect the tub with a hard cover', 'Protect the new floor with ram board', 'Lay the floor'] }];
  L.sharedOnce(['We clean up daily.'], two);
  ok('shared work written word for word on 2+ cards comes off; shared work on ONE card stays', two[0].included.join('|') === 'Tile the shower' && two[1].included.join('|') === 'Protect the new floor with ram board|Lay the floor', JSON.stringify(two));

  const dup = [{ included: ['We clean up daily.', 'Tile'] }, { included: ['Paint'] }];
  L.sharedOnce(['We clean up daily.'], dup);
  ok('a line already in the whole-project list comes off the card', dup[0].included.join('|') === 'Tile');

  const only = [{ included: [PROTECT, BAG] }, { included: ['Paint'] }];
  L.sharedOnce(PROJECT, only);
  ok('A CARD IS NEVER EMPTIED by it', only[0].included.length === 2);

  const none = astoria();
  L.sharedOnce([], none);
  ok('no whole-project list: nothing changes (nowhere else to say it)', JSON.stringify(none) === JSON.stringify(astoria()));
  const one = [astoria()[0]];
  L.sharedOnce(PROJECT, one);
  ok('one card: nothing changes (the shared work belongs on it)', one[0].included.length === 7);
  const objs = [{ included: [{ text: PROTECT }, { text: 'Tile' }] }, { included: ['Paint'] }];
  L.sharedOnce([{ text: 'x' }], objs);
  ok('lines written as {text} objects are read the same way', objs[0].included.length === 1 && objs[0].included[0].text === 'Tile');
}

console.log('\n1b. Each point once, and the biggest card first\n');
{
  const cards = L.bySize(L.tidyCards(PROJECT, ASTORIA_TIDY(), { sup: 'customerSupplies', exc: 'notIncluded' }));
  const by = {}; cards.forEach((c) => { by[c.title] = c; });
  ok('BIGGEST CARD FIRST: Bathroom $15,877, Flooring $8,828, Windows $8,748, Painting $6,976', cards.map((c) => c.title).join(',') === 'Bathroom,Flooring,Windows,Painting');
  ok('NOT INCLUDED NO LONGER REPEATS CUSTOMER SUPPLIES (Bathroom "owner-supplied", Flooring "You supply the hardwood", Painting "You supply the finish paint")', !by.Bathroom.notIncluded.some((x) => /owner-supplied/.test(x)) && !by.Flooring.notIncluded.some((x) => /You supply/.test(x)) && by.Painting.notIncluded.length === 0, JSON.stringify(cards.map((c) => c.notIncluded)));
  ok('THE TWO SCAFFOLD LINES ON WINDOWS BECOME ONE - the fuller one', by.Windows.notIncluded.length === 1 && /^Exterior scaffolding/.test(by.Windows.notIncluded[0]));
  ok('real limits stay: hidden conditions, no baseboards, the plumbing layout', by.Flooring.notIncluded.join('|') === 'Hidden conditions found behind walls or under the floor once demolition starts.|No baseboards are included.' && by.Bathroom.notIncluded.length === 2);
  ok('INCLUDED IS NOT MERGED: "two coats on the ceilings" and "two coats on the walls" are two jobs', by.Painting.included.length === 2);
  ok('customer supplies keep every item (tile, vanity, toilet)', by.Bathroom.customerSupplies.length === 3);
  const lone = [{ customerSupplies: [], notIncluded: ['You supply the paint.'] }];
  L.tidyCards([], lone, { sup: 'customerSupplies', exc: 'notIncluded' });
  ok('a "you supply" line STAYS when the card has no Customer supplies list (it is the only place it is said)', lone[0].notIncluded.length === 1);
  ok('ties keep their order (a stable sort)', L.bySize([{ t: 'a', subtotal: 1 }, { t: 'b', subtotal: 1 }, { t: 'c', subtotal: 2 }]).map((x) => x.t).join('') === 'cab');
}

console.log('\n2. The customer page, the dashboard and the PDF all use it\n');
{
  const NAMES_C = ['SHARED_STOCK', 'SHARED_RE', 'SUPPLY_SAY', 'IDEA_STOP', 'PRICED_SHARED'];
  const NAMES_F = ['sharedKey', 'sharedLine', 'sharedOnce', 'ideaWords', 'sameIdea', 'onceEach', 'tidyCards', 'bySize', 'pricedNames', 'showPricedShared'];
  const load = (src, ctx, extra) => { vm.createContext(ctx); vm.runInContext(NAMES_C.map((n) => constFrom(src, n)).concat(NAMES_F.map((n) => extFrom(src, n)), (extra || []).map((n) => extFrom(src, n))).join('\n'), ctx); return ctx; };
  const q = load(QUOTE, { A: (v) => (Array.isArray(v) ? v : []), JSON, Object, Array, String, Number, Set, Math });
  const d = load(DASH, { JSON, Object, Array, String, Number, Set, Math });
  const cases = [[PROJECT, astoria()], [['We clean up daily.'], [{ included: ['Protect the tub with a hard cover', 'Tile'] }, { included: ['Protect the tub with a hard cover', 'Protect the new floor', 'Lay'] }]], [PROJECT, [{ included: [PROTECT, BAG] }, { included: ['Paint'] }]], [[], astoria()], [PROJECT, [astoria()[0]]]];
  const same = cases.every(([p, c]) => { const a = JSON.stringify(L.sharedOnce(p, clone(c))); return a === JSON.stringify(vm.runInContext('sharedOnce(' + JSON.stringify(p) + ',' + JSON.stringify(c) + ')', q)) && a === JSON.stringify(vm.runInContext('sharedOnce(' + JSON.stringify(p) + ',' + JSON.stringify(c) + ')', d)); });
  ok('THE THREE COPIES GIVE THE SAME ANSWER on every case (lib, quote.html, dashboard.html)', same);
  const tcase = JSON.stringify(ASTORIA_TIDY());
  const tl = JSON.stringify(L.bySize(L.tidyCards(PROJECT, ASTORIA_TIDY(), { sup: 'customerSupplies', exc: 'notIncluded' })));
  const tcall = 'JSON.stringify(bySize(tidyCards(' + JSON.stringify(PROJECT) + ',' + tcase + ',{sup:"customerSupplies",exc:"notIncluded"})))';
  ok('...and the same tidy and order (each point once, biggest first)', tl === vm.runInContext(tcall, q) && tl === vm.runInContext(tcall, d));
  ok('same sentences and the same patterns in all three', ['SHARED_RE', 'SUPPLY_SAY', 'IDEA_STOP'].every((n) => vm.runInContext(n + '.source', q) === vm.runInContext(n + '.source', d)) && vm.runInContext('SHARED_RE.source', d) === L.SHARED_RE.source && vm.runInContext('SUPPLY_SAY.source', d) === L.SUPPLY_SAY.source && JSON.stringify(vm.runInContext('SHARED_STOCK', q)) === JSON.stringify(L.SHARED_STOCK) && JSON.stringify(vm.runInContext('SHARED_STOCK', d)) === JSON.stringify(L.SHARED_STOCK));

  ok('THE CUSTOMER PAGE: both ways the cards are built end in tidy + biggest first (published draft and AI cards)', /if\(!ps\)return bySize\(tidyCards\(e\.projectIncluded,reconcileCards\(e,foldZeroPriceServices\(pubScope\(e,active\)\)\),\{sup:'customerSupplies',exc:'notIncluded'\},pricedNames\(e\)\)\);/.test(QUOTE) && /return bySize\(tidyCards\(e\.projectIncluded,reconcileCards\(e,foldZeroPriceServices\(out\)\),\{sup:'customerSupplies',exc:'notIncluded'\},pricedNames\(e\)\)\)\}/.test(QUOTE));

  // the dashboard: the Services panel reads scopeDraft(), and Save publishes what it holds
  const dd = load(DASH, { JSON, Object, Array, String, Number, Set, Math }, ['scopeDraft']);
  const draft = { services: astoria().map((c) => ({ name: c.title, included: c.included, supplied: [], excluded: [] })) };
  dd.currentRecord = { estimate: { labor: [{ item: 'x' }], projectIncluded: PROJECT, manualCustomerScopeDraft: draft } };
  const got = vm.runInContext('scopeDraft()', dd);
  ok('THE DASHBOARD PANEL: the saved Astoria draft is shown (and saved) without the four lines', got.services.every((s) => s.included.every((x) => shared.indexOf(x) === -1)) && got.services[0].included.length === 3, JSON.stringify(got.services.map((s) => s.included.length)));

  const cards = PDF.scopeCards({ serviceBreakdown: astoria(), projectIncluded: PROJECT });
  ok('THE SCOPE PDF: "Whole project" first, then cards without the four lines', cards[0].title === 'Whole project' && cards[0].included.length === 4 && cards.slice(1).every((c) => c.included.every((x) => shared.indexOf(x) === -1)), JSON.stringify(cards.map((c) => c.title + ':' + c.included.length)));
}

console.log('\n3. Regenerate still sees a cleaned draft as the AI\'s wording\n');
{
  const cards = astoria();
  const row = (c) => ({ name: c.title, included: c.included.filter((x) => shared.indexOf(x) === -1), supplied: [], excluded: [] });
  const prev = { serviceBreakdown: cards.map((c) => ({ title: c.title, included: c.included.slice(), customerSupplies: [], notIncluded: [] })), projectIncluded: PROJECT, manualCustomerScopeDraft: { services: cards.map(row) } };
  ok('a draft that differs only by the shared lines still mirrors the AI, so Regenerate replaces it', C.scopeMirrorsAi(prev) === true && C.forRegenerate(prev).reset === true);
  prev.manualCustomerScopeDraft.services[0].included[0] = 'We keep the old tub.';
  ok('...a real edit is still kept', C.forRegenerate(prev).kept === true);
}

const GEN = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'), 'utf8');
const WRITER = fs.readFileSync(path.join(ROOT, 'netlify/functions/lib/scope-writer.js'), 'utf8');
console.log('\n4. The draft the page tidied, the generator, the writer\n');
{
  const cards = ASTORIA_TIDY();
  const prev = { serviceBreakdown: clone(cards), projectIncluded: PROJECT, manualCustomerScopeDraft: { services: L.tidyCards(PROJECT, clone(cards), { sup: 'customerSupplies', exc: 'notIncluded' }).map((c) => ({ name: c.title, included: c.included, supplied: c.customerSupplies, excluded: c.notIncluded })) } };
  ok('a draft the dashboard tidied still mirrors the untidied AI cards (Regenerate still gives new wording)', C.scopeMirrorsAi(prev) === true);
  ok('THE GENERATOR tidies and orders the cards after the writer, then rebuilds the scope box', /timing\.scopeMs = Date\.now\(\) - scopeStarted;[\s\S]{0,400}bySize\(tidyCards\(estimate\.projectIncluded, estimate\.serviceBreakdown, \{ sup: "customerSupplies", exc: "notIncluded" \}, pricedNames\(estimate\)\)\);\s*syncScopeText\(estimate\);/.test(GEN));
  ok('THE WRITER is told: never restate customer supplies, say each limit once', /Never restate what the customer supplies - that list is shown right beside this one\./.test(WRITER) && /Say each limit once\. Two bullets that mean the same thing in different words is one bullet\./.test(WRITER));
  ok('THE DASHBOARD orders biggest first when the draft is built, on Rebuild and on Save - not while typing', /est\.manualCustomerScopeDraft = buildScopeDraftFromAI\(\);\s*scopeSortBySize\(est\.manualCustomerScopeDraft\);/.test(DASH) && /buildScopeDraftFromAI\(true\);\s*scopeSortBySize\(currentRecord\.estimate\.manualCustomerScopeDraft\);/.test(DASH) && /scopeSortBySize\(scopeDraft\(\)\);\s*var clean = scopeCleanCopy\(\);/.test(DASH) && (DASH.match(/scopeSortBySize\(/g) || []).length === 4);
  const dd = { JSON, Object, Array, String, Number, Set, Math };
  vm.createContext(dd);
  vm.runInContext(['SHARED_STOCK', 'SHARED_RE', 'SUPPLY_SAY', 'IDEA_STOP'].map((n) => constFrom(DASH, n)).concat(['bySize', 'scopeSortBySize'].map((n) => extFrom(DASH, n))).join('\n'), dd);
  dd.scopeServiceSubtotal = (n) => ({ Windows: 8748.63, Painting: 6976.13, Bathroom: 15877.83, Flooring: 8828.59 })[n];
  const sorted = vm.runInContext('scopeSortBySize({ services: [{ name: "Windows" }, { name: "Painting" }, { name: "Bathroom" }, { name: "Flooring" }] })', dd);
  ok('...by the card\'s own total', sorted.services.map((x) => x.name).join(',') === 'Bathroom,Flooring,Windows,Painting');
  const pdf = PDF.scopeCards({ serviceBreakdown: ASTORIA_TIDY(), projectIncluded: PROJECT });
  ok('THE PDF: whole project, then Bathroom, Flooring, Windows, Painting, tidied', pdf.map((c) => c.title).join(',') === 'Whole project,Bathroom,Flooring,Windows,Painting' && pdf[3].excluded.length === 1, pdf.map((c) => c.title).join(','));
}

console.log('\n5. Priced shared work is never silent ("the customer question is about debris removal")\n');
{
  /* May Chen, 100 Riverside Blvd: one Bathroom card written in sentences;
     the estimate priced a debris haul-out, a tub haul-away and disposal,
     and she asked for "Removal of construction debris" as a change. */
  const may = () => ({
    labor: [
      { item: 'Site protection and setup — floor and hallway protection, door dust barrier', qty: 1, rate: 420 },
      { item: 'Bathtub removal — cut out and extract tub', qty: 1, rate: 650 },
      { item: 'Debris haul-out from unit to building loading area via freight elevator', qty: 1, rate: 380 },
      { item: 'Bathtub haul-away and disposal fee', qty: 1, rate: 225 },
      { item: 'Disposal of general bathroom demolition debris (vanity, toilet, mirror, packaging)', qty: 1, rate: 180 },
      { item: 'Double vanity installation — set, level, anchor to wall', qty: 1, rate: 900 },
      { item: 'Final cleanup, fixture polish and punch list', qty: 1, rate: 260 },
      { item: 'Project coordination and supervision — building COI, alteration paperwork', qty: 1, rate: 500 },
      { item: 'Note: customer supplies toilets', qty: 1, rate: 0 },
    ],
    materials: [{ item: 'Mold-resistant primer/sealer, 1 gal', qty: 1, rate: 48 }],
  });
  const cards = () => [{ title: 'Bathroom', subtotal: 12697.7, included: ['Protect the occupied apartment and the building\'s common areas before any work begins.', 'Shut off and drain down the bathroom water supply, disconnect the existing fixtures, and remove the bathtub, the existing single vanity, the toilet and the existing mirror.', 'Supply and install the new 60 in. double-sink vanity.'], customerSupplies: ['2 Toilets'], notIncluded: [] }];
  const K = { sup: 'customerSupplies', exc: 'notIncluded' };
  const one = L.tidyCards([], cards(), K, L.pricedNames(may()));
  ok('HER ONE CARD NOW SAYS THE DEBRIS IS CARRIED OUT AND DISPOSED OF', one[0].included.indexOf(BAG) !== -1, JSON.stringify(one[0].included));
  ok('...and the priced cleanup and supervision too; protection was already said, so not twice', one[0].included.indexOf(CLEAN) !== -1 && one[0].included.indexOf(COORD) !== -1 && one[0].included.indexOf(PROTECT) === -1);
  ok('...her own lines stay, first and in order', one[0].included.slice(0, 3).join('|') === cards()[0].included.join('|'));
  const again = L.tidyCards([], one, K, L.pricedNames(may()));
  ok('...run again (every render does), nothing is added twice', again[0].included.length === one[0].included.length);
  ok('a free line (rate 0) is not priced work', L.pricedNames(may()).every((t) => !/^Note:/.test(t)));
  const said = cards(); said[0].included.push('We carry all demolition debris down by freight elevator and dispose of it.');
  ok('when a card already says it in its own words, nothing is added', L.tidyCards([], said, K, L.pricedNames(may()))[0].included.filter((x) => x === BAG).length === 0);
  const noDebris = may(); noDebris.labor = noDebris.labor.filter((l) => !/debris|haul|disposal/i.test(l.item));
  ok('nothing priced for debris: no debris line is added', L.tidyCards([], cards(), K, L.pricedNames(noDebris))[0].included.indexOf(BAG) === -1);
  const proj = ['We cover the hallway.'];
  const two = [{ title: 'Bathroom', subtotal: 9000, included: ['Tile'] }, { title: 'Painting', subtotal: 2000, included: ['Paint'] }];
  L.tidyCards(proj, two, K, L.pricedNames(may()));
  ok('two or more cards: the line goes to "Included for the whole project", not on a card', proj.indexOf(BAG) !== -1 && two.every((c) => c.included.indexOf(BAG) === -1));
  const noProj = [{ title: 'Bathroom', subtotal: 2000, included: ['Tile'] }, { title: 'Painting', subtotal: 9000, included: ['Paint'] }];
  L.tidyCards(undefined, noProj, K, L.pricedNames(may()));
  ok('...and with no whole-project list, on the biggest card', noProj[1].included.indexOf(BAG) !== -1 && noProj[0].included.indexOf(BAG) === -1);
  ok('without the priced lines (older callers), tidyCards changes nothing new', L.tidyCards([], cards(), K)[0].included.length === 3);

  const q = (function () { const ctx = { A: (v) => (Array.isArray(v) ? v : []), JSON, Object, Array, String, Number, Set, Math }; vm.createContext(ctx); vm.runInContext(['SHARED_STOCK', 'SHARED_RE', 'SUPPLY_SAY', 'IDEA_STOP', 'PRICED_SHARED'].map((n) => constFrom(QUOTE, n)).concat(['sharedKey', 'sharedLine', 'sharedOnce', 'ideaWords', 'sameIdea', 'onceEach', 'tidyCards', 'bySize', 'pricedNames', 'showPricedShared'].map((n) => extFrom(QUOTE, n))).join('\n'), ctx); return ctx; })();
  const d = (function () { const ctx = { JSON, Object, Array, String, Number, Set, Math }; vm.createContext(ctx); vm.runInContext(['SHARED_STOCK', 'SHARED_RE', 'SUPPLY_SAY', 'IDEA_STOP', 'PRICED_SHARED'].map((n) => constFrom(DASH, n)).concat(['sharedKey', 'sharedLine', 'sharedOnce', 'ideaWords', 'sameIdea', 'onceEach', 'tidyCards', 'bySize', 'pricedNames', 'showPricedShared'].map((n) => extFrom(DASH, n))).join('\n'), ctx); return ctx; })();
  const call = (ctx, p, c) => vm.runInContext('JSON.stringify([tidyCards(' + JSON.stringify(p) + ',' + JSON.stringify(c) + ',{sup:"customerSupplies",exc:"notIncluded"},pricedNames(' + JSON.stringify(may()) + '))])', ctx);
  const lib = (p, c) => { const pp = p === undefined ? undefined : clone(p); const out = L.tidyCards(pp, clone(c), K, L.pricedNames(may())); return JSON.stringify([out]); };
  const same = [[[], cards()], [['We cover the hallway.'], [{ title: 'A', subtotal: 1, included: ['x'] }, { title: 'B', subtotal: 2, included: ['y'] }]], [undefined, [{ title: 'A', subtotal: 5, included: ['x'] }, { title: 'B', subtotal: 2, included: ['y'] }]]].every(([p, c]) => { const a = lib(p, c); return a === call(q, p, c) && a === call(d, p, c); });
  ok('THE THREE COPIES AGREE (lib, customer page, dashboard)', same);
  ok('...the customer page, the dashboard draft, the scope PDF and the generator all pass the priced lines', /,pricedNames\(e\)\)\);/.test(QUOTE) && /tidyCards\(est\.projectIncluded, est\.manualCustomerScopeDraft\.services, \{ sup: "supplied", exc: "excluded" \}, pricedNames\(est\)\);/.test(DASH) && /pricedNames\(e\)\)\);/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/lib/scope-pdf.js'), 'utf8')) && /pricedNames\(estimate\)\)\);/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'), 'utf8')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
