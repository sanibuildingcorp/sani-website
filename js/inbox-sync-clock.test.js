/* inbox-sync-clock.test.js — run: node js/inbox-sync-clock.test.js
 *
 *   "He can't found emails" (Sep 26 2026)
 *
 * The 409 Suydam thread reached info@ on Sep 25. The assistant's copy of the
 * inbox stopped at Sep 23. inbox-sync had 10 seconds and spent them loading
 * the estimate list before reading a single mail; the index was never
 * written, every run, the same way. Now: each lookup is capped, the 15-minute
 * schedule runs the full read in a background function (minutes), and the
 * full read writes the index as it goes, so a run cut off halfway keeps what
 * it read.
 *
 * IMAP, Blobs and the network are stubbed; the real code runs against them.
 */
const fs = require('fs'), path = require('path'), Module = require('module');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* ── stubs ─────────────────────────────────────────────────────────────── */
const STORES = {};
let indexWrites = 0;
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (['@netlify/blobs', 'imapflow', 'mailparser'].indexOf(request) !== -1) return request; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (opts) => {
  const m = STORES[opts.name] || (STORES[opts.name] = new Map());
  return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { if (opts.name === 'inbox' && k === 'index') indexWrites++; m.set(k, v); }, setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); } };
} } };
let MAILS = [];
let HANG_ON = '';
require.cache['imapflow'] = { id: 'imapflow', filename: 'imapflow', loaded: true, exports: { ImapFlow: function () {
  return {
    connect: async () => {}, logout: async () => {},
    getMailboxLock: async () => ({ release() {} }),
    search: async () => MAILS.map((_, i) => i + 1),
    fetchOne: async (uid) => { const m = MAILS[uid - 1]; return m ? { envelope: { from: [{ name: m.name, address: m.from }], subject: m.subject, messageId: m.id, date: m.at } } : null; },
    download: async (uid) => {
      const m = MAILS[uid - 1];
      if (HANG_ON && m.id === HANG_ON) return new Promise(() => {}); /* the function is cut off here */
      return { content: (async function* () { yield Buffer.from(m.body); })() };
    },
  };
} } };
require.cache['mailparser'] = { id: 'mailparser', filename: 'mailparser', loaded: true, exports: { simpleParser: async (buf) => ({ text: buf.toString('utf8') }) } };

let SLOW_ESTIMATES = false, SUPABASE_DOWN = false;
const fetched = [];
global.fetch = async (url, o) => {
  const u = String(url); fetched.push({ url: u, o });
  if (/lead_messages\?select=lead_email/.test(u)) { if (SUPABASE_DOWN) return { ok: false, status: 500, json: async () => ({}) }; return { ok: true, status: 200, json: async () => [] }; }
  if (/lead_messages/.test(u) && o && o.method === 'POST') return { ok: true, status: 201, text: async () => '' };
  if (/bookings/.test(u)) return { ok: true, status: 200, json: async () => [] };
  if (/contact-leads/.test(u)) return { ok: true, status: 200, json: async () => ({ leads: [] }) };
  if (/list-estimates/.test(u)) {
    if (SLOW_ESTIMATES) return new Promise(() => {}); /* the load that ate the 10 seconds */
    return { ok: true, status: 200, json: async () => ({ estimates: [{ ref: 'SBC-260925-SUYD', status: 'new', customer: { name: 'Crismar Rodriguez', email: 'cris@badichigroup.com', address: '409 Suydam St' } }] }) };
  }
  return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
};
process.env.DASHBOARD_KEY = 'k';
process.env.SUPABASE_URL = 'https://sb.example'; process.env.SUPABASE_SECRET_KEY = 'ss';
process.env.GMAIL_USER = 'info@sanibuildingcorp.com'; process.env.GMAIL_APP_PASSWORD = 'app-pass';
process.env.URL = 'https://www.sanibuildingcorp.com';

const IS = require(path.join(ROOT, 'netlify/functions/lib/inbox-store.js'));
const sync = require(path.join(ROOT, 'netlify/functions/inbox-sync.js'));
const bg = require(path.join(ROOT, 'netlify/functions/inbox-sync-background.js'));
const SRC = fs.readFileSync(path.join(ROOT, 'netlify/functions/inbox-sync.js'), 'utf8');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const POST = { httpMethod: 'POST', headers: {}, body: '{}' };
const SUYDAM = [
  { id: '<y1@b>', from: 'yaron@badichigroup.com', name: 'Yaron Badichi', subject: '409 Suydam St - Construction Bid Request', body: 'Please see attached plans for 409 Suydam St. Identify extra prep and owner-supplied items.', at: '2026-09-25T15:03:49Z' },
  { id: '<o1@s>', from: 'info@sanibuildingcorp.com', name: 'Sani', subject: 'Re: 409 Suydam St - Construction Bid Request', body: 'x', at: '2026-09-25T19:24:39Z' },
  { id: '<c1@b>', from: 'cris@badichigroup.com', name: 'Crismar Rodriguez', subject: 'Re: 409 Suydam St - Construction Bid Request', body: 'Earliest start date please, and the bathroom count is 3.', at: '2026-09-25T19:30:49Z' },
];
const reset = () => { STORES.inbox = new Map(); indexWrites = 0; fetched.length = 0; HANG_ON = ''; SLOW_ESTIMATES = false; SUPABASE_DOWN = false; };

