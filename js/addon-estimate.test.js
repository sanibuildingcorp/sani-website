/* addon-estimate.test.js — run: node js/addon-estimate.test.js
 *
 *   "she already agreed with this current service estimate but then she add
 *    additional service for painting, i need keep current estimate untouched"
 *
 * ➕ ADD ADDITIONAL WORK on an agreed estimate makes a SEPARATE estimate for
 * the new work, linked both ways. The agreed one is not edited: not its
 * estimate, not its sent version, not its status, not its price. The
 * customer's page for the original lists the add-on once it is sent; the
 * add-on's page names the original. Blobs are stubbed; the real code runs.
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
const STORES = {};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return request; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (opts) => {
  const m = STORES[opts.name] || (STORES[opts.name] = new Map());
  return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); }, setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); }, list: async () => ({ blobs: Array.from(m.keys()).map((key) => ({ key })) }) };
} } };
process.env.DASHBOARD_KEY = 'k';
const FN = (n) => require(path.join(ROOT, 'netlify/functions', n + '.js'));
const scopeOnly = require(path.join(ROOT, 'netlify/functions/lib/scope-only.js'));
const post = async (fn, body, key) => { const r = await fn.handler({ httpMethod: 'POST', headers: key === undefined ? { 'x-sbc-key': 'k' } : (key ? { 'x-sbc-key': key } : {}), body: JSON.stringify(body || {}) }); let b = null; try { b = JSON.parse(r.body); } catch (e) { b = r.body; } return { code: r.statusCode, body: b }; };
const asQuote = async (ref, sow) => { const r = await FN('get-estimate').handler({ httpMethod: 'GET', headers: { referer: 'https://www.sanibuildingcorp.com/quote.html?ref=' + ref + (sow ? '&sow=1' : '') }, queryStringParameters: sow ? { ref, sow: '1' } : { ref } }); return JSON.parse(r.body); };
const asDash = async (ref) => JSON.parse((await FN('get-estimate').handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { ref } })).body);

const PARENT = {
  ref: 'SBC-260901-ARWQ', status: 'accepted', source: 'estimate-form', submittedAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-10T10:00:00Z', sentAt: '2026-09-05T10:00:00Z', acceptedAt: '2026-09-08T10:00:00Z',
  customer: { name: 'May Chen', email: 'rmchen882@gmail.com', phone: '718-555-0100', address: '100 Riverside Blvd, New York, NY' },
  request: { service: 'Bathroom', propertyType: 'Apartment', description: 'Water damage bathroom', photoCount: 0, photos: [] },
  estimate: { projectTitle: 'Riverside Blvd Bathroom Upgrade', summary: 'Bathroom.', scopeOfWork: 'Tub, vanity, tile.', labor: [{ item: 'Demo', qty: 8, unit: 'hrs', rate: 62.4 }], materials: [], markupPct: 25, grandTotal: 12697.7, customerPresentationVersion: 'v8.1-deterministic-four-service', serviceBreakdown: [{ title: 'Bathroom', subtotal: 12697.7 }] },
  sentVersion: { at: '2026-09-05T10:00:00Z', estimate: { projectTitle: 'Riverside Blvd Bathroom Upgrade', summary: 'Bathroom.', labor: [{ item: 'Demo', qty: 8, unit: 'hrs', rate: 62.4 }], materials: [], markupPct: 25, grandTotal: 12697.7, serviceBreakdown: [{ title: 'Bathroom', subtotal: 12697.7 }] }, offeredOptions: [] },
  thread: [{ id: 't1', from: 'customer', text: 'Ok', at: '2026-09-08T09:00:00Z' }],
};

(async () => {
  console.log('\n1. Creating the add-on: a separate estimate, the original untouched\n');
  let addonRef = '';
  {
    STORES.estimates = new Map(); STORES.estimates.set(PARENT.ref, JSON.stringify(PARENT));
    const before = STORES.estimates.get(PARENT.ref);
    ok('CONTRACTOR ONLY: no key -> 401, nothing written', (await post(FN('create-estimate'), { parentRef: PARENT.ref, description: 'Painting' }, '')).code === 401 && STORES.estimates.size === 1);
    ok('an unknown original -> 404', (await post(FN('create-estimate'), { parentRef: 'SBC-000000-NOPE', description: 'Painting' })).code === 404);
    ok('no words on the new work -> 400', (await post(FN('create-estimate'), { parentRef: PARENT.ref, description: '' })).code === 400);
    const r = await post(FN('create-estimate'), { parentRef: PARENT.ref, description: 'Painting: walls, ceiling, baseboard and trim in Benjamin Moore Honey Badger 920, doors in Louisburg Green HC-113. About 8 gallons.', projectTitle: 'Additional work: Painting' });
    addonRef = r.body.ref;
    ok('THE ADD-ON IS CREATED with its own ref, linked to the original', r.code === 200 && r.body.success === true && /^SBC-\d{6}-[A-Z2-9]{4}$/.test(addonRef) && addonRef !== PARENT.ref && r.body.parentRef === PARENT.ref, JSON.stringify(r.body));
    const a = JSON.parse(STORES.estimates.get(addonRef));
    ok('...same customer, address and property; status new so the AI prices it; source addon', a.parentRef === PARENT.ref && a.addon === true && a.status === 'new' && a.source === 'addon' && a.customer.email === 'rmchen882@gmail.com' && a.customer.address === PARENT.customer.address && a.request.propertyType === 'Apartment' && a.request.service === 'Bathroom', JSON.stringify(a.customer));
    ok('...his words are the request, with a note that only the new work is to be priced', /^Painting: walls, ceiling/.test(a.request.description) && /Additional work to estimate SBC-260901-ARWQ - Riverside Blvd Bathroom Upgrade/.test(a.request.description) && /Price ONLY the additional work/.test(a.request.description), a.request.description);
    ok('...titled as additional work, the markup carried over, no lines yet', a.estimate.projectTitle === 'Additional work: Painting' && a.estimate.markupPct === 25 && a.estimate.labor.length === 0 && a.estimate.materials.length === 0);
    const after = JSON.parse(STORES.estimates.get(PARENT.ref));
    const stripped = Object.assign({}, after); delete stripped.addonRefs;
    ok('THE ORIGINAL IS BYTE-FOR-BYTE AS IT WAS, plus one thing: the add-on ref on addonRefs', JSON.stringify(stripped) === before && JSON.stringify(after.addonRefs) === JSON.stringify([addonRef]) && after.updatedAt === PARENT.updatedAt && after.status === 'accepted' && after.estimate.grandTotal === 12697.7, JSON.stringify(after.addonRefs));
    const r2 = await post(FN('create-estimate'), { parentRef: PARENT.ref, description: 'Closet doors' });
    ok('a second add-on joins the list', r2.code === 200 && JSON.parse(STORES.estimates.get(PARENT.ref)).addonRefs.length === 2);
    ok('an add-on cannot get an add-on of its own: add to the original', (await post(FN('create-estimate'), { parentRef: addonRef, description: 'x' })).code === 400);
    const plain = await post(FN('create-estimate'), { customer: { name: 'Manual', email: 'm@example.com' }, projectTitle: 'Invoice' });
    const p = JSON.parse(STORES.estimates.get(plain.body.ref));
    ok('a manual estimate with no parent is exactly as before: drafted, source manual, no link', plain.code === 200 && p.status === 'drafted' && p.source === 'manual' && p.parentRef === undefined && p.addon === undefined);
  }

  console.log('\n2. The customer\'s pages: the original names the add-on once sent; the add-on names the original\n');
  {
    let v = await asQuote(PARENT.ref);
    ok('THE ORIGINAL\'S PAGE, while the add-on is still a draft: no add-on shown, the agreed price as agreed', Array.isArray(v.addons) && v.addons.length === 0 && v.estimate.grandTotal === 12697.7 && v.addonRefs === undefined, JSON.stringify(v.addons));
    const a = JSON.parse(STORES.estimates.get(addonRef));
    a.status = 'sent'; a.sentAt = '2026-09-20T10:00:00Z'; a.estimate.labor = [{ item: 'Painting labor', qty: 24, unit: 'hrs', rate: 62.4 }]; a.estimate.grandTotal = 2200;
    a.sentVersion = { at: '2026-09-20T10:00:00Z', estimate: a.estimate, offeredOptions: [] };
    STORES.estimates.set(addonRef, JSON.stringify(a));
    v = await asQuote(PARENT.ref);
    ok('...ONCE SENT: the original\'s page lists it by name and ref, no price of it, the original price unchanged', v.addons.length === 1 && v.addons[0].ref === addonRef && v.addons[0].title === 'Additional work: Painting' && Object.keys(v.addons[0]).sort().join(',') === 'ref,title' && v.estimate.grandTotal === 12697.7, JSON.stringify(v.addons));
    const av = await asQuote(addonRef);
    ok('THE ADD-ON\'S PAGE names the original it belongs to, and prices only itself', av.addonOf && av.addonOf.ref === PARENT.ref && av.addonOf.title === 'Riverside Blvd Bathroom Upgrade' && av.estimate.grandTotal === 2200 && av.addons === undefined, JSON.stringify(av.addonOf));
    const sv = await asQuote(PARENT.ref, true);
    ok('the scope-only link carries the same names, with no money anywhere', sv.scopeOnly === true && sv.addons.length === 1 && sv.addons[0].ref === addonRef && scopeOnly.findMoney(sv).length === 0, JSON.stringify(scopeOnly.findMoney(sv)));
    const sa = await asQuote(addonRef, true);
    ok('...and the add-on\'s scope link names the original', sa.addonOf && sa.addonOf.ref === PARENT.ref && scopeOnly.findMoney(sa).length === 0);
    const dv = await asDash(PARENT.ref);
    ok('the dashboard gets the stored record, link list included', JSON.stringify(dv.addonRefs) === JSON.stringify([addonRef, JSON.parse(STORES.estimates.get(PARENT.ref)).addonRefs[1]]));
    const lst = JSON.parse((await FN('list-estimates').handler({ httpMethod: 'GET', headers: { 'x-sbc-key': 'k' }, queryStringParameters: {} })).body);
    const rows = lst.estimates || lst.records || lst.list || lst;
    const pr = rows.find((e) => e.ref === PARENT.ref), ar = rows.find((e) => e.ref === addonRef);
    ok('the list carries the links both ways', pr && pr.addonRefs.length === 2 && ar && ar.parentRef === PARENT.ref && pr.parentRef === null, JSON.stringify({ p: pr && pr.addonRefs, a: ar && ar.parentRef }));
  }

  console.log('\n3. The customer page renders them\n');
  {
    ok('both renderers place the cards after the hero', (QUOTE.match(/\$\{heroPhoto\(r\)\}<\/section>\$\{addonHtml\(r\)\}/g) || []).length === 2);
    const ctx = { SOW: false, E: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'), encodeURIComponent, Array };
    vm.createContext(ctx);
    vm.runInContext(ext(QUOTE, 'addonHtml'), ctx);
    let h = vm.runInContext('addonHtml({ addons: [{ ref: "SBC-260920-PA1N", title: "Additional work: Painting" }] })', ctx);
    ok('THE ORIGINAL\'S PAGE: "Additional work proposed", the name, a link to the add-on\'s own page, "stays exactly as agreed"', /Additional work proposed/.test(h) && /<b>Additional work: Painting<\/b>/.test(h) && /href="quote\.html\?ref=SBC-260920-PA1N"/.test(h) && /stays exactly as agreed/.test(h), h);
    h = vm.runInContext('addonHtml({ addonOf: { ref: "SBC-260901-ARWQ", title: "Riverside Blvd Bathroom Upgrade" } })', ctx);
    ok('THE ADD-ON\'S PAGE: "additional work for <original>", a link back', /This estimate is additional work for <b>Riverside Blvd Bathroom Upgrade<\/b> \(SBC-260901-ARWQ\)/.test(h) && /href="quote\.html\?ref=SBC-260901-ARWQ"/.test(h), h);
    ctx.SOW = true;
    h = vm.runInContext('addonHtml({ addonOf: { ref: "SBC-260901-ARWQ", title: "T" }, addons: [{ ref: "X", title: "Y" }] })', ctx);
    ok('on the scope-only page the links stay scope-only', (h.match(/&sow=1/g) || []).length === 2 && /This scope is additional work/.test(h));
    ok('nothing to show -> nothing', vm.runInContext('addonHtml({})', ctx) === '' && vm.runInContext('addonHtml(null)', ctx) === '');
  }

  console.log('\n4. The dashboard: the button, the badges, the flow\n');
  {
    ok('THE BUTTON sits under the scope link, not on an add-on itself', /currentRecord && currentRecord\.parentRef \? '' :\s*'<button type="button" onclick="addonCreate\(\)"[^>]*>➕ ADD ADDITIONAL WORK \(SEPARATE ESTIMATE\)<\/button>'/.test(DASH));
    ok('the list badges say ADD-ON TO … and N ADD-ONS', /➕ ADD-ON TO ' \+ esc\(e\.parentRef\)/.test(DASH) && /e\.addonRefs\.length \+ ' ADD-ON' \+ \(e\.addonRefs\.length > 1 \? 'S' : ''\)/.test(DASH));
    ok('the record header names the link both ways', /addonHeaderHtml\(r\) \+/.test(DASH));
    ok('the manual "new invoice" create now sends the key', /sbcFetch\('\/\.netlify\/functions\/create-estimate',\{\s*method:'POST',/.test(DASH) && !/[^c]fetch\('\/\.netlify\/functions\/create-estimate'/.test(DASH));
    const posted = []; const opened = []; const toasts = [];
    const ctx = { esc: (s) => String(s), fmt: (n) => '$' + n, JSON, String, Array, Error, estimates: [{ ref: 'SBC-260920-PA1N', status: 'sent', estimate: { grandTotal: 2200 } }],
      currentRecord: { ref: 'SBC-260901-ARWQ', addonRefs: ['SBC-260920-PA1N'] }, prompt: () => 'Painting per her Sept 17 email', toast: (m, bad) => toasts.push((bad ? '!' : '') + m),
      sbcFetch: async (url, o) => { posted.push({ url, body: JSON.parse(o.body) }); return { ok: true, status: 200, json: async () => ({ success: true, ref: 'SBC-260920-NEW1', parentRef: 'SBC-260901-ARWQ' }) }; },
      loadEstimates: async () => { opened.push('loaded'); }, openEdit: (ref) => { opened.push(ref); } };
    vm.createContext(ctx);
    vm.runInContext(['addonLink', 'addonHeaderHtml', 'addonCreate'].map((n) => ext(DASH, n)).join('\n'), ctx);
    const head = vm.runInContext('addonHeaderHtml(currentRecord)', ctx);
    ok('the original\'s header lists its add-on with status and total, tappable', /Additional work: <a href="#" onclick="openEdit\('SBC-260920-PA1N'\);return false"[^>]*>SBC-260920-PA1N<\/a> \(sent · \$2200\)/.test(head), head);
    ok('an add-on\'s header names the original, "stays as agreed"', /Additional work to <a[^>]*>SBC-260901-ARWQ<\/a> · that estimate stays as agreed/.test(vm.runInContext('addonHeaderHtml({ ref: "X", parentRef: "SBC-260901-ARWQ" })', ctx)));
    await vm.runInContext('addonCreate()', ctx);
    ok('➕ ASKS WHAT THE WORK IS, posts it with the original\'s ref (and the key), reloads the list and opens the new estimate', posted.length === 1 && /create-estimate/.test(posted[0].url) && posted[0].body.parentRef === 'SBC-260901-ARWQ' && posted[0].body.description === 'Painting per her Sept 17 email' && posted[0].body.projectTitle === 'Additional work: Painting per her Sept 17 email' && opened.join(',') === 'loaded,SBC-260920-NEW1' && toasts.some((t) => /SBC-260920-NEW1 created/.test(t)), JSON.stringify({ posted, opened, toasts }));
    ctx.prompt = () => '';
    posted.length = 0;
    await vm.runInContext('addonCreate()', ctx);
    ok('no words -> nothing created, told so', posted.length === 0 && toasts.some((t) => /^!Say what the additional work is/.test(t)));
    const A = fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant.js'), 'utf8');
    ok('THE ASSISTANT IS TOLD: never change the agreed estimate, point him to the button; on an add-on price only the new work', /ADDITIONAL WORK on an estimate the customer already agreed to[^"]*never change, reword or reprice that estimate[^"]*➕ ADD ADDITIONAL WORK/.test(A) && /THIS IS ADDITIONAL WORK to estimate/.test(A) && /Additional work made for this estimate/.test(A));
    const blocks = DASH.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    let broken = null;
    blocks.forEach(function (bl, i) { try { new vm.Script(bl.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; } });
    ok('all ' + blocks.length + ' dashboard script blocks parse', broken === null, broken || '');
    const qb = QUOTE.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    let qbroken = null;
    qb.forEach(function (bl, i) { try { new vm.Script(bl.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { if (!qbroken) qbroken = 'block ' + (i + 1) + ': ' + e.message; } });
    ok('all ' + qb.length + ' quote script blocks parse', qbroken === null, qbroken || '');
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
