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

console.log('\n2. The customer page, the dashboard and the PDF all use it\n');
{
  const q = { A: (v) => (Array.isArray(v) ? v : []), JSON, Object };
  vm.createContext(q);
  vm.runInContext([constFrom(QUOTE, 'SHARED_STOCK'), constFrom(QUOTE, 'SHARED_RE'), extFrom(QUOTE, 'sharedKey'), extFrom(QUOTE, 'sharedLine'), extFrom(QUOTE, 'sharedOnce')].join('\n'), q);
  const d = { JSON, Object };
  vm.createContext(d);
  vm.runInContext([constFrom(DASH, 'SHARED_STOCK'), constFrom(DASH, 'SHARED_RE'), extFrom(DASH, 'sharedKey'), extFrom(DASH, 'sharedLine'), extFrom(DASH, 'sharedOnce')].join('\n'), d);
  const cases = [[PROJECT, astoria()], [['We clean up daily.'], [{ included: ['Protect the tub with a hard cover', 'Tile'] }, { included: ['Protect the tub with a hard cover', 'Protect the new floor', 'Lay'] }]], [PROJECT, [{ included: [PROTECT, BAG] }, { included: ['Paint'] }]], [[], astoria()], [PROJECT, [astoria()[0]]]];
  const same = cases.every(([p, c]) => { const a = JSON.stringify(L.sharedOnce(p, clone(c))); return a === JSON.stringify(vm.runInContext('sharedOnce(' + JSON.stringify(p) + ',' + JSON.stringify(c) + ')', q)) && a === JSON.stringify(vm.runInContext('sharedOnce(' + JSON.stringify(p) + ',' + JSON.stringify(c) + ')', d)); });
  ok('THE THREE COPIES GIVE THE SAME ANSWER on every case (lib, quote.html, dashboard.html)', same);
  ok('same four sentences and the same pattern in all three', vm.runInContext('SHARED_RE.source', q) === L.SHARED_RE.source && vm.runInContext('SHARED_RE.source', d) === L.SHARED_RE.source && JSON.stringify(vm.runInContext('SHARED_STOCK', q)) === JSON.stringify(L.SHARED_STOCK) && JSON.stringify(vm.runInContext('SHARED_STOCK', d)) === JSON.stringify(L.SHARED_STOCK));

  ok('THE CUSTOMER PAGE: both ways the cards are built end in sharedOnce (published draft and AI cards)', /if\(!ps\)return sharedOnce\(e\.projectIncluded,reconcileCards\(e,foldZeroPriceServices\(pubScope\(e,active\)\)\)\);/.test(QUOTE) && /return sharedOnce\(e\.projectIncluded,reconcileCards\(e,foldZeroPriceServices\(out\)\)\)\}/.test(QUOTE));

  // the dashboard: the Services panel reads scopeDraft(), and Save publishes what it holds
  const dd = { JSON, Object, Array, String };
  vm.createContext(dd);
  vm.runInContext([constFrom(DASH, 'SHARED_STOCK'), constFrom(DASH, 'SHARED_RE'), extFrom(DASH, 'sharedKey'), extFrom(DASH, 'sharedLine'), extFrom(DASH, 'sharedOnce'), extFrom(DASH, 'scopeDraft')].join('\n'), dd);
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

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
