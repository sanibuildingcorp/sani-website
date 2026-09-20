/* reword.test.js — run: node js/reword.test.js
 *
 *   "Can you upgrade them in estimate without touching prices?"
 *
 * The assistant found contradictions inside an estimate (brushed-gold in
 * the line items, matte-black in the included text, two mirror sizes) and
 * could only add a fact that gets priced again. Now it has "reword": edits
 * to the WORDS of an estimate, applied on the server with every price,
 * quantity and total fingerprinted before and after, refused whole if any
 * of them moved, and shown to him as before / after first.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const clone = (o) => JSON.parse(JSON.stringify(o));
function ext(name) {
  const s = DASH.search(new RegExp('(?:async )?function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = DASH.indexOf('{', s); j < DASH.length; j++) { if (DASH[j] === '{') d++; else if (DASH[j] === '}') { d--; if (!d) return DASH.slice(s, j + 1); } }
  throw new Error('unbalanced ' + name);
}
const STORES = { estimates: new Map() };
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return '@netlify/blobs'; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (o) => { const m = STORES[o.name] || (STORES[o.name] = new Map()); return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); }, setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); } }; } } };
const https = require('https');
let reply = '';
const sse = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
https.request = function (opts, cb) {
  const res = { statusCode: 200, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  return { on() { return this; }, write() {}, destroy() {}, end() { setImmediate(() => { cb(res); res._data(Buffer.from(sse({ type: 'message_start' }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: reply } }) + sse({ type: 'message_stop' }))); if (res._end) res._end(); }); } };
};
process.env.DASHBOARD_KEY = 'k'; process.env.ANTHROPIC_API_KEY = 'sk';
const R = require(path.join(ROOT, 'netlify/functions/lib/reword.js'));
const fn = require(path.join(ROOT, 'netlify/functions/reword-estimate.js'));
const assistant = require(path.join(ROOT, 'netlify/functions/assistant.js'));

function record() {
  return {
    ref: 'SBC-260901-ARWQ', status: 'sent', sentAt: '2026-09-10T00:00:00Z', customerFinalTotal: 7500,
    customer: { name: 'Rafael Oralla' },
    estimate: {
      projectTitle: 'Voorhies Ave Apt 5L — Small Bathroom Remodel', summary: 'Bathroom work at 3080 Voorhies Ave with matte-black fixtures.', scopeOfWork: 'BATHROOM: PVC wall panels, matte-black fixtures.', timelineText: 'Approximately 2-4 working days', markupPct: 25,
      labor: [{ section: 'Bathroom', item: 'Vanity light — 24-in.; 4-light gold fixture', qty: 1, unit: 'ea', rate: 120, total: 120 }, { section: 'Bathroom', item: 'Mirror install — 32"x36" brushed-gold', qty: 1, unit: 'ea', rate: 80 }],
      materials: [{ section: 'Bathroom', item: 'Marble-look waterproof PVC wall panel, 4 ft', qty: 7, unit: 'sheet', rate: 60.5 }],
      serviceBreakdown: [{ title: 'Bathroom', subtotal: 7500, included: ['Install matte-black faucet, tub trim, light fixtures, mirror, towel bar', 'Vanity light: matte-black 3-light fixture', 'Mirror 24"x30" matte-black'], customerSupplies: ['Vanity'], notIncluded: ['Painting'], options: [{ label: 'Option A — Heated floor', price: 1400 }] }],
      options: [{ label: 'Option A — Heated floor', price: 1400 }],
      customerScopePublished: true,
      publishedCustomerScope: { services: [{ name: 'Bathroom', subtotal: 7500, included: ['Install matte-black faucet, tub trim, light fixtures, mirror, towel bar', 'Vanity light: matte-black 3-light fixture'], supplied: ['Vanity'], excluded: ['Painting'] }] },
      manualCustomerScopeDraft: { services: [{ name: 'Bathroom', included: ['Install matte-black faucet, tub trim, light fixtures, mirror, towel bar'], supplied: [], excluded: [] }] },
    },
  };
}

(async () => {
  console.log('\nthe rule: words change, money never does\n');
  {
    const rec = record();
    const before = R.moneyFingerprint(rec);
    const out = R.applyEdits(rec, [
      { where: 'included', service: 'Bathroom', from: 'Install matte-black faucet, tub trim, light fixtures, mirror, towel bar', to: 'Install brushed-gold faucet, tub trim, light fixtures, mirror, towel bar' },
      { where: 'included', service: 'bathroom', from: 'Vanity light: matte-black 3-light fixture', to: 'Vanity light: brushed-gold 4-light fixture, 24 in.' },
      { where: 'included', service: 'Bathroom', from: 'Mirror 24"x30" matte-black', to: 'Mirror 32"x36" brushed-gold' },
      { where: 'labor', from: 'Vanity light — 24-in.; 4-light gold fixture', to: 'Vanity light — 24-in.; 4-light brushed-gold fixture' },
      { where: 'summary', from: 'matte-black', to: 'brushed-gold' },
      { where: 'scope', from: 'matte-black fixtures', to: 'brushed-gold fixtures' },
    ]);
    const e = rec.estimate;
    ok('A CARD LINE IS REWORDED IN THE BREAKDOWN, THE PUBLISHED SCOPE AND THE DRAFT - all three copies', e.serviceBreakdown[0].included[0] === 'Install brushed-gold faucet, tub trim, light fixtures, mirror, towel bar' && e.publishedCustomerScope.services[0].included[0] === e.serviceBreakdown[0].included[0] && e.manualCustomerScopeDraft.services[0].included[0] === e.serviceBreakdown[0].included[0] && out.applied[0].changed === 3, JSON.stringify(out.applied[0]));
    ok('...the service name matches in any case; a line only in the breakdown changes there', e.serviceBreakdown[0].included[1] === 'Vanity light: brushed-gold 4-light fixture, 24 in.' && e.serviceBreakdown[0].included[2] === 'Mirror 32"x36" brushed-gold');
    ok('A PRICE LINE IS RENAMED, its qty, unit, rate and total untouched', e.labor[0].item === 'Vanity light — 24-in.; 4-light brushed-gold fixture' && e.labor[0].qty === 1 && e.labor[0].rate === 120 && e.labor[0].total === 120 && e.labor[0].unit === 'ea');
    ok('a phrase in the summary and the scope is replaced', e.summary === 'Bathroom work at 3080 Voorhies Ave with brushed-gold fixtures.' && /brushed-gold fixtures\./.test(e.scopeOfWork));
    ok('THE MONEY FINGERPRINT IS IDENTICAL AFTER SIX EDITS', R.moneyFingerprint(rec) === before && rec.customerFinalTotal === 7500 && e.serviceBreakdown[0].subtotal === 7500 && e.options[0].price === 1400);
    ok('six applied, none skipped', out.applied.length === 6 && out.skipped.length === 0);

    const r2 = record();
    const o2 = R.applyEdits(r2, [{ where: 'excluded', service: 'Bathroom', from: '', to: 'Shower glass door' }, { where: 'supplies', service: 'Bathroom', from: 'Vanity', to: '' }, { where: 'title', from: '', to: 'Voorhies Ave Apt 5L — Bathroom Remodel' }, { where: 'included', service: 'Kitchen', from: 'x', to: 'y' }, { where: 'labor', from: 'Nothing like this', to: 'z' }]);
    ok('an empty from ADDS a card line; an empty to REMOVES one; an empty from on a field replaces it whole', r2.estimate.serviceBreakdown[0].notIncluded.indexOf('Shower glass door') !== -1 && r2.estimate.publishedCustomerScope.services[0].excluded.indexOf('Shower glass door') !== -1 && r2.estimate.serviceBreakdown[0].customerSupplies.length === 0 && r2.estimate.projectTitle === 'Voorhies Ave Apt 5L — Bathroom Remodel', JSON.stringify(r2.estimate.serviceBreakdown[0]));
    ok('what is not found is reported, not invented', o2.skipped.length === 2 && o2.skipped.every((s) => s.reason === 'not found'));
    ok('an unknown where is skipped with a reason', R.applyEdits(record(), [{ where: 'price', from: '120', to: '1' }]).skipped[0].reason === 'unknown where');
    ok('THE FINGERPRINT MOVES ON ANY NUMBER: a rate, a quantity, a subtotal, the stamped total, an option price', [(r) => { r.estimate.labor[0].rate = 121; }, (r) => { r.estimate.materials[0].qty = 8; }, (r) => { r.estimate.serviceBreakdown[0].subtotal = 7501; }, (r) => { r.customerFinalTotal = 7499; }, (r) => { r.estimate.options[0].price = 1; }, (r) => { r.estimate.markupPct = 30; }].every((mut) => { const r = record(); mut(r); return R.moneyFingerprint(r) !== before; }));
    ok('...and stays put when only words change', (() => { const r = record(); r.estimate.labor[0].item = 'renamed'; r.estimate.serviceBreakdown[0].included[0] = 'reworded'; r.estimate.summary = 'new'; return R.moneyFingerprint(r) === before; })());
    ok('cleanEdit forgives plural and variant names for where', R.cleanEdit({ where: 'Materials' }).where === 'material' && R.cleanEdit({ where: 'not included' }).where === 'excluded' && R.cleanEdit({ where: 'supplies' }).where === 'supplies' && R.cleanEdit({ where: 'Included' }).where === 'included');
  }

  console.log('\nthe function: gated, saves, returns the estimate\n');
  {
    STORES.estimates.set('SBC-260901-ARWQ', JSON.stringify(record()));
    const post = async (body, headers) => { const r = await fn.handler({ httpMethod: 'POST', headers: headers || { 'x-sbc-key': 'k' }, body: JSON.stringify(body) }); return { code: r.statusCode, body: JSON.parse(r.body) }; };
    let r = await post({ ref: 'SBC-260901-ARWQ', edits: [{ where: 'included', service: 'Bathroom', from: 'Mirror 24"x30" matte-black', to: 'Mirror 32"x36" brushed-gold' }] });
    const saved = JSON.parse(STORES.estimates.get('SBC-260901-ARWQ'));
    ok('AN EDIT IS APPLIED AND SAVED, and the estimate comes back for the page', r.code === 200 && r.body.success === true && r.body.applied.length === 1 && saved.estimate.serviceBreakdown[0].included[2] === 'Mirror 32"x36" brushed-gold' && r.body.estimate.serviceBreakdown[0].included[2] === 'Mirror 32"x36" brushed-gold' && !!saved.rewordedAt, JSON.stringify(r.body).slice(0, 200));
    ok('...prices as they were', saved.customerFinalTotal === 7500 && saved.estimate.labor[0].rate === 120 && saved.estimate.serviceBreakdown[0].subtotal === 7500);
    r = await post({ ref: 'SBC-260901-ARWQ', edits: [{ where: 'included', service: 'Bathroom', from: 'no such line', to: 'x' }] });
    ok('nothing matched -> success false with the reason, nothing saved', r.code === 200 && r.body.success === false && /not found/.test(r.body.error));
    ok('no key -> 401; no ref -> 400; no edits -> 400; unknown ref -> 404', (await post({ ref: 'SBC-260901-ARWQ', edits: [{ where: 'title', to: 'x' }] }, {})).code === 401 && (await post({ edits: [{}] })).code === 400 && (await post({ ref: 'SBC-260901-ARWQ' })).code === 400 && (await post({ ref: 'SBC-NOPE', edits: [{ where: 'title', to: 'x' }] })).code === 404);
    ok('it is in the endpoint-auth gated list', /\["reword-estimate", "POST"/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/lib/endpoint-auth.test.js'), 'utf8')));
  }

  console.log('\nthe assistant: the action, with its list of edits\n');
  {
    const ask = async (text) => { reply = text; const r = await assistant.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ messages: [{ role: 'user', text: 'fix the gold/black mismatch without touching prices' }] }) }); return JSON.parse(r.body); };
    let b = await ask('Fixing the finish in three places.\nACTION: {"type":"reword","ref":"SBC-260901-ARWQ","edits":[{"where":"included","service":"Bathroom","from":"Vanity light: matte-black 3-light fixture","to":"Vanity light: brushed-gold 4-light fixture"},{"where":"labor","from":"Mirror install — 32\\"x36\\" brushed-gold","to":"Mirror install — 32\\"x36\\" brushed-gold, 24 in. wide"}]}');
    ok('A REWORD WITH A LIST OF EDITS COMES THROUGH WHOLE, each edit with where / service / from / to', b.reply === 'Fixing the finish in three places.' && b.actions.length === 1 && b.actions[0].type === 'reword' && b.actions[0].edits.length === 2 && b.actions[0].edits[0].where === 'included' && b.actions[0].edits[0].service === 'Bathroom' && b.actions[0].edits[1].from === 'Mirror install — 32"x36" brushed-gold', JSON.stringify(b.actions));
    b = await ask('One fix.\nACTION: {"type":"reword","ref":"SBC-260901-ARWQ","where":"summary","from":"matte-black","to":"brushed-gold"}');
    ok('a single edit written flat becomes a one-item list', b.actions.length === 1 && b.actions[0].edits.length === 1 && b.actions[0].edits[0].where === 'summary' && b.actions[0].where === undefined);
    b = await ask('Nothing to do.\nACTION: {"type":"reword","ref":"SBC-260901-ARWQ"}');
    ok('a reword with no edits is dropped', b.actions.length === 0);
    const A = fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant.js'), 'utf8');
    ok('the prompt explains reword: where values, copy from exactly, one action per estimate, prices never move, reword for wording vs describe for new work', /FIX THE WORDS OF AN ESTIMATE WITHOUT TOUCHING A PRICE/.test(A) && /from must be copied EXACTLY/.test(A) && /Put every edit for one estimate in ONE action/.test(A) && /Use reword for wording; use describe for new work that must be priced/.test(A));
  }

  console.log('\nthe dashboard: before / after, one confirm, then the server\n');
  {
    const calls = { fetched: [], toasts: [], confirms: [], rendered: 0 };
    const ctx = {
      String, JSON, Array, Object, Number, Error, RegExp, Math, Date, console, encodeURIComponent,
      estimates: [{ ref: 'SBC-260901-ARWQ', status: 'sent', sentAt: '2026-09-10T00:00:00Z', customer: { name: 'Rafael Oralla' } }],
      currentRecord: Object.assign(record(), { sentVersion: { estimate: {} } }),
      visits: [], activeTab: 'all', renderTabs() {}, renderList() {}, openEdit() {}, closeEdit() {}, aiClose() {}, aiStartSearch() {}, AI_LOG: [], aiRender() {},
      renderEdit: () => { calls.rendered++; }, toast: (t) => calls.toasts.push(t), confirm: (t) => { calls.confirms.push(t); return ctx.say !== false; },
      sbcFetch: async (url, o) => { calls.fetched.push({ url, body: JSON.parse(o.body) }); return { ok: true, json: async () => ({ success: true, applied: [{ changed: 3 }, { changed: 1 }], skipped: [{ from: 'no such line' }], estimate: { projectTitle: 'UPDATED', labor: [] } }) }; },
      fetch: async () => ({ ok: true, json: async () => ({}) }), document: { getElementById: () => null },
    };
    vm.createContext(ctx);
    vm.runInContext(ext('aiExec'), ctx);
    const edits = [{ where: 'included', service: 'Bathroom', from: 'Vanity light: matte-black 3-light fixture', to: 'Vanity light: brushed-gold 4-light fixture' }, { where: 'labor', from: 'Mirror install', to: 'Mirror install, brushed-gold' }, { where: 'included', service: 'Bathroom', from: 'no such line', to: 'x' }];
    const said = await vm.runInContext('aiExec(' + JSON.stringify({ type: 'reword', ref: 'SBC-260901-ARWQ', edits }) + ')', ctx);
    ok('ONE CONFIRM SHOWS EVERY EDIT AS BEFORE / AFTER and says prices stay', calls.confirms.length === 1 && /Prices, quantities and totals stay exactly as they are/.test(calls.confirms[0]) && /Vanity light: matte-black 3-light fixture\n   → Vanity light: brushed-gold 4-light fixture/.test(calls.confirms[0]) && /labor:/.test(calls.confirms[0]), calls.confirms[0]);
    ok('...then posts the edits to reword-estimate with the key', calls.fetched.length === 1 && /reword-estimate/.test(calls.fetched[0].url) && calls.fetched[0].body.ref === 'SBC-260901-ARWQ' && calls.fetched[0].body.edits.length === 3);
    ok('...takes the returned estimate onto the open record and redraws', ctx.currentRecord.estimate.projectTitle === 'UPDATED' && calls.rendered === 1);
    ok('...and says what changed, what was not found, and that the customer still sees the sent version', /Changed 2 lines on SBC-260901-ARWQ; every price and total is as it was\./.test(said) && /Not found: no such line\./.test(said) && /customer still sees the sent version/.test(said), said);
    ctx.say = false;
    const no = await vm.runInContext('aiExec(' + JSON.stringify({ type: 'reword', ref: 'SBC-260901-ARWQ', edits }) + ')', ctx);
    ok('IF HE SAYS NO, NOTHING IS SENT', calls.fetched.length === 1 && /nothing changed/.test(no));
    ctx.say = true;
    ok('a ref not in the list is refused', /don't see SBC-NOPE/.test(await vm.runInContext('aiExec({ type: "reword", ref: "SBC-NOPE", edits: [{ where: "title", to: "x" }] })', ctx)));
    const blocks = DASH.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    let broken = null;
    blocks.forEach(function (bl, i) { try { new vm.Script(bl.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; } });
    ok('all ' + blocks.length + ' script blocks parse', broken === null, broken || '');
    ok('every function file has a legal Netlify name', fs.readdirSync(path.join(ROOT, 'netlify/functions')).every((f) => /^[A-Za-z0-9_-]+(\.m?js)?$/.test(f) || f === 'lib'));
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
