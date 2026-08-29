/* estimate-shots.test.js — run: node js/estimate-shots.test.js
 *
 * The same named shots as the contact form, on the main estimate flow — which is
 * where it matters most, because this is the form whose photos go to the AI and
 * come back as a price.
 *
 * The estimate form already had photo upload, and already ran AI analysis on
 * what it got. What it could not do was say WHICH picture was which. Four images
 * of a bathroom and no way to know that the first one is the whole room from the
 * doorway and the rest are the crack — so nothing could reason about area, and
 * "difficult to identify areas or figure dimensions" is precisely the result.
 *
 * These run the real handlers out of estimate.html against a stub browser.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'estimate.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

function ext(name) {
  const s = HTML.search(new RegExp('(async )?function ' + name + '\\('));
  if (s < 0) throw new Error('missing ' + name);
  let d = 0;
  for (let j = HTML.indexOf('{', s); j < HTML.length; j++) {
    if (HTML[j] === '{') d++;
    else if (HTML[j] === '}') { d--; if (!d) return HTML.slice(s, j + 1); }
  }
}

console.log('\nthe named shots on the estimate form\n');

/* ── markup ─────────────────────────────────────────────────────────────── */
ok('the shot grid is on the photo step', /<div class="shot-grid" id="shot-grid"><\/div>/.test(HTML));
ok('...above the loose-files zone, because it is the thing to do first',
  HTML.indexOf('id="shot-grid"') < HTML.indexOf('for="photo-input" class="upload-zone"'));
ok('the nudge has somewhere to appear', /<div class="shot-nudge" id="shot-nudge"><\/div>/.test(HTML));
ok('the old catch-all input is still there and still takes several at once',
  /<input type="file" id="photo-input"[^>]*multiple/.test(HTML));
ok('...and is now labelled as the extras bucket', /Anything else — tap to add/.test(HTML));
ok('the shared list is loaded', /<script src="js\/photo-slots\.js"><\/script>/.test(HTML));

/* ── the handlers, run ──────────────────────────────────────────────────── */
function mkctx(opts) {
  opts = opts || {};
  const ctx = {
    console, String, Number, Array, Object, Boolean, Math, JSON, Date, Promise, Error, RegExp,
    setTimeout: (fn, ms) => setTimeout(fn, ms || 0),
  };
  ctx.window = ctx; ctx.globalThis = ctx;

  const el = {};
  ['shot-grid', 'shot-nudge', 'photo-preview'].forEach(function (id) {
    el[id] = { innerHTML: '', textContent: '', className: '' };
  });
  const uploadTitle = { textContent: 'Anything else — tap to add' };
  ctx.document = {
    getElementById: function (id) { return el[id] || null; },
    querySelector: function (sel) { return sel === '.upload-title' ? uploadTitle : null; },
    createElement: function (tag) {
      if (tag !== 'canvas') return {};
      return { width: 0, height: 0,
        getContext: function () { return { drawImage: function () {} }; },
        toDataURL: function () { return 'data:image/jpeg;base64,COMPRESSED'; } };
    },
  };
  ctx.el = el;
  ctx.alert = function () {};

  ctx.FileReader = function () {
    const self = this;
    this.readAsDataURL = function (file) {
      setTimeout(function () {
        if (self.onload) self.onload({ target: { result: 'data:' + (file.type || 'image/jpeg') + ';base64,RAW' } });
      }, 0);
    };
  };
  ctx.Image = function () {
    const self = this;
    this.width = 4000; this.height = 3000;
    Object.defineProperty(this, 'src', {
      set: function () { setTimeout(function () { if (self.onload) self.onload(); }, 0); },
    });
  };

  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'photo-slots.js'), 'utf8'), ctx);
  vm.runInContext('var formData = { photos: [] }; var MAX_UPLOAD_BYTES = 15*1024*1024;', ctx);
  ['esc', 'compressImage', 'readAsDataUrl', 'handlePhotos', 'renderPhotoPreview',
    'renderShotGrid', 'renderShotNudge', 'removeShot'].forEach(function (n) {
    vm.runInContext(ext(n), ctx);
  });
  return ctx;
}
const file = (name, type, size) => ({ name: name, type: type || 'image/jpeg', size: size || 1000000 });
const pick = (ctx, files, slot) => vm.runInContext(
  'handlePhotos(EV' + (slot ? ',' + JSON.stringify(slot) : '') + ')',
  Object.assign(ctx, { EV: { target: { files: files, value: 'x' } } }));

