/* estimate-tracker.test.js — run: node js/estimate-tracker.test.js
 *
 *   "He needs to see all new fresh and old informations!! He needs to
 *    track all updates specially in each estimate!!! In each estimate
 *    special AI for concentration exactly for exact estimate"
 *
 * Two halves. Every write to an estimate now leaves a history line - eleven
 * functions wrote to records with no note (cards rebuilt, a message sent, an
 * email bridged, a contract drafted or signed, an invoice sent, paid or
 * deleted, the scope link sent, the first open, an option adopted). And the
 * assistant, on every question in an estimate's chat, gets SINCE YOUR LAST
 * ANSWER on his message: the lines recorded after the chat's last answer,
 * so it starts from what changed instead of from what it said before.
 */
const fs = require('fs'), path = require('path'), Module = require('module');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const STORES = {};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return request; if (request === 'nodemailer') return 'nodemailer'; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (o) => { const m = STORES[o.name] || (STORES[o.name] = new Map()); return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); }, setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); }, delete: async (k) => { m.delete(k); } }; } } };
require.cache['nodemailer'] = { id: 'nodemailer', filename: 'nodemailer', loaded: true, exports: { createTransport: () => ({ sendMail: async () => ({}) }) } };
const https = require('https');
let sent = null;
const sse = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
https.request = function (opts, cb) {
  const res = { statusCode: 200, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  return { on() { return this; }, write(b) { try { sent = JSON.parse(b); } catch (e) { sent = null; } }, destroy() {}, end() { setImmediate(() => { cb(res); res._data(Buffer.from(sse({ type: 'message_start' }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Seen.' } }) + sse({ type: 'message_stop' }))); if (res._end) res._end(); }); } };
};
process.env.DASHBOARD_KEY = 'k'; process.env.ANTHROPIC_API_KEY = 'sk'; delete process.env.RESEND_API_KEY;
const post = async (fn, body) => { const r = await fn.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify(body) }); return { code: r.statusCode, body: JSON.parse(r.body || '{}') }; };
const saved = (ref) => JSON.parse(STORES.estimates.get(ref));
const last = (ref) => { const h = saved(ref).history || []; return h[h.length - 1] || {}; };

(async () => {
  console.log('\n1. Every write to an estimate leaves a history line\n');
  {
    const files = ['recard-estimate', 'thread-reply', 'inbox-sync', 'save-contract', 'sign-contract', 'send-invoice', 'mark-invoice-paid', 'send-scope-link', 'track-quote-open', 'adopt-option', 'delete-invoice'];
    const missing = files.filter((f) => { const s = fs.readFileSync(path.join(ROOT, 'netlify/functions', f + '.js'), 'utf8'); return !/require\("\.\/lib\/history"\)/.test(s) || !/history\.note\(record, "/.test(s); });
    ok('ELEVEN FUNCTIONS THAT WROTE WITH NO NOTE now require lib/history and note before they save', missing.length === 0, 'missing: ' + missing.join(', '));
    ok('the first open is noted, later opens are not (they would crowd the story out)', /if \(!record\.openedAt\) history\.note\(record, "customer", "The customer opened the quote page"\);\s*if \(!record\.openedAt\) record\.openedAt = nowIso;/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/track-quote-open.js'), 'utf8')));

    STORES.estimates = new Map();
    const REC = { ref: 'SBC-TRK', status: 'invoiced', customer: { name: 'Frank', email: 'frank@example.com' }, estimate: { labor: [{ item: 'x', qty: 1, rate: 100 }] }, invoices: [{ number: 'INV-7', amount: 3000, status: 'sent' }, { number: 'INV-8', amount: 500, status: 'sent' }], thread: [] };
    STORES.estimates.set(REC.ref, JSON.stringify(REC));
    const paid = require(path.join(ROOT, 'netlify/functions/mark-invoice-paid.js'));
    let r = await post(paid, { ref: REC.ref, invoiceNumber: 'INV-7', paid: true });
    ok('marking an invoice paid: "Invoice INV-7 marked paid ($3,000.00)"', r.code === 200 && last(REC.ref).kind === 'invoice' && last(REC.ref).text === 'Invoice INV-7 marked paid ($3,000.00)', JSON.stringify(last(REC.ref)));
    const del = require(path.join(ROOT, 'netlify/functions/delete-invoice.js'));
    r = await post(del, { ref: REC.ref, invoiceNumber: 'INV-8' });
    ok('deleting an invoice: "Invoice INV-8 deleted ($500.00)"', r.code === 200 && last(REC.ref).text === 'Invoice INV-8 deleted ($500.00)', JSON.stringify(last(REC.ref)));
    const reply = require(path.join(ROOT, 'netlify/functions/thread-reply.js'));
    r = await post(reply, { ref: REC.ref, text: 'Frank, the glass door is in the scope now.' });
    ok('a message to the customer: "Sani wrote to the customer: ..."', r.code === 200 && last(REC.ref).kind === 'message' && last(REC.ref).text === 'Sani wrote to the customer: "Frank, the glass door is in the scope now."', JSON.stringify(last(REC.ref)) + ' ' + r.code + ' ' + JSON.stringify(r.body).slice(0, 120));
    ok('...the lines carry a time, oldest first', saved(REC.ref).history.length === 3 && saved(REC.ref).history.every((x) => /^\d{4}-\d\d-\d\dT/.test(x.at)));
  }

  console.log('\n2. The assistant gets SINCE YOUR LAST ANSWER on his message\n');
  {
    const assistant = require(path.join(ROOT, 'netlify/functions/assistant.js'));
    const bg = require(path.join(ROOT, 'netlify/functions/assistant-background.js'));
    const REC = {
      ref: 'SBC-260813-WPPF', status: 'sent', updatedAt: '2026-09-21T16:40:00Z', customerFinalTotal: 26836.43,
      customer: { name: 'Frank' }, request: { service: 'Bathroom', description: 'Full gut.' },
      estimate: { projectTitle: 'Full Gut Bathroom', markupPct: 25, labor: [{ section: 'Bathroom', item: 'Demo', qty: 10, unit: 'hrs', rate: 100 }], materials: [], serviceBreakdown: [{ title: 'Bathroom', subtotal: 1250, included: ['Demo'], customerSupplies: [], notIncluded: [] }] },
      history: [
        { at: '2026-09-21T14:00:00Z', kind: 'customer', text: 'Edited: total $46,836.43 -> $26,836.43' },
        { at: '2026-09-21T16:31:00Z', kind: 'reworded', text: 'Reworded (2 edits): scope: "a wall-mounted backlit/LED framed mirror"; included on Bathroom: "frameless glass shower door"' },
        { at: '2026-09-21T16:40:00Z', kind: 'email', text: 'Email from the customer - Re: bathroom: Please also add the purge spout, thanks Frank' },
      ],
    };
    STORES.estimates.set(REC.ref, JSON.stringify(REC));
    STORES['assistant-chats'] = new Map();
    STORES['assistant-chats'].set(REC.ref, JSON.stringify([
      { role: 'user', text: 'review', at: '2026-09-21T16:20:00Z' },
      { role: 'assistant', text: 'One card - Bathroom, $46,836.43 - and the customer total is $26,836.43. That gap needs to be fixed.', at: '2026-09-21T16:20:30Z' },
    ]));
    sent = null;
    await bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'A-trk001', ref: REC.ref, chat: REC.ref, messages: [{ role: 'user', text: 'review' }, { role: 'assistant', text: 'One card - Bathroom, $46,836.43 - and the customer total is $26,836.43. That gap needs to be fixed.' }, { role: 'user', text: 'Review again' }] }) });
    const lastMsg = sent.messages[sent.messages.length - 1];
    const text = typeof lastMsg.content === 'string' ? lastMsg.content : lastMsg.content.map((c) => c.text || '').join('');
    ok('HIS MESSAGE CARRIES THE TWO CHANGES RECORDED AFTER THE LAST ANSWER (16:20) - the reword and Frank\'s email - not the edit from 14:00', /\[SINCE YOUR LAST ANSWER \(2026-09-21 16:20\): 2 changes on this estimate - 16:31 reworded: Reworded \(2 edits\)[^|]*\| 16:40 email: Email from the customer - Re: bathroom: Please also add the purge spout, thanks Frank\. Start from these; the estimate block is the state after them\.\]$/.test(text) && text.indexOf('14:00') === -1, text.slice(-500));
    ok('...after the ESTIMATE RIGHT NOW glance, on the same message', /\[ESTIMATE RIGHT NOW \(SBC-260813-WPPF[\s\S]*\]\n\[SINCE YOUR LAST ANSWER/.test(text));
    ok('IT IS TOLD to start from that note and never carry a number or a finding from an earlier answer across a change', /A SINCE YOUR LAST ANSWER note on his latest message lists every change recorded on this estimate since you last spoke \(saves, rewords, card changes, messages, emails, signatures, invoices\): start from it/.test(sent.system) && /never carry a number or a finding from an earlier answer across a change/.test(sent.system));
    const savedChat = JSON.parse(STORES['assistant-chats'].get(REC.ref));
    ok('the note is never written into the saved chat', !JSON.stringify(savedChat).includes('SINCE YOUR LAST ANSWER'));

    /* nothing recorded since, record untouched */
    STORES['assistant-chats'].set(REC.ref, JSON.stringify([{ role: 'assistant', text: 'ok', at: '2026-09-21T17:00:00Z' }]));
    sent = null;
    await bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'A-trk002', ref: REC.ref, chat: REC.ref, messages: [{ role: 'user', text: 'anything new?' }] }) });
    let t2 = sent.messages[0].content; t2 = typeof t2 === 'string' ? t2 : t2.map((c) => c.text || '').join('');
    ok('nothing since: it says so plainly', /\[SINCE YOUR LAST ANSWER \(2026-09-21 17:00\): nothing changed on this estimate\.\]$/.test(t2), t2.slice(-160));
    /* saved after the last answer, but no history line: told to read fresh */
    const r3 = JSON.parse(JSON.stringify(REC)); r3.updatedAt = '2026-09-21T17:05:00Z'; STORES.estimates.set(REC.ref, JSON.stringify(r3));
    STORES['assistant-chats'].set(REC.ref, JSON.stringify([{ role: 'assistant', text: 'ok', at: '2026-09-21T17:00:00Z' }]));
    sent = null;
    await bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'A-trk003', ref: REC.ref, chat: REC.ref, messages: [{ role: 'user', text: 'anything new?' }] }) });
    let t3 = sent.messages[0].content; t3 = typeof t3 === 'string' ? t3 : t3.map((c) => c.text || '').join('');
    ok('saved with no note since: told the record was saved at 17:05 and to read the block as the current state', /SINCE YOUR LAST ANSWER \(2026-09-21 17:00\): the estimate was saved at 2026-09-21 17:05 with no history line; read the estimate block below as the current state, not your earlier answer\./.test(t3), t3.slice(-260));
    /* a fresh chat: no earlier answer, no note */
    sent = null;
    await bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'A-trk004', ref: REC.ref, chat: 'SBC-NEWCHAT', messages: [{ role: 'user', text: 'hello' }] }) });
    let t4 = sent.messages[0].content; t4 = typeof t4 === 'string' ? t4 : t4.map((c) => c.text || '').join('');
    ok('a chat with no earlier answer gets the glance only', /ESTIMATE RIGHT NOW/.test(t4) && !/SINCE YOUR LAST ANSWER/.test(t4));
    ok('the nine-second path does the same', (await (async () => { STORES['assistant-chats'].set(REC.ref, JSON.stringify([{ role: 'assistant', text: 'ok', at: '2026-09-21T17:00:00Z' }])); sent = null; await assistant.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ ref: REC.ref, chat: REC.ref, messages: [{ role: 'user', text: 'quick' }] }) }); const t = sent.messages[0].content; return /SINCE YOUR LAST ANSWER \(2026-09-21 17:00\)/.test(typeof t === 'string' ? t : t.map((c) => c.text || '').join('')); })()));
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
