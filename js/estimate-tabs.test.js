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

/* "in scope the texts doesn't shows full until i scroll and i need to see always full texts" */
ok('every Scope text box is sized to its whole text when the tab opens, with no inner scroll bar',
  /var GROW = '#f-title, #f-summary, #f-scope, #f-timeline, #scope-control-wrap textarea'/.test(js) && /t\.style\.maxHeight = 'none'; t\.style\.overflowY = 'hidden'/.test(js) && /growIn\(card\.querySelector\('\.et-pane\.on'\)\)/.test(js));
ok('...and again as he types, and when the service cards redraw', /addEventListener\('input', function\(\)\{ fit\(t\); \}\)/.test(js) && /renderScopeControl = function/.test(js));
ok('the project title wraps instead of being cut off, and stays one line of text', /<textarea id="f-title" rows="1"[^>]*replace\(\/\\\\n\/g/.test(DASH));

ok('finishing options sit on the Photos tab', /if \(id === 'sbcf-section'\) return 'photos';/.test(js));
ok('...and redraw where they sit, so adding an option never sends them back to Estimate', /if\(ex && ex\.parentNode\)\{ ex\.parentNode\.replaceChild\(sec,ex\); return; \}/.test(DASH));

ok('service card lines wrap and show in full (a text box, not a one-line field), Enter kept out', /'<textarea class="sc-item" rows="1" oninput="if\(\/\\\\n\/\.test\(this\.value\)\)/.test(DASH) && !/<input class="sc-item"/.test(DASH));

/* "So many yellow is in my dashboard" -> Simplewise style, estimate screen only */
ok('the estimate screen redefines gold as black ("Change to black inside the buttons") and the borders as gray - on #edit-card only', /#edit-card\{--brand:#b8930a;--brand-2:#96770a;--gold:#1a2433;--gold-2:#1a2433;--gold-soft:#f2f4f7;--line:#e2e6ec\}/.test(block) && /:root \{[\s\S]{0,200}--gold: #b8930a;/.test(DASH));
ok('...gold stays on the main buttons (Generate, Send, Edit with AI) and the open tab', /#edit-card \.btn-ai,#edit-card #gen-btn,#edit-card \.btn-primary,#edit-card \.et-ai button\{background:var\(--brand\)!important/.test(block) && /#edit-card \.et-tab\.on\{color:var\(--brand-2\)!important/.test(block));
ok('...titles are navy, not gold', /#edit-card \.modal-head h2,#edit-card h3[^{]*\{color:var\(--ink,#1a2433\)!important\}/.test(block));

/* "In simplewise are more clear understandable" -> the clear view */
ok('Estimate tab: a card per service with its lines (item, qty x rate, amount, a hammer on labor), then Materials / Labor / Total', /function estimateView\(r\)/.test(js) && /' × ' \+ money\(rt\)/.test(js) && /title="Labor">🔨/.test(js) && /Materials<b>' \+ money\(matT\)/.test(js));
ok('...the markup and the total, and what the customer sees when it differs', /<h4>Other<\/h4>[\s\S]{0,200}Markup/.test(js) && /The customer sees <b>/.test(js));
ok('Scope tab: the customer\'s cards as plain bullets, You supply / Not included under them', /function scopeView\(r\)/.test(js) && /You supply<\/div>/.test(js) && /Not included<\/div>/.test(js));
ok('the old tools are folded under the view, not removed; Generate stays out', /fold\(panes\.estimate, 'et-more-est'[^)]*aiBar \? \[aiBar\] : \[\]\)/.test(js) && /fold\(panes\.scope, 'et-more-scope'/.test(js));
ok('the pencil opens the place it is edited; a scroll into a fold opens it', /window\.etEditLines = function/.test(js) && /window\.etEditScope = function/.test(js) && /closest\('#edit-card details\.et-more'\)/.test(js));
ok('the views follow edits (typed prices, card changes)', /recalc = function\(\)\{ var out = _rc\.apply/.test(js) && /refreshViews\(\); \} catch/.test(js));
ok('the bullets are escaped; only **bold** is turned into bold', /function md\(t\)\{ return esc3\(t\)\.replace/.test(js));

ok('outline buttons have black words and a gray border; filled buttons (gold, red, white text) keep theirs', /#edit-card button:not\(\.et-tab\)[^{]*:not\(\[style\*="color:#fff"\]\)[^{]*\{color:#1a2433!important;border-color:#cfd5de!important\}/.test(block));

/* History, run for real */
const ctx = { console, String, Number, Array, Object, Date, Element: function () {}, renderEdit: function () {} };
ctx.Element.prototype.scrollIntoView = function () {};
ctx.window = ctx; ctx.addEventListener = function () {}; vm.createContext(ctx); vm.runInContext(js, ctx);
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
{
  /* Oct 2, 76 Schermerhorn St: the log said "The customer opened the quote page" at 1:20 and the open date added "Customer opened it again" at 1:20 too. */
  const t = ctx.etHistoryItems({ history: [{ at: '2026-10-02T17:20:10Z', kind: 'customer', text: 'The customer opened the quote page' }], openedAt: '2026-10-02T17:20:05Z', lastOpenedAt: '2026-10-02T17:20:40Z', openCount: 2 }).map((h) => h.text);
  ok('an open the server already logged is not shown twice', t.length === 1 && t[0] === 'The customer opened the quote page', t.join(' | '));
  const t2 = ctx.etHistoryItems({ history: [{ at: '2026-10-02T17:20:10Z', kind: 'customer', text: 'The customer opened the quote page' }], lastOpenedAt: '2026-10-03T09:00:00Z', openCount: 2 }).map((h) => h.text);
  ok('...but a later open still is', t2.includes('Customer opened it again (2 times in all)'), t2.join(' | '));
}
ok('an empty record has no history but the request', ctx.etHistoryItems({}).length === 0 && ctx.etHistoryItems({ submittedAt: '2026-10-04T10:00:00Z' }).length === 1);
ok('history text is escaped before it reaches the page', /esc3\(h\.text\)/.test(js));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
