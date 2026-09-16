/* unpriced-quote.test.js — run: node js/unpriced-quote.test.js
 *
 *   "there is a approve button and at this time they don't have to approve
 *    anything, they just need to answer questions"
 *
 * On SBC-260915-UYE6 the contractor used the new Ask AI panel exactly as
 * intended: six good questions, sent to the customer BEFORE pricing anything.
 * Asking first is the whole point of asking.
 *
 * What the customer received was a page headed
 *
 *     Bathroom Renovation
 *     Total          $0.00
 *     Labor          $0.00
 *     Your estimate  $0.00
 *     [ Approve estimate ]
 *
 * and an email with "$0.00" in gold under the address. Nobody should be invited
 * to approve nothing. It reads as a mistake or as a trick, and the one thing
 * actually wanted from them - six answers - sat underneath a button that had
 * nothing to do with it.
 *
 * THE RULE. Until something is priced, no money appears anywhere and there is no
 * Approve button. The page shows the job, the photos, the questions and a box to
 * answer in. The moment a price exists, every one of those returns unchanged -
 * which is the half of this that is easy to break and impossible to notice,
 * because the broken version looks fine on every record that already has a
 * price.
 *
 * "Priced" means somebody put lines or a stamped figure on the record. Not that
 * a total could be computed: an empty record computes to zero perfectly happily,
 * and that is exactly how $0.00 came to be printed as a quote.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');

const ROOT = path.join(__dirname, '..');
const QUOTE = fs.readFileSync(path.join(ROOT, 'quote.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* ── run the real page ──────────────────────────────────────────────────── */
const ctx = {
  console, String, Number, Array, Object, JSON, Math, Date, RegExp, Boolean, isNaN, parseFloat, parseInt,
  encodeURIComponent, decodeURIComponent, Map, Set,
  /* The page reads ?ref= at load; without this the whole script throws before a
     single function is defined, and every assertion below fails for a reason
     that has nothing to do with what is being tested. */
  URLSearchParams, setTimeout, clearTimeout, Promise
};
let painted = '';
ctx.window = ctx; ctx.globalThis = ctx;
ctx.app = { set innerHTML(v) { painted = v; }, get innerHTML() { return painted; } };
ctx.document = {
  getElementById: (id) => id === 'app' ? ctx.app : null, querySelector: () => null, querySelectorAll: () => [],
  addEventListener: () => {}, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelector: () => ({}) }),
  body: { appendChild() {} }
};
ctx.location = { search: '?ref=SBC-260915-UYE6', href: '' };
ctx.fetch = () => new Promise(() => {});
/* render() ends by pinging the open-tracker with `new Image()`. Nothing about
   the layout depends on it, but without this the very first paint throws. */
ctx.Image = function () { return { set src(v) {} }; };
ctx.track = function () {};
vm.createContext(ctx);

/* THE PAGE'S SCRIPT IS ONE BIG IIFE - `(()=>{ ... })();` - so nothing it
   declares escapes into the context. Unwrapping it does not work either: there
   are top-level `return` statements inside that arrow function, legal there and
   illegal in a bare script.

   So the wrapper stays and a single line is injected just before it closes,
   handing out the functions under test. Nothing below is a copy of the page: if
   quote.html changes, this moves with it or fails to load and says so. */
const raw = QUOTE.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1];
let script = raw.trim();
if (!script.endsWith('})();')) {
  console.log('FAIL  quote.html no longer wraps its script the way this harness expects');
  console.log('\n0 passed, 1 failed\n');
  process.exit(1);
}
script = script.slice(0, -'})();'.length) +
  ';globalThis.__T={render:render,priced:priced,actionHtml:actionHtml,calc:calc};})();';

try { vm.runInContext(script, ctx); }
catch (e) {
  /* Swallowing this cost a debugging round: the script threw on a missing
     URLSearchParams, defined nothing, and every assertion failed on "render is
     not defined" instead of on what it was actually checking. */
  console.log('FAIL  the page script did not load\n        ' + e.message);
  console.log('\n0 passed, 1 failed\n');
  process.exit(1);
}
const T = ctx.__T || {};
['render', 'priced', 'actionHtml', 'calc'].forEach(function (name) {
  if (typeof T[name] !== 'function') {
    console.log('FAIL  the page loaded but ' + name + ' is missing');
    console.log('\n0 passed, 1 failed\n');
    process.exit(1);
  }
});

