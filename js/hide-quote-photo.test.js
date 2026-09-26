/* hide-quote-photo.test.js — run: node js/hide-quote-photo.test.js
 *
 *   "I need them just delete. If i want i will upload photos. Change hide
 *    with X delete."
 *   "it's doesn't opens pdf files in my dashboard, when someone will send me
 *    requests with pdf drawing how can i see it? Fix it in my dashboard"
 *
 * 1. Step 4 (quote photos): each customer picture has ✕ Delete - removed from
 *    the job for good through update-customer removePhotos, saved at once.
 * 2. A PDF from the customer is a document tile that opens the PDF (a data:
 *    file becomes a blob link first); it was drawn as a broken picture.
 * 3. The customer's quote never draws a PDF as a picture; the email's photo
 *    count skips PDFs. A photo hidden earlier (hiddenQuotePhotos) stays off.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const QUOTE = fs.readFileSync(path.join(ROOT, 'quote.html'), 'utf8');
const cut = (src, name) => { const s = src.search(new RegExp('(?:async )?function ' + name + '\\(')); let d = 0; for (let j = src.indexOf('{', s); j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) return src.slice(s, j + 1); } } };

const IMG1 = 'https://x.example/kitchen.jpg', PLAN = 'https://x.example/storage/plans-409.pdf', IMG2 = 'https://x.example/wall.jpg', OURS = 'https://x.example/ours.jpg';

(async () => {
  console.log('\n1. the dashboard: pictures get ✕ Delete, PDFs open\n');
  {
    const els = { 'customer-photos-strip': { innerHTML: '' }, 'req-photos-strip': { innerHTML: '' } };
    const calls = [], toasts = [], clicked = [];
    const ctx = {
      currentRecord: { ref: 'SBC-1', customer: { name: 'Yancy' }, request: { photos: [{ data: IMG1, kind: 'image' }, { name: 'plans-409.pdf', data: PLAN, kind: 'file' }, { data: IMG2 }] }, estimate: {} },
      esc: (t) => String(t), confirm: () => true, toast: (m, bad) => toasts.push([m, !!bad]),
      document: {
        getElementById: (id) => els[id] || null, body: { appendChild() {} },
        createElement: () => ({ click() { clicked.push(this.href); }, remove() {} }),
      },
      sbcFetch: async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); const b = JSON.parse(o.body); const left = ctx.currentRecord.request.photos.filter((_, i) => b.removePhotos.indexOf(i) === -1); return { ok: true, status: 200, json: async () => ({ success: true, photos: left }) }; },
      atob: (b) => Buffer.from(b, 'base64').toString('binary'), Uint8Array, Blob: function (parts, o) { this.type = o.type; },
      URL: { createObjectURL: () => 'blob:sbc/1' },
    };
    vm.createContext(ctx);
    vm.runInContext(['reqFileUrl', 'reqIsDoc', 'reqDocTile', 'reqPhotosHtml', 'openReqFile', 'openDocUrl', 'quotePhotoTiles', 'deleteReqPhoto'].map((n) => cut(DASH, n)).join('\n'), ctx);
    const top = vm.runInContext('reqPhotosHtml()', ctx);
    ok('THE PDF IS A DOCUMENT TILE that opens it, not a broken picture', /<button type="button" class="doc-tile" onclick="openReqFile\(1\)"[^>]*><span class="doc-ic">📄<\/span><span class="doc-nm">plans-409\.pdf<\/span><span class="doc-open">Open PDF<\/span><\/button>/.test(top) && top.indexOf('<img src="' + PLAN) === -1, top);
    vm.runInContext('openReqFile(1)', ctx);
    ok('...and a tap opens the PDF itself in a new tab', clicked[0] === PLAN);
    ctx.currentRecord.request.photos.push({ name: 'sketch.pdf', data: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4').toString('base64'), kind: 'file' });
    vm.runInContext('openReqFile(3)', ctx);
    ok('a PDF still held as data opens through a blob link (browsers refuse data: links)', clicked[1] === 'blob:sbc/1');
    ctx.currentRecord.request.photos.pop();
    const tiles = vm.runInContext('quotePhotoTiles()', ctx);
    ok('STEP 4 (quote photos): the pictures only, each with ✕ Delete - no Hide any more', (tiles.match(/>✕ Delete<\/button>/g) || []).length === 2 && tiles.indexOf(PLAN) === -1 && tiles.indexOf('Hide') === -1 && /onclick="deleteReqPhoto\(2\)"/.test(tiles), tiles);
    await vm.runInContext('deleteReqPhoto(0)', ctx);
    ok('DELETE: saved at once through update-customer removePhotos, by position', calls.length === 1 && calls[0].url === '/.netlify/functions/update-customer' && JSON.stringify(calls[0].body.removePhotos) === '[0]' && calls[0].body.ref === 'SBC-1' && calls[0].body.customer.name === 'Yancy');
    ok('...the job keeps what the server kept, both strips redrawn, and he is told to send the update', ctx.currentRecord.request.photos.length === 2 && ctx.currentRecord.request.photoCount === 2 && els['customer-photos-strip'].innerHTML.indexOf(IMG1) === -1 && els['req-photos-strip'].innerHTML.indexOf('doc-tile') !== -1 && /send the update/.test(toasts[0][0]));
    ctx.confirm = () => false;
    await vm.runInContext('deleteReqPhoto(0)', ctx);
    ok('"Cancel" on the question deletes nothing', calls.length === 1);
    ok('the old Hide button and its helpers are gone from the page', !/toggleQuotePhoto|qp-hide|qp-off/.test(DASH));
    ok('the lightbox never opens an empty viewer for a PDF', /if \(\/\\\.pdf\(\?:\[\?#\]\|\$\)\/i\.test\(url\) \|\| \/\^data:application\\\/pdf\/i\.test\(url\)\) \{ openDocUrl\(url\); return; \}/.test(cut(DASH, 'openLightbox')));
    ok('the request card at the top uses the same tiles', /const photosHtml = reqPhotosHtml\(\);/.test(DASH) && /'<div class="cust-photos" id="req-photos-strip">' \+ photosHtml/.test(DASH));
  }

  console.log('\n2. the customer\'s quote and the email\n');
  {
    const ctx = { A: (x) => (Array.isArray(x) ? x : []), E: (t) => String(t) };
    vm.createContext(ctx);
    vm.runInContext(cut(QUOTE, 'heroPhoto'), ctx);
    const rec = (hidden) => ({ request: { photos: [{ data: IMG1 }, { data: PLAN, kind: 'file' }, { data: 'data:application/pdf;base64,AAAA' }] }, estimate: { quotePhotos: [{ data: OURS }], hiddenQuotePhotos: hidden } });
    const html = ctx.heroPhoto(rec(undefined));
    ok('A PDF IS NEVER DRAWN AS A PICTURE on the quote; pictures still are', html.indexOf(PLAN) === -1 && html.indexOf('data:application/pdf') === -1 && html.indexOf(IMG1) !== -1 && html.indexOf(OURS) !== -1, html);
    ok('a photo hidden before this change stays hidden', ctx.heroPhoto(rec([IMG1])) === `<img class="heroimg" alt="Project photo 1" src="${OURS}" onclick="zoomPhoto(this)">`);
    const q = fs.readFileSync(path.join(ROOT, 'netlify/functions/send-quote.js'), 'utf8');
    ok('the email\'s photo count skips PDFs and hidden photos', /const isDoc = \(p\) => p\.kind === "file"/.test(q) && /\.filter\(\(p\) => p && p\.data && !isDoc\(p\)\)\.length/.test(q) && /offQuote\.indexOf\(p\.data\) === -1/.test(q));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
