/* gas-appliances.test.js — run: node js/gas-appliances.test.js
 *
 *   "the oven is not included. We can't install oven because of safety gas
 *    pipe connection, they should connect with other contractors for safety.
 *    But also Perplexity is made mistake when add it as offer"
 *
 * The 750 3rd Ave estimate had us "set and level five owner-supplied
 * appliances: ... 30 inch oven, 30 inch cooktop". Now the generator (rule 23)
 * and the estimator chat both know: no oven, range, cooktop or anything on a
 * gas line - no line, no add-on, no offer - written once under Not included.
 */
const fs = require('fs'), path = require('path'), Module = require('module');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

const GEN = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'), 'utf8');
console.log('\n1. the generator\n');
ok('RULE 23: no oven, range, cooktop or gas-line appliance - no line, no add-on, no offer, no "we set it" bullet', /23\. GAS STAYS WITH THE GAS TRADE\. We never set, install or connect an oven, a range or a cooktop, or anything on a gas line/.test(GEN) && /it gets no labor line, no material line, no add-on or offer, and no bullet saying we set it/.test(GEN));
ok('...written once under Not included, in plain words', /Write it once under Not included: 'Oven and cooktop - set and connected by your gas contractor\.'/.test(GEN));
ok('...the cabinets around it stay ours, and a microwave, dishwasher or fridge may still be set', /The cabinet opening, panels and fillers around it stay in our scope\. A microwave, a dishwasher or a refrigerator may be set when the customer asks for it\./.test(GEN));
ok('it sits with the other numbered rules, before the labor guidance', GEN.indexOf('23. GAS STAYS') > GEN.indexOf("22. THE CUSTOMER'S EMAILS") && GEN.indexOf('23. GAS STAYS') < GEN.indexOf('NYC-METRO LABOR GUIDANCE'));

console.log('\n2. the estimator chat\n');
const STORES = {};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return request; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (o) => { const m = STORES[o.name] || (STORES[o.name] = new Map()); return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } }; } } };
const https = require('https');
let calls = [];
const sse = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
https.request = function (opts, cb) {
  const res = { statusCode: 200, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  return { on() { return this; }, write(b) { calls.push(JSON.parse(b)); }, destroy() {}, end() { setImmediate(() => { cb(res); res._data(Buffer.from(sse({ type: 'message_start' }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }) + sse({ type: 'message_stop' }))); if (res._end) res._end(); }); } };
};
process.env.DASHBOARD_KEY = 'k'; process.env.ANTHROPIC_API_KEY = 'sk';
const bg = require(path.join(ROOT, 'netlify/functions/assistant-background.js'));
const REC = { ref: 'SBC-260925-9UOP', status: 'drafted', customer: { name: 'Yancey Puerta', address: '750 3rd Ave' }, request: { service: 'Kitchen', description: 'Cabinet install.' }, estimate: { projectTitle: '750 3rd Ave', labor: [], materials: [], serviceBreakdown: [] } };
STORES.estimates = new Map([[REC.ref, JSON.stringify(REC)]]);
(async () => {
  await bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'J-gas-1', ref: REC.ref, chat: REC.ref, messages: [{ role: 'user', text: 'add oven install' }] }) });
  const sys = (calls[0] || {}).system || '';
  ok('THE ESTIMATOR CHAT KNOWS IT TOO: no oven/range/cooktop or gas line, no add-on, no offer, Not included once', /GAS STAYS WITH THE GAS TRADE: we never set, install or connect an oven, range or cooktop, or anything on a gas line - no line, no add-on, no offer\./.test(sys) && /'Oven and cooktop - set and connected by your gas contractor\.'/.test(sys));
  ok('never the word "licensed"', !/licensed/i.test(GEN.slice(GEN.indexOf('23. GAS STAYS'), GEN.indexOf('NYC-METRO LABOR GUIDANCE'))));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
