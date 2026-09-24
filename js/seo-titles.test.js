/* seo-titles.test.js — run: node js/seo-titles.test.js
 *
 * Search Console, 3 months: many people saw these pages, few clicked -
 *   bathroom-renovation-brooklyn 8,043 seen / 7 clicks (position 20)
 *   bathroom-renovation          6,321 / 12 (26)
 *   handyman                     4,821 / 29 (17)
 *   carpentry                    3,874 / 29 (15)
 * The title and description are what a searcher reads before choosing to
 * click. Each now leads with the words people type (Search Console and
 * Semrush: "bathroom remodeling brooklyn", "bathroom renovation nyc",
 * "handyman brooklyn", "carpenter nyc" / "ny carpentry"), fits Google's
 * width, and says only what the page itself says.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const tag = (h, re) => { const m = h.match(re); return m ? m[1].replace(/&amp;/g, '&') : ''; };
const PAGES = {
  'bathroom-renovation-brooklyn.html': [/^Bathroom Remodeling Brooklyn\b/, /remodel/i, /bathroom remodeling in Brooklyn/i],
  'bathroom-renovation.html': [/^Bathroom Renovation & Remodeling NYC\b/, /renovation/i, /bathroom renovation and remodeling across NYC/i],
  'handyman.html': [/^Handyman Brooklyn & NYC \| Same-Day\b/, /handyman/i, /same-day handyman in Brooklyn/i],
  'carpentry.html': [/^Carpenter NYC & Brooklyn \| NY Carpentry\b/, /carpent/i, /carpenter near you in Brooklyn/i],
};
Object.keys(PAGES).forEach((f) => {
  const h = read(f), [T, K, D] = PAGES[f];
  const t = tag(h, /<title>([^<]*)<\/title>/), d = tag(h, /<meta name="description" content="([^"]*)"/);
  ok(f + ': THE TITLE LEADS WITH WHAT PEOPLE SEARCH, and fits Google\'s width', T.test(t) && t.length <= 64, t + ' (' + t.length + ')');
  ok('...the description opens with it too, gives the phone number, and says fully insured', D.test(d) && /\(332\) 277-0990/.test(d) && /fully insured/.test(d) && !/licens/i.test(d) && !/tv mount/i.test(d), d);
  ok('...the share card (Facebook, iMessage, X) says the same title', tag(h, /<meta property="og:title" content="([^"]*)"/) === t && tag(h, /<meta name="twitter:title" content="([^"]*)"/) === t);
  ok('...and the one h1 still names the same service', (h.match(/<h1[\s>]/g) || []).length === 1 && K.test(h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)[1]));
});
const bath = [read('bathroom-renovation.html'), read('bathroom-renovation-brooklyn.html')].map((h) => tag(h, /<meta name="description" content="([^"]*)"/)).join(' ');
ok('no promise the page does not make (the bathroom pages do not mention a warranty, so neither do their descriptions)', !/warrant/i.test(bath));
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
