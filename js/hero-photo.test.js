/* hero-photo.test.js — run: node js/hero-photo.test.js
 *
 *   "For all pages hero background photos are not shows full, how did you
 *    make for home page can you make same for other pages? If you want first
 *    make for bathroom page"
 *
 * The bathroom page's photo was stretched over the whole hero behind a navy
 * tint: on a phone the hero is three screens of words tall, so the photo was
 * zoomed in and mostly hidden. Now, like the homepage, warm charcoal:
 *   - computers: the photo on the right at its own shape, the words on
 *     charcoal on the left fading into it;
 *   - phones: the whole photo, full width at its own height, at the top,
 *     fading into charcoal under the long words.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const H = fs.readFileSync(path.join(ROOT, 'bathroom-renovation.html'), 'utf8');
const phone = (H.match(/@media\(max-width:600px\)\{[\s\S]*?\n\}/) || [''])[0];

console.log('\n1. Bathroom page: the photo shows whole\n');
ok('the hero is warm charcoal (#1c1a18), as on the homepage - not navy', /\.page-hero\{background:#1c1a18\}/.test(H) && !/\.page-hero-bg-blur::after\{[^}]*rgba\(10,22,40/.test(H));
ok('COMPUTERS: the photo sits on the right at its own shape (full height, width by its shape, at least 45%)', /\.page-hero-bg-blur img\{position:absolute;top:0;right:0;height:100%;width:auto;min-width:45%;max-width:none;object-fit:cover\}/.test(H));
ok('...the words on solid charcoal, fading into the photo', /\.page-hero-bg-blur::after\{content:"";position:absolute;inset:0;background:linear-gradient\(90deg,#1c1a18 0%,#1c1a18 50%,rgba\(24,22,20,\.45\) 64%,rgba\(24,22,20,\.08\) 100%\)\}/.test(H));
ok('PHONES: the whole photo, full width at its own height - nothing cropped', /\.page-hero-bg-blur img\{width:100%;height:auto;min-width:0\}/.test(phone));
ok('...a light tint over it, solid charcoal from where the photo ends (133vw = its height)', /\.page-hero-bg-blur::after\{background:linear-gradient\(180deg,rgba\(24,22,20,\.55\) 0,rgba\(24,22,20,\.30\) calc\(60vw\),rgba\(24,22,20,\.78\) calc\(133vw - 90px\),#1c1a18 133vw\)\}/.test(phone));
{
  const m = H.match(/<div class="page-hero-bg-blur"><img src="([^"?]+)[^"]*"[^>]*width="(\d+)" height="(\d+)"/);
  ok('...133vw is right: the photo is ' + (m ? m[2] + 'x' + m[3] : '?') + ', 1.33 times as tall as it is wide', !!m && Math.abs(+m[3] / +m[2] - 1.333) < 0.01 && fs.existsSync(path.join(ROOT, m[1])));
}
ok('...and the words over it keep a soft shadow, so they stay readable on the light walls', /\.page-hero-text h1,\.page-hero-text p\.tagline,\.hero-rating-pill\{text-shadow:0 1px 14px rgba\(0,0,0,\.6\)\}/.test(phone));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
