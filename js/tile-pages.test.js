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

/* ══ THE HUB PAGE THAT FEEDS THEM ═════════════════════════════════════════
   /services is where a visitor picks a trade, and it carried nine <img> cards
   pointing at files that were never uploaded — with no fallback at all, so they
   rendered as broken-image icons rather than as the wrong photo. Three of the
   nine were the tile cards themselves: Tile Installation, Commercial Tile and
   Grout Repair, the three links into the pages fixed above. A visitor arriving
   to choose a tile contractor was shown three broken boxes.

   Filled from the folder each service already owns. flooring.html's tile slot
   got the same treatment; its other six slots (hardwood, LVP, carpet,
   refinishing, subfloor, team) still fall back to stock because there are no
   photographs of that work in the repository to use instead. That is reported,
   not papered over — a tile photo standing in for hardwood would be a worse
   lie than the stock photo it replaced. */
console.log('\nthe services hub page renders, and its tile cards work\n');
{
  const SVC = read('services.html');
  const paths = imagePaths(SVC);
  const missing = paths.filter(function (f) { return !fs.existsSync(path.join(ROOT, f)); });
  ok('services.html — every card photo exists on disk', missing.length === 0, missing.join('\n        '));

  /* Anchored on the alt text, because the bg-N filenames say nothing about which
     service a card is for — the whole reason this was easy to miss. */
  [['Tile Installation NYC', 'bg-9'], ['Commercial Tile Installation NYC', 'bg-10'], ['Grout Repair and Regrouting NYC', 'bg-11']]
    .forEach(function (pair) {
      /* The (\?v=\d+)? is not optional decoration: these src values carry a
         cache-buster, and an assertion that forbids one passes today and fails
         the next time the buster is bumped. */
      const re = new RegExp('images/services/' + pair[1] + '\\.jpg(\\?v=\\d+)?"[^>]*alt="' + pair[0]);
      ok('services.html — the "' + pair[0].replace(' — Sani Building Corp', '') + '" card still points at ' + pair[1],
        re.test(SVC));
      ok('...and ' + pair[1] + '.jpg is on disk', fs.existsSync(path.join(ROOT, 'images/services/' + pair[1] + '.jpg')));
    });

  ok('services.html — no card is the forty-folder placeholder',
    paths.every(function (f) { return !/\/project-1\.jpg$/.test(f); }));
}
{
  const FL = read('flooring.html');
  ok('flooring.html — the TILE slot is a real photo now, not stock',
    fs.existsSync(path.join(ROOT, 'images/flooring/tile.jpg')) &&
    /src="images\/flooring\/tile\.jpg(\?v=\d+)?" alt="[^"]*"\s*>/.test(FL));
  /* This line used to assert the OPPOSITE — that six slots were still on stock,
     as a reminder to come back to them. They have been filled from Sani's own
     photographs, so the reminder becomes the guarantee. */
  ok('flooring.html — no slot serves stock any more',
    (FL.match(/unsplash/g) || []).length === 0, (FL.match(/unsplash/g) || []).length + ' remaining');
}

/* ══ THE PICTURE ON EVERY LINK HE SENDS ═══════════════════════════════════
   Found while finishing the tile work, and worth more than any of it: THIRTY-ONE
   pages — the homepage among them — set og:image and twitter:image to
   images/<folder>/project-1.jpg, the same placeholder. Every time Zura texted a
   customer a link, or a customer forwarded one, WhatsApp, iMessage, Facebook and
   LinkedIn all drew the preview card with a blank grey box where his work should
   be. It never showed up in the site itself, which is why it survived this long.

   Two older faults surfaced in the same sweep:
     - index.html asked for images/hero/home-hero.PNG while the file on disk is
       home-hero.png. Case-insensitive on a Mac, a 404 on Netlify's Linux hosts —
       so the HOMEPAGE preview was broken everywhere but the machine it was
       written on.
     - handyman-manhattan.html pointed at images/handyman/manhattan-hero.jpg,
       which does not exist.

   Every preview now resolves to a real photograph, and this asserts it stays
   that way. The check is deliberately site-wide rather than tile-only: the
   defect was site-wide, and a per-page assertion would not have found it. */
