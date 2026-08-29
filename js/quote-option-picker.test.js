/* quote-option-picker.test.js — run: node js/quote-option-picker.test.js
 *
 * The customer's side of the option picker, executed against the real functions
 * lifted out of quote.html.
 *
 * The most important test in this file is the last one. quote.html computes an
 * option's id in the browser; netlify/functions/lib/quote-options.js recomputes
 * it on the server and takes the price from there. If those two ever disagree,
 * nothing visibly breaks: the customer ticks an option, watches their total go
 * up, presses approve — and the server silently drops the id it cannot resolve,
 * clamps the total back down to the quote, and the work is neither charged for
 * nor scheduled. So the two implementations are executed side by side against
 * the same labels and asserted equal.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'quote.html'), 'utf8');
const SERVER = require(path.join(__dirname, '..', 'netlify', 'functions', 'lib', 'quote-options.js'));

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

const ctx = {
  console, JSON, Math, String, Number, Boolean, Array, Object, RegExp,
  A: x => Array.isArray(x) ? x : (x ? [x] : []),
  E: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
  M: n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  document: { body: { getAttribute: () => null }, getElementById: () => null },
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext('let chosen = Object.create(null); let rec = {};', ctx);
['optNorm', 'optId', 'optLetter', 'chosenIds', 'isChosen', 'chosenTotal', 'chosenFor',
 'optsHtml', 'withChosen', 'withoutChosen'].forEach(n => vm.runInContext(ext(n), ctx));

const run = expr => vm.runInContext(expr, ctx);
const setChosen = obj => { ctx.chosen = obj; vm.runInContext('chosen = this.chosen || chosen;', ctx); };

/* The three alternatives from the live bathroom estimate. */
const L_A = 'Option A — NY State Article 32 assessment and contained remediation';
const L_B = 'Option B — Repaint bathroom walls to match the refreshed ceiling';
const L_C = 'Option C — Camera inspection of the waste line serving the fixtures';
const id = l => run('optId(' + JSON.stringify(l) + ')');

const SVC = {
  title: 'Bathroom',
  subtotal: 3710.55,
  included: ['We protect the apartment', 'We tape the seams'],
  notIncluded: [
    'Mold assessment and remediation under NY State Article 32 if the wet/affected area exceeds 10 sq ft — see Option A.',
    'Permit filing, co-op alteration agreement fees, architect/engineer filings, or building deposits.',
    'Heating, cooling or ventilation changes not listed above',
  ],
  customerSupplies: [],
  options: [
    { label: L_A, description: 'If affected area exceeds 10 sq ft', price: 3850 },
    { label: L_B, description: '', price: 1180 },
    { label: L_C, description: '', price: 675 },
  ],
};

console.log('\nquote option picker (quote.html)\n');

/* ── nothing chosen ────────────────────────────────────────────────────── */
run('chosen = Object.create(null)');
ok('with nothing chosen the added total is zero', run('chosenTotal()') === 0);
ok('every option renders an Add button',
  (run('optsHtml(' + JSON.stringify(SVC) + ')').match(/class="opt-add"/g) || []).length === 3);
ok('the button carries the id the server will resolve',
  run('optsHtml(' + JSON.stringify(SVC) + ')').indexOf(id(L_A)) !== -1);
ok('no option is marked added yet', run('optsHtml(' + JSON.stringify(SVC) + ')').indexOf('✓ Added') === -1);
ok('the scope is untouched',
  run('withChosen(' + JSON.stringify(SVC) + ').length') === 2 &&
  run('withoutChosen(' + JSON.stringify(SVC) + ').length') === 3);

/* ── one chosen ────────────────────────────────────────────────────────── */
run(`chosen = {${JSON.stringify(id(L_A))}: {id:${JSON.stringify(id(L_A))}, label:${JSON.stringify(L_A)}, price:3850, section:'Bathroom'}}`);
ok('the added total is that option', run('chosenTotal()') === 3850);
ok('isChosen finds it by label', run('isChosen(' + JSON.stringify(L_A) + ')') === true);
ok('isChosen does not find the others', run('isChosen(' + JSON.stringify(L_B) + ')') === false);
ok('the chosen option is marked added', run('optsHtml(' + JSON.stringify(SVC) + ')').indexOf('✓ Added') !== -1);
ok('only one is marked added',
  (run('optsHtml(' + JSON.stringify(SVC) + ')').match(/✓ Added/g) || []).length === 1);
