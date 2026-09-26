/* inbox-by-email.test.js — run: node js/inbox-by-email.test.js
 *
 *   "Sometimes the customers send me email with reply and in my email inbox
 *    it's coming as a new email separate from the previous conversation
 *    emails or separate from estimate conversation portal. I need connect
 *    gmail ... letting AI read my email, identity same emails by customer
 *    names and email address ... and understand conversations"
 *
 * Three changes. (1) A mail that names no ref is matched to the sender's
 * estimate by ADDRESS (lib/thread.pickEstimateForEmail), so it joins the
 * conversation and the portal. (2) inbox-sync runs every 15 minutes on its
 * own. (3) The assistant reads twenty thread messages, not eight, and the
 * inbox emails with the open record's customer straight from the CRM log.
 *
 * inbox-sync.js needs imapflow, which is not installed here, so it is
 * checked by its source; the picker and the assistant are executed.
 */
const fs = require('fs'), path = require('path'), Module = require('module');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* ══ 1. THE PICKER ═══════════════════════════════════════════════════════ */
console.log('\nwhich estimate a new email belongs to, from the address alone\n');
const T = require(path.join(ROOT, 'netlify/functions/lib/thread.js'));
{
  const list = [
    { ref: 'SBC-OLD', status: 'completed', updatedAt: '2026-09-18T00:00:00Z' },
    { ref: 'SBC-SENT', status: 'sent', updatedAt: '2026-09-10T00:00:00Z' },
    { ref: 'SBC-NEW', status: 'new', submittedAt: '2026-09-15T00:00:00Z' },
  ];
  ok('THE OPEN ESTIMATE WITH THE MOST RECENT ACTIVITY WINS - not the completed one touched yesterday', T.pickEstimateForEmail(list) === 'SBC-NEW', T.pickEstimateForEmail(list));
  ok('a declined job is skipped when an open one exists', T.pickEstimateForEmail([{ ref: 'A', status: 'declined', updatedAt: '2026-09-19' }, { ref: 'B', status: 'sent', updatedAt: '2026-09-01' }]) === 'B');
  ok('with nothing open, the most recent one of all', T.pickEstimateForEmail([{ ref: 'A', status: 'completed', updatedAt: '2026-09-01' }, { ref: 'B', status: 'declined', updatedAt: '2026-09-05' }]) === 'B');
  ok('one estimate is simply it', T.pickEstimateForEmail([{ ref: 'ONLY', status: 'accepted' }]) === 'ONLY');
  ok('no estimates -> null, not a crash', T.pickEstimateForEmail([]) === null && T.pickEstimateForEmail(undefined) === null && T.pickEstimateForEmail([null, {}]) === null);
}

