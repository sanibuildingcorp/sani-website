/* readable-pages.test.js — run: node js/readable-pages.test.js
 *
 *   "i need in all pages new fonts you set in home page and new page. Easy
 *    for reading old people"
 *
 * Measured in Chromium before: most reading text on the site was 13-14px on
 * a phone. ops/site-readable.js now writes one block into every public page's
 * <head> (the homepage fonts, reading text at least 17px, faint text darker),
 * found from each page's own CSS. This test checks what it left behind; the
 * browser pass that proved 0 pages under 17px, 0 old fonts, 0 cut-off text
 * and 0 sideways scroll is ops/site-readable.js's own run.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

const PRIVATE = ['dashboard.html', 'dashboard-shell.html', 'bid-analyzer.html', 'quote.html', 'invoice.html', 'contract.html',
  'agreement.html', 'estimate.html', 'handyman-estimate.html', 'review.html', 'googlee822c2a7421a7276.html'];
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && PRIVATE.indexOf(f) === -1);
const head = (h) => h.slice(0, h.indexOf('</head>'));
const blockOf = (h) => { const m = h.match(/<!-- SBC-READABLE:START -->([\s\S]*?)<!-- SBC-READABLE:END -->/); return m ? m[1] : ''; };

console.log('\n1. Every public page reads easily\n');
{
  const none = pages.filter((f) => !blockOf(head(read(f))));
  ok('EVERY PUBLIC PAGE (' + pages.length + ') HAS THE READABLE BLOCK, in its <head>, once', pages.length >= 40 && none.length === 0 && pages.every((f) => (read(f).match(/<!-- SBC-READABLE:START -->/g) || []).length === 1), none.join(', '));
  const no17 = pages.filter((f) => !/\{font-size:17px!important;line-height:1\.6!important\}/.test(blockOf(read(f))));
  ok('...each one lifts its reading text to 17px with 1.6 line height', no17.length === 0, no17.join(', '));
  ok('...never smaller than 17 anywhere in the block', pages.every((f) => (blockOf(read(f)).match(/[{;]font-size:(\d+)px/g) || []).every((x) => +x.match(/\d+/)[0] >= 17)));
  const nogrid = pages.filter((f) => /display:\s*grid/.test(read(f)) && !/>\*\{min-width:0\}/.test(blockOf(read(f))));
  ok('...and lets its grid columns shrink, so bigger words wrap instead of pushing past the screen', nogrid.length === 0, nogrid.join(', '));
  ok('the private pages (dashboard, quote, invoice, contract, forms) are not touched', PRIVATE.filter((f) => fs.existsSync(path.join(ROOT, f))).every((f) => !/SBC-READABLE/.test(read(f))));
}

console.log('\n2. The homepage fonts, everywhere\n');
{
  const NEW = 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..100,500..800&family=Source+Sans+3:wght@400;500;600;700&display=swap';
  const noNew = pages.filter((f) => read(f).indexOf(NEW) === -1);
  ok('EVERY PUBLIC PAGE LOADS ARCHIVO + SOURCE SANS 3', noNew.length === 0, noNew.join(', '));
  const old = pages.filter((f) => /fonts\.googleapis\.com\/css2\?family=(Playfair|Bebas)/.test(read(f)));
  ok('...and no longer downloads Playfair Display, DM Sans or Bebas Neue', old.length === 0, old.join(', '));
  const others = pages.filter((f) => f !== 'index.html');
  ok('headings in Archivo, text in Source Sans 3, the old names kept only as a fallback', others.every((f) => { const b = blockOf(read(f)); return /html body\{font-family:'Source Sans 3','DM Sans',system-ui/.test(b) && /h1,h2,h3\)\{font-family:'Archivo','Playfair Display',system-ui/.test(b); }));
  ok('...the gold accent words stand upright, as on the homepage', others.every((f) => /\.italic-accent\{font-style:normal!important\}/.test(blockOf(read(f)))));
  ok('...words styled inline are caught too, the homepage included', pages.every((f) => /\[style\*="Playfair"\],\[style\*="Bebas"\]\)\{font-family:'Archivo'/.test(blockOf(read(f)))));
  const css = read('partials/site.css');
  ok('THE MENU AND FOOTER (partials/site.css) use the same fonts', !/font-family:'Playfair Display',serif/.test(css) && !/font-family:'DM Sans',sans-serif/.test(css) && (css.match(/'Archivo','Playfair Display'/g) || []).length === 3 && (css.match(/'Source Sans 3','DM Sans'/g) || []).length === 4);
  ok('"See the full ... page" links may wrap - bigger words ran them off a phone screen', /\.svc-card-more\{[^}]*white-space:normal/.test(css));
}

console.log('\n3. Nothing else changed\n');
{
  ok('the tool that writes it is in the repo and names its rules', fs.existsSync(path.join(ROOT, 'ops/site-readable.js')) && /const MIN = 17;/.test(read('ops/site-readable.js')));
  ok('never "licensed", on any page', pages.every((f) => !/\blicensed\b/i.test(blockOf(read(f)))));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
