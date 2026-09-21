/* assistant-full-estimate.test.js — run: node js/assistant-full-estimate.test.js
 *
 *   "my ask ai can't see full opened estimate for let him help me analyze
 *    on estimate directly and if he found some unmatched then let him help
 *    me recorrect"
 *
 * "I can only read what's shown to me on screen ... the painting section
 * isn't in the data I have": the estimate text handed to the model was cut
 * at 9,000 characters, and the section he had just added sat past the cut.
 * The background answer (ninety seconds, no clock to protect) now gets the
 * whole estimate; the synchronous answer keeps its short cut but says how
 * much is missing and tells the model not to describe what it cannot see.
 * The model is also told how to check an estimate for mismatches.
 */
const fs = require('fs'), path = require('path'), Module = require('module');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const clone = (o) => JSON.parse(JSON.stringify(o));
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const STORES = {};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return request; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (o) => { const m = STORES[o.name] || (STORES[o.name] = new Map()); return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } }; } } };
const https = require('https');
let sent = null;
const sse = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
https.request = function (opts, cb) {
  const res = { statusCode: 200, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  return { on() { return this; }, write(b) { sent = JSON.parse(b); }, destroy() {}, end() { setImmediate(() => { cb(res); res._data(Buffer.from(sse({ type: 'message_start' }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Looked.' } }) + sse({ type: 'message_stop' }))); if (res._end) res._end(); }); } };
};
process.env.DASHBOARD_KEY = 'k'; process.env.ANTHROPIC_API_KEY = 'sk';
const fn = require(path.join(ROOT, 'netlify/functions/assistant.js'));
const bg = require(path.join(ROOT, 'netlify/functions/assistant-background.js'));

/* A big estimate: 40 bathroom lines, then a Painting section added after agreement. */
const labor = [];
for (let i = 1; i <= 34; i++) labor.push({ item: 'Bathroom task number ' + i + ' with a reasonably long description of the work involved', qty: 4 + (i % 5), unit: 'hrs', rate: 62.4, section: 'Bathroom' });
for (let i = 1; i <= 12; i++) labor.push({ item: 'Painting task number ' + i + ' walls ceiling trim two coats Honey Badger 920', qty: 3 + (i % 4), unit: 'hrs', rate: 55, section: 'Painting' });
const materials = [];
for (let i = 1; i <= 24; i++) materials.push({ item: 'Bathroom material number ' + i + ' supplied and installed by Sani', qty: 1 + (i % 3), unit: 'ea', rate: 40 + i, section: 'Bathroom' });
materials.push({ item: 'Benjamin Moore Regal Select Honey Badger 920, eggshell', qty: 4, unit: 'gal', rate: 85, section: 'Painting' });
/* A scope past the old 1,200-character cut: the last paragraph is the one he asks about. */
let SCOPE = '';
for (let i = 1; i <= 14; i++) SCOPE += 'Paragraph ' + i + ' of the scope of work describes one part of the bathroom in plain words for the customer, with the products, the sizes and the order of the work.\n\n';
SCOPE += 'FINAL PARAGRAPH: Painting of the bathroom walls and ceiling in Honey Badger 920, two coats, after the tile is set.';
const REC = {
  ref: 'SBC-260901-WOWP', status: 'question', sentAt: '2026-09-10T21:01:00Z', updatedAt: '2026-09-20T17:45:00Z', customerFinalTotal: 23582.94,
  customer: { name: 'May Chen', email: 'rmchen882@gmail.com', address: '100 Riverside Blvd' },
  request: { service: 'Bathroom', description: 'Water damage bathroom.' },
  estimate: {
    projectTitle: 'Riverside Blvd Bathroom Upgrade', markupPct: 25, labor: labor, materials: materials,
    summary: 'Full bathroom renovation after water damage at 100 Riverside Blvd: remove the tub, repair the subfloor, set new tile and fixtures. Water Damage remediation is included.',
    timelineText: 'About three weeks of work: demolition in week one, tile and plumbing in week two, fixtures, paint and punch list in week three.',
    scopeOfWork: SCOPE,
    customerScopePublished: true,
    publishedCustomerScope: { updatedAt: '2026-09-19T10:00:00Z', services: [
      { name: 'Bathroom', subtotal: 12697.7, included: ['Remove the tub', 'Set new porcelain tile on the floor and walls'], supplied: [], excluded: [], includedOff: ['Old hidden line'] },
      { name: 'Painting', subtotal: 10885.24, included: ['Two coats on walls, ceiling and trim in Honey Badger 920', 'Doors in Louisburg Green HC-113'], supplied: [], excluded: ['Wallpaper removal'] },
    ] },
    serviceBreakdown: [{ title: 'Bathroom', included: ['Remove the tub', 'Set new tile'], customerSupplies: [], notIncluded: [], subtotal: 12697.7, options: [] }, { title: 'Painting', included: ['Two coats on walls, ceiling and trim in Honey Badger 920', 'Doors in Louisburg Green HC-113'], customerSupplies: [], notIncluded: ['Wallpaper removal'], subtotal: 10885.24, options: [] }],
    addedServices: [{ at: '2026-09-20T17:41:00Z', titles: ['Painting'], subtotal: 10885.24, text: 'Paint the bathroom' }],
  },
  sentVersion: { n: 1, at: '2026-09-10T21:01:00Z', estimate: { labor: labor.slice(0, 34), materials: materials.slice(0, 24), markupPct: 25, serviceBreakdown: [{ title: 'Bathroom', subtotal: 12697.7 }] } },
};
STORES.estimates = new Map(); STORES.estimates.set(REC.ref, JSON.stringify(REC));

(async () => {
  console.log('\n1. The background answer gets the whole estimate\n');
  {
    sent = null;
    const r = await bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'A-full0001', ref: REC.ref, chat: REC.ref, messages: [{ role: 'user', text: 'Have a look at the full estimate, anything unmatched?' }] }) });
    const sys = sent && sent.system || '';
    const est = sys.slice(sys.indexOf('THE GENERATED ESTIMATE, AS HE SEES IT'));
    ok('THE WHOLE ESTIMATE IS IN THE PROMPT: all 46 labor lines and 25 material lines, no cut', r.statusCode === 200 && /LABOR LINES \(46\)/.test(est) && /Bathroom task number 34/.test(est) && /Painting task number 12/.test(est) && /MATERIAL LINES \(25\)/.test(est) && /Honey Badger 920, eggshell/.test(est) && !/estimate cut here/.test(est), est.length + ' chars');
    ok('...with the Painting card and the bathroom card', /SERVICE CARDS THE CUSTOMER SEES/.test(est) && /Painting - \$10,885\.24/.test(est) && /Bathroom - \$12,697\.70/.test(est));
    ok('IT IS TOLD WHAT WAS ADDED AFTER AGREEMENT, and that those lines are the ones tagged with that title', /ADDED AFTER THE CUSTOMER AGREED, as own sections \(the earlier sections untouched\): Painting \$10,885\.24 on 2026-09-20\. Their lines and cards are the ones tagged with those titles\./.test(est), est.match(/ADDED AFTER[^\n]*/) && est.match(/ADDED AFTER[^\n]*/)[0]);
    ok('...and what the customer sees right now: version 1 from Sep 10, changed since', /WHAT THE CUSTOMER SEES RIGHT NOW: version 1, sent 2026-09-10, total \$[\d,]+\.\d\d - the estimate above has changed since; she sees the new version only when he sends again/.test(est), est.match(/WHAT THE CUSTOMER SEES[^\n]*/) && est.match(/WHAT THE CUSTOMER SEES[^\n]*/)[0]);
    ok('IT IS TOLD HOW TO CHECK: read every line and card, name each mismatch, reword for wording, the exact line and number for money - which he edits', /CHECK THE ESTIMATE \('have a look', 'analyze', 'is it correct', 'anything unmatched'\)/.test(sys) && /never say you cannot see it or ask him to refresh/.test(sys) && /a card bullet with no line behind it, a line filed under the wrong service, a duplicate line, a \$0 card/.test(sys) && /he edits lines himself, you never change money/.test(sys));

    /* "I don't have the exact current summary text to quote from - I only
       have card names and lines, not the free-text summary field." */
    ok('THE SUMMARY IS IN THE PROMPT WORD FOR WORD, marked as the customer\'s text to quote in a reword', /Summary \(the customer sees this text; quote it exactly in a reword\): Full bathroom renovation after water damage at 100 Riverside Blvd: remove the tub, repair the subfloor, set new tile and fixtures\. Water Damage remediation is included\./.test(est), (est.match(/Summary[^\n]*/) || [''])[0]);
    ok('...the timeline whole, not cut at 300', /Timeline \(the customer sees this text\): About three weeks of work: demolition in week one, tile and plumbing in week two, fixtures, paint and punch list in week three\./.test(est));
    ok('THE SCOPE OF WORK IS WHOLE on the background path: the final paragraph, past the old 1,200-character cut, is there', /SCOPE OF WORK \(the customer reads this text; quote it exactly in a reword\):\nParagraph 1 of the scope/.test(sys) && /FINAL PARAGRAPH: Painting of the bathroom walls and ceiling in Honey Badger 920, two coats, after the tile is set\./.test(sys) && !/more characters not shown\)\n/.test(sys.slice(sys.indexOf('SCOPE OF WORK ('), sys.indexOf('THE GENERATED ESTIMATE, AS HE SEES IT'))));
    ok('THE CARDS ARE THE PUBLISHED ONES the customer reads (porcelain tile), with the prices her page shows', /SERVICE CARDS THE CUSTOMER SEES \(prices exactly as her page shows them[^\n]*\):\n  Bathroom - \$12,697\.70\n    included: Remove the tub; Set new porcelain tile on the floor and walls/.test(est), (est.match(/SERVICE CARDS[\s\S]{0,400}/) || [''])[0]);
    ok('...THE ESTIMATOR\'S OWN WORDING IS SHOWN WHERE IT DIFFERS (the dashboard\'s Review step says plain tile), so a reword can match either copy', /THE ESTIMATOR'S OWN CARD WORDING \(the dashboard's Review step\), where it differs from the customer's cards above \(a reword changes whichever copy its from matches\):\n  Bathroom\n    included: Remove the tub; Set new tile\n/.test(est), (est.match(/THE ESTIMATOR'S OWN CARD WORDING[\s\S]{0,300}/) || [''])[0]);
    ok('...the Painting card, published word for word as the estimator wrote it, is not repeated', !/THE ESTIMATOR'S OWN CARD WORDING[\s\S]*\n  Painting\n/.test(est));
    ok('...a line toggled off (hidden from the customer) is not shown', !/Old hidden line/.test(est));
    ok('THE REWORD RULE SAYS the title, summary, timeline, scope and card lines are printed word for word - quote from there, never say you do not have the text', /the title, summary, timeline, scope of work and every card line are printed word for word in the job below - quote from there, never say you do not have the text/.test(sys));
  }

  console.log('\n2. The synchronous answer keeps its short cut, and says so honestly\n');
  {
    sent = null;
    const r = await fn.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ ref: REC.ref, chat: REC.ref, messages: [{ role: 'user', text: 'quick look' }] }) });
    const sys = sent && sent.system || '';
    const est = sys.slice(sys.indexOf('THE GENERATED ESTIMATE, AS HE SEES IT'));
    const cutAt = est.indexOf('... (estimate cut here');
    ok('on the nine-second path the estimate is cut near 9,000 characters (the clock is the reason)', r.statusCode === 200 && cutAt > 8000 && cutAt < 9200, cutAt + '');
    ok('...THE CUT SAYS HOW MUCH IS MISSING and tells the model not to describe as complete what it cannot see', /estimate cut here: \d+ more characters not shown\. Say the estimate is too long to read whole; never describe as complete what you cannot see\./.test(est));
    ok('...the scope keeps its short cut on this path, and the cut says so', /SCOPE OF WORK \(the customer reads this text; quote it exactly in a reword\):\nParagraph 1 of the scope/.test(sys) && /Paragraph [5-9] of the scope[^\n]*\.\.\. \(\d+ more characters not shown\)/.test(sys) && !/FINAL PARAGRAPH/.test(sys), (sys.match(/\.\.\. \(\d+ more characters not shown\)/) || [''])[0]);
    ok('...but the summary is always whole: it is short and it is what he asks to reword', /Summary \(the customer sees this text; quote it exactly in a reword\): Full bathroom renovation[^\n]*Water Damage remediation is included\./.test(est));
    ok('the background caller passes the wider cap, forty thousand', /const ESTIMATE_CHARS = 40000;/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant-background.js'), 'utf8')) && /estimateChars: ESTIMATE_CHARS \}\);/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant-background.js'), 'utf8')));
  }
  console.log('\n3. The current state rides on his latest message, above a stale chat\n');
  {
    /* the record has moved on: one added section removed, one left */
    const now = clone(REC);
    now.updatedAt = '2026-09-21T00:20:00Z';
    now.estimate.labor = now.estimate.labor.filter((l) => l.section !== 'Painting').concat([{ item: 'Paint living room', qty: 20, unit: 'hrs', rate: 55, section: 'Painting (additional)' }]);
    now.estimate.materials = now.estimate.materials.filter((l) => l.section !== 'Painting');
    now.estimate.serviceBreakdown = [now.estimate.serviceBreakdown[0], { title: 'Painting (additional)', included: ['Living room, two coats'], customerSupplies: [], notIncluded: [], subtotal: 7818.85, options: [] }];
    now.estimate.addedServices = [{ at: '2026-09-20T18:30:00Z', titles: ['Painting (additional)'], subtotal: 7818.85, text: 'whole apartment' }];
    now.estimate.publishedCustomerScope.services = [now.estimate.publishedCustomerScope.services[0], { name: 'Painting (additional)', subtotal: 7818.85, included: ['Living room, two coats'], supplied: [], excluded: [] }];
    now.customerFinalTotal = 20516.55;
    STORES.estimates.set(now.ref, JSON.stringify(now));
    sent = null;
    const stale = [
      { role: 'user', text: 'have a look' }, { role: 'assistant', text: 'Same 34 labor lines / 61 material lines, same $23,582.94 total, three cards: Bathroom ($12,697.70), Doors, Painting ($10,885.24, the acoustic-window job).' },
      { role: 'user', text: 'How looks everything is good?' },
    ];
    await bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'A-glance01', ref: now.ref, chat: now.ref, messages: stale }) });
    const last = sent.messages[sent.messages.length - 1];
    const text = typeof last.content === 'string' ? last.content : last.content.map((c) => c.text || '').join('');
    ok('HIS LATEST MESSAGE CARRIES THE ESTIMATE RIGHT NOW: counts, the customer total, every card with its price, what was added, when it was saved', /How looks everything is good\?\n\n\[ESTIMATE RIGHT NOW \(SBC-260901-WOWP, as stored, last saved 2026-09-21 00:20\): 35 labor lines, 24 material lines, customer total \$20,516\.55; 2 cards as the customer sees them: Bathroom \$12,697\.70; Painting \(additional\) \$7,818\.85; added after the customer agreed: Painting \(additional\)\. This is the current truth; earlier turns of this chat may describe an older state\.\]$/.test(text), text.slice(-400));
    ok('...earlier turns are untouched', sent.messages[0].content === 'have a look' && /34 labor lines/.test(sent.messages[1].content));
    ok('IT IS TOLD THE CHAT MAY BE STALE and that the note and the block outrank it', /THE CHAT MAY BE STALE\. Earlier answers in this conversation describe the estimate as it was when they were written/.test(sent.system) && /never repeat an old count, total or card from the chat, and never invent a section that is not in the current estimate/.test(sent.system));
    const savedChat = JSON.parse(STORES['assistant-chats'].get(now.ref));
    ok('the note is never written into the saved chat', !JSON.stringify(savedChat).includes('ESTIMATE RIGHT NOW'));
    ok('the same note comes on the nine-second path', (await (async () => { sent = null; await fn.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ ref: now.ref, chat: now.ref, messages: [{ role: 'user', text: 'quick look' }] }) }); return /\[ESTIMATE RIGHT NOW \(SBC-260901-WOWP/.test(sent.messages[0].content); })()));
    STORES.estimates.set(REC.ref, JSON.stringify(REC));
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
