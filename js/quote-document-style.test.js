/* quote-document-style.test.js — run: node js/quote-document-style.test.js
 *
 *   "I like this design, i mean style, can you update in my customer view
 *    design? Nothing change just style"
 *
 * The customer's quote page reads like an estimate document: white paper,
 * a letterhead, navy headings over a thin rule, table-style price rows and
 * service boxes, plain bullets. Only CSS changed; the page's words and
 * buttons are the same.
 */
const fs = require('fs'), path = require('path');
const Q = fs.readFileSync(path.join(__dirname, '..', 'quote.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n); };
const css = (Q.match(/\/\* ══ DOCUMENT STYLE[\s\S]*?<\/style>/) || [''])[0];
ok('the document style block is there, inside the page style', css.length > 1000);
ok('white paper with a letterhead: name, then the contact line', /\.wrap\{background:#fff;max-width:860px/.test(css) && /\.top \.brand::after\{content:"Brooklyn, NY \\00B7  \(332\) 277-0990 \\00B7  contact@sanibuildingcorp\.com"/.test(css));
ok('navy section headings over a thin rule', /\.card>\.ey\{display:block;color:var\(--dn\);font-size:17px;font-weight:700;[^}]*border-bottom:1\.5px solid var\(--dn\)\}/.test(css));
ok('price rows as a table, the total on a light header fill', /\.pr\{border:1px solid var\(--dline\)/.test(css) && /\.pr\.total\{background:var\(--dhead\);color:var\(--dn\)/.test(css));
ok('services as boxed blocks with a light header row, plain bullets', /\.head\{background:var\(--dhead\);color:var\(--dn\)/.test(css) && /\.inlist li:before,\.suplist li:before,\.outlist li:before\{content:'\\2022'/.test(css));
ok('phones and paper handled', /@media\(max-width:600px\)\{[\s\S]*\.wrap\{padding:16px 18px 96px/.test(css) && /@media print\{\s*\.top,\.wrap\{border:0;box-shadow:none/.test(css));
ok('ONLY STYLE: the words on the page are the same (no "licensed", the approve and ask buttons as before)', !/licensed/i.test(css) && /Yes, I'd like to go ahead/.test(Q) && /Request changes \/ ask a question/.test(Q));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
