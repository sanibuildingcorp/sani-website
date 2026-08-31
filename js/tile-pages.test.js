/* tile-pages.test.js — run: node js/tile-pages.test.js
 *
 *   "You found real problem about all around tile services and can you fix all
 *    that pages? With title and all sensitive content for better ranking"
 *
 * WHAT WAS ACTUALLY WRONG WITH THE TILE PAGES.
 *
 * Semrush, read live on 31 Aug 2026, said the tile category was failing in three
 * separate ways at once, and only one of them was about words:
 *
 *   1. THE PHOTOS WERE NOT THERE. commercial-tile-installation.html asked for
 *      seven named photographs and images/commercial-tile-installation/ held
 *      exactly one file — project-1.jpg — which turned out to be a single
 *      placeholder image copied into FORTY folders across the site. Same on the
 *      grouting page. Both pages were selling tile work with no tile on them.
 *      commercial-tile-installation ranked 65th. tile-grouting-restoration
 *      ranked for one keyword.
 *
 *   2. THE FALLBACK WAS WORSE THAN THE HOLE. Each missing hero fell back to an
 *      Unsplash stock photograph, so visitors judging Sani's tile work were
 *      looking at somebody else's. That is not a broken image; it is a broken
 *      claim.
 *
 *   3. THE TITLES MISSED THE ONLY EASY KEYWORDS IN THE MARKET. The commercial
 *      tile cluster is the softest target on the whole site —
 *      "commercial tiling contractors" (110/mo, difficulty 2),
 *      "commercial tile installation" (110/mo, difficulty 1),
 *      "commercial tile installers" (90/mo, difficulty 0) — and the page title
 *      contained none of the words "contractors" or "installers".
 *
 * A fourth thing was found on the way and is asserted here too: the pages named
 * Sephora and Ulta in a way that reads as a client list. Nobody should have to
 * argue about whether that was a claim, so the names are gone.
 *
 * THE ONE THAT WOULD HURT MOST: a photo slot pointing at a file that is not on
 * disk. It is invisible in review — the page still renders, because something
 * else loads in its place — and it silently costs the page both its ranking and
 * its credibility. Every referenced path is checked against the filesystem below.
 */
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGES = ['commercial-tile-installation', 'tile-grouting-restoration', 'bathroom-floor-tile-installation'];
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* Every images/… path a page points at, from src="" and from the og/twitter
   content="" tags, with the cache-busting ?v=… stripped. */
function imagePaths(html) {
  const out = new Set();
  const re = /(?:src|content)="(?:https:\/\/www\.sanibuildingcorp\.com\/)?(images\/[^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) out.add(m[1].split('?')[0]);
  return Array.from(out);
}

const HTML = {};
PAGES.forEach((p) => { HTML[p] = read(p + '.html'); });

/* ══ THE ONE THAT WOULD HURT MOST ═════════════════════════════════════════ */
console.log('\nevery photo a tile page asks for is actually on disk\n');
PAGES.forEach(function (p) {
  const missing = imagePaths(HTML[p]).filter(function (f) { return !fs.existsSync(path.join(ROOT, f)); });
  ok(p + ' — no photo slot points at a file that does not exist',
    missing.length === 0, missing.join('\n        '));
});

/* The placeholder is still on disk on purpose — nothing is deleted here — but no
   tile page may point at it, or the page is back to showing one grey image. */
console.log('\nand none of them is the placeholder that was in forty folders\n');
PAGES.forEach(function (p) {
  ok(p + ' — does not serve project-1.jpg',
    imagePaths(HTML[p]).every(function (f) { return !/\/project-1\.jpg$/.test(f); }));
});
{
  const a = fs.readFileSync(path.join(ROOT, 'images/commercial-tile-installation/commercial-tile-installation-nyc.jpg'));
  const b = fs.readFileSync(path.join(ROOT, 'images/commercial-tile-installation/project-1.jpg'));
  ok('the new commercial hero is a different image from the placeholder, not a rename of it',
    !a.equals(b));
}

console.log('\nno stock photography standing in for Sani\'s own work\n');
PAGES.forEach(function (p) {
  ok(p + ' — no Unsplash fallback', HTML[p].indexOf('unsplash') === -1);
});
ok('NO PAGE ANYWHERE ON THE SITE NAMES SEPHORA OR ULTA — it read as a client list',
  fs.readdirSync(ROOT).filter(function (f) { return f.endsWith('.html'); })
    .every(function (f) { return !/Sephora|Ulta/.test(read(f)); }));

