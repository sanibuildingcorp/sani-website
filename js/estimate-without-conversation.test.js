/* estimate-without-conversation.test.js — run: node js/estimate-without-conversation.test.js
 *
 *   "I sent estimate and in estimate shows conversion too, can we remove the
 *    conversion from estimate if i send estimate to the customer, not when i
 *    send messages but when i send final estimate there no need to be
 *    conversation"
 *
 * The questions and answers that led to the estimate stay in the dashboard.
 * Once the estimate is sent, the customer's page shows only what is said
 * after that send - so a new question still lands in one place - and with
 * nothing said since, the Messages card is not shown at all.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module'), https = require('https');
const ROOT = path.join(__dirname, '..');
const QUOTE = fs.readFileSync(path.join(ROOT, 'quote.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const clone = (o) => JSON.parse(JSON.stringify(o));
function ext(name) {
  const s = QUOTE.search(new RegExp('(?:async )?function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = QUOTE.indexOf('{', s); j < QUOTE.length; j++) { if (QUOTE[j] === '{') d++; else if (QUOTE[j] === '}') { d--; if (!d) return QUOTE.slice(s, j + 1); } }
  throw new Error('unbalanced ' + name);
}

const STORE = new Map(); const writes = [];
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return '@netlify/blobs'; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: () => ({ get: async (k) => (STORE.has(k) ? clone(STORE.get(k)) : null), setJSON: async (k, v) => { writes.push(k); STORE.set(k, clone(v)); } }) } };
https.request = function (opts, cb) { return { on() {}, write() {}, end() { const l = {}; cb({ statusCode: 200, on(ev, fn) { l[ev] = fn; if (ev === 'end') setImmediate(() => { l.data && l.data(Buffer.from('{}')); fn(); }); } }); } }; };
process.env.RESEND_API_KEY = 'rk'; process.env.CONTRACTOR_EMAIL = 'zura@example.com';
const T = require(path.join(ROOT, 'netlify/functions/lib/thread.js'));
const get = require(path.join(ROOT, 'netlify/functions/get-estimate.js'));
const qr = require(path.join(ROOT, 'netlify/functions/quote-response.js'));

/* Dates sit in the past so a message written "now" by the test is after the send. */
const BEFORE = [
  { id: 'm1', from: 'contractor', text: 'How many closets?', at: '2026-09-17T20:36:00Z' },
  { id: 'm2', from: 'customer', text: 'Aca baca gorma shagca', at: '2026-09-17T20:54:00Z' },
  { id: 'm3', from: 'contractor', text: 'Shen shagca', at: '2026-09-17T20:56:00Z' },
];
const SEND_AT = '2026-09-18T22:00:00Z';
const AFTER = [{ id: 'm4', from: 'customer', text: 'Can you start Monday?', at: '2026-09-19T10:00:00Z' }];
const EST = { projectTitle: 'Apartment Renovation — 3855 Shore Pkwy, 1K', markupPct: 25, labor: [{ item: 'Molding', qty: 220, unit: 'ft', rate: 6.5 }], materials: [], serviceBreakdown: [{ title: 'Carpentry', subtotal: 1430, included: ['x'] }] };
const base = { customer: { name: 'Jan', email: 'jan@example.com' }, request: { service: 'Carpentry' }, estimate: clone(EST) };
const SENT_CLEAN = Object.assign(clone(base), { ref: 'SBC-CLEAN', status: 'sent', sentAt: SEND_AT, thread: clone(BEFORE), sentVersion: { snapshotVersion: 1, n: 1, at: SEND_AT, estimate: clone(EST), customerFinalTotal: null } });
const SENT_TALKED = Object.assign(clone(SENT_CLEAN), { ref: 'SBC-TALKED', thread: clone(BEFORE).concat(clone(AFTER)) });
const ASKING = Object.assign(clone(base), { ref: 'SBC-ASKING', status: 'question', thread: clone(BEFORE) });
const OLD_SENT = Object.assign(clone(base), { ref: 'SBC-OLD', status: 'sent', sentAt: '2026-06-01T00:00:00Z', thread: clone(BEFORE) });
[SENT_CLEAN, SENT_TALKED, ASKING, OLD_SENT].forEach((r) => STORE.set(r.ref, r));
const asCustomer = async (ref) => JSON.parse((await get.handler({ httpMethod: 'GET', headers: { referer: 'https://www.sanibuildingcorp.com/quote.html?ref=' + ref }, queryStringParameters: { ref } })).body);
const asDashboard = async (ref) => JSON.parse((await get.handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { ref } })).body);
const texts = (t) => (t || []).map((m) => m.text).join(' | ');

