/* contact-upload.test.js — run: node js/contact-upload.test.js
 *
 * "In this contact form i need add photo or file upload."
 *
 * The contact page has been telling people "photos help, so send them by text or
 * email if you can" while giving them nowhere to put one. This adds the nowhere.
 *
 * THE TRAP THIS IS MOSTLY GUARDING AGAINST.
 *
 * The obvious implementation — put <input type="file" name="photos"> in the form
 * and let it post — loses leads. Netlify caps a form submission at 6 MB. One
 * photo off a current iPhone is 4-8 MB. So the natural version of this feature
 * silently fails the whole submission whenever someone actually uses it: the
 * customer sees an error, gives up, and the LEAD is gone to save the picture.
 *
 * So the files never ride in the post. They are shrunk in the browser, uploaded
 * to storage through the upload-photo function the estimate form has used since
 * July, and only links travel with the submission. That has a sharp edge of its
 * own — the file input must NOT have a name attribute, or FormData serialises
 * the raw files right back into the post and undoes the whole thing. That is one
 * missing attribute between working and broken, and no amount of reading it back
 * proves anything, so it is asserted below.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'contact.html'), 'utf8');
const DASH = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* Keeps a leading `async` — slicing from `function` alone turns an async
   declaration into a syntax error the moment it contains an await. */
function extFrom(src, name) {
  const s = src.search(new RegExp('(async )?function ' + name + '\\('));
  if (s < 0) throw new Error('missing ' + name);
  let d = 0;
  for (let j = src.indexOf('{', s); j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return src.slice(s, j + 1); }
  }
}
const ext = (n) => extFrom(HTML, n);

/* ══ 1. THE MARKUP ═══════════════════════════════════════════════════════════ */
console.log('\nthe form itself\n');

const formHtml = (function () {
  const s = HTML.indexOf('<form name="contact"');
  return HTML.slice(s, HTML.indexOf('</form>', s));
})();
const fileInput = (formHtml.match(/<input type="file"[^>]*>/) || [''])[0];

ok('there is a file input on the contact form', /<input type="file"/.test(formHtml), formHtml.slice(0, 80));
ok('THE ONE THAT LOSES LEADS: the file input has NO name, so the raw files are never posted',
  fileInput !== '' && !/\sname=/.test(fileInput), fileInput);
ok('it takes photos, PDFs and iPhone HEIC', /accept="image\/\*,application\/pdf,\.pdf,\.heic,\.heif"/.test(fileInput), fileInput);
ok('it takes more than one at a time', /\bmultiple\b/.test(fileInput));
ok('choosing files runs the handler', /onchange="contactHandleFiles\(event\)"/.test(fileInput));
ok('the big tap target is wired to the input',
  /<label for="contact-files" class="contact-upload"/.test(formHtml) && /id="contact-files"/.test(fileInput));
ok('the links have a field to travel in', /<input type="hidden" name="photos" id="contact-photos-field">/.test(formHtml));
ok('...and the count has one too', /<input type="hidden" name="photo_count" id="contact-photo-count-field">/.test(formHtml));
ok('both are INSIDE the form, or Netlify never records them',
  formHtml.indexOf('name="photos"') > 0 && formHtml.indexOf('name="photo_count"') > 0);
ok('the preview grid exists', /id="contact-file-preview"/.test(formHtml));
ok('nothing else on the form was disturbed — every original field is still there',
  ['name="name"', 'name="phone"', 'name="email"', 'name="service"', 'name="borough"',
   'name="address"', 'name="message"', 'name="form-name"', 'name="bot-field"']
    .every(function (f) { return formHtml.indexOf(f) !== -1; }));

/* Order matters: the hidden fields have to be filled BEFORE FormData reads the
   form, or the links are simply not in the submission. */
const handler = HTML.slice(HTML.indexOf('form.addEventListener("submit"'));
ok('the upload happens before the submission is built',
  handler.indexOf('await contactUploadFiles(') > 0 &&
  handler.indexOf('await contactUploadFiles(') < handler.indexOf('const data=new FormData(form)'));
