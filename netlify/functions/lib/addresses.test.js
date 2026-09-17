/* addresses.test.js — run: node netlify/functions/lib/addresses.test.js
 *
 *   "which emails respond, in which emails comes booking, from which emails
 *    send responses, in which email receives response from customers and
 *    which emails use for tracking notifications"
 *
 * One job per address:  contact@ = humans (the reply-to on everything a
 * customer gets, the only address he answers from);  estimates@ = the system
 * talks (the From on everything automatic);  info@ = alerts to him only.
 *
 * This file scans EVERY function for a sender or reply-to that breaks the
 * rule, then drives the real quote-response handler and reads the two emails
 * it sends: the customer's receipt must reply to contact@, the alert must go
 * to info@. The two things that would put him back where he started: a
 * customer email whose reply-to is the alerts box, and a second sender
 * showing up in a customer's inbox.
 */
const Module = require('module'), path = require('path'), fs = require('fs');

const ROOT = path.join(__dirname, '..', '..', '..');
const FN_DIR = path.join(ROOT, 'netlify/functions');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* ══ THE LIB ══════════════════════════════════════════════════════════════ */
console.log('\nthe three addresses, and their jobs\n');
const A = require(path.join(FN_DIR, 'lib/addresses.js'));
delete process.env.CONTRACTOR_EMAIL; delete process.env.CUSTOMER_REPLY_TO;
ok('alerts go to info@ by default', A.alertsTo() === 'info@sanibuildingcorp.com', A.alertsTo());
ok('customers reply to contact@ by default', A.replyTo() === 'contact@sanibuildingcorp.com', A.replyTo());
ok('the system sends as estimates@', /<estimates@sanibuildingcorp\.com>$/.test(A.FROM_SYSTEM) && /<estimates@sanibuildingcorp\.com>$/.test(A.FROM_ZURABI));
process.env.CONTRACTOR_EMAIL = 'alerts@example.com';
ok('CONTRACTOR_EMAIL still overrides the alerts address, as it always did', A.alertsTo() === 'alerts@example.com');
ok('...and does NOT move the customer reply-to — that coupling was the bug', A.replyTo() === 'contact@sanibuildingcorp.com');
process.env.CUSTOMER_REPLY_TO = 'hello@example.com';
ok('CUSTOMER_REPLY_TO overrides the reply-to on its own', A.replyTo() === 'hello@example.com');
delete process.env.CONTRACTOR_EMAIL; delete process.env.CUSTOMER_REPLY_TO;

