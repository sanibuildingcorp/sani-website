/* invoice-resend.test.js — run: node js/invoice-resend.test.js
 *
 *   "In there i want resend same invoice but there is no button for resending"
 *
 * There was no way to send an invoice twice, and the obvious workaround made
 * things worse. send-invoice numbers every invoice one past however many the
 * record already holds:
 *
 *     const invoiceCount = (record.invoices || []).length + 1;
 *
 * So pressing Send again on a job that already had a deposit and a final
 * produced INV-...-03 — a THIRD invoice, for money already billed, sitting on
 * the record and landing in the customer's inbox looking like a new charge.
 * Chasing an unpaid bill meant either billing twice or saying nothing.
 *
 * A resend now names the invoice it is resending, and every figure comes from
 * the stored row rather than from whatever the form happens to hold. The
 * customer receives the identical document; the record gains a resend count
 * instead of another invoice.
 *
 * THE ONE THAT WOULD HURT MOST: an invoice already marked PAID must not be
 * dragged back to "sent" because a copy was emailed. That is asserted below.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* ── run the real function, with the network and storage stubbed ────────── */
let STORE = {};
let sent = [];
const realLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === '@netlify/blobs') {
    return {
      getStore: () => ({
        get: async (k) => (STORE[k] ? JSON.parse(JSON.stringify(STORE[k])) : null),
        setJSON: async (k, v) => { STORE[k] = JSON.parse(JSON.stringify(v)); },
      }),
    };
  }
  if (req === 'https') {
    /* Every outbound call succeeds and is recorded. */
    return {
      request: function (opts, cb) {
        const chunks = [];
        /* A Buffer, not a string: the real code does Buffer.concat on the
           chunks and throws on a string. */
        const res = { statusCode: 200, on: function (e, f) { if (e === 'data') f(Buffer.from('{"id":"stub"}')); if (e === 'end') f(); return res; } };
        return {
          on: function () { return this; },
          write: function (d) { chunks.push(String(d)); },
          end: function () { sent.push(chunks.join('')); cb(res); },
        };
      },
    };
  }
  return realLoad(req, parent, isMain);
};

process.env.RESEND_API_KEY = 'test-key';
process.env.MY_SITE_ID = 'site';
process.env.MY_BLOBS_TOKEN = 'tok';
process.env.PUBLIC_SITE_URL = 'https://www.sanibuildingcorp.com';

const { handler } = require(path.join(__dirname, '..', 'netlify', 'functions', 'send-invoice.js'));

/* The live record: a paid deposit and an unpaid final, exactly as on XQNQ. */
function xqnq() {
  return {
    ref: 'SBC-260821-XQNQ',
    status: 'invoiced',
    customer: { name: 'Kono Designs LLC', email: 'yoshimikono@gmail.com', phone: '+1 (917) 951-1755', address: '121 East 27th street, 514. New York, NY 10016' },
    estimate: { labor: [], materials: [], markupPct: 25 },
    invoices: [
      { number: 'INV-260821-XQNQ-01', type: 'deposit', amount: 5000, status: 'paid', sentAt: '2026-08-21T10:00:00.000Z', memo: 'Deposit', paymentMethod: 'zelle', paymentDetails: 'Zelle: 332-277-0990' },
      { number: 'INV-260821-XQNQ-02', type: 'final', amount: 5000.01, status: 'sent', sentAt: '2026-08-27T10:00:00.000Z', workPerformed: 'Squeak elimination', paymentMethod: 'zelle', paymentDetails: 'Zelle: 332-277-0990' },
    ],
  };
}
const reset = () => { STORE = { 'SBC-260821-XQNQ': xqnq() }; sent = []; };
const call = (body) => handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) });
const rec = () => STORE['SBC-260821-XQNQ'];
const inv = (n) => (rec().invoices || []).find((i) => i.number === n);

