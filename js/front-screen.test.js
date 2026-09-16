/* front-screen.test.js — run: node js/front-screen.test.js
 *
 *   "i don't need this buttons on front screen"
 *
 * Two buttons floated over the bottom-right of EVERY screen: the gold "Send
 * Estimate Link" (a <button> in the markup, position:fixed) and "➕ NEW INVOICE"
 * (self-injected by a script, also position:fixed). On a phone, with an
 * estimate open, they sat on top of the quote photos and the send row - the
 * screenshot shows both covering step 4.
 *
 * Both are off the page. Neither feature is gone: the same two modals now open
 * from the ☰ menu. This file asserts the removal AND that the replacement
 * actually reaches the real modal and the real function - a menu button that
 * calls something that does not exist is a removal wearing a disguise.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* ══ OFF THE FRONT SCREEN ═════════════════════════════════════════════════ */
console.log('\nnothing floats over the page any more\n');
ok('THE FLOATING "SEND ESTIMATE LINK" BUTTON IS GONE',
  HTML.indexOf('id="send-link-fab"') === -1);
ok('THE FLOATING "NEW INVOICE" BUTTON IS GONE — the script that injected it too',
  HTML.indexOf('sbc-newinv-fab') === -1 && !/b\.innerHTML='➕ NEW INVOICE'/.test(HTML));
ok('no code still tries to show the send-link button on login',
  (HTML.match(/getElementById\("send-link-fab"\)/g) || []).length === 0);
ok('no position:fixed BUTTON is left in the markup at all',
  !/<button[^>]*style="[^"]*position:\s*fixed/.test(HTML),
  ((HTML.match(/<button[^>]*style="[^"]*position:\s*fixed[^"]*"/) || [])[0] || '').slice(0, 120));
ok('...nor one built in script with a fixed cssText',
  !/style\.cssText\s*=\s*'position:fixed[^']*'\s*;\s*document\.body\.appendChild/.test(HTML));

/* ══ AND STILL REACHABLE FROM THE MENU ════════════════════════════════════ */
console.log('\nboth actions live in the ☰ menu and reach the real thing\n');
const drawer = (function () {
  const s = HTML.indexOf('<div id="sbc-drawer"');
  const e = HTML.indexOf('<!-- ===== END MOBILE DRAWER ===== -->', s);
  return s > 0 && e > s ? HTML.slice(s, e) : '';
})();
ok('the drawer was found', drawer.length > 0);

const sendBtn = (drawer.match(/<button id="menu-send-link"[^>]*>/) || [])[0] || '';
const invBtn = (drawer.match(/<button id="menu-new-invoice"[^>]*>/) || [])[0] || '';
ok('SEND ESTIMATE LINK IS IN THE MENU', sendBtn !== '');
ok('NEW INVOICE IS IN THE MENU', invBtn !== '');

ok('the send-link menu button opens the SAME overlay the floating one did',
  sendBtn.indexOf("getElementById('send-link-overlay')") !== -1 && sendBtn.indexOf("display='flex'") !== -1);
ok('...and that overlay still exists on the page',
  HTML.indexOf('<div id="send-link-overlay"') !== -1);
ok('the new-invoice menu button calls sbcOpenNewInv()',
  invBtn.indexOf('sbcOpenNewInv()') !== -1);
ok('...and sbcOpenNewInv is still defined',
  /function sbcOpenNewInv\(\)/.test(HTML));
ok('...and the invoice modal it opens still exists',
  HTML.indexOf('<div id="sbc-newinv-modal"') !== -1);
ok('both close the drawer first, so the modal is not opened behind it',
  sendBtn.indexOf('sbcCloseDrawer()') !== -1 && invBtn.indexOf('sbcCloseDrawer()') !== -1);
ok('...and sbcCloseDrawer is still defined',
  /function sbcCloseDrawer\(\)/.test(HTML));

/* Run the menu handlers for real against a fake document: every id they touch
   must resolve and every function they call must exist. A typo in an onclick
   attribute is invisible until someone taps it. */
{
  const seen = { ids: [], calls: [] };
  const ctx = {
    document: {
      getElementById: function (id) { seen.ids.push(id); return { style: {} }; },
      body: { style: {} },
    },
    sbcCloseDrawer: function () { seen.calls.push('sbcCloseDrawer'); },
    sbcOpenNewInv: function () { seen.calls.push('sbcOpenNewInv'); },
  };
  vm.createContext(ctx);
  const onclick = (tag) => ((tag.match(/onclick="([^"]*)"/) || [])[1] || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  let err = null;
  try { vm.runInContext(onclick(sendBtn), ctx); vm.runInContext(onclick(invBtn), ctx); } catch (e) { err = e.message; }
  ok('BOTH MENU HANDLERS RUN WITHOUT THROWING', err === null, err || '');
  ok('the send handler reaches the overlay by id', seen.ids.indexOf('send-link-overlay') !== -1, seen.ids.join(', '));
  ok('the invoice handler reaches sbcOpenNewInv', seen.calls.indexOf('sbcOpenNewInv') !== -1, seen.calls.join(', '));
  ok('each closed the drawer', seen.calls.filter(c => c === 'sbcCloseDrawer').length === 2);
}

/* ══ THE FILE THAT TAKES EVERYTHING DOWN ══════════════════════════════════ */
console.log('\nevery script block in dashboard.html still parses\n');
{
  const blocks = HTML.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
  let broken = null;
  blocks.forEach(function (b, i) {
    const body = b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    try { new vm.Script(body); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; }
  });
  ok('all ' + blocks.length + ' blocks parse', broken === null, broken || '');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
