/* scope-checkbox.test.js — run: node js/scope-checkbox.test.js
 *
 *   "If there will be multiple services then i need control all with check
 *    points, what includes and what's not included, everything i need control
 *    with check point"
 *
 * Every line in Included, Customer supplies and Not included now carries a tick
 * box. Ticked, the customer sees it. Unticked, they do not — and the wording
 * stays on the contractor's screen, so unticking is never a loss and never a
 * decision he has to get right first time.
 *
 * HOW IT IS STORED. A line moves between `included` and `includedOff`, and the
 * same for the other two groups. quote.html reads only the first of each pair,
 * so the customer page needed no change at all, and a record saved before any of
 * this existed carries no Off arrays and behaves exactly as it always did.
 *
 * THE ONE THAT WOULD HURT MOST: a tick box moving money. Exclusions can have
 * price lines parked against them — deleting an exclusion returns that money to
 * the estimate. If unticking took the same path, a click meant to hide one line
 * of wording would silently change what the customer is charged. It does not:
 * a tick box moves wording and nothing else, and an unticked line deliberately
 * offers no delete button, so every deletion still goes through the one tested
 * path with the right key. Asserted below against the real function body.
 *
 * Second: unticking has to survive a save. The first version of this had the Off
 * arrays dropped by scopeCleanCopy, which meant every checkbox silently reset
 * itself on the next reload — a bug that would look like the feature simply not
 * working.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const QUOTE = fs.readFileSync(path.join(ROOT, 'quote.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

function ext(name) {
  const s = DASH.search(new RegExp('(async )?function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = DASH.indexOf('{', s); j < DASH.length; j++) {
    if (DASH[j] === '{') d++;
    else if (DASH[j] === '}') { d--; if (!d) return DASH.slice(s, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

const ctx = { console, String, Number, Array, Object, JSON, Boolean };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(ext('esc'), ctx);
vm.runInContext('var RENDERS = 0; function renderScopeControl(){ RENDERS++ }', ctx);
vm.runInContext(ext('scopeDraft').replace(/\{[\s\S]*\}/, '{ return DRAFT }'), ctx);
vm.runInContext(ext('scopeToggleItem'), ctx);
vm.runInContext(ext('scopeItemRow'), ctx);

function fresh() {
  return {
    services: [{
      name: 'Carpentry',
      included: ['Mask the kitchen cabinets and floor', 'Cut plaster back to sound edges', 'Skim and sand paint-ready'],
      supplied: ['Paint and color matching'],
      excluded: ['Wiring and device installation', 'Repair of plaster outside the two openings']
    }]
  };
}
const svc = () => ctx.DRAFT.services[0];
const toggle = (key, ii, on) => vm.runInContext(
  'scopeToggleItem(0,' + JSON.stringify(key) + ',' + ii + ',' + on + ')', ctx);

/* ══ TURNING A LINE OFF ═══════════════════════════════════════════════════ */
console.log('\nunticking hides a line from the customer and keeps it on screen\n');
{
  ctx.DRAFT = fresh();
  toggle('included', 1, false);
  ok('THE LINE LEAVES WHAT THE CUSTOMER SEES',
    svc().included.indexOf('Cut plaster back to sound edges') === -1, svc().included.join(' | '));
  ok('...AND IS KEPT, NOT DELETED — unticking must never lose wording',
    (svc().includedOff || []).indexOf('Cut plaster back to sound edges') !== -1,
    JSON.stringify(svc().includedOff));
  ok('the other lines are undisturbed and in order',
    svc().included.join('|') === 'Mask the kitchen cabinets and floor|Skim and sand paint-ready');
  ok('the other groups are untouched',
    svc().supplied.length === 1 && svc().excluded.length === 2);
}

console.log('\nticking it back restores it\n');
{
  ctx.DRAFT = fresh();
  toggle('excluded', 0, false);
  ok('an exclusion can be hidden too', svc().excluded.length === 1 && svc().excludedOff.length === 1);
  toggle('excluded', 0, true);
  ok('AND COMES BACK EXACTLY AS IT WAS',
    svc().excluded.indexOf('Wiring and device installation') !== -1 && svc().excludedOff.length === 0,
    svc().excluded.join(' | '));
}

console.log('\nevery group has the control, not just one\n');
{
  ['included', 'supplied', 'excluded'].forEach(function (k) {
    ctx.DRAFT = fresh();
    const before = svc()[k].length;
    toggle(k, 0, false);
    ok(k + ' can be turned off', svc()[k].length === before - 1 && svc()[k + 'Off'].length === 1);
  });
}