/* ══ THE WORDS GOOGLE READS ═══════════════════════════════════════════════ */
console.log('\nthe title tag carries the keywords that are actually winnable\n');
function title(p) {
  const m = HTML[p].match(/<title>([\s\S]*?)<\/title>/);
  return m ? m[1].replace(/&amp;/g, '&').trim() : '';
}
{
  const t = title('commercial-tile-installation');
  ok('commercial tile — the title names CONTRACTORS, the 110/mo keyword at difficulty 2',
    /contractor/i.test(t), t);
  ok('...and still names commercial tile installation, the other 110/mo keyword',
    /commercial tile installation/i.test(t), t);
}
{
  const t = title('tile-grouting-restoration');
  ok('grouting — the title names TILE REPAIR, the 2,900/mo keyword', /tile repair/i.test(t), t);
  ok('...and REGROUTING, which is what people actually type for a shower',
    /regrout/i.test(t), t);
  ok('...and grout repair, 1,300/mo', /grout repair/i.test(t), t);
}
{
  const t = title('bathroom-floor-tile-installation');
  ok('bathroom tile — the exact phrase "tile installation nyc" leads the title, where it counts',
    /^tile installation nyc/i.test(t), t);
}
PAGES.forEach(function (p) {
  const t = title(p);
  ok(p + ' — title fits in a search result rather than being cut off (≤ 60 chars)',
    t.length > 0 && t.length <= 60, t.length + ' chars: ' + t);
});

console.log('\nthe meta description is present, useful, and the right length\n');
PAGES.forEach(function (p) {
  const m = HTML[p].match(/<meta name="description" content="([^"]*)"/);
  const d = m ? m[1] : '';
  ok(p + ' — has a description between 80 and 200 characters',
    d.length >= 80 && d.length <= 200, d.length + ' chars');
});

console.log('\none H1 per page, naming the service\n');
PAGES.forEach(function (p) {
  const h1 = HTML[p].match(/<h1[^>]*>[\s\S]*?<\/h1>/g) || [];
  ok(p + ' — exactly one H1', h1.length === 1, 'found ' + h1.length);
  const text = (h1[0] || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  ok(p + ' — that H1 says "tile" and says "NYC"',
    /tile/i.test(text) && /nyc/i.test(text), text);
});

/* ══ THE STRUCTURED DATA STILL PARSES ═════════════════════════════════════ */
console.log('\nthe schema blocks still parse after being edited by hand\n');
PAGES.forEach(function (p) {
  const blocks = HTML[p].match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  ok(p + ' — has structured data', blocks.length > 0, blocks.length + ' blocks');
  let bad = null;
  blocks.forEach(function (b, i) {
    const body = b.replace(/^<script type="application\/ld\+json">/, '').replace(/<\/script>$/, '');
    try { JSON.parse(body); } catch (e) { if (!bad) bad = 'block ' + (i + 1) + ': ' + e.message; }
  });
  ok(p + ' — every block is valid JSON', bad === null, bad || '');
});
{
  const s = HTML['commercial-tile-installation'];
  ok('the commercial schema claims the contractor and installer service names too',
    /"Commercial Tiling Contractor"/.test(s) && /"Commercial Tile Installers"/.test(s));
  const g = HTML['tile-grouting-restoration'];
  ok('the grouting schema claims shower regrouting and tile repair',
    /"Shower Regrouting"/.test(g) && /"Tile Repair"/.test(g));
}

/* ══ WHAT MUST NOT HAVE BEEN BROKEN ═══════════════════════════════════════ */
console.log('\nnothing that was already working got knocked over\n');
PAGES.forEach(function (p) {
  ok(p + ' — canonical URL intact',
    new RegExp('<link rel="canonical" href="https://www\\.sanibuildingcorp\\.com/' + p + '"').test(HTML[p]));
  ok(p + ' — still loads the shared menu and footer partials',
    /id="site-menu"/.test(HTML[p]) && /id="site-footer"/.test(HTML[p]) && /partials\/site\.js/.test(HTML[p]));
  ok(p + ' — the phone number is unchanged',
    HTML[p].indexOf('332-277-0990') !== -1 || HTML[p].indexOf('3322770990') !== -1);
});
ok('THE WORD "LICENSED" APPEARS ON NONE OF THEM — the standing rule is "fully insured"',
  PAGES.every(function (p) { return !/licensed/i.test(HTML[p]); }));
ok('no page mentions TV mounting',
  PAGES.every(function (p) { return !/tv mount/i.test(HTML[p]); }));

/* Every photo slot must be a real <img> that loads, because the Page Editor only
   makes a photo clickable once it fires `load`. A slot that 404s is a slot Zura
   cannot replace with the tool he is going to use to replace it. */
console.log('\nevery slot is replaceable in the Page Editor\n');
PAGES.forEach(function (p) {
  const imgs = (HTML[p].match(/<img[^>]+src="images\/[^"]+"[^>]*>/g) || []);
  ok(p + ' — has real <img> slots for the editor to find', imgs.length >= 6, imgs.length + ' slots');
  const broken = imgs
    .map(function (t) { const m = t.match(/src="(images\/[^"]+)"/); return m ? m[1].split('?')[0] : null; })
    .filter(function (f) { return f && !fs.existsSync(path.join(ROOT, f)); });
  ok(p + ' — every one of them loads, so every one of them is clickable',
    broken.length === 0, broken.join(', '));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
