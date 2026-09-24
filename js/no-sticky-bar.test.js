/* no-sticky-bar.test.js — run: node js/no-sticky-bar.test.js
 *
 *   "Let's remove header which stays when scrolling. Astoria 2 bedroom
 *    renovation and price"
 *
 * The sticky bar (estimate number, title, price) that followed the customer
 * down the page is gone. The title and the total are still in the hero at
 * the top and in "Your estimate".
 */
const fs = require('fs'), path = require('path');
const Q = fs.readFileSync(path.join(__dirname, '..', 'quote.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const renders = (Q.match(/function render(V7|Legacy)\(r\)\{[^\n]*/g) || []);
ok('both renders found', renders.length === 2);
ok('THE STICKY BAR IS NOT RENDERED on the estimate page (either layout)', renders.every((r) => r.indexOf('pinHtml(') === -1) && renders.every((r) => /app\.innerHTML=`<section class="hero">/.test(r)));
ok('...nothing else calls it', (Q.match(/pinHtml\(/g) || []).length === 1);
ok('the title and the total are still at the top of the page', renders.every((r) => /<h1>\$\{E\(e\.projectTitle\|\|rq\.service\|\|'Renovation Estimate'\)\}<\/h1>/.test(r) && /<small>Total<\/small>/.test(r)));
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