ok('...and so does filling the hidden fields',
  handler.indexOf('pf.value=uploaded') < handler.indexOf('const data=new FormData(form)'));
ok('a failed upload cannot stop the lead going in', /catch\(_\)\{ uploaded=\[\]; \}/.test(handler));
ok('the customer is told the photos are going up', /Uploading photos/.test(handler));
ok('the links also reach the confirmation function', /photos:uploaded\.map/.test(handler));
ok('it still posts to Netlify Forms the way it always did', /fetch\("\/",\{method:"POST",body:data\}\)/.test(handler));
ok('it still uses the shared upload-photo function rather than a new one',
  /\/\.netlify\/functions\/upload-photo/.test(HTML));

/* ══ 2. THE CODE, ACTUALLY RUN ═══════════════════════════════════════════════ */
console.log('\nthe upload pipeline, executed\n');

function mkctx(opts) {
  opts = opts || {};
  const ctx = {
    console, String, Number, Array, Object, Boolean, Math, JSON, Date, Promise,
    Error, RegExp, setTimeout: (fn, ms) => setTimeout(fn, ms || 0),
  };
  ctx.window = ctx; ctx.globalThis = ctx;

  const el = {};
  ['contact-file-preview', 'contact-upload-title', 'contact-shot-grid', 'contact-shot-nudge'].forEach(function (id) {
    el[id] = { innerHTML: '', textContent: '', className: '' };
  });
  ctx.document = {
    getElementById: function (id) { return el[id] || null; },
    createElement: function (tag) {
      if (tag !== 'canvas') return {};
      return {
        width: 0, height: 0,
        getContext: function () { return { drawImage: function () {} }; },
        toDataURL: function () { return 'data:image/jpeg;base64,COMPRESSED'; },
      };
    },
  };
  ctx.el = el;

  ctx.alerts = [];
  ctx.alert = function (m) { ctx.alerts.push(String(m)); };

  ctx.FileReader = function () {
    const self = this;
    this.readAsDataURL = function (file) {
      setTimeout(function () {
        if (file && file.__unreadable) { if (self.onerror) self.onerror(new Error('read failed')); return; }
        if (self.onload) self.onload({ target: { result: 'data:' + (file.type || 'application/octet-stream') + ';base64,RAW' } });
      }, 0);
    };
  };
  ctx.Image = function () {
    const self = this;
    this.width = 4000; this.height = 3000;
    Object.defineProperty(this, 'src', {
      set: function (v) {
        setTimeout(function () {
          /* A HEIC off an iPhone arrives with an image/* type that canvas cannot
             decode. Compression throws; the raw read is what carries it. */
          if (opts.imageDecodeFails) { if (self.onerror) self.onerror(new Error('decode failed')); return; }
          if (self.onload) self.onload();
        }, 0);
      },
    });
  };

  ctx.uploadCalls = [];
  ctx.fetch = opts.fetch || function (url, init) {
    const body = JSON.parse(init.body);
    ctx.uploadCalls.push(body);
    return Promise.resolve({
      ok: true,
      json: function () { return Promise.resolve({ success: true, url: 'https://cdn.example.com/' + body.ref + '/' + ctx.uploadCalls.length + '.jpg' }); },
    });
  };

  vm.createContext(ctx);
  /* The real shared module, loaded the way the browser loads it — so the tiles
     here are rendered from the same list the live page uses. */
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'photo-slots.js'), 'utf8'), ctx);
  vm.runInContext('var contactFiles = []; var CONTACT_MAX_FILES = 8; var CONTACT_MAX_BYTES = 15*1024*1024;', ctx);
  ['contactEsc', 'contactReadAsDataUrl', 'contactCompressImage', 'contactHandleFiles',
    'contactRemoveFile', 'contactRenderFiles', 'contactRenderShots', 'contactRenderNudge',
    'contactUploadFiles', 'contactUploadRef']
    .forEach(function (n) { vm.runInContext(ext(n), ctx); });
  return ctx;
}
const file = (name, type, size) => ({ name: name, type: type || 'image/jpeg', size: size || 2000000 });
const pick = (ctx, files) => vm.runInContext('contactHandleFiles(EV)', Object.assign(ctx, { EV: { target: { files: files, value: 'x' } } }));
/* The same handler, called the way a named shot's tile calls it. */
const pickSlot = (ctx, files, slot) => vm.runInContext('contactHandleFiles(EV,' + JSON.stringify(slot) + ')',
  Object.assign(ctx, { EV: { target: { files: files, value: 'x' } } }));

