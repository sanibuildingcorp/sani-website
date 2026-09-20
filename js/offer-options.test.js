/* offer-options.test.js — run: node js/offer-options.test.js
 *
 *   "In this optional i need add check box for including or not including
 *    for send to the customer, always keeps uncheck and if i decide then i
 *    will check by my self"
 *
 * Every priced alternative went straight onto the customer's quote. Now each
 * one has a checkbox in the dashboard, unchecked by default, and the customer
 * sees only the ones he checked. The decision travels with the estimate, is
 * frozen into the sent version, and gates what the customer can buy.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const QUOTE = fs.readFileSync(path.join(ROOT, 'quote.html'), 'utf8');
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

const STORE = new Map();
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return '@netlify/blobs'; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: () => ({ get: async (k) => (STORE.has(k) ? JSON.parse(STORE.get(k)) : null) }) } };
const OO = require(path.join(ROOT, 'netlify/functions/lib/offered-options.js'));
const SV = require(path.join(ROOT, 'netlify/functions/lib/sent-version.js'));
const QO = require(path.join(ROOT, 'netlify/functions/lib/quote-options.js'));
const get = require(path.join(ROOT, 'netlify/functions/get-estimate.js'));

const A = 'Option A — Crown molding premium', B = 'Option B — Prime and paint all new molding', D = 'Deduct — If only 3 closet units are reinstated';
function est(over) {
  return Object.assign({
    projectTitle: 'Molding', markupPct: 25,
    labor: [{ item: 'Install molding', qty: 220, unit: 'ft', rate: 6.5 }], materials: [],
    serviceBreakdown: [{ title: 'Carpentry', subtotal: 1430, included: ['x'], options: [{ label: A, price: 1350 }, { label: B, price: 1350 }] }],
    options: [{ label: A, price: 1350 }, { label: D, price: -520 }],
    optionSelections: { Windows: { alternatives: [{ label: B, price: 1350 }] } },
    publishedCustomerScope: { services: [{ name: 'Carpentry', included: ['x'], options: [{ label: A, price: 1350 }] }] },
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

console.log('\nthe rule: nothing is offered until he checks it\n');
{
  const none = OO.stripUnoffered(est());
  ok('UNDECIDED (no offeredOptions) SHOWS NONE', labels(none).length === 0 && Array.isArray(none.offeredOptions) && none.offeredOptions.length === 0, labels(none).join(', '));
  const some = OO.stripUnoffered(est({ offeredOptions: ['option a — crown molding premium'] }));
  ok('CHECKED ONES SHOW, everywhere quote.html reads them, unchecked ones are gone', labels(some).join('|') === ['top:' + A, 'svc:' + A, 'pub:' + A].join('|'), labels(some).join(', '));
  const empty = OO.stripUnoffered(est({ offeredOptions: [] }));
  ok('decided: none -> none', labels(empty).length === 0);
  const legacy = OO.stripUnoffered(est(), { legacyAllowsAll: true });
  ok('A VERSION FROZEN BEFORE THE CHECKBOX EXISTED KEEPS ALL OF THEM, and says so', labels(legacy).length === 6 && legacy.offeredOptions.length === 3, JSON.stringify(legacy.offeredOptions));
  const kept = OO.stripUnoffered(est({ offeredOptions: [] }), { keep: [B] });
  ok('what the customer already bought stays whatever the checkbox says', labels(kept).join('|') === ['svc:' + B, 'sel:' + B].join('|'), labels(kept).join(', '));
  ok('case and spacing do not matter', OO.isOffered({ offeredOptions: ['  OPTION A —  crown molding premium '] }, A) === true);
  const e2 = OO.setOffered(OO.setOffered(est(), A, true), B, true);
  ok('check, check, uncheck', OO.setOffered(e2, A, false).offeredOptions.join('|') === OO.norm(B));
}

console.log('\nthe customer\'s page gets only what he checked\n');
{
  const base = { customer: { name: 'Jan', email: 'jan@example.com' }, request: { service: 'Carpentry' }, thread: [] };
  const DECIDED = Object.assign(clone(base), { ref: 'SBC-DEC', status: 'sent', sentAt: '2026-09-18T00:00:00Z', estimate: est({ offeredOptions: [] }),
    sentVersion: { snapshotVersion: 1, n: 1, at: '2026-09-18T00:00:00Z', estimate: est({ offeredOptions: [OO.norm(A)] }), customerFinalTotal: null } });
  const LEGACY = Object.assign(clone(base), { ref: 'SBC-LEG', status: 'sent', sentAt: '2026-06-01T00:00:00Z', estimate: est(),
    sentVersion: { snapshotVersion: 1, n: 1, at: '2026-06-01T00:00:00Z', estimate: est(), customerFinalTotal: null } });
  const OLDER = Object.assign(clone(base), { ref: 'SBC-OLDER', status: 'accepted', sentAt: '2026-05-01T00:00:00Z', estimate: est() });
  const DRAFT = Object.assign(clone(base), { ref: 'SBC-DRAFT', status: 'drafted', estimate: est() });
  const BOUGHT = Object.assign(clone(base), { ref: 'SBC-BOUGHT', status: 'accepted', sentAt: '2026-09-18T00:00:00Z', estimate: est({ offeredOptions: [] }),
    customerOptionSelections: [{ id: QO.optionId(B), label: B, price: 1350 }],
    sentVersion: { snapshotVersion: 1, n: 1, at: '2026-09-18T00:00:00Z', estimate: est({ offeredOptions: [] }), customerFinalTotal: null } });
  [DECIDED, LEGACY, OLDER, DRAFT, BOUGHT].forEach((r) => STORE.set(r.ref, JSON.stringify(r)));
  const asCustomer = async (ref, q) => JSON.parse((await get.handler({ httpMethod: 'GET', headers: { referer: 'https://www.sanibuildingcorp.com/quote.html?ref=' + ref + (q || '') }, queryStringParameters: { ref } })).body);
  const asDashboard = async (ref) => JSON.parse((await get.handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { ref } })).body);
  (async () => {
    const v = await asCustomer('SBC-DEC');
    ok('A SENT ESTIMATE SHOWS ONLY THE CHECKED ALTERNATIVE - from the sent version, not the live draft', labels(v.estimate).join('|') === ['top:' + A, 'svc:' + A, 'pub:' + A].join('|') && JSON.stringify(v).indexOf(B) === -1 && JSON.stringify(v).indexOf(D) === -1, labels(v.estimate).join(', '));
    const l = await asCustomer('SBC-LEG');
    ok('a version frozen before the checkbox existed still shows all of them', labels(l.estimate).length === 6 && l.estimate.offeredOptions.length === 3);
    const o = await asCustomer('SBC-OLDER');
    ok('...and so does an older record with no frozen version at all', labels(o.estimate).length === 6);
    const p = await asCustomer('SBC-DRAFT', '&previewScope=1');
    ok('HIS OWN DRAFT PREVIEW OF AN UNDECIDED ESTIMATE SHOWS NONE (the box starts unchecked)', labels(p.estimate).length === 0 && p.estimate.labor.length === 1, labels(p.estimate).join(', '));
    const b = await asCustomer('SBC-BOUGHT');
    ok('an option the customer already added stays on their page even if unchecked', labels(b.estimate).join('|') === ['svc:' + B, 'sel:' + B].join('|'), labels(b.estimate).join(', '));
    const d = await asDashboard('SBC-DEC');
    ok('THE DASHBOARD STILL GETS EVERY ALTERNATIVE, checked or not', labels(d.estimate).length === 6);

    console.log('\nsending freezes the decision\n');
    const v1 = SV.buildSentVersion({ estimate: est() }, 1);
    ok('A SEND WITH NO DECISION FREEZES "NONE", never "all"', Array.isArray(v1.estimate.offeredOptions) && v1.estimate.offeredOptions.length === 0);
    const v2 = SV.buildSentVersion({ estimate: est({ offeredOptions: [OO.norm(A)] }) }, 2);
    ok('a send with a decision freezes it', v2.estimate.offeredOptions.join('|') === OO.norm(A));
    ok('an old version with no key does not read as "unsent changes" forever', SV.hasUnsentChanges({ estimate: est(), sentVersion: { estimate: est() } }) === false);
    ok('...but checking a box after sending does', SV.hasUnsentChanges({ estimate: est({ offeredOptions: [OO.norm(A)] }), sentVersion: { estimate: est() } }) === true);

    console.log('\nthe customer can only buy what he checked\n');
    const idA = QO.optionId(A), idB = QO.optionId(B);
    const r1 = QO.resolveSelection(est({ offeredOptions: [OO.norm(A)] }), [idA, idB]);
    ok('AN UNCHECKED OPTION DOES NOT RESOLVE, so it cannot raise the bill', r1.selected.length === 1 && r1.selected[0].label === A && r1.unknown.length === 1 && r1.total === 1350, JSON.stringify({ sel: r1.selected.map((o) => o.label), unknown: r1.unknown }));
    const r2 = QO.resolveSelection(est(), [idA, idB]);
    ok('an estimate from before the checkbox resolves as it always did', r2.selected.length === 2 && r2.unknown.length === 0);
    const QR = fs.readFileSync(path.join(ROOT, 'netlify/functions/quote-response.js'), 'utf8');
    ok('quote-response resolves the selection against the version the customer was SENT', /resolveSelection\(sent \|\| record\.estimate \|\| \{\}, ids\)/.test(QR) && /record\.sentVersion\.estimate/.test(QR));
    const GE = fs.readFileSync(path.join(ROOT, 'netlify/functions/get-estimate.js'), 'utf8');
    ok('get-estimate strips after the sent version is applied and before the unsent hide', GE.indexOf('applySentVersion(data, view)') < GE.indexOf('stripUnoffered(view.estimate') && GE.indexOf('stripUnoffered(view.estimate') < GE.indexOf('hideUnsentEstimate(view)'));

    console.log('\nthe dashboard: one checkbox per alternative, unchecked until he checks it\n');
    {
      const rsc = ext(DASH, 'renderScopeControl');
      ok('EACH ALTERNATIVE HAS A CHECKBOX that saves on change', /<input type="checkbox" class="sc-offer" onchange="scopeOfferOption\(' \+ oi \+ ', this\.checked\)"' \+ \(on \? ' checked' : ''\)/.test(rsc));
      ok('...labelled Shown / Hidden, and the panel says unchecked stay hidden', /\(on \? 'Shown' : 'Hidden'\)/.test(rsc) && /Unchecked stay hidden/.test(rsc));
      const saves = [], toasts = [];
      const ctx = { String, Array, JSON, console, currentRecord: { ref: 'SBC-1', estimate: est() }, saveDraft: async () => { saves.push(clone(ctx.currentRecord.estimate.offeredOptions)); }, renderScopeControl: () => {}, toast: (t) => toasts.push(t), Number, Object };
      vm.createContext(ctx);
      vm.runInContext(ext(DASH, 'scopeOptionKey') + '\n' + ext(DASH, 'scopeOptionOffered') + '\n' + ext(DASH, 'scopeOfferOption') + '\n' + ext(DASH, 'scopeAllAlternatives'), ctx);
      ok('UNCHECKED BY DEFAULT: an estimate with no decision offers nothing', vm.runInContext('scopeOptionOffered(' + JSON.stringify(A) + ')', ctx) === false && vm.runInContext('scopeOptionOffered(' + JSON.stringify(B) + ')', ctx) === false);
      await vm.runInContext('scopeOfferOption(0, true)', ctx);
      ok('CHECKING ONE STORES IT AND SAVES STRAIGHT AWAY', saves.length === 1 && saves[0].length === 1 && saves[0][0] === OO.norm(A) && vm.runInContext('scopeOptionOffered(' + JSON.stringify(A) + ')', ctx) === true, JSON.stringify(saves));
      ok('...and says it will be shown on the next send', /will be shown to the customer on the next send/.test(toasts[0]), toasts[0]);
      await vm.runInContext('scopeOfferOption(1, true)', ctx);
      await vm.runInContext('scopeOfferOption(0, false)', ctx);
      ok('unchecking removes only that one', saves.length === 3 && saves[2].length === 1 && saves[2][0] === OO.norm(D) && /stays hidden/.test(toasts[2]), JSON.stringify(saves[2]));
      ok('deleting an alternative drops it from the decision too', /if \(Array\.isArray\(est\.offeredOptions\)\) est\.offeredOptions = est\.offeredOptions\.filter/.test(ext(DASH, 'scopeRemoveOption')));
      const COF = require(path.join(ROOT, 'netlify/functions/lib/contractor-owned-fields.js'));
      ok('the decision survives Save Draft and a regeneration (contractor-owned, both lists)', COF.CONTRACTOR_OWNED_ESTIMATE_FIELDS.indexOf('offeredOptions') !== -1 && /"lastMerge", "mergeHistory",\s*\/\/[^\n]*\n\s*"offeredOptions"/.test(DASH));
    }

    console.log('\nquote.html applies the same rule to the pre-send preview\n');
    {
      const chosen = {};
      const qctx = { A: (v) => (Array.isArray(v) ? v : []), optNorm: OO.norm, isChosen: (l) => !!chosen[OO.norm(l)], Set, Array };
      vm.createContext(qctx);
      vm.runInContext(ext(QUOTE, 'offeredOnly'), qctx);
      qctx.e = { offeredOptions: [OO.norm(A)] }; qctx.list = [{ label: A }, { label: B }];
      ok('only checked alternatives are rendered', vm.runInContext('offeredOnly(e, list).map(o => o.label).join("|")', qctx) === A);
      qctx.e = {};
      ok('THE LIVE DRAFT IN THE PRE-SEND PREVIEW (no decision) RENDERS NONE', vm.runInContext('offeredOnly(e, list).length', qctx) === 0);
      chosen[OO.norm(B)] = 1;
      ok('what the customer already added stays', vm.runInContext('offeredOnly(e, list).map(o => o.label).join("|")', qctx) === B);
      ok('build() runs every service card through it before rendering', /active\.forEach\(s=>\{s\.options=offeredOnly\(e,s\.options\)\}\);return finalizeServices\(e,active\)/.test(QUOTE));
    }

    [['dashboard.html', DASH], ['quote.html', QUOTE]].forEach(([name, src]) => {
      const blocks = src.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
      let broken = null;
      blocks.forEach(function (bl, i) { try { new vm.Script(bl.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; } });
      ok(name + ': all ' + blocks.length + ' script blocks parse', broken === null, broken || '');
    });
    console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
    process.exit(fail ? 1 : 0);
  })().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
}