(async () => {
  console.log('\n1. the quick sync: a slow estimate list can no longer eat the 10 seconds\n');
  {
    ok('QUICK keeps the old 8s budget and caps each lookup well inside it', /const QUICK = \{ totalMs: 8000, lookupMs: 3500,/.test(SRC) && sync.QUICK.lookupMs < sync.QUICK.totalMs / 2);
    ok('the deadline counts from the start of the run, lookups included', /const deadline = started \+ L\.totalMs;/.test(SRC) && SRC.indexOf('const started = Date.now();') < SRC.indexOf('// 1) Known-customer set'));
    reset(); MAILS = SUYDAM.slice(); SLOW_ESTIMATES = true;
    const t0 = Date.now();
    const r = await sync.run(POST, Object.assign({}, sync.QUICK, { lookupMs: 150 }));
    const b = JSON.parse(r.body);
    ok('THE ESTIMATE LIST HANGS - THE RUN STILL READS THE MAIL and says which lookup it cut', r.statusCode === 200 && b.inbox.stored === 2 && b.lookupsCut.indexOf('list-estimates') !== -1 && Date.now() - t0 < 2000, r.body);
    const idx = await IS.loadIndex();
    ok('...and the index is written: Yaron and Crismar are in the assistant\'s inbox', idx.items.length === 2 && idx.items.some((x) => x.id === '<y1@b>') && idx.items.some((x) => x.id === '<c1@b>') && indexWrites === 1);
    reset(); MAILS = SUYDAM.slice(); SUPABASE_DOWN = true;
    const r2 = await sync.run(POST, Object.assign({}, sync.QUICK, { lookupMs: 150 }));
    ok('a lookup that FAILS (not slow) still fails the run, as before', r2.statusCode === 502 && /Supabase read failed/.test(r2.body));
    reset(); MAILS = SUYDAM.slice();
    const r3 = await sync.handler(POST);
    const b3 = JSON.parse(r3.body);
    ok('the button\'s endpoint is the quick sync, unchanged when nothing is slow', r3.statusCode === 200 && b3.inbox.stored === 2 && b3.lookupsCut.length === 0, r3.body);
    ok('...and the job is matched: Crismar\'s mail is about her estimate', (await IS.loadIndex()).items.find((x) => x.id === '<c1@b>').ref === 'SBC-260925-SUYD');
  }

  console.log('\n2. the full read: minutes, a wider window, the index written as it goes\n');
  {
    ok('FULL has minutes, not seconds, a wider window and more downloads', sync.FULL.totalMs >= 5 * 60 * 1000 && sync.FULL.window > sync.QUICK.window && sync.FULL.downloads > sync.QUICK.downloads && sync.FULL.saveEvery > 0);
    reset();
    MAILS = [];
    for (let i = 0; i < 25; i++) MAILS.push({ id: '<p' + i + '@x>', from: 'person' + i + '@example.com', name: 'Person ' + i, subject: 'job ' + i, body: 'hello ' + i, at: new Date(Date.UTC(2026, 8, 24, 0, i)).toISOString() });
    HANG_ON = '<p2@x>'; /* newest first: p24..p3 are read, then the run is cut off on p2 */
    const cutOff = await Promise.race([
      sync.run(POST, Object.assign({}, sync.FULL, { saveEvery: 10 })).then(() => 'finished'),
      new Promise((res) => setTimeout(() => res('cut off'), 400)),
    ]);
    const idx = await IS.loadIndex();
    ok('A RUN CUT OFF HALFWAY KEEPS WHAT IT READ - the index was written every 10 mails', cutOff === 'cut off' && idx.items.length === 20 && idx.items.some((x) => x.id === '<p24@x>'), cutOff + ' / ' + idx.items.length);
    ok('(the quick run still writes once at the end - the 10 seconds are not spent on writes)', sync.QUICK.saveEvery === 0);
  }

  console.log('\n3. inbox-sync-background: contractor-only, the full clock\n');
  {
    reset(); MAILS = SUYDAM.slice();
    const no = await bg.handler({ httpMethod: 'POST', headers: {}, body: '{}' });
    ok('without the key it refuses', no.statusCode === 401 && (await IS.loadIndex()).items.length === 0);
    const yes = await bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: '{}' });
    ok('with the key it runs the sync on the FULL clock', yes.statusCode === 200 && JSON.parse(yes.body).inbox.stored === 2 && /sync\.run\([^)]*\), sync\.FULL\)/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/inbox-sync-background.js'), 'utf8')));
    ok('the name makes it a background function (15 minutes, answers 202)', fs.existsSync(path.join(ROOT, 'netlify/functions/inbox-sync-background.js')));
  }

  console.log('\n4. the dashboard\'s Sync button starts the full read behind the quick one\n');
  {
    const s = DASH.indexOf('async function custSyncInbox(silent)');
    const fn = DASH.slice(s, DASH.indexOf('\n}\n', s));
    ok('the button (not the silent open) posts to inbox-sync-background with the key', /if\(!silent\)\{[^\n]*fetch\('\/\.netlify\/functions\/inbox-sync-background',\{method:'POST',headers:\{'x-sbc-key':bk\}\}\)/.test(fn));
    ok('...and still shows the quick sync\'s numbers', /fetch\('\/\.netlify\/functions\/inbox-sync',\{method:'POST'\}\)/.test(fn));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
