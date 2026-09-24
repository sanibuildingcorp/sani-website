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
 *
 * Then every other page with a photo behind its words, by ops/hero-photo.js
 * ("Merge it and do the other pages").
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

console.log('\n2. Every other page: the same, written by ops/hero-photo.js\n');
{
  const LEFT = { 'about.html': 'photo in its own box', 'handyman.html': 'photo beside the words', 'kitchen-cabinet-installation.html': 'photo beside the words',
    'bathroom-wall-panels.html': 'before/after slider', 'shower-waterproofing.html': 'photo in its own box', 'painting.html': 'a slideshow, kept' };
  const PRIVATE = ['dashboard.html', 'dashboard-shell.html', 'bid-analyzer.html', 'quote.html', 'invoice.html', 'contract.html', 'agreement.html', 'estimate.html', 'handyman-estimate.html', 'review.html', 'googlee822c2a7421a7276.html', '404.html', 'index.html', 'bathroom-renovation.html'];
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && PRIVATE.indexOf(f) === -1 && !LEFT[f]);
  const blockOf = (h) => { const m = h.match(/<!-- SBC-HERO:START -->([\s\S]*?)<!-- SBC-HERO:END -->/); return m ? m[1] : ''; };
  const none = pages.filter((f) => !blockOf(read(f)));
  ok('EVERY PAGE WITH A PHOTO BEHIND ITS WORDS HAS THE BLOCK (' + pages.length + ' pages), in <head>, once', pages.length >= 30 && none.length === 0 && pages.every((f) => (read(f).match(/SBC-HERO:START/g) || []).length === 1 && read(f).indexOf('SBC-HERO:START') < read(f).indexOf('</head>')), none.join(', '));
  ok('...the pages whose photo is already whole are left alone', Object.keys(LEFT).every((f) => !/SBC-HERO/.test(read(f))));
  const bad = pages.filter((f) => {
    const b = blockOf(read(f)); const url = (b.match(/url\('([^']+)'\) right center\/auto 100% no-repeat/) || [])[1];
    return !url || !fs.existsSync(path.join(ROOT, url.split('?')[0]))
      || !/\{position:relative;isolation:isolate;background:#1c1a18!important\}/.test(b)
      || !/::before\{content:''!important;[^}]*z-index:-1!important/.test(b)
      || !((b.match(/@media\(max-width:899px\)\{[^\n]*/) || [''])[0].indexOf("url('" + url + "') center top/100% auto no-repeat") !== -1);
  });
  ok('EACH: its own photo (the file exists), on the right on a computer, whole at the top on a phone, on warm charcoal', bad.length === 0, bad.join(', '));
  ok('...each phone fade ends where its photo ends (the photo\'s own height/width)', pages.every((f) => { const b = blockOf(read(f)); const r = b.match(/#1c1a18 calc\(([\d.]+)\*100vw\)/); return !!r && +r[1] > 0.3 && +r[1] < 2.5; }));
  ok('never a thumbnail from a strip or card: nothing inside a strip is hidden', pages.every((f) => !/strip-item[^,)]*img/.test(blockOf(read(f)))));
  const centred = ['bathroom-renovation-brooklyn.html', 'renovation-contractor-bronx.html', 'deck-building.html', 'stair-restoration.html'];
  ok('CENTRED WORDS MOVE LEFT ON A COMPUTER, onto the charcoal (e.g. ' + centred.join(', ') + ')', centred.every((f) => /@media\(min-width:900px\)\{html body [^{]+\{max-width:min\(620px,50vw\)!important;margin-left:max\(40px,calc\(\(100vw - 1240px\)\/2\)\)!important;margin-right:auto!important;text-align:left!important\}/.test(blockOf(read(f)))));
  ['renovation-contractor-nassau-county.html', 'renovation-contractor-staten-island.html', 'renovation-contractor-suffolk-county.html'].forEach((f) =>
    ok(f + ': its living-room photo (not a strip thumbnail), and the stats row no longer starts 36px off a phone screen', /url\('images\/renovation-contractor-[a-z-]+\/nyc-luxury-livingroom\.jpg'\)/.test(blockOf(read(f))) && /\.hero-stats\{grid-template-columns:1fr 1fr;padding:24px 0 20px;margin-left:0;margin-right:0\}/.test(read(f))));
}

{
  /* "Try to show full photo in background" - the Manhattan handyman photo is
     wide, so on a computer it fills the whole hero, darkened only behind the
     words; kept outside the generated block so a re-run of the tool leaves it */
  const h = fs.readFileSync(path.join(ROOT, 'handyman-manhattan.html'), 'utf8');
  ok('handyman-manhattan: THE VAN PHOTO FILLS THE WHOLE HERO ON A COMPUTER, dark only on the left', /<!-- SBC-HERO:END -->\n<style id="hero-full">[\s\S]*?@media\(min-width:900px\)\{html body section\.mh-hero::before\{background:linear-gradient\(90deg,rgba\(24,22,20,\.90\) 0%,[^)]*\) 38%,[^)]*\) 58%,[^)]*\) 78%,transparent 100%\),url\('images\/handyman\/manhattan-hero-van\.jpg'\) center 30%\/cover no-repeat/.test(h) && fs.existsSync(path.join(ROOT, 'images/handyman/manhattan-hero-van.jpg')) && /class="mh-hero-img" src="images\/handyman\/manhattan-hero-van\.jpg"/.test(h));
}
{
  /* "In contact page black dark too covers hero background photos": a wide
     photo is a short strip above the words on a phone, so it gets almost no
     tint; a tall photo sits behind the words and keeps the darker one */
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const phoneOf = (f) => (read(f).match(/<!-- SBC-HERO:START -->[\s\S]*?@media\(max-width:899px\)\{([^\n]*)/) || [, ''])[1];
  const ratio = (f) => +((phoneOf(f).match(/#1c1a18 calc\(([\d.]+)\*100vw\)/) || [])[1] || 0);
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && /SBC-HERO:START/.test(read(f)));
  const wide = pages.filter((f) => ratio(f) > 0 && ratio(f) < 0.8), tall = pages.filter((f) => ratio(f) >= 0.8);
  ok('WIDE PHOTOS ON A PHONE ARE BARELY TINTED (' + wide.length + ' pages, contact among them), only their bottom edge fades', wide.length >= 6 && wide.indexOf('contact.html') !== -1 && wide.every((f) => /linear-gradient\(180deg,rgba\(24,22,20,\.08\) 0,rgba\(24,22,20,\.08\) calc/.test(phoneOf(f))));
  ok('...tall photos, behind the words, keep the darker tint', tall.length >= 20 && tall.every((f) => /linear-gradient\(180deg,rgba\(24,22,20,\.55\) 0,/.test(phoneOf(f))));
  ok('small labels on the photo (rating pill, eyebrow, breadcrumb) get a shadow too', pages.every((f) => /\[class\*="pill"\],\[class\*="eyebrow"\],\[class\*="breadcrumb"\]\)\{text-shadow:/.test(read(f))));
  const c = read('contact.html');
  ok('contact on a phone: the hero fits the photo, the words start right under it (no empty dark gap)', /<!-- SBC-HERO:END -->\n<style id="hero-fit">[\s\S]*?@media\(max-width:899px\)\{html body section\.page-hero\{min-height:0!important;align-items:flex-start!important\}html body section\.page-hero \.page-hero-content\{padding-top:calc\(0\.489\*100vw - 68px \+ 14px\)!important\}\}/.test(c));
}
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
