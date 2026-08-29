/* dashboard-option-panel.test.js — run: node js/dashboard-option-panel.test.js
 *
 * THE BUG THIS FILE EXISTS FOR.
 *
 * The "customer added an option" panel was written inline inside renderEdit()
 * and called escAttr(). escAttr is not a global — it lives inside a private
 * IIFE in a different <script> block further down dashboard.html. So opening
 * ANY record threw:
 *
 *     Can't find variable: escAttr
 *
 * The dashboard showed "this record won't open — retry or delete it" on a
 * perfectly good estimate, and every one of the 22 harnesses was green, because
 * not one of them had ever executed that markup.
 *
 * So this runs the panel builders for real, in a context holding ONLY the
 * helpers the main script block actually defines. Reaching for anything that is
 * not truly in scope throws here instead of in the contractor's hands.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? pass++ : fail++; console.log((c ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

function ext(name) {
  const s = HTML.search(new RegExp('function ' + name + '\\('));
  if (s < 0) throw new Error('missing ' + name);
  let d = 0;
  for (let j = HTML.indexOf('{', s); j < HTML.length; j++) {
    if (HTML[j] === '{') d++;
    else if (HTML[j] === '}') { d--; if (!d) return HTML.slice(s, j + 1); }
  }
}

/* Deliberately spartan. `esc` is lifted from the file itself rather than
   reimplemented, and NOTHING else from other script blocks is provided — that
   absence is the test. */
const ctx = { console, String, Number, Array, Object, Boolean, Math, JSON };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(ext('esc'), ctx);
vm.runInContext(ext('customerOptionsHtml'), ctx);
vm.runInContext(ext('refusedTotalHtml'), ctx);
const run = (expr) => vm.runInContext(expr, ctx);
const panel = (r) => run('customerOptionsHtml(' + JSON.stringify(r) + ')');
const refused = (r) => run('refusedTotalHtml(' + JSON.stringify(r) + ')');

const A = { id: 'opt-option-a-ny-state-article-32-153n2tf', label: 'Option A — NY State Article 32 assessment', price: 3850, section: 'Bathroom' };
const C = { id: 'opt-option-c-camera-8b0gjg', label: 'Option C — Camera inspection', price: 675, section: 'Bathroom' };

console.log('\ncustomer-option panel (dashboard.html)\n');

/* ── the crash ─────────────────────────────────────────────────────────── */
ok('the panel renders at all — it used to throw "Can\'t find variable: escAttr"',
  (function () { try { panel({ customerOptionSelections: [A] }); return true; } catch (e) { return 'threw: ' + e.message; } })() === true,
  (function () { try { panel({ customerOptionSelections: [A] }); return ''; } catch (e) { return e.message; } })());

/* ── nothing chosen ────────────────────────────────────────────────────── */
ok('a record with no chosen options renders nothing', panel({}) === '');
ok('...and neither does a record with an empty list', panel({ customerOptionSelections: [] }) === '');
ok('...or junk', panel({ customerOptionSelections: 'nope' }) === '' && panel(null) === '');

/* ── one chosen ────────────────────────────────────────────────────────── */
{
  const h = panel({ customerOptionSelections: [A] });
  ok('the heading counts one option', /CUSTOMER ADDED 1 OPTION\b/.test(h), h.slice(0, 200));
  ok('...and does not say OPTIONS', !/1 OPTIONS/.test(h));
  ok('the total added is shown', h.indexOf('$3,850.00') !== -1, h.slice(0, 260));
  ok('the label is shown', h.indexOf('Article 32') !== -1);
  ok('the service is shown', h.indexOf('Bathroom') !== -1);
  ok('there is a button carrying the option id', h.indexOf('data-adopt="' + A.id + '"') !== -1, h);
  ok('the button calls adoptCustomerOption', h.indexOf('onclick="adoptCustomerOption(this)"') !== -1);
  ok('it warns against using Regenerate for this', /Do not use Regenerate/.test(h));
}

/* ── two chosen ────────────────────────────────────────────────────────── */
{
  const h = panel({ customerOptionSelections: [A, C] });
  ok('two options are counted and summed', /CUSTOMER ADDED 2 OPTIONS/.test(h) && h.indexOf('$4,525.00') !== -1, h.slice(0, 220));
  ok('both get their own button', (h.match(/data-adopt=/g) || []).length === 2);
}

/* ── already added ─────────────────────────────────────────────────────── */
{
  const done = Object.assign({}, A, { adoptedAt: '2026-08-29T02:40:00.000Z' });
  const h = panel({ customerOptionSelections: [done, C] });
  ok('an adopted option shows as in the estimate, with no button',
    h.indexOf('✓ in the estimate') !== -1 && (h.match(/data-adopt=/g) || []).length === 1, h);
  ok('...and its price is still counted in the heading', h.indexOf('$4,525.00') !== -1);
}

/* ── hostile content ───────────────────────────────────────────────────── */
{
  const nasty = { id: 'opt-x"><script>alert(1)</script>', label: '<img src=x onerror=alert(1)>', price: 10, section: 'B"' };
  const h = panel({ customerOptionSelections: [nasty] });
  ok('a label cannot inject markup', h.indexOf('<img src=x') === -1, h);
  ok('an id cannot break out of the attribute', h.indexOf('"><script>') === -1, h);
}
{
  const h = panel({ customerOptionSelections: [{ label: 'No price here' }] });
  ok('a missing price renders as $0.00 rather than NaN', h.indexOf('NaN') === -1 && h.indexOf('$0.00') !== -1, h);
}

/* ── the refused-total banner ──────────────────────────────────────────── */
ok('no refusal renders nothing', refused({}) === '' && refused(null) === '');
{
  const h = refused({ rejectedFinalTotal: { value: 1, reason: 'below the quoted total' }, customerFinalTotal: 20300 });
  ok('a refused total is shown, with the reason', /A submitted total was refused/.test(h) && /below the quoted total/.test(h), h);
  ok('...and both numbers', h.indexOf('$1') !== -1 && h.indexOf('20,300') !== -1, h);
}
ok('a refusal reason cannot inject markup',
  refused({ rejectedFinalTotal: { value: 1, reason: '<b>x</b>' } }).indexOf('<b>x</b>') === -1);

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
