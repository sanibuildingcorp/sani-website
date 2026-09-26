/* assistant-job-photos.test.js — run: node js/assistant-job-photos.test.js
 *
 *   "Can you read quote photos in this estimate?"
 *   "No - this estimate has 0 photos attached."
 *
 * The estimate had photos on the quote. The assistant counted only the
 * customer's request photos, and was never shown any picture on the job -
 * only the ones he uploads with a question. Now every picture on the job
 * (request photos, photos attached to the quote, images in messages) is
 * counted, and on the Ask AI path the first six ride on his latest
 * message as image blocks, each after a "Job photo N of M" label. The
 * nine-second path counts them and says they are not shown there.
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
let sent = null;
const sse = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
https.request = function (opts, cb) {
  const res = { statusCode: 200, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  return { on() { return this; }, write(b) { sent = JSON.parse(b); }, destroy() {}, end() { setImmediate(() => { cb(res); res._data(Buffer.from(sse({ type: 'message_start' }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Photo 1 shows the tub.' } }) + sse({ type: 'message_stop' }))); if (res._end) res._end(); }); } };
};
process.env.DASHBOARD_KEY = 'k'; process.env.ANTHROPIC_API_KEY = 'sk';
const fn = require(path.join(ROOT, 'netlify/functions/assistant.js'));
const bg = require(path.join(ROOT, 'netlify/functions/assistant-background.js'));

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const JPG_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';
const REC = {
  ref: 'SBC-260901-WOWP', status: 'sent', updatedAt: '2026-09-20T17:45:00Z',
  customer: { name: 'May Chen', address: '100 Riverside Blvd' },
  request: { service: 'Bathroom', description: 'Water damage bathroom.', photos: [
    { name: 'wide.jpg', kind: 'image', slot: 'wide', data: 'data:image/jpeg;base64,' + JPG_B64 },
    { name: 'plan.pdf', kind: 'file', data: 'data:application/pdf;base64,JVBERi0=' },
    { name: 'phone.heic', kind: 'image', data: 'https://blobs.example.com/phone.heic' },
    { name: 'crack.png', kind: 'image', slot: 'close', data: 'data:image/png;base64,' + PNG },
  ] },
  estimate: { projectTitle: 'Riverside Blvd Bathroom', markupPct: 25, labor: [{ item: 'Remove tub', qty: 4, unit: 'hrs', rate: 60, section: 'Bathroom' }], materials: [],
    serviceBreakdown: [{ title: 'Bathroom', included: ['Remove the tub'], customerSupplies: [], notIncluded: [], subtotal: 300 }],
    quotePhotos: [{ name: 'tile sample.jpg', data: 'https://uploads.example.com/tile.jpg' }, 'https://uploads.example.com/vanity.webp', { name: 'broken', data: '' }] },
  thread: [{ id: 't1', from: 'customer', text: 'here is the leak', attachments: [{ kind: 'image', name: 'leak.jpg', url: 'https://uploads.example.com/leak.jpg' }, { kind: 'file', name: 'invoice.pdf', url: 'https://uploads.example.com/invoice.pdf' }] }],
};
STORES.estimates = new Map(); STORES.estimates.set(REC.ref, JSON.stringify(REC));
const textOf = (c) => typeof c === 'string' ? c : c.filter((b) => b.type === 'text').map((b) => b.text).join('\n');

(async () => {
  console.log('\n1. Ask AI: every picture on the job is counted, and the first six are shown\n');
  {
    sent = null;
    const r = await bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'A-photo001', ref: REC.ref, chat: REC.ref, messages: [{ role: 'user', text: 'Can you read quote photos in this estimate?' }] }) });
    ok('the answer comes back', r.statusCode === 200 && !!sent);
    const line = (sent.system.match(/Photos on this job:[^\n]*/) || [''])[0];
    ok('THE JOB BLOCK COUNTS ALL FIVE PICTURES by where they came from - request, quote, messages - and says they are shown', line === "Photos on this job: 5 (2 sent by the customer with the request, 2 attached to the quote by Sani, 1 in messages) - they are shown to you on his latest message, each labelled 'Job photo'", line);
    ok('...the PDF, the HEIC and the empty quote photo are not counted: the model cannot read them', !/plan\.pdf|phone\.heic/.test(line));
    const last = sent.messages[sent.messages.length - 1];
    const c = Array.isArray(last.content) ? last.content : [];
    const imgs = c.filter((b) => b.type === 'image');
    ok('THE FIVE PICTURES RIDE ON HIS LATEST MESSAGE as image blocks, the question last', imgs.length === 5 && c[c.length - 1].type === 'text' && c[c.length - 1].text.indexOf('Can you read quote photos in this estimate?') === 0, c.map((b) => b.type).join(','));
    ok('...each after a label saying which photo it is and where it came from', c[0].type === 'text' && c[0].text === 'Job photo 1 of 5 - sent by the customer with the request: the whole room from the doorway (wide.jpg)' && c[2].text === 'Job photo 2 of 5 - sent by the customer with the request: a close-up of the damage or detail (crack.png)' && c[4].text === 'Job photo 3 of 5 - attached to the quote by Sani (tile sample.jpg)' && c[6].text === 'Job photo 4 of 5 - attached to the quote by Sani' && c[8].text === 'Job photo 5 of 5 - sent by the customer in a message (leak.jpg)', c.filter((b) => b.type === 'text').map((b) => b.text).join(' | '));
    ok('...a data: URL becomes a base64 source with its type, an https URL a url source', imgs[0].source.type === 'base64' && imgs[0].source.media_type === 'image/jpeg' && imgs[0].source.data === JPG_B64 && imgs[1].source.media_type === 'image/png' && imgs[2].source.type === 'url' && imgs[2].source.url === 'https://uploads.example.com/tile.jpg' && imgs[3].source.url === 'https://uploads.example.com/vanity.webp' && imgs[4].source.url === 'https://uploads.example.com/leak.jpg');
    ok('...the glance note still rides after the question', /\n\n\[ESTIMATE RIGHT NOW \(SBC-260901-WOWP/.test(c[c.length - 1].text));
    ok('the background caller asks for six', /jobPhotos: JOB_PHOTOS, estimateChars: ESTIMATE_CHARS, estimator: estimator \}\);/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant-background.js'), 'utf8')) && /const JOB_PHOTOS = 6;/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant-background.js'), 'utf8')));
    const saved = JSON.parse(STORES['assistant-chats'].get(REC.ref));
    ok('THE SAVED CHAT GETS NO PHOTO MARK AND NO BYTES: these are the job\'s pictures, not an upload', saved[0].text === 'Can you read quote photos in this estimate?' && JSON.stringify(saved).indexOf(JPG_B64) === -1, saved[0].text);
    ok('IT IS TOLD the job\'s own photos come labelled on his latest message, to read them when asked, and never to say the job has no photos when the block counts some', /THE JOB'S OWN PHOTOS \(the customer's request photos, the photos attached to the quote, pictures in messages\) come on his latest message, each after a label 'Job photo N of M - \.\.\.'/.test(sent.system) && /Never say the job has no photos when the job block counts some/.test(sent.system));
  }

  console.log('\n2. A picture he uploads with the question comes after the job\'s photos, marked apart\n');
  {
    sent = null;
    await bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'A-photo002', ref: REC.ref, chat: REC.ref + '-b', messages: [{ role: 'user', text: 'does this match photo 1?' }], images: [{ data: PNG, mediaType: 'image/png' }] }) });
    const c = sent.messages[sent.messages.length - 1].content;
    const sep = c.findIndex((b) => b.type === 'text' && b.text === 'Pictures he uploaded with this question:');
    ok('five job photos, then the separator, then his picture, then the question', c.filter((b) => b.type === 'image').length === 6 && sep === 10 && c[11].type === 'image' && c[11].source.data === PNG && c[12].type === 'text' && /^does this match photo 1\?/.test(c[12].text), c.map((b) => b.type).join(','));
    const saved = JSON.parse(STORES['assistant-chats'].get(REC.ref + '-b'));
    ok('the chat mark counts only his upload', saved[0].text === 'does this match photo 1? [📷 1 photo attached]', saved[0].text);
  }

  console.log('\n3. The nine-second path counts them but does not carry them\n');
  {
    sent = null;
    await fn.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ ref: REC.ref, chat: REC.ref + '-c', messages: [{ role: 'user', text: 'quick look' }] }) });
    const line = (sent.system.match(/Photos on this job:[^\n]*/) || [''])[0];
    ok('the count is there and it says they are not shown on this path', /^Photos on this job: 5 \(.*\) - not shown on this quick path; they are shown when he asks with Ask AI$/.test(line), line);
    ok('no image block on the message', typeof sent.messages[0].content === 'string');
  }

  console.log('\n4. The cap, and a job with no pictures\n');
  {
    const many = JSON.parse(JSON.stringify(REC));
    many.ref = 'SBC-MANY';
    many.request.photos = []; many.thread = [];
    many.estimate.quotePhotos = []; for (let i = 1; i <= 9; i++) many.estimate.quotePhotos.push('https://uploads.example.com/p' + i + '.jpg');
    STORES.estimates.set(many.ref, JSON.stringify(many));
    sent = null;
    await bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'A-photo003', ref: many.ref, chat: many.ref, messages: [{ role: 'user', text: 'photos?' }] }) });
    const c = sent.messages[sent.messages.length - 1].content;
    const line = (sent.system.match(/Photos on this job:[^\n]*/) || [''])[0];
    ok('NINE ON THE QUOTE: six are shown, labelled "of 9", and the block says the first six are shown', c.filter((b) => b.type === 'image').length === 6 && c[10].text === 'Job photo 6 of 9 - attached to the quote by Sani' && /^Photos on this job: 9 \(9 attached to the quote by Sani\) - the first 6 are shown to you/.test(line), line);
    const none = JSON.parse(JSON.stringify(many)); none.ref = 'SBC-NONE'; none.estimate.quotePhotos = [];
    STORES.estimates.set(none.ref, JSON.stringify(none));
    sent = null;
    await bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'A-photo004', ref: none.ref, chat: none.ref, messages: [{ role: 'user', text: 'photos?' }] }) });
    ok('no pictures: "Photos on this job: 0" and a plain text message', /^Photos on this job: 0$/m.test(sent.system) && typeof sent.messages[0].content === 'string');
    const pics = fn._jobPictures({ request: { photos: [{ kind: 'image', data: 'data:image/jpeg;base64,' + 'A'.repeat(2600001) }] } }, 6);
    ok('a picture too big for the API is left out rather than sent to fail', pics.total === 0);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