(async function () {

console.log('\nresending the same invoice\n');
{
  reset();
  const before = rec().invoices.length;
  const r = await call({ ref: 'SBC-260821-XQNQ', resendNumber: 'INV-260821-XQNQ-02' });
  const body = JSON.parse(r.body);
  ok('it sends', r.statusCode === 200 && body.success === true, r.statusCode + ' ' + r.body.slice(0, 200));
  ok('THE SAME INVOICE NUMBER GOES OUT, not a new one', body.invoiceNumber === 'INV-260821-XQNQ-02', body.invoiceNumber);
  ok('NO THIRD INVOICE IS CREATED — this is the whole bug', rec().invoices.length === before, 'now ' + rec().invoices.length);
  ok('it reports itself as a resend', body.resent === true);
  ok('the resend is counted', inv('INV-260821-XQNQ-02').resendCount === 1);
  ok('...and dated', !!inv('INV-260821-XQNQ-02').resentAt);
  ok('the amount is unchanged', inv('INV-260821-XQNQ-02').amount === 5000.01);
  ok('an email actually went', sent.length === 1);
  ok('...carrying that invoice number', sent.join('').indexOf('INV-260821-XQNQ-02') !== -1);
  ok('...and the right amount', /5,000\.01/.test(sent.join('')), sent.join('').slice(0, 0) || 'amount not found');
}
{
  reset();
  await call({ ref: 'SBC-260821-XQNQ', resendNumber: 'INV-260821-XQNQ-02' });
  await call({ ref: 'SBC-260821-XQNQ', resendNumber: 'INV-260821-XQNQ-02' });
  ok('resending twice still creates no new invoice', rec().invoices.length === 2);
  ok('...and the count climbs', inv('INV-260821-XQNQ-02').resendCount === 2);
}

/* ══ THE ONE THAT WOULD HURT MOST ═════════════════════════════════════════ */
{
  reset();
  await call({ ref: 'SBC-260821-XQNQ', resendNumber: 'INV-260821-XQNQ-01' });
  ok('A PAID INVOICE STAYS PAID when a copy is emailed',
    inv('INV-260821-XQNQ-01').status === 'paid', inv('INV-260821-XQNQ-01').status);
  ok('...and the deposit amount is untouched', inv('INV-260821-XQNQ-01').amount === 5000);
}
{
  reset();
  STORE['SBC-260821-XQNQ'].status = 'paid';
  await call({ ref: 'SBC-260821-XQNQ', resendNumber: 'INV-260821-XQNQ-02' });
  ok('a job already marked paid is not dragged back to "invoiced" by a resend',
    rec().status === 'paid', rec().status);
}
{
  reset();
  STORE['SBC-260821-XQNQ'].status = 'completed';
  await call({ ref: 'SBC-260821-XQNQ', resendNumber: 'INV-260821-XQNQ-02' });
  ok('...nor is a completed job', rec().status === 'completed', rec().status);
}

console.log('\nwhat a resend refuses to do\n');
{
  reset();
  const r = await call({ ref: 'SBC-260821-XQNQ', resendNumber: 'INV-260821-XQNQ-99' });
  ok('an invoice that does not exist is refused, not invented', r.statusCode === 404, r.statusCode + ' ' + r.body);
  ok('...and nothing was sent', sent.length === 0);
  ok('...and nothing was written', rec().invoices.length === 2);
}
{
  reset();
  /* A resend must not be a back door for changing the amount. */
  await call({ ref: 'SBC-260821-XQNQ', resendNumber: 'INV-260821-XQNQ-02', amount: 999999, memo: 'hacked' });
  ok('AN AMOUNT SENT ALONGSIDE A RESEND IS IGNORED — the stored invoice is the invoice',
    inv('INV-260821-XQNQ-02').amount === 5000.01, String(inv('INV-260821-XQNQ-02').amount));
  ok('...and the email does not carry the substituted figure', sent.join('').indexOf('999,999') === -1);
}

console.log('\nsending a NEW invoice still works exactly as before\n');
{
  reset();
  const r = await call({ ref: 'SBC-260821-XQNQ', invoiceType: 'custom', amount: 250, memo: 'Extra work' });
  const body = JSON.parse(r.body);
  ok('a new invoice is still numbered one-up', body.invoiceNumber === 'INV-260821-XQNQ-03', body.invoiceNumber);
  ok('...and appended', rec().invoices.length === 3);
  ok('...and is not flagged as a resend', body.resent === false);
  ok('...and still moves the job to invoiced', rec().status === 'invoiced', rec().status);
}
{
  reset();
  const r = await call({ ref: 'SBC-260821-XQNQ', invoiceType: 'custom', amount: 0 });
  ok('a new invoice with no amount is still refused', r.statusCode === 400, r.statusCode + ' ' + r.body);
}
{
  reset();
  const r = await call({ invoiceType: 'custom', amount: 100 });
  ok('a missing ref is still refused', r.statusCode === 400);
}

/* ══ THE BUTTON ═══════════════════════════════════════════════════════════ */
console.log('\nthe button exists and asks first\n');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
ok('every invoice row has a Resend button', /onclick="resendInvoice\(/.test(HTML) && /Resend<\/button>/.test(HTML));
ok('it confirms before emailing a customer', /resendInvoice[\s\S]{0,700}confirm\(/.test(HTML));
ok('...naming the amount, so the wrong invoice is not sent by accident',
  /the same invoice, not a new one/.test(HTML));
ok('...and warning when that invoice is already paid', /already marked PAID/.test(HTML));
ok('the client sends only the ref and the number — never a price',
  /JSON\.stringify\(\{ ref: currentRecord\.ref, resendNumber: invoiceNumber \}\)/.test(HTML));
ok('how many times it has been resent is shown on the row', /Resent ' \+ Number\(inv\.resendCount\)/.test(HTML));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
})();
