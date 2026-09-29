/* customer-supplies-card.test.js — run: node js/customer-supplies-card.test.js
 *
 *   "In the request form i checked customer supplied but in my dashboard
 *    doesn't shows what customer tick for supply"
 *
 * estimate-request.js saves the ticks on request.customerSupplies, but the
 * request card never printed them. The real custSuppliesHtml runs here, and
 * the request card must call it.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const DASH = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const cut = (name) => { const s = DASH.search(new RegExp('^function ' + name + '\\s*\\(', 'm')); let d = 0; for (let j = DASH.indexOf('{', s); j < DASH.length; j++) { if (DASH[j] === '{') d++; else if (DASH[j] === '}') { d--; if (!d) return DASH.slice(s, j + 1); } } };
const ctx = { String, Array };
vm.createContext(ctx);
vm.runInContext(['esc', 'custSuppliesHtml'].map(cut).join('\n'), ctx);
const html = (req) => ctx.custSuppliesHtml(req);

const h = html({ customerSupplies: ['Door', 'Paint <white>'] });
ok('shows the label "Customer supplies"', /Customer supplies/.test(h), h);
ok('lists every ticked item', /Door/.test(h) && /Paint/.test(h), h);
ok('escapes what the customer typed', /&lt;white&gt;/.test(h) && !/<white>/.test(h), h);
ok('nothing ticked: shows nothing', html({ customerSupplies: [] }) === '' && html({}) === '' && html(null) === '');
ok('blank entries are dropped', html({ customerSupplies: ['', '  '] }) === '');
ok('the request card calls it', /custSuppliesHtml\(req\)/.test(DASH.replace(/^function custSuppliesHtml[^\n]*/m, '')));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
