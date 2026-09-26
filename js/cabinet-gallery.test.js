/* cabinet-gallery.test.js — run: node js/cabinet-gallery.test.js
 *
 *   "I will upload all my kitchen cabinets photos and i need add them in all
 *    kitchen cabinet installation pages in right places ... i need those
 *    pages very high professional looks!"
 *
 * The four cabinet pages showed a bathroom, water damage and a staircase in
 * the cabinet cards, and Manhattan's hero was a bathroom. Now: his own
 * photos (images/cabinet-work/), a gallery with a viewer on every page,
 * the cards and heroes on real cabinet work. Photos are resized and carry
 * no phone data (GPS).
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const PAGES = ['kitchen-cabinet-installation.html', 'kitchen-cabinet-installation-brooklyn.html', 'kitchen-cabinet-installation-manhattan.html', 'kitchen-cabinet-installation-queens.html'];
const DIR = path.join(ROOT, 'images/cabinet-work');

/* JPEG: is there an APP1 (Exif) segment before the image data? */
function hasExif(file) {
  const b = fs.readFileSync(file);
  for (let i = 2; i < b.length - 4;) {
    if (b[i] !== 0xFF) return false;
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m === 0xE1 && b.slice(i + 4, i + 8).toString() === 'Exif') return true;
    if (m === 0xDA) return false;
    i += 2 + len;
  }
  return false;
}

console.log('\n1. the photos\n');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.jpg'));
const full = files.filter((f) => !/-sm\.jpg$/.test(f));
ok('15 photos, each with a small copy for the grid', full.length === 15 && full.every((f) => files.indexOf(f.replace(/\.jpg$/, '-sm.jpg')) !== -1), full.length + ' / ' + files.length);
ok('NO PHONE DATA (Exif / GPS) in any of them', files.every((f) => !hasExif(path.join(DIR, f))), files.filter((f) => hasExif(path.join(DIR, f))).join(', '));
ok('small enough to load fast: under 700 KB each, grid copies under 250 KB', full.every((f) => fs.statSync(path.join(DIR, f)).size < 700 * 1024) && files.filter((f) => /-sm\.jpg$/.test(f)).every((f) => fs.statSync(path.join(DIR, f)).size < 250 * 1024));

console.log('\n2. every cabinet page\n');
for (const p of PAGES) {
  const s = fs.readFileSync(path.join(ROOT, p), 'utf8');
  const g = (s.match(/<!-- CABINET WORK GALLERY START -->[\s\S]*?<!-- CABINET WORK GALLERY END -->/) || [''])[0];
  const srcs = [...s.matchAll(/(?:src|data-full)="(images\/cabinet-work\/[^"]+)"/g)].map((m) => m[1]);
  ok(p + ': ONE gallery, id our-work, with the viewer', (s.match(/CABINET WORK GALLERY START/g) || []).length === 1 && /id="our-work"/.test(g) && /class="cw-lb" hidden role="dialog"/.test(g) && /key==='Escape'/.test(g));
  ok(p + ': every photo it names exists', srcs.length > 6 && srcs.every((f) => fs.existsSync(path.join(ROOT, f))), srcs.filter((f) => !fs.existsSync(path.join(ROOT, f))).join(', '));
  ok(p + ': the hero and the share image are real cabinet work', /(?:og:image" content="https:\/\/www\.sanibuildingcorp\.com\/images\/cabinet-work\/[a-z-]+\.jpg")/.test(s) && /twitter:image" content="https:\/\/www\.sanibuildingcorp\.com\/images\/cabinet-work\//.test(s));
  ok(p + ': NO bathroom / water-damage / stairs placeholder left', !/images\/kitchen\/|kitchen-cabinet-installation(?:-[a-z]+)?\/hero\.jpg/.test(s.replace(/<!--[\s\S]*?-->/g, '')));
  ok(p + ': every grid photo has alt text, a size and loads lazily', [...g.matchAll(/<img loading="lazy" decoding="async" src="[^"]+" width="\d+" height="\d+" alt="([^"]+)">/g)].length === (g.match(/class="cw-item/g) || []).length);
  ok(p + ': the captions claim no place, and never "licensed" or TV', !/licensed|\bTV\b/i.test(g) && !/Brooklyn|Manhattan|Queens|Bronx/.test(g.replace(/<p class="cw-sub">[^<]*<\/p>/, '')));
}
const main = fs.readFileSync(path.join(ROOT, PAGES[0]), 'utf8');
ok('the main page has all 15 and the filters; the borough pages link to it', (main.match(/class="cw-item/g) || []).length === 15 && /data-f="progress"/.test(main) && PAGES.slice(1).every((p) => /href="\/kitchen-cabinet-installation#our-work"/.test(fs.readFileSync(path.join(ROOT, p), 'utf8'))));
ok('the six service cards and the why / cta photos on the main page are his photos', (main.match(/<div class="svc-img">\s*<img[^>]+src="images\/cabinet-work\//g) || []).length === 6 && /why-main-photo">\s*<img[^>]+src="images\/cabinet-work\//.test(main) && /cta-photo-strip">\s*<img[^>]+src="images\/cabinet-work\//.test(main));
ok('phones: the big and wide tiles keep their shape (explicit aspect ratios)', /\.cw-item\.cw-big\{grid-column:span 2;grid-row:span 2;aspect-ratio:4\/5\}/.test(main) && /\.cw-item\.cw-wide\{grid-column:span 2;aspect-ratio:8\/5\}/.test(main));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
