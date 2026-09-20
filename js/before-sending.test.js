/* before-sending.test.js — run: node js/before-sending.test.js
 *
 *   "if i did generate estimate first only for my self in my dashboard and
 *    then i have questions to the customer it's shows with price and scope of
 *    work which i don't want share with them until i finish estimate"
 *
 * A record he priced for himself and never sent has no frozen version, so
 * the portal served the live draft - lines, prices, scope - and the message
 * email printed the draft total in gold. Now a never-sent record shows the
 * customer only their own side: the conversation, the photos, the details.
 *
 * THE ONE THING THAT WOULD HURT MORE: hiding a quote that WAS sent. Records
 * from before frozen versions existed have no sentVersion but were sent
 * (sentAt, or a status past "drafted"). Those must stay whole, or every old
 * quote link goes blank at once.
 */
const path = require('path'), Module = require('module');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

const STORE = new Map();
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return '@netlify/blobs'; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: () => ({ get: async (k) => (STORE.has(k) ? JSON.parse(STORE.get(k)) : null) }) } };
const get = require(path.join(ROOT, 'netlify/functions/get-estimate.js'));
const build = require(path.join(ROOT, 'netlify/functions/lib/message-email.js'));

const DRAFT = {
  ref: 'SBC-DRAFT', status: 'drafted',
  customer: { name: 'Jan', email: 'jan@example.com', address: 'Upper East Side' },
  request: { service: 'Carpentry', description: 'molding', photos: [{ data: 'https://x/1.jpg', slot: 'wide' }] },
  estimate: { projectTitle: 'Upper East Side Apartment — Molding', markupPct: 25, labor: [{ item: 'Install molding', qty: 220, unit: 'ft', rate: 6.5 }], materials: [{ item: 'nails', qty: 1, unit: 'box', rate: 16.99 }],
    scopeOfWork: 'SECRET DRAFT SCOPE', serviceBreakdown: [{ title: 'Carpentry', subtotal: 9181.16, included: ['x'] }], options: [{ label: 'Option A', price: 1250 }] },
  customerFinalTotal: 9181.16, contract: { text: 'draft contract' }, includeContractForCustomer: true,
  thread: [{ id: 'm1', from: 'contractor', text: 'How many closets?', at: '2026-09-19T00:00:00Z' }],
  customerSelections: [{ group: 'Paint', option: 'Satin', upgrade: 120 }],
};
const SENT_FROZEN = Object.assign(JSON.parse(JSON.stringify(DRAFT)), { ref: 'SBC-SENT', status: 'sent', sentAt: '2026-09-18T00:00:00Z',
  sentVersion: { snapshotVersion: 1, n: 1, at: '2026-09-18T00:00:00Z', estimate: { projectTitle: 'Sent title', labor: [{ item: 'Install molding', qty: 200, unit: 'ft', rate: 6 }], materials: [], scopeOfWork: 'SENT SCOPE' }, customerFinalTotal: null } });
const OLD_SENT = Object.assign(JSON.parse(JSON.stringify(DRAFT)), { ref: 'SBC-OLD', status: 'accepted', sentAt: '2026-06-01T00:00:00Z' });
const OLD_SENT_NO_DATE = Object.assign(JSON.parse(JSON.stringify(DRAFT)), { ref: 'SBC-OLD2', status: 'sent' });
/* sentAt set but the status never moved past drafted - only the date says it went out */
const OLD_SENT_DATE_ONLY = Object.assign(JSON.parse(JSON.stringify(DRAFT)), { ref: 'SBC-OLD3', status: 'drafted', sentAt: '2026-06-01T00:00:00Z' });
[DRAFT, SENT_FROZEN, OLD_SENT, OLD_SENT_NO_DATE, OLD_SENT_DATE_ONLY].forEach(r => STORE.set(r.ref, JSON.stringify(r)));

const asCustomer = async (ref) => JSON.parse((await get.handler({ httpMethod: 'GET', headers: { referer: 'https://www.sanibuildingcorp.com/quote.html?ref=' + ref }, queryStringParameters: { ref } })).body);
const asDashboard = async (ref) => JSON.parse((await get.handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { ref } })).body);

