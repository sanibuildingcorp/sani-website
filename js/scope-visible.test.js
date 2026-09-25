/* scope-visible.test.js — run: node js/scope-visible.test.js
 *
 *   "I don't need hidden functions in my dashboard! I need easy understandable
 *    dashboard, i need see absolutely everything front of me in my dashboard
 *    before clicking to send and preview!"
 *
 * Two things were hidden, and both had already cost a real quote.
 *
 * 1. THREE QUARTERS OF EVERY SERVICE CARD. The card had four tab panes - Prices,
 *    Included, Customer supplies, Not included - and three of them carried
 *    style="display:none" at all times. The contractor could read the prices or
 *    the exclusions, never both, and pressed Send having seen a quarter of what
 *    he was sending. A quote goes out once.
 *
 * 2. THE WHOLE EDIT. Saving and publishing were separate buttons. Editing the
 *    card down to one service and pressing Save left the customer looking at the
 *    AI's original FOUR services - the same money grouped differently - and the
 *    only warning was a line of text inside the panel. On SBC-260915-XS76 that
 *    meant a plaster patch was quoted to the customer as Painting $399.25,
 *    Kitchen $251.70, Carpentry $563.19 and Electrical $265.68.
 *
 * Saving now IS publishing, and every group is on screen at once.
 *
 * WHAT THIS FILE DOES. It executes the real renderScopeControl out of
 * dashboard.html against a record shaped like that estimate and reads the markup
 * it produces. The assertions are about what a human can SEE: no display:none on
 * a content pane, all four groups present, one save button, and no wording that
 * promises a private draft that no longer exists.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
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

/* ── run the real renderer ───────────────────────────────────────────────── */
let written = '';
const ctx = { console, String, Number, Array, Object, JSON, Math, Map, Set, isNaN, parseFloat };
ctx.document = {
  getElementById: function (id) {
    if (id !== 'scope-control-wrap') return null;
    return { set innerHTML(v) { written = v; }, get innerHTML() { return written; } };
  }
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(ext('esc'), ctx);
/* Everything renderScopeControl calls that is not about layout. Stubbed so this
   test is about VISIBILITY, not arithmetic - the money has its own tests. */
vm.runInContext(`
  var SC_TAB = {};
  function fmt(n){ return '$' + Number(n||0).toFixed(2) }
  function scopeLinesFor(nm, kind){ return kind==='labor'
    ? [{gi:0,l:{item:'Protection and dust containment',qty:3,rate:62.4,unit:'hrs'}}]
    : [{gi:0,l:{item:'Gypsum board panel, 1/2 in.',qty:2,rate:16.27,unit:'ea'}}] }
  function scopeRowsFor(){ return [] }
  function scopeRowsRaw(){ return 0 }
  function scopeMarkupK(){ return 1.25 }
  function scopeServiceSubtotal(){ return 1479.83 }
  function scopeMergeStack(){ return [] }
  function scopeUndoBlockedBy(){ return '' }
  function scopeAllAlternatives(){ return [] }
`, ctx);
vm.runInContext(ext('scopeAlreadyShared').replace(/\{[\s\S]*\}/, '{ return SHARED === true }'), ctx);
vm.runInContext(ext('scopeDraft').replace(/\{[\s\S]*\}/, '{ return DRAFT }'), ctx);
/* The real row builder, not a stand-in: the point of this file is what the
   contractor actually sees on screen. Its own behaviour is covered by
   js/scope-checkbox.test.js. */
vm.runInContext(ext('scopeItemRow'), ctx);
vm.runInContext(ext('renderScopeControl'), ctx);

const DRAFT = {
  services: [{
    name: 'Carpentry',
    included: ['Sani will mask the kitchen cabinets, counters, appliances and floor', 'At both openings the plaster is cut back'],
    supplied: ['Paint and colour matching'],
    excluded: ['Wiring, device installation, cover plates', 'Repair of plaster outside the two existing openings']
  }, {
    /* A second service: a card lists its own price lines only when there is
       more than one service - with one, they are the LABOR / MATERIALS lists
       again ("why is this two times materials and labor listings?"). */
    name: 'Painting', included: ['Two coats on the patched walls'], supplied: [], excluded: []
  }]
};

function render(opts) {
  ctx.DRAFT = DRAFT;
  ctx.SHARED = !!(opts && opts.shared);
  ctx.currentRecord = { estimate: { customerScopePublished: !!(opts && opts.published) } };
  written = '';
  vm.runInContext('renderScopeControl()', ctx);
  return written;
}

/* ══ NOTHING IS HIDDEN ════════════════════════════════════════════════════ */
console.log('\nevery part of the service card is on screen at the same time\n');
{
  const html = render({});
  ok('THE RENDERER PRODUCED A CARD', html.indexOf('sc-service') !== -1, html.slice(0, 80));

  const hidden = (html.match(/<div class="sc-pane[^"]*"[^>]*style="display:none"/g) || []);
  ok('NO CONTENT PANE IS HIDDEN — this is the whole complaint',
    hidden.length === 0, hidden.length + ' hidden panes');

  ok('there is no display:none anywhere in a service card',
    (html.match(/class="sc-(pane|group)[^"]*"[^>]*display:\s*none/g) || []).length === 0);

  ['✓ INCLUDED', '◆ CUSTOMER SUPPLIES', '— NOT INCLUDED'].forEach(function (label) {
    ok('"' + label + '" is visible without clicking anything', html.indexOf(label) !== -1);
  });
  ok('...and so are the price lines, at the same time',
    html.indexOf('Protection and dust containment') !== -1 &&
    html.indexOf('Gypsum board panel') !== -1);

  const one = DRAFT.services.pop();
  const single = render({});
  DRAFT.services.push(one);
  ok('...but with ONE service the card does not list them a second time; it says where they are',
    single.indexOf('Protection and dust containment') === -1 && single.indexOf('Every line is in the LABOR and MATERIALS lists of this estimate.') !== -1);

  ok('EVERY ITEM IN EVERY GROUP IS RENDERED, not just the open one',
    ['Sani will mask the kitchen cabinets', 'Paint and colour matching',
     'Wiring, device installation'].every(t => html.indexOf(esc(t)) !== -1));

  ok('the tab buttons that did the hiding are gone',
    html.indexOf('scopeSetTab(') === -1, 'scopeSetTab still wired into the markup');
  ok('a count is shown instead, as a read-out',
    /class="sc-counts"/.test(html) && /2 not incl\./.test(html.toLowerCase()) === false || /sc-counts/.test(html));
}

/* ══ NO PRIVATE DRAFT ═════════════════════════════════════════════════════ */
console.log('\nsaving is what the customer gets — there is no second step\n');
{
  const html = render({});
  ok('ONE SAVE BUTTON, and it says what it does',
    (html.match(/onclick="scopePublish\(\)"/g) || []).length === 1 &&
    /the customer sees exactly this/i.test(html),
    (html.match(/<button[^>]*btn-primary[^>]*>[^<]*/g) || []).join(' | '));
  ok('THE SEPARATE "SAVE DRAFT" BUTTON IS GONE — it is what created the gap',
    html.indexOf('scopeSaveDraft()') === -1);
  ok('nothing on screen still calls itself a draft the customer cannot see',
    !/customer still sees the standard quote/i.test(html) &&
    !/draft edits stay private/i.test(html));
  ok('an unsaved card says so plainly',
    /Not saved yet/.test(html), (html.match(/sc-pill[^>]*>[^<]*/g) || []).join(' | '));

  const saved = render({ published: true });
  ok('a saved one says the customer is seeing exactly this',
    /exactly what the customer sees/i.test(saved), (saved.match(/sc-pill[^>]*>[^<]*/g) || []).join(' | '));
}

/* ══ THE ONE CONFIRM THAT SURVIVES ════════════════════════════════════════ */
console.log('\nan estimate already sent still warns before it changes under the customer\n');
{
  const src = ext('scopePublish');
  ok('a quote nobody has seen saves without a confirm box',
    /scopeAlreadyShared\(\)\s*&&\s*!confirm\(/.test(src.replace(/\s+/g, ' ')), src.slice(0, 200));
  ok('...but one already sent does ask first',
    /already been sent/i.test(src));
  ok('saving still stamps the breakdown so the two totals cannot disagree',
    /scopeStampBreakdown\(\)/.test(src));
  ok('...and still writes the published scope and the flag',
    /publishedCustomerScope\s*=/.test(src) && /customerScopePublished\s*=\s*true/.test(src));

  const shared = render({ shared: true });
  ok('the shared-estimate banner no longer promises privacy it does not provide',
    /changes what their existing quote link shows/i.test(shared) &&
    !/stay private/i.test(shared));
}

/* ══ THE FILE THAT TAKES EVERYTHING DOWN ══════════════════════════════════ */
console.log('\nevery script block in dashboard.html still parses\n');
{
  const blocks = DASH.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
  let broken = null;
  blocks.forEach(function (b, i) {
    const body = b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    try { new vm.Script(body); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; }
  });
  ok('all ' + blocks.length + ' blocks parse', broken === null, broken || '');
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