/* ══ EVERY FUNCTION, STATICALLY ═══════════════════════════════════════════ */
console.log('\nno function sends from anything but estimates@, or points a customer at the alerts box\n');
const files = fs.readdirSync(FN_DIR).filter(f => /\.js$/.test(f) && !/\.test\.js$/.test(f));
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const badFrom = [], badReplyTo = [], badDefault = [], mailtoIsFine = [];
for (const f of files) {
  const src = strip(fs.readFileSync(path.join(FN_DIR, f), 'utf8'));
  /* a From with an address in it that is not the system sender */
  const froms = src.match(/^\s*from:\s*(["'`])[^\n]*@[^\n]*\1,?\s*$/gm) || [];
  for (const line of froms) if (line.indexOf('<estimates@sanibuildingcorp.com>') === -1 && line.indexOf('${user}') === -1) badFrom.push(f + ': ' + line.trim());
  if (/noreply@sanibuildingcorp|contact@sanibuildingcorp\.com>/.test(src)) {
    const hits = src.match(/^.*(noreply@sanibuildingcorp|contact@sanibuildingcorp\.com>).*$/gm) || [];
    for (const h of hits) if (/^\s*from:/.test(h)) badFrom.push(f + ': ' + h.trim());
  }
  /* a reply-to aimed at the alerts address */
  const rts = src.match(/^\s*reply_to:\s*[^\n]*$/gm) || [];
  for (const line of rts) if (/contractorEmail|CONTRACTOR_EMAIL|alertsTo\(\)/.test(line)) badReplyTo.push(f + ': ' + line.trim());
  /* a private default for the alerts address */
  const defs = src.match(/CONTRACTOR_EMAIL\s*\|\|\s*["'][^"']*@[^"']*["']/g) || [];
  for (const d of defs) badDefault.push(f + ': ' + d);
}
ok('EVERY From IS estimates@ (' + files.length + ' functions scanned)', badFrom.length === 0, badFrom.join('\n        '));
ok('NO CUSTOMER EMAIL REPLIES TO THE ALERTS ADDRESS', badReplyTo.length === 0, badReplyTo.join('\n        '));
ok('no function keeps its own default for the alerts address - one place, lib/addresses.js', badDefault.length === 0, badDefault.join('\n        '));
ok('the sixteen senders all import the lib',
  ['estimate-request', 'form-alert', 'handyman-agreement', 'handyman-send-confirmation', 'handyman-submit', 'quote-response', 'send-confirmation',
   'send-estimate-link', 'send-invoice', 'send-quote', 'send-reply', 'sign-contract', 'thread-reply', 'track-open', 'track-quote-open', 'visit-reminders']
    .every(f => /require\("\.\/lib\/addresses"\)/.test(fs.readFileSync(path.join(FN_DIR, f + '.js'), 'utf8'))));
ok('the website still shows contact@ to customers - the humans address did not change',
  /contact@sanibuildingcorp\.com/.test(fs.readFileSync(path.join(ROOT, 'partials/footer.html'), 'utf8')) &&
  !/info@sanibuildingcorp\.com/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')));

/* ══ EXECUTED: quote-response sends two emails ════════════════════════════ */
console.log('\nquote-response, executed: the receipt replies to contact@, the alert goes to info@\n');
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
let sent = [];
https.request = function (opts, cb) {
  let body = '';
  return {
    on() { return this; }, write(d) { body += d; },
    end() {
      sent.push(JSON.parse(body));
      const res = { statusCode: 200, on(ev, fn) { if (ev === 'data') fn(Buffer.from('{"id":"x"}')); if (ev === 'end') fn(); return this; } };
      setImmediate(() => cb(res));
    },
  };
};
process.env.RESEND_API_KEY = 'rk';
process.env.SITE_URL = 'https://www.sanibuildingcorp.com';
const fn = require(path.join(FN_DIR, 'quote-response.js'));
(async () => {
  STORE = { 'SBC-1': {
    ref: 'SBC-1', status: 'sent',
    customer: { name: 'Mike Ross', email: 'mike@example.com', address: '3855 Shore Pkwy, Brooklyn' },
    request: { service: 'Bathroom Renovation' },
    estimate: { projectTitle: 'Bathroom', markupPct: 0, labor: [{ section: 'B', item: 'Demo', qty: 10, unit: 'hrs', rate: 100 }], materials: [] },
  } };
  sent = [];
  const r = await fn.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ ref: 'SBC-1', action: 'accept', signature: 'Mike Ross' }) });
  ok('accept went through', r.statusCode === 200, String(r.body).slice(0, 120));
  const toCustomer = sent.find(s => s.to && s.to[0] === 'mike@example.com');
  const toHim = sent.find(s => s.to && s.to[0] !== 'mike@example.com');
  ok('two emails: one to the customer, one to him', !!toCustomer && !!toHim, JSON.stringify(sent.map(s => s.to)));
  ok("THE CUSTOMER'S RECEIPT REPLIES TO contact@ — not to the alerts box", toCustomer && toCustomer.reply_to === 'contact@sanibuildingcorp.com', toCustomer && toCustomer.reply_to);
  ok('...and comes from estimates@', toCustomer && /<estimates@sanibuildingcorp\.com>/.test(toCustomer.from), toCustomer && toCustomer.from);
  ok('THE ALERT GOES TO info@ with no env set', toHim && toHim.to[0] === 'info@sanibuildingcorp.com', toHim && toHim.to[0]);
  ok('...from estimates@, replying to the customer so a quick answer still works', toHim && /<estimates@sanibuildingcorp\.com>/.test(toHim.from) && toHim.reply_to === 'mike@example.com', toHim && (toHim.from + ' / ' + toHim.reply_to));

  process.env.CONTRACTOR_EMAIL = 'zura@example.com';
  sent = []; STORE['SBC-1'].status = 'sent';
  await fn.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ ref: 'SBC-1', action: 'accept', signature: 'Mike Ross' }) });
  const him2 = sent.find(s => s.to && s.to[0] !== 'mike@example.com');
  const cust2 = sent.find(s => s.to && s.to[0] === 'mike@example.com');
  ok('with CONTRACTOR_EMAIL set the alert follows it', him2 && him2.to[0] === 'zura@example.com', him2 && him2.to[0]);
  ok('...and the customer STILL replies to contact@', cust2 && cust2.reply_to === 'contact@sanibuildingcorp.com', cust2 && cust2.reply_to);

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
