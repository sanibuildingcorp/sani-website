/* estimate-history.test.js — run: node js/estimate-history.test.js
 *
 *   "let him check old history too for analyze situation and knows what's
 *    was change and whats need to change ... let's him be very smart"
 *
 * Every write to a record leaves a line in record.history (lib/history.js):
 * sent, accepted, question, declined, regenerated, reworded, added, removed,
 * edited, total set, customer edited. The assistant reads the story on
 * every question, plus a data diff of the estimate now against the frozen
 * sent version, and is briefed as a senior estimator who fixes wording
 * himself and names the number for money.
 */
const fs = require('fs'), path = require('path'), Module = require('module'), https = require('https');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const clone = (o) => JSON.parse(JSON.stringify(o));
const STORES = {};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs' || request === 'nodemailer') return request; return origResolve.call(this, request, ...rest); };
require.cache['nodemailer'] = { id: 'nodemailer', filename: 'nodemailer', loaded: true, exports: { createTransport: () => ({ sendMail: async () => ({}) }) } };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (o) => { const nm = typeof o === 'string' ? o : o.name; const m = STORES[nm] || (STORES[nm] = new Map()); return { get: async (k) => (m.has(k) ? clone(m.get(k)) : null), set: async (k, v) => { m.set(k, typeof v === 'string' ? JSON.parse(v) : v); }, setJSON: async (k, v) => { m.set(k, clone(v)); }, delete: async (k) => { m.delete(k); } }; } } };
/* every outbound call (Resend, Claude) answers with something harmless */
let sent = null;
const sse = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
https.request = function (opts, cb) {
  const isClaude = /anthropic/.test(String(opts && opts.hostname));
  const res = { statusCode: 200, _h: {}, on(ev, fn) { this._h[ev] = fn; return this; } };
  return { on() { return this; }, write(b) { if (isClaude) { try { sent = JSON.parse(b); } catch (e) {} } }, destroy() {}, end() { setImmediate(() => { cb(res); if (res._h.data) res._h.data(Buffer.from(isClaude ? sse({ type: 'message_start' }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }) + sse({ type: 'message_stop' }) : '{"id":"m1"}')); if (res._h.end) res._h.end(); }); } };
};
process.env.DASHBOARD_KEY = 'k'; process.env.ANTHROPIC_API_KEY = 'sk'; process.env.RESEND_API_KEY = 'rk'; process.env.CONTRACTOR_EMAIL = 'zura@example.com';
const H = require(path.join(ROOT, 'netlify/functions/lib/history.js'));
const lib = require(path.join(ROOT, 'netlify/functions/lib/add-service.js'));
const FN = (n) => require(path.join(ROOT, 'netlify/functions', n + '.js'));
const post = async (fn, body, key) => { const r = await fn.handler({ httpMethod: 'POST', headers: key === undefined ? { 'x-sbc-key': 'k' } : (key ? { 'x-sbc-key': key } : {}), body: JSON.stringify(body || {}) }); let b = null; try { b = JSON.parse(r.body); } catch (e) { b = r.body; } return { code: r.statusCode, body: b }; };
const REF = 'SBC-260901-ARWQ';
const REC = { ref: REF, status: 'drafted', customer: { name: 'May Chen', email: 'may@example.com', phone: '', address: '100 Riverside Blvd' }, request: { service: 'Bathroom', description: 'Water damage bathroom.' },
  estimate: { projectTitle: 'Riverside Blvd Bathroom Upgrade', summary: 'Bathroom.', scopeOfWork: 'BATHROOM:\n• Remove the tub', timelineText: '5 days', markupPct: 25, labor: [{ item: 'Bathtub removal', qty: 8, unit: 'hrs', rate: 62.4, section: 'Bathroom' }], materials: [{ item: 'Thinset', qty: 4, unit: 'bag', rate: 28, section: 'Bathroom' }], serviceBreakdown: [{ title: 'Bathroom', included: ['Remove the tub'], customerSupplies: [], notIncluded: [], subtotal: 764, options: [] }], customerScopePublished: true, publishedCustomerScope: { services: [{ name: 'Bathroom', subtotal: 764, included: ['Remove the tub'], supplied: [], excluded: [] }] } }, thread: [] };
const stored = () => STORES.estimates.get(REF);
const last = () => { const h = stored().history || []; return h[h.length - 1] || {}; };

