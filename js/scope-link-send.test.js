/* scope-link-send.test.js — run: node js/scope-link-send.test.js
 *
 *   "It's just shows scope of work copied but not sending or not open same
 *    as send to customer"
 *
 * The Scope of Work button copied a link and stopped. Now it opens a window
 * with the three things he does with that link: open it, copy it, or email
 * it - to the customer or to any address he types (the management office).
 * The email goes through send-scope-link, contractor-only, names no price,
 * and changes nothing about the estimate.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module'), https = require('https');
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
const clone = (o) => JSON.parse(JSON.stringify(o));

/* blobs + Resend, stubbed */
const STORE = new Map(); const writes = [];
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return '@netlify/blobs'; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: () => ({ get: async (k) => (STORE.has(k) ? clone(STORE.get(k)) : null), setJSON: async (k, v) => { writes.push(k); STORE.set(k, clone(v)); } }) } };
const mails = []; let resendStatus = 200;
https.request = function (opts, cb) {
  const chunks = [];
  return { on() {}, write(d) { chunks.push(d); }, end() {
    mails.push({ host: opts.hostname, path: opts.path, body: JSON.parse(chunks.join('')) });
    const listeners = {};
    cb({ statusCode: resendStatus, on(ev, fn) { listeners[ev] = fn; if (ev === 'end') { setImmediate(() => { listeners.data && listeners.data(Buffer.from('{"id":"m"}')); fn(); }); } } });
  } };
};
process.env.DASHBOARD_KEY = 'k-test'; process.env.RESEND_API_KEY = 'r-test'; process.env.SITE_URL = 'https://www.sanibuildingcorp.com';
const fn = require(path.join(ROOT, 'netlify/functions/send-scope-link.js'));
const REC = { ref: 'SBC-SOW', status: 'drafted', customer: { name: 'Jan', email: 'jan@example.com', address: '3855 Shore Pkwy, 1K' }, request: { service: 'Carpentry' },
  estimate: { projectTitle: 'Apartment Renovation — 3855 Shore Pkwy, 1K', labor: [{ item: 'x', qty: 1, rate: 6598.2 }], markupPct: 25 }, customerFinalTotal: 9181.16, thread: [{ id: 'm1', from: 'customer', text: 'hi', at: '2026-09-19T00:00:00Z' }] };
STORE.set('SBC-SOW', clone(REC));
const call = (body, headers) => fn.handler({ httpMethod: 'POST', headers: Object.assign({ 'x-sbc-key': 'k-test' }, headers || {}), body: JSON.stringify(body) });

