/* dashboard-steps.test.js — run: node js/dashboard-steps.test.js
 *
 *   "The conversation is below and AI assistant is up begging, i need them
 *    together in beginning where is a AI assistant right now. In my dashboard i
 *    have mixed functions and i need them to be step by step"
 *
 * TWO COMPLAINTS, ONE PAGE.
 *
 * 1. THE CONVERSATION WAS AT THE BOTTOM. Asking the customer something and
 *    asking the assistant what to ask are the same task thirty seconds apart,
 *    and they were at opposite ends of a very long page: the assistant under the
 *    description, the thread below the generator, the labor table, the materials
 *    table, the scope cards and the totals. Reading the customer's answer is step
 *    one of pricing a job, not the last thing before sending.
 *
 * 2. EVERYTHING LOOKED EQUALLY IMPORTANT. The order of the page had to be
 *    remembered rather than read. Five numbered bars now say what each stretch is
 *    FOR, in the order the work happens. Nothing is hidden and nothing is
 *    collapsed - the same page with its spine written on it, which matters
 *    because the last thing he asked for was to stop hiding things.
 *
 * WHAT THIS FILE ASSERTS: the ORDER of what a human sees, by index in the real
 * rendered markup. Not that a section exists somewhere - that was true before
 * and the page was still wrong.
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

const ctx = { console, String, Number, Array, Object, JSON, Math, Boolean };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(ext('esc'), ctx);
vm.runInContext(ext('stepBar'), ctx);

/* ══ THE BAR ITSELF ═══════════════════════════════════════════════════════ */
console.log('\na step bar says its number and what the step is for\n');
{
  const bar = vm.runInContext("stepBar(2, 'Let the AI price it', 'It reads the description.')", ctx);
  ok('it carries the number', /class="step-n">2</.test(bar), bar);
  ok('...the title', bar.indexOf('Let the AI price it') !== -1);
  ok('...and the sentence under it', bar.indexOf('It reads the description.') !== -1);
  ok('a bar with no sentence renders without an empty element',
    vm.runInContext("stepBar(1, 'Only a title', '')", ctx).indexOf('step-s') === -1);
  ok('markup in a title is escaped, not rendered',
    vm.runInContext("stepBar(1, '<b>x</b> & co', '')", ctx).indexOf('<b>x</b>') === -1);
}

/* ══ THE ORDER ON THE PAGE ════════════════════════════════════════════════ */
console.log('\nfive steps, in the order the work actually happens\n');
{
  /* The record view is built as one long concatenation. Read the source of the
     builder rather than executing it - executing needs half the dashboard - but
     read POSITIONS, which is the thing that was wrong. */
  const start = DASH.indexOf('detailInvoicesHtml(r) +');
  const end = DASH.indexOf("'<div class=\"modal-actions\">'", start);
  ok('the record view was found in one piece', start > 0 && end > start,
    'start=' + start + ' end=' + end);
  const view = DASH.slice(start, end + 200);

  const at = (needle) => view.indexOf(needle);
  const STEPS = [
    [1, 'Read the job and ask what is missing'],
    [2, 'Let the AI price it'],
    [3, 'Check the price it came back with'],
    [4, 'Decide what the customer sees'],
    [5, 'Send it'],
  ];
  STEPS.forEach(function (s) {
    ok('step ' + s[0] + ' is on the page: "' + s[1] + '"', at("stepBar(" + s[0] + ", '" + s[1] + "'") !== -1);
  });
  ok('ALL FIVE ARE IN NUMERICAL ORDER DOWN THE PAGE',
    STEPS.every((s, i) => i === 0 ||
      at("stepBar(" + s[0] + ",") > at("stepBar(" + STEPS[i - 1][0] + ",")),
    STEPS.map(s => s[0] + '@' + at('stepBar(' + s[0] + ',')).join('  '));
}

