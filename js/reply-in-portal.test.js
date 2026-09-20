/* reply-in-portal.test.js — run: node js/reply-in-portal.test.js
 *
 *   "if they click reply in the email then conversation will come to our email
 *    as new, so let's think about how we can push customers to type in this
 *    conversation and not click just reply direct from the email, we may can
 *    add empty card for type reply in the first before click view or reply
 *    yellow button"
 *
 * A customer reads the message on a phone. Under it: the gold "View your
 * project & reply" button, and at the very bottom of the screen Gmail's own
 * Reply. Reply is the habit. Pressing it sends their answer as a fresh email,
 * outside the conversation the estimate lives in, and the dashboard never sees
 * it.
 *
 * An email cannot carry a real text box - Gmail strips forms - so the fix is
 * an affordance: the first thing under the message is now a box that LOOKS
 * like a place to type ("Tap here to type your reply…"). It is a link. Tapping
 * it opens the project page with the reply box open and the cursor in it. The
 * button follows it, pointing at the same place.
 *
 * TWO THINGS THAT WOULD HURT: a card that looks tappable but is not a link,
 * and a link that opens the page with the reply box still hidden behind
 * "Request changes / ask a question" - which is exactly how a priced quote
 * renders. Both are exercised below with the real code.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const QUOTE = fs.readFileSync(path.join(ROOT, 'quote.html'), 'utf8');
const build = require(path.join(ROOT, 'netlify/functions/lib/message-email.js'));
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

const REC = {
  ref: 'SBC-260915-UYE6', status: 'question',
  customer: { name: 'Zurabi', email: 'z@example.com', address: '3855 Shore Pkwy Apt 1K, Brooklyn' },
  request: { service: 'Bathroom Renovation' },
  estimate: { projectTitle: 'Full Gut Renovation — 5 ft x 7 ft Bathroom', labor: [{ item: 'Demo', qty: 8, rate: 75 }] },
};
const MSG = { from: 'contractor', text: "Hey it's still test email", at: '2026-09-16T16:01:00Z' };
const cust = build({ ref: REC.ref, record: REC, message: MSG, audience: 'customer', siteUrl: 'https://www.sanibuildingcorp.com' });
const cont = build({ ref: REC.ref, record: REC, message: { from: 'customer', text: 'ok', at: MSG.at }, audience: 'contractor', siteUrl: 'https://www.sanibuildingcorp.com' });
const REPLY_URL = 'https://www.sanibuildingcorp.com/quote.html?ref=SBC-260915-UYE6#reply';

/* ══ THE EMAIL ════════════════════════════════════════════════════════════ */
console.log('\nthe customer email leads with a place to type\n');
{
  const h = cust.html;
  const card = h.indexOf('Tap here to type your reply');
  const btn = h.indexOf('Open my project &amp; reply');
  /* Located by a fragment with no apostrophe - esc() encodes the quote and
     the first version of this line guessed the wrong entity. */
  const msg = h.indexOf('still test email');
  ok('THERE IS A REPLY CARD', card !== -1);
  ok('...directly under the message, before the button', msg !== -1 && card > msg && btn > card, 'msg@' + msg + ' card@' + card + ' btn@' + btn);
  ok('THE CARD IS A LINK — a box that looks tappable and is not would be worse than no box',
    new RegExp('<a href="' + REPLY_URL.replace(/[.?]/g, '\\$&') + '"[^>]*>\\s*(?:\\S+\\s)?Tap here to type your reply').test(h));
  ok('...and it opens the page at the reply box, not just the page', h.indexOf(REPLY_URL) !== -1);
  ok('it is styled to be seen — gold border, cream fill, bold dark text, and it says the reply goes to Zurabi',
    /border:2px solid #c8860a[^>]*color:#0a1628[^>]*font-weight:bold/.test(h) && /Your reply goes straight to Zurabi/.test(h));
  ok('it is labelled with who they are replying to', /Reply to Zurabi/.test(h));
  ok('the button points at the same place', new RegExp('<a href="' + REPLY_URL.replace(/[.?]/g, '\\$&') + '"[^>]*>Open my project').test(h));
  ok('...and says why: everything stays together', /keeps your estimate, your photos and every message together/.test(h));
  ok('the old wording ("View your project & reply") is gone from the customer copy', h.indexOf('View your project') === -1);
  ok('the plain-text version carries the #reply link too', cust.text.indexOf(REPLY_URL) !== -1);
  /* The subject used to carry the ref for inbox-sync. It reads the ref out
     of the quoted header card now, and matches by address without one. */
  ok('THE SUBJECT IS THE PROJECT IN WORDS, no code first', cust.subject === 'About your project: Full Gut Renovation — 5 ft x 7 ft Bathroom', cust.subject);
  ok('...and the ref is still in the header card, which a Gmail reply quotes back for inbox-sync', h.indexOf('Estimate SBC-260915-UYE6') !== -1);
}
console.log('\nthe contractor copy is unchanged - he replies from the dashboard\n');
{
  ok('no reply card in the contractor email', cont.html.indexOf('Tap here to type') === -1);
  ok('his button still says "Open the estimate"', /Open the estimate &rarr;/.test(cont.html) && cont.html.indexOf('#reply') === -1);
}

/* ══ THE PAGE ═════════════════════════════════════════════════════════════ */
console.log('\narriving with #reply opens the box and puts the cursor in it\n');
function ext(name) {
  const s = QUOTE.search(new RegExp('function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = QUOTE.indexOf('{', s); j < QUOTE.length; j++) {
    if (QUOTE[j] === '{') d++;
    else if (QUOTE[j] === '}') { d--; if (!d) return QUOTE.slice(s, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}
function page(hash) {
  const log = { opened: null, scrolled: false, focused: false };
  const box = { scrollIntoView() { log.scrolled = true; }, focus() { log.focused = true; } };
  const ctx = {
    String, setTimeout: (fn) => fn(),
    location: { hash: hash },
    P: (id) => { log.opened = id; },
    document: { getElementById: (id) => id === 'msg' ? box : null },
  };
  vm.createContext(ctx);
  vm.runInContext(ext('replyFromHash'), ctx);
  log.result = vm.runInContext('replyFromHash()', ctx);
  return log;
}
{
  const r = page('#reply');
  ok('WITH #reply THE MESSAGE PANEL IS OPENED — this is the priced-quote case, where it is hidden behind a button',
    r.opened === 'q', JSON.stringify(r));
  ok('...scrolled into view', r.scrolled);
  ok('...and focused, so the keyboard comes up', r.focused);
  ok('...and it reports that it did something', r.result === true);
}
{
  const r = page('');
  ok('without the hash nothing happens — a normal visit is untouched', r.opened === null && !r.scrolled && !r.focused && r.result === false);
}
{
  const r = page('#something-else');
  ok('another hash is ignored', r.opened === null && r.result === false);
}
/* The render line contains "||{}" so a [^}]* in the middle of this regex
   could never reach the call - the first version failed on a correct page. */
ok('render() calls it after drawing the page, for both layouts',
  /function render\(r\)\{seedChosen\(r\);/.test(QUOTE) && /renderLegacy\(r\);(?:threadScrollBottom\(\);)?replyFromHash\(\)\}/.test(QUOTE));
ok('the panel id it opens is the one the message box actually has', /id="q"><div class="ey"[^>]*>Send us a message/.test(QUOTE));
ok('P() is still the function that opens a panel', /window\.P=id=>\{document\.querySelectorAll\('\.panel'\)/.test(QUOTE));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