(async () => {
  console.log('\n1. The library\n');
  {
    const r = {};
    const l = H.note(r, 'sent', 'Sent version 1', { total: 10 });
    ok('a note lands on record.history with when, what kind, what, and whatever extra was given', r.history.length === 1 && /^\d{4}-/.test(l.at) && l.kind === 'sent' && l.text === 'Sent version 1' && l.total === 10);
    ok('an empty note is ignored', H.note(r, 'x', '  ') === null && r.history.length === 1);
    for (let i = 0; i < 100; i++) H.note(r, 'saved', 'edit ' + i);
    ok('capped at ' + H.MAX + ', the oldest dropped', r.history.length === H.MAX && r.history[0].text === 'edit ' + (100 - H.MAX));
    ok('lines(): oldest first, the last n, date | kind | text', H.lines(r, 2).length === 2 && /^ {2}\d{4}-\d\d-\d\d \d\d:\d\d \| saved \| edit 99$/.test(H.lines(r, 2)[1]));
    ok('totalMove says both numbers when they differ, one when they do not', H.totalMove(100, 125.5) === 'total $100.00 -> $125.50' && H.totalMove(100, 100) === 'total $100.00' && H.totalMove(null, 7) === 'total $7.00');
  }

  console.log('\n2. Every write leaves its line\n');
  {
    STORES.estimates = new Map(); STORES.estimates.set(REF, clone(REC));
    let r = await post(FN('save-estimate'), { ref: REF, estimate: { labor: [{ item: 'Bathtub removal', qty: 8, unit: 'hrs', rate: 62.4, section: 'Bathroom' }, { item: 'Tile', qty: 10, unit: 'hrs', rate: 62.4, section: 'Bathroom' }] } });
    ok('SAVE DRAFT WITH THE MONEY MOVED: "Edited: 3 lines (was 2), total $A -> $B"', r.code === 200 && last().kind === 'saved' && /^Edited: 3 lines \(was 2\), total \$624\.00 -> \$1,404\.00$/.test(last().text), last().text);
    const n0 = stored().history.length;
    await post(FN('save-estimate'), { ref: REF, estimate: { summary: 'Bathroom, reworded.' } });
    ok('a save that moved no money and no line is silent', stored().history.length === n0);
    await post(FN('save-estimate'), { ref: REF, customerFinalTotal: 1600 });
    ok('SET TOTAL: "Total set to $1,600.00 (was the lines, $1,544.00)"', last().kind === 'total' && /^Total set to \$1,600\.00 \(was the lines, \$1,404\.00\)$/.test(last().text), last().text);
    await post(FN('save-estimate'), { ref: REF, customerFinalTotal: null });
    ok('...and cleared', /^Set total cleared; the price is the lines again, \$1,404\.00$/.test(last().text), last().text);
    r = await post(FN('reword-estimate'), { ref: REF, edits: [{ where: 'title', from: '', to: 'Riverside Blvd Bathroom Renovation' }, { where: 'included', service: 'Bathroom', from: 'Remove the tub', to: 'Remove the existing tub and cap the drain' }] });
    ok('REWORD: which words moved, where', r.code === 200 && last().kind === 'reworded' && /^Reworded \(2 edits\): title: "Riverside Blvd Bathroom Renovation"; included on Bathroom: "Remove the existing tub and cap the drain"$/.test(last().text), last().text);
    r = await post(FN('update-customer'), { ref: REF, customer: { name: 'May Chen', email: 'may@example.com', phone: '908-655-1715', address: '100 Riverside Blvd' }, service: 'Bathroom, Painting' });
    ok('CUSTOMER / SERVICES EDITED', r.code === 200 && last().kind === 'customer' && last().text === 'Edited: customer details, services set to Bathroom, Painting (was Bathroom)', last().text);
    r = await post(FN('update-customer'), { ref: REF, customer: { name: 'May Chen', email: 'may@example.com', phone: '908-655-1715', address: '100 Riverside Blvd' } });
    ok('an edit that changed nothing is silent', stored().history[stored().history.length - 1].kind === 'customer' && stored().history.filter((h) => h.kind === 'customer').length === 1);
    r = await post(FN('send-quote'), { ref: REF, includeContract: false });
    ok('SENT: version and total', r.code === 200 && last().kind === 'sent' && /^Sent version 1 to the customer, total \$1,404\.00$/.test(last().text) && last().version === 1, r.code + ' ' + last().text);
    r = await post(FN('quote-response'), { ref: REF, action: 'question', questionText: 'Can you start Monday?' }, '');
    ok('CUSTOMER WROTE', r.code === 200 && last().kind === 'question' && last().text === 'Customer wrote: Can you start Monday?', last().text);
    r = await post(FN('quote-response'), { ref: REF, action: 'accept', signature: 'May', finalTotal: 1404 }, '');
    ok('CUSTOMER ACCEPTED, at the total, signed', r.code === 200 && last().kind === 'accepted' && /^Customer accepted, total \$1,404\.00, signed$/.test(last().text), last().text);
    const rec = stored();
    lib.mergeAddedService(rec, { markupPct: 25, labor: [{ item: 'Paint walls', qty: 10, unit: 'hrs', rate: 50, section: 'Painting' }], materials: [], serviceBreakdown: [{ title: 'Painting', included: ['Two coats'], customerSupplies: [], notIncluded: [], subtotal: 625, options: [] }] }, { text: 'Paint the bathroom walls', service: 'Painting' });
    const addLine = rec.history[rec.history.length - 1];
    ok('ADDED SECTION: title, price, the brief, the total move', addLine.kind === 'added' && /^Added section Painting \(\$625\.00\) from the brief: Paint the bathroom walls; total \$1,404\.00 -> \$2,029\.00$/.test(addLine.text), addLine.text);
    lib.removeAddedService(rec, 0);
    const rmLine = rec.history[rec.history.length - 1];
    ok('REMOVED SECTION: title, price, the total back', rmLine.kind === 'removed' && /^Removed section Painting \(\$625\.00\); total \$2,029\.00 -> \$1,404\.00$/.test(rmLine.text), rmLine.text);
    const BG = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'), 'utf8');
    ok('A FULL REGENERATION leaves its line: priced / re-priced / re-read, the line counts, the total move', /history\.note\(record, "regenerated", \(previousEstimate && \(previousEstimate\.labor \|\| \[\]\)\.length \? \(body\.reanalyze === true \? "Re-read and re-priced by the AI" : "Re-priced by the AI"\) : "Priced by the AI"\)/.test(BG));
    const declined = clone(REC); declined.ref = 'SBC-DECL'; declined.status = 'sent'; STORES.estimates.set('SBC-DECL', declined);
    await post(FN('quote-response'), { ref: 'SBC-DECL', action: 'decline', declineReason: 'Too expensive' }, '');
    ok('CUSTOMER DECLINED, with the reason', STORES.estimates.get('SBC-DECL').history.slice(-1)[0].text === 'Customer declined: Too expensive');
  }

  console.log('\n3. The assistant reads the story and the diff since the last send\n');
  {
    const rec = stored();
    rec.estimate.labor.push({ item: 'Paint walls two coats', qty: 10, unit: 'hrs', rate: 50, section: 'Painting' });
    rec.estimate.serviceBreakdown.push({ title: 'Painting', included: ['Two coats'], subtotal: 625, options: [] });
    rec.estimate.labor = rec.estimate.labor.filter((l) => l.item !== 'Tile');
    STORES.estimates.set(REF, rec);
    sent = null;
    await FN('assistant-background').handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'A-hist0001', ref: REF, chat: REF, messages: [{ role: 'user', text: 'what changed since I sent it?' }] }) });
    const sys = sent && sent.system || '';
    ok('HISTORY OF THIS ESTIMATE is in the prompt, oldest first, with dates and kinds', /HISTORY OF THIS ESTIMATE \(oldest first, what happened and when\):\n {2}\d{4}-\d\d-\d\d \d\d:\d\d \| saved \| Edited: 3 lines/.test(sys) && /\| sent \| Sent version 1 to the customer/.test(sys) && /\| accepted \| Customer accepted/.test(sys), sys.slice(sys.indexOf('HISTORY OF'), sys.indexOf('HISTORY OF') + 300));
    ok('SINCE THE LAST SEND is a data diff: the card added, the lines added and removed by name, the total then and now', /SINCE THE LAST SEND \(version 1, \d{4}-\d\d-\d\d\): cards added: Painting; 1 lines added \(Paint walls two coats\); 1 lines removed \(Tile\); customer total then \$1,404\.00, now \$[\d,]+\.\d\d/.test(sys), sys.slice(sys.indexOf('SINCE THE LAST SEND'), sys.indexOf('SINCE THE LAST SEND') + 240));
    ok('THE BRIEF: a senior estimator who reads everything, names mismatches with words and numbers, fixes wording himself in one reword, leaves money to him, answers "what changed" from the data', /YOU ARE HIS SENIOR ESTIMATOR, not a clerk\./.test(sys) && /DO the wording fixes yourself with ONE reword action holding every edit/.test(sys) && /Money stays his: name the line and the number/.test(sys) && /answer from HISTORY and SINCE THE LAST SEND, with dates and totals, never from memory of this chat/.test(sys));
    const quiet = clone(REC); quiet.ref = 'SBC-QUIET'; quiet.sentVersion = { n: 1, at: '2026-09-10T10:00:00Z', estimate: clone(REC.estimate) }; STORES.estimates.set('SBC-QUIET', quiet);
    sent = null;
    await FN('assistant-background').handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'A-hist0002', ref: 'SBC-QUIET', chat: 'SBC-QUIET', messages: [{ role: 'user', text: 'anything changed?' }] }) });
    ok('an estimate untouched since the send says so', /SINCE THE LAST SEND \(version 1, 2026-09-10\): 0 lines added; 0 lines removed; customer total then \$624\.00, now \$624\.00 - nothing on the estimate has changed since/.test(sent.system), (sent.system.match(/SINCE THE LAST SEND[^\n]*/) || [''])[0]);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
