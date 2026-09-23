/* estimate-document.test.js — run: node js/estimate-document.test.js
 *
 *   "In the final sending in customer side shows conversation too which looks
 *    unprofessional and confusing. The estimate i need to shows professional
 *    official documentation, below with Sani Building Corp estimate
 *    explanation and 30 days expiration"
 *
 * On a priced estimate the page is the estimate: an "About this estimate"
 * block (who prepared it, what the price covers, fully insured, the ref,
 * the date issued and the date it is valid until - thirty days), then the
 * Approve button, then the messages folded into one closed line. Before
 * anything is priced (the questions phase) the conversation stays open and
 * there are no terms. The real page script runs here.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
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
ctx.location = { origin: 'https://sanibuildingcorp.com', search: '?ref=SBC-260920-ECB4', href: '' };
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
  ';globalThis.__T={render:render,priced:priced,actionHtml:actionHtml,calc:calc,validUntil:validUntil};})();';

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
['render', 'priced', 'actionHtml', 'calc', 'validUntil'].forEach(function (name) {
  if (typeof T[name] !== 'function') {
    console.log('FAIL  the page loaded but ' + name + ' is missing');
    console.log('\n0 passed, 1 failed\n');
    process.exit(1);
  }
});


const THREAD = [{ id: 'm1', from: 'contractor', text: 'Hi Michelle, a few quick questions so we can put together an accurate quote.', at: '2026-09-20T20:34:00Z' }, { id: 'm2', from: 'customer', text: 'Here are the answers.', at: '2026-09-21T10:00:00Z' }];
function priced(sentAt) {
  return { ref: 'SBC-260920-ECB4', status: 'sent', sentAt: sentAt, customer: { name: 'Michelle Honan', address: '1115 Prospect Ave Apt 102, Brooklyn 11218' }, request: { service: 'Painting' },
    estimate: { projectTitle: 'Studio Repaint, Minor Electrical Repairs and Tub Reseal', summary: 'We repaint the walls.', markupPct: 25, showLaborCost: false, showMaterialsCost: false,
      labor: [{ section: 'Painting', item: 'Paint walls', qty: 40, unit: 'hrs', rate: 60 }], materials: [],
      serviceBreakdown: [{ title: 'Painting', subtotal: 3000, included: ['We fill and sand the small holes'], customerSupplies: [], notIncluded: [] }] },
    thread: THREAD.slice() };
}
function paint(rec) { painted = ''; T.render(rec); return painted; }
const realNow = Date.now;

console.log('\n1. A priced estimate reads as a document\n');
{
  Date.now = () => Date.parse('2026-09-25T12:00:00Z');
  const html = paint(priced('2026-09-23T15:00:00Z'));
  Date.now = realNow;
  ok('ABOUT THIS ESTIMATE: prepared by Sani Building Corp for the work above at the address; what the price covers; outside scope only with your OK', /<div class="ey">About this estimate<\/div>/.test(html) && /This estimate is prepared by Sani Building Corp for the work described above at 1115 Prospect Ave Apt 102, Brooklyn 11218\. The price covers the work listed under each service\./.test(html) && /Anything outside this scope is quoted separately and done only with your OK\./.test(html));
  ok('...fully insured, the phone and email - and never "licensed"', /Sani Building Corp is fully insured\. Questions or changes: \(332\) 277-0990/.test(html) && !/licens/i.test(html));
  ok('THE REF, THE DATE ISSUED (the day it was sent) AND VALID UNTIL, thirty days later', /<small>Estimate<\/small>SBC-260920-ECB4/.test(html) && /<small>Date issued<\/small>September 23, 2026/.test(html) && /<small>Valid until<\/small>October 23, 2026/.test(html) && /This estimate is valid for 30 days from the date issued\. After that, prices may be updated\./.test(html), (html.match(/About this estimate[\s\S]{0,1200}/) || [''])[0].slice(0, 400));
  const iTerms = html.indexOf('About this estimate'), iApprove = html.indexOf('Approve estimate'), iMsg = html.indexOf('id="thread-card"');
  ok('ORDER: the terms, then Approve, then the messages last', iTerms > 0 && iApprove > iTerms && iMsg > iApprove, [iTerms, iApprove, iMsg].join(' < '));
  ok('THE MESSAGES ARE FOLDED: one closed line "Messages with Sani Building Corp (2)", not an open conversation', /<details class="card msgfold" id="thread-card"><summary class="ey" style="cursor:pointer">Messages with Sani Building Corp \(2\)<\/summary>/.test(html) && !/<details[^>]* open/.test(html.slice(iMsg, iMsg + 200)));
  ok('...still on the page, so the customer\'s next message has a place to land and the fold opens for it', /id="thread-wrap"/.test(html) && /if\(card\)\{card\.style\.display='';if\(card\.tagName==='DETAILS'\)card\.open=true\}/.test(QUOTE));
}

console.log('\n2. Past thirty days, a preview, and the questions phase\n');
{
  Date.now = () => Date.parse('2026-11-01T12:00:00Z');
  const old = paint(priced('2026-09-23T15:00:00Z'));
  Date.now = realNow;
  ok('PAST 30 DAYS and not approved: "Expired on" and ask for an updated price', /<small>Expired on<\/small>October 23, 2026/.test(old) && /This estimate has passed its 30 days and can no longer be approved\./.test(old));
  ok('...NO APPROVE BUTTON: "Request an updated estimate" instead, which opens the message box with the ask written', old.indexOf('Approve estimate') === -1 && old.indexOf("P('a')") === -1 && /<button class="approve" onclick="RU\(\)">Request an updated estimate<\/button>/.test(old) && /window\.RU=\(\)=>\{P\('q'\);const m=document\.getElementById\('msg'\);if\(m&&!m\.value\.trim\(\)\)m\.value='Hi, my estimate '\+ref\+' has expired\. Please send me an updated estimate\.'/.test(QUOTE));
  Date.now = () => Date.parse('2026-10-20T12:00:00Z');
  const fresh = paint(priced('2026-09-23T15:00:00Z'));
  Date.now = realNow;
  ok('...inside the thirty days the Approve button is there as before', fresh.indexOf('Approve estimate') !== -1 && fresh.indexOf('Request an updated estimate') === -1);
  const approved = priced('2026-09-23T15:00:00Z'); approved.status = 'accepted'; approved.acceptedAt = '2026-09-24T10:00:00Z';
  Date.now = () => Date.parse('2026-11-01T12:00:00Z');
  const acc = paint(approved);
  Date.now = realNow;
  ok('an APPROVED estimate never says expired', !/Expired on/.test(acc) && /Valid until/.test(acc));
  const vu = T.validUntil({});
  ok('A PREVIEW (never sent): issued today, valid thirty days from today, never expired', Math.abs(vu.getTime() - (Date.now() + 30 * 86400000)) < 5000);
  const q = paint({ ref: 'SBC-260920-ECB4', status: 'new', customer: { name: 'Michelle' }, request: { service: 'Painting' }, estimate: { labor: [], materials: [] }, thread: THREAD.slice() });
  ok('THE QUESTIONS PHASE (nothing priced): the conversation stays open, no terms, no expiry', /<section class="card" id="thread-card">/.test(q) && !/About this estimate/.test(q) && !/Valid until/.test(q));
  const none = priced('2026-09-23T15:00:00Z'); none.thread = [];
  ok('a priced estimate with no messages after the send: the fold is hidden altogether', /<details class="card msgfold" id="thread-card" style="display:none">/.test(paint(none)));
}
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
