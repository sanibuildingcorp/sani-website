/* gmail-connect.test.js — run: node js/gmail-connect.test.js
 *
 *   "if i will have a connect button in my dashboard and i will connect by
 *    this button manually whatever email i need to connect to my dashboard
 *    where AI can read direct from there full list of emails"
 *
 * A Connect button on the Customers tab: Google's own sign-in, read-only
 * permission, the refresh token kept server-side, and gmail-sync reading
 * that mailbox into the assistant's inbox every fifteen minutes, matched to
 * estimates like info@ mail. Google, Blobs and list-estimates are stubbed;
 * the real code runs against them.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
function ext(name) {
  const s = DASH.search(new RegExp('(?:async )?function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = DASH.indexOf('{', s); j < DASH.length; j++) { if (DASH[j] === '{') d++; else if (DASH[j] === '}') { d--; if (!d) return DASH.slice(s, j + 1); } }
  throw new Error('unbalanced ' + name);
}

/* ── stubs ─────────────────────────────────────────────────────────────── */
const STORES = {};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return request; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (opts) => {
  const m = STORES[opts.name] || (STORES[opts.name] = new Map());
  return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } };
} } };
/* Google and our own site, over fetch */
const calls = [];
let GMAIL = { profileEmail: 'zura.jobs@gmail.com', messages: [], refreshOk: true, exchange: { access_token: 'acc-1', refresh_token: 'ref-1', expires_in: 3599 } };
const b64u = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
global.fetch = async (url, o) => {
  const u = String(url); const opts = o || {};
  calls.push({ url: u, method: opts.method || 'GET', body: opts.body || '', headers: opts.headers || {} });
  const J = (code, obj) => ({ ok: code < 400, status: code, json: async () => obj, text: async () => JSON.stringify(obj) });
  if (u === 'https://oauth2.googleapis.com/token') {
    const p = Object.fromEntries(new URLSearchParams(String(opts.body)));
    if (p.grant_type === 'authorization_code') return p.code === 'good-code' ? J(200, GMAIL.exchange) : J(400, { error: 'invalid_grant', error_description: 'Bad code' });
    if (p.grant_type === 'refresh_token') return GMAIL.refreshOk && p.refresh_token === 'ref-1' ? J(200, { access_token: 'acc-2', expires_in: 3599 }) : J(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
  }
  if (u.indexOf('https://oauth2.googleapis.com/revoke') === 0) return J(200, {});
  if (u === 'https://gmail.googleapis.com/gmail/v1/users/me/profile') return opts.headers.Authorization === 'Bearer acc-1' ? J(200, { emailAddress: GMAIL.profileEmail }) : J(401, { error: { message: 'bad token' } });
  if (u.indexOf('https://gmail.googleapis.com/gmail/v1/users/me/messages?') === 0) return opts.headers.Authorization === 'Bearer acc-2' ? J(200, { messages: GMAIL.messages.map((m) => ({ id: m.id, threadId: 't' })) }) : J(401, { error: { message: 'bad token' } });
  const mm = /https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/([^?]+)\?format=full/.exec(u);
  if (mm) {
    const m = GMAIL.messages.find((x) => x.id === decodeURIComponent(mm[1]));
    if (!m) return J(404, { error: { message: 'not found' } });
    return J(200, { id: m.id, internalDate: String(Date.parse(m.at)), snippet: (m.body || '').slice(0, 40), payload: { mimeType: 'multipart/alternative', headers: [{ name: 'From', value: m.from }, { name: 'To', value: 'zura.jobs@gmail.com' }, { name: 'Subject', value: m.subject }, { name: 'Message-ID', value: m.mid }], parts: m.html ? [{ mimeType: 'text/html', body: { data: b64u(m.html) } }] : [{ mimeType: 'text/plain', body: { data: b64u(m.body) } }] } });
  }
  if (u.indexOf('/.netlify/functions/list-estimates') > -1) return J(200, { records: [{ ref: 'SBC-260901-ARWQ', status: 'sent', sentAt: '2026-09-01T10:00:00Z', customer: { name: 'Rafael Gracia jr', email: 'rafael@example.com' } }] });
  if (u.indexOf('/.netlify/functions/inbox-digest-background') > -1) return J(202, {});
  if (u.indexOf('/.netlify/functions/gmail-sync') > -1) return J(200, { ok: true, accounts: [] });
  return J(404, {});
};
process.env.DASHBOARD_KEY = 'k'; process.env.URL = 'https://www.sanibuildingcorp.com';
process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com'; process.env.GOOGLE_CLIENT_SECRET = 'not-a-real-secret-test-only';
const lib = require(path.join(ROOT, 'netlify/functions/lib/gmail-accounts.js'));
const inbox = require(path.join(ROOT, 'netlify/functions/lib/inbox-store.js'));
const FN = (n) => require(path.join(ROOT, 'netlify/functions', n + '.js'));
const post = async (fn, body, key) => { const r = await fn.handler({ httpMethod: 'POST', headers: key === undefined ? { 'x-sbc-key': 'k' } : (key ? { 'x-sbc-key': key } : {}), body: JSON.stringify(body || {}) }); let b = null; try { b = JSON.parse(r.body); } catch (e) { b = r.body; } return { code: r.statusCode, body: b, headers: r.headers }; };
const get = async (fn, q) => fn.handler({ httpMethod: 'GET', headers: {}, queryStringParameters: q || {} });

(async () => {
  console.log('\n1. Connect: the sign-in URL, signed so the callback can trust it\n');
  let state = '';
  {
    const r = await post(FN('gmail-connect'), {});
    const u = new URL(r.body.url);
    state = u.searchParams.get('state');
    ok('THE BUTTON GETS GOOGLE\'S SIGN-IN URL: read-only Gmail scope, offline access with consent, our client id, our callback', r.code === 200 && u.origin + u.pathname === lib.AUTH_URL && u.searchParams.get('scope') === lib.SCOPE && u.searchParams.get('access_type') === 'offline' && u.searchParams.get('prompt') === 'consent' && u.searchParams.get('client_id') === 'cid.apps.googleusercontent.com' && u.searchParams.get('redirect_uri') === 'https://www.sanibuildingcorp.com/.netlify/functions/gmail-callback' && u.searchParams.get('response_type') === 'code', r.body.url);
    ok('...with a signed state that checks out now', lib.checkState(state) === true);
    ok('a state signed sixteen minutes ago is refused; a forged one too', lib.checkState(lib.signState(Date.now() - 16 * 60 * 1000)) === false && lib.checkState(state.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'))) === false && lib.checkState('') === false);
    ok('the secret never appears in the URL', r.body.url.indexOf('not-a-real-secret') === -1);
    delete process.env.GOOGLE_CLIENT_ID;
    const bare = await post(FN('gmail-connect'), {});
    ok('NOT SET UP YET -> 400 naming the two env vars and the redirect URI to register', bare.code === 400 && /GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/.test(bare.body.error) && bare.body.redirectUri === 'https://www.sanibuildingcorp.com/.netlify/functions/gmail-callback', JSON.stringify(bare.body));
    process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com';
  }

  console.log('\n2. Callback: Google returns with a code\n');
  {
    calls.length = 0;
    let r = await get(FN('gmail-callback'), { code: 'good-code', state: 'forged.0000000000000000.00000000000000000000000000000000' });
    ok('A CALLBACK WITHOUT OUR SIGNED STATE IS SENT BACK WITH AN ERROR, and no code is exchanged', r.statusCode === 302 && /dashboard\.html\?gmail=error&msg=/.test(r.headers.Location) && /not%20started%20from%20the%20dashboard/.test(r.headers.Location) && calls.length === 0, r.headers.Location);
    r = await get(FN('gmail-callback'), { error: 'access_denied', state: state });
    ok('he pressed Cancel at Google -> back with what Google said', r.statusCode === 302 && /gmail=error&msg=Google%20said%3A%20access_denied/.test(r.headers.Location), r.headers.Location);
    calls.length = 0;
    r = await get(FN('gmail-callback'), { code: 'good-code', state: state });
    const tok = calls.find((c) => c.url === lib.TOKEN_URL);
    const p = tok ? Object.fromEntries(new URLSearchParams(tok.body)) : {};
    ok('A GOOD STATE AND CODE: the code is exchanged (client id, secret, our redirect uri), the mailbox address read from Google, and the browser lands on the dashboard with ?gmail=connected&email=', r.statusCode === 302 && r.headers.Location === 'https://www.sanibuildingcorp.com/dashboard.html?gmail=connected&email=zura.jobs%40gmail.com' && p.grant_type === 'authorization_code' && p.code === 'good-code' && p.client_secret === 'not-a-real-secret-test-only' && p.redirect_uri === 'https://www.sanibuildingcorp.com/.netlify/functions/gmail-callback', r.headers.Location);
    const rec = JSON.parse(STORES['gmail-accounts'].get(lib.keyFor('zura.jobs@gmail.com')));
    const idx = JSON.parse(STORES['gmail-accounts'].get('index'));
    ok('...the refresh token is kept under the mailbox\'s key, the address on the list', rec.refreshToken === 'ref-1' && rec.email === 'zura.jobs@gmail.com' && idx.accounts.length === 1 && idx.accounts[0].email === 'zura.jobs@gmail.com', JSON.stringify(idx));
    r = await get(FN('gmail-callback'), { code: 'bad-code', state: lib.signState() });
    ok('a code Google rejects -> back with Google\'s words, nothing stored twice', r.statusCode === 302 && /gmail=error&msg=Google%20400/.test(r.headers.Location) && JSON.parse(STORES['gmail-accounts'].get('index')).accounts.length === 1, r.headers.Location);
    GMAIL.exchange = { access_token: 'acc-1', expires_in: 3599 };
    r = await get(FN('gmail-callback'), { code: 'good-code', state: lib.signState() });
    ok('Google giving no refresh token -> told how to fix it (remove the app, connect again)', /gmail=error&msg=Google%20gave%20no%20lasting%20permission/.test(r.headers.Location) && /Third-party%20access/.test(r.headers.Location), r.headers.Location);
    GMAIL.exchange = { access_token: 'acc-1', refresh_token: 'ref-1', expires_in: 3599 };
    const notGet = await FN('gmail-callback').handler({ httpMethod: 'POST', headers: {}, body: '{}' });
    ok('POST is not a callback', notGet.statusCode === 405);
  }

  console.log('\n3. The list: addresses and sync notes, never a token\n');
  {
    const r = await post(FN('gmail-accounts'), { action: 'list' });
    ok('THE LIST SHOWS THE MAILBOX, whether Google is set up, and the redirect URI to register', r.code === 200 && r.body.setup === true && r.body.accounts.length === 1 && r.body.accounts[0].email === 'zura.jobs@gmail.com' && r.body.redirectUri === 'https://www.sanibuildingcorp.com/.netlify/functions/gmail-callback', JSON.stringify(r.body));
    ok('...and no token, anywhere in it', JSON.stringify(r.body).indexOf('ref-1') === -1);
    ok('CONTRACTOR ONLY: no key -> 401', (await post(FN('gmail-accounts'), { action: 'list' }, '')).code === 401 && (await post(FN('gmail-connect'), {}, 'wrong')).code === 401 && (await post(FN('gmail-sync'), {}, '')).code === 401);
  }

  console.log('\n4. Sync: the mailbox read into the assistant\'s inbox\n');
  {
    GMAIL.messages = [
      { id: 'g1', mid: '<rafael-1@mail.gmail.com>', from: 'Rafael Gracia jr <rafael.new@example.com>', subject: 'vanity change', body: 'Hi Zura, can we do a 30 inch vanity instead?\n\nOn Sep 1 Sani wrote:\n> the old estimate', at: '2026-09-18T14:00:00Z' },
      { id: 'g2', mid: '<promo-1@news.homedepot.com>', from: 'The Home Depot <noreply@news.homedepot.com>', subject: '20% off tile', body: 'Sale sale sale', at: '2026-09-18T12:00:00Z' },
      { id: 'g3', mid: '<mgmt-1@example.org>', from: 'Voorhies Management <office@voorhies-mgmt.example.org>', subject: 'Re: SBC-260901-ARWQ permission', html: '<html><body><p>Approved for <b>Oct 3</b>.</p><style>p{}</style></body></html>', at: '2026-09-18T15:00:00Z' },
      { id: 'g4', mid: '<self-1@mail.gmail.com>', from: 'Zura <zura.jobs@gmail.com>', subject: 'note to self', body: 'buy screws', at: '2026-09-18T16:00:00Z' },
    ];
    calls.length = 0;
    const r = await post(FN('gmail-sync'), {});
    const acc = r.body.accounts && r.body.accounts[0];
    ok('A RUN: the token refreshed, the inbox listed (last two weeks, no spam/trash), three of four mails filed - the mail he sent himself is not', r.code === 200 && acc && acc.email === 'zura.jobs@gmail.com' && acc.listed === 4 && acc.stored === 3 && !acc.error, JSON.stringify(r.body));
    const listCall = calls.find((c) => c.url.indexOf('/users/me/messages?') > -1);
    ok('...asked as "in:inbox newer_than:14d -in:spam -in:trash"', !!listCall && decodeURIComponent(listCall.url).indexOf('q=in:inbox newer_than:14d -in:spam -in:trash') > -1, listCall && listCall.url);
    const idx = JSON.parse(STORES['inbox'].get('index'));
    const byId = {}; idx.items.forEach((x) => { byId[x.id] = x; });
    ok('RAFAEL FROM A NEW ADDRESS IS MATCHED BY NAME to his estimate, kind customer, the quoted history cut off', byId['<rafael-1@mail.gmail.com>'] && byId['<rafael-1@mail.gmail.com>'].ref === 'SBC-260901-ARWQ' && byId['<rafael-1@mail.gmail.com>'].by === 'name' && byId['<rafael-1@mail.gmail.com>'].kind === 'customer' && JSON.parse(STORES['inbox'].get(byId['<rafael-1@mail.gmail.com>'].key)).text === 'Hi Zura, can we do a 30 inch vanity instead?', JSON.stringify(byId['<rafael-1@mail.gmail.com>']));
    ok('THE MANAGEMENT MAIL IS MATCHED BY THE REF in its subject; its html read as words', byId['<mgmt-1@example.org>'] && byId['<mgmt-1@example.org>'].ref === 'SBC-260901-ARWQ' && byId['<mgmt-1@example.org>'].by === 'ref' && /Approved for Oct 3\./.test(JSON.parse(STORES['inbox'].get(byId['<mgmt-1@example.org>'].key)).text), JSON.stringify(byId['<mgmt-1@example.org>']));
    ok('the store promo is a notification: kept, out of the prompt', byId['<promo-1@news.homedepot.com>'] && byId['<promo-1@news.homedepot.com>'].kind === 'notification');
    ok('EVERY LINE NAMES THE MAILBOX IT CAME FROM, and the assistant\'s index line shows it', byId['<rafael-1@mail.gmail.com>'].box === 'zura.jobs@gmail.com' && inbox.indexLines(idx, 25).some((l) => / \| in zura\.jobs@gmail\.com \| /.test(l)), inbox.indexLines(idx, 25)[0]);
    const alert = calls.find((c) => c.url.indexOf('inbox-digest-background') > -1);
    ok('the two customer mails are handed to the alert job', !!alert && JSON.parse(alert.body).mode === 'alert' && JSON.parse(alert.body).ids.length === 2 && r.body.alertsQueued === 2, alert && alert.body);
    const rec = JSON.parse(STORES['gmail-accounts'].get(lib.keyFor('zura.jobs@gmail.com')));
    const li = JSON.parse(STORES['gmail-accounts'].get('index')).accounts[0];
    ok('the run is noted on the mailbox (when, "3 new of 4") and the four ids remembered as seen', /^\d{4}-/.test(li.lastSync) && li.lastResult === '3 new of 4' && li.error === '' && rec.seen.length === 4, JSON.stringify(li));
    calls.length = 0;
    const again = await post(FN('gmail-sync'), {});
    ok('THE NEXT RUN DOWNLOADS NOTHING it has seen', again.body.accounts[0].stored === 0 && !calls.some((c) => /format=full/.test(c.url)) && JSON.parse(STORES['inbox'].get('index')).items.length === 3);
    GMAIL.refreshOk = false;
    const dead = await post(FN('gmail-sync'), {});
    const li2 = JSON.parse(STORES['gmail-accounts'].get('index')).accounts[0];
    ok('GOOGLE REVOKED THE PERMISSION -> the mailbox shows the error and "connect it again", nothing crashes', dead.code === 200 && /connect it again/.test(dead.body.accounts[0].error) && /connect it again/.test(li2.error), JSON.stringify(dead.body));
    GMAIL.refreshOk = true;
    const sch = await FN('gmail-sync-scheduled').handler({ httpMethod: 'POST', headers: {}, body: '{}' });
    ok('the scheduled caller refuses anyone but the scheduler', sch.statusCode === 401);
    calls.length = 0;
    const sch2 = await FN('gmail-sync-scheduled').handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ next_run: '2026-09-20T12:07:00Z' }) });
    ok('...and with next_run POSTs to gmail-sync with the key from env', sch2.statusCode === 200 && calls.length === 1 && /gmail-sync$/.test(calls[0].url) && calls[0].headers['x-sbc-key'] === 'k');
    const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
    ok('on the schedule, every 15 minutes, offset from inbox-sync', /\[functions\."gmail-sync-scheduled"\]\s*\n\s*schedule = "7,22,37,52 \* \* \* \*"/.test(toml));
  }

  console.log('\n5. Disconnect: revoked at Google, forgotten here\n');
  {
    calls.length = 0;
    const r = await post(FN('gmail-accounts'), { action: 'remove', email: 'Zura.Jobs@gmail.com' });
    ok('DISCONNECT REVOKES THE TOKEN AT GOOGLE and drops the mailbox and its token', r.code === 200 && r.body.removed === true && r.body.accounts.length === 0 && calls.some((c) => c.url.indexOf('https://oauth2.googleapis.com/revoke?token=ref-1') === 0) && !STORES['gmail-accounts'].has(lib.keyFor('zura.jobs@gmail.com')), JSON.stringify(r.body));
    ok('what it already read stays in the inbox', JSON.parse(STORES['inbox'].get('index')).items.length === 3);
    const none = await post(FN('gmail-sync'), {});
    ok('no mailbox connected -> a quiet run', none.code === 200 && none.body.accounts.length === 0);
  }

  console.log('\n6. The page: the panel, the button, the way back\n');
  {
    ok('THE CUSTOMERS TAB CARRIES THE PANEL under the sync note', /<div id="gmail-panel">'\+gmailPanelHtml\(\)\+'<\/div>'/.test(DASH) && /if\(GMAIL_ACCOUNTS===null\)\{ gmailLoadAccounts\(\); \}/.test(DASH));
    let nav = null; const posted = [];
    const ctx = { esc: (s) => String(s), JSON, String, Array, Object, RegExp, decodeURIComponent, console, confirm: () => true, history: { replaceState() {} }, location: { href: '', search: '', pathname: '/dashboard.html' }, document: { getElementById: () => ({ innerHTML: '', disabled: false }) },
      sbcFetch: async (url, o) => { posted.push({ url, body: JSON.parse(o.body) }); if (/gmail-connect/.test(url)) return { ok: true, status: 200, json: async () => ({ ok: true, url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' }) }; return { ok: true, status: 200, json: async () => ({ ok: true, setup: true, accounts: [{ email: 'a@gmail.com', lastSync: '2026-09-20T12:07:00Z', lastResult: '2 new of 9' }] }) }; } };
    vm.createContext(ctx);
    vm.runInContext('var GMAIL_ACCOUNTS = null, GMAIL_SETUP = true, gmailNote = "";\n' + ['gmailPanelHtml', 'gmailPaint', 'gmailLoadAccounts', 'gmailConnect', 'gmailRemove', 'gmailReturn'].map(ext).join('\n'), ctx);
    let h = vm.runInContext('gmailPanelHtml()', ctx);
    ok('before the list loads: the Connect button and "Loading"', /Connect a Gmail/.test(h) && /onclick="gmailConnect\(\)"/.test(h) && /Loading/.test(h));
    await vm.runInContext('gmailLoadAccounts()', ctx);
    h = vm.runInContext('gmailPanelHtml()', ctx);
    ok('THE LIST: each mailbox with when it was read and a Disconnect button', /a@gmail\.com/.test(h) && /Read 2026-09-20 12:07 · 2 new of 9/.test(h) && /onclick="gmailRemove\('a@gmail\.com'\)"/.test(h), h);
    await vm.runInContext('gmailConnect()', ctx);
    ok('CONNECT ASKS gmail-connect (with the key) AND SENDS THE BROWSER TO GOOGLE', posted.some((p) => /gmail-connect/.test(p.url)) && ctx.location.href === 'https://accounts.google.com/o/oauth2/v2/auth?x=1');
    ctx.location.search = '?gmail=connected&email=a%40gmail.com';
    ok('back from Google: a note saying which mailbox is connected', /a@gmail\.com connected/.test(vm.runInContext('gmailReturn()', ctx)));
    ctx.location.search = '?gmail=error&msg=Google%20said%3A%20access_denied';
    ok('...or what went wrong', /⚠️ Google said: access_denied/.test(vm.runInContext('gmailReturn()', ctx)));
    ok('the return opens the Customers tab with the note', /gmailNote = note;/.test(DASH) && /activeTab = "customers"; renderTabs\(\); renderList\(\);/.test(DASH));
    await vm.runInContext('gmailRemove("a@gmail.com")', ctx);
    ok('Disconnect asks first, then posts remove', posted.some((p) => p.body.action === 'remove' && p.body.email === 'a@gmail.com'));
    const blocks = DASH.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    let broken = null;
    blocks.forEach(function (bl, i) { try { new vm.Script(bl.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; } });
    ok('all ' + blocks.length + ' script blocks parse', broken === null, broken || '');
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