(async function () {

/* ── choosing files ─────────────────────────────────────────────────────── */
{
  const c = mkctx();
  await pick(c, [file('bathroom.jpg'), file('ceiling.jpg')]);
  ok('two photos are taken', c.contactFiles.length === 2, JSON.stringify(c.contactFiles.map(f => f.name)));
  ok('a photo off a phone is shrunk before it goes anywhere',
    c.contactFiles[0].data === 'data:image/jpeg;base64,COMPRESSED', c.contactFiles[0].data);
  ok('the loose-files bucket says how many it is holding', /2 other files/.test(c.el['contact-upload-title'].textContent), c.el['contact-upload-title'].textContent);
}
{
  const c = mkctx();
  await pick(c, [file('drawing.pdf', 'application/pdf', 500000)]);
  ok('a PDF drawing is taken as-is, not run through the image compressor',
    c.contactFiles.length === 1 && c.contactFiles[0].kind === 'file' && /base64,RAW$/.test(c.contactFiles[0].data),
    JSON.stringify(c.contactFiles[0]));
  ok('...and one is counted in the singular', /1 other file\b/.test(c.el['contact-upload-title'].textContent), c.el['contact-upload-title'].textContent);
}
{
  const c = mkctx({ imageDecodeFails: true });
  await pick(c, [file('IMG_4821.HEIC', 'image/heic', 3000000)]);
  ok('AN IPHONE HEIC STILL GETS THROUGH — canvas cannot decode it, so the raw read carries it',
    c.contactFiles.length === 1 && /base64,RAW$/.test(c.contactFiles[0].data), JSON.stringify(c.contactFiles));
}
{
  const c = mkctx();
  await pick(c, [file('huge.jpg', 'image/jpeg', 16 * 1024 * 1024)]);
  ok('a file over 15 MB is refused, not silently dropped', c.contactFiles.length === 0 && c.alerts.length === 1, JSON.stringify(c.alerts));
  ok('...and the refusal says what to do instead', /email/i.test(c.alerts[0]), c.alerts[0]);
}
{
  const c = mkctx();
  await pick(c, [file('a.jpg'), file('b.jpg'), file('c.jpg'), file('d.jpg'), file('e.jpg'),
                 file('f.jpg'), file('g.jpg'), file('h.jpg'), file('i.jpg'), file('j.jpg')]);
  ok('no more than eight are taken', c.contactFiles.length === 8, 'got ' + c.contactFiles.length);
  ok('...and the customer is told, rather than losing two without a word', c.alerts.length === 1, JSON.stringify(c.alerts));
}
{
  const c = mkctx();
  await pick(c, [file('a.jpg')]);
  await pick(c, [file('b.jpg')]);
  ok('a second visit to the picker adds rather than replaces', c.contactFiles.length === 2);
  vm.runInContext('contactRemoveFile(0)', c);
  ok('one can be removed', c.contactFiles.length === 1 && c.contactFiles[0].name === 'b.jpg');
  vm.runInContext('contactRemoveFile(0)', c);
  ok('...and removing the last one puts the prompt back',
    /Anything else/.test(c.el['contact-upload-title'].textContent), c.el['contact-upload-title'].textContent);
}
{
  const c = mkctx();
  await pick(c, [file('bad.jpg', 'image/jpeg', 100)]);
  const unreadable = file('broken.jpg'); unreadable.__unreadable = true;
  const c2 = mkctx({ imageDecodeFails: true });
  await pick(c2, [unreadable]);
  ok('a file that cannot be read at all is skipped without throwing', c2.contactFiles.length === 0);
}

/* ── the named shots, through the real handler ──────────────────────────── */
{
  const c = mkctx();
  await pickSlot(c, [file('doorway.jpg')], 'wide');
  ok('a photo taken for a named shot is filed under it',
    c.contactFiles.length === 1 && c.contactFiles[0].slot === 'wide', JSON.stringify(c.contactFiles));
  ok('...and its tile shows as filled', /class="shot filled"/.test(c.el['contact-shot-grid'].innerHTML), c.el['contact-shot-grid'].innerHTML.slice(0, 200));
  ok('...and it is NOT drawn again in the loose bucket', c.el['contact-file-preview'].innerHTML === '', c.el['contact-file-preview'].innerHTML);
}
{
  const c = mkctx();
  await pickSlot(c, [file('first.jpg')], 'wide');
  await pickSlot(c, [file('second.jpg')], 'wide');
  ok('picking the same shot again REPLACES it — one whole-room photo, not two',
    c.contactFiles.length === 1 && c.contactFiles[0].name === 'second.jpg', JSON.stringify(c.contactFiles.map(f => f.name)));
}
{
  const c = mkctx();
  await pickSlot(c, [file('a.jpg'), file('b.jpg')], 'close');
  ok('a named shot takes one photo even if they pick several', c.contactFiles.length === 1);
}
{
  /* Eight loose close-ups, then the doorway shot. The cap must not be what
     stands between Zura and the one photo that makes the job estimable. */
  const c = mkctx();
  await pick(c, new Array(8).fill(0).map((_, i) => file('close' + i + '.jpg')));
  ok('the loose bucket still stops at eight', c.contactFiles.length === 8);
  await pickSlot(c, [file('doorway.jpg')], 'wide');
  ok('THE WIDE SHOT GETS THROUGH ANYWAY — the cap must never block the one that matters',
    c.contactFiles.length === 9 && c.contactFiles.some(f => f.slot === 'wide'), 'have ' + c.contactFiles.length);
}
{
  const c = mkctx();
  await pick(c, [file('close.jpg')]);
  ok('loose photos are filed as "other"', c.contactFiles[0].slot === 'other');
  ok('THE NUDGE APPEARS once photos exist with no wide shot',
    /doorway/.test(c.el['contact-shot-nudge'].textContent) && /on/.test(c.el['contact-shot-nudge'].className),
    c.el['contact-shot-nudge'].textContent);
  await pickSlot(c, [file('doorway.jpg')], 'wide');
  ok('...and goes away once they send it',
    c.el['contact-shot-nudge'].textContent === '' && !/ on/.test(c.el['contact-shot-nudge'].className));
}
{
  const c = mkctx();
  ok('nothing is said to somebody who has sent nothing', c.el['contact-shot-nudge'].textContent === '');
}
{
  const c = mkctx();
  await pickSlot(c, [file('doorway.jpg')], 'wide');
  await pick(c, [file('loose.jpg')]);
  const out = await vm.runInContext('contactUploadFiles("r")', c);
  ok('the slot travels with each uploaded link',
    out.length === 2 && out[0].slot === 'wide' && out[1].slot === 'other', JSON.stringify(out));
}
{
  const c = mkctx();
  const grid = () => c.el['contact-shot-grid'].innerHTML;
  vm.runInContext('contactRenderShots()', c);
  ok('all four tiles are drawn', (grid().match(/class="shot(?: filled)?"/g) || []).length === 4, grid().slice(0, 120));
  ok('each tile has its own file input', (grid().match(/type="file"/g) || []).length === 4);
  ok('the wide shot is marked as the one that matters most', /Matters most/.test(grid()));
  ok('...and only it is', (grid().match(/Matters most/g) || []).length === 1);
}

/* ── the preview ────────────────────────────────────────────────────────── */
{
  const c = mkctx();
  await pick(c, [file('<img src=x onerror=alert(1)>.jpg')]);
  const h = c.el['contact-file-preview'].innerHTML;
  ok('a hostile filename cannot inject markup', h.indexOf('<img src=x onerror') === -1, h.slice(0, 200));
  ok('...it is shown escaped or not at all', h.indexOf('onerror=alert') === -1);
}
{
  const c = mkctx();
  await pick(c, [file('plan.pdf', 'application/pdf', 100)]);
  const h = c.el['contact-file-preview'].innerHTML;
  ok('a PDF gets a labelled chip, not a broken image', h.indexOf('<img') === -1 && h.indexOf('plan.pdf') !== -1, h);
}
{
  const c = mkctx();
  await pick(c, [file('a.jpg'), file('b.jpg')]);
  const h = c.el['contact-file-preview'].innerHTML;
  ok('each thumbnail gets its own remove button', (h.match(/contactRemoveFile\(/g) || []).length === 2);
}

/* ── the upload ─────────────────────────────────────────────────────────── */
{
  const c = mkctx();
  await pick(c, [file('a.jpg'), file('b.jpg')]);
  const out = await vm.runInContext('contactUploadFiles("contact-260829-ab12")', c);
  ok('both files are uploaded and come back as links',
    out.length === 2 && /^https:\/\/cdn\.example\.com\//.test(out[0].url), JSON.stringify(out));
  ok('...to the shared storage folder for this submission',
    c.uploadCalls.every(function (b) { return b.ref === 'contact-260829-ab12'; }), JSON.stringify(c.uploadCalls.map(b => b.ref)));
  ok('...and the file names travel with them', out[0].name === 'a.jpg' && out[1].name === 'b.jpg');
}
{
  let n = 0;
  const c = mkctx({
    fetch: function () {
      n++;
      if (n === 2) return Promise.reject(new Error('connection lost'));
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ url: 'https://cdn.example.com/ok' + n + '.jpg' }); } });
    },
  });
  await pick(c, [file('a.jpg'), file('b.jpg'), file('c.jpg')]);
  const out = await vm.runInContext('contactUploadFiles("r")', c);
  ok('ONE FAILED UPLOAD DOES NOT TAKE THE OTHERS DOWN — or the lead with them',
    out.length === 2, JSON.stringify(out));
}
{
  const c = mkctx({ fetch: function () { return Promise.resolve({ ok: false, status: 500, json: function () { return Promise.resolve({ error: 'boom' }); } }); } });
  await pick(c, [file('a.jpg')]);
  const out = await vm.runInContext('contactUploadFiles("r")', c);
  ok('a rejected upload yields no link rather than a broken one', out.length === 0, JSON.stringify(out));
}
{
  const c = mkctx();
  const out = await vm.runInContext('contactUploadFiles("r")', c);
  ok('attaching nothing uploads nothing', out.length === 0 && c.uploadCalls.length === 0);
}
{
  const c = mkctx();
  const ref = vm.runInContext('contactUploadRef(Date.parse("2026-08-29T12:00:00Z"))', c);
  ok('the storage folder is named after the day it came in', /^contact-260829-[a-z0-9]{4}$/.test(ref), ref);
  const a = vm.runInContext('contactUploadRef()', c), b = vm.runInContext('contactUploadRef()', c);
  ok('...and two submissions on the same day do not collide', a !== b, a + ' / ' + b);
}