(async function () {
  console.log('\nthe portal shows nothing he has not sent\n');
  {
    const v = await asCustomer('SBC-DRAFT');
    const s = JSON.stringify(v);
    ok('A NEVER-SENT RECORD CARRIES NO PRICE LINES, NO SCOPE, NO OPTIONS, NO CONTRACT', !v.estimate.labor && !v.estimate.materials && !v.estimate.scopeOfWork && !v.estimate.serviceBreakdown && !v.estimate.options && v.customerFinalTotal === undefined && v.contract === undefined, s.slice(0, 300));
    ok('...not even by another name', s.indexOf('SECRET DRAFT SCOPE') === -1 && s.indexOf('9181') === -1 && s.indexOf('draft contract') === -1 && s.indexOf('Option A') === -1);
    ok('...and says so, so the page can', v.estimatePending === true && v.estimate.notSentYet === true);
    ok('the project title stays - the page needs a heading', v.estimate.projectTitle === 'Upper East Side Apartment — Molding');
    ok('THE CUSTOMER\'S OWN SIDE STAYS: conversation, photos, details, their choices', v.thread.length === 1 && v.thread[0].text === 'How many closets?' && v.request.photos.length === 1 && v.customer.name === 'Jan' && v.customerSelections.length === 1);
  }
  {
    const v = await asCustomer('SBC-SENT');
    ok('A SENT RECORD SHOWS THE FROZEN VERSION, as before', v.estimate.scopeOfWork === 'SENT SCOPE' && v.estimate.labor.length === 1 && v.estimate.labor[0].qty === 200 && v.estimatePending === undefined);
  }
  {
    const v = await asCustomer('SBC-OLD');
    ok('AN OLD RECORD SENT BEFORE FROZEN VERSIONS EXISTED (sentAt set) STAYS WHOLE', v.estimate.labor.length === 1 && v.estimate.scopeOfWork === 'SECRET DRAFT SCOPE' && v.customerFinalTotal === 9181.16, JSON.stringify(v.estimate).slice(0, 120));
    const v2 = await asCustomer('SBC-OLD2');
    ok('...and one with only a "sent" status and no date, too', v2.estimate.labor.length === 1 && v2.estimatePending === undefined);
    const v3 = await asCustomer('SBC-OLD3');
    ok('...and one where only sentAt says it went out (status still "drafted")', v3.estimate.labor.length === 1 && v3.estimatePending === undefined, JSON.stringify(v3.estimate).slice(0, 100));
  }
  {
    const d = await asDashboard('SBC-DRAFT');
    ok('THE DASHBOARD STILL GETS EVERYTHING', d.estimate.scopeOfWork === 'SECRET DRAFT SCOPE' && d.estimate.labor.length === 1 && d.customerFinalTotal === 9181.16);
  }
  {
    const r = await get.handler({ httpMethod: 'GET', headers: { referer: 'https://www.sanibuildingcorp.com/quote.html?ref=SBC-DRAFT&previewScope=1' }, queryStringParameters: { ref: 'SBC-DRAFT' } });
    const p = JSON.parse(r.body);
    ok('his own draft preview (?previewScope=1) still shows the draft', p.estimate.labor && p.estimate.labor.length === 1 && p.estimatePending === undefined);
  }

  console.log('\nthe message email: no draft price, a subject in words, a card that pulls\n');
  const MSG = { from: 'contractor', text: 'How many closets are there?', at: '2026-09-19T20:01:00Z' };
  {
    const m = build({ ref: 'SBC-DRAFT', record: DRAFT, message: MSG, audience: 'customer', siteUrl: 'https://www.sanibuildingcorp.com' });
    ok('A MESSAGE ABOUT A NEVER-SENT ESTIMATE SHOWS NO PRICE TO THE CUSTOMER', m.html.indexOf('9,181') === -1 && m.html.indexOf('$') === -1 && m.total === 0, (m.html.match(/\$[\d,]+\.\d\d/) || [''])[0]);
    ok('THE SUBJECT IS THE PROJECT IN WORDS - no "Re:", no code first', m.subject === 'About your project: Upper East Side Apartment — Molding', m.subject);
    ok('the header card still names the estimate, which a Gmail reply quotes back', /Estimate SBC-DRAFT/.test(m.html));
    ok('THE REPLY CARD IS GOLD, BOLD AND SAYS WHERE THE REPLY GOES', /border:2px solid #c8860a/.test(m.html) && /Tap here to type your reply/.test(m.html) && /Your reply goes straight to Zurabi/.test(m.html));
    ok('...and it comes before the button', m.html.indexOf('Tap here to type your reply') < m.html.indexOf('Open my project'));
    const c = build({ ref: 'SBC-DRAFT', record: DRAFT, message: MSG, audience: 'contractor', siteUrl: 'https://www.sanibuildingcorp.com' });
    ok('his own copy still shows the live draft total and keeps the ref first in the subject', /\$9,181\.16/.test(c.html) && c.subject.indexOf('SBC-DRAFT') === 0, c.subject);
  }
  {
    const m = build({ ref: 'SBC-SENT', record: SENT_FROZEN, message: MSG, audience: 'customer', siteUrl: 'https://www.sanibuildingcorp.com' });
    /* the frozen version: 200 ft x $6 = $1,200, markup none in the snapshot */
    ok('A SENT ESTIMATE SHOWS THE SENT PRICE, not the draft being edited', /\$1,200\.00/.test(m.html) && m.html.indexOf('9,181') === -1, (m.html.match(/\$[\d,]+\.\d\d/) || [''])[0]);
    const o = build({ ref: 'SBC-OLD', record: OLD_SENT, message: MSG, audience: 'customer', siteUrl: 'https://www.sanibuildingcorp.com' });
    ok('an old sent record (no frozen version) shows its price as before', /\$9,181\.16/.test(o.html));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e));
  process.exit(1);
});
