/* estimate-expiry.test.js — run: node js/estimate-expiry.test.js
 *
 *   "Yes block approval after expiration and let them re-request updated
 *    estimate"
 *
 * Thirty days from the send, an estimate that is not approved can no longer
 * be approved or have its contract signed - on the server, because the
 * endpoints are public. A question (the re-request) always goes through.
 * Sending the estimate again issues it again.
 */
const path = require('path'), Module = require('module');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const V = require(path.join(ROOT, 'netlify/functions/lib/estimate-validity.js'));

const STORE = new Map();
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return '@netlify/blobs'; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: () => ({ get: async (k) => (STORE.has(k) ? JSON.parse(STORE.get(k)) : null), setJSON: async (k, v) => { STORE.set(k, JSON.stringify(v)); }, set: async (k, v) => { STORE.set(k, v); } }) } };
delete process.env.RESEND_API_KEY;
const QR = require(path.join(ROOT, 'netlify/functions/quote-response.js'));
const SC = require(path.join(ROOT, 'netlify/functions/sign-contract.js'));

const DAY = 86400000;
function rec(daysAgo, extra) {
  return Object.assign({ ref: 'SBC-260920-ECB4', status: 'sent', sentAt: new Date(Date.now() - daysAgo * DAY).toISOString(), customer: { name: 'Michelle', email: '' },
    estimate: { markupPct: 25, labor: [{ section: 'Painting', item: 'Paint', qty: 10, rate: 60 }], materials: [] }, thread: [],
    contract: { sections: { scopeOfWork: ['Paint'] }, total: 750 } }, extra || {});
}
const post = (fn, body) => fn.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) });

console.log('\n1. The rule\n');
{
  ok('issued on the send date, valid thirty days', V.validUntil({ sentAt: '2026-09-23T15:00:00Z' }).toISOString() === '2026-10-23T15:00:00.000Z');
  ok('the frozen sent version\'s date wins over sentAt (a re-send issues it again)', V.validUntil({ sentAt: '2026-08-01T00:00:00Z', sentVersion: { at: '2026-09-23T15:00:00Z', estimate: {} } }).toISOString() === '2026-10-23T15:00:00.000Z');
  ok('31 days after the send: expired; 29 days: not', V.isExpired(rec(31)) === true && V.isExpired(rec(29)) === false);
  ok('approved, accepted, or a signed contract never expires; never sent never expires', V.isExpired(rec(90, { acceptedAt: '2026-09-01T00:00:00Z' })) === false && V.isExpired(rec(90, { status: 'completed' })) === false && V.isExpired(Object.assign(rec(90), { contract: { signed: true } })) === false && V.isExpired({ status: 'drafted' }) === false);
  ok('the message names the date and asks them to request an updated estimate', /^This estimate expired on October 23, 2026\. Please ask us for an updated estimate/.test(V.expiredMessage({ sentAt: '2026-09-23T15:00:00Z' })));
}

(async () => {
  console.log('\n2. The server refuses an expired approval\n');
  STORE.set('SBC-260920-ECB4', JSON.stringify(rec(31)));
  let r = await post(QR, { ref: 'SBC-260920-ECB4', action: 'accept', signature: 'Michelle' });
  ok('ACCEPT AFTER 30 DAYS -> 410 with the reason; the record is not accepted', r.statusCode === 410 && JSON.parse(r.body).expired === true && /expired on/.test(JSON.parse(r.body).error) && JSON.parse(STORE.get('SBC-260920-ECB4')).status === 'sent', r.statusCode + ' ' + r.body);
  r = await post(QR, { ref: 'SBC-260920-ECB4', action: 'review' });
  ok('...a "review before accepting" is refused the same way', r.statusCode === 410);
  r = await post(SC, { ref: 'SBC-260920-ECB4', name: 'Michelle Honan' });
  ok('SIGNING THE CONTRACT after 30 days -> 410; not signed, not accepted', r.statusCode === 410 && !JSON.parse(STORE.get('SBC-260920-ECB4')).contract.signed && JSON.parse(STORE.get('SBC-260920-ECB4')).status === 'sent');
  r = await post(QR, { ref: 'SBC-260920-ECB4', action: 'question', questionText: 'Hi, my estimate has expired. Please send me an updated estimate.' });
  ok('THE RE-REQUEST (a question) goes through', r.statusCode === 200 && JSON.parse(STORE.get('SBC-260920-ECB4')).thread.some((m) => /updated estimate/.test(m.text)), r.statusCode + ' ' + String(r.body).slice(0, 120));
  STORE.set('SBC-260920-ECB4', JSON.stringify(rec(5)));
  r = await post(QR, { ref: 'SBC-260920-ECB4', action: 'accept', signature: 'Michelle' });
  ok('inside thirty days, ACCEPT still works', r.statusCode === 200 && JSON.parse(STORE.get('SBC-260920-ECB4')).status === 'accepted', r.statusCode + ' ' + String(r.body).slice(0, 120));
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