console.log('\nevery page previews a real photo when the link is shared\n');
{
  const pages = fs.readdirSync(ROOT).filter(function (f) { return f.endsWith('.html'); });
  const bad = [], placeholder = [], caseBug = [];
  pages.forEach(function (f) {
    const html = read(f);
    const re = /(?:property="og:image"|name="twitter:image") content="https:\/\/www\.sanibuildingcorp\.com\/(images\/[^"]+)"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const ref = m[1].split('?')[0];
      if (!fs.existsSync(path.join(ROOT, ref))) bad.push(f + ' -> ' + ref);
      if (/\/project-1\.jpg$/.test(ref)) placeholder.push(f);
      /* Compare against the real directory listing: existsSync alone would pass
         on a case-insensitive filesystem and still 404 on Netlify. */
      const dir = path.join(ROOT, path.dirname(ref));
      if (fs.existsSync(dir) && fs.readdirSync(dir).indexOf(path.basename(ref)) === -1) {
        caseBug.push(f + ' -> ' + ref);
      }
    }
  });
  ok('EVERY og:image AND twitter:image ON THE SITE RESOLVES TO A FILE ON DISK',
    bad.length === 0, bad.join('\n        '));
  ok('...and none of them is the placeholder that was in forty folders',
    placeholder.length === 0, Array.from(new Set(placeholder)).join(', '));
  ok('...and every one matches the filename EXACTLY, because Netlify serves from Linux',
    caseBug.length === 0, caseBug.join('\n        '));
  /* The homepage card is a JPEG on purpose. WhatsApp, iMessage and LinkedIn are
     inconsistent about WebP, and a preview that fails is worse than a heavier
     one — while the page itself serves the WebP, where only browsers look. */
  ok('the homepage previews a real photo, as a JPEG the scrapers can all read',
    /property="og:image" content="[^"]*images\/hero\/home-hero-og\.jpg"/.test(read('index.html')));
}

/* ══ NO PAGE SHOWS ANOTHER COMPANY'S WORK ═════════════════════════════════
   122 image slots were serving Unsplash stock photographs, each one captioned
   with alt text that said "Sani Building Corp". Another 84 were missing with no
   fallback at all, so they simply rendered broken. Semrush's site audit counted
   the second group as "Broken internal images - 120 pages".
     Both are gone. Every slot is now one of Sani's own photographs, and every
   stock fallback has been deleted rather than left dormant — a missing file must
   fail VISIBLY, because a silent substitution is how 122 slots came to be
   advertising somebody else's kitchens in the first place.
     Where filling a slot meant using a photo from a different borough than the
   page is about, the alt text had its location claim removed. The page title and
   H1 still carry the location keyword; the alt text no longer asserts something
   about the photograph that cannot be checked. */
console.log('\nno page anywhere serves stock photography or a broken image\n');
{
  const pages = fs.readdirSync(ROOT).filter(function (f) { return f.endsWith('.html'); });
  const stock = pages.filter(function (f) { return /unsplash/i.test(read(f)); });
  ok('NOT ONE PAGE ON THE SITE REFERENCES UNSPLASH — in an <img>, a fallback, or a CSS url()',
    stock.length === 0, stock.join(', '));

  const missing = [];
  pages.concat(fs.readdirSync(path.join(ROOT, 'partials')).filter(function (f) { return f.endsWith('.html'); })
    .map(function (f) { return path.join('partials', f); }))
    .forEach(function (f) {
      const html = read(f);
      const seen = new Set();
      let m;
      const re1 = /(?:src|data-img)="(images\/[^"?]+)/g;
      while ((m = re1.exec(html)) !== null) seen.add(m[1]);
      const re2 = /url\(['"]?(images\/[^)'"?]+)/g;
      while ((m = re2.exec(html)) !== null) seen.add(m[1]);
      seen.forEach(function (p) { if (!fs.existsSync(path.join(ROOT, p))) missing.push(f + ' -> ' + p); });
    });
  ok('EVERY IMAGE REFERENCE ON EVERY PAGE RESOLVES TO A FILE ON DISK',
    missing.length === 0, missing.slice(0, 12).join('\n        '));
}

