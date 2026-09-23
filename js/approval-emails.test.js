/* approval-emails.test.js — run: node js/approval-emails.test.js
 *
 *   "I clicked approve and it's shows in my dashboard but not received
 *    notification, i need to receive notification once customer will approve
 *    and customer have to see confirmation email too for letting them feel one
 *    step is done"
 *
 * TWO FAILURES, ONE BUTTON.
 *
 * 1. THE CONTRACTOR'S "ACCEPTED" EMAIL NEVER ARRIVED. notifyContractor was the
 *    one sender left in the whole system on onboarding@resend.dev - Resend's
 *    sandbox address, which delivers only to the Resend account's own login
 *    email and refuses every other recipient. Every other email goes out from
 *    the verified domain and arrives. The dashboard said ACCEPTED; the inbox
 *    stayed empty; the error was logged and swallowed.
 *
 * 2. THE CUSTOMER GOT NOTHING AT ALL. There was no confirmation email on
 *    approval. A renovation approved on a phone deserves a receipt.
 *
 * This file drives the real quote-response handler against a stubbed store
 * and a captured Resend, and reads every email that would have gone out.
 */
const Module = require('module'), path = require('path'), fs = require('fs');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* ── stubs: the blob store and the outbound https ───────────────────────── */
let STORE = {};
const realLoad = Module._load;
Module._load = function (r, p, m) {
  if (r === '@netlify/blobs') return { getStore: () => ({
    get: async (k) => STORE[k] ? JSON.parse(JSON.stringify(STORE[k])) : null,
    setJSON: async (k, v) => { STORE[k] = JSON.parse(JSON.stringify(v)); },
  }) };
  return realLoad(r, p, m);
};
const https = require('https');
let sent = [], failNth = 0;
https.request = function (opts, cb) {
  let body = '';
  return {
    on() { return this; },
    write(d) { body += d; },
    end() {
      const n = sent.length + 1;
      const payload = JSON.parse(body);
      sent.push({ host: opts.hostname, payload: payload });
      const code = failNth === n ? 403 : 200;
      const res = { statusCode: code, on(ev, fn) { if (ev === 'data') fn(Buffer.from(code === 200 ? '{"id":"x"}' : '{"message":"You can only send testing emails to your own email address"}')); if (ev === 'end') fn(); return this; } };
      setImmediate(() => cb(res));
    },
  };
};

process.env.RESEND_API_KEY = 'rk';
process.env.CONTRACTOR_EMAIL = 'zura@example.com';
process.env.SITE_URL = 'https://www.sanibuildingcorp.com';
const fn = require(path.join(ROOT, 'netlify/functions/quote-response.js'));

const REC = () => ({
  ref: 'SBC-260915-UYE6', status: 'sent',
  customer: { name: 'Mike Ross', email: 'mike@example.com', address: '3855 Shore Pkwy Apt 1K, Brooklyn' },
  request: { service: 'Bathroom Renovation' },
  estimate: {
    projectTitle: 'Full Gut Renovation — 5 ft x 7 ft Bathroom', markupPct: 0,
    labor: [{ section: 'Bathroom', item: 'Demo', qty: 10, unit: 'hrs', rate: 100 }],
    materials: [{ section: 'Bathroom', item: 'Tile', qty: 1, unit: 'ea', rate: 500 }],
  },
});
const call = async (body) => {
  const r = await fn.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) });
  return { code: r.statusCode, body: JSON.parse(r.body) };
};
const reset = () => { STORE = { 'SBC-260915-UYE6': REC() }; sent = []; failNth = 0; };