ok('the service shows what was added to it',
  run('optsHtml(' + JSON.stringify(SVC) + ')').indexOf('Added to this service') !== -1);
ok('chosenFor filters by service',
  run('chosenFor("Bathroom").length') === 1 && run('chosenFor("Painting").length') === 0);

/* ── the scope moves with the money ────────────────────────────────────── */
ok('the chosen option joins "Included in this service"',
  run('withChosen(' + JSON.stringify(SVC) + ').length') === 3 &&
  run('withChosen(' + JSON.stringify(SVC) + ')[2]').indexOf('Added at your request') === 0);
ok('the "Not included" line that pointed at it is gone',
  run('withoutChosen(' + JSON.stringify(SVC) + ').length') === 2,
  JSON.stringify(run('withoutChosen(' + JSON.stringify(SVC) + ')')));
ok('...and it is the RIGHT line that went',
  run('withoutChosen(' + JSON.stringify(SVC) + ')').every(x => x.indexOf('Article 32') === -1));
ok('unrelated exclusions stay',
  run('withoutChosen(' + JSON.stringify(SVC) + ')').some(x => /Permit filing/.test(x)) &&
  run('withoutChosen(' + JSON.stringify(SVC) + ')').some(x => /Heating, cooling/.test(x)));

/* ── two chosen together — Zura asked for this explicitly ──────────────── */
run(`chosen = {
  ${JSON.stringify(id(L_A))}: {id:${JSON.stringify(id(L_A))}, label:${JSON.stringify(L_A)}, price:3850, section:'Bathroom'},
  ${JSON.stringify(id(L_C))}: {id:${JSON.stringify(id(L_C))}, label:${JSON.stringify(L_C)}, price:675, section:'Bathroom'}
}`);
ok('two options can be taken together', run('chosenTotal()') === 4525);
ok('both are marked added', (run('optsHtml(' + JSON.stringify(SVC) + ')').match(/✓ Added/g) || []).length === 2);
ok('both join the included list', run('withChosen(' + JSON.stringify(SVC) + ').length') === 4);
ok('both ids are sent', run('chosenIds().length') === 2);

/* ── all three ─────────────────────────────────────────────────────────── */
run(`chosen[${JSON.stringify(id(L_B))}] = {id:${JSON.stringify(id(L_B))}, label:${JSON.stringify(L_B)}, price:1180, section:'Bathroom'}`);
ok('all three together', run('chosenTotal()') === 5705);

/* ── an exclusion that merely says "option" is not swept away ──────────── */
run('chosen = Object.create(null)');
run(`chosen[${JSON.stringify(id(L_B))}] = {id:${JSON.stringify(id(L_B))}, label:${JSON.stringify(L_B)}, price:1180, section:'Bathroom'}`);
ok('choosing B does not remove the line about A',
  run('withoutChosen(' + JSON.stringify(SVC) + ')').some(x => /Article 32/.test(x)),
  JSON.stringify(run('withoutChosen(' + JSON.stringify(SVC) + ')')));

/* ── an option with no letter, and how far the sweep is allowed to reach ──
   An exclusion is retired ONLY when it explicitly names the option: the whole
   label, or the option letter. Anything looser is dangerous in the other
   direction — matching an exclusion that merely appears INSIDE the label would
   let an option called "Upgrade to a heated floor" delete a one-word exclusion
   like "Flooring", and the customer would lose an exclusion they were entitled
   to see. A stale exclusion is untidy; a deleted one is a dispute. */
{
  const svc = { title: 'Bathroom', included: [], customerSupplies: [],
                options: [{ label: 'Upgrade to a heated floor', price: 1400 }],
                notIncluded: [
                  'Upgrade to a heated floor is not included in this price.',
                  'Heated floor',
                  'Something else entirely',
                ] };
  run('chosen = Object.create(null)');
  const nid = id('Upgrade to a heated floor');
  run(`chosen[${JSON.stringify(nid)}] = {id:${JSON.stringify(nid)}, label:"Upgrade to a heated floor", price:1400, section:'Bathroom'}`);
  ok('a lettered pattern is not required for the button to work',
    run('optsHtml(' + JSON.stringify(svc) + ')').indexOf('✓ Added') !== -1);
  ok('an exclusion that names the whole option is retired',
    !run('withoutChosen(' + JSON.stringify(svc) + ')').some(x => /not included in this price/.test(x)),
    JSON.stringify(run('withoutChosen(' + JSON.stringify(svc) + ')')));
  ok('a partial word-overlap is NOT enough to delete an exclusion',
    run('withoutChosen(' + JSON.stringify(svc) + ')').length === 2,
    JSON.stringify(run('withoutChosen(' + JSON.stringify(svc) + ')')));
}

