/* handyman-done.test.js — run: node netlify/functions/lib/handyman-done.test.js */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const D = require(path.join(__dirname, '..', 'handyman-done.js'))._test;
let pass = 0; const ok = (n, c) => { assert.ok(c, n); pass++; };
ok('deposit comes off only when received', D.invoiceNumbers(670, 100, true).balance === 570 && D.invoiceNumbers(670, 100, false).balance === 670);
ok('deposit never more than the price', D.invoiceNumbers(80, 100, true).balance === 0);
const m = D.invoiceEmail({ ref: 'SBC-H-1', customer_name: 'Zurabi Test', customer_address: '3855 Shore Pkwy' }, D.invoiceNumbers(670, 100, true), ['Fix the door'], '');
ok('invoice shows total, deposit, balance, Zelle and the job', /Total: \$670/.test(m.text) && /Deposit received: -\$100/.test(m.text) && /Balance due: \$570/.test(m.text) && /sanibuildingcorp@gmail\.com/.test(m.text) && /Fix the door/.test(m.text) && /Hi Zurabi,/.test(m.text));
ok('review ask has the Google review link and no "licensed"', /g\.page\/r\/CXtX_n13XF6aEBE\/review/.test(D.reviewText({ customer_name: 'Al' })) && !/licensed/i.test(D.reviewText({})));
const H = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'dashboard.html'), 'utf8');
ok('the dashboard shows the Done card when the job is done', /if \(crStage\(b, CR\.job\) === 4\) hdDoneLoad\(b\);/.test(H) && /#handyman-card\.is-done:not\(\.show-brain\) #hb-box\{display:none\}/.test(H));
ok('the same-customer pill ignores hidden test bookings', /if \(!HB_SHOW_TESTS && hbIsTest\(b\)\) return;/.test(H));
console.log('handyman-done: ' + pass + ' pass');
