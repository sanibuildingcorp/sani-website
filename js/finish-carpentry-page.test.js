/* finish-carpentry-page.test.js — run: node js/finish-carpentry-page.test.js
 *
 *   "Build the finish carpentry and millwork page"
 *   "Where do i have to see link for bid analyzer?"
 *
 * The page for "finish carpentry" (2,900 searches a month, low difficulty),
 * "trim carpenter", "millwork installation" and "custom millwork NYC" - with a
 * section for general contractors and developers, the multifamily cabinet and
 * finish work he wants to bid. Real photos only, no prices, no made-up claims.
 * And the Bid Analyzer is one tap away in the dashboard.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

const P = read('finish-carpentry-millwork.html');
const text = P.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');

console.log('\n1. the page, for the searches\n');
ok('TITLE AND H1 SAY "FINISH CARPENTRY & MILLWORK INSTALLATION NYC"', /<title>Finish Carpentry &amp; Millwork Installation NYC \| Sani Building Corp<\/title>/.test(P) && /<h1>Finish Carpentry &amp; Millwork <em>Installation NYC<\/em><\/h1>/.test(P));
ok('the description names trim, baseboards, crown molding, built-ins, casework', /<meta name="description" content="Finish carpentry and millwork installation in NYC: trim, baseboards, crown molding, built-ins, casework and cabinets/.test(P));
ok('its own canonical address, indexable with full snippets', /<link rel="canonical" href="https:\/\/www\.sanibuildingcorp\.com\/finish-carpentry-millwork">/.test(P) && /max-snippet:-1, max-image-preview:large/.test(P));
ok('Service, breadcrumb and FAQ schema', /"@type": "Service", "name": "Finish Carpentry & Millwork Installation NYC"/.test(P) && /"@type": "BreadcrumbList"/.test(P) && /"@type": "FAQPage"/.test(P));
const faqQs = (P.match(/"@type": "Question", "name": "([^"]+)"/g) || []).map((m) => m.split('"name": "')[1].slice(0, -1));
ok('every FAQ in the schema is also on the page, word for word (' + faqQs.length + ')', faqQs.length >= 6 && faqQs.every((q) => P.indexOf('<div class="faq-q">' + q + '</div>') !== -1));
ok('the words people search: trim carpenter, baseboards, casings, crown, wainscoting, millwork, casework', ['trim', 'baseboards', 'casings', 'crown molding', 'wainscoting', 'millwork', 'casework', 'built-ins'].every((w) => new RegExp(w, 'i').test(text)));

console.log('\n2. for general contractors\n');
ok('A SECTION FOR GCs AND DEVELOPERS: multifamily finish carpentry and cabinet installation', /id="for-contractors"/.test(P) && /Multifamily Finish Carpentry &amp; <em>Cabinet Installation<\/em>/.test(P));
ok('...install only or supply and install; built from shop drawings', /Install only or supply and install/.test(P) && /shop drawings and elevations/.test(P));
ok('...his own promise: every finished kitchen inspected, damage fixed, French polishing', /Every finished kitchen is inspected/.test(P) && /exact color matching and French polishing/.test(P));
ok('...a bid invitation goes straight to his email', /href="mailto:contact@sanibuildingcorp\.com\?subject=Bid%20invitation/.test(P));

console.log('\n3. only true things\n');
ok('never "licensed", no TV mounting', !/licensed/i.test(P) && !/\btv\b/i.test(text));
ok('no price anywhere - estimates are written per job', !/\$\s?\d/.test(text));
ok('the review count is the real one, 68', (text.match(/\b(\d+) (?:Google )?Reviews\b/gi) || []).every((m) => /68/.test(m)) && /68/.test(text));
ok('no project counts or years invented', !/\d+\+?\s*(projects|kitchens installed|years)/i.test(text));
const imgs = Array.from(new Set((P.match(/(?:src|data-full)="(images\/[^"]+)"/g) || []).map((m) => m.split('"')[1])));
const missing = imgs.filter((f) => !fs.existsSync(path.join(ROOT, f)));
ok('every photo on the page exists (' + imgs.length + ')', imgs.length >= 12 && missing.length === 0, missing.join(', '));
ok('real job photos only: his cabinet work, the stair and the furniture repair', imgs.every((f) => /^images\/(cabinet-work|carpentry\/(stair-restoration|expert-finish-carpentry-services-in-new--3|furniture-repair-french-polish)|kitchen-cabinet-installation\/google-review)/.test(f)), imgs.join(', '));
ok('the gallery fills its rows (a big photo + 8)', (P.match(/<li class="cw-item cw-big"/g) || []).length === 1 && (P.match(/<li class="cw-item"/g) || []).length === 8);

console.log('\n4. found from the rest of the site\n');
ok('the menu (computer and phone), the footer', (read('partials/menu.html').match(/href="\/finish-carpentry-millwork"/g) || []).length === 2 && /href="\/finish-carpentry-millwork"/.test(read('partials/footer.html')));
ok('the carpentry page and the kitchen cabinet page link to it', /href="\/finish-carpentry-millwork"/.test(read('carpentry.html')) && /href="\/finish-carpentry-millwork"/.test(read('kitchen-cabinet-installation.html')));
ok('sitemap, llms.txt, and the .html address redirects to the clean one', /<loc>https:\/\/www\.sanibuildingcorp\.com\/finish-carpentry-millwork<\/loc>/.test(read('sitemap.xml')) && /\(https:\/\/www\.sanibuildingcorp\.com\/finish-carpentry-millwork\)/.test(read('llms.txt')) && /^\/finish-carpentry-millwork\.html\s+\/finish-carpentry-millwork\s+301!$/m.test(read('_redirects')));

console.log('\n5. the Bid Analyzer from the dashboard\n');
const D = read('dashboard.html');
ok('A "BIDS" BUTTON IN THE DASHBOARD TOP BAR', /<a href="\/bid-analyzer\.html" class="topbar-btn">📐 Bids<\/a>/.test(D));
ok('...and "Bid Analyzer" in the phone menu', /<a id="menu-bids" href="\/bid-analyzer\.html"[^>]*>📐 Bid Analyzer<\/a>/.test(D));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
