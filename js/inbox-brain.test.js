/* inbox-brain.test.js — run: node js/inbox-brain.test.js
 *
 *   "I have a connected ChatGPT in my gmail and can read all emails, can we
 *    connect my AI to the my gmail too same as i have connected ChatGPT?
 *    Build all three, it reads info@. Let's my AI read all emails direct
 *    from gmail, then AI can pull out any necessary information need for
 *    better estimate or update in estimate after customer request by email"
 *
 * Three things. (1) inbox-sync keeps the assistant's own copy of EVERY
 * inbound email, matched to an estimate by ref, address or the sender's
 * name. (2) The assistant reads that inbox on every question - the newest
 * lines, and the full text of the emails about the open job and the ones
 * matching what he asked - and can add a fact from an email to an estimate
 * (describe). (3) A morning "Customer action list" and an alert when a
 * customer's email needs him now.
 *
 * IMAP, Blobs, Supabase, Claude and Resend are all stubbed; the real code
 * runs against them.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const clone = (o) => JSON.parse(JSON.stringify(o));
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
Module._resolveFilename = function (request, ...rest) { if (['@netlify/blobs', 'imapflow', 'mailparser'].indexOf(request) !== -1) return request; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (opts) => {
  const m = STORES[opts.name] || (STORES[opts.name] = new Map());
  return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); }, setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); }, list: async () => ({ blobs: Array.from(m.keys()).map((key) => ({ key })) }) };
} } };
/* the mailbox */
let MAILS = [];
const downloaded = [];
require.cache['imapflow'] = { id: 'imapflow', filename: 'imapflow', loaded: true, exports: { ImapFlow: function () {
  return {
    connect: async () => {}, logout: async () => {},
    getMailboxLock: async () => ({ release() {} }),
    search: async () => MAILS.map((_, i) => i + 1),
    fetchOne: async (uid) => { const m = MAILS[uid - 1]; return m ? { envelope: { from: [{ name: m.name, address: m.from }], subject: m.subject, messageId: m.id, date: m.at } } : null; },
    download: async (uid) => { downloaded.push(MAILS[uid - 1].id); return { content: (async function* () { yield Buffer.from(MAILS[uid - 1].body); })() }; },
  };
} } };
require.cache['mailparser'] = { id: 'mailparser', filename: 'mailparser', loaded: true, exports: { simpleParser: async (buf) => ({ text: buf.toString('utf8') }) } };
/* the network */
const https = require('https');
const sent = { resend: [], claude: [] };
let claudeReply = () => 'ok';
const sse = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
https.request = function (opts, cb) {
  const chunks = [];
  const res = { statusCode: 200, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  return { on() { return this; }, write(d) { chunks.push(d); }, destroy() {}, setTimeout() {},
    end() {
      const body = JSON.parse(chunks.join(''));
      setImmediate(() => {
        cb(res);
        if (opts.hostname === 'api.resend.com') { sent.resend.push(body); res._data(Buffer.from('{"id":"m"}')); }
        else {
          sent.claude.push(body);
          const text = claudeReply(body);
          if (body.stream) res._data(Buffer.from(sse({ type: 'message_start' }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text } }) + sse({ type: 'message_stop' })));
          else res._data(Buffer.from(JSON.stringify({ content: [{ type: 'text', text }] })));
        }
        if (res._end) res._end();
      });
    } };
};
const fetched = [];
let ESTIMATES = [];
global.fetch = async (url, o) => {
  const u = String(url); fetched.push({ url: u, o });
  if (/lead_messages\?select=lead_email/.test(u)) return { ok: true, status: 200, json: async () => [{ lead_email: 'known@example.com' }] };
  if (/lead_messages/.test(u) && o && o.method === 'POST') return { ok: true, status: 201, text: async () => '' };
  if (/lead_messages/.test(u)) return { ok: true, status: 200, json: async () => [] };
  if (/bookings/.test(u)) return { ok: true, status: 200, json: async () => [] };
  if (/contact-leads/.test(u)) return { ok: true, status: 200, json: async () => ({ leads: [] }) };
  if (/list-estimates/.test(u)) return { ok: true, status: 200, json: async () => ({ estimates: ESTIMATES }) };
  if (/inbox-digest-background/.test(u)) return { ok: false, status: 202, text: async () => '' };
  return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
};
process.env.DASHBOARD_KEY = 'k'; process.env.ANTHROPIC_API_KEY = 'sk'; process.env.RESEND_API_KEY = 'rk';
process.env.SUPABASE_URL = 'https://sb.example'; process.env.SUPABASE_SECRET_KEY = 'ss';
process.env.GMAIL_USER = 'info@sanibuildingcorp.com'; process.env.GMAIL_APP_PASSWORD = 'app-pass';
process.env.URL = 'https://www.sanibuildingcorp.com';

