/* open-alert.test.js — run: node js/open-alert.test.js
 *
 *   "I resent and opened in email but didn't received email notification"
 *   - and the dashboard still said SENT.
 *
 * 1. The "opened" alert was the one alert still reading CONTRACTOR_EMAIL
 *    itself and sending nothing when it was unset, and the only one taking
 *    its sender from RESEND_FROM. It now goes where every alert goes
 *    (ADDR.alertsTo(): CONTRACTOR_EMAIL, else info@) from estimates@.
 * 2. A dashboard Save carries the status the page loaded with, so "sent"
 *    was written back over "opened". A save that only re-sends "sent" or
 *    "drafted" no longer undoes what the customer moved the job to.
 */
const path = require('path'), Module = require('module');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const clone = (o) => JSON.parse(JSON.stringify(o));

const STORE = new Map();
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { if (r === '@netlify/blobs') return r; return orig.call(this, r, ...a); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: () => ({ get: async (k) => (STORE.has(k) ? clone(STORE.get(k)) : null), setJSON: async (k, v) => { STORE.set(k, clone(v)); } }) } };
const sent = [];
global.fetch = async (url, o) => { sent.push({ url, body: JSON.parse(o.body) }); return { ok: true, text: async () => '' }; };

const REC = () => ({ ref: 'SBC-260806-YX1G', status: 'sent', customer: { name: 'Zurabi', email: 'z@example.com' }, estimate: { projectTitle: 'Astoria 2-Bedroom Renovation', labor: [{ item: 'x', qty: 1, rate: 100 }], markupPct: 25 } });

(async () => {
  console.log('\n1. The "opened" alert is sent like every other alert\n');
  const TQ = require(path.join(ROOT, 'netlify/functions/track-quote-open.js'));
  delete process.env.CONTRACTOR_EMAIL; process.env.RESEND_API_KEY = 'r-test'; process.env.RESEND_FROM = 'Old Sender <noreply@old.example>';
  STORE.set('SBC-260806-YX1G', REC());
  let r = await TQ.handler({ httpMethod: 'GET', queryStringParameters: { ref: 'SBC-260806-YX1G' } });
  const rec = STORE.get('SBC-260806-YX1G');
  ok('the open is recorded: status "opened", open count 1', r.statusCode === 200 && rec.status === 'opened' && rec.openCount === 1);
  ok('WITH NO CONTRACTOR_EMAIL SET, THE ALERT STILL GOES - to info@, as every other alert', sent.length === 1 && sent[0].body.to[0] === 'info@sanibuildingcorp.com', JSON.stringify(sent.map((x) => x.body.to)));
  ok('...from the verified estimates@ sender, not RESEND_FROM', sent[0].body.from === 'Sani Building Corp <estimates@sanibuildingcorp.com>', sent[0].body.from);
  ok('...saying who opened what', /Zurabi opened their quote/.test(sent[0].body.subject) && /SBC-260806-YX1G/.test(sent[0].body.subject));
  process.env.CONTRACTOR_EMAIL = 'owner@example.com';
  await TQ.handler({ httpMethod: 'GET', queryStringParameters: { ref: 'SBC-260806-YX1G' } });
  ok('CONTRACTOR_EMAIL, when set, is still where it goes', sent.length === 2 && sent[1].body.to[0] === 'owner@example.com' && /\(×2\)/.test(sent[1].body.subject));
  delete process.env.RESEND_API_KEY;
  await TQ.handler({ httpMethod: 'GET', queryStringParameters: { ref: 'SBC-260806-YX1G' } });
  ok('no Resend key: the open is still recorded, only the email is skipped', sent.length === 2 && STORE.get('SBC-260806-YX1G').openCount === 3);

  console.log('\n1b. The page reports opens to quote-seen, by POST\n');
  const QS = require(path.join(ROOT, 'netlify/functions/quote-seen.js'));
  process.env.RESEND_API_KEY = 'r-test'; delete process.env.CONTRACTOR_EMAIL;
  STORE.set('SBC-260806-YX1G', REC());
  const before = sent.length;
  r = await QS.handler({ httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: JSON.stringify({ ref: 'SBC-260806-YX1G' }) });
  ok('QUOTE-SEEN IS THE SAME FUNCTION: a POST with the ref in the body records the open and sends the alert', QS.handler === TQ.handler && r.statusCode === 200 && STORE.get('SBC-260806-YX1G').status === 'opened' && sent.length === before + 1 && sent[sent.length - 1].body.to[0] === 'info@sanibuildingcorp.com');
  r = await QS.handler({ httpMethod: 'POST', headers: {}, queryStringParameters: {}, isBase64Encoded: true, body: Buffer.from(JSON.stringify({ ref: 'SBC-260806-YX1G' })).toString('base64') });
  ok('...a base64 body is read too', STORE.get('SBC-260806-YX1G').openCount === 2);
  r = await QS.handler({ httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: 'not json' });
  ok('...a body with no ref records nothing and still answers', r.statusCode === 200 && STORE.get('SBC-260806-YX1G').openCount === 2);

  console.log('\n2. A Save does not undo what the customer did\n');
  process.env.DASHBOARD_KEY = 'k';
  const SE = require(path.join(ROOT, 'netlify/functions/save-estimate.js'));
  const save = (status) => SE.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ ref: 'SBC-260806-YX1G', estimate: { projectTitle: 'Astoria 2-Bedroom Renovation' }, status }) });
  const setStatus = (s) => { const x = STORE.get('SBC-260806-YX1G'); x.status = s; STORE.set('SBC-260806-YX1G', x); };
  const now = () => STORE.get('SBC-260806-YX1G').status;
  setStatus('opened'); await save('sent');
  ok('THE CUSTOMER OPENED IT, THE DASHBOARD SAVED "sent": it stays "opened"', now() === 'opened');
  for (const s of ['question', 'accepted', 'review_requested', 'declined']) { setStatus(s); await save('sent'); if (now() !== s) { ok('a customer\'s "' + s + '" survives a Save', false, now()); } }
  ok('...so do a question, a go-ahead, a review request and a decline', true);
  setStatus('accepted'); await save('completed');
  ok('deliberate changes still go through: accepted -> completed', now() === 'completed');
  setStatus('opened'); await save('cancelled');
  ok('...opened -> cancelled', now() === 'cancelled');
  setStatus('cancelled'); await save('sent');
  ok('...back from cancelled to where it was', now() === 'sent');
  setStatus('new'); await save('drafted');
  ok('...a first save moves new -> drafted', now() === 'drafted');

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
