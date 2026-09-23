/* save-says-why.test.js — run: node js/save-says-why.test.js
 *
 *   "Below I click Save - customer sees exactly this - and it's saved, but
 *    more below is one more save button ... once I click it, it shows
 *    failing" ("Save failed: Save failed")
 *
 * Both buttons call the same save. The top one showed "✓ Customer scope
 * published" a moment after a failed save, so its failure was hidden, and
 * the bottom one said "Save failed" twice with no reason. Now the reason is
 * in the message, a dropped connection or a busy server is tried once more,
 * and neither button says "saved" when nothing was saved.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
function ext(name) {
  const s = DASH.search(new RegExp('(?:async )?function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = DASH.indexOf('{', s); j < DASH.length; j++) { if (DASH[j] === '{') d++; else if (DASH[j] === '}') { d--; if (!d) return DASH.slice(s, j + 1); } }
  throw new Error('unbalanced ' + name);
}
const clone = (o) => JSON.parse(JSON.stringify(o));

function page(answers) {
  const ctx = { toasts: [], calls: 0, loaded: 0, rendered: 0, JSON, Object, Number, String, Array, Math, Date, console };
  vm.createContext(ctx);
  vm.runInContext([ext('saveFailReason'), ext('saveDraft'), ext('scopePublish'), ext('scopeSaveDraft')].join('\n'), ctx);
  ctx.currentRecord = { ref: 'SBC-AST', status: 'drafted', estimate: { projectTitle: 'Astoria', labor: [] } };
  ctx.gatherForm = () => clone(ctx.currentRecord.estimate);
  ctx.toast = (m, err) => ctx.toasts.push((err ? 'ERR ' : '') + m);
  ctx.loadEstimates = async () => { ctx.loaded++; };
  ctx.renderScopeControl = () => { ctx.rendered++; };
  ctx.scopeAlreadyShared = () => false;
  ctx.scopeCleanCopy = () => ({ services: [] });
  ctx.scopeStampBreakdown = () => {};
  ctx.confirm = () => true;
  ctx.sbcFetch = async () => {
    const a = answers[Math.min(ctx.calls++, answers.length - 1)];
    if (a === 'drop') throw new TypeError('Load failed');
    return { ok: a.status >= 200 && a.status < 300, status: a.status, text: async () => a.body || '' };
  };
  return ctx;
}
const last = (ctx) => ctx.toasts[ctx.toasts.length - 1];

(async () => {
  console.log('\n1. The bottom Save Draft says why\n');
  {
    let c = page([{ status: 200, body: '{"success":true}' }]);
    let r = await vm.runInContext('saveDraft()', c);
    ok('a good save says saved, returns true, refreshes the list', r === true && last(c) === '✓ Draft saved' && c.loaded === 1 && c.calls === 1);

    c = page([{ status: 401, body: '{"error":"Unauthorized"}' }]);
    r = await vm.runInContext('saveDraft()', c);
    ok('THE SERVER\'S OWN REASON IS SHOWN, with the code - not "Save failed: Save failed"', r === false && last(c) === 'ERR Not saved: Unauthorized (401)' && c.calls === 1, last(c));

    c = page([{ status: 401, body: '' }]);
    await vm.runInContext('saveDraft()', c);
    ok('an expired sign-in says: reload and sign in', /sign-in expired\. Reload the page, sign in, and save again \(401\)/.test(last(c)), last(c));

    c = page([{ status: 413, body: 'Payload Too Large' }]);
    await vm.runInContext('saveDraft()', c);
    ok('too big says so, and what to do', /too big to save\. Remove a quote photo and try again \(413\)/.test(last(c)), last(c));

    c = page([{ status: 502, body: '' }, { status: 200, body: '{"success":true}' }]);
    r = await vm.runInContext('saveDraft()', c);
    ok('A BUSY SERVER IS TRIED ONCE MORE and the second try saves', r === true && c.calls === 2 && last(c) === '✓ Draft saved', c.toasts.join(' | '));

    c = page(['drop', { status: 200, body: '{"success":true}' }]);
    r = await vm.runInContext('saveDraft()', c);
    ok('a dropped phone connection is tried once more', r === true && c.calls === 2);

    c = page(['drop', 'drop']);
    r = await vm.runInContext('saveDraft()', c);
    ok('two drops: it says the connection dropped, and stops at two tries', r === false && c.calls === 2 && /the connection dropped \(Load failed\)\. Check the signal and save again/.test(last(c)), last(c));

    c = page([{ status: 400, body: '{"error":"Missing ref"}' }]);
    await vm.runInContext('saveDraft()', c);
    ok('a refusal (4xx) is not retried', c.calls === 1 && last(c) === 'ERR Not saved: Missing ref (400)');

    ok('...and nothing on the page is replaced by a failed save', c.currentRecord.estimate.projectTitle === 'Astoria' && c.loaded === 0);
  }

  console.log('\n2. The top "Save - the customer sees exactly this" no longer hides a failure\n');
  {
    let c = page([{ status: 500, body: '{"error":"Blobs write failed"}' }]);
    await vm.runInContext('scopePublish()', c);
    ok('A FAILED SAVE STAYS ON SCREEN: the last message is the failure, not "published"', last(c) === 'ERR Not saved: Blobs write failed (500)' && !c.toasts.some((t) => /published|customer sees exactly this/i.test(t)), c.toasts.join(' | '));

    c = page([{ status: 200, body: '{"success":true}' }]);
    await vm.runInContext('scopePublish()', c);
    ok('a good save says the customer sees exactly this', last(c) === '✓ Saved. The customer sees exactly this');

    c = page([{ status: 500, body: '' }, { status: 500, body: '' }]);
    await vm.runInContext('scopeSaveDraft()', c);
    ok('the private draft save does not say "saved" on a failure either', !c.toasts.some((t) => /Scope draft saved/.test(t)) && /^ERR Not saved: the server did not answer/.test(last(c)), c.toasts.join(' | '));
  }

  console.log('\n3. The server takes a freshly generated, regenerated estimate\n');
  {
    const STORE = new Map();
    const orig = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return '@netlify/blobs'; return orig.call(this, request, ...rest); };
    require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: () => ({ get: async (k) => (STORE.has(k) ? clone(STORE.get(k)) : null), setJSON: async (k, v) => { STORE.set(k, clone(v)); } }) } };
    process.env.DASHBOARD_KEY = 'k';
    const fn = require(path.join(ROOT, 'netlify/functions/save-estimate.js'));
    const labor = Array.from({ length: 120 }, (_, i) => ({ item: 'Line ' + i, qty: 1, rate: 100 + i, section: ['Bathroom', 'Flooring', 'Painting', 'Windows', 'Whole Project'][i % 5] }));
    const est = { projectTitle: 'Astoria Apartment Renovation', labor, materials: [], markupPct: 25,
      serviceBreakdown: [{ title: 'Bathroom', included: ['We gut the bathroom.'] }], projectIncluded: ['We cover the common stairs.'], projectExclusions: [],
      scopeWriter: { servicesWritten: 4 }, generatedWith: { mode: 'test' }, generationTiming: { totalMs: 1 }, scopeDraftReset: true, scopeDraftKept: undefined,
      repairReport: null, marketResearch: { findings: [] }, publishedCustomerScope: { services: [] }, manualCustomerScopeDraft: { services: [] }, customerScopePublished: true };
    STORE.set('SBC-AST', { ref: 'SBC-AST', status: 'drafted', estimate: { projectTitle: 'old', labor: [] }, history: [] });
    const r = await fn.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ ref: 'SBC-AST', estimate: est, status: 'drafted' }) });
    ok('save-estimate answers 200 and stores the whole-project list', r.statusCode === 200 && STORE.get('SBC-AST').estimate.projectIncluded[0] === 'We cover the common stairs.', r.statusCode + ' ' + r.body);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