(async function () {
  /* ══ APPROVE ═══════════════════════════════════════════════════════════ */
  console.log('\napprove: two emails go out, and both from the real domain\n');
  reset();
  const r = await call({ ref: 'SBC-260915-UYE6', action: 'accept', signature: 'Mike Ross' });
  ok('the approval is saved', r.code === 200 && r.body.status === 'accepted' && STORE['SBC-260915-UYE6'].status === 'accepted');
  ok('TWO EMAILS WERE SENT', sent.length === 2, sent.length + ' sent: ' + sent.map(s => s.payload.to).join(' | '));
  const toZura = sent.find(s => (s.payload.to || []).indexOf('zura@example.com') !== -1);
  const toMike = sent.find(s => (s.payload.to || []).indexOf('mike@example.com') !== -1);
  ok('one to the contractor', !!toZura);
  ok('one to the customer', !!toMike);
  ok('both through Resend', sent.every(s => s.host === 'api.resend.com'));

  if (toZura) {
    ok('THE CONTRACTOR COPY IS NOT FROM onboarding@resend.dev — that sandbox sender is why nothing ever arrived',
      toZura.payload.from.indexOf('resend.dev') === -1 && /estimates@sanibuildingcorp\.com/.test(toZura.payload.from), toZura.payload.from);
    ok('...and says ACCEPTED in the subject with the ref', /ACCEPTED/.test(toZura.payload.subject) && /SBC-260915-UYE6/.test(toZura.payload.subject), toZura.payload.subject);
    ok('...and replies go to the customer', toZura.payload.reply_to === 'mike@example.com');
  }
  if (toMike) {
    const p = toMike.payload;
    ok('THE CUSTOMER RECEIPT SAYS APPROVED IN THE SUBJECT, with the ref (inbox-sync reads it back)',
      /Thank you for your go-ahead/.test(p.subject) && /SBC-260915-UYE6/.test(p.subject) && /Full Gut Renovation/.test(p.subject), p.subject);
    ok('...from the verified domain, signed Zurabi', /estimates@sanibuildingcorp\.com/.test(p.from) && /Zurabi/.test(p.from));
    /* Used to be the CONTRACTOR_EMAIL (the alerts box). One job per address
       now: a customer's reply goes to contact@, the humans address. */
    ok('...replies reach contact@, the humans address - not the alerts box', p.reply_to === 'contact@sanibuildingcorp.com', p.reply_to);
    /* The figure is whatever lib/customer-total says the customer sees for
       the record as saved - the same definition every other email uses - not
       a number this test adds up on its own. The first version assumed
       $1,500.00 and was wrong about how the total is derived. */
    const expect = '$' + require(path.join(ROOT, 'netlify/functions/lib/customer-total'))(STORE['SBC-260915-UYE6'].estimate, STORE['SBC-260915-UYE6']).customerTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    ok('...it carries the approved figure, as customer-total defines it (' + expect + ')',
      Number(expect.replace(/[$,]/g, '')) > 0 && p.html.indexOf(expect) !== -1 && p.text.indexOf(expect) !== -1, (p.html.match(/\$[\d,]+\.\d\d/) || [])[0]);
    ok('...uses the customer\'s first name', /Thank you, Mike\./.test(p.html));
    ok('...says we have the go-ahead and that nothing is paid now', /We have your go-ahead/.test(p.html) && /Nothing is paid now\./.test(p.html) && !/is approved/.test(p.html));
    ok('...says what happens next', /What happens next/.test(p.html) && /The Sani Building Corp team will contact you within one business day/.test(p.html) && /The final agreement, signature and payment come after that conversation/.test(p.html));
    ok('...links to the project page', p.html.indexOf('https://www.sanibuildingcorp.com/quote.html?ref=SBC-260915-UYE6') !== -1);
    ok('...never says "licensed"', !/licensed/i.test(p.html) && !/licensed/i.test(p.text));
    ok('...says fully insured', /Fully insured/.test(p.html));
    ok('...has the same project header as every other email about the job', /Estimate SBC-260915-UYE6/.test(p.html) && /3855 Shore Pkwy/.test(p.html));
    ok('...and a plain-text version', p.text.indexOf('WE HAVE YOUR GO-AHEAD') !== -1);
  }
  ok('the response reports both deliveries', r.body.notified === true && r.body.customerNotified === true, JSON.stringify(r.body).slice(0, 120));

  /* ══ ONE SIDE FAILS ════════════════════════════════════════════════════ */
  console.log('\nif one email fails the other still goes, and the response says which\n');
  reset(); failNth = 2;
  const r2 = await call({ ref: 'SBC-260915-UYE6', action: 'accept' });
  ok('the approval is still saved', r2.code === 200 && r2.body.status === 'accepted');
  ok('both sends were attempted', sent.length === 2);
  ok('contractor delivered, customer not — reported separately', r2.body.notified === true && r2.body.customerNotified === false, JSON.stringify(r2.body).slice(0, 120));

  reset(); failNth = 1;
  const r3 = await call({ ref: 'SBC-260915-UYE6', action: 'accept' });
  ok('a failed contractor email does not stop the customer receipt', sent.length === 2 && r3.body.notified === false && r3.body.customerNotified === true, JSON.stringify(r3.body).slice(0, 140));

  /* ══ OTHER ACTIONS ═════════════════════════════════════════════════════ */
  console.log('\nonly an approval earns the customer receipt\n');
  reset();
  await call({ ref: 'SBC-260915-UYE6', action: 'decline', declineReason: 'too much' });
  ok('decline: one email, to the contractor only', sent.length === 1 && sent[0].payload.to[0] === 'zura@example.com' && /DECLINED/.test(sent[0].payload.subject));
  ok('...also from the real domain now', sent[0].payload.from.indexOf('resend.dev') === -1);

  reset();
  await call({ ref: 'SBC-260915-UYE6', action: 'question', questionText: 'Is the vanity included?' });
  ok('question: one email, to the contractor only', sent.length === 1 && sent[0].payload.to[0] === 'zura@example.com');

  reset(); STORE['SBC-260915-UYE6'].customer.email = '';
  const r4 = await call({ ref: 'SBC-260915-UYE6', action: 'accept' });
  ok('no customer email on the record: contractor still told, receipt skipped, not crashed',
    r4.code === 200 && sent.length === 1 && r4.body.customerNotified === false);

  /* ══ NOTHING OLD LEFT ══════════════════════════════════════════════════ */
  console.log('\nno sender anywhere is on the sandbox address\n');
  {
    const dir = path.join(ROOT, 'netlify/functions');
    const walk = (d) => fs.readdirSync(d).flatMap(f => { const p = path.join(d, f); return fs.statSync(p).isDirectory() ? walk(p) : [p]; });
    const hits = walk(dir).filter(p => p.endsWith('.js') && !/\.test\.js$/.test(p) && /onboarding@resend\.dev/.test(fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')));
    ok('onboarding@resend.dev is gone from every function', hits.length === 0, hits.map(p => path.relative(ROOT, p)).join(', '));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e));
  console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed\n');
  process.exit(1);
});
