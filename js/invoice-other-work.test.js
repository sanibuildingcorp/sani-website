/* invoice-other-work.test.js - run: node js/invoice-other-work.test.js
 * "how can i send invoice for customers ... job without created scope of work?"
 * An invoice billed by lines: total = sum of lines (server side), stored as
 * separate other work, the email shows each line's price; a resend repeats it. */
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
process.env.DASHBOARD_KEY = 'dash-test-key';

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
const call = (body) => handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'dash-test-key' }, body: JSON.stringify(body) });
const rec = () => STORE['SBC-260821-XQNQ'];
const inv = (n) => (rec().invoices || []).find((i) => i.number === n);

(async function () {
  reset();
  const r = await call({ ref: 'SBC-260821-XQNQ', invoiceType: 'full', separate: true, title: 'Kitchen faucet replacement', amount: 1,
    items: [{ text: 'Replace kitchen faucet', amount: 350 }, { text: 'Patch and paint ceiling', amount: 600.5 }, { text: '', amount: 99 }, { text: 'free', amount: 0 }],
    customerEmail: 'yoshimikono@gmail.com', customerName: 'Kono Designs LLC', paymentMethod: 'zelle', paymentDetails: 'Zelle: x' });
  const b = JSON.parse(r.body);
  ok('it sends', r.statusCode === 200 && b.success === true, r.body.slice(0, 200));
  const n = rec().invoices[rec().invoices.length - 1];
  ok('total is the sum of the lines, not the amount the form sent', n.amount === 950.5, n.amount);
  ok('empty / zero lines are dropped', n.items.length === 2, JSON.stringify(n.items));
  ok('stored as separate other work with its title', n.separate === true && n.title === 'Kitchen faucet replacement');
  const mail = sent.filter((x) => /Replace kitchen faucet/.test(x)).pop() || '';
  ok('the email lists each line with its price and the total', /Replace kitchen faucet/.test(mail) && /350\.00/.test(mail) && /950\.50/.test(mail), mail.slice(0, 120));
  ok('the email uses the invoice title as the project', /Kitchen faucet replacement/.test(mail));
  sent = [];
  const r2 = await call({ ref: 'SBC-260821-XQNQ', resendNumber: n.number });
  const again = inv(n.number);
  ok('a resend keeps the lines, total and separate flag', r2.statusCode === 200 && again.amount === 950.5 && again.items.length === 2 && again.separate === true);
  console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
})();