/* ══ 2. INBOX-SYNC USES IT, AND RUNS ON ITS OWN ══════════════════════════ */
async function syncChecks() {
console.log('\ninbox-sync matches by address and runs every 15 minutes\n');
{
  const src = fs.readFileSync(path.join(ROOT, 'netlify/functions/inbox-sync.js'), 'utf8');
  ok('THE REF IN THE TEXT STILL WINS - subject, cleaned reply, or the raw body with the quoted header card', /let ref = thread\.refFromText\(row\.subject, row\.body, rawText\);/.test(src) && /const rawText = String\(bodyText \|\| ""\)\.slice\(0, 20000\);/.test(src) && src.indexOf('const rawText') < src.indexOf('bodyText = cleanBody(bodyText)'));
  ok('...and with no ref the sender\'s address picks the estimate', /if \(!ref\) \{\s*ref = thread\.pickEstimateForEmail\(\(byEmail && byEmail\[fromAddr\]\) \|\| \[\]\);/.test(src));
  ok('the address map is built from the estimate list, lower-cased', /byEmail\[em\] = byEmail\[em\] \|\| \[\]\)\.push\(\{ ref: e\.ref, status: e\.status, updatedAt: e\.updatedAt/.test(src) && /const em = norm\(/.test(src));
  ok('the bridge is told which way it matched, and the report says so', /matchedBy: matchedBy/.test(src) && /by " \+ b\.matchedBy/.test(src));
  ok('IT RUNS EVERY 15 MINUTES, through a scheduled caller', /\[functions\."inbox-sync-scheduled"\]\s*\n\s*schedule = "\*\/15 \* \* \* \*"/.test(fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8')));
  {
    /* The caller: posts to inbox-sync on this site, on the schedule. Executed
       with fetch stubbed. A scheduled function may not be reachable by URL in
       production, and the dashboard still calls inbox-sync directly, so the
       schedule lives on this small wrapper instead. */
    const calls = [];
    const prevFetch = global.fetch;
    global.fetch = async (url, o) => { calls.push({ url, o }); return { ok: true, status: 200, text: async () => '{"ok":true,"newMessages":2}' }; };
    process.env.URL = 'https://www.sanibuildingcorp.com';
    const sched = require(path.join(ROOT, 'netlify/functions/inbox-sync-scheduled.js'));
    const prevKey = process.env.DASHBOARD_KEY; delete process.env.DASHBOARD_KEY;
    const r0 = await sched.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ next_run: '2026-09-20T00:00:00Z' }) });
    ok('WITHOUT THE KEY THE SCHEDULED CALLER FALLS BACK TO inbox-sync ON THIS SITE', r0.statusCode === 200 && calls.length === 1 && calls[0].url === 'https://www.sanibuildingcorp.com/.netlify/functions/inbox-sync' && calls[0].o.method === 'POST', JSON.stringify(calls[0] && calls[0].url));
    calls.length = 0; process.env.DASHBOARD_KEY = 'sched-key';
    const r = await sched.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ next_run: '2026-09-20T00:15:00Z' }) });
    ok('WITH THE KEY IT STARTS THE FULL READ, inbox-sync-background, and passes the key', calls.length === 1 && calls[0].url === 'https://www.sanibuildingcorp.com/.netlify/functions/inbox-sync-background' && calls[0].o.method === 'POST' && calls[0].o.headers['x-sbc-key'] === 'sched-key', JSON.stringify(calls[0] && calls[0].url));
    if (prevKey === undefined) delete process.env.DASHBOARD_KEY; else process.env.DASHBOARD_KEY = prevKey;
    ok('...and reports what the sync said', r.statusCode === 200 && /newMessages/.test(r.body));
    const noSched = await sched.handler({ httpMethod: 'POST', headers: {}, body: '{}' });
    ok('without the scheduler\'s body it refuses - not a public trigger', noSched.statusCode === 401 && calls.length === 1);
    global.fetch = prevFetch;
  }
  ok('the CRM write still happens before the bridge, and a bridge failure cannot stop it', src.indexOf('await sbInsertIgnoreDupes("lead_messages", row)') < src.indexOf('await bridgeToEstimateThread(row, fromAddr, byEmail, rawText)') && /try \{\s*const b = await bridgeToEstimateThread/.test(src));
}
}

/* ══ 3. THE ASSISTANT READS THE EMAILS ═══════════════════════════════════ */
console.log('\nthe assistant sees the thread and the inbox emails for this customer\n');
const STORES = {};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return '@netlify/blobs'; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (opts) => {
  const m = STORES[opts.name] || (STORES[opts.name] = new Map());
  return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); } };
} } };
const https = require('https');
let sent = null;
const sse = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
https.request = function (opts, cb) {
  const res = { statusCode: 200, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  return { on() { return this; }, write(b) { sent = JSON.parse(b); }, destroy() {}, end() { setImmediate(() => { cb(res); res._data(Buffer.from(sse({ type: 'message_start' }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }) + sse({ type: 'message_stop' }))); if (res._end) res._end(); }); } };
};
let fetched = [], emailRows = [], slow = false;
global.fetch = async (url, o) => { fetched.push(url); if (slow) await new Promise((r) => setTimeout(r, 3000)); return { ok: true, json: async () => emailRows }; };
process.env.DASHBOARD_KEY = 'k'; process.env.ANTHROPIC_API_KEY = 'sk';
process.env.SUPABASE_URL = 'https://sb.example'; process.env.SUPABASE_SECRET_KEY = 'secret';
const fn = require(path.join(ROOT, 'netlify/functions/assistant.js'));
const call = (body) => fn.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify(body) });

