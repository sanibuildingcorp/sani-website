/* offer-options.test.js — run: node js/offer-options.test.js
 *
 *   "I need to completely remove alternative offers, i never use them and
 *    remove from everywhere"
 *
 * This file used to prove the Alternatives checkbox. Alternatives are gone:
 * the estimator is told never to write one and drops any it writes; the
 * pricing pass puts none on a card and prints no "alternative (not included
 * in current total)" note; the dashboard has no Alternatives panel; the
 * customer's page and the scope PDF are never offered one, on any record,
 * old or new; the assistant is not shown any. The one thing kept is an
 * option a customer ALREADY ADDED to their bill on an old quote - its price
 * is in the total they approved.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const QUOTE = fs.readFileSync(path.join(ROOT, 'quote.html'), 'utf8');
const BG = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'), 'utf8');
const GEN = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate.js'), 'utf8');
const PDF = fs.readFileSync(path.join(ROOT, 'netlify/functions/lib/scope-pdf.js'), 'utf8');
const ASSIST = fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const clone = (o) => JSON.parse(JSON.stringify(o));

const STORE = new Map();
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return '@netlify/blobs'; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: () => ({ get: async (k) => (STORE.has(k) ? JSON.parse(STORE.get(k)) : null) }) } };
const OO = require(path.join(ROOT, 'netlify/functions/lib/offered-options.js'));
const DP = require(path.join(ROOT, 'netlify/functions/lib/deterministic-pricing.js'));
const get = require(path.join(ROOT, 'netlify/functions/get-estimate.js'));

const A = 'Option A — Crown molding premium', B = 'Option B — Prime and paint all new molding';
function est(over) {
  return Object.assign({
    projectTitle: 'Molding', markupPct: 25,
    labor: [{ item: 'Install molding', qty: 220, unit: 'ft', rate: 6.5, section: 'Carpentry' }], materials: [],
    serviceBreakdown: [{ title: 'Carpentry', subtotal: 1787.5, included: ['x'], notIncluded: ['Ceiling repairs', A + ' — $1350.00 alternative (not included in current total)'], options: [{ label: A, price: 1350 }, { label: B, price: 1350 }] }],
    options: [{ label: A, price: 1350 }],
    optionSelections: { Windows: { alternatives: [{ label: B, price: 1350 }] } },
    publishedCustomerScope: { services: [{ name: 'Carpentry', subtotal: 1787.5, included: ['x'], excluded: ['Ceiling repairs', A + ' — $1350.00 alternative (not included in current total)'], options: [{ label: A, price: 1350 }] }] },
  }, over || {});
}
const labels = (e) => {
  const out = [];
  (e.options || []).forEach((o) => out.push('top:' + o.label));
  (e.serviceBreakdown || []).forEach((s) => (s.options || []).forEach((o) => out.push('svc:' + o.label)));
  Object.keys(e.optionSelections || {}).forEach((k) => (e.optionSelections[k].alternatives || []).forEach((o) => out.push('sel:' + o.label)));
  ((e.publishedCustomerScope || {}).services || []).forEach((s) => (s.options || []).forEach((o) => out.push('pub:' + o.label)));
  return out;
};

(async () => {
  console.log('\n1. The server strip: nothing is offered, on any record\n');
  {
    ok('UNDECIDED -> none', labels(OO.stripUnoffered(est())).length === 0);
    ok('A CHECKBOX FROM BEFORE (offeredOptions) NO LONGER OFFERS ANYTHING', labels(OO.stripUnoffered(est({ offeredOptions: [OO.norm(A)] }))).length === 0);
    ok('A RECORD SENT BEFORE THE CHECKBOX EXISTED (legacyAllowsAll) OFFERS NOTHING EITHER', labels(OO.stripUnoffered(est(), { legacyAllowsAll: true })).length === 0);
    const kept = OO.stripUnoffered(est(), { keep: [B] });
    ok('what a customer already added to their bill stays (its price is in the total they approved)', labels(kept).join('|') === ['svc:' + B, 'sel:' + B].join('|'), labels(kept).join(', '));
    const s = OO.stripUnoffered(est());
    ok('THE "alternative (not included in current total)" NOTES ARE DROPPED from the cards and the published scope; other exclusions stay', s.serviceBreakdown[0].notIncluded.join('|') === 'Ceiling repairs' && s.publishedCustomerScope.services[0].excluded.join('|') === 'Ceiling repairs', JSON.stringify(s.serviceBreakdown[0].notIncluded));
  }

  console.log('\n2. The customer\'s page and the scope link, through get-estimate\n');
  {
    const base = { customer: { name: 'Jan', email: 'jan@example.com' }, request: { service: 'Carpentry' }, thread: [] };
    STORE.set('SBC-OLD', JSON.stringify(Object.assign({ ref: 'SBC-OLD', status: 'sent', sentAt: '2026-06-01T10:00:00Z', estimate: est() }, base)));
    const r = await get.handler({ httpMethod: 'GET', headers: { referer: 'https://www.sanibuildingcorp.com/quote.html?ref=SBC-OLD' }, queryStringParameters: { ref: 'SBC-OLD' } });
    const v = JSON.parse(r.body);
    ok('AN OLD SENT RECORD FULL OF OPTIONS: the customer\'s page gets none, and no alternative note', labels(v.estimate).length === 0 && !JSON.stringify(v).includes('alternative (not included'), labels(v.estimate).join(', '));
    const s = await get.handler({ httpMethod: 'GET', headers: { referer: 'https://www.sanibuildingcorp.com/quote.html?ref=SBC-OLD&sow=1' }, queryStringParameters: { ref: 'SBC-OLD', sow: '1' } });
    const sv = JSON.parse(s.body);
    ok('...the scope-only link neither', labels(sv.estimate).length === 0 && !JSON.stringify(sv).includes('alternative (not included'));
    STORE.set('SBC-CHOSE', JSON.stringify(Object.assign({ ref: 'SBC-CHOSE', status: 'accepted', sentAt: '2026-06-01T10:00:00Z', estimate: est(), customerOptionSelections: [{ label: B, price: 1350 }] }, base)));
    const c = JSON.parse((await get.handler({ httpMethod: 'GET', headers: { referer: 'https://www.sanibuildingcorp.com/quote.html?ref=SBC-CHOSE' }, queryStringParameters: { ref: 'SBC-CHOSE' } })).body);
    ok('a customer who already added one keeps seeing it', labels(c.estimate).join('|') === ['svc:' + B, 'sel:' + B].join('|'));
    ok('the PDF prints no "Optional alternatives" block and maps no options onto a card', !/doc\.text\("Optional alternatives/.test(PDF) && /options: \[\],/.test(PDF));
    ok('quote.html drops the old alternative notes from "Not included" on the dashboard\'s live preview too', /const ALT_NOTE_RE=\/\\balternative \\\(not included in current total\\\)\\s\*\$\/i;/.test(QUOTE) && /!ALT_NOTE_RE\.test\(t\)/.test(QUOTE));
  }

  console.log('\n3. The estimator never writes one; the pricing pass never keeps one\n');
  {
    [BG, GEN].forEach((src, i) => {
      const name = i ? 'generate-estimate.js' : 'generate-estimate-background.js';
      ok(name + ': the analyst is told NEVER to create options', /16\. NEVER create options or alternatives/.test(src) && !/preserve EACH option separately/.test(src));
      ok(name + ': the estimator is told the same, and the schema shows options as empty', /NEVER produce options or alternatives/.test(src) && !/Option A — Replace all windows/.test(src) && /Never add options or alternatives; options stays an empty array\./.test(src));
      ok(name + ': whatever the model writes as options is dropped', /options: \[\],/.test(src) && !/raw\.options/.test(src));
    });
    const out = DP.consolidateCustomerPresentation({ projectTitle: 'x', markupPct: 25, labor: [{ item: 'Install crown molding', qty: 10, unit: 'hrs', rate: 60, section: 'Carpentry' }], materials: [], customerSupplied: [], exclusions: [], options: [{ label: A, price: 1350, section: 'Carpentry' }] }, { selected_trades: ['Carpentry'], confirmed_scope: [] }, { request: { service: 'Carpentry', selectedServices: ['Carpentry'], description: 'crown molding' } });
    ok('THE PRICING PASS: an option the model wrote anyway ends on no card, with no note, and options comes out empty', Array.isArray(out.serviceBreakdown) && out.serviceBreakdown.every((c) => !c.options.length && !c.notIncluded.some((t) => /alternative \(not included/.test(t))) && out.options.length === 0, JSON.stringify(out.serviceBreakdown));
  }

  console.log('\n4. The dashboard and the assistant\n');
  {
    ok('THE ALTERNATIVES PANEL IS GONE from Scope Control, with its checkbox and its handlers', !/<b>Alternatives<\/b>/.test(DASH) && !/scopeOfferOption|scopeRemoveOption|scopeAllAlternatives|scopeOptionOffered/.test(DASH) && !/Check the ones the customer may see as priced add-ons/.test(DASH));
    ok('the assistant is shown no "priced options" and no "ALTERNATIVES OFFERED"', !/priced options: /.test(ASSIST) && !/ALTERNATIVES OFFERED/.test(ASSIST));
    const blocks = DASH.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    let broken = null;
    blocks.forEach(function (bl, i) { try { new vm.Script(bl.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; } });
    ok('all ' + blocks.length + ' dashboard script blocks parse', broken === null, broken || '');
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