/* ══ THE HOMEPAGE HERO ════════════════════════════════════════════════════
   The old hero was an AI-generated stock collage whose largest panel showed a
   man mounting a television — a service Sani does not offer and has a standing
   rule never to mention. It was the first thing every visitor saw.
     It is now built from six of Zura's own job photographs: a finished
   apartment, large-format tile being set with a level, a marble shower, a
   brownstone stair restoration with his crew on site, a rebuilt roof deck, and a
   waterproofed shower pan. Multi-service, and all of it his. */
console.log('\nthe homepage hero is Sani\'s own work, and light enough to paint fast\n');
{
  const HERO = 'images/hero/home-hero.webp';
  ok('the hero exists and is the WebP the page asks for', fs.existsSync(path.join(ROOT, HERO)));
  const kb = fs.statSync(path.join(ROOT, HERO)).size / 1024;
  ok('...and is under 200 KB, because it is the Largest Contentful Paint on mobile',
    kb < 200, Math.round(kb) + ' KB');
  const old = fs.statSync(path.join(ROOT, 'images/hero/home-hero.png')).size / 1024;
  ok('...and is lighter than the stock collage it replaced',
    kb < old, Math.round(kb) + ' KB vs ' + Math.round(old) + ' KB');
  const IDX = read('index.html');
  ok('the page, the preload hint and the CSS variable all point at the same hero',
    (IDX.match(/images\/hero\/home-hero\.webp/g) || []).length >= 3);
  ok('...and none of them still points at the old PNG',
    !/src="images\/hero\/home-hero\.png/.test(IDX) && !/preload[^>]*home-hero\.png/.test(IDX));
  ok('the hero is still preloaded at high priority — that work was already right',
    /rel="preload" as="image"[^>]*home-hero\.webp[^>]*fetchpriority="high"/.test(IDX));
}

/* ══ THE CACHE STILL HELD THE 404 ═════════════════════════════════════════
   The photos shipped, the deploy went green, and the page still drew six dark
   navy boxes — the card's own onerror fallback, firing because the browser could
   not fetch the image.
     Uploading a file does not un-cache its absence. Every one of these URLs
   returned 404 for months, and the site sits behind Cloudflare with no
   Cache-Control rule for images (netlify.toml sets one for /*.html only), so the
   edge kept serving the cached miss to a page that was, by then, correct.
     A fresh query string makes each one a URL nothing has seen before, so no
   cache anywhere can answer from the old miss. The site already used this
   pattern (?v=1784330406477 elsewhere); it just was not applied to the paths
   that had actually been failing.
     Asserted so a later edit cannot quietly drop the buster off a path whose
   404 may still be sitting in someone's browser. */
console.log('\nthe formerly-missing photos are versioned past the cached 404\n');
{
  const NEEDS_BUSTER = {
    'commercial-tile-installation.html': 'images/commercial-tile-installation/',
    'tile-grouting-restoration.html': 'images/tile-grouting-restoration/',
    'services.html': 'images/services/bg-',
    'flooring.html': 'images/flooring/tile.jpg',
  };
  Object.keys(NEEDS_BUSTER).forEach(function (f) {
    const html = read(f);
    const prefix = NEEDS_BUSTER[f];
    /* src="" only — the og:image tags deliberately stay on a stable URL, because
       a social scraper caches by URL and a changing one re-fetches forever. */
    const re = new RegExp('src="(' + prefix.replace(/[/\-]/g, '\\$&') + '[^"]*)"', 'g');
    const bare = [];
    let m;
    while ((m = re.exec(html)) !== null) {
      if (!/\?v=\d+/.test(m[1])) bare.push(m[1]);
    }
    ok(f + ' — every refilled photo carries a ?v= cache-buster', bare.length === 0, bare.join(', '));
  });
  ok('the og:image tags were left on stable URLs, so social previews are not re-fetched forever',
    !/property="og:image" content="[^"]*\?v=/.test(read('commercial-tile-installation.html')) &&
    !/property="og:image" content="[^"]*\?v=/.test(read('tile-grouting-restoration.html')));
}