(async function () {
  await syncChecks();
  const REC = { ref: 'SBC-1', status: 'sent', customer: { name: 'May Chen', email: 'May@Example.com' }, request: { service: 'Bathroom', description: 'water damage' },
    thread: Array.from({ length: 25 }, (_, i) => ({ id: 'mid-' + i, from: i % 2 ? 'contractor' : 'customer', text: 'thread message ' + i, at: '2026-09-0' + (1 + (i % 9)) + 'T00:00:00Z' })) };
  STORES.estimates = new Map([['SBC-1', JSON.stringify(REC)]]);
  emailRows = [
    { direction: 'in', subject: 'Re: any update?', body: 'Hi Zurabi,\n\nCould we do Thursday?   Thanks', created_at: '2026-09-15T09:54:00Z', message_id: 'gm-1' },
    { direction: 'out', subject: 'Re: any update?', body: 'Thursday works, 8:30am', created_at: '2026-09-15T17:49:00Z', message_id: 'gm-2' },
    { direction: 'in', subject: 'dup', body: 'this one is already on the thread', created_at: '2026-09-14T00:00:00Z', message_id: 'mid-24' },
  ];
  fetched = []; sent = null;
  await call({ ref: 'SBC-1', messages: [{ role: 'user', text: 'what did May say?' }] });
  const sys = sent.system;
  ok('TWENTY THREAD MESSAGES, NOT EIGHT', /thread message 5/.test(sys) && /thread message 24/.test(sys) && !/thread message 4\b/.test(sys));
  ok('THE INBOX EMAILS FOR THIS CUSTOMER ARE IN THE PROMPT, oldest first, who said what', /EMAILS WITH THIS CUSTOMER/.test(sys) && /2026-09-15 Customer \[Re: any update\?\]: Hi Zurabi, Could we do Thursday\? Thanks/.test(sys) && /2026-09-15 Sani \[Re: any update\?\]: Thursday works, 8:30am/.test(sys), sys.slice(sys.indexOf('EMAILS WITH'), sys.indexOf('EMAILS WITH') + 300));
  ok('...asked by the customer\'s address, lower-cased, newest ten', /lead_messages\?lead_email=eq\.may%40example\.com/.test(fetched[0]) && /limit=10/.test(fetched[0]), fetched[0]);
  ok('an email already on the thread (same message id) is not repeated', sys.indexOf('already on the thread') === -1);
  ok('the customer\'s own words and the messages are still there', /water damage/.test(sys) && /MESSAGES SO FAR/.test(sys));

  fetched = []; sent = null; emailRows = [];
  await call({ ref: 'SBC-1', messages: [{ role: 'user', text: 'hi' }] });
  /* It used to leave the section out. Then he asked "can you find emails he
     sent me?" and the model answered "I can only see what's loaded on this
     estimate". Now the section says plainly that the log has none. */
  ok('no emails -> the section SAYS there are none from that address', /EMAILS WITH THIS CUSTOMER: none in the inbox log from may@example\.com/.test(sent.system), (sent.system.match(/EMAILS WITH THIS CUSTOMER[^\n]*/) || [''])[0]);

  slow = true; sent = null;
  const t0 = Date.now();
  await call({ ref: 'SBC-1', messages: [{ role: 'user', text: 'hi' }] });
  ok('A SLOW SUPABASE IS ABANDONED, the record still answers, inside the budget', sent && /water damage/.test(sent.system) && (Date.now() - t0) < 3500, (Date.now() - t0) + 'ms');
  slow = false;

  delete process.env.SUPABASE_URL; fetched = []; sent = null; emailRows = [{ direction: 'in', subject: 'x', body: 'y', created_at: '2026-09-15', message_id: 'z' }];
  await call({ ref: 'SBC-1', messages: [{ role: 'user', text: 'hi' }] });
  ok('no Supabase settings -> nothing fetched, nothing broken', fetched.length === 0 && sent && /water damage/.test(sent.system));

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e));
  process.exit(1);
});
