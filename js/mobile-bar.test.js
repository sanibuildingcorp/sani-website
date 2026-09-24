/* mobile-bar.test.js — run: node js/mobile-bar.test.js
 *
 *   "This bathroom page have different bottom contact form"
 *
 * Every public page has one bottom bar on a phone: Contact Us, the phone
 * number, Free Estimate (.mobile-bar). The bathroom page and the three
 * kitchen cabinet borough pages also carried an older bar (.mobile-sticky:
 * Call Now, Upload Photos, Get Estimate) that sat on top of it. It is gone.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && /class="mobile-bar"/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
ok('the standard bar is on the site\'s pages (' + pages.length + ')', pages.length >= 40);
const two = pages.filter((f) => /<div class="mobile-sticky">/.test(read(f)));
ok('NO PAGE HAS A SECOND, DIFFERENT BOTTOM BAR on top of it', two.length === 0, two.join(', '));
ok('...each page has the bar once', pages.every((f) => (read(f).match(/<div class="mobile-bar">/g) || []).length === 1));
['bathroom-renovation.html', 'kitchen-cabinet-installation-brooklyn.html', 'kitchen-cabinet-installation-manhattan.html', 'kitchen-cabinet-installation-queens.html'].forEach((f) =>
  ok(f + ': Contact Us, the phone number, Free Estimate - like every other page', /<div class="mobile-bar">[\s\S]*?Contact Us[\s\S]*?332-277-0990[\s\S]*?Free Estimate/.test(read(f)) && !/Upload Photos<\/a>\s*<a class='estimate'/.test(read(f))));
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
