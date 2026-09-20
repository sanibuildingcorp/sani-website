/* assistant-full-estimate.test.js — run: node js/assistant-full-estimate.test.js
 *
 *   "my ask ai can't see full opened estimate for let him help me analyze
 *    on estimate directly and if he found some unmatched then let him help
 *    me recorrect"
 *
 * "I can only read what's shown to me on screen ... the painting section
 * isn't in the data I have": the estimate text handed to the model was cut
 * at 9,000 characters, and the section he had just added sat past the cut.
 * The background answer (ninety seconds, no clock to protect) now gets the
 * whole estimate; the synchronous answer keeps its short cut but says how
 * much is missing and tells the model not to describe what it cannot see.
 * The model is also told how to check an estimate for mismatches.
 */
const fs = require('fs'), path = require('path'), Module = require('module');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const STORES = {};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return request; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (o) => { const m = STORES[o.name] || (STORES[o.name] = new Map()); return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } }; } } };
const https = require('https');
let sent = null;
const sse = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
https.request = function (opts, cb) {
  const res = { statusCode: 200, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  return { on() { return this; }, write(b) { sent = JSON.parse(b); }, destroy() {}, end() { setImmediate(() => { cb(res); res._data(Buffer.from(sse({ type: 'message_start' }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Looked.' } }) + sse({ type: 'message_stop' }))); if (res._end) res._end(); }); } };
};
process.env.DASHBOARD_KEY = 'k'; process.env.ANTHROPIC_API_KEY = 'sk';
const fn = require(path.join(ROOT, 'netlify/functions/assistant.js'));
const bg = require(path.join(ROOT, 'netlify/functions/assistant-background.js'));

/* A big estimate: 40 bathroom lines, then a Painting section added after agreement. */
const labor = [];
for (let i = 1; i <= 34; i++) labor.push({ item: 'Bathroom task number ' + i + ' with a reasonably long description of the work involved', qty: 4 + (i % 5), unit: 'hrs', rate: 62.4, section: 'Bathroom' });
for (let i = 1; i <= 12; i++) labor.push({ item: 'Painting task number ' + i + ' walls ceiling trim two coats Honey Badger 920', qty: 3 + (i % 4), unit: 'hrs', rate: 55, section: 'Painting' });
const materials = [];
for (let i = 1; i <= 24; i++) materials.push({ item: 'Bathroom material number ' + i + ' supplied and installed by Sani', qty: 1 + (i % 3), unit: 'ea', rate: 40 + i, section: 'Bathroom' });
materials.push({ item: 'Benjamin Moore Regal Select Honey Badger 920, eggshell', qty: 4, unit: 'gal', rate: 85, section: 'Painting' });
const REC = {
  ref: 'SBC-260901-WOWP', status: 'question', sentAt: '2026-09-10T21:01:00Z', updatedAt: '2026-09-20T17:45:00Z', customerFinalTotal: 23582.94,
  customer: { name: 'May Chen', email: 'rmchen882@gmail.com', address: '100 Riverside Blvd' },
  request: { service: 'Bathroom', description: 'Water damage bathroom.' },
  estimate: {
    projectTitle: 'Riverside Blvd Bathroom Upgrade', markupPct: 25, labor: labor, materials: materials,
    serviceBreakdown: [{ title: 'Bathroom', included: ['Remove the tub', 'Set new tile'], customerSupplies: [], notIncluded: [], subtotal: 12697.7, options: [] }, { title: 'Painting', included: ['Two coats on walls, ceiling and trim in Honey Badger 920', 'Doors in Louisburg Green HC-113'], customerSupplies: [], notIncluded: ['Wallpaper removal'], subtotal: 10885.24, options: [] }],
    addedServices: [{ at: '2026-09-20T17:41:00Z', titles: ['Painting'], subtotal: 10885.24, text: 'Paint the bathroom' }],
  },
  sentVersion: { n: 1, at: '2026-09-10T21:01:00Z', estimate: { labor: labor.slice(0, 34), materials: materials.slice(0, 24), markupPct: 25, serviceBreakdown: [{ title: 'Bathroom', subtotal: 12697.7 }] } },
};
STORES.estimates = new Map(); STORES.estimates.set(REC.ref, JSON.stringify(REC));

(async () => {
  console.log('\n1. The background answer gets the whole estimate\n');
  {
    sent = null;
    const r = await bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'A-full0001', ref: REC.ref, chat: REC.ref, messages: [{ role: 'user', text: 'Have a look at the full estimate, anything unmatched?' }] }) });
    const sys = sent && sent.system || '';
    const est = sys.slice(sys.indexOf('THE GENERATED ESTIMATE, AS HE SEES IT'));
    ok('THE WHOLE ESTIMATE IS IN THE PROMPT: all 46 labor lines and 25 material lines, no cut', r.statusCode === 200 && /LABOR LINES \(46\)/.test(est) && /Bathroom task number 34/.test(est) && /Painting task number 12/.test(est) && /MATERIAL LINES \(25\)/.test(est) && /Honey Badger 920, eggshell/.test(est) && !/estimate cut here/.test(est), est.length + ' chars');
    ok('...with the Painting card and the bathroom card', /SERVICE CARDS THE CUSTOMER SEES/.test(est) && /Painting - \$10,885\.24/.test(est) && /Bathroom - \$12,697\.70/.test(est));
    ok('IT IS TOLD WHAT WAS ADDED AFTER AGREEMENT, and that those lines are the ones tagged with that title', /ADDED AFTER THE CUSTOMER AGREED, as own sections \(the earlier sections untouched\): Painting \$10,885\.24 on 2026-09-20\. Their lines and cards are the ones tagged with those titles\./.test(est), est.match(/ADDED AFTER[^\n]*/) && est.match(/ADDED AFTER[^\n]*/)[0]);
    ok('...and what the customer sees right now: version 1 from Sep 10, changed since', /WHAT THE CUSTOMER SEES RIGHT NOW: version 1, sent 2026-09-10, total \$[\d,]+\.\d\d - the estimate above has changed since; she sees the new version only when he sends again/.test(est), est.match(/WHAT THE CUSTOMER SEES[^\n]*/) && est.match(/WHAT THE CUSTOMER SEES[^\n]*/)[0]);
    ok('IT IS TOLD HOW TO CHECK: read every line and card, name each mismatch, reword for wording, the exact line and number for money - which he edits', /CHECK THE ESTIMATE \('have a look', 'analyze', 'is it correct', 'anything unmatched'\)/.test(sys) && /never say you cannot see it or ask him to refresh/.test(sys) && /a card bullet with no line behind it, a line filed under the wrong service, a duplicate line, a \$0 card/.test(sys) && /he edits lines himself, you never change money/.test(sys));
  }

  console.log('\n2. The synchronous answer keeps its short cut, and says so honestly\n');
  {
    sent = null;
    const r = await fn.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ ref: REC.ref, chat: REC.ref, messages: [{ role: 'user', text: 'quick look' }] }) });
    const sys = sent && sent.system || '';
    const est = sys.slice(sys.indexOf('THE GENERATED ESTIMATE, AS HE SEES IT'));
    const cutAt = est.indexOf('... (estimate cut here');
    ok('on the nine-second path the estimate is cut near 9,000 characters (the clock is the reason)', r.statusCode === 200 && cutAt > 8000 && cutAt < 9200, cutAt + '');
    ok('...THE CUT SAYS HOW MUCH IS MISSING and tells the model not to describe as complete what it cannot see', /estimate cut here: \d+ more characters not shown\. Say the estimate is too long to read whole; never describe as complete what you cannot see\./.test(est));
    ok('the background caller passes the wider cap, forty thousand', /const ESTIMATE_CHARS = 40000;/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant-background.js'), 'utf8')) && /estimateChars: ESTIMATE_CHARS \}\);/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant-background.js'), 'utf8')));
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