console.log('\nnonsense clicks do nothing rather than corrupt the record\n');
{
  ctx.DRAFT = fresh();
  const snap = JSON.stringify(ctx.DRAFT);
  toggle('included', 99, false);
  toggle('included', -1, false);
  toggle('included', 0, true);      /* nothing is off yet */
  ok('out-of-range and no-op clicks leave the draft byte-identical',
    JSON.stringify(ctx.DRAFT) === snap, 'draft changed');

  ctx.DRAFT = { services: [{ name: 'Old record', included: ['One line'] }] };
  toggle('included', 0, false);
  ok('a record saved before any of this existed gains the off list cleanly',
    svc().included.length === 0 && svc().includedOff.length === 1);
  toggle('supplied', 0, false);
  ok('...and a group it never had at all is handled without throwing',
    Array.isArray(svc().supplied) || svc().supplied === undefined);
}

/* ══ THE ONE THAT WOULD HURT MOST ═════════════════════════════════════════ */
console.log('\na tick box moves wording and never money\n');
{
  const body = ext('scopeToggleItem');
  ['scopeUnpark', 'parkedLines', 'subtotal', 'scopeSetServiceTotal', 'scopeStampBreakdown', 'rate', 'qty']
    .forEach(function (t) {
      ok('scopeToggleItem does not touch ' + t, body.indexOf(t) === -1);
    });
  ok('...it only moves strings between two arrays',
    /splice\(ii, 1\)/.test(body) && (body.match(/splice\(/g) || []).length === 1);

  /* Deleting an exclusion still returns its parked money. That path must be the
     only way a line disappears for good, which is why an off row has no ✕. */
  const row = vm.runInContext("scopeItemRow(0,'excluded',0,'Wiring',false)", ctx);
  ok('AN UNTICKED LINE OFFERS NO DELETE BUTTON, so deletion keeps using the tested path',
    row.indexOf('scopeDeleteItem') === -1, row);
  ok('...and says plainly that it is not shown', /not shown/.test(row));
  const onRow = vm.runInContext("scopeItemRow(0,'excluded',0,'Wiring',true)", ctx);
  ok('a ticked line still has the delete it always had',
    /scopeDeleteItem\(0,'excluded',0\)/.test(onRow));
  ok('...and still has the move control', /scopeMoveItem\(0,'excluded',0/.test(onRow));
}

/* ══ THE MARKUP ═══════════════════════════════════════════════════════════ */
console.log('\nthe control is a real checkbox, in the right state\n');
{
  const on = vm.runInContext("scopeItemRow(0,'included',2,'Skim and sand',true)", ctx);
  const off = vm.runInContext("scopeItemRow(0,'included',0,'Cut plaster back',false)", ctx);
  ok('a shown line is ticked', /<input type="checkbox" checked/.test(on));
  ok('a hidden line is not', /<input type="checkbox"(?! checked)/.test(off));
  ok('clicking one calls the toggle with its own index',
    /scopeToggleItem\(0,'included',2,this\.checked\)/.test(on) &&
    /scopeToggleItem\(0,'included',0,this\.checked\)/.test(off));
  ok('editing a hidden line writes to the off list, not the visible one',
    /scopeEditItem\(0,'includedOff',0,/.test(off));
  ok('editing a shown line still writes to the visible list',
    /scopeEditItem\(0,'included',2,/.test(on));
  ok('a quote mark in the wording cannot break the row',
    vm.runInContext("scopeItemRow(0,'included',0,'He said \"no\" & left',true)", ctx)
      .indexOf('value="He said &quot;no&quot; &amp; left"') !== -1);
}

/* ══ IT HAS TO SURVIVE A SAVE ═════════════════════════════════════════════ */
console.log('\nunticking lasts past a reload\n');
{
  const clean = ext('scopeCleanCopy');
  /* Matched as a KEY in the returned object, not merely as a name appearing
     somewhere in the function. The first version of this searched the whole body
     and so was satisfied by the .filter() line further down — it passed happily
     against a scopeCleanCopy that had stopped returning the lists at all, which
     is the exact bug it exists to catch. */
  ['includedOff', 'suppliedOff', 'excludedOff'].forEach(function (k) {
    ok('scopeCleanCopy RETURNS ' + k + ', so unticking survives a reload',
      new RegExp(k + ':\\s*clean\\(s2\\.' + k + '\\)').test(clean));
  });
  ok('a service whose every line is unticked is not dropped on save',
    /includedOff\.length \|\| s2\.suppliedOff\.length \|\| s2\.excludedOff\.length/.test(clean.replace(/\s+/g, ' ')));
}

/* ══ THE CUSTOMER PAGE NEEDED NO CHANGE ═══════════════════════════════════ */
console.log('\nthe customer page never learns these lists exist\n');
{
  ok('quote.html does not read any Off list',
    !/includedOff|suppliedOff|excludedOff/.test(QUOTE));
  ok('...it still reads the three it always read',
    /ps\.included/.test(QUOTE) && /ps\.excluded\|\|ps\.notIncluded/.test(QUOTE.replace(/\s+/g, '')));
}

console.log('\nevery script block in dashboard.html still parses\n');
{
  const blocks = DASH.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
  let broken = null;
  blocks.forEach(function (b, i) {
    try { new vm.Script(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); }
    catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; }
  });
  ok('all ' + blocks.length + ' blocks parse', broken === null, broken || '');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
