/* scope-only-link.test.js — run: node js/scope-only-link.test.js
 *
 *   "scope of work link i need it to send to customers without showing any
 *    price because, sometimes the building management need to see scope of
 *    work before they approve permission ... just scope of work absolutely
 *    same everything just without prices"
 *
 * The dashboard has copied quote.html?ref=…&sow=1 for a long time. The page
 * ignored the flag and showed the full priced quote. Now the server sends that
 * page a record with every price and every private matter removed, and the
 * page itself never prints a dollar sign, a contract, a conversation or an
 * approve button - and never counts the visit as the customer opening the quote.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const QUOTE = fs.readFileSync(path.join(ROOT, 'quote.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const clone = (o) => JSON.parse(JSON.stringify(o));

const STORE = new Map();
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return '@netlify/blobs'; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: () => ({ get: async (k) => (STORE.has(k) ? JSON.parse(STORE.get(k)) : null) }) } };
const SO = require(path.join(ROOT, 'netlify/functions/lib/scope-only.js'));
const get = require(path.join(ROOT, 'netlify/functions/get-estimate.js'));

const EST = {
  projectTitle: 'Apartment Renovation — 3855 Shore Pkwy, 1K', summary: 'Crown molding in three rooms', markupPct: 25, notes: 'INTERNAL: he haggles',
  showLaborCost: true, showMaterialsCost: false, showLaborLines: true, showLaborLinePrices: true, showSectionSubtotals: true,
  labor: [{ item: 'Install crown molding @ $6.50/ft', qty: 220, unit: 'ft', rate: 6.5, section: 'Carpentry' }, { item: 'Paint molding', qty: 1, unit: 'ls', rate: 900, section: 'Painting' }],
  materials: [{ item: 'Crown molding, primed MDF', qty: 220, unit: 'ft', rate: 2.1, section: 'Carpentry' }],
  serviceBreakdown: [
    { title: 'Carpentry', subtotal: 2400, included: ['Install crown molding in living room, bedroom and hall', 'Allowance $500 for corner blocks'], customerSupplies: [], notIncluded: ['Ceiling repairs'], options: [{ label: 'Option A — Crown molding premium profile', description: 'Larger 5.25" profile', price: 1350 }] },
    { title: 'Painting', subtotal: 1125, included: ['Prime and paint all new molding'], customerSupplies: ['Paint'], notIncluded: [], options: [] },
  ],
  options: [{ label: 'Option A — Crown molding premium profile', price: 1350 }],
  offeredOptions: ['option a — crown molding premium profile'],
  finishGroups: [{ name: 'Profile', options: [{ name: 'Standard', price: 0, isDefault: true }, { name: 'Premium', price: 1350, upgrade: 1350 }] }],
  savedMaterials: [{ name: 'MDF', totalEstimate: 462 }], materialsTotalEstimate: 462, customerPresentationVersion: 'v8.1-deterministic-four-service',
  timelineText: '5-7 business days', projectAnalysis: { rationale: 'secret' }, validation: { priceBand: [3000, 5000] },
};
const base = { customer: { name: 'Jan', email: 'jan@example.com', phone: '718', address: '3855 Shore Pkwy, 1K' }, request: { service: 'Carpentry', description: 'molding, budget $4,000', photos: [{ data: 'https://x/1.jpg' }] },
  thread: [{ id: 'm1', from: 'customer', text: 'Can you do it for $3,500?', at: '2026-09-19T00:00:00Z' }], contract: { sections: { scopeOfWork: ['x'] }, total: 4406 }, includeContractForCustomer: true,
  customerFinalTotal: 4406.25, customerOptionSelections: [{ label: 'Option A — Crown molding premium profile', price: 1350 }] };
const SENT = Object.assign(clone(base), { ref: 'SBC-SOW1', status: 'accepted', sentAt: '2026-09-18T00:00:00Z', acceptedAt: '2026-09-19T00:00:00Z', signature: 'Jan', estimate: Object.assign(clone(EST), { summary: 'LIVE DRAFT SUMMARY' }),
  sentVersion: { snapshotVersion: 1, n: 1, at: '2026-09-18T00:00:00Z', estimate: clone(EST), customerFinalTotal: 4406.25, includeContractForCustomer: true, contract: { sections: { scopeOfWork: ['x'] } } } });
const UNSENT = Object.assign(clone(base), { ref: 'SBC-SOW2', status: 'drafted', estimate: clone(EST) });
delete UNSENT.customerFinalTotal; delete UNSENT.customerOptionSelections;
[SENT, UNSENT].forEach((r) => STORE.set(r.ref, JSON.stringify(r)));
const REF_HDR = (ref, extra) => ({ referer: 'https://www.sanibuildingcorp.com/quote.html?ref=' + ref + (extra || '') });
const call = async (ref, headers, qs) => JSON.parse((await get.handler({ httpMethod: 'GET', headers: headers || {}, queryStringParameters: Object.assign({ ref }, qs || {}) })).body);

console.log('\nthe server sends the scope link nothing it could print as a price\n');
(async () => {
  const v = await call('SBC-SOW1', REF_HDR('SBC-SOW1', '&sow=1'), { sow: '1' });
  const money = SO.findMoney(v);
  ok('NO MONEY KEY AND NO DOLLAR AMOUNT ANYWHERE in the scope view', money.length === 0, money.slice(0, 8).join(' | '));
  const s = JSON.stringify(v);
  ok('...not the total, the markup, the rates, the option prices, the contract total, the band', s.indexOf('4406') === -1 && s.indexOf('6.5') === -1 && s.indexOf('1350') === -1 && s.indexOf('"markupPct"') === -1 && s.indexOf('5000') === -1);
  ok('THE SCOPE IS ALL THERE: both services, included, supplies, not included, alternative labels, timeline, summary, photos', v.estimate.serviceBreakdown.length === 2 && v.estimate.serviceBreakdown[0].included.length === 2 && v.estimate.serviceBreakdown[1].customerSupplies[0] === 'Paint' && v.estimate.serviceBreakdown[0].notIncluded[0] === 'Ceiling repairs' && v.estimate.serviceBreakdown[0].options[0].label === 'Option A — Crown molding premium profile' && v.estimate.timelineText === '5-7 business days' && v.request.photos.length === 1);
  ok('a dollar figure typed into wording is scrubbed, the words stay', v.estimate.serviceBreakdown[0].included[1] === 'Allowance for corner blocks' && v.request.description === 'molding, budget', v.estimate.serviceBreakdown[0].included[1] + ' / ' + v.request.description);
  ok('NOTHING PRIVATE: no conversation, no contract, no acceptance, no signature, no notes, no analysis', v.thread.length === 0 && s.indexOf('haggles') === -1 && s.indexOf('secret') === -1 && v.contract === undefined && v.includeContractForCustomer === false && v.acceptedAt === undefined && v.signature === undefined && v.customerOptionSelections === undefined && s.indexOf('3,500') === -1 && s.indexOf('$') === -1);
  ok('...and the page cannot read it as priced or approved', v.status === 'scope' && v.scopeOnly === true && v.customerFinalTotal === undefined);
  ok('A SENT ESTIMATE SHOWS THE SENT SCOPE, not the live draft', v.estimate.summary === 'Crown molding in three rooms' && s.indexOf('LIVE DRAFT') === -1);
  ok('labor lines keep what they are, lose what they cost, and lose the rate typed into the name', v.estimate.labor[0].qty === 220 && v.estimate.labor[0].unit === 'ft' && v.estimate.labor[0].rate === undefined && v.estimate.labor[0].item === 'Install crown molding @ /ft');
  const u = await call('SBC-SOW2', REF_HDR('SBC-SOW2', '&sow=1'));
  ok('A NEVER-SENT ESTIMATE STILL GIVES ITS SCOPE - management is asked before the customer approves anything', u.estimate.serviceBreakdown && u.estimate.serviceBreakdown.length === 2 && u.estimatePending === undefined && SO.findMoney(u).length === 0, JSON.stringify(u.estimate).slice(0, 120));
  const noRef = await call('SBC-SOW1', {}, { sow: '1' });
  ok('the flag on the fetch is enough on its own - a browser that drops the referer gets the scope, never the dashboard copy', noRef.scopeOnly === true && SO.findMoney(noRef).length === 0 && noRef.estimate.notes === undefined);
  const cust = await call('SBC-SOW1', REF_HDR('SBC-SOW1'));
  ok('the ordinary quote link is untouched: priced, with the contract and the thread', cust.customerFinalTotal === 4406.25 && cust.estimate.labor[0].rate === 6.5 && cust.thread.length === 1 && cust.includeContractForCustomer === true && cust.scopeOnly === undefined);
  const dash = await call('SBC-SOW1', {});
  ok('the dashboard still gets everything', dash.estimate.notes === 'INTERNAL: he haggles' && dash.estimate.markupPct === 25);
  const unsentCust = await call('SBC-SOW2', REF_HDR('SBC-SOW2'));
  ok('and a never-sent record on the ordinary quote link still shows nothing', unsentCust.estimatePending === true && !unsentCust.estimate.serviceBreakdown);

  console.log('\nthe page renders it: every card, no dollar sign, nothing to approve\n');
  /* The whole quote.html script, run against a small fake DOM, fed the record
     the server would send. What ends up in #app is what a building manager reads. */
  function renderPage(record, search) {
    const app = { innerHTML: '', textContent: '' };
    let title = 'Your Estimate | Sani Building Corp';
    const inserted = [];
    const el = () => ({ innerHTML: '', textContent: '', style: {}, setAttribute() {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelector: () => ({ src: '' }), scrollIntoView() {}, value: '', disabled: false, id: '' });
    const doc = {
      getElementById: (id) => (id === 'app' ? app : id === 'sowbar' ? null : null),
      createElement: () => { const e = el(); return e; },
      querySelector: () => null, querySelectorAll: () => [],
      body: { insertBefore: (b) => inserted.push(b.textContent), appendChild() {}, getAttribute: () => null, setAttribute() {} },
      get title() { return title; }, set title(v) { title = v; },
    };
    let tracked = 0;
    const win = {
      document: doc, location: { search: search, origin: 'https://www.sanibuildingcorp.com', hash: '', href: '' },
      URLSearchParams, Array, Object, Number, String, Math, JSON, Map, Set, RegExp, Date, Promise, Error, console, isFinite, encodeURIComponent, decodeURIComponent, setTimeout,
      sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      Image: function () { const o = {}; Object.defineProperty(o, 'src', { set() { tracked++; } }); return o; },
      fetch: async () => ({ ok: true, json: async () => clone(record) }),
      addEventListener() {}, parent: null,
    };
    win.window = win;
    vm.createContext(win);
    vm.runInContext(QUOTE.match(/<script>([\s\S]*)<\/script>/)[1], win);
    return new Promise((res) => setTimeout(() => res({ html: app.innerHTML, title, inserted, tracked, text: app.textContent }), 20));
  }
  const sowView = await call('SBC-SOW1', REF_HDR('SBC-SOW1', '&sow=1'), { sow: '1' });
  const p = await renderPage(sowView, '?ref=SBC-SOW1&sow=1');
  const h = p.html;
  ok('THE PAGE HAS NO DOLLAR SIGN ON IT', h.indexOf('$') === -1, (h.match(/.{30}\$.{30}/) || [''])[0]);
  ok('BOTH SERVICE CARDS ARE THERE, with their scope - nothing folded into one card', (h.match(/<section class="svc">/g) || []).length === 2 && /Install crown molding in living room/.test(h) && /Prime and paint all new molding/.test(h) && /Customer supplies/.test(h) && /Ceiling repairs/.test(h));
  ok('the alternative is listed as work, with no price and no Add button', /Option A — Crown molding premium profile/.test(h) && h.indexOf('Add to my estimate') === -1 && h.indexOf('opt-add') === -1);
  ok('the detailed line list shows what, not what it costs', /Install crown molding/.test(h) && h.indexOf('class="amt"') === -1);
  ok('it says what it is: Scope of Work in the bar and the hero, a "Document" cell, the title changed', /Scope of Work SBC-SOW1/.test(h) && /<small>Document<\/small>Scope of work/.test(h) && p.title === 'Scope of Work | Sani Building Corp' && p.inserted[0] === 'SCOPE OF WORK — no pricing is shown on this page.');
  ok('NOTHING TO APPROVE OR SEND: no approve button, no message box, no contract, no messages, no "Waiting on your answers", no "Price by service"', h.indexOf('Approve estimate') === -1 && h.indexOf('Send us a message') === -1 && h.indexOf('id="msg"') === -1 && h.indexOf('Contract') === -1 && h.indexOf('id="thread-card"') === -1 && h.indexOf('Waiting on your answers') === -1 && h.indexOf('Price by service') === -1 && h.indexOf('Your estimate') === -1);
  ok('...but it can be printed, and says who prepared it', /printQuote\(this\)/.test(h) && /No pricing is included/.test(h) && /fully insured/.test(h));
  ok('READING IT IS NOT "THE CUSTOMER OPENED THE QUOTE" - no tracking ping', p.tracked === 0);
  const cv = await call('SBC-SOW1', REF_HDR('SBC-SOW1'));
  const n = await renderPage(cv, '?ref=SBC-SOW1');
  ok('the same harness renders the ordinary quote WITH prices, so the checks above mean something', n.html.indexOf('$4,406.25') !== -1 && /Price by service/.test(n.html) && n.tracked === 1 && n.inserted.length === 0, (n.html.match(/\$[\d,]+\.\d\d/) || [''])[0]);

  console.log('\nthe dashboard button copies that link\n');
  ok('the SCOPE OF WORK LINK button copies quote.html?ref=…&sow=1', /quote\.html\?ref=" \+ encodeURIComponent\(currentRecord\.ref\) \+ "&sow=1"/.test(DASH) && /SCOPE OF WORK LINK \(NO PRICES\)/.test(DASH));

  const blocks = QUOTE.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
  let broken = null;
  blocks.forEach(function (bl, i) { try { new vm.Script(bl.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; } });
  ok('quote.html: all ' + blocks.length + ' script blocks parse', broken === null, broken || '');
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
