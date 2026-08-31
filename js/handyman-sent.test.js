/* handyman-sent.test.js — run: node js/handyman-sent.test.js
 *
 *   "i sent confirmation to the customer but then in my dashboard still showing
 *    new, ones i will reopen in my dashboard i maybe not remember what i sent
 *    and what not and i need it to know what i sent to customer"
 *
 * TWO DIFFERENT THINGS WERE BEING SHOWN AS ONE.
 *
 *   status            — about the WORK: new, confirmed, in progress, completed.
 *   agreement_status  — about whether a PRICE has been sent to this customer.
 *
 * Only the first was ever displayed. So a booking that had been quoted looked
 * identical to one that had not, and a day later there was no way to tell them
 * apart, or to see what number went out.
 *
 * The information was there the whole time. handyman-send-confirmation writes a
 * full agreements row — price, appointment, duration, scope summary, deposit,
 * token — and sets bookings.agreement_status the moment the email goes. Nothing
 * read any of it.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
const GET = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'handyman-get.js'), 'utf8');
const SEND = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'handyman-send-confirmation.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

function ext(name) {
  const s = HTML.search(new RegExp('function ' + name + '\\('));
  if (s < 0) throw new Error('missing ' + name);
  let d = 0;
  for (let j = HTML.indexOf('{', s); j < HTML.length; j++) {
    if (HTML[j] === '{') d++;
    else if (HTML[j] === '}') { d--; if (!d) return HTML.slice(s, j + 1); }
  }
}
/* Only what this script block really has. */
const ctx = { console, String, Number, Array, Object, Boolean, Math, JSON, Date, isFinite, encodeURIComponent };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
['esc', 'handymanSentBadge', 'handymanSentPanel'].forEach(function (n) { vm.runInContext(ext(n), ctx); });
const badge = (b) => vm.runInContext('handymanSentBadge(' + JSON.stringify(b) + ')', ctx);
const panel = (b) => vm.runInContext('handymanSentPanel(' + JSON.stringify(b) + ')', ctx);

/* The live booking: Uchenna Itam's full handyman day, confirmation sent at a
   $950 cap with a $150 deposit — and the card still reading NEW. */
function kfhg(over) {
  return Object.assign({
    ref: 'SBC-H-260830-KFHG',
    status: 'new',
    agreement_status: 'sent',
    agreements: [{
      created_at: '2026-08-30T14:41:00.000Z',
      status: 'sent',
      pricing_mode: 'capped',
      price_max: 950,
      appointment_date: 'Sep 4, 2026',
      duration_text: '8-10 hours',
      scope_summary: 'Full handyman day to address multiple minor repairs including patching, reinstallation of fixtures, and regrouting.',
      pay_now_enabled: true,
      pay_now_amount: 150,
      pay_now_label: 'Deposit',
      token: 'tok-abc-123',
    }],
  }, over || {});
}

console.log('\nthe badge on the card\n');
ok('A BOOKING THAT HAS BEEN QUOTED SAYS SO', /SENT/.test(badge({ agreement_status: 'sent' })), badge({ agreement_status: 'sent' }));
ok('a signed one says signed', /SIGNED/.test(badge({ agreement_status: 'signed' })));
ok('one where the customer asked for changes says that', /CHANGES/.test(badge({ agreement_status: 'changes_requested' })));
ok('A BOOKING WITH NOTHING SENT SHOWS NOTHING — silence must mean "not sent"',
  badge({ agreement_status: '' }) === '' && badge({}) === '' && badge(null) === '');
ok('an unknown status is still shown rather than swallowed',
  badge({ agreement_status: 'expired' }).indexOf('EXPIRED') !== -1, badge({ agreement_status: 'expired' }));
/* `handymanSentBadge(b)` also matches the function's own DECLARATION, so the
   first version of this assertion passed with the call site deleted. Anchored on
   the concatenation that only appears where it is actually rendered. */
ok('the badge is rendered on the card, beside the work status rather than instead of it',
  /handymanSentBadge\(b\) \+\n/.test(HTML) && /'<span class="badge h-' \+ status \+ '">'/.test(HTML));

