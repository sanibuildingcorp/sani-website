/* reply-attachments.test.js — run: node js/reply-attachments.test.js
 *
 *   "From the customer side in the reply can we add photo and file upload too?
 *    If they need to shows me some samples or pdf or files"
 *
 * A customer replying on the quote page can now attach photos and files. The
 * page shrinks pictures on the phone, uploads everything through the same
 * upload-photo function the estimate form uses, and sends only LINKS with the
 * message. From there the links travel everywhere the message does: the thread
 * on the record, the customer's own page, the dashboard conversation, the email
 * the contractor gets, the assistant's context, and the estimator's reader -
 * which is handed the pictures themselves.
 *
 * THE THINGS THAT WOULD HURT: the endpoint is public, so an attachment is an
 * allow-listed https link or nothing; a message that is only files must still
 * have words for every reader downstream; and a picture sent in a message must
 * reach the estimator as a picture, or "see attached tile" is a dead end.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

const thread = require(path.join(ROOT, 'netlify/functions/lib/thread.js'));
const IMG = 'https://x.supabase.co/storage/v1/object/public/estimate-photos/SBC-1/1.jpg';
const PDF = 'https://x.supabase.co/storage/v1/object/public/estimate-photos/SBC-1/plan.pdf';

/* ══ THE ALLOW-LIST ═══════════════════════════════════════════════════════ */
console.log('\nan attachment is an https link with a name, or it is dropped\n');
{
  const c = thread.cleanAttachments([
    { name: 'tile.jpg', url: IMG, kind: 'image' },
    { name: 'plan.pdf', url: PDF },
    { name: 'evil', url: 'javascript:alert(1)' },
    { name: 'http', url: 'http://insecure.example/x.jpg' },
    { name: 'blob', url: 'data:image/png;base64,AAAA' },
    'not-an-object', null, { url: '' },
  ]);
  ok('https links are kept, everything else is dropped', c.length === 2, JSON.stringify(c));
  ok('a picture is kind image', c[0].kind === 'image');
  ok('a PDF is kind file, worked out from the url when the page did not say', c[1].kind === 'file');
  ok('a link with no name is named from its filename', thread.cleanAttachments([{ url: IMG }])[0].name === '1.jpg');
  ok('capped at ' + thread.MAX_ATTACHMENTS, thread.cleanAttachments(Array.from({ length: 20 }, (_, i) => ({ url: IMG + '?' + i }))).length === thread.MAX_ATTACHMENTS);
  ok('a long name is cut, a long url too', thread.cleanAttachments([{ name: 'x'.repeat(500), url: IMG }])[0].name.length <= 120);
  ok('nothing in, nothing out', thread.cleanAttachments(undefined).length === 0 && thread.cleanAttachments('x').length === 0);
}

/* ══ THE THREAD ═══════════════════════════════════════════════════════════ */
console.log('\nthe thread keeps them, and re-reads them\n');
{
  const a = thread.appendMessage({}, { from: 'customer', text: 'This is the tile I bought', attachments: [{ name: 'tile.jpg', url: IMG, kind: 'image' }, { url: 'ftp://no' }] });
  ok('appendMessage stores the clean list on the message', a.added && a.message.attachments.length === 1 && a.message.attachments[0].url === IMG);
  const re = thread.normalizeThread({ thread: a.thread });
  ok('normalizeThread hands them back on the next read', re[0].attachments && re[0].attachments[0].name === 'tile.jpg');
  const b = thread.appendMessage({}, { from: 'customer', text: 'no files' });
  ok('a message without files has no attachments field at all', !('attachments' in b.message));
  const junk = thread.normalizeThread({ thread: [{ id: 'm1', from: 'customer', text: 'hi', at: '2026-09-16T00:00:00Z', attachments: [{ url: 'javascript:x' }] }] });
  ok('junk stored on an old record is filtered on read, not passed to a page', !('attachments' in junk[0]) || junk[0].attachments === undefined);
}

/* ══ THE ENDPOINT ═════════════════════════════════════════════════════════ */
console.log('\nquote-response takes them with a question, and words a files-only message\n');
let STORE = {};
const realLoad = Module._load;
Module._load = function (r, p, m) {
  if (r === '@netlify/blobs') return { getStore: () => ({
    get: async (k) => STORE[k] ? JSON.parse(JSON.stringify(STORE[k])) : null,
    setJSON: async (k, v) => { STORE[k] = JSON.parse(JSON.stringify(v)); },
  }) };
  return realLoad(r, p, m);
};
const https = require('https');
let sent = [];
https.request = function (opts, cb) {
  let body = '';
  return { on() { return this; }, write(d) { body += d; }, end() {
    sent.push(JSON.parse(body));
    const res = { statusCode: 200, on(ev, fn) { if (ev === 'data') fn(Buffer.from('{"id":"x"}')); if (ev === 'end') fn(); return this; } };
    setImmediate(() => cb(res));
  } };
};
process.env.RESEND_API_KEY = 'rk'; process.env.CONTRACTOR_EMAIL = 'zura@example.com';
const fn = require(path.join(ROOT, 'netlify/functions/quote-response.js'));
const REC = () => ({ ref: 'SBC-1', status: 'sent', customer: { name: 'Mike Ross', email: 'mike@example.com' }, request: { service: 'Tile' }, estimate: { projectTitle: 'Bathroom tile', labor: [{ item: 'x', qty: 1, rate: 100 }] } });
const call = async (body) => { const r = await fn.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) }); return { code: r.statusCode, body: JSON.parse(r.body) }; };