/* ── a service with no options ─────────────────────────────────────────── */
run('chosen = Object.create(null)');
ok('a service with no alternatives renders nothing',
  run('optsHtml({title:"Painting",options:[],included:[],notIncluded:[]})') === '');
ok('...and its lists are untouched',
  run('withChosen({title:"Painting",included:["a","b"],notIncluded:["c"]}).length') === 2);

/* ══ ONE PRICE ON THE PAGE ═════════════════════════════════════════════════
   From a live approved estimate: the sticky bar said $9,397.04 while the
   headline said $12,347.04. Two prices on one screen is not a rounding
   complaint — it is a reason not to sign. The bar was handed the totals object
   and printed ct.total; the hero printed the total with the chosen options
   added. And once the customer HAS approved, the stamped figure already
   includes those options, so adding them again bills the same work twice. */
console.log('\nthe page shows one price, and after approval the agreed one\n');
vm.runInContext(ext('shownTotal'), ctx);
vm.runInContext(ext('pinHtml'), ctx);
vm.runInContext('var ref = "SBC-260828-394Z";', ctx);
const shownTotal = (ct) => run('shownTotal(' + JSON.stringify(ct) + ')');

run('chosen = Object.create(null)');
ok('with nothing chosen the shown total is the quote',
  shownTotal({ total: 9397.04, stamped: null }) === 9397.04);

run(`chosen[${JSON.stringify(id(L_A))}] = {id:${JSON.stringify(id(L_A))}, label:${JSON.stringify(L_A)}, price:2950, section:'Bathroom'}`);
ok('before approval the chosen option is added',
  shownTotal({ total: 9397.04, stamped: null }) === 12347.04,
  String(shownTotal({ total: 9397.04, stamped: null })));
ok('AFTER approval the stamped total wins — the option is not added twice',
  shownTotal({ total: 12347.04, stamped: 12347.04 }) === 12347.04,
  'got ' + shownTotal({ total: 12347.04, stamped: 12347.04 }) + ', double-counting would give 15297.04');
ok('a clamped stamp is shown as stamped, not as what the browser hoped for',
  shownTotal({ total: 9397.04, stamped: 9397.04 }) === 9397.04);

ok('the sticky bar prints the number it is given, not a different one',
  run('pinHtml({estimate:{projectTitle:"Bedroom Renovation"},request:{}}, 12347.04)').indexOf('$12,347.04') !== -1,
  run('pinHtml({estimate:{projectTitle:"Bedroom Renovation"},request:{}}, 12347.04)'));
ok('...and never both prices at once',
  run('pinHtml({estimate:{projectTitle:"x"},request:{}}, 12347.04)').indexOf('9,397.04') === -1);

/* ── an option already written into the estimate is not counted again ───── */
vm.runInContext(ext('seedChosen'), ctx);
{
  run('chosen = Object.create(null); seeded = false;');
  vm.runInContext('var seeded = false;', ctx);
  run('chosen = Object.create(null)');
  run('seedChosen({customerOptionSelections:[{id:"x1",label:"Option A — thing",price:2950,section:"Bathroom"}]})');
  ok('a selection the contractor has NOT yet added is seeded', run('chosenTotal()') === 2950);
}
{
  vm.runInContext('seeded = false;', ctx);
  run('chosen = Object.create(null)');
  run('seedChosen({customerOptionSelections:[{id:"x2",label:"Option A — thing",price:2950,section:"Bathroom",adoptedAt:"2026-08-29T02:40:00Z"}]})');
  ok('...but one already written into the estimate is NOT — that would bill it twice',
    run('chosenTotal()') === 0, 'chosenTotal is ' + run('chosenTotal()'));
}

/* ══ AN APPROVAL IS NOT AN OPEN ════════════════════════════════════════════
   Approving reloads the page; the reload calls render(); render() calls
   track(); track() pings track-quote-open, which emails "👀 Customer opened
   quote again (open #5)". So every approval sent an ACCEPTED email and then, a
   second later, an OPENED one — and the open landed on top of his inbox, so
   pressing Approve looked like it had only opened the quote. */
