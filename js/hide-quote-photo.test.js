/* hide-quote-photo.test.js — run: node js/hide-quote-photo.test.js
 *
 *   "This photos i can't delate if i don't wanna to send them with estimate"
 *
 * The customer's own uploads (the PDF plan pages) always went onto the
 * quote. Now each one has a Hide button in step 4: it stays in the job (the
 * AI reads the plans), is listed in estimate.hiddenQuotePhotos, and the
 * quote page and the email's photo count leave it out.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const QUOTE = fs.readFileSync(path.join(ROOT, 'quote.html'), 'utf8');
const cut = (src, name) => { const s = src.indexOf('function ' + name + '('); let d = 0; for (let j = src.indexOf('{', s); j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) return src.slice(s, j + 1); } } };

const PLAN1 = 'https://x.example/plan-1.jpg', PLAN2 = 'https://x.example/plan-2.jpg', OURS = 'https://x.example/ours.jpg';

console.log('\n1. the dashboard: a Hide button on each customer photo\n');
{
  const strip = { innerHTML: '' };
  const ctx = {
    currentRecord: { request: { photos: [{ data: PLAN1 }, { data: PLAN2 }] }, estimate: {} },
    esc: (t) => String(t), document: { getElementById: (id) => (id === 'customer-photos-strip' ? strip : null) },
  };
  vm.createContext(ctx);
  vm.runInContext(cut(DASH, 'quotePhotoTiles') + cut(DASH, 'toggleQuotePhoto'), ctx);
  const before = vm.runInContext('quotePhotoTiles()', ctx);
  ok('every customer photo has a "✕ Hide" button', (before.match(/>✕ Hide<\/button>/g) || []).length === 2 && before.indexOf('qp-off') === -1);
  vm.runInContext('toggleQuotePhoto(0)', ctx);
  ok('HIDE: the photo is listed by its link, not deleted from the job', JSON.stringify(ctx.currentRecord.estimate.hiddenQuotePhotos) === JSON.stringify([PLAN1]) && ctx.currentRecord.request.photos.length === 2);
  ok('...and the tile says so, dimmed, with a Show button', /class="qp-tile qp-off"/.test(strip.innerHTML) && /Not on quote/.test(strip.innerHTML) && />Show<\/button>/.test(strip.innerHTML));
  vm.runInContext('toggleQuotePhoto(0)', ctx);
  ok('SHOW puts it back', ctx.currentRecord.estimate.hiddenQuotePhotos.length === 0 && strip.innerHTML.indexOf('qp-off') === -1);
  ok('the step-4 strip uses it, with a plain note', /id="customer-photos-strip">' \+ quotePhotoTiles\(\) \+ '<\/div>/.test(DASH) && /Tap ✕ Hide to keep a photo off the customer\\'s quote\. It stays in the job for you and the AI\./.test(DASH));
  ok('SAVE carries it, and regenerate keeps it (both contractor-owned lists)', /hiddenQuotePhotos: currentRecord\.estimate\.hiddenQuotePhotos \|\| \[\],/.test(DASH) && /"quotePhotos", "hiddenQuotePhotos", "savedMaterials"/.test(DASH) && /"quotePhotos", "hiddenQuotePhotos", "savedMaterials"/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/lib/contractor-owned-fields.js'), 'utf8')));
}

console.log('\n2. the customer\'s quote leaves it out\n');
{
  const ctx = { A: (x) => (Array.isArray(x) ? x : []), E: (t) => String(t) };
  vm.createContext(ctx);
  vm.runInContext(cut(QUOTE, 'heroPhoto'), ctx);
  const rec = (hidden) => ({ request: { photos: [{ data: PLAN1 }, { data: PLAN2 }] }, estimate: { quotePhotos: [{ data: OURS }], hiddenQuotePhotos: hidden } });
  const all = ctx.heroPhoto(rec(undefined));
  ok('nothing hidden: all three photos, as before', [PLAN1, PLAN2, OURS].every((u) => all.indexOf(u) !== -1));
  const some = ctx.heroPhoto(rec([PLAN1]));
  ok('A HIDDEN PLAN PAGE IS NOT ON THE QUOTE; the rest are', some.indexOf(PLAN1) === -1 && some.indexOf(PLAN2) !== -1 && some.indexOf(OURS) !== -1, some);
  ok('all customer photos hidden: only his own quote photos', ctx.heroPhoto(rec([PLAN1, PLAN2])) === `<img class="heroimg" alt="Project photo 1" src="${OURS}" onclick="zoomPhoto(this)">`);
  const q = fs.readFileSync(path.join(ROOT, 'netlify/functions/send-quote.js'), 'utf8');
  ok('the email\'s photo count leaves hidden ones out too', /const offQuote = Array\.isArray\(est\.hiddenQuotePhotos\)/.test(q) && /\(reqData\.photos \|\| \[\]\)\.filter\(\(p\) => p && offQuote\.indexOf\(p\.data\) === -1\)/.test(q));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