const IS = require(path.join(ROOT, 'netlify/functions/lib/inbox-store.js'));
const sync = require(path.join(ROOT, 'netlify/functions/inbox-sync.js'));
const assistant = require(path.join(ROOT, 'netlify/functions/assistant.js'));
const digest = require(path.join(ROOT, 'netlify/functions/inbox-digest-background.js'));
const sched = require(path.join(ROOT, 'netlify/functions/inbox-digest-scheduled.js'));
const post = async (fn, body, headers) => { const r = await fn.handler({ httpMethod: 'POST', headers: headers || { 'x-sbc-key': 'k' }, body: JSON.stringify(body) }); let j = null; try { j = JSON.parse(r.body); } catch (e) { j = r.body; } return { code: r.statusCode, body: j }; };

const CUSTOMERS = [
  { ref: 'SBC-260915-RAFA', status: 'sent', sentAt: '2026-09-15T10:00:00Z', updatedAt: '2026-09-18T00:00:00Z', name: 'Rafael Mendez', email: 'known@example.com' },
  { ref: 'SBC-260917-JANK', status: 'new', submittedAt: '2026-09-17T00:00:00Z', name: 'Jan Kowalski', email: 'jan@example.com' },
  { ref: 'SBC-260801-OLDD', status: 'completed', updatedAt: '2026-08-01T00:00:00Z', name: 'Rafael Mendez', email: 'known@example.com' },
];