console.log('\nwhat was sent, when the booking is reopened weeks later\n');
{
  const h = panel(kfhg());
  ok('THE PRICE THAT WENT OUT IS SHOWN', h.indexOf('$950') !== -1, h.slice(0, 300));
  ok('...described as the cap it was, not as a flat price', /up to \$950/.test(h), h.slice(0, 300));
  ok('the appointment is shown', h.indexOf('Sep 4, 2026') !== -1 && h.indexOf('8-10 hours') !== -1);
  ok('THE DEPOSIT IS SHOWN — it is money the customer was asked for',
    h.indexOf('$150') !== -1 && /Deposit/.test(h), h);
  ok('the scope that was quoted is shown', h.indexOf('Full handyman day') !== -1);
  ok('when it was sent is shown', /Aug 30/.test(h), h.slice(0, 400));
  ok('AND A LINK TO THE EXACT PAGE THE CUSTOMER SAW',
    h.indexOf('/agreement.html?token=tok-abc-123') !== -1 && /Open what they saw/.test(h));
}
{
  const h = panel(kfhg({ agreements: [] }));
  ok('NOTHING SENT SAYS SO OUT LOUD — an empty space does not answer the question',
    /Nothing sent yet/.test(h) && /not been given a price/.test(h), h);
}
ok('a booking that never loaded its agreements does not throw',
  (function () { try { panel({}); panel(null); panel({ agreements: 'nope' }); return true; } catch (e) { return 'threw: ' + e.message; } })() === true);

/* Several sends: the newest is the one that counts, the rest are history. */
{
  const h = panel(kfhg({ agreements: [
    { created_at: '2026-08-30T16:00:00.000Z', status: 'sent', pricing_mode: 'fixed', fixed_price: 1100, token: 't2' },
    { created_at: '2026-08-30T14:41:00.000Z', status: 'sent', pricing_mode: 'capped', price_max: 950, token: 't1' },
  ] }));
  ok('every confirmation ever sent is listed, so a changed price is not lost',
    h.indexOf('$1,100') !== -1 && h.indexOf('$950') !== -1, h.slice(0, 500));
  ok('...the older one is marked superseded so the current price is unmistakable',
    /superseded/.test(h) && h.indexOf('superseded') > h.indexOf('$1,100'), h.slice(0, 700));
}
{
  const h = panel(kfhg({ agreements: [{ created_at: '2026-08-30T14:00:00Z', status: 'sent', price_min: 800, price_max: 1250, token: 't' }] }));
  ok('a range price is shown as a range', /\$800–\$1,250/.test(h), h.slice(0, 300));
}
{
  const h = panel(kfhg({ agreements: [{ created_at: '2026-08-30T14:00:00Z', status: 'sent', pricing_mode: 'fixed', fixed_price: 950, token: 't' }] }));
  ok('a fixed price says fixed', /\$950 fixed/.test(h), h.slice(0, 300));
}
{
  const h = panel(kfhg({ agreements: [{ created_at: 'x', status: 'sent', token: 't' }] }));
  ok('a row with no price at all renders a dash rather than $NaN or $undefined',
    h.indexOf('NaN') === -1 && h.indexOf('undefined') === -1, h.slice(0, 300));
}
{
  const h = panel(kfhg({ agreements: [{ created_at: 'x', status: 'sent', fixed_price: 1, scope_summary: '<img src=x onerror=alert(1)>', special_notes: '"><b>x</b>', token: '"><script>' }] }));
  ok('hostile content cannot inject markup',
    h.indexOf('<img src=x') === -1 && h.indexOf('<b>x</b>') === -1 && h.indexOf('"><script>') === -1, h);
}
ok('a deposit that was not asked for is not shown as one',
  panel(kfhg({ agreements: [{ created_at: 'x', status: 'sent', fixed_price: 500, pay_now_enabled: false, pay_now_amount: 0, token: 't' }] })).indexOf('on signing') === -1);

/* ══ THE WIRING ══════════════════════════════════════════════════════════════ */
console.log('\nthe data actually reaches the page\n');
ok('THE SERVER ALREADY RECORDED IT — this was never a data problem',
  /agreement_status: "sent"/.test(SEND) && /status: "sent"/.test(SEND));
ok('the booking fetch now brings its agreements back', /rest\/v1\/agreements\?booking_ref=eq\./.test(GET));
ok('...newest first, so the current price is the first one shown', /order=created_at\.desc/.test(GET));
ok('...and a failed lookup still returns the booking, because the detail must open',
  /catch \(e\)[\s\S]{0,160}booking\.agreements = \[\]/.test(GET));
ok('the panel is rendered in the booking detail', /handymanSentPanel\(b\) \+/.test(HTML));
ok('SENDING REOPENS THE BOOKING, so it does not sit there still saying nothing was sent',
  /if \(sentRef\) openHandymanDetail\(sentRef\);/.test(HTML));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