/* ══ 3. THE LINKS REACH THE DASHBOARD ════════════════════════════════════════
   A photo the contractor never sees was not worth uploading. */
console.log('\nthe links survive the trip to the dashboard\n');

const leads = require(path.join(__dirname, '..', 'netlify', 'functions', 'contact-leads.js'));
ok('contact-leads exports its link parser for testing', typeof leads.splitLinks === 'function');
if (typeof leads.splitLinks === 'function') {
  const S = leads.splitLinks;
  ok('a newline-separated field becomes a list',
    JSON.stringify(S('https://a.com/1.jpg\nhttps://a.com/2.jpg')) === JSON.stringify(['https://a.com/1.jpg', 'https://a.com/2.jpg']));
  ok('a single link works too', S('https://a.com/1.jpg').length === 1);
  ok('OLDER SUBMISSIONS HAVE NO PHOTO FIELD AT ALL — that is empty, not a crash',
    S(undefined).length === 0 && S('').length === 0 && S(null).length === 0);
  ok('an array is accepted in case the shape ever changes', S(['https://a.com/1.jpg']).length === 1);
  ok('commas separate too', S('https://a.com/1.jpg, https://a.com/2.jpg').length === 2);
  ok('blank lines do not become empty links', S('https://a.com/1.jpg\n\n\n').length === 1);
  ok('A LEAD IS UNTRUSTED INPUT: javascript: is not a link',
    S('javascript:alert(1)').length === 0 && S('data:text/html,<script>').length === 0);
  ok('...and neither is loose text someone typed', S('call me maybe').length === 0);
  ok('a runaway field cannot render 500 thumbnails',
    S(new Array(60).fill('https://a.com/x.jpg').join('\n')).length === 20);
}
ok('the function actually puts them on the lead', /photos: splitLinks\(d\.photos\)/.test(
  fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'contact-leads.js'), 'utf8')));

