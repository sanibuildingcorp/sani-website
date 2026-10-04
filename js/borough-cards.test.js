/* borough-cards.test.js — run: node js/borough-cards.test.js
 *
 *   "It's looks like next door and yelp ... cards looks separately workers
 *    offers. I need redesign this with super popular interesting web page
 *    for lets customer choose us and contact us for bathroom renovations!"
 *
 * ops/borough-cards.py writes ONE Sani section: the rating once, a tab per
 * area, one panel per area (photos, our own bathroom text, neighborhoods,
 * "Get my free estimate" + call), and the real Google reviews together.
 * What must stay true: the reviews are real and word for word, nothing
 * invented, every link works.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const H = read('bathroom-renovation.html'), IDX = read('index.html');
const sec = (H.match(/<!-- BOROUGH-CARDS:START -->([\s\S]*?)<!-- BOROUGH-CARDS:END -->/) || [, ''])[1];
const panels = sec.split('<article class="bc-panel').slice(1);
const txt = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const AREAS = ['Brooklyn', 'Manhattan', 'Queens', 'the Bronx', 'Staten Island', 'Long Island'];

console.log('\n1. One Sani section, not a listing site\n');
ok('ONE section on the bathroom page, right after the stats bar', (H.match(/BOROUGH-CARDS:START/g) || []).length === 1 && H.indexOf('<!-- BOROUGH-CARDS:START -->') > H.indexOf('<section class="stats-bar">') && H.indexOf('<!-- BOROUGH-CARDS:START -->') < H.indexOf('<section class="norem-section">'));
ok('the rating and "fully insured" are said ONCE, at the top - not on every card', (sec.match(/68 Google reviews/g) || []).length === 1 && /class="bc-trust"/.test(sec) && !/class="bc-card"/.test(sec));
ok('a tab per area, the first one open', (sec.match(/class="bc-tab[ "]/g) || []).length === 6 && /class="bc-tab on" role="tab"[^>]*aria-selected="true"/.test(sec));
ok('six panels: Brooklyn, Manhattan, Queens, the Bronx, Staten Island, Long Island', panels.length === 6 && AREAS.every((a, i) => new RegExp('<h3>Bathroom (Remodeling|Renovation) (in|on) ' + a + '</h3>').test(panels[i])));
ok('each panel: photos, our bathroom text, neighborhoods, free estimate + call, and the area page', panels.every((c) => (c.match(/<img /g) || []).length >= 3 && /class="bc-seo">Bathroom (remodeling|renovation) (in|on) /.test(c) && /<b>Serving<\/b>/.test(c) && /class="bc-cta" href="#quick-estimate" data-area="[^"]+"/.test(c) && /class="bc-call" href="tel:3322770990"/.test(c) && /class="bc-more" href="\/[a-z-]+"/.test(c)));
ok('"Get my free estimate" picks the area on the quick form, and every area is on that form', /sel\.options\[k\]\.text===a\.getAttribute\('data-area'\)/.test(sec) && panels.every((c) => { const a = c.match(/data-area="([^"]+)"/)[1]; return new RegExp('<select name="borough"[^>]*>[\\s\\S]*?<option>' + a + '</option>').test(H); }));
ok('the quick form sits right after the section', H.indexOf('<!-- QUICK-ESTIMATE:START -->') > H.indexOf('<!-- BOROUGH-CARDS:END -->') && H.indexOf('<!-- QUICK-ESTIMATE:START -->') - H.indexOf('<!-- BOROUGH-CARDS:END -->') < 40);
ok('every "See ..." link goes to a page that exists', panels.every((c) => fs.existsSync(path.join(ROOT, c.match(/class="bc-more" href="\/([a-z-]+)"/)[1] + '.html'))));
const imgs = panels.flatMap((c) => (c.match(/src="(images\/[^"]+)"/g) || []).map((s) => s.slice(5, -1)));
ok('every photo is there and light (under 100 KB), with an alt naming the area', imgs.length >= 18 && imgs.every((p) => fs.existsSync(path.join(ROOT, p)) && fs.statSync(path.join(ROOT, p)).size < 100 * 1024) && panels.every((c, i) => (c.match(/alt="Bathroom remodeling (in|on) ([^"]+) by Sani Building Corp, photo \d"/g) || []).length >= 3));
ok('without JavaScript every panel shows (the hiding is only under .js)', /\.bc-section\.js \.bc-panel:not\(\.on\)\{display:none\}/.test(sec) && !/\.bc-panel\{[^}]*display:none/.test(sec));

console.log('\n2. Nothing invented\n');
const quotes = sec.split('<figure class="bc-rv">').slice(1);
ok('the reviews are real Google reviews from the homepage, word for word, with the reviewer\'s real name', quotes.length === 4 && quotes.every((c) => {
  const q = txt(c.match(/<blockquote>“([\s\S]*?)”<\/blockquote>/)[1]).replace(/…$/, ''), who = txt(c.match(/<figcaption>([\s\S]*?) · Google review<\/figcaption>/)[1]);
  return txt(IDX).indexOf(q) !== -1 && IDX.indexOf('<div class="review-meta-name">' + who + '</div>') !== -1;
}));
ok('...and the section says they are Google reviews', /Quotes are from our Google reviews\./.test(sec));
ok('the neighborhoods are the ones each area page lists', panels.every((c) => { const hoods = txt(c.match(/<b>Serving<\/b> ([^<]*)</)[1]); const page = txt(read(c.match(/class="bc-more" href="\/([a-z-]+)"/)[1] + '.html')); return hoods.split(', ').every((n) => page.indexOf(n) !== -1); }));
ok('no project counts, no prices, no "licensed", no TV mounting, no gas', !/projects in/i.test(sec) && !/\$\d/.test(txt(sec)) && !/licens/i.test(sec) && !/tv mount/i.test(sec) && !/\bgas\b/i.test(txt(sec)));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