console.log('\nthe rule: after the send, only what is said after the send\n');
{
  ok('A SENT ESTIMATE HIDES THE CONVERSATION THAT LED TO IT', T.customerThread(SENT_CLEAN).length === 0);
  ok('...but keeps what is said afterwards', texts(T.customerThread(SENT_TALKED)) === 'Can you start Monday?');
  ok('before any send, in the questions phase, everything shows', T.customerThread(ASKING).length === 3);
  ok('an old record sent before frozen versions existed keeps its thread (nothing to cut at)', T.customerThread(OLD_SENT).length === 3);
  const boundary = Object.assign(clone(SENT_CLEAN), { thread: [{ id: 'x', from: 'customer', text: 'same second', at: SEND_AT }] });
  ok('a message stamped in the same second as the send counts as after it', T.customerThread(boundary).length === 1);
  ok('a re-send moves the line: what was said between the sends is hidden by the second send', T.customerThread(Object.assign(clone(SENT_TALKED), { sentVersion: { snapshotVersion: 1, n: 2, at: '2026-09-19T12:00:00Z', estimate: clone(EST) } })).length === 0);
  ok('pure - the record is untouched', SENT_CLEAN.thread.length === 3);
}

console.log('\nthe customer\'s page gets that thread, the dashboard gets all of it\n');
(async () => {
  const c = await asCustomer('SBC-CLEAN');
  ok('THE SENT ESTIMATE ARRIVES WITH NO MESSAGES', Array.isArray(c.thread) && c.thread.length === 0 && c.estimate.labor.length === 1, JSON.stringify(c.thread));
  const t = await asCustomer('SBC-TALKED');
  ok('...and with only the later question when there is one', texts(t.thread) === 'Can you start Monday?');
  const a = await asCustomer('SBC-ASKING');
  ok('the questions phase still shows the questions', a.thread.length === 3);
  const d = await asDashboard('SBC-CLEAN');
  ok('THE DASHBOARD STILL HAS THE WHOLE CONVERSATION', d.thread.length === 3 && texts(d.thread) === 'How many closets? | Aca baca gorma shagca | Shen shagca');

  console.log('\nsending a message from the page brings back only the new conversation\n');
  const r = await qr.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ ref: 'SBC-CLEAN', action: 'question', questionText: 'Is Monday possible?' }) });
  const j = JSON.parse(r.body);
  ok('the reply carries the new message, not the old conversation', r.statusCode === 200 && texts(j.thread) === 'Is Monday possible?' && j.message && j.message.text === 'Is Monday possible?', r.body.slice(0, 200));
  ok('...while the record itself keeps everything', STORE.get('SBC-CLEAN').thread.length === 4);
  const QR = fs.readFileSync(path.join(ROOT, 'netlify/functions/quote-response.js'), 'utf8');
  ok('both places quote-response builds the thread use customerThread', (QR.match(/thread\.customerThread\(record\)/g) || []).length === 2 && !/let threadOut = thread\.normalizeThread/.test(QR));

  console.log('\nthe page: no Messages card on a clean sent estimate, back the moment something is said\n');
  {
    const ctx = { A: (v) => (Array.isArray(v) ? v : []), E: (s) => String(s == null ? '' : s), ref: 'SBC-CLEAN', location: { origin: 'https://x' }, fmtWhen: () => 'now', Date, encodeURIComponent, attHtml: () => '', SOW: false, calc: (e) => ({ total: (e && e.labor && e.labor.length) ? 1430 : 0 }), rec: null };
    vm.createContext(ctx);
    vm.runInContext(ext('threadInner') + ext('threadHtml') + ext('priced'), ctx);
    ctx.r = { status: 'sent', thread: [], estimate: EST };
    const hidden = vm.runInContext('threadHtml(r)', ctx);
    ok('A PRICED ESTIMATE WITH NOTHING SAID SINCE THE SEND: the card is there but hidden', /id="thread-card" style="display:none"/.test(hidden));
    ctx.r = { status: 'sent', thread: AFTER, estimate: EST };
    /* A priced estimate folds its messages into one closed line at the bottom
       (estimate-document.test.js): there as soon as there is one, never open. */
    ok('...shown as soon as there is a message after the send - in the closed fold', /id="thread-card"><summary class="ey"[^>]*>Messages with Sani Building Corp \(1\)/.test(vm.runInContext('threadHtml(r)', ctx)) && /Can you start Monday/.test(vm.runInContext('threadHtml(r)', ctx)));
    ctx.r = { status: 'question', thread: [], estimate: { projectTitle: 'x' } };
    ok('the questions phase (no price yet) keeps the card, with its "No messages yet" line', /id="thread-card"><div class="ey">Messages/.test(vm.runInContext('threadHtml(r)', ctx)) && /No messages yet/.test(vm.runInContext('threadHtml(r)', ctx)));
    ok('sending a message from the page un-hides the card (and opens the fold)', /const card=document\.getElementById\('thread-card'\);\s*\/\*[^*]*\*\/\s*if\(card\)\{card\.style\.display='';if\(card\.tagName==='DETAILS'\)card\.open=true\}/.test(QUOTE));
  }
  const blocks = QUOTE.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
  let broken = null;
  blocks.forEach(function (bl, i) { try { new vm.Script(bl.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; } });
  ok('quote.html: all ' + blocks.length + ' script blocks parse', broken === null, broken || '');
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