(async function () {

{
  const c = mkctx();
  await pick(c, [file('doorway.jpg')], 'wide');
  ok('a photo taken for a named shot is filed under it',
    c.formData.photos.length === 1 && c.formData.photos[0].slot === 'wide', JSON.stringify(c.formData.photos.map(p => p.slot)));
  ok('...and its tile shows filled', /class="shot filled"/.test(c.el['shot-grid'].innerHTML), c.el['shot-grid'].innerHTML.slice(0, 160));
  ok('...and is not drawn a second time in the loose grid', c.el['photo-preview'].innerHTML === '');
}
{
  const c = mkctx();
  await pick(c, [file('first.jpg')], 'wide');
  await pick(c, [file('second.jpg')], 'wide');
  ok('picking the same shot again replaces it',
    c.formData.photos.length === 1 && c.formData.photos[0].name === 'second.jpg');
}
{
  const c = mkctx();
  await pick(c, new Array(8).fill(0).map((_, i) => file('c' + i + '.jpg')));
  ok('the loose bucket still stops at eight', c.formData.photos.length === 8);
  await pick(c, [file('doorway.jpg')], 'wide');
  ok('THE WIDE SHOT IS NEVER REFUSED FOR BEING OVER THE COUNT',
    c.formData.photos.length === 9 && c.formData.photos.some(p => p.slot === 'wide'), 'have ' + c.formData.photos.length);
}
{
  const c = mkctx();
  await pick(c, [file('close.jpg')]);
  ok('loose photos are filed as "other"', c.formData.photos[0].slot === 'other');
  ok('the nudge appears when there is no wide shot',
    /doorway/.test(c.el['shot-nudge'].textContent) && / on/.test(' ' + c.el['shot-nudge'].className),
    c.el['shot-nudge'].textContent);
  await pick(c, [file('doorway.jpg')], 'wide');
  ok('...and clears once it arrives', c.el['shot-nudge'].textContent === '');
}
{
  const c = mkctx();
  vm.runInContext('renderShotGrid()', c);
  const g = c.el['shot-grid'].innerHTML;
  ok('four tiles, four inputs', (g.match(/class="shot(?: filled)?"/g) || []).length === 4 && (g.match(/type="file"/g) || []).length === 4);
  ok('the wide shot is flagged as the one that matters', (g.match(/Matters most/g) || []).length === 1);
  ok('every tile says where to stand', /doorway/.test(g) && /tape measure/.test(g));
  ok('nothing is said before any photo exists', c.el['shot-nudge'].textContent === '');
}
{
  const c = mkctx();
  await pick(c, [file('doorway.jpg')], 'wide');
  await pick(c, [file('loose.jpg')]);
  vm.runInContext('removeShot(0)', c);
  ok('a named shot can be removed from its tile',
    c.formData.photos.length === 1 && c.formData.photos[0].slot === 'other', JSON.stringify(c.formData.photos.map(p => p.slot)));
  ok('...and the tile goes back to empty', !/class="shot filled"/.test(c.el['shot-grid'].innerHTML));
}
{
  /* The loose grid indexes into formData.photos. If it used the filtered index
     the wrong photo would be deleted — a real hazard now that the list holds
     both kinds. */
  const c = mkctx();
  await pick(c, [file('doorway.jpg')], 'wide');
  await pick(c, [file('one.jpg')]);
  await pick(c, [file('two.jpg')]);
  const html = c.el['photo-preview'].innerHTML;
  ok('the loose grid shows only the loose ones', (html.match(/photo-thumb/g) || []).length === 2, html.slice(0, 200));
  ok('...and its remove buttons point at the REAL index, not the filtered one',
    /splice\(1,1\)/.test(html) && /splice\(2,1\)/.test(html) && !/splice\(0,1\)/.test(html), html.slice(0, 400));
}
{
  const c = mkctx();
  await pick(c, [file('plan.pdf', 'application/pdf')], 'other');
  ok('a PDF still goes through the loose path untouched',
    c.formData.photos.length === 1 && c.formData.photos[0].kind === 'file');
}

/* ── it reaches the server ──────────────────────────────────────────────── */
console.log('\nthe slot survives the trip to the estimator\n');
ok('the upload keeps the slot on each link', /slot:p\.slot\|\|'other'/.test(HTML));
ok('...on the already-a-URL path too', (HTML.match(/slot:p\.slot\|\|'other'/g) || []).length >= 2);
ok('photos still travel in the submitted payload', /photos:photos/.test(HTML));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
})();