console.log('\nsend-scope-link: emails the no-price page, to anyone he names\n');
(async () => {
  let r = await call({ ref: 'SBC-SOW', to: 'manager@building.com, board@building.com' });
  let j = JSON.parse(r.body);
  ok('SENDS TO THE ADDRESSES HE TYPED', r.statusCode === 200 && j.success === true && mails.length === 1 && mails[0].body.to.join('|') === 'manager@building.com|board@building.com', r.body.slice(0, 200));
  const m = mails[0].body;
  ok('...the scope link, and nothing else', m.text.indexOf('https://www.sanibuildingcorp.com/quote.html?ref=SBC-SOW&sow=1') !== -1 && m.html.indexOf('quote.html?ref=SBC-SOW&amp;sow=1') !== -1 && m.html.indexOf('sow=1') !== -1);
  ok('THE EMAIL NAMES NO PRICE: no dollar sign, no total, no rate, and says so', m.text.indexOf('$') === -1 && m.html.indexOf('$') === -1 && m.text.indexOf('9,181') === -1 && m.text.indexOf('6598') === -1 && /contains no pricing/.test(m.text) && /contains no pricing/.test(m.html));
  ok('subject and body name the project, never a price - and not the address twice when the title has it', m.subject === 'Scope of work — Apartment Renovation — 3855 Shore Pkwy, 1K' && /prepared by Sani Building Corp/.test(m.text), m.subject);
  ok('from Zurabi, replies go to contact@, its own thread - not the estimate conversation', /Zurabi/.test(m.from) && m.reply_to === 'contact@sanibuildingcorp.com' && m.headers['X-Entity-Ref-ID'] === 'SBC-SOW-sow');
  ok('"fully insured", never the forbidden word', /Fully insured/.test(m.text) && !/licensed/i.test(m.text + m.html));
  const saved = STORE.get('SBC-SOW');
  ok('THE SEND IS NOTED ON THE RECORD, and nothing about the estimate changes', writes.length === 1 && saved.scopeLinkSends.length === 1 && saved.scopeLinkSends[0].to.length === 2 && saved.scopeLinkSentAt && saved.status === 'drafted' && saved.sentAt === undefined && saved.sentVersion === undefined && saved.thread.length === 1 && saved.customerFinalTotal === 9181.16, JSON.stringify(saved.scopeLinkSends));

  r = await call({ ref: 'SBC-SOW' }); j = JSON.parse(r.body);
  ok('no address given -> the customer\'s email', r.statusCode === 200 && mails[1].body.to.join() === 'jan@example.com', r.body.slice(0, 120));
  r = await call({ ref: 'SBC-SOW', to: 'not-an-email' }); j = JSON.parse(r.body);
  ok('a bad address is refused with a plain message, nothing sent', r.statusCode === 400 && /Not an email address: not-an-email/.test(j.error) && mails.length === 2);
  r = await call({ ref: 'SBC-SOW', to: 'a@x.com,b@x.com,c@x.com,d@x.com,e@x.com,f@x.com' }); j = JSON.parse(r.body);
  ok('six addresses is too many', r.statusCode === 400 && /Up to 5/.test(j.error) && mails.length === 2);
  r = await call({ ref: 'SBC-NOPE', to: 'a@x.com' });
  ok('unknown ref -> 404', r.statusCode === 404);
  r = await fn.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ ref: 'SBC-SOW', to: 'thief@x.com' }) });
  ok('CONTRACTOR ONLY: no key -> 401, nothing sent', r.statusCode === 401 && mails.length === 2);
  r = await fn.handler({ httpMethod: 'GET', headers: { 'x-sbc-key': 'k-test' } });
  ok('GET -> 405', r.statusCode === 405);
  STORE.set('SBC-SOW2', Object.assign(clone(REC), { ref: 'SBC-SOW2', estimate: { projectTitle: 'Bathroom Renovation' } }));
  await call({ ref: 'SBC-SOW2', to: 'a@x.com' });
  ok('the address is added to the subject when the title does not carry it', mails[mails.length - 1].body.subject === 'Scope of work — Bathroom Renovation at 3855 Shore Pkwy, 1K', mails[mails.length - 1].body.subject);
  ok('it is in the endpoint-auth gated list', /\["send-scope-link", "POST"/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/lib/endpoint-auth.test.js'), 'utf8')));
  ok('the address parser splits on commas, semicolons and spaces, lowercases, dedupes', fn._parseRecipients(' A@x.com, a@x.com; b@Y.com  c@z.com ').join('|') === 'a@x.com|b@y.com|c@z.com');

  console.log('\nthe dashboard: one button, three ways - open, copy, send\n');
  {
    let appended = null, opened = null, posted = null, removed = 0, toasts = [];
    const overlay = { remove() { removed++; } };
    const ctx = {
      String, Array, JSON, console, encodeURIComponent, Error, Object,
      currentRecord: { ref: 'SBC-SOW', status: 'drafted', customer: { name: 'Jan', email: 'jan@example.com' } },
      esc: (s) => String(s == null ? '' : s), toast: (t) => toasts.push(t), fmtDate: (d) => 'Sep 20',
      navigator: {}, window: { open: (u) => { opened = u; }, prompt() {} },
      document: { getElementById: (id) => id === 'sow-overlay' ? (appended ? overlay : null) : id === 'sow-send' ? { disabled: false, textContent: '' } : null, createElement: () => ({ style: {}, set innerHTML(v) { appended = v; } }), body: { appendChild() {} } },
      sbcFetch: async (url, o) => { posted = { url, body: JSON.parse(o.body), key: 'x-sbc-key' in (o.headers || {}) }; return { ok: true, json: async () => ({ success: true, sentTo: ['manager@building.com'], at: '2026-09-20T22:40:00Z' }) }; },
    };
    vm.createContext(ctx);
    vm.runInContext(ext('scopeLinkUrl') + '\n' + ext('copyScopeLink') + '\n' + ext('scopeLinkCopy') + '\n' + ext('sendScopeLink'), ctx);
    vm.runInContext('copyScopeLink()', ctx);
    ok('THE BUTTON OPENS A WINDOW, not just a toast', appended !== null && /Scope of Work — no prices/.test(appended));
    ok('...with Open, Copy link and Send scope of work', /onclick="window\.open\(scopeLinkUrl\(\), '_blank'\)">👁 Open/.test(appended) && /onclick="scopeLinkCopy\(\)">📋 Copy link/.test(appended) && /id="sow-send" onclick="sendScopeLink\(document\.getElementById\('sow-to'\)\.value\)">✉️ Send scope of work/.test(appended));
    ok('...the address box starts with the customer\'s email, and he can type any other', /<input type="text" id="sow-to" value="jan@example.com"/.test(appended) && /management@building\.com/.test(appended));
    ok('...and says what it shows: the scope as it is now (not sent yet)', /Shows the scope as it is now\./.test(appended));
    ok('the link is the no-price page', vm.runInContext('scopeLinkUrl()', ctx) === 'https://www.sanibuildingcorp.com/quote.html?ref=SBC-SOW&sow=1');
    await vm.runInContext('sendScopeLink("manager@building.com")', ctx);
    ok('SEND POSTS THE TYPED ADDRESS TO send-scope-link with the dashboard key', posted && /send-scope-link/.test(posted.url) && posted.body.ref === 'SBC-SOW' && posted.body.to === 'manager@building.com' && posted.key === false, JSON.stringify(posted));
    ok('...closes the window, notes the send on the open record, and says who got it', removed === 1 && ctx.currentRecord.scopeLinkSends.length === 1 && /sent to manager@building\.com/.test(toasts[toasts.length - 1]) && /no prices/.test(toasts[toasts.length - 1]), toasts[toasts.length - 1]);
    await vm.runInContext('sendScopeLink("")', ctx);
    ok('an empty address is refused before any call', /Enter an email address/.test(toasts[toasts.length - 1]));
    ctx.sbcFetch = async () => ({ ok: false, json: async () => ({ error: 'Not an email address: nope' }) });
    await vm.runInContext('sendScopeLink("nope")', ctx);
    ok('a refused send shows the server\'s reason and keeps the window open', /Send failed: Not an email address: nope/.test(toasts[toasts.length - 1]) && removed === 1);
    ok('the SCOPE OF WORK LINK button still opens it', /onclick="copyScopeLink\(\)"[^>]*>📋 SCOPE OF WORK LINK \(NO PRICES\)/.test(DASH));
  }

  const blocks = DASH.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
  let broken = null;
  blocks.forEach(function (bl, i) { try { new vm.Script(bl.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; } });
  ok('all ' + blocks.length + ' script blocks parse', broken === null, broken || '');
  ok('every function file has a legal Netlify name', fs.readdirSync(path.join(ROOT, 'netlify/functions')).every(f => /^[A-Za-z0-9_-]+(\.m?js)?$/.test(f) || f === 'lib'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
