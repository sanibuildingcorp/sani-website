/* quote-photos.test.js — run: node js/quote-photos.test.js
 *
 *   "In my dashboard i added 2 photos but before i sent to customer in preview
 *    mode shows only one photo and also ones i trying tap and open full screen
 *    photo, doesn't open."
 *
 * Two separate faults, in two different files, on the same feature.
 *
 * 1. THE CUSTOMER ONLY EVER SAW ONE. quote.html built the job picture with
 *
 *      const p = [...A(rq.photos), ...A(e.quotePhotos)].find(x => x && x.data);
 *
 *    .find() returns the FIRST match and stops. The dashboard invites six
 *    photos, stores six, shows six in its own preview — and the quote the
 *    customer opens rendered exactly one, silently, with no error anywhere.
 *    The function was even named heroPhoto: it was built to show one, and the
 *    upload control grew past it without anyone noticing.
 *
 * 2. THE DASHBOARD THUMBNAIL WOULD NOT OPEN. The click handler was written as
 *
 *      onclick="openLightbox('<the whole image>')"
 *
 *    with the image inlined into the attribute. Before a save, that image is a
 *    base64 data URL of a 1200px JPEG — a few hundred thousand characters of
 *    markup per thumbnail, re-parsed on every render. esc() escapes & < > "
 *    but NOT the apostrophe that closes that string, so any filename or URL
 *    carrying one breaks the handler outright.
 *
 * Both are now driven off the array index instead, so the click carries a
 * number and the image is looked up from the record.
 *
 * WHAT THIS FILE DOES. It lifts the real functions out of the two pages and
 * runs them. Nothing here is a copy of the source: if the page changes, the
 * test changes with it, and if the page stops defining what it needs, the
 * extraction throws rather than quietly passing.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const QUOTE = fs.readFileSync(path.join(ROOT, 'quote.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* ── pull a named function out of a page, braces balanced ────────────────── */
