/* home-restyle.test.js — run: node js/home-restyle.test.js
 *
 *   "Maybe we can redesign current home page with fonts, cards and other
 *    cosmetics but keep original wordings and structure?"
 *
 * ops/home-restyle.py adds new fonts, one hand-drawn icon set and a card /
 * button stylesheet to index.html. Words, sections, links and images stay.
 */
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const IDX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SPRITE = fs.readFileSync(path.join(ROOT, 'partials/home-icons.svg'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const BLOCKS = /<!-- RESTYLE-[A-Z]+:START -->[\s\S]*?<!-- RESTYLE-[A-Z]+:END -->/g;
const words = (s) => s.replace(BLOCKS, '').replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

console.log('\n1. On the page, once, and the build is repeatable\n');
ok('fonts, icons and the stylesheet are each in once', ['FONTS', 'ICONS', 'CSS'].every((k) => (IDX.match(new RegExp('<!-- RESTYLE-' + k + ':START -->', 'g')) || []).length === 1));
ok('the stylesheet comes LAST, so it wins over the older blocks', IDX.lastIndexOf('<style') === IDX.indexOf('<style id="home-restyle">'));
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'restyle-'));
  fs.mkdirSync(path.join(dir, 'ops')); fs.mkdirSync(path.join(dir, 'partials'));
  ['ops/home-restyle.py', 'partials/home-restyle.css', 'partials/home-icons.svg'].forEach((f) => fs.copyFileSync(path.join(ROOT, f), path.join(dir, f)));
  fs.writeFileSync(path.join(dir, 'index.html'), IDX);
  cp.execSync('python3 ops/home-restyle.py', { cwd: dir });
  ok('RUNNING THE BUILD AGAIN CHANGES NOTHING (edit the partials, then run it)', fs.readFileSync(path.join(dir, 'index.html'), 'utf8') === IDX);
  fs.writeFileSync(path.join(dir, 'index.html'), IDX.replace(BLOCKS, ''));
  cp.execSync('python3 ops/home-restyle.py', { cwd: dir });
  const rebuilt = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  ok('...and from a page without it, the build gives the same page back (blank lines aside)', rebuilt.replace(/\n+/g, '\n') === IDX.replace(/\n+/g, '\n'));
  ok('THE BUILD NEVER CHANGES A WORD: the text is the same with and without it', words(rebuilt) === words(IDX.replace(BLOCKS, '')) && words(IDX).length > 9000);
}