(async function () {
  STORE = { 'SBC-1': REC() }; sent = [];
  const r = await call({ ref: 'SBC-1', action: 'question', questionText: 'Here is the tile', attachments: [{ name: 'tile.jpg', url: IMG, kind: 'image' }, { name: 'plan.pdf', url: PDF, kind: 'file' }, { name: 'bad', url: 'javascript:1' }] });
  ok('THE MESSAGE IS SAVED WITH ITS TWO GOOD LINKS, the bad one dropped',
    r.code === 200 && r.body.message && r.body.message.attachments.length === 2, JSON.stringify(r.body.message));
  ok('...and they are on the record', STORE['SBC-1'].thread[0].attachments.length === 2);
  ok('THE CONTRACTOR EMAIL SHOWS THE PICTURE AND LINKS THE PDF',
    sent.length === 1 && sent[0].html.indexOf('<img src="' + IMG + '"') !== -1 && sent[0].html.indexOf('href="' + PDF + '"') !== -1 && /plan\.pdf/.test(sent[0].html), (sent[0] || {}).html && sent[0].html.slice(sent[0].html.indexOf('Attached') - 20, sent[0].html.indexOf('Attached') + 200));
  ok('...and the plain-text copy lists them', /Attached:\n- tile\.jpg: https/.test(sent[0].text));

  STORE = { 'SBC-1': REC() }; sent = [];
  const r2 = await call({ ref: 'SBC-1', action: 'question', questionText: '', attachments: [{ name: 'sample.jpg', url: IMG, kind: 'image' }] });
  ok('A FILES-ONLY MESSAGE IS ACCEPTED and given words that name the files',
    r2.code === 200 && /Sent 1 file: sample\.jpg/.test(r2.body.message.text), JSON.stringify(r2.body.message));

  STORE = { 'SBC-1': REC() }; sent = [];
  const r3 = await call({ ref: 'SBC-1', action: 'question', questionText: '', attachments: [{ name: 'x', url: 'javascript:1' }] });
  ok('junk-only with no words is still refused', r3.code === 400);

  /* ══ THE PAGE ═══════════════════════════════════════════════════════════ */
  console.log('\nthe quote page offers the attach button, uploads before sending, and shows what was sent\n');
  const Q = read('quote.html');
  const ext = (src, name) => { const s = src.search(new RegExp('function ' + name + '\\s*\\(')); if (s < 0) throw new Error('missing ' + name); let d = 0; for (let j = src.indexOf('{', s); j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) return src.slice(s, j + 1); } } };
  {
    const ctx = { A: (v) => Array.isArray(v) ? v : [], E: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])) };
    vm.createContext(ctx); vm.runInContext(ext(Q, 'attHtml'), ctx);
    const h = vm.runInContext('attHtml(' + JSON.stringify([{ name: 'tile.jpg', url: IMG, kind: 'image' }, { name: 'plan.pdf', url: PDF, kind: 'file' }]) + ')', ctx);
    ok('a picture renders as a thumbnail that opens full size', new RegExp('<a href="' + IMG.replace(/[.?]/g, '\\$&') + '" target="_blank" rel="noopener"><img src="' + IMG.replace(/[.?]/g, '\\$&')).test(h), h);
    ok('a file renders as a named link', /class="file" href="[^"]*plan\.pdf" target="_blank"[^>]*>[^<]*plan\.pdf/.test(h));
    ok('no attachments, no markup', vm.runInContext('attHtml([])', ctx) === '' && vm.runInContext('attHtml(undefined)', ctx) === '');
    ok('a hostile name is escaped', vm.runInContext('attHtml([{name:"<b>x</b>",url:"' + PDF + '",kind:"file"}])', ctx).indexOf('<b>x</b>') === -1);
  }
  ok('the message box has a file input that takes photos and PDFs', /<input type="file" id="msgfile" accept="image\/\*,application\/pdf,\.pdf,\.heic,\.heif,\.dwg,\.dxf,\.doc,\.docx" multiple onchange="msgPick\(event\)">/.test(Q));
  ok('...labelled as a button, inside the message panel', /class="attach-btn">[^<]*Add photos or files<input/.test(Q) && Q.indexOf('id="msgfile"') > Q.indexOf('id="msg"'));
  ok('thread messages render their attachments', /\$\{E\(m\.text\)\}\$\{attHtml\(m\.attachments\)\}/.test(Q));
  ok('SEND UPLOADS FIRST, THROUGH THE SHARED upload-photo FUNCTION, and only then posts links', /p\.attachments=await uploadMsgFiles\(\)/.test(Q) && /fetch\('\/\.netlify\/functions\/upload-photo'/.test(ext(Q, 'uploadMsgFiles')));
  ok('pictures are shrunk on the phone before upload', /shrinkImage\(f,1600,0\.85\)/.test(ext(Q, 'uploadMsgFiles')));
  ok('a message that is only files can be sent', /if\(!p\.questionText&&!msgFiles\.length\)/.test(Q));
  ok('a failed upload with no words does not send an empty message', /if\(!p\.attachments\.length&&!p\.questionText\)/.test(Q));
  ok('after sending, the picked files are cleared', /if\(box\)box\.value='';\s*msgFiles=\[\];msgPreview\(\);/.test(Q));
  ok('at most ' + 6 + ' files, 15 MB each', /MSG_MAX_FILES=6,MSG_MAX_BYTES=15\*1024\*1024/.test(Q));

  /* ══ THE DASHBOARD ══════════════════════════════════════════════════════ */
  console.log('\nthe dashboard conversation shows them\n');
  {
    const D = read('dashboard.html');
    const ctx = { esc: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])) };
    vm.createContext(ctx); vm.runInContext(ext(D, 'cnvAttachmentsHtml'), ctx);
    const h = vm.runInContext('cnvAttachmentsHtml(' + JSON.stringify([{ name: 'tile.jpg', url: IMG, kind: 'image' }, { name: 'plan.pdf', url: PDF, kind: 'file' }]) + ')', ctx);
    ok('thumbnail for the picture, link for the file, both in a new tab', /<img src="[^"]*1\.jpg"/.test(h) && /class="cnv-file" href="[^"]*plan\.pdf" target="_blank"/.test(h), h);
    ok('wired into every message bubble', /esc\(m\.text\) \+ cnvAttachmentsHtml\(m\.attachments\)/.test(D));
    ok('styled', /\.cnv-att img\{/.test(D));
  }

  /* ══ THE AI SIDE ════════════════════════════════════════════════════════ */
  console.log('\nthe assistant and the estimator both know about them\n');
  {
    const A = read('netlify/functions/assistant.js');
    ok('the assistant is told which files were attached to each message', /\[attached: " \+ files\.join\(", "\) \+ "\]/.test(A));

    const G = read('netlify/functions/generate-estimate-background.js');
    const ctx = { console, String, Number, Array, Object, JSON, RegExp, Buffer,
      thread: thread, MAX_CONVERSATION_MESSAGES: 30, MAX_CONVERSATION_CHARS: 6000,
      cleanText: (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim() };
    vm.createContext(ctx);
    const extConst = (name) => { const s = G.indexOf('const ' + name + ' ='); const e = G.indexOf('\n};', s); return G.slice(s, e + 3); };
    vm.runInContext(extConst('SHOT_LABELS'), ctx);
    vm.runInContext(G.split('\n').find(l => l.startsWith('const MAX_PHOTOS_TO_READ')), ctx);
    vm.runInContext(ext(G, 'buildConversationForEstimator'), ctx);
    vm.runInContext(ext(G, 'photoBlocksForClaude'), ctx);
    const rec = { request: { photos: [{ data: 'https://x/wide.jpg', slot: 'wide' }] },
      thread: [{ id: 'm1', from: 'customer', text: 'This is the tile I bought', at: '2026-09-16T10:00:00Z', attachments: [{ name: 'tile.jpg', url: IMG, kind: 'image' }, { name: 'plan.pdf', url: PDF, kind: 'file' }] }] };
    ctx.REC = rec;
    const conv = vm.runInContext('buildConversationForEstimator(REC, {})', ctx);
    ok('the conversation the estimator reads names the files', conv.length === 1 && /\[attached: tile\.jpg, plan\.pdf\]/.test(conv[0].said), JSON.stringify(conv));
    const blocks = vm.runInContext('photoBlocksForClaude(REC.request, REC)', ctx);
    ok('THE PICTURE FROM THE MESSAGE REACHES THE READER AS A PICTURE, after the form photos',
      blocks.length === 4 && blocks[3].type === 'image' && blocks[3].source.url === IMG, JSON.stringify(blocks).slice(0, 300));
    /* Guarded: when the plant removed the thread pictures this line threw on
       blocks[2] and the suite crashed instead of reporting the second failure. */
    ok('...labelled as sent later in a message, with its name', !!blocks[2] && /Photo 2 .*sent later in a message \(tile\.jpg\)/.test(blocks[2].text), blocks[2] && blocks[2].text);
    ok('...the PDF is not sent as an image', !blocks.some(b => b.type === 'image' && /plan\.pdf/.test(b.source.url)));
    ok('the reader is called with the record, so it can see the thread', /photoBlocksForClaude\(record\.request, record\)/.test(G));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e));
  console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed\n');
  process.exit(1);
});