function ext(src, name) {
  const s = src.search(new RegExp('(async )?function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = src.indexOf('{', s); j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return src.slice(s, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

/* A realistic stored photo: what the browser actually puts in the record
   before a save — a base64 JPEG, not a tidy https:// URL. */
const dataUrl = (tag) => 'data:image/jpeg;base64,' + Buffer.from('x'.repeat(400) + tag).toString('base64');
const PHOTOS = [
  { name: 'shower-before.jpg', data: dataUrl('ONE') },
  { name: 'vanity-after.jpg', data: dataUrl('TWO') }
];

/* ══ 1. THE ONE THE CUSTOMER SEES ═════════════════════════════════════════ */
console.log('\nthe customer quote shows every photo that was attached\n');
{
  const ctx = { console, String, Number, Array, Object, JSON };
  ctx.window = ctx; vm.createContext(ctx);
  /* the page's own helpers, taken from the line that declares them */
  const helpers = QUOTE.split('\n').find(l => l.startsWith('const A=v=>Array.isArray'));
  if (!helpers) throw new Error('quote.html no longer declares A/E on one line');
  vm.runInContext(helpers, ctx);
  vm.runInContext(ext(QUOTE, 'heroPhoto'), ctx);
  ctx.rec = { request: { photos: [] }, estimate: { quotePhotos: PHOTOS } };

  const html = vm.runInContext('heroPhoto(rec)', ctx);
  const imgs = (html.match(/<img[^>]*>/g) || []);
  ok('BOTH PHOTOS REACH THE CUSTOMER — this is the whole bug',
    imgs.length === 2, imgs.length + ' rendered, 2 attached');
  ok('...and they are the two that were attached, in order',
    imgs.length === 2 && imgs[0].indexOf(PHOTOS[0].data) !== -1 && imgs[1].indexOf(PHOTOS[1].data) !== -1);

  /* Six is the ceiling the upload control promises. */
  const six = Array.from({ length: 6 }, (_, i) => ({ name: 'p' + i + '.jpg', data: dataUrl('P' + i) }));
  ctx.rec6 = { request: { photos: [] }, estimate: { quotePhotos: six } };
  ok('all six render, which is what the upload box offers',
    (vm.runInContext('heroPhoto(rec6)', ctx).match(/<img[^>]*>/g) || []).length === 6);

  /* Photos arrive from two places. Neither may swallow the other. */
  ctx.recBoth = {
    request: { photos: [{ name: 'customer.jpg', data: dataUrl('CUST') }] },
    estimate: { quotePhotos: PHOTOS }
  };
  ok('the customer\'s own photo AND the ones added here both appear',
    (vm.runInContext('heroPhoto(recBoth)', ctx).match(/<img[^>]*>/g) || []).length === 3);

  /* What must not have broken. */
  ok('no photos still renders nothing at all, not an empty frame',
    vm.runInContext('heroPhoto({request:{},estimate:{}})', ctx) === '');
  ok('an entry with no image data is skipped rather than rendered blank',
    (vm.runInContext('heroPhoto({request:{},estimate:{quotePhotos:[{name:"broken.jpg"},' +
      JSON.stringify(PHOTOS[0]) + ']}})', ctx).match(/<img[^>]*>/g) || []).length === 1);
  ok('the image class the stylesheet targets is still on every one',
    (vm.runInContext('heroPhoto(rec)', ctx).match(/class="heroimg"/g) || []).length === 2);
}

/* ══ 2. THE ONE IN THE DASHBOARD ══════════════════════════════════════════ */
console.log('\nthe dashboard thumbnails open full screen when tapped\n');
{
  const ctx = { console, String, Number, Array, Object, JSON };
  ctx.document = { getElementById: () => ({ innerHTML: '' }) };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(ext(DASH, 'esc'), ctx);
  vm.runInContext(ext(DASH, 'renderQuotePhotoPreview'), ctx);

  let written = '';
  ctx.document.getElementById = () => ({ set innerHTML(v) { written = v; }, get innerHTML() { return written; } });
  ctx.currentRecord = { estimate: { quotePhotos: PHOTOS } };
  vm.runInContext('renderQuotePhotoPreview()', ctx);

  ok('both thumbnails are drawn', (written.match(/<img[^>]*>/g) || []).length === 2);

  const handlers = written.match(/onclick="openLightbox\(([^)]*)\)"/g) || [];
  ok('BOTH THUMBNAILS CARRY A WORKING CLICK HANDLER', handlers.length === 2, handlers.length + ' found');
  ok('THE HANDLER PASSES AN INDEX, NOT THE WHOLE IMAGE — an inlined data URL is ' +
    'hundreds of thousands of characters and breaks on any apostrophe',
    handlers.every(h => /openLightbox\(\d+\)/.test(h)), handlers.map(h => h.slice(0, 60)).join(' | '));

  /* The doubling is what made this worth fixing: the image once in src= and
     again inside onclick=. Counted directly rather than inferred from total
     length, which with small test images is dominated by the fixed wrapper
     markup and says nothing either way. */
  const copies = PHOTOS.map(p => written.split(p.data).length - 1);
  ok('EACH IMAGE APPEARS ONCE IN THE MARKUP, NOT TWICE',
    copies.every(n => n === 1), 'copies per photo: ' + copies.join(', '));

  /* THE ONE THAT WOULD HURT MOST: a filename or signed URL with an apostrophe
     used to end the JS string early and kill the handler. */
  ctx.currentRecord = { estimate: { quotePhotos: [{ name: "zura's bathroom.jpg", data: dataUrl('APOS') + "'--" }] } };
  vm.runInContext('renderQuotePhotoPreview()', ctx);
  ok('AN APOSTROPHE IN THE PHOTO CANNOT BREAK THE HANDLER',
    /onclick="openLightbox\(0\)"/.test(written) && written.indexOf("openLightbox('") === -1);

  /* Remove still targets the right one. */
  ok('the remove button still passes the same index the lightbox does',
    (written.match(/removeQuotePhoto\(0\)/g) || []).length === 1);
}

/* ══ WHAT LOOKS UP THE IMAGE NOW ══════════════════════════════════════════ */
console.log('\nopenLightbox can take an index as well as a url\n');
{
  const src = ext(DASH, 'openLightbox');
  ok('it resolves a number against the record instead of trusting the caller',
    /quotePhotos/.test(src), src.replace(/\s+/g, ' ').slice(0, 150));
  ok('...and still accepts a plain url, because other call sites pass one',
    /typeof/.test(src));
  /* Those other call sites must keep working. */
  ok('the customer-photo strip and the hero strip still call it with a url',
    (DASH.match(/openLightbox\(\\'/g) || []).length >= 2,
    (DASH.match(/openLightbox\(\\'/g) || []).length + ' url call sites');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
