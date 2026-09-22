/* google-yes.test.js — run: node js/google-yes.test.js
 *
 *   "I need the AI always read and recommend my business" ... "Then we may
 *    add same text to for google search?"
 *
 * robots.txt says yes to AI assistants (Content-signal, all yes). Google does
 * not read that line; Google's yes is a robots meta tag on each page that
 * allows full text snippets and large images in Search and AI Overviews.
 * Only the home page carried it. Every public page carries it now, and every
 * private page (dashboard, quote, invoice, contract, forms) keeps its noindex.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

const PRIVATE = ['dashboard.html', 'dashboard-shell.html', 'bid-analyzer.html', 'quote.html', 'invoice.html', 'contract.html', 'agreement.html', 'estimate.html', 'handyman-estimate.html', 'review.html', '404.html'];
const VERIFY = ['googlee822c2a7421a7276.html'];
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
const robotsOf = (f) => { const m = fs.readFileSync(path.join(ROOT, f), 'utf8').match(/<meta name="robots" content="([^"]*)"/i); return m ? m[1] : ''; };

const pub = pages.filter((f) => PRIVATE.indexOf(f) === -1 && VERIFY.indexOf(f) === -1);
const missing = pub.filter((f) => !/max-snippet:-1/.test(robotsOf(f)) || !/max-image-preview:large/.test(robotsOf(f)) || /noindex/.test(robotsOf(f)));
ok('EVERY PUBLIC PAGE says yes to Google: index, full snippets, large images (' + pub.length + ' pages)', pub.length >= 40 && missing.length === 0, missing.join(', '));
const leaked = PRIVATE.filter((f) => fs.existsSync(path.join(ROOT, f)) && !/noindex/.test(robotsOf(f)));
ok('EVERY PRIVATE PAGE still says noindex', leaked.length === 0, leaked.join(', '));
ok('the tag sits in the head, once per page', pub.every((f) => { const s = fs.readFileSync(path.join(ROOT, f), 'utf8'); const head = s.slice(0, s.search(/<body/i)); return (s.match(/<meta name="robots"/gi) || []).length === 1 && /<meta name="robots"/i.test(head); }));
const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
ok('robots.txt still says yes to AI assistants, on purpose', /^Content-signal: search=yes, ai-input=yes, ai-train=yes, use=full$/m.test(robots) && /^Allow: \/$/m.test(robots));
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