/* ══ THE COST PAGE ════════════════════════════════════════════════════════
   The largest easy cluster in this market, and the site had nothing in it:
   "tile installation cost" 4,400/mo at difficulty 13, "tile installation cost
   per square foot" 1,600 at 14, "bathroom tile installation cost" 1,600 at 21.
   Sweeten, Chapter and MyHome hold page one of "bathroom remodel nyc" on cost
   guides alone, and none of them swings a hammer.
     Every figure on the page is one Sani already publishes in his own FAQs —
   $15–$35/sq ft bathroom, $18–$45/sq ft commercial, $8–$15 regrout, $3–$6 clean
   and seal. Nothing was invented. If he corrects a number, it has to be
   corrected in both places, which is what the consistency check below is for. */
console.log('\nthe tile cost page says the same numbers as the rest of the site\n');
{
  const COST = 'tile-installation-cost-nyc.html';
  ok('the cost page exists', fs.existsSync(path.join(ROOT, COST)));
  const C = read(COST);

  ok('its title leads with the exact phrase people search',
    /<title>Tile Installation Cost NYC/.test(C), (C.match(/<title>([^<]*)/) || [])[1]);

  /* The prices must not drift from the service pages they came from. */
  const pairs = [
    ['$15–$35 per square foot', 'bathroom-floor-tile-installation.html', '$15–$35'],
    ['$18–$45 per square foot', 'commercial-tile-installation.html', '$18–$45'],
    ['$8–$15 per square foot', 'tile-grouting-restoration.html', '$8–$15'],
    ['$3–$6 per square foot', 'tile-grouting-restoration.html', '$3–$6'],
  ];
  pairs.forEach(function (p) {
    ok('the ' + p[2] + ' figure matches ' + p[1].replace('.html', ''),
      C.indexOf(p[2]) !== -1 && read(p[1]).indexOf(p[2]) !== -1);
  });

  ok('every schema block on it parses', (function () {
    const blocks = C.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
    if (!blocks.length) return 'no blocks';
    for (let i = 0; i < blocks.length; i++) {
      const body = blocks[i].replace(/^<script type="application\/ld\+json">/, '').replace(/<\/script>$/, '');
      try { JSON.parse(body); } catch (e) { return 'block ' + (i + 1) + ': ' + e.message; }
    }
    return true;
  })() === true);

  ok('it is in the sitemap, or Google has to find it by luck',
    read('sitemap.xml').indexOf('/tile-installation-cost-nyc') !== -1);

  /* A page nothing links to is a page that does not get crawled. */
  const inbound = fs.readdirSync(ROOT).filter(function (f) { return f.endsWith('.html') && f !== COST; })
    .filter(function (f) { return read(f).indexOf('href="/tile-installation-cost-nyc"') !== -1; });
  ok('at least three other pages link to it', inbound.length >= 3, inbound.length + ': ' + inbound.join(', '));

  ok('it reuses the shared menu and footer rather than duplicating them',
    /id="site-menu"/.test(C) && /id="site-footer"/.test(C) && /partials\/site\.js/.test(C));
  ok('THE STANDING RULES HOLD — no "licensed", no TV mounting',
    !/licensed/i.test(C) && !/tv mount/i.test(C));
  ok('...and US spelling, on a New York contractor\'s site',
    !/colour|levelling|whilst|organise/i.test(C));

  /* The reason this page exists at all is that /contact and /gallery were
     flagged for a thin text-to-markup ratio. This one is not thin. */
  const text = C.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  ok('it is mostly words, not markup — the point of a cost guide',
    text.length / C.length > 0.15, (text.length / C.length).toFixed(3) + ' ratio, ' + Math.round(text.length / 1024) + ' KB of text');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