console.log('\n2. Fonts\n');
const own = IDX.replace(BLOCKS, '');
const oldSel = [];
(own.match(/<style[^>]*>[\s\S]*?<\/style>/g) || []).join('').replace(/\/\*[\s\S]*?\*\//g, '').replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel, body) => { if (/Playfair|DM Sans/.test(body) && !/^\s*@/.test(sel)) sel.split(',').forEach((s) => { s = s.trim(); if (s && !oldSel.includes(s)) oldSel.push(s); }); return m; });
const style = IDX.match(/<style id="home-restyle">([\s\S]*?)<\/style>/)[1];
ok('EVERY SELECTOR THAT ASKED FOR PLAYFAIR OR DM SANS IS RE-POINTED', oldSel.length >= 30 && oldSel.every((s) => style.indexOf(s) !== -1), oldSel.filter((s) => style.indexOf(s) === -1).join(' | '));
ok('...at Archivo for headings and Source Sans 3 for text, loaded in <head>', /family=Archivo[^"]*family=Source\+Sans\+3/.test(IDX) && IDX.indexOf('<!-- RESTYLE-FONTS:START -->') < IDX.indexOf('</head>') && /'Archivo',[^;]*!important/.test(style) && /'Source Sans 3',[^;]*!important/.test(style));

console.log('\n3. One icon set\n');
const used = [...new Set([...IDX.matchAll(/<use href="#(r-[a-z]+)"\/>/g)].map((m) => m[1]))];
const drawn = [...SPRITE.matchAll(/<symbol id="(r-[a-z]+)"/g)].map((m) => m[1]);
ok('every icon used is drawn, and every drawn icon is used', used.every((u) => drawn.includes(u)) && drawn.every((d) => used.includes(d)), 'missing ' + used.filter((u) => !drawn.includes(u)) + ' unused ' + drawn.filter((d) => !used.includes(d)));
const slots = ['hstat-icon', 'value-icon', 'why-feat-col-icon', 'cta-info-item', 'msvc'];
ok('THE STAT, VALUE, WHY-US, CTA AND SERVICE-STRIP ICONS ARE ALL THE NEW SET', slots.every((c) => { const all = [...IDX.matchAll(new RegExp('class="' + c + '">\\s*(<svg[^>]*>)', 'g'))]; return all.length > 0 && all.every((m) => /class="ri"/.test(m[1])); }));
ok('...each chosen by its words: Fully Insured is the shield, Decks the deck, Water Damage the drop', /<svg class="ri"[^>]*><use href="#r-shield"\/><\/svg>\s*<\/div>\s*<div class="hstat-label">Fully Insured/.test(IDX) && /#r-deck"\/><\/svg><span>Decks</.test(IDX) && /#r-water"\/><\/svg><span>Water Damage</.test(IDX));
ok('one line style for all of them', /svg\.ri\{fill:none!important;stroke-width:1\.7!important;stroke-linecap:round!important/.test(style));

console.log('\n4. Cards and the rest\n');
ok('numbers and value icons lose their circles', /\.process-num\{background:none!important;border:0!important;border-radius:0!important/.test(style) && /\.value-icon\{background:none!important;border:0!important;border-radius:0!important/.test(style));
ok('cards share one corner radius', ['svc-card', 'review-card', 'faq-item', 'gallery-item'].every((c) => new RegExp('\\.' + c + '\\{border-radius:var\\(--rs-r\\)!important').test(style)));
ok('the accent words and eyebrows stand upright (no gold italics)', /h2 em,html body h3 em,html body \.hero-tagline span\{font-style:normal!important\}/.test(style) && /\[class\*="eyebrow"\][^{]*\{font-style:normal!important\}/.test(style));
ok('never "licensed", never TV mounting in what was added', !/licens|\btv\b|television/i.test(style + SPRITE));

console.log('\n5. The hero: our own room, dark, white words\n');
ok('THE HERO PHOTO IS OUR OWN FINISHED ROOM (cut from the own-work collage), light and preloaded', /<img class="hero-img" src="images\/hero\/home-hero-room\.webp\?v=\d+"[^>]*width="853" height="558"[^>]*fetchpriority="high"/.test(IDX) && fs.statSync(path.join(ROOT, 'images/hero/home-hero-room.webp')).size < 60 * 1024);
ok('ON A PHONE THE HERO IS OUR SAGE-TILE BATHROOM (portrait, sharp on a phone), preloaded for phones only; computers keep the room, preloaded for computers only', /<picture><source media="\(max-width: 899px\)" srcset="images\/home\/sage-tile-bathroom\.jpg\?v=\d+" width="600" height="938"><img class="hero-img"/.test(IDX) && /<link rel="preload" as="image" href="images\/home\/sage-tile-bathroom\.jpg\?v=\d+" media="\(max-width: 899px\)" fetchpriority="high">/.test(IDX) && /<link rel="preload" as="image" href="images\/hero\/home-hero-room\.webp\?v=\d+" media="\(min-width: 900px\)" fetchpriority="high">/.test(IDX));
ok('...and the phone overlay is light enough to see the photo', /\.hero \.hero-scrim\{[^}]*rgba\(9,17,29,\.38\) 45%/.test(style));
ok('...never the old stock PNG (it showed TV mounting)', !/hero-img" src="images\/hero\/home-hero\.png/.test(IDX));
ok('the words sit on a dark overlay, white, with the accent in gold', /\.hero \.hero-scrim\{display:block!important;[^}]*rgba\(9,17,29/.test(style) && /\.hero h1\{color:#fff!important/.test(style) && /\.hero h1 em,html body \.hero h1 \.amp\{color:#dcb46a!important/.test(style));
ok('the stat cards sit under the buttons, never on top of them', /\.hero \.hero-stats\{position:static!important;[^}]*transform:none!important/.test(style));
ok('the words use the full width on a phone (the old narrow column is undone)', /\.hero \.hero-eyebrow,html body \.hero h1,html body \.hero \.hero-tagline,html body \.hero \.hero-sub,html body \.hero \.hero-btn-row\{width:auto!important;max-width:640px!important\}/.test(style));

ok('THE STAT BOX SITS ON THE LINE between the dark photo and the light strip: half on each', /\.hero \.hero-stats\{position:relative!important;z-index:6!important;background:#13233a!important;[^}]*margin-bottom:-64px!important\}/.test(style) && /\.hero \.borough-strip\{position:relative!important;z-index:2!important;padding-top:96px!important\}/.test(style) && /\.hero \.hero-content\{overflow:visible!important/.test(style) && /html body \.hero\{overflow:visible!important\}/.test(style));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