/* ══ THE ONE THAT WAS REPORTED ════════════════════════════════════════════ */
console.log('\nthe conversation sits with the assistant, not at the bottom\n');
{
  /* THE SAME SLICE THE OTHER BLOCKS USE. This one cut the view at the next
     `function ` keyword, which lands inside the view itself - so PROJECT and the
     send buttons were simply not in the string, and three assertions failed on a
     page that was correct. A slice that ends early does not prove absence. */
  const start = DASH.indexOf('detailInvoicesHtml(r) +');
  const view = DASH.slice(start, DASH.indexOf("'<div class=\"modal-actions\">'", start) + 200);
  const at = (needle) => view.indexOf(needle);

  const ask = at('askPanelHtml(r)');
  const conv = at("id=\"cnv-section\"");
  const gen = at('AI ESTIMATE GENERATOR');
  const project = at('\u{1F4CB} PROJECT');
  const actions = at('modal-actions');
  const desc = at('<span class="lbl">Description</span>');

  /* NESTING, NOT NEIGHBOURHOOD. The first version of this asked whether the
     conversation came before the literal "'</div>' +\n    stepBar(2". Moving the
     block back below the card carried its own '</div>' + down with it, which
     recreated that exact string - so the assertion passed against the layout it
     was written to forbid. Depth is the thing being claimed, so count depth: how
     many divs are open, in the builder's own literals, where the block sits. */
  const depthAt = (idx) => {
    const open = view.indexOf('<div class="cust-panel">');
    const seg = view.slice(open, idx);
    return (seg.match(/<div/g) || []).length - (seg.match(/<\/div>/g) || []).length;
  };

  ok('all five landmarks were located',
    [ask, conv, gen, project, actions].every(v => v > 0),
    'ask=' + ask + ' conv=' + conv + ' gen=' + gen + ' project=' + project + ' actions=' + actions);

  /* THE ORDER, IN HIS WORDS: "first is customer details, second need ask to
     AI, 3th need conversation, 4th need generate estimate, 5th need how sure
     this estimate". The conversation came up from the bottom of the page in
     two moves; this pins where it landed - under the assistant, inside the
     card - and the readiness verdict below the generator, not above it. */
  ok('THE ASSISTANT IS DIRECTLY UNDER WHAT THE CUSTOMER SENT, above the conversation',
    desc > 0 && ask > desc && ask < conv,
    'description at ' + desc + ', assistant at ' + ask + ', conversation at ' + conv);
  ok('THE CONVERSATION IS UNDER THE ASSISTANT', conv > ask,
    'assistant at ' + ask + ', conversation at ' + conv);
  {
    const readiness = at('readinessHtml');
    const step3 = at('stepBar(3,');
    ok('"HOW SURE IS THIS ESTIMATE?" IS UNDER THE GENERATOR, not in the request card',
      readiness > gen, 'generator at ' + gen + ', readiness at ' + readiness);
    ok('...and before step 3, so the verdict comes with the price it judges',
      readiness < step3, 'readiness at ' + readiness + ', step 3 at ' + step3);
    ok('...rendered only when there is one - no empty box on a fresh request',
      /\(readinessHtml \?/.test(view));
    /* The AI photo-analysis card used to share this box. It is retired. */
    ok('it is not rendered a second time anywhere in the view, and the photo-analysis card is gone',
      (view.match(/readinessHtml/g) || []).length === 2 && (view.match(/analysisHtml/g) || []).length === 0,
      'readinessHtml ×' + (view.match(/readinessHtml/g) || []).length + ', analysisHtml ×' + (view.match(/analysisHtml/g) || []).length);
  }
  /* Measured at the block's OPENING TAG, not at the id inside it - inside, its
     own wrapper has already added a level, so a block sitting below the closed
     card still reads as depth 1 and the check passes on the wrong layout. */
  ok('THE CONVERSATION IS INSIDE THE REQUEST CARD, not below it',
    depthAt(at('<div class="section cnv-inline"')) === 1,
    'conversation opens at div depth ' + depthAt(at('<div class="section cnv-inline"')) +
    ', assistant sits at ' + depthAt(ask) + ' — both should be 1, inside the card');
  ok('...under what the customer typed, not above it', desc > 0 && conv > desc,
    'description at ' + desc + ', conversation at ' + conv);
  ok('THE CONVERSATION IS ABOVE THE GENERATOR — this is the whole complaint',
    conv < gen, 'conversation at ' + conv + ', generator at ' + gen);
  ok('...above the labor and materials too', conv < project);
  ok('...and nowhere near the send buttons any more', conv < actions - 1000,
    'conversation at ' + conv + ', actions at ' + actions);

  ok('there is still exactly ONE conversation section, not a copy left behind',
    (DASH.match(/id="cnv-section"/g) || []).length === 1,
    (DASH.match(/id="cnv-section"/g) || []).length + ' found');
  ok('the reply box it needs is still wired to it',
    DASH.indexOf('cnvPanelHtml(r)') !== -1 && DASH.indexOf('sendThreadReply()') !== -1);
  ok('and Copy-to-customer still finds it, since it scrolls there by id',
    DASH.indexOf('getElementById("cnv-section")') !== -1);
}

/* ══ WHAT MUST NOT HAVE MOVED ═════════════════════════════════════════════ */
console.log('\nnothing else changed places\n');
{
  const start = DASH.indexOf('detailInvoicesHtml(r) +');
  const view = DASH.slice(start, DASH.indexOf("'<div class=\"modal-actions\">'", start) + 200);
  const at = (needle) => view.indexOf(needle);

  ok('the request is still first', at('CUSTOMER REQUEST') < at('AI ESTIMATE GENERATOR'));
  ok('the generator still comes before the project',
    at('AI ESTIMATE GENERATOR') < at('\u{1F4CB} PROJECT'));
  ok('the project still comes before the quote photos',
    at('\u{1F4CB} PROJECT') < at('\u{1F4F7} QUOTE PHOTOS'));
  ok('the services panel still comes before the customer view toggles',
    at('scope-control-wrap') < at('CUSTOMER VIEW MODE'));
  ok('the send buttons are still last', at('modal-actions') > at('CUSTOMER VIEW MODE'));
  ok('the assistant is still inside the request card, above the generator',
    at('askPanelHtml(r)') < at('AI ESTIMATE GENERATOR'));
  ok('the conversation kept its own styling label, since .section is unstyled',
    DASH.indexOf('.cnv-inline-title{') !== -1 && DASH.indexOf('cnv-inline-title">\u{1F4AC} Conversation') !== -1);
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
