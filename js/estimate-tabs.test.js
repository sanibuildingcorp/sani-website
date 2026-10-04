/* estimate-tabs.test.js — run: node js/estimate-tabs.test.js
 *
 *   "I like how structured in there, each estimates have on top them screen
 *    where i can click and read full texts in mobile version. Estimate, plan,
 *    photos, notes, client, history." (Simplewise) -> "Yes" (Phase 1)
 *
 * The estimate card was one long page in five steps. The same sections now
 * sit behind tabs: Estimate, Scope, Photos, Notes, Messages, Client, History.
 * Nothing inside them changed; History shows record.history, which the
 * server has written for months and the dashboard never showed.
 * (Checked in Chromium: every section lands in a pane, the bar sticks, a
 * redraw keeps the open tab, a scroll to the thread opens Messages.)
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const DASH = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

const start = DASH.indexOf('<!-- ===== ESTIMATE TABS (Phase 1) ===== -->');
const end = DASH.indexOf('<!-- ===== END ESTIMATE TABS ===== -->');
ok('the tabs block is in the dashboard', start > 0 && end > start);
const block = DASH.slice(start, end);
const js = block.slice(block.indexOf('<script>') + 8, block.lastIndexOf('</script>'));

ok('seven tabs, in this order', /key: 'estimate'[\s\S]*key: 'scope'[\s\S]*key: 'photos'[\s\S]*key: 'notes'[\s\S]*key: 'messages'[\s\S]*key: 'client'[\s\S]*key: 'history'/.test(js));
ok('it wraps renderEdit LAST, after the finishing-options and contract wrappers, so every section exists when it sorts them',
  start > DASH.indexOf('<!-- ===== END CONTRACT PANEL ===== -->') && DASH.slice(end).indexOf('renderEdit = function') === -1 && DASH.slice(end).indexOf('renderEdit=function') === -1);
ok('a redraw keeps the tab he had open', /OPEN\[r\.ref\] \|\|/.test(js) && /OPEN\[cr\.ref\] = key/.test(js));
ok('a new request opens on Notes, a priced one on Estimate, one waiting for a reply on Messages', /need \? 'messages' : hasPrice\(r\) \? 'estimate' : 'notes'/.test(js));
ok('anything it does not recognise goes to Estimate, never dropped', /return 'estimate';\s*\}/.test(js));
ok('the Send / Delete / Complete buttons stay outside the tabs', /modal-head \| modal-actions/.test(js));
ok('a scroll to something on a closed tab opens that tab first', /Element\.prototype\.scrollIntoView = function/.test(js));
ok('currentRecord is read as the top-level let it is, not window.currentRecord', /typeof currentRecord !== 'undefined' \? currentRecord : null/.test(js) && !/window\.currentRecord/.test(js));

/* History, run for real */
const ctx = { console, String, Number, Array, Object, Date, Element: function () {}, renderEdit: function () {} };
ctx.Element.prototype.scrollIntoView = function () {};
ctx.window = ctx; vm.createContext(ctx); vm.runInContext(js, ctx);
const items = ctx.etHistoryItems({
  submittedAt: '2026-09-26T12:00:00Z', source: 'email', sentAt: '2026-09-26T16:31:10Z', openedAt: '2026-09-26T18:00:00Z', lastOpenedAt: '2026-09-27T09:00:00Z', openCount: 3, acceptedAt: '2026-09-27T09:05:00Z',
  history: [{ at: '2026-09-26T16:30:00Z', kind: 'sent', text: 'Sent version 1 - total $28,172.92' }, { at: '2026-09-26T15:00:00Z', kind: 'regenerated', text: 'Estimate generated' }],
  invoices: [{ sentAt: '2026-09-28T10:00:00Z', amount: 5000, paidAt: '2026-09-29T10:00:00Z' }],
});
const texts = items.map((h) => h.text);
ok('newest first', items.every((h, i) => i === 0 || String(items[i - 1].at) >= String(h.at)), texts.join(' | '));
ok('the server log is shown as written', texts.includes('Sent version 1 - total $28,172.92') && texts.includes('Estimate generated'));
ok('a sent line already in the log is not repeated from sentAt', texts.filter((t) => /^Sent|sent to the customer/.test(t)).length === 1);
ok('opened, opened again with the count, approved, invoice, paid, received by email', texts.includes('Customer opened the estimate') && texts.includes('Customer opened it again (3 times in all)') && texts.includes('Customer approved the estimate') && texts.includes('Invoice sent - $5,000.00') && texts.includes('Invoice paid') && texts.includes('Request received by email'));
ok('an empty record has no history but the request', ctx.etHistoryItems({}).length === 0 && ctx.etHistoryItems({ submittedAt: '2026-10-04T10:00:00Z' }).length === 1);
ok('history text is escaped before it reaches the page', /esc3\(h\.text\)/.test(js));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
