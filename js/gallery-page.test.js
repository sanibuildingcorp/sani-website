/* gallery-page.test.js — run: node js/gallery-page.test.js
 *
 *   "Help me and share your ideas too for better elegant gallery page"
 *
 * Photos first, his 15 cabinet photos added, a Commercial filter, captions
 * always on the photo, 2 columns on a phone, and the viewer shows the full
 * photo. The 12 photos that were there keep their captions and alt texts.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const G = fs.readFileSync(path.join(ROOT, 'gallery.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const items = [...G.matchAll(/<div class="gallery-item[^"]*" data-category="([^"]*)" data-title="[^"]*" data-loc="[^"]*" data-img="([^"]*)">\s*<img src="([^"]*)" width="\d+" height="\d+" (?:loading="lazy" )?decoding="async" alt="([^"]+)">/g)];
ok('27 photos: the 12 that were there and his 15 cabinet photos', items.length === 27 && items.filter((m) => m[2].startsWith('images/gallery/')).length === 12 && items.filter((m) => m[2].startsWith('images/cabinet-work/')).length === 15, items.length);
ok('every photo and its grid copy exists', items.every((m) => fs.existsSync(path.join(ROOT, m[2])) && fs.existsSync(path.join(ROOT, m[3]))));
ok('every category has a filter button, Commercial included', [...new Set(items.map((m) => m[1]))].every((c) => G.indexOf('data-filter="' + c + '"') !== -1) && /data-filter="commercial">Commercial<\/button>/.test(G));
ok('PHOTOS FIRST: the grid comes before the words about it', G.indexOf('id="galleryGrid"') < G.indexOf('Real NYC Projects, Photographed on Real Job Sites'));
ok('the viewer opens the full photo, not the grid copy', /lbImg\.src=item\.getAttribute\('data-img'\)\|\|img\.src;/.test(G));
ok('captions always on the photo, 2 columns on a phone, big and wide tiles keep their shape', /\.gallery-overlay\{opacity:1;/.test(G) && /@media\(max-width:900px\)\{\s*\.gallery-grid\{grid-template-columns:repeat\(2,1fr\)!important/.test(G) && /\.gallery-item\.big\{grid-column:span 2;grid-row:span 2;aspect-ratio:4\/5\}/.test(G));
ok('only the first two photos load at once; the rest as you scroll', (G.match(/<img src="[^"]*" width="\d+" height="\d+" decoding="async"/g) || []).length === 2);
ok('no "licensed", no TV mounting', !/licensed|TV mount/i.test(G));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
