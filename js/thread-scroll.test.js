/* thread-scroll.test.js — run: node js/thread-scroll.test.js
 *
 *   "In my dashboard conversation is scrolling but in customer side the
 *    conversation getting larger and larger after every new message"
 *
 * The dashboard's conversation lives in a fixed box (.cnv-body, 380px,
 * overflow auto). The customer's thread on the quote page had no box at all:
 * every message made the page longer and pushed the reply box further down.
 * Same treatment now - .thr is a 420px window, opened at the newest message,
 * and re-scrolled after a send so what was just sent is in view.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const Q = fs.readFileSync(path.join(__dirname, '..', 'quote.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
function ext(name) { const s = Q.search(new RegExp('function ' + name + '\\s*\\(')); if (s < 0) throw new Error('missing ' + name); let d = 0; for (let j = Q.indexOf('{', s); j < Q.length; j++) { if (Q[j] === '{') d++; else if (Q[j] === '}') { d--; if (!d) return Q.slice(s, j + 1); } } }

console.log('\nthe customer thread is a fixed, scrolling window\n');
ok('THE THREAD HAS A HEIGHT AND SCROLLS INSIDE IT', /\.thr\{[^}]*max-height:420px;overflow-y:auto/.test(Q), (Q.match(/\.thr\{[^}]*\}/) || [])[0]);
ok('...with momentum scrolling on iOS', /\.thr\{[^}]*-webkit-overflow-scrolling:touch/.test(Q));
ok('the dashboard box it copies is still there for comparison', /\.cnv-body\{[^}]*max-height:380px;overflow-y:auto/.test(fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8')));

console.log('\nit opens at the newest message, and stays there after a send\n');
{
  const el = { scrollTop: 0, scrollHeight: 9999 };
  const ctx = { document: { querySelector: (sel) => sel === '#thread-wrap .thr' ? el : null } };
  vm.createContext(ctx); vm.runInContext(ext('threadScrollBottom'), ctx);
  vm.runInContext('threadScrollBottom()', ctx);
  ok('threadScrollBottom() scrolls the box to its end', el.scrollTop === 9999);
  ctx.document.querySelector = () => null;
  let threw = false; try { vm.runInContext('threadScrollBottom()', ctx); } catch (e) { threw = true; }
  ok('...and is harmless when there is no thread on the page', !threw);
}
ok('render() scrolls the thread after drawing, before handling #reply', /renderLegacy\(r\);threadScrollBottom\(\);replyFromHash\(\)\}/.test(Q));
ok('sending a message re-renders the thread and scrolls it again', /if\(wrap\)wrap\.innerHTML=threadInner\(rec\);\s*threadScrollBottom\(\);/.test(Q));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