(async () => {
  console.log('\n1. the store: keys, kinds, matching by ref, address and name\n');
  {
    ok('a message id becomes a safe blob key, the same every time', /^m-[0-9a-f]{32}$/.test(IS.keyFor('<abc@mail.gmail.com>')) && IS.keyFor('<abc@mail.gmail.com>') === IS.keyFor('<abc@mail.gmail.com>') && IS.keyFor('a') !== IS.keyFor('b'));
    ok('no-reply, notifications and the platforms we use are "notification"; an unknown human is "other"; a match is "customer"', IS.kindOf('no-reply@doordash.com', false) === 'notification' && IS.kindOf('notifications@github.com', false) === 'notification' && IS.kindOf('manager@building.com', false) === 'other' && IS.kindOf('manager@building.com', true) === 'customer');
    ok('A REF IN THE TEXT WINS', IS.matchEstimate({ from: 'x@y.com', subject: 'Re: SBC-260917-JANK — Molding', text: 'hi' }, CUSTOMERS).by === 'ref' && IS.matchEstimate({ from: 'x@y.com', subject: 'Re: SBC-260917-JANK — Molding', text: 'hi' }, CUSTOMERS).ref === 'SBC-260917-JANK');
    ok('...then the sender\'s address, picking the open estimate', IS.matchEstimate({ from: 'Known@Example.com', name: 'someone', subject: 'hi', text: 'any update?' }, CUSTOMERS).ref === 'SBC-260915-RAFA' && IS.matchEstimate({ from: 'known@example.com' }, CUSTOMERS).by === 'email');
    ok('...THEN THE SENDER\'S NAME - Rafael writing from a new address is still Rafael', IS.matchEstimate({ from: 'rafa.m@newmail.com', name: 'Rafael Mendez', subject: 'update', text: 'x' }, CUSTOMERS).ref === 'SBC-260915-RAFA' && IS.matchEstimate({ from: 'rafa.m@newmail.com', name: 'Rafael Mendez' }, CUSTOMERS).by === 'name');
    ok('"Mendez, Rafael" and "rafael mendez jr" are him too', IS.sameName(IS.nameKey('Mendez, Rafael'), IS.nameKey('Rafael Mendez')) && IS.sameName(IS.nameKey('rafael mendez jr'), IS.nameKey('Rafael Mendez')));
    ok('a one-word name matches nobody - "Jan" is anyone', IS.matchEstimate({ from: 'j@other.com', name: 'Jan' }, CUSTOMERS).ref === '' && !IS.sameName('jan', 'jan kowalski'));
    ok('a stranger matches nothing', IS.matchEstimate({ from: 'stranger@x.com', name: 'Pat Smith', subject: 'quote?', text: 'hello' }, CUSTOMERS).ref === '');
    const idx = { updatedAt: '', items: [] };
    await IS.saveMail({ id: '<m1@x>', from: 'Known@Example.com', name: 'Rafael Mendez', subject: 'Corrected estimate?', text: 'Hi Zurabi, when will I get the corrected estimate with the $500 change?', at: '2026-09-19T22:53:00Z' }, { ref: 'SBC-260915-RAFA', by: 'email' }, true, idx);
    await IS.saveMail({ id: '<m2@x>', from: 'no-reply@doordash.com', name: 'DoorDash', subject: 'A nearby match for you', text: '', at: '2026-09-20T01:00:00Z' }, { ref: '', by: '' }, false, idx);
    ok('saveMail writes the record and keeps the index in memory, newest first, marked dirty', idx.items.length === 2 && idx.items[0].id === '<m2@x>' && idx.items[1].kind === 'customer' && idx.items[0].kind === 'notification' && idx.dirty === true && STORES.inbox.has(idx.items[1].key));
    await IS.saveIndex(idx);
    const back = await IS.loadIndex();
    ok('saveIndex writes it once; loadIndex reads it back; knownIds lists what is stored', back.items.length === 2 && IS.knownIds(back).has('<m1@x>') && idx.dirty === false);
    ok('indexLines leaves notifications out and says what each line is about', IS.indexLines(back, 25).length === 1 && /2026-09-19 \| Rafael Mendez <known@example\.com> \| Corrected estimate\? \| about SBC-260915-RAFA \| Hi Zurabi/.test(IS.indexLines(back, 25)[0]), IS.indexLines(back, 25)[0]);
    ok('pickRelevant finds the email a question is about, by name', IS.pickRelevant(back, 'what did Rafael write?', '', 3).length === 1 && IS.pickRelevant(back, 'anything from the plumber?', '', 3).length === 0);
    const full = await IS.loadMail(back.items[1].key);
    ok('loadMail gives the full text; a bad key gives nothing', /corrected estimate with the \$500 change/.test(full.text) && (await IS.loadMail('../estimates/SBC-1')) === null);
    STORES.inbox.clear();
  }

  console.log('\n2. inbox-sync files EVERY inbound email for the assistant, matched three ways\n');
  {
    ESTIMATES = CUSTOMERS.map((c) => ({ ref: c.ref, status: c.status, sentAt: c.sentAt, updatedAt: c.updatedAt, submittedAt: c.submittedAt, customer: { name: c.name, email: c.email }, estimate: { projectTitle: c.ref + ' job', customerTotal: 7500 } }));
    STORES.estimates = new Map([['SBC-260915-RAFA', JSON.stringify({ ref: 'SBC-260915-RAFA', status: 'sent', customer: { name: 'Rafael Mendez', email: 'known@example.com' }, thread: [] })]]);
    MAILS = [
      { id: '<k1@g>', from: 'known@example.com', name: 'Rafael Mendez', subject: 'Re: any update?', body: 'Still waiting for the corrected estimate you promised.', at: '2026-09-19T22:53:00Z' },
      { id: '<n1@g>', from: 'rafa.m@newmail.com', name: 'Rafael Mendez', subject: 'from my work email', body: 'Also please add the hallway closet, 3 ft wide.', at: '2026-09-19T23:10:00Z' },
      { id: '<s1@g>', from: 'manager@shorepkwy.com', name: 'Dana Ortiz', subject: 'COI for 3855 Shore Pkwy', body: 'We need the certificate of insurance before work starts.', at: '2026-09-20T00:05:00Z' },
      { id: '<x1@g>', from: 'no-reply@doordash.com', name: 'DoorDash', subject: 'A nearby match for you', body: 'Order yours and enjoy.', at: '2026-09-20T01:00:00Z' },
      { id: '<o1@g>', from: 'estimates@sanibuildingcorp.com', name: 'Sani', subject: 'our own mail', body: 'x', at: '2026-09-20T01:10:00Z' },
    ];
    fetched.length = 0; downloaded.length = 0;
    const r = await post(sync, {}, {});
    const b = r.body;
    ok('the run reports the assistant\'s inbox beside the CRM counters', r.code === 200 && b.inbox && b.inbox.stored === 4 && b.inbox.indexed === 4, JSON.stringify(b));
    const idx = await IS.loadIndex();
    const by = {}; idx.items.forEach((x) => { by[x.id] = x; });
    ok('THE KNOWN CUSTOMER\'S MAIL: in the CRM, on the thread, and in the inbox as "customer" about his job', b.newMessages === 1 && b.bridgedToEstimateThreads.length === 1 && by['<k1@g>'].kind === 'customer' && by['<k1@g>'].ref === 'SBC-260915-RAFA' && by['<k1@g>'].by === 'email');
    ok('THE SAME CUSTOMER FROM A NEW ADDRESS: matched by NAME for the assistant, NOT written to the CRM or the thread (a name is not proof)', by['<n1@g>'].kind === 'customer' && by['<n1@g>'].ref === 'SBC-260915-RAFA' && by['<n1@g>'].by === 'name' && b.skippedNotACustomer === 2 && fetched.filter((f) => /lead_messages/.test(f.url) && f.o && f.o.method === 'POST').length === 1 && JSON.parse(STORES.estimates.get('SBC-260915-RAFA')).thread.length === 1);
    ok('THE BUILDING MANAGER: stored as "other" with her words, so the assistant can say she wrote', by['<s1@g>'].kind === 'other' && /certificate of insurance/.test(by['<s1@g>'].snippet) && downloaded.indexOf('<s1@g>') !== -1);
    ok('a no-reply notification is indexed by subject only - never downloaded', by['<x1@g>'].kind === 'notification' && by['<x1@g>'].snippet === '' && downloaded.indexOf('<x1@g>') === -1);
    ok('our own outgoing mail is skipped, as before (counted with the system senders)', !by['<o1@g>'] && b.skippedOwnOrSystem === 2);
    const alert = fetched.find((f) => /inbox-digest-background/.test(f.url));
    const alertIds = alert ? JSON.parse(alert.o.body).ids.slice().sort() : [];
    ok('NEW CUSTOMER MAIL IS HANDED TO THE ALERT JOB, with the key, both of Rafael\'s and not the manager\'s or DoorDash\'s', alert && alert.o.headers['x-sbc-key'] === 'k' && JSON.parse(alert.o.body).mode === 'alert' && alertIds.join('|') === '<k1@g>|<n1@g>' && b.inbox.alertsQueued === 2, alert && alert.o.body);
    fetched.length = 0; downloaded.length = 0;
    const r2 = await post(sync, {}, {});
    ok('THE NEXT RUN DOWNLOADS NOTHING AGAIN and queues no alert - the index remembers', r2.body.inbox.stored === 0 && downloaded.filter((id) => id !== '<k1@g>').length === 0 && !fetched.some((f) => /inbox-digest-background/.test(f.url)), JSON.stringify(r2.body.inbox));
    const src = fs.readFileSync(path.join(ROOT, 'netlify/functions/inbox-sync.js'), 'utf8');
    ok('a dozen new downloads per quick run at most - the full run catches up', /const NEW_DOWNLOADS_PER_RUN = 12;/.test(src) && /const QUICK = \{[^}]*downloads: NEW_DOWNLOADS_PER_RUN/.test(src) && /if \(inboxDownloads >= L\.downloads\) continue;/.test(src));
    ok('the quick run writes the index once at the end; only the full run checkpoints', /const QUICK = \{[^}]*saveEvery: 0 \}/.test(src) && /if \(!L\.saveEvery \|\| !idx/.test(src) && /if \(idx && idx\.dirty\)/.test(src));
  }

  console.log('\n3. the assistant reads the inbox, whole, and can put an email\'s fact into an estimate\n');
  {
    STORES.estimates.set('SBC-260915-RAFA', JSON.stringify({ ref: 'SBC-260915-RAFA', status: 'sent', customer: { name: 'Rafael Mendez', email: 'known@example.com' }, request: { service: 'Carpentry', description: 'closets' }, estimate: { projectTitle: 'Rafael job' }, thread: [] }));
    await STORES.inbox.set('digest-latest', JSON.stringify({ at: '2026-09-20T11:30:00Z', text: '1. Rafael Mendez — waiting for the corrected estimate.' }));
    sent.claude.length = 0; claudeReply = () => 'Rafael asked for the corrected estimate.';
    let r = await post(assistant, { ref: 'SBC-260915-RAFA', messages: [{ role: 'user', text: 'what did Rafael write me?' }] });
    let sys = sent.claude[0].system;
    ok('THE INBOX IS IN THE PROMPT: every human email as one line, newest first, with who, subject and estimate', /THE INBOX \(info@ and every Gmail he connected on the dashboard, every inbound email/.test(sys) && /Dana Ortiz <manager@shorepkwy\.com> \| COI for 3855 Shore Pkwy \| not a customer we know/.test(sys) && /Rafael Mendez <rafa\.m@newmail\.com> \| from my work email \| about SBC-260915-RAFA/.test(sys) && sys.indexOf('DoorDash') === -1, sys.slice(sys.indexOf('THE INBOX'), sys.indexOf('THE INBOX') + 500));
    ok('...WITH THE FULL TEXT of the emails about the open job and the ones matching his question', /FULL TEXT OF THE EMAILS THAT MATTER HERE/.test(sys) && /Still waiting for the corrected estimate you promised\./.test(sys) && /Also please add the hallway closet, 3 ft wide\./.test(sys));
    ok('...and this morning\'s action list', /THIS MORNING'S ACTION LIST \(2026-09-20\):\n1\. Rafael Mendez/.test(sys));
    ok('it is told what the inbox is, to name who wrote and when, and to say which email it would need opened rather than guess', /THE INBOX \(below\) is his whole info@ mailbox/.test(sys) && /say which email you would need opened rather than guessing/.test(sys) && /describe action/.test(sys));
    ok('the answer comes back as usual', r.code === 200 && r.body.reply === 'Rafael asked for the corrected estimate.');
    sent.claude.length = 0;
    await post(assistant, { messages: [{ role: 'user', text: 'did the building manager email about the COI?' }] });
    sys = sent.claude[0].system;
    const fullPart = sys.slice(sys.indexOf('FULL TEXT OF THE EMAILS THAT MATTER HERE'));
    ok('WITH NO JOB OPEN the inbox is still there, and the manager\'s full email is pulled in because he asked about the COI - Rafael\'s is not', /THE INBOX/.test(sys) && /We need the certificate of insurance before work starts\./.test(fullPart) && fullPart.indexOf('Still waiting for the corrected') === -1, fullPart.slice(0, 300));
    sent.claude.length = 0; claudeReply = () => 'Adding the hallway closet to the estimate.\nACTION: {"type":"describe","ref":"SBC-260915-RAFA","text":"Customer also wants the hallway closet done, 3 ft wide (email of Sep 19)."}';
    r = await post(assistant, { ref: 'SBC-260915-RAFA', messages: [{ role: 'user', text: 'put what he asked in his email into the estimate' }] });
    ok('THE DESCRIBE ACTION comes back as data, off the text, with the ref and the fact', r.body.reply === 'Adding the hallway closet to the estimate.' && r.body.actions.length === 1 && r.body.actions[0].type === 'describe' && r.body.actions[0].ref === 'SBC-260915-RAFA' && /hallway closet/.test(r.body.actions[0].text), JSON.stringify(r.body));
    ok('the prompt explains describe: a fact from an email into the customer description, confirmed by him, then Re-read the job', /ADD A FACT FROM AN EMAIL TO AN ESTIMATE/.test(sent.claude[0].system) && /he presses Re-read the job/.test(sent.claude[0].system));
    STORES.inbox.delete('index');
    sent.claude.length = 0; claudeReply = () => 'ok';
    await post(assistant, { messages: [{ role: 'user', text: 'hi' }] });
    ok('an empty inbox store says so instead of breaking the prompt', /THE INBOX \(info@, read every 15 minutes\): nothing stored yet\./.test(sent.claude[0].system));
  }

  console.log('\n4. the morning list and the alerts\n');
  {
    /* Rebuild the inbox after the delete above. */
    const idx = { updatedAt: '', items: [] };
    await IS.saveMail({ id: '<k1@g>', from: 'known@example.com', name: 'Rafael Mendez', subject: 'Re: any update?', text: 'Still waiting for the corrected estimate you promised.', at: '2026-09-19T22:53:00Z' }, { ref: 'SBC-260915-RAFA', by: 'email' }, true, idx);
    await IS.saveMail({ id: '<s1@g>', from: 'manager@shorepkwy.com', name: 'Dana Ortiz', subject: 'COI for 3855 Shore Pkwy', text: 'We need the certificate of insurance before work starts.', at: '2026-09-20T00:05:00Z' }, { ref: '', by: '' }, false, idx);
    await IS.saveMail({ id: '<t1@g>', from: 'jan@example.com', name: 'Jan Kowalski', subject: 'thanks', text: 'Got it, thank you!', at: '2026-09-20T02:00:00Z' }, { ref: 'SBC-260917-JANK', by: 'email' }, true, idx);
    await IS.saveIndex(idx);
    ESTIMATES = ESTIMATES.map((e) => Object.assign(e, { needsReply: e.ref === 'SBC-260915-RAFA' }));
    sent.resend.length = 0; sent.claude.length = 0;
    claudeReply = () => 'Customer action list — Sunday, September 20\n1. Rafael Mendez — SBC-260915-RAFA, $7,500. Followed up again at 6:53 PM asking for the promised corrected estimate. Send it today.\n2. Dana Ortiz (building manager, 3855 Shore Pkwy) — needs the certificate of insurance before work starts. Send the COI.\n2 items.';
    let r = await post(digest, { mode: 'daily', now: '2026-09-20T11:30:00Z' });
    ok('THE DAILY LIST IS WRITTEN FROM THE LAST DAY\'S EMAILS AND THE OPEN ESTIMATES', r.code === 200 && r.body.sent === true && r.body.emails === 3 && r.body.waiting === 1, JSON.stringify(r.body));
    const u = sent.claude[0].messages[0].content;
    ok('...Claude was given the emails with their words, who they are about, and the estimates with who is waiting', /Rafael Mendez <known@example\.com> \| Re: any update\? \| about SBC-260915-RAFA\n   Still waiting for the corrected estimate/.test(u) && /Dana Ortiz[^\n]*not tied to an estimate/.test(u) && /SBC-260915-RAFA \| Rafael Mendez \| SBC-260915-RAFA job \| sent \| \$7500 \| sent 2026-09-15 \| CUSTOMER WAITING FOR A REPLY/.test(u) && sys_has_no_completed(u), u.slice(0, 600));
    function sys_has_no_completed(t) { return t.indexOf('SBC-260801-OLDD') === -1; }
    ok('...told to list only what needs him, most important first, and to say exactly what a change request asks', /Customer action list/.test(sent.claude[0].system) && /say exactly what was asked so he can update the estimate/.test(sent.claude[0].system) && !/licensed\b(?! ')/.test(sent.claude[0].system.replace("Never use the word 'licensed'", '')));
    const m = sent.resend[0];
    ok('IT IS EMAILED TO HIM: subject "Customer action list — Sunday, September 20", the list in it, a dashboard link', m && m.to[0] === 'info@sanibuildingcorp.com' && m.subject === 'Customer action list — Sunday, September 20' && /Rafael Mendez — SBC-260915-RAFA/.test(m.text) && /dashboard\.html/.test(m.text) && /Send the COI/.test(m.html), m && m.subject);
    const d = JSON.parse(STORES.inbox.get('digest-latest'));
    ok('...and kept as digest-latest for the assistant', d.sent === true && /Rafael Mendez/.test(d.text) && d.at.indexOf('2026-09-20T11:30:00') === 0);
    sent.resend.length = 0;
    ESTIMATES = ESTIMATES.map((e) => Object.assign(e, { needsReply: false }));
    r = await post(digest, { mode: 'daily', now: '2026-09-25T11:30:00Z' });
    ok('A QUIET DAY SENDS NOTHING (no email in the last day, nobody waiting) and says so in the record', r.body.sent === false && sent.resend.length === 0 && /Nothing needed you on Friday, September 25/.test(JSON.parse(STORES.inbox.get('digest-latest')).text), JSON.stringify(r.body));

    sent.resend.length = 0; sent.claude.length = 0;
    claudeReply = (body) => /Still waiting/.test(body.messages[0].content)
      ? '{"alert": true, "headline": "Rafael is waiting for the corrected estimate", "summary": "Rafael followed up again asking for the corrected estimate you promised. Send it today.", "change": ""}'
      : '{"alert": false, "headline": "", "summary": "", "change": ""}';
    r = await post(digest, { mode: 'alert', ids: ['<k1@g>', '<t1@g>'] });
    ok('AN ALERT GOES OUT FOR THE FOLLOW-UP, NOT FOR THE THANK-YOU', r.code === 200 && r.body.alerts === 1 && sent.resend.length === 1 && sent.claude.length === 2, JSON.stringify(r.body));
    const a = sent.resend[0];
    ok('...to him, "⚡ <headline>", what they asked and what to do, a link that opens that estimate', a.to[0] === 'info@sanibuildingcorp.com' && a.subject === '⚡ Rafael is waiting for the corrected estimate' && /Send it today/.test(a.text) && /dashboard\.html\?ref=SBC-260915-RAFA/.test(a.html) && /Estimate: SBC-260915-RAFA/.test(a.text), a.subject);
    const judged = sent.claude.find((c) => /Still waiting for the corrected estimate/.test(c.messages[0].content));
    ok('...Claude saw the email and the estimate it is about, and was asked for a yes/no with a headline', !!judged && /THE ESTIMATE IT IS ABOUT: SBC-260915-RAFA \| Rafael Mendez/.test(judged.messages[0].content) && /Answer ONLY with JSON/.test(judged.system));
    const after = await IS.loadIndex();
    ok('the index remembers which mails were judged, so a re-run alerts nobody twice', after.items.find((x) => x.id === '<k1@g>').alerted === 'sent' && after.items.find((x) => x.id === '<t1@g>').alerted === 'no');
    sent.resend.length = 0; sent.claude.length = 0;
    r = await post(digest, { mode: 'alert', ids: ['<k1@g>', '<t1@g>'] });
    ok('...a re-run with the same ids does nothing', r.body.alerts === 0 && sent.claude.length === 0 && sent.resend.length === 0);
    ok('an unknown mode is refused; no key -> 401', (await post(digest, { mode: 'x' })).code === 400 && (await post(digest, { mode: 'daily' }, {})).code === 401);
    ok('it is in the endpoint-auth gated list, with update-customer', /\["inbox-digest-background", "POST"/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/lib/endpoint-auth.test.js'), 'utf8')) && /\["update-customer", "POST"/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/lib/endpoint-auth.test.js'), 'utf8')));

    fetched.length = 0;
    const s = await sched.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ next_run: '2026-09-21T11:30:00Z' }) });
    const call = fetched.find((f) => /inbox-digest-background/.test(f.url));
    ok('THE SCHEDULED CALLER POSTS mode daily TO THE BACKGROUND FUNCTION ON THIS SITE, with the key', s.statusCode === 200 && call && call.url === 'https://www.sanibuildingcorp.com/.netlify/functions/inbox-digest-background' && call.o.headers['x-sbc-key'] === 'k' && JSON.parse(call.o.body).mode === 'daily', call && call.url);
    ok('...refuses anyone but the scheduler', (await sched.handler({ httpMethod: 'POST', headers: {}, body: '{}' })).statusCode === 401);
    ok('...and runs every morning, 11:30 UTC (7:30 am New York in summer)', /\[functions\."inbox-digest-scheduled"\]\s*\n\s*schedule = "30 11 \* \* \*"/.test(fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8')));
    ok('list-estimates now says who is waiting for a reply (the list and the alerts read it)', /needsReply: thread\.needsReply\(e\),/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/list-estimates.js'), 'utf8')));
  }

  console.log('\n5. the dashboard: describe asks him, then adds the fact to the description; alerts open the estimate\n');
  {
    const calls = { fetched: [], toasts: [], confirms: [], rendered: 0 };
    const ctx = {
      String, JSON, Array, Object, Number, Error, RegExp, Math, Date, console, encodeURIComponent,
      estimates: [{ ref: 'SBC-260915-RAFA', status: 'sent', customer: { name: 'Rafael Mendez', email: 'known@example.com', phone: '718', address: '3855 Shore Pkwy' } }],
      currentRecord: { ref: 'SBC-260915-RAFA', customer: { name: 'Rafael Mendez', email: 'known@example.com', phone: '718', address: '3855 Shore Pkwy' }, request: { description: 'Two closets in the bedroom.' } },
      visits: [], activeTab: 'all', renderTabs() {}, renderList() {}, openEdit() {}, closeEdit() {}, aiClose() {}, aiStartSearch() {}, AI_LOG: [], aiRender() {},
      renderEdit: () => { calls.rendered++; }, toast: (t) => calls.toasts.push(t), confirm: (t) => { calls.confirms.push(t); return ctx.say !== false; },
      sbcFetch: async (url, o) => { calls.fetched.push({ url, body: JSON.parse(o.body) }); return { ok: true, json: async () => ({ success: true, description: JSON.parse(o.body).description }) }; },
      fetch: async () => ({ ok: true, json: async () => ({}) }),
      document: { getElementById: () => null },
    };
    vm.createContext(ctx);
    vm.runInContext(ext('aiExec'), ctx);
    const said = await vm.runInContext('aiExec({ type: "describe", ref: "SBC-260915-RAFA", text: "Customer also wants the hallway closet done, 3 ft wide (email of Sep 19)." })', ctx);
    ok('DESCRIBE ASKS HIM FIRST, showing the fact and where it goes', calls.confirms.length === 1 && /Add this to the customer description of SBC-260915-RAFA \(Rafael Mendez\)\?/.test(calls.confirms[0]) && /hallway closet/.test(calls.confirms[0]) && /Re-read the job/.test(calls.confirms[0]), calls.confirms[0]);
    const f = calls.fetched[0];
    ok('...then saves through update-customer WITH THE KEY, the fact appended to the description, dated, the customer untouched', f && /update-customer/.test(f.url) && f.body.ref === 'SBC-260915-RAFA' && f.body.customer.email === 'known@example.com' && f.body.customer.address === '3855 Shore Pkwy' && /^Two closets in the bedroom\.\n\n\[From email, [A-Z][a-z]{2} \d{1,2}\] Customer also wants the hallway closet/.test(f.body.description), f && f.body.description);
    ok('...updates the open record, redraws it, and says what to press next', /hallway closet/.test(ctx.currentRecord.request.description) && calls.rendered === 1 && /Re-read the job from scratch/.test(said), said);
    ctx.say = false;
    const no = await vm.runInContext('aiExec({ type: "describe", ref: "SBC-260915-RAFA", text: "x" })', ctx);
    ok('IF HE SAYS NO, NOTHING IS SAVED', calls.fetched.length === 1 && /not added/.test(no));
    ctx.say = true;
    ok('a ref not in the list is refused in words', /don't see SBC-NOPE/.test(await vm.runInContext('aiExec({ type: "describe", ref: "SBC-NOPE", text: "x" })', ctx)) && calls.fetched.length === 1);
    ok('the Edit Customer panel saves with the key too (update-customer is gated now)', /sbcFetch\('\/\.netlify\/functions\/update-customer'/.test(DASH) && !/fetch\('\/\.netlify\/functions\/update-customer'/.test(DASH));
    ok('?ref=SBC-… IN THE DASHBOARD URL OPENS THAT ESTIMATE once the list is in - the alert links there', /\/\[\?&\]ref=\(SBC-\[A-Za-z0-9-\]\+\)\/\.exec\(location\.search/.test(DASH) && /openEdit\(want\)/.test(DASH));
    const blocks = DASH.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    let broken = null;
    blocks.forEach(function (bl, i) { try { new vm.Script(bl.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; } });
    ok('all ' + blocks.length + ' script blocks parse', broken === null, broken || '');
    ok('every function file has a legal Netlify name', fs.readdirSync(path.join(ROOT, 'netlify/functions')).every((f) => /^[A-Za-z0-9_-]+(\.m?js)?$/.test(f) || f === 'lib'));
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