const UNPRICED = {
  ref: 'SBC-260915-UYE6', status: 'new', source: 'contact-form',
  customer: { name: 'zurabi asanashvili', email: 'z@example.com', address: '3855 shore pkwy, Apt 1K, Brooklyn' },
  request: { service: 'Bathroom Renovation', description: 'test request', photos: [{ data: 'https://x/a.jpg', slot: 'wide' }] },
  estimate: { labor: [], materials: [] },
  thread: [{ from: 'contractor', text: '1. What do you want changed?\n2. Are you moving the toilet or shower?', at: '2026-09-15T23:35:00Z' }]
};
const PRICED = JSON.parse(JSON.stringify(UNPRICED));
PRICED.status = 'drafted';
PRICED.estimate = {
  projectTitle: 'Bathroom Renovation', summary: 'Full bathroom refit.', scopeOfWork: 'Strip out and retile.',
  labor: [{ section: 'Bathroom', item: 'Tile installation', qty: 40, rate: 95 }],
  materials: [{ section: 'Bathroom', item: 'Porcelain tile', qty: 1, rate: 1200 }],
  markupPct: 25, showLaborCost: true
};

function paint(rec) {
  painted = '';
  T.render(rec);
  return painted;
}

/* ══ THE ONE THAT WAS REPORTED ════════════════════════════════════════════ */
console.log('\nnothing priced: no money on the page, and nothing to approve\n');
{
  const html = paint(UNPRICED);
  ok('the page rendered at all', html.length > 200, html.slice(0, 80));

  ok('THERE IS NO APPROVE BUTTON — nobody is asked to approve nothing',
    html.indexOf('Approve estimate') === -1 && html.indexOf("P('a')") === -1,
    (html.match(/<button[^>]*>[^<]*/g) || []).join(' | ').slice(0, 160));

  ok('NO $0.00 ANYWHERE ON THE PAGE',
    html.indexOf('$0.00') === -1, (html.match(/.{40}\$0\.00.{20}/) || [''])[0]);

  ok('...and no money figure at all', !/\$[\d,]+\.\d\d/.test(html),
    (html.match(/\$[\d,]+\.\d\d/g) || []).join(' '));

  ok('the "Your estimate" line is gone with it', html.indexOf('Your estimate') === -1);
  ok('so is the empty Total cell in the header', !/<small>Total<\/small>/.test(html));
  ok('the header says what is actually happening instead',
    /Waiting on your answers/.test(html));

  ok('THE QUESTIONS ARE THERE, which is the entire reason they opened the link',
    html.indexOf('What do you want changed') !== -1);
  /* PRESENT IS NOT THE SAME AS USABLE. This asked only whether a textarea
     appeared anywhere in the markup. It did - inside `.panel{display:none}`,
     which is revealed by the "Request changes / ask a question" button, and that
     button is deliberately gone on an unpriced quote. The assertion passed and
     the customer opened a page of six questions with no way to answer them.
     It now checks the box is OPEN, and that the thing that sends it is there. */
  ok('THE REPLY BOX IS OPEN, not rendered behind display:none',
    /<section class="card panel open" id="q">/.test(html),
    (html.match(/<section class="card panel[^"]*" id="q">/) || ['no panel at all'])[0]);
  ok('...with a textarea in it', /<textarea id="msg"/.test(html));
  ok('...and a button that actually sends', /onclick="S\('question'\)"/.test(html));
  ok('...and a line telling them to reply', /Reply below/.test(html));

  ok('placeholder prose is not shown as if it were a real summary',
    html.indexOf('Estimate based on the project information provided') === -1 &&
    html.indexOf('Please refer to the estimate details provided') === -1);

  ok('the job itself is still identified', html.indexOf('Bathroom Renovation') !== -1 &&
    html.indexOf('3855 shore pkwy') !== -1);
  ok('and the photo still shows', html.indexOf('https://x/a.jpg') !== -1);
}

/* ══ THE HALF THAT IS EASY TO BREAK SILENTLY ══════════════════════════════ */
console.log('\na priced estimate is completely unchanged\n');
{
  const html = paint(PRICED);
  ok('THE APPROVE BUTTON IS BACK', html.indexOf('Approve estimate') !== -1);
  ok('the total is shown', /Your estimate/.test(html) && /\$[\d,]+\.\d\d/.test(html),
    (html.match(/\$[\d,]+\.\d\d/g) || []).slice(0, 3).join(' '));
  ok('...and it is the real figure, not zero',
    (html.match(/\$[\d,]+\.\d\d/g) || []).every(v => v !== '$0.00'));
  ok('the summary and scope come back when they have content',
    html.indexOf('Full bathroom refit') !== -1 && html.indexOf('Strip out and retile') !== -1);
  ok('the Status cell is back too', /<small>Status<\/small>/.test(html));
  ok('the Total cell is back', /<small>Total<\/small>/.test(html));
  ok('...and its reply box is still the closed one behind the ask button, as before',
    /<section class="card panel" id="q">/.test(html) && /P\('q'\)/.test(html));
}

/* ══ WHAT COUNTS AS PRICED ════════════════════════════════════════════════ */
console.log('\nwhat counts as a price, and what does not\n');
{
  const p = (est) => T.priced({ estimate: est });
  ok('no lines and no total is NOT priced', p({ labor: [], materials: [] }) === false);
  ok('a missing estimate object is not priced', p({}) === false);
  ok('one labor line is priced', p({ labor: [{ qty: 1, rate: 50 }], materials: [] }) === true);
  ok('one material line is priced', p({ labor: [], materials: [{ qty: 1, rate: 50 }] }) === true);
  ok('A STAMPED TOTAL IS PRICED even with no lines left on the record',
    p({ labor: [], materials: [], stampedTotal: 4200 }) === true);
  ok('...and an approved final total is priced', p({ labor: [], materials: [], customerFinalTotal: 4200 }) === true);
  ok('a stamped ZERO still counts as priced — somebody put it there on purpose',
    p({ labor: [], materials: [], stampedTotal: 0 }) === true);
}

/* ══ THE EMAIL SAID $0.00 TOO ═════════════════════════════════════════════ */
console.log('\nthe email that carries the questions shows no price either\n');
{
  const origResolve = Module._resolveFilename;
  const mail = require(path.join(ROOT, 'netlify/functions/lib/message-email.js'));
  const build = typeof mail === 'function' ? mail : (mail.buildMessageEmail || mail.build || mail.default ||
    Object.values(mail).find(v => typeof v === 'function'));
  ok('the email builder is loadable', typeof build === 'function', typeof build);

  const out = build({
    record: UNPRICED,
    message: { from: 'contractor', text: '1. What do you want changed?', at: '2026-09-15T23:35:00Z' },
    siteUrl: 'https://www.sanibuildingcorp.com'
  });
  ok('THE EMAIL HEADER CARRIES NO $0.00',
    out.html.indexOf('$0.00') === -1, (out.html.match(/.{30}\$0\.00.{10}/) || [''])[0]);
  ok('...and neither does the plain-text copy', out.text.indexOf('$0.00') === -1);
  ok('the questions are still in it', out.html.indexOf('What do you want changed') !== -1);
  ok('so is the job and the address',
    out.html.indexOf('Bathroom Renovation') !== -1 && out.html.indexOf('3855 shore pkwy') !== -1);

  const outP = build({
    record: PRICED,
    message: { from: 'contractor', text: 'Here is your price.', at: '2026-09-15T23:35:00Z' },
    siteUrl: 'https://www.sanibuildingcorp.com'
  });
  ok('A PRICED ESTIMATE STILL SHOWS ITS TOTAL IN THE EMAIL',
    /\$[\d,]+\.\d\d/.test(outP.html) && outP.html.indexOf('$0.00') === -1,
    (outP.html.match(/\$[\d,]+\.\d\d/g) || []).join(' '));
  ok('...in the text copy too', /\$[\d,]+\.\d\d/.test(outP.text));
  Module._resolveFilename = origResolve;
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