console.log('\napproving must not fire an "opened quote" notification\n');
{
  const store = {};
  const hits = [];
  const tctx = {
    console, String, Number, Date, encodeURIComponent,
    sessionStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    Image: function () { const o = {}; Object.defineProperty(o, 'src', { set: (v) => hits.push(v) }); return o; },
  };
  tctx.window = tctx; tctx.globalThis = tctx;
  vm.createContext(tctx);
  vm.runInContext('var ref = "SBC-260828-394Z";', tctx);
  vm.runInContext(ext('track'), tctx);

  vm.runInContext('track()', tctx);
  ok('a normal open notifies', hits.length === 1 && /track-quote-open/.test(hits[0]), JSON.stringify(hits));

  store.sbcSkipTrack = 'SBC-260828-394Z';
  vm.runInContext('track()', tctx);
  ok('the reload straight after an approval does NOT notify', hits.length === 1, JSON.stringify(hits));
  ok('...and the marker is spent, not left behind', !('sbcSkipTrack' in store));

  vm.runInContext('track()', tctx);
  ok('a genuine re-open later still notifies', hits.length === 2, JSON.stringify(hits));

  store.sbcSkipTrack = 'SBC-SOMEONE-ELSE';
  vm.runInContext('track()', tctx);
  ok('a marker left by a DIFFERENT estimate does not silence this one', hits.length === 3);
}
{
  /* Private browsing throws on sessionStorage. A notification is worth less than
     a quote page that renders. */
  const hits = [];
  const tctx = {
    console, String, Number, Date, encodeURIComponent,
    get sessionStorage() { throw new Error('denied'); },
    Image: function () { const o = {}; Object.defineProperty(o, 'src', { set: (v) => hits.push(v) }); return o; },
  };
  tctx.window = tctx; tctx.globalThis = tctx;
  vm.createContext(tctx);
  vm.runInContext('var ref = "SBC-1";', tctx);
  vm.runInContext(ext('track'), tctx);
  let threw = false;
  try { vm.runInContext('track()', tctx); } catch (e) { threw = true; }
  ok('blocked storage does not break the page', !threw && hits.length === 1, JSON.stringify(hits));
}

/* ══ THE CROSS-CHECK ═══════════════════════════════════════════════════════
   quote.html and the server must reach the same id from the same label. If
   they ever drift, the customer's selection is dropped in silence. */
console.log('\nthe browser and the server must agree on every id\n');
const LABELS = [
  L_A, L_B, L_C,
  'Upgrade to a heated floor',
  'Option D — replace the subfloor',
  '  Option A — MIXED case   and   spacing  ',
  'Option A — a very long alternative label that runs on and on, first variant',
  'Option A — a very long alternative label that runs on and on, second variant',
  'Émigré tile & "special" chars — 50% more',
  'x',
  '12 x 12 inch ceiling tile',
];
let drift = 0;
LABELS.forEach(l => {
  const browser = id(l), server = SERVER.optionId(l);
  if (browser !== server) { drift++; console.log('   DRIFT  ' + JSON.stringify(l) + '\n          browser ' + browser + '\n          server  ' + server); }
});
ok('every label produces the same id in the browser and on the server', drift === 0,
  drift + ' of ' + LABELS.length + ' labels disagree');

LABELS.forEach(l => {
  const b = run('optLetter(' + JSON.stringify(l) + ')');
  const s = SERVER.optionLetter(l);
  if (b !== s) { drift++; console.log('   LETTER DRIFT ' + JSON.stringify(l) + ' ' + b + ' vs ' + s); }
});
ok('...and the same option letter', drift === 0);

/* End to end: what the browser would send, priced by the server. */
{
  const est = { serviceBreakdown: [{ title: 'Bathroom', options: SVC.options }] };
  run('chosen = Object.create(null)');
  [[L_A, 3850], [L_C, 675]].forEach(([l, p]) => {
    run(`chosen[${JSON.stringify(id(l))}] = {id:${JSON.stringify(id(l))}, label:${JSON.stringify(l)}, price:${p}, section:'Bathroom'}`);
  });
  const sent = run('chosenIds()');
  const priced = SERVER.resolveSelection(est, sent);
  ok('the ids the browser sends all resolve on the server',
    priced.unknown.length === 0, JSON.stringify(priced.unknown));
  ok('and the server prices them at exactly what the customer saw',
    priced.total === run('chosenTotal()'),
    'server ' + priced.total + ' vs browser ' + run('chosenTotal()'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
