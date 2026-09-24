/* print-record.test.js — run: node js/print-record.test.js
 *
 *   "some project may can come down conflict between customer and contractor
 *    and customer need to show proof from conversation, they may need protect
 *    them self and save or print out full estimate with conversation"
 *
 * The page already holds the whole record: the estimate, the scope, every
 * message with its time, the attachments. What it lacked was a way to take it
 * off the screen. One button - Print / save as PDF - and a print layout that
 * turns the scrolling thread window back into the full list, opens every
 * collapsed breakdown, drops the buttons and inputs, and prints each
 * attachment's address next to its name.
 *
 * THE THING THAT WOULD HURT: a "print" that captured the thread as the 420px
 * window shows it - three messages and a scrollbar - is worse than no button,
 * because it looks like the whole record and is not.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const Q = fs.readFileSync(path.join(__dirname, '..', 'quote.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
function ext(name) { const s = Q.search(new RegExp('function ' + name + '\\s*\\(')); if (s < 0) throw new Error('missing ' + name); let d = 0; for (let j = Q.indexOf('{', s); j < Q.length; j++) { if (Q[j] === '{') d++; else if (Q[j] === '}') { d--; if (!d) return Q.slice(s, j + 1); } } }
const PRINT = (Q.match(/@media print\{[\s\S]*?\n\}/) || [''])[0];

console.log('\nthe button has its own row under the go-ahead / request buttons, always in view\n');
/* It started in the Messages card header, small and grey. "Print or save
   button is on conversation and also none visible, we may need add it below
   next to the add photos or file." So: same row, same size and shape as the
   attach button, a solid border so it reads as a button. */
/* Then: "there is no print/save pdf, if i click to request then there is".
   Inside the message box it was hidden until Request changes was pressed. */
ok('THE PRINT BUTTON HAS ITS OWN ROW (printRow), no longer hidden inside the message box',
  /function printRow\(\)\{return'<div class="printrow"><button type="button" class="attach-btn printbtn" onclick="printQuote\(this\)">[^<]*Print \/ save as PDF<\/button><\/div>'\}/.test(Q) &&
  /<label class="attach-btn">[^<]*Add photos or files<input[^>]*><\/label><div class="attach-prev" id="attprev"><\/div>/.test(Q));
