/* form-stop-alert.test.js — run: node js/form-stop-alert.test.js
 *
 *   "So many times people visiting then starting or clicking for estimate
 *    buttons and then they stopping" -> "Yes do it" (an alert naming the
 *    step they stopped at).
 *
 * The alert existed but never arrived as one: the beacon body can reach the
 * function base64-encoded, failed to parse, and went out as "started the form,
 * step 1". The form also counted its INTERNAL step ids (1,8,5,2,9), so a
 * customer on screen 2 was at "step 8". And the call-click email said the
 * visitor "left the estimate form".
 */
const path = require('path'), fs = require('fs'), https = require('https'), { EventEmitter } = require('events');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

const sent = [];
https.request = function (opts, cb) {
  const req = new EventEmitter(); let body = '';
  req.write = (d) => { body += d; }; req.setTimeout = () => {};
  req.end = () => { if (opts.hostname === 'api.resend.com') sent.push(JSON.parse(body)); const res = new EventEmitter(); res.statusCode = 200; cb(res); res.emit('data', '{"id":"x"}'); res.emit('end'); };
  return req;
};
process.env.RESEND_API_KEY = 'x';
const fn = require(path.join(ROOT, 'netlify/functions/form-alert'));
const post = (obj, b64) => fn.handler({ httpMethod: 'POST', headers: {}, isBase64Encoded: !!b64, body: b64 ? Buffer.from(JSON.stringify(obj)).toString('base64') : JSON.stringify(obj) });

/* the visit store and the wait, in memory */
const Module = require('module'), sess = new Map(), waits = [];
const _load = Module._load;
Module._load = function (req) { if (req === '@netlify/blobs') return { getStore: () => ({ get: async (k) => sess.has(k) ? JSON.parse(sess.get(k)) : null, setJSON: async (k, v) => sess.set(k, JSON.stringify(v)) }) }; return _load.apply(this, arguments); };
global.fetch = async (url, o) => { if (/form-alert-background/.test(url)) waits.push(JSON.parse(o.body)); return { ok: true, status: 202 }; };
process.env.DASHBOARD_KEY = 'k'.repeat(32);
const KEY = { 'x-sbc-key': process.env.DASHBOARD_KEY };
const bg = require(path.join(ROOT, 'netlify/functions/form-alert-background'));

(async () => {
  /* "When i start estimate form filling up ... in the process i received this" */
  sent.length = 0;
  await post({ type: 'abandon', step: 3, stepName: 'Describe & Upload', sid: 'visit12345' }, true);
  ok('a hidden page sends NO email at once: it only starts the wait', sent.length === 0 && waits.length === 1 && waits[0].sid === 'visit12345' && !!waits[0].abandonAt);
  await post({ type: 'resume', step: 3, sid: 'visit12345' });
  ok('the customer came back (photo picker, a text): no alert after the wait', bg.stillGone(JSON.parse(sess.get('visit12345')), waits[0].abandonAt) === false);
  waits.length = 0; await post({ type: 'abandon', step: 4, sid: 'visit99999' }, true);
  ok('really gone: the wait ends in the alert', bg.stillGone(JSON.parse(sess.get('visit99999')), waits[0].abandonAt) === true);
  await post({ type: 'done', step: 5, sid: 'visit99999' });
  ok('sent the request: never an alert', bg.stillGone(JSON.parse(sess.get('visit99999')), waits[0].abandonAt) === false);
  ok('a later hide owns the alert, the earlier wait stays quiet', bg.stillGone({ abandonAt: '2026-10-04T10:05:00Z' }, '2026-10-04T10:00:00Z') === false);
  sent.length = 0; await post({ type: 'abandon', step: 3, sid: 'visit12345', final: true });
  ok('only the background, with the dashboard key, may send the final alert', sent.length === 0);
  sent.length = 0;
  await fn.handler({ httpMethod: 'POST', headers: KEY, isBase64Encoded: true, body: Buffer.from(JSON.stringify({ type: 'abandon', step: 3, stepName: 'Describe & Upload', source: '/', sid: 'visit12345', final: true })).toString('base64') });
  const a = sent[0] || {};
  ok('a base64 beacon is read: the subject says STOPPED, not started', /Stopped the estimate form at step 3 of 5 \(Describe & Upload\)/.test(a.subject || ''), a.subject);
  ok('the email names the step', /Stopped at step/.test(a.html || '') && /3 of 5 - Describe &amp; Upload/.test(a.html || ''));
  sent.length = 0;
  await fn.handler({ httpMethod: 'POST', headers: KEY, body: JSON.stringify({ type: 'abandon', step: 8, sid: 'visit12345', final: true }) });
  ok('a step past 5 is never shown', /at step 5 of 5/.test((sent[0] || {}).subject || ''), (sent[0] || {}).subject);
  sent.length = 0;
  await post({ type: 'start', step: 1 });
  ok('the start alert is unchanged', /Someone started the estimate form/.test((sent[0] || {}).subject || ''));
  sent.length = 0;
  await post({ type: 'call', page: '/' });
  const c = sent[0] || {};
  ok('a call click says they tapped the number', /tapped your phone number/.test(c.html || '') && !/left the estimate form/.test(c.html || ''));

  /* the form side */
  const H = fs.readFileSync(path.join(ROOT, 'estimate.html'), 'utf8');
  ok('the form reports the step the customer SEES (DISPLAY_STEP), not the internal id', /var shown=\(typeof DISPLAY_STEP!=='undefined'&&DISPLAY_STEP\[s\]\)\|\|s;/.test(H) && /if\(shown>maxStep\)maxStep=shown;/.test(H));
  ok('leaving the tab counts (iPhone rarely fires pagehide)', /visibilitychange[\s\S]{0,80}hidden[\s\S]{0,20}left\(\)/.test(H));
  ok('every hide is told to the server, every return too', /if\(document\.visibilityState==='hidden'\)left\(\);\s*else if\(started&&!completed&&sentAt\)seen\('resume',maxStep\);/.test(H) && /seen\('done',maxStep\)/.test(H) && /seen\('progress',shown\)/.test(H));
  ok('each visit has its own id', /var SID=Math\.random\(\)/.test(H) && /sid:SID/.test(H));
  ok('the alert carries the step name', /stepName:/.test(H));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
