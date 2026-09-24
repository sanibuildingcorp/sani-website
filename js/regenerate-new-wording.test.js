/* regenerate-new-wording.test.js — run: node js/regenerate-new-wording.test.js
 *
 *   The Astoria estimate, regenerated after "shared work once" shipped: new
 *   prices, a new summary, a new timeline - and the same stock lines on
 *   every card, and no "Included for the whole project".
 *
 * Two causes. (1) The Services draft saved from the first generation was
 * carried over as a contractor setting and the customer's page reads the
 * draft, so Regenerate never changed the card wording. (2) Save and Send
 * rebuild the estimate from the form and did not carry projectIncluded, so
 * the whole-project list was stripped on the way to the customer.
 *
 * Now a draft that only mirrors the AI's cards is dropped on a regenerate
 * (server and browser both); a draft the contractor edited is kept and the panel says
 * so; and Save / Send carry the new fields.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const C = require(path.join(ROOT, 'netlify/functions/lib/contractor-owned-fields.js'));
const GEN = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'), 'utf8');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

const STOCK = ['Protect your floors, hallways and adjacent finishes before any work starts', 'Remove the existing bathroom down to the substrate', 'Coordinate and supervise every trade, inspection and delivery'];
function previous() {
  const cards = [{ title: 'Bathroom', included: STOCK.slice(), customerSupplies: ['Vanity & sink'], notIncluded: ['Electrical panel work'] }, { title: 'Windows', included: ['Remove the existing windows and install the new units'], customerSupplies: [], notIncluded: [] }];
  const row = (c) => ({ name: c.title, subtotal: 1000, included: c.included.slice(), supplied: c.customerSupplies.slice(), excluded: c.notIncluded.slice(), includedOff: [], suppliedOff: [], excludedOff: [] });
  return { serviceBreakdown: cards, manualCustomerScopeDraft: { services: cards.map(row) }, publishedCustomerScope: { services: cards.map(row) }, customerScopePublished: true, showLaborCost: false, customerFinalTotal: null, quotePhotos: [{ url: 'q.jpg' }] };
}

console.log('\n1. A draft that only mirrors the AI\'s cards is the AI\'s wording\n');
{
  const prev = previous();
  ok('the Astoria draft (saved, never edited) mirrors the AI', C.scopeMirrorsAi(prev) === true);
  const r = C.forRegenerate(prev);
  ok('ON REGENERATE it is dropped: draft, published copy and the published flag', r.reset === true && r.kept === false && r.previous.manualCustomerScopeDraft === undefined && r.previous.publishedCustomerScope === undefined && r.previous.customerScopePublished === undefined);
  ok('...every other contractor setting is still carried (photos, view mode)', r.previous.quotePhotos.length === 1 && r.previous.showLaborCost === false);
  ok('...and the stored record is not touched (a copy is returned)', prev.manualCustomerScopeDraft !== undefined);
  const next = { serviceBreakdown: [{ title: 'Bathroom', included: ['We gut the bathroom to the studs.'] }] };
  C.preserveContractorFields(r.previous, next);
  ok('the new estimate keeps its NEW card wording, and the photos', next.manualCustomerScopeDraft === undefined && next.quotePhotos.length === 1 && next.serviceBreakdown[0].included[0] === 'We gut the bathroom to the studs.');
}

console.log('\n2. A draft the contractor edited is kept\n');
{
  const a = previous(); a.manualCustomerScopeDraft.services[0].included[1] = 'We take the bathroom down to the studs, keep the tub.';
  ok('a line changed -> kept', C.forRegenerate(a).kept === true && C.forRegenerate(a).previous.manualCustomerScopeDraft === a.manualCustomerScopeDraft);
  const b = previous(); b.manualCustomerScopeDraft.services[0].included.push('Extra line added');
  ok('a line added -> kept', C.forRegenerate(b).kept === true);
  const c = previous(); c.manualCustomerScopeDraft.services[1].pinned = true;
  ok('a price typed on a card (pinned) -> kept', C.forRegenerate(c).kept === true);
  const d = previous(); d.manualCustomerScopeDraft.services[0].name = 'Primary Bath';
  ok('a renamed service -> kept', C.forRegenerate(d).kept === true);
  const e = previous(); e.publishedCustomerScope.services[0].excluded = ['Something else'];
  ok('a published copy that differs -> kept', C.forRegenerate(e).kept === true);
  ok('no draft at all -> nothing to do', C.forRegenerate({ serviceBreakdown: [] }).reset === false && C.forRegenerate({ serviceBreakdown: [] }).kept === false && C.forRegenerate(null).reset === false);
}

console.log('\n3. The generator, the browser, Save and Send\n');
{
  ok('THE GENERATOR carries forRegenerate\'s copy and marks the estimate reset / kept', /const carry = forRegenerate\(previousEstimate\);\s*if \(carry\.reset\) estimate\.scopeDraftReset = true;\s*if \(carry\.kept\) estimate\.scopeDraftKept = true;[\s\S]{0,200}preserveContractorFields\(carry\.previous, estimate\);/.test(GEN));
  ok('THE BROWSER does not put a reset draft back after a regenerate', /if \(data\.estimate && data\.estimate\.scopeDraftReset === true\) \{\s*\["manualCustomerScopeDraft", "publishedCustomerScope", "customerScopePublished"\]\.forEach\(function \(k\) \{ delete keepFields\[k\]; \}\);/.test(DASH));
  ok('SAVE AND SEND carry the whole-project list and the wording report (they used to strip them)', /"projectIncluded", "projectExclusions", "customerTimeline", "scopeWriter", "generatedWith", "generationTiming",/.test(DASH));
  ok('THE PANEL says when edited wording was kept, and Rebuild draft from AI clears the note', /Your edited wording was kept when the estimate was regenerated\. For the new AI wording, press <b>Rebuild draft from AI<\/b> below\./.test(DASH) && /manualCustomerScopeDraft = buildScopeDraftFromAI\(true\);[\s\S]{0,500}currentRecord\.estimate\.scopeDraftKept = false;/.test(DASH));
}
console.log('\n4. Rebuild draft from AI reads the AI, not the customer\'s current page\n');
{
  const vm = require('vm');
  const ext = (name) => { const st = DASH.search(new RegExp('function ' + name + '\\s*\\(')); let d = 0; for (let j = DASH.indexOf('{', st); j < DASH.length; j++) { if (DASH[j] === '{') d++; else if (DASH[j] === '}') { d--; if (!d) return DASH.slice(st, j + 1); } } };
  const ctx = { scopeUniqueServices: () => [], scopeDropEmptyServices: (x) => x, scopeSectionOf: () => 'General', JSON, Object, Array, String };
  vm.createContext(ctx);
  vm.runInContext(ext('buildScopeDraftFromAI'), ctx);
  ctx.currentRecord = { estimate: {
    customerScopePublished: true,
    publishedCustomerScope: { services: [{ name: 'Bathroom', included: ['Remove the existing bathroom down to the substrate'], supplied: [], excluded: [] }] },
    serviceBreakdown: [{ title: 'Bathroom', included: ['We take the bathroom down to the studs and haul it out.'], customerSupplies: ['Vanity'], notIncluded: [] }] } };
  const rebuilt = vm.runInContext('buildScopeDraftFromAI(true)', ctx);
  ok('THE ASTORIA BUG: Rebuild draft from AI gives the AI\'s card wording, not the published stock lines', rebuilt.services[0].included[0] === 'We take the bathroom down to the studs and haul it out.' && rebuilt.services[0].supplied[0] === 'Vanity', JSON.stringify(rebuilt));
  const opened = vm.runInContext('buildScopeDraftFromAI()', ctx);
  ok('...opening the panel with no draft still starts from what the customer sees', opened.services[0].included[0] === 'Remove the existing bathroom down to the substrate');
  ok('the Rebuild button asks for the AI version', /function scopeRebuildFromAI\(\)[\s\S]{0,1200}manualCustomerScopeDraft = buildScopeDraftFromAI\(true\);/.test(DASH));
}
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