ok('...and no longer in the Messages header', !/eyrow/.test(Q.replace(/\.eyrow\{[^}]*\}/, '')) && /id="thread-card"\$\{hide\?' style="display:none"':''\}><div class="ey">Messages<\/div>/.test(Q));
ok('...styled like the attach button, solid border', /\.printbtn\{font:inherit;color:var\(--n-deep\);border-style:solid/.test(Q));
ok('a printed footer names the estimate, the customer, the print time and the live link', /class="printnote">Printed record of estimate \$\{E\(ref\)\} for/.test(Q) && /live copy: \$\{E\(location\.origin\+'\/quote\.html\?ref='/.test(Q));
ok('...and that footer is hidden on screen, shown on paper', /\.printnote\{display:none\}/.test(Q) && /\.printnote\{display:block/.test(PRINT));

console.log('\non paper the thread is the whole conversation\n');
ok('THERE IS A PRINT STYLESHEET', PRINT.length > 0);
ok('THE SCROLLING WINDOW IS OPENED UP — every message prints, not the three that fit', /\.thr\{max-height:none!important;overflow:visible!important[;}]/.test(PRINT));
/* The first printed PDF split a bubble across pages 5 and 6 with
   break-inside:avoid already set: Safari ignores it on a flex ITEM. So the
   rule that matters is the thread becoming a block and each bubble a block. */
ok('A MESSAGE IS NOT SPLIT ACROSS PAGES — the thread is a block on paper, not a flex column',
  /\.thr\{[^}]*display:block!important/.test(PRINT) && /\.msg\{display:block;break-inside:avoid;page-break-inside:avoid/.test(PRINT));
ok('...and the bubbles still sit left and right so who said what stays readable', /\.msg\.me\{margin-left:14%\}/.test(PRINT) && /\.msg\.them\{margin-right:14%\}/.test(PRINT));
ok('buttons, the reply box and the attach control are dropped', /\.panel,\.actions,\.printbtn,\.attach-row,#sendbtn,\.sendnote,[^}]*button\{display:none!important\}/.test(PRINT));
ok('attachment links print their address, since a link on paper is just underlined text', /\.att a::after\{content:" \(" attr\(href\) "\)"/.test(PRINT));
ok('collapsed breakdowns are forced open', /details\{display:block\}/.test(PRINT));

console.log('\nprintQuote() opens every breakdown, prints, and puts them back\n');
{
  const ds = [{ open: false }, { open: true }, { open: false }];
  let printed = 0, listener = null, listeners = {}, timer = null, inserted = null;
  const ctx = {
    Array, document: { querySelectorAll: () => ds, getElementById: () => null, createElement: () => ({ setAttribute() {}, set innerHTML(v) { inserted = v; } }) },
    setTimeout: (fn) => { timer = fn; return 1; },
    window: { print() { printed++; ds.forEach(d => { if (!d.open) throw new Error('a closed breakdown reached print'); }); (listeners.beforeprint || []).forEach(f => f()); }, addEventListener(ev, fn) { if (ev === 'afterprint' && !listener) listener = fn; (listeners[ev] = listeners[ev] || []).push(fn); }, removeEventListener(ev, fn) { if (fn === listener) listener = null; } },
  };
  vm.createContext(ctx); vm.runInContext('let printSeen=false;' + ext('printQuote') + ext('printHelp'), ctx);
  const r = vm.runInContext('printQuote()', ctx);
  ok('EVERY <details> IS OPEN WHEN print() RUNS', printed === 1 && r === true);
  ok('...and an afterprint listener was armed', typeof listener === 'function');
  listener();
  ok('after printing, each breakdown is back the way it was (closed, open, closed)', ds.map(d => d.open).join(',') === 'false,true,false');
  timer();
  ok('A REAL BROWSER FIRED beforeprint, so no help note appears', inserted === null);
}
{
  const ds = [{ open: false }];
  const ctx = { Array, document: { querySelectorAll: () => ds, getElementById: () => null }, setTimeout: () => 0, window: { print() { throw new Error('blocked'); }, addEventListener() {}, removeEventListener() {} } };
  vm.createContext(ctx); vm.runInContext('let printSeen=false;' + ext('printQuote') + ext('printHelp'), ctx);
  let threw = false; try { vm.runInContext('printQuote()', ctx); } catch (e) { threw = true; }
  ok('a browser that refuses print() does not leave the page thrown or the breakdowns open', !threw && ds[0].open === false);
}
console.log('\nan in-app browser (the Gmail app) ignores print() silently - the page says what to do\n');
{
  /* "print / save as pdf button doesn't open / working" - from the email link,
     opened inside the Gmail app. print() returns, nothing happens, no event. */
  let timer = null, inserted = null, where = null;
  const btn = { parentNode: { insertBefore: (el, ref) => { where = ref === btn.nextSibling ? 'after the button' : 'elsewhere'; } }, nextSibling: { id: 'next' } };
  const ctx = {
    Array, document: { querySelectorAll: () => [], getElementById: () => null, createElement: () => ({ setAttribute() {}, set innerHTML(v) { inserted = v; } }) },
    setTimeout: (fn, ms) => { timer = { fn, ms }; return 1; },
    window: { print() { /* silently ignored */ }, addEventListener() {}, removeEventListener() {} }, btn,
  };
  vm.createContext(ctx); vm.runInContext('let printSeen=false;' + ext('printQuote') + ext('printHelp'), ctx);
  vm.runInContext('printQuote(btn)', ctx);
  ok('nothing is said straight away - a real print dialog may still be opening', inserted === null && timer && timer.ms <= 1500);
  timer.fn();
  ok('WHEN NO PRINT EVENT ARRIVED, A NOTE APPEARS UNDER THE BUTTON, worded as a fallback', where === 'after the button' && /^<b>If nothing opened:<\/b>/.test(inserted) && /printing is not available/.test(inserted));
  ok('...saying to tap Allow if Safari asked, or open the page in Safari or Chrome and use Share → Print / Save as PDF', /tap <b>Allow<\/b>/.test(inserted) && /Open in browser/.test(inserted) && /Share → Print/.test(inserted) && /Save as PDF/.test(inserted));
  ok('a print event arriving late (Allow tapped) takes the note away', /const seen=\(\)=>\{printSeen=true;const h=document\.getElementById\('printhelp'\);if\(h&&h\.parentNode\)h\.parentNode\.removeChild\(h\)\}/.test(Q));
  ok('...with a button to copy the page link to paste there', /onclick="copyPageLink\(this\)"/.test(inserted) && /Copy page link/.test(inserted));
  ok('both print buttons hand themselves over, so the note lands next to the one pressed', (Q.match(/onclick="printQuote\(this\)"/g) || []).length === 2);
}
ok('the functions are reachable from the onclick', /window\.printQuote=printQuote;window\.copyPageLink=copyPageLink;/.test(Q));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
