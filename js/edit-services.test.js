/* edit-services.test.js — run: node js/edit-services.test.js
 *
 *   "in dashboard I can't change services, for this request in the form
 *    May maybe accidentally add water damage too but in her description and
 *    request no water damage work required, generator also use this words
 *    and then it's generating with its services"
 *
 * The Edit panel gets a Services field (plus property and timeline). Saving
 * rewrites request.service AND both selected-services lists together - the
 * estimator reads all three - and the scope pin, which hashes the service,
 * makes the next Re-price read the job again with the corrected trades.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const STORES = {};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return request; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (o) => { const m = STORES[o.name] || (STORES[o.name] = new Map()); return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); } }; } } };
process.env.DASHBOARD_KEY = 'k';
const fn = require(path.join(ROOT, 'netlify/functions/update-customer.js'));
const pin = require(path.join(ROOT, 'netlify/functions/lib/scope-pin.js'));
const post = async (body) => { const r = await fn.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify(body) }); return { code: r.statusCode, body: JSON.parse(r.body) }; };
const REC = { ref: 'SBC-260901-WOWP', customer: { name: 'May Chen', email: 'rmchen882@gmail.com', phone: '908-655-1715', address: '100 Riverside Boulevard' }, request: { service: 'Bathroom, Water Damage', services: ['Bathroom', 'Water Damage'], selectedServices: ['Bathroom', 'Water Damage'], description: 'Upgrades in bathroom.', serviceAnswers: { size: '70-100 sq ft' } }, estimate: { labor: [] } };

(async () => {
  console.log('\n1. The endpoint rewrites every copy of the service list\n');
  {
    STORES.estimates = new Map(); STORES.estimates.set(REC.ref, JSON.stringify(REC));
    const r = await post({ ref: REC.ref, customer: REC.customer, description: REC.request.description, service: 'Bathroom', propertyType: 'Apartment', timeline: '2-4 weeks' });
    const saved = JSON.parse(STORES.estimates.get(REC.ref));
    ok('"BATHROOM, WATER DAMAGE" -> "BATHROOM" in request.service, services AND selectedServices - the three the estimator reads', r.code === 200 && saved.request.service === 'Bathroom' && JSON.stringify(saved.request.services) === '["Bathroom"]' && JSON.stringify(saved.request.selectedServices) === '["Bathroom"]', JSON.stringify(saved.request));
    ok('...property and timeline saved too, answers and description untouched', saved.request.propertyType === 'Apartment' && saved.request.timeline === '2-4 weeks' && saved.request.serviceAnswers.size === '70-100 sq ft' && saved.request.description === 'Upgrades in bathroom.' && r.body.service === 'Bathroom' && r.body.propertyType === 'Apartment');
    const r2 = await post({ ref: REC.ref, customer: REC.customer, service: ' Bathroom , Painting/Doors ' });
    ok('a comma or slash list is split and tidied', r2.code === 200 && JSON.parse(STORES.estimates.get(REC.ref)).request.service === 'Bathroom, Painting, Doors');
    const r3 = await post({ ref: REC.ref, customer: REC.customer, service: '   ' });
    ok('an empty service is refused - a job with no trade cannot be priced', r3.code === 400 && /at least one service/.test(r3.body.error) && JSON.parse(STORES.estimates.get(REC.ref)).request.service === 'Bathroom, Painting, Doors');
    const r4 = await post({ ref: REC.ref, customer: REC.customer, description: 'still here' });
    ok('a save that does not mention the service leaves it alone (the older callers)', r4.code === 200 && JSON.parse(STORES.estimates.get(REC.ref)).request.service === 'Bathroom, Painting, Doors');
    const before = pin.scopeFingerprint({ request: { service: 'Bathroom, Water Damage', selectedServices: ['Bathroom', 'Water Damage'], description: 'x' } });
    const after = pin.scopeFingerprint({ request: { service: 'Bathroom', selectedServices: ['Bathroom'], description: 'x' } });
    ok('THE SCOPE PIN CHANGES WITH THE SERVICE, so the next Re-price reads the job again with the corrected trades', before !== after);
  }

  console.log('\n2. The Edit panel: the field, the payload, the record on screen\n');
  {
    ok('THE PANEL HAS A SERVICES FIELD (comma-separated), property and timeline', /<label>Services the AI prices \(comma-separated — remove one the customer ticked by mistake\)<\/label><input id="sbc-ec-service"/.test(DASH) && /id="sbc-ec-property"/.test(DASH) && /id="sbc-ec-timeline"/.test(DASH));
    const vals = { 'sbc-ec-name': 'May Chen', 'sbc-ec-email': 'rmchen882@gmail.com', 'sbc-ec-phone': '', 'sbc-ec-address': '', 'sbc-ec-desc': 'Upgrades', 'sbc-ec-service': 'Bathroom', 'sbc-ec-property': 'Apartment', 'sbc-ec-timeline': '' };
    const els = {}; Object.keys(vals).forEach((id) => { els[id] = { value: vals[id] }; });
    els['sbc-ec-err'] = { style: {}, textContent: '' }; els['sbc-ec-save'] = { disabled: false, textContent: '' }; els['sbc-ec-overlay'] = { classList: { add() {}, remove() {} }, addEventListener() {} }; els['sbc-ec-answers'] = { innerHTML: '' };
    let posted = null;
    const ctx = { window: {}, document: { getElementById: (id) => els[id] || { value: '', style: {}, classList: { add() {}, remove() {} }, innerHTML: '' }, querySelectorAll: () => [], body: { style: {} } }, currentRecord: { ref: 'SBC-260901-WOWP', customer: {}, request: { service: 'Bathroom, Water Damage', services: ['Bathroom', 'Water Damage'] } },
      sbcFetch: async (url, o) => { posted = JSON.parse(o.body); return { ok: true, json: async () => ({ success: true, customer: {}, description: 'Upgrades', service: 'Bathroom', propertyType: 'Apartment', timeline: '' }) }; },
      renderEdit() {}, loadEstimates() {}, toast() {}, String, JSON, Object, Error, Promise, setTimeout };
    vm.createContext(ctx);
    const block = DASH.slice(DASH.indexOf('if (window.__sbcEditCust) return;'), DASH.indexOf("var ov = document.getElementById('sbc-ec-overlay');"));
    vm.runInContext('(function(){' + block + '})()', ctx);
    ctx.window.sbcSaveCustomer();
    await new Promise((r) => setTimeout(r, 20));
    ok('SAVE SENDS THE SERVICE, property and timeline with the rest', posted && posted.service === 'Bathroom' && posted.propertyType === 'Apartment' && posted.timeline === '' && posted.ref === 'SBC-260901-WOWP', JSON.stringify(posted));
    ok('...and the open record follows: service and both lists, so the very next Re-price prices Bathroom only', ctx.currentRecord.request.service === 'Bathroom' && JSON.stringify(ctx.currentRecord.request.services) === '["Bathroom"]' && JSON.stringify(ctx.currentRecord.request.selectedServices) === '["Bathroom"]', JSON.stringify(ctx.currentRecord.request));
    els['sbc-ec-service'].value = ''; posted = null;
    ctx.window.sbcSaveCustomer();
    await new Promise((r) => setTimeout(r, 20));
    ok('an empty Services field is stopped on the page with a plain message', posted === null && /Name at least one service/.test(els['sbc-ec-err'].textContent));
    const blocks = DASH.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    let broken = null;
    blocks.forEach(function (bl, i) { try { new vm.Script(bl.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; } });
    ok('all ' + blocks.length + ' script blocks parse', broken === null, broken || '');
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