/* The dashboard panel, in a context holding ONLY what the main script block
   really defines — the lesson from "Can't find variable: escAttr". */
{
  const dctx = { console, String, Number, Array, Object, Boolean, Math, JSON };
  dctx.window = dctx; dctx.globalThis = dctx;
  vm.createContext(dctx);
  vm.runInContext(extFrom(DASH, 'esc'), dctx);
  vm.runInContext(extFrom(DASH, 'leadPhotosHtml'), dctx);
  const panel = (L) => vm.runInContext('leadPhotosHtml(' + JSON.stringify(L) + ')', dctx);

  ok('the lead panel renders without reaching for anything out of scope',
    (function () { try { panel({ photos: ['https://a.com/1.jpg'] }); return true; } catch (e) { return 'threw: ' + e.message; } })() === true,
    (function () { try { panel({ photos: ['https://a.com/1.jpg'] }); return ''; } catch (e) { return e.message; } })());
  ok('a lead with no photos renders nothing at all',
    panel({}) === '' && panel({ photos: [] }) === '' && panel(null) === '' && panel({ photos: 'junk' }) === '');
  {
    const h = panel({ photos: ['https://a.com/1.jpg'] });
    ok('one photo is counted in the singular', /1 photo\b/.test(h) && !/1 photos/.test(h), h.slice(0, 160));
    ok('...and shown as a thumbnail', h.indexOf('<img src="https://a.com/1.jpg"') !== -1, h);
    ok('...that opens the full picture in a new tab', /target="_blank" rel="noopener"/.test(h));
  }
  {
    const h = panel({ photos: ['https://a.com/1.jpg', 'https://a.com/2.png'] });
    ok('two are counted in the plural', /2 photos/.test(h));
    ok('...and both are shown', (h.match(/<img /g) || []).length === 2);
  }
  {
    const h = panel({ photos: ['https://a.com/plan.pdf'] });
    ok('a PDF has no thumbnail to show, so it gets a chip instead of a broken image',
      h.indexOf('<img') === -1 && h.indexOf('📎') !== -1, h);
  }
  {
    const h = panel({ photos: ['https://a.com/x.jpg"><script>alert(1)</script>'] });
    ok('a hostile URL cannot break out of the href', h.indexOf('"><script>') === -1, h);
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
})();
