/* homepage-links.test.js — run: node js/homepage-links.test.js
 *
 * A cold outreach email arrived claiming two faults on the homepage. One was
 * real, one was not, and the useful part was not the email — it was that neither
 * had any way of being caught.
 *
 *   CLAIM 1, TRUE: the "Interior Renovations" card linked to /painting.
 *   Somebody clicking the words "Interior Renovations" landed on a page about
 *   painting. It was wrong in the visible carousel AND in its duplicate, so it
 *   went past twice on every loop.
 *
 *   CLAIM 2, OVERSTATED: "your form includes visible text that says Don't fill
 *   this out". It is a Netlify spam honeypot and .cf-hp parks it off-screen at
 *   zero height and zero opacity, so no sighted visitor has ever seen it. The
 *   real (smaller) flaw was that a SCREEN READER still announced it, because
 *   off-screen is not hidden from assistive technology.
 *
 * A card whose words and destination disagree is invisible to every check that
 * exists — the link is not broken, the page returns 200, nothing errors. Only a
 * person reading the label and then the href finds it. So that comparison is
 * done here, for every card, on every build.
 */
const fs = require('fs'), path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

const strip = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/* Every card in the scrolling service strip, label against destination. */
const cards = [];
const RE = /<a href="([^"]+)" class="strip-item"[^>]*>[\s\S]*?<div class="strip-label">([\s\S]*?)<\/div>/g;
let m;
while ((m = RE.exec(HTML)) !== null) cards.push({ href: m[1], label: strip(m[2]) });

console.log('\nwhat the card says, and where it actually goes\n');
ok('the service strip was found at all', cards.length >= 10, 'found ' + cards.length);

/* The words a destination must NOT contradict. A card is wrong when its label
   names a service and the href points at a DIFFERENT named service — /services
   is always acceptable, because it is the page listing all of them. */
const SERVICE_PAGES = ['painting', 'flooring', 'carpentry', 'water-damage', 'handyman',
  'bathroom-renovation', 'kitchen-cabinet-installation', 'deck-building',
  'commercial-tile-installation', 'stair-building'];

const mismatched = [];
cards.forEach(function (c) {
  const dest = c.href.replace(/^\//, '').split('?')[0];
  if (dest === 'services' || dest === '') return;          /* the catch-all page is always fair */
  if (!SERVICE_PAGES.includes(dest)) return;               /* not a service page; nothing to contradict */
  /* Does the label mention the service the destination is about? */
  const destWords = dest.split('-');
  const label = c.label.toLowerCase();
  const shares = destWords.some(function (w) { return w.length > 3 && label.includes(w); });
  if (!shares) mismatched.push(c.label + ' -> /' + dest);
});

ok('NO CARD SENDS PEOPLE TO A PAGE ABOUT SOMETHING ELSE',
  mismatched.length === 0, mismatched.join('; '));

/* The specific one that was reported, named so a regression is unmistakable. */
const interior = cards.filter(function (c) { return /interior/i.test(c.label); });
ok('there is an Interior Renovations card', interior.length >= 1);
ok('INTERIOR RENOVATIONS NO LONGER LANDS ON THE PAINTING PAGE',
  interior.every(function (c) { return c.href !== '/painting'; }),
  interior.map(function (c) { return c.label + ' -> ' + c.href; }).join('; '));
ok('...it goes somewhere that actually covers interior work',
  interior.every(function (c) { return c.href === '/services'; }),
  interior.map(function (c) { return c.href; }).join(', '));
ok('...in the duplicated half of the carousel too, or it is still wrong every other loop',
  interior.length === 2, 'found ' + interior.length + ' interior cards');

/* Every destination has to exist as a page. */
console.log('\nevery card points at a real page\n');
const missing = [];
cards.forEach(function (c) {
  const dest = c.href.replace(/^\//, '').split('?')[0];
  if (!dest) return;
  if (!fs.existsSync(path.join(__dirname, '..', dest + '.html'))) missing.push(c.label + ' -> ' + c.href);
});
ok('no card points at a page that does not exist', missing.length === 0, missing.join('; '));

/* ── the honeypot ───────────────────────────────────────────────────────── */
console.log('\nthe spam honeypot\n');
ok('the form still has one — it is what keeps bot submissions out',
  /netlify-honeypot="bot-field"/.test(HTML) && /name="bot-field"/.test(HTML));
ok('it is hidden from sight by CSS, not merely small',
  /\.cf-hp\{[^}]*left:-9999px[^}]*\}/.test(HTML) && /\.cf-hp\{[^}]*height:0/.test(HTML));
ok('THE REAL FLAW: it is now hidden from screen readers too',
  /<p class="cf-hp" aria-hidden="true">/.test(HTML));
ok('...and taken out of the keyboard tab order, so nobody can land in it',
  /name="bot-field" tabindex="-1"/.test(HTML));
ok('...and the browser will not autofill it, which would look like a bot',
  /autocomplete="off"/.test(HTML));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
