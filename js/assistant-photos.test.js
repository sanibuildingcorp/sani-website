/* assistant-photos.test.js — run: node js/assistant-photos.test.js
 *
 *   "Now i need add photo upload in AI, sometimes for updates i can upload
 *    screenshots for my AI for understanding what we need to update in
 *    estimate after customer requests"
 *
 * A 📷 button on both panels. Pictures are shrunk on the phone, shown as
 * thumbnails, and travel with the next question only, as image blocks on
 * the model's last user turn. The saved chat gets a "[📷 photo attached]"
 * mark, the browser log keeps a count, never the bytes.
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
const STORES = {};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return '@netlify/blobs'; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (o) => { const m = STORES[o.name] || (STORES[o.name] = new Map()); return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); } }; } } };
const https = require('https');
let sent = null;
const sse = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
https.request = function (opts, cb) {
  const res = { statusCode: 200, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  return { on() { return this; }, write(b) { sent = JSON.parse(b); }, destroy() {}, end() { setImmediate(() => { cb(res); res._data(Buffer.from(sse({ type: 'message_start' }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'The screenshot says: please change the vanity to 30 inch.' } }) + sse({ type: 'message_stop' }))); if (res._end) res._end(); }); } };
};
process.env.DASHBOARD_KEY = 'k'; process.env.ANTHROPIC_API_KEY = 'sk';
const fn = require(path.join(ROOT, 'netlify/functions/assistant.js'));
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const JPG_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';
const post = async (body) => { const r = await fn.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify(body) }); return { code: r.statusCode, body: JSON.parse(r.body) }; };

(async () => {
  console.log('\nthe server: the pictures ride on the last user turn\n');
  {
    sent = null;
    const r = await post({ chat: 'SBC-1', messages: [{ role: 'user', text: 'earlier question' }, { role: 'assistant', text: 'earlier answer' }, { role: 'user', text: 'what does this screenshot ask for?' }], images: [{ data: JPG_URL }, { data: PNG, mediaType: 'image/png' }] });
    const last = sent.messages[sent.messages.length - 1];
    ok('THE LAST USER TURN CARRIES THE IMAGES AS BLOCKS, then the text', Array.isArray(last.content) && last.content.length === 3 && last.content[0].type === 'image' && last.content[0].source.type === 'base64' && last.content[0].source.media_type === 'image/jpeg' && last.content[1].source.media_type === 'image/png' && last.content[2].type === 'text' && last.content[2].text === 'what does this screenshot ask for?', JSON.stringify(last).slice(0, 200));
    ok('...a data: URL is unwrapped to bare base64 and its type read off the prefix', last.content[0].source.data === JPG_URL.split(',')[1] && last.content[1].source.data === PNG);
    ok('earlier turns stay plain text', typeof sent.messages[0].content === 'string' && typeof sent.messages[1].content === 'string');
    ok('the answer comes back as usual', r.code === 200 && /vanity to 30 inch/.test(r.body.reply));
    const saved = JSON.parse(STORES['assistant-chats'].get('SBC-1'));
    ok('THE SAVED CHAT GETS A MARK, NOT THE BYTES', saved[0].text === 'what does this screenshot ask for? [📷 2 photos attached]' && JSON.stringify(saved).indexOf(PNG) === -1, saved[0].text);
    ok('it is told what a photo may be and to read it like any other fact', /A PHOTO OR SCREENSHOT may come with his question/.test(sent.system) && /use it for describe or reword/.test(sent.system));
    sent = null;
    await post({ messages: [{ role: 'user', text: 'no photo' }] });
    ok('no images -> a plain string turn, exactly as before', typeof sent.messages[0].content === 'string');
    const im = fn._imagesOf([{ data: PNG, mediaType: 'image/png' }, { data: 'not base64 !!', mediaType: 'image/png' }, { data: PNG, mediaType: 'application/pdf' }, { data: 'data:image/jpg;base64,' + PNG }, { data: 'x'.repeat(2700000), mediaType: 'image/png' }, { data: PNG, mediaType: 'image/webp' }]);
    ok('ONLY REAL PICTURES OF KNOWN TYPES, at most three: bad base64, a PDF and an oversized one are dropped; jpg means jpeg', im.length === 3 && im[0].mediaType === 'image/png' && im[1].mediaType === 'image/jpeg' && im[2].mediaType === 'image/webp', JSON.stringify(im.map((x) => x.mediaType)));
    ok('four pictures -> three', fn._imagesOf([{ data: PNG, mediaType: 'image/png' }, { data: PNG, mediaType: 'image/png' }, { data: PNG, mediaType: 'image/png' }, { data: PNG, mediaType: 'image/png' }]).length === 3);
  }

  console.log('\nthe page: a 📷 button on both panels, thumbnails, sent once\n');
  {
    ok('THE RECORD PANEL HAS THE ATTACH BUTTON and a place for thumbnails', /<label class="ask-attach" title="Attach a photo or screenshot">\\u\{1F4F7\}<input type="file" accept="image\/\*" multiple onchange="aiPickPhotos\(\\'ask\\', event\)">/.test(DASH) && /<div class="ask-photos" id="ask-photos">' \+ aiPhotoThumbs\("ask"\)/.test(DASH));
    ok('...and so does the drawer', /<label class="ask-attach" title="Attach a photo or screenshot">📷<input type="file" accept="image\/\*" multiple onchange="aiPickPhotos\('ai', event\)">/.test(DASH) && /<div class="ask-photos" id="ai-photos"><\/div>/.test(DASH));
    ok('pictures are shrunk on the phone before anything is sent', /var w = img\.width, h = img\.height, MAX = 1400;/.test(ext('aiShrink')) && /toDataURL\("image\/jpeg", 0\.82\)/.test(ext('aiShrink')));
    ok('at most three per question', /var AI_PHOTO_MAX = 3;/.test(DASH));
    const log = {}; let posted = null;
    const ctx = {
      String, JSON, Error, RegExp, Object, Math, Date, Array, Promise, setTimeout: (f) => f(), console: { error() {} },
      currentRecord: { ref: 'R1' }, ASK_LOG: log, sbcKey: () => 'k', askRender() {}, aiScreen: () => null, toast() {},
      AI_PHOTOS: { ask: [{ name: 'shot.png', data: 'data:image/png;base64,' + PNG }], ai: [] },
      document: { getElementById: (id) => id === 'ask-text' ? { value: '' } : { textContent: '', disabled: false, innerHTML: '' } },
      fetch: async (url, o) => { posted = JSON.parse(o.body); return { ok: true, status: 200, text: async () => JSON.stringify({ reply: 'ok', truncated: false, actions: [] }) }; },
    };
    vm.createContext(ctx);
    vm.runInContext([ext('askSend'), ext('aiAsk'), ext('aiTurn'), ext('aiTakePhotos'), ext('aiPhotoPreview'), ext('aiPhotoThumbs'), 'function aiAnswerJobId(){return "A-t"}'].join('\n'), ctx);
    await vm.runInContext('askSend()', ctx);
    ok('A PHOTO WITH NO WORDS STILL SENDS, with a default question', log.R1 && log.R1[0].text === 'Look at this photo.' && posted && posted.messages[0].text === 'Look at this photo.', JSON.stringify(log.R1 && log.R1[0] && log.R1[0].text));
    ok('...the picture travels in images, once, and the turns carry no bytes', posted.images.length === 1 && posted.images[0].data === 'data:image/png;base64,' + PNG && JSON.stringify(posted.messages).indexOf(PNG) === -1);
    ok('...the bubble keeps the thumbnail; the pending list is emptied', log.R1[0].photos.length === 1 && ctx.AI_PHOTOS.ask.length === 0);
    posted = null;
    await vm.runInContext('askSend()', ctx);
    ok('the next question with no photo sends none', posted === null || (Array.isArray(posted.images) && posted.images.length === 0));
    const sctx = { JSON, Array, Object, AI_LOG: [{ role: 'user', text: 'see this', photos: [{ data: 'data:image/png;base64,' + PNG }] }, { role: 'assistant', text: 'ok' }], sessionStorage: { setItem(k, v) { sctx.saved = v; } } };
    vm.createContext(sctx);
    vm.runInContext(ext('aiSave') + '\naiSave()', sctx);
    ok('THE DRAWER LOG IS SAVED WITHOUT THE BYTES, with a count', sctx.saved.indexOf(PNG) === -1 && JSON.parse(sctx.saved)[0].photoCount === 1 && JSON.parse(sctx.saved)[0].photos === undefined);
    const bctx = { esc: (s) => String(s), aiLinkify: (s) => String(s), currentRecord: null, Array };
    vm.createContext(bctx);
    vm.runInContext(ext('aiPicsHtml') + ext('askBubble'), bctx);
    ok('a bubble shows the thumbnail, or "1 photo attached" after a reload', /<img src="data:image\/png;base64,/.test(vm.runInContext('askBubble({ role: "user", text: "x", photos: [{ data: "data:image/png;base64,AAA" }] }, 0)', bctx)) && /📷 2 photos attached/.test(vm.runInContext('askBubble({ role: "user", text: "x", photoCount: 2 }, 0)', bctx)));
    const blocks = DASH.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    let broken = null;
    blocks.forEach(function (bl, i) { try { new vm.Script(bl.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; } });
    ok('all ' + blocks.length + ' script blocks parse', broken === null, broken || '');
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
