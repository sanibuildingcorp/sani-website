/* job-emails-check.test.js — run: node js/job-emails-check.test.js
 *
 * Part 3: the generator and the estimator chat read the customer's own
 * emails about the job, in full (lib/job-emails.js).
 * Part 4: "Check before sending" - the estimator reads her emails and the
 * plans against every line and says what to fix.
 *
 * 409 Suydam St is the case: Yaron (the GC) wrote "409 Suydam St - Bid
 * Request" from an address not on the estimate; Crismar replied with the
 * basis for the proposal; the description was a rewrite of both.
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
let calls = [], replies = [], refuseDocs = false;
const sse = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
https.request = function (opts, cb) {
  let body = null;
  const res = { statusCode: 200, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  return { on() { return this; }, write(b) { body = JSON.parse(b); calls.push(body); }, destroy() {}, end() { setImmediate(() => {
    const hasDoc = JSON.stringify(body.messages || []).indexOf('"type":"document"') > -1;
    if (refuseDocs && hasDoc) { res.statusCode = 400; cb(res); res._data(Buffer.from(JSON.stringify({ type: 'error', error: { message: 'PDF has too many pages' } }))); if (res._end) res._end(); return; }
    const text = replies.length ? replies.shift() : 'ok'; cb(res); res._data(Buffer.from(sse({ type: 'message_start' }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text } }) + sse({ type: 'message_stop' }))); if (res._end) res._end(); }); } };
};
process.env.DASHBOARD_KEY = 'k'; process.env.ANTHROPIC_API_KEY = 'sk';
const JE = require(path.join(ROOT, 'netlify/functions/lib/job-emails.js'));
const bg = require(path.join(ROOT, 'netlify/functions/assistant-background.js'));
const A = fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant.js'), 'utf8');
const GEN = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'), 'utf8');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');

const REC = { ref: 'SBC-260925-Y373', status: 'drafted', customer: { name: 'Crismar Hibirmas', email: 'zasanashvili@gmail.com', address: '409 Suydam street, Brooklyn' },
  request: { service: 'Bathroom', description: 'Prepare an estimate for bathroom finishing work at 409 Suydam Street.', photos: [{ name: 'Approved Plans 409 Suydam St.pdf', data: 'https://x.supabase.co/storage/v1/object/public/estimate-photos/SBC/plans.pdf' }] },
  estimate: { markupPct: 25, labor: [{ section: 'Bathroom', item: 'Set floor tile', qty: 48, unit: 'hrs', rate: 62.4 }], materials: [] } };
const INDEX = { items: [
  { id: 'c', key: 'm-cccccccccccccccccccccccccccccccc', at: '2026-09-24T15:31:00Z', from: 'crismar@badichi.com', name: 'Crismar Hibirmas', subject: 'Re: 409 Suydam St - Construction Bid Request', snippet: 'Please proceed with the following basis', ref: 'SBC-260925-Y373', by: 'name', kind: 'customer' },
  { id: 'n', key: 'm-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', at: '2026-09-24T12:00:00Z', from: 'no-reply@homedepot.com', name: 'Home Depot', subject: 'Your order at 409 Suydam', snippet: '', ref: '', by: '', kind: 'notification' },
  { id: 'o', key: 'm-dddddddddddddddddddddddddddddddd', at: '2026-09-24T11:30:00Z', from: 'someone@x.com', name: 'Someone Else', subject: 'Kitchen cabinets quote', snippet: 'at 12 Main St', ref: '', by: '', kind: 'other' },
  { id: 'y', key: 'm-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', at: '2026-09-24T11:04:00Z', from: 'yaron@badichi.com', name: 'Yaron Badichi', subject: '409 Suydam St - Construction Bid Request', snippet: 'I am getting ready to start the renovation', ref: '', by: '', kind: 'other' },
] };
const MAIL = {
  'm-cccccccccccccccccccccccccccccccc': { id: 'c', at: '2026-09-24T15:31:00Z', from: 'crismar@badichi.com', name: 'Crismar Hibirmas', subject: 'Re: 409 Suydam St - Construction Bid Request', text: 'Tiling: Please price the tile work in accordance with the plans. Clearly identify any additional preparation you require.' },
  'm-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': { id: 'y', at: '2026-09-24T11:04:00Z', from: 'yaron@badichi.com', name: 'Yaron Badichi', subject: '409 Suydam St - Construction Bid Request', text: 'Please include your price, what is included and excluded, how long you need, and when you can start.' },
};

(async () => {
  console.log('\n1. The emails that belong to the job (lib/job-emails.js)\n');
  {
    ok('the street key: "409 Suydam street, Brooklyn" -> "409 suydam"', JE.streetKey('409 Suydam street, Brooklyn') === '409 suydam' && JE.streetKey('151 W 46th St') === '' && JE.streetKey('156 Ludlow St, New York') === '156 ludlow' && JE.streetKey('') === '');
    const picked = JE.pickJobEmails(INDEX, REC);
    ok('THE GC\'S FIRST EMAIL IS FOUND BY THE STREET ADDRESS (it is from nobody on the estimate)', picked.some((x) => x.id === 'y'));
    ok('...the customer\'s reply by the inbox\'s own match; oldest first', picked.map((x) => x.id).join(',') === 'y,c', picked.map((x) => x.id).join(','));
    ok('...a notification that names the street is never a job email; another job\'s email neither', !picked.some((x) => x.id === 'n' || x.id === 'o'));
    const full = await JE.jobEmails(REC, { loadIndex: async () => INDEX, loadMail: async (k) => MAIL[k] || null });
    ok('THE FULL TEXT, oldest first, with who and when', full.length === 2 && full[0].name === 'Yaron Badichi' && /when you can start/.test(full[0].text) && /in accordance with the plans/.test(full[1].text));
    const long = { 'm-cccccccccccccccccccccccccccccccc': Object.assign({}, MAIL['m-cccccccccccccccccccccccccccccccc'], { text: 'x'.repeat(20000) }), 'm-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': MAIL['m-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] };
    const capped = await JE.jobEmails(REC, { loadIndex: async () => INDEX, loadMail: async (k) => long[k] });
    ok('capped: an email at 3,500 characters, the newest counted first so the latest word always fits', capped.length === 2 && capped[1].text.length === JE.EMAIL_CHARS && capped.reduce((s, e) => s + e.text.length, 0) <= JE.TOTAL_CHARS);
    ok('a broken inbox gives none, never an error', (await JE.jobEmails(REC, { loadIndex: async () => { throw new Error('down'); } })).length === 0);
  }

  console.log('\n2. The generator reads them\n');
  {
    ok('THEY GO INTO input.request.emails on every run (with a clock)', /const emails = await Promise\.race\(\[jobEmails\(sourceRecord\)/.test(GEN) && /if \(emails\.length\) input\.request\.emails = emails;/.test(GEN));
    ok('the analysis is told they are her own words, the description may be a rewrite, and to say what the description adds', /1c\. request\.emails, when present, are the emails about this job from his inbox/.test(GEN) && /where the description adds something the emails never asked for, keep it only as an assumption/.test(GEN));
    ok('the pricing: price what they ask for, not other trades\' work, and answer what they ask (rule 22)', /22\. THE CUSTOMER'S EMAILS\./.test(GEN) && /answer in assumptions everything they ask the contractor to state/.test(GEN));
    const pin = require(path.join(ROOT, 'netlify/functions/lib/scope-pin.js'));
    const base = { customer: { address: '409 Suydam' }, request: { service: 'Bathroom', description: 'x' }, contractor: {} };
    const withMail = JSON.parse(JSON.stringify(base)); withMail.request.emails = [{ id: 'y' }, { id: 'c' }];
    const withMore = JSON.parse(JSON.stringify(withMail)); withMore.request.emails.push({ id: 'z' });
    const emptyMail = JSON.parse(JSON.stringify(base)); emptyMail.request.emails = [];
    ok('A JOB WITH NO EMAILS KEEPS ITS FINGERPRINT (no surprise re-read of old jobs)', pin.scopeFingerprint(base) === pin.scopeFingerprint(emptyMail));
    ok('...a NEW email reads the job again', pin.scopeFingerprint(withMail) !== pin.scopeFingerprint(base) && pin.scopeFingerprint(withMore) !== pin.scopeFingerprint(withMail));
  }

  console.log('\n3. The estimator chat reads them, and the plans when it needs them\n');
  STORES.estimates = new Map(); STORES.estimates.set(REC.ref, JSON.stringify(REC));
  STORES.inbox = new Map(); STORES.inbox.set('index', JSON.stringify(INDEX)); Object.keys(MAIL).forEach((k) => STORES.inbox.set(k, JSON.stringify(MAIL[k])));
  const ask = (text, job) => bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job, ref: REC.ref, chat: REC.ref, messages: [{ role: 'user', text }] }) });
  const lastContent = (c) => c.messages[c.messages.length - 1].content;
  const docsIn = (c) => { const x = lastContent(c); return Array.isArray(x) ? x.filter((b) => b.type === 'document') : []; };
  {
    calls = []; replies = ['L1 looks fine.'];
    await ask('is the floor tile line right?', 'J-check-1');
    const c = calls[0];
    ok('HER EMAILS ARE IN THE ESTIMATOR\'S PROMPT, in full, the GC\'s first one included', /THE CUSTOMER'S EMAILS ABOUT THIS JOB \(full text, oldest first/.test(c.system) && /Yaron Badichi <yaron@badichi\.com> \| 409 Suydam St - Construction Bid Request\nPlease include your price/.test(c.system) && /in accordance with the plans/.test(c.system));
    ok('...a plain question does not carry the plans (tens of pages, every turn)', docsIn(c).length === 0 && /The job's PDF plans are not attached to this message/.test(c.system));
    calls = []; replies = ['The plans show 13 bathrooms.'];
    await ask('how many bathrooms do the plans show?', 'J-check-2');
    ok('A QUESTION ABOUT THE PLANS CARRIES THEM, labelled', docsIn(calls[0]).length === 1 && docsIn(calls[0])[0].source.url.endsWith('plans.pdf') && /THE DRAWINGS \(1 PDF file\) are attached to his latest message/.test(calls[0].system));
    calls = []; replies = ['NOT READY - 2 things to fix.\n1. Niches: the emails ask for allowances; none priced.\nACTION: {"type":"lines","ref":"SBC-260925-Y373","ops":[{"op":"add","kind":"materials","section":"Bathroom","item":"Allowance - niches","qty":12,"unit":"ea","rate":150}]}'];
    await ask('Check before sending: read her emails and the plans against every line and tell me what to fix.', 'J-check-3');
    const cc = calls[0]; const txt = JSON.stringify(lastContent(cc));
    ok('THE CHECK BEFORE SENDING carries the plans and the checklist', docsIn(cc).length === 1 && /THIS IS THE CHECK BEFORE SENDING/.test(txt) && /work priced that the emails or plans give to another trade/.test(txt) && /allowances they ask for/.test(txt) && /READY TO SEND, or NOT READY/.test(txt));
    const job = JSON.parse(STORES['assistant-jobs'].get('J-check-3'));
    ok('...and its fixes come back as actions he can Apply', job.status === 'done' && job.actions.length === 1 && job.actions[0].type === 'lines' && /NOT READY - 2 things to fix/.test(job.reply));
    const saved = JSON.parse(STORES['assistant-chats'].get(REC.ref));
    ok('...the saved chat keeps his words, not the checklist (so Regenerate never reads it as an instruction)', saved.some((m) => /^Check before sending:/.test(m.text)) && !JSON.stringify(saved).includes('THIS IS THE CHECK BEFORE SENDING'));
    calls = []; replies = ['Checked against the emails only.']; refuseDocs = true;
    await ask('Check before sending: read her emails and the plans against every line and tell me what to fix.', 'J-check-4');
    refuseDocs = false;
    const j4 = JSON.parse(STORES['assistant-jobs'].get('J-check-4'));
    ok('A PLAN FILE THE API REFUSES never costs the answer: once more without it, and it is told to say so', j4.status === 'done' && calls.length === 2 && docsIn(calls[1]).length === 0 && /The drawings could not be attached this time/.test(JSON.stringify(lastContent(calls[1]))));
    calls = []; replies = ['ok'];
    await bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'J-check-5', ref: REC.ref, chat: 'global', messages: [{ role: 'user', text: 'Check before sending' }] }) });
    ok('the drawer (not the estimator) never gets the plans, the emails block or the checklist', docsIn(calls[0]).length === 0 && !/THE CUSTOMER'S EMAILS ABOUT THIS JOB/.test(calls[0].system) && !/THIS IS THE CHECK BEFORE SENDING/.test(JSON.stringify(lastContent(calls[0]))));
  }

  console.log('\n4. The buttons\n');
  {
    ok('"🔍 Check before sending" in the Ask AI chips', /onclick="askCheck\(\)">🔍 Check before sending<\/button>/.test(DASH));
    ok('...and at the top of step 5 (Send it)', /stepBar\(5, 'Send it'[^\n]*\n\s*'<button type="button" onclick="askCheck\(\)"[^>]*>🔍 CHECK BEFORE SENDING/.test(DASH));
    ok('the text it sends is the one the estimator recognises', /var ASK_CHECK_TEXT = "Check before sending: read her emails and the plans against every line and tell me what to fix\.";/.test(DASH) && /const CHECK_RE = \/\^\\s\*check before sending\\b\/i;/.test(A));
    ok('both the generator and the chat read plans through the same module', /jobDocuments\.documentBlocks\(request, record\)/.test(GEN) && /jobDocuments\.documentBlocks\(jobRec\.request, jobRec\)/.test(A));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
