/* borough-cards.test.js — run: node js/borough-cards.test.js
 *
 *   "What if we build like this layout style bathroom page with borough
 *    multiplayer cards? ... not too ai generated and also informative and
 *    catch visitors"  (a Houzz listing page)
 *   Chosen: a new section on /bathroom-renovation; real Google reviews and
 *   the neighborhoods served - nothing invented.
 *
 * ops/borough-cards.py writes it. What must stay true: every word on a card
 * comes from the site already - no made-up review, no project counts.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const H = read('bathroom-renovation.html'), IDX = read('index.html');
const sec = (H.match(/<!-- BOROUGH-CARDS:START -->([\s\S]*?)<!-- BOROUGH-CARDS:END -->/) || [, ''])[1];
const cards = sec.split('<article class="bc-card">').slice(1);
const txt = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

console.log('\n1. The section\n');
ok('ONE borough section on the bathroom page, right after the stats bar', (H.match(/BOROUGH-CARDS:START/g) || []).length === 1 && H.indexOf('<!-- BOROUGH-CARDS:START -->') > H.indexOf('<section class="stats-bar">') && H.indexOf('<!-- BOROUGH-CARDS:START -->') < H.indexOf('<section class="norem-section">'));
ok('six cards: Brooklyn, Manhattan, Queens, the Bronx, Staten Island, Long Island', cards.length === 6 && ['Brooklyn', 'Manhattan', 'Queens', 'the Bronx', 'Staten Island', 'Long Island'].every((a, i) => new RegExp('<h3>Bathroom (Remodeling|Renovation) (in|on) ' + a + '</h3>').test(cards[i])));
ok('each card: photos that slide, the mark, the rating, badges, a quote box, neighborhoods, and ONE calm link to the area page', cards.every((c) => (c.match(/<img /g) || []).length >= 3 && /class="bc-mark"/.test(c) && /<b>4\.9<\/b><span>\(67 Google reviews\)<\/span>/.test(c) && /Fully insured/.test(c) && /class="bc-quote/.test(c) && /<b>Serving<\/b>/.test(c) && /class="bc-more" href="\/[a-z-]+"/.test(c) && (c.match(/<a /g) || []).length === 1));
/* "Maybe the buttons is too much in every card" - the one estimate button is
   the quick form right under the cards */
ok('...no big estimate button on every card any more; the quick form sits right after the cards instead', !/class="bc-cta"/.test(sec) && H.indexOf('<!-- QUICK-ESTIMATE:START -->') > H.indexOf('<!-- BOROUGH-CARDS:END -->') && H.indexOf('<!-- QUICK-ESTIMATE:START -->') - H.indexOf('<!-- BOROUGH-CARDS:END -->') < 40);
ok('...every "See ..." button goes to a page that exists', cards.every((c) => fs.existsSync(path.join(ROOT, c.match(/class="bc-more" href="\/([a-z-]+)"/)[1] + '.html'))));
const imgs = cards.flatMap((c) => (c.match(/src="(images\/[^"]+)"/g) || []).map((s) => s.slice(5, -1)));
ok('every photo is there, card-sized (720x540) and light (under 100 KB)', imgs.length >= 18 && imgs.every((p) => fs.existsSync(path.join(ROOT, p)) && fs.statSync(path.join(ROOT, p)).size < 100 * 1024), imgs.filter((p) => !fs.existsSync(path.join(ROOT, p))).join(', '));

console.log('\n2. Nothing invented\n');
const reviews = cards.filter((c) => /<blockquote>/.test(c));
ok('the quotes are real Google reviews from the homepage, word for word, with the reviewer\'s real name', reviews.length === 4 && reviews.every((c) => {
  const q = txt(c.match(/<blockquote>“([\s\S]*?)”<\/blockquote>/)[1]).replace(/…$/, ''), who = txt(c.match(/<figcaption>– ([\s\S]*?), Google review<\/figcaption>/)[1]);
  const plain = txt(IDX);
  return plain.indexOf(q) !== -1 && IDX.indexOf('<div class="review-meta-name">' + who + '</div>') !== -1;
}));
ok('...and the section says they are Google reviews', /Quotes are from our Google reviews\./.test(sec));
ok('the other quote boxes use the area page\'s own words', cards.filter((c) => /bc-about/.test(c)).every((c) => { const t = txt(c.match(/<div class="bc-quote bc-about"><p>([\s\S]*?)<\/p>/)[1]); const page = txt(read(c.match(/class="bc-more" href="\/([a-z-]+)"/)[1] + '.html')); return t.split('. ').every((s) => page.indexOf(s.replace(/\.$/, '')) !== -1); }));
ok('the neighborhoods are the ones each area page lists', cards.every((c) => { const hoods = txt(c.match(/<b>Serving<\/b> ([^<]*)</)[1]); const page = txt(read(c.match(/class="bc-more" href="\/([a-z-]+)"/)[1] + '.html')); return hoods.split(', ').every((n) => page.indexOf(n) !== -1); }));
ok('no project counts, no "licensed", no TV mounting', !/projects in/i.test(sec) && !/licens/i.test(sec) && !/tv mount/i.test(sec));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
