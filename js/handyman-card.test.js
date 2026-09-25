/* handyman-card.test.js — run: node js/handyman-card.test.js
 *
 *   "Full day handyman i need replace with something relevant ... customers
 *    need to do a lot work in a day and rate is low"
 *
 * The middle price card on /handyman is now "Bathroom Refresh" (the owner's
 * pick), and nothing on the page offers a full handyman day any more.
 */
const fs = require('fs'), path = require('path');
const h = fs.readFileSync(path.join(__dirname, '..', 'handyman.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? 'PASS  ' : 'FAIL  ') + n); };
ok('no "Full Handyman Day" card, no "Book Full Day" button', !/Full Handyman Day|Book Full Day/.test(h));
ok('no "full day" or "full-day" anywhere on the page, the FAQ schema included', !/full[- ]day/i.test(h));
ok('the featured card is Bathroom Refresh', /class="pricing-card featured">\s*<div class="pricing-badge">Our Specialty<\/div>\s*<div class="pricing-name">Bathroom Refresh<\/div>/.test(h));
ok('...free quote, button to the handyman request form', /Get a Bathroom Quote/.test(h) && /href="\/handyman-estimate" class="pricing-btn">Get a Bathroom Quote/.test(h));
ok('the FAQ answer matches in the page and in its schema', (h.match(/single repair<\/strong> to a full bathroom refresh/g) || []).length === 1 && (h.match(/single repair to a full bathroom refresh/g) || []).length === 1);
ok('no "kitchen renovations" offered (kitchen cabinets only)', !/kitchen renovations/i.test(h));
ok('never "licensed", never TV mounting', !/\blicensed\b/i.test(h) && !/\bTV mount/i.test(h));
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
