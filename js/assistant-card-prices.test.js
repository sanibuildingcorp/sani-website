/* assistant-card-prices.test.js — run: node js/assistant-card-prices.test.js
 *
 *   "The Bathroom card shows $46,836.43 but 'customer total' is
 *    $26,836.43. That's a $20k gap - looks like the total was hand-edited.
 *    This needs fixing before you send."
 *   "look at him it's still reading old information!!!"
 *
 * There was no gap. The assistant read serviceBreakdown[].subtotal, a
 * number the dashboard writes at publish time and never reads back. The
 * customer's page scales every card to the headline total; on a one-card
 * job the card IS the total. lib/customer-cards.js is that arithmetic on
 * the server, and the assistant now quotes the price the customer reads.
 */
const fs = require('fs'), path = require('path'), Module = require('module');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const clone = (o) => JSON.parse(JSON.stringify(o));
const STORES = {};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return request; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (o) => { const m = STORES[o.name] || (STORES[o.name] = new Map()); return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } }; } } };
const https = require('https');
let sent = null;
const sse = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
https.request = function (opts, cb) {
  const res = { statusCode: 200, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  return { on() { return this; }, write(b) { sent = JSON.parse(b); }, destroy() {}, end() { setImmediate(() => { cb(res); res._data(Buffer.from(sse({ type: 'message_start' }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Looked.' } }) + sse({ type: 'message_stop' }))); if (res._end) res._end(); }); } };
};
process.env.DASHBOARD_KEY = 'k'; process.env.ANTHROPIC_API_KEY = 'sk';
const CC = require(path.join(ROOT, 'netlify/functions/lib/customer-cards.js'));
const bg = require(path.join(ROOT, 'netlify/functions/assistant-background.js'));

/* Frank's job: one Bathroom card, lines worth $46,836.43 with markup, the
   total set by hand to $26,836.43. */
const FRANK = {
  ref: 'SBC-260813-WPPF', status: 'sent', updatedAt: '2026-09-21T15:00:00Z', customerFinalTotal: 26836.43,
  customer: { name: 'Frank' }, request: { service: 'Bathroom', description: 'Full gut bathroom.' },
  history: [{ at: '2026-09-21T14:00:00Z', kind: 'customer', text: 'Edited: total $46,836.43 -> $26,836.43' }],
  estimate: {
    projectTitle: 'Full Gut Bathroom Renovation', markupPct: 25, showLaborCost: true, showMaterialsCost: true,
    labor: [{ section: 'Bathroom', item: 'Demolition', qty: 40, unit: 'hrs', rate: 300 }, { section: 'Bathroom', item: 'Tile', qty: 100, unit: 'hrs', rate: 200 }],
    materials: [{ section: 'Bathroom', item: 'Tile and setting materials', qty: 1, unit: 'lot', rate: 5469.144 }],
    serviceBreakdown: [{ title: 'Bathroom', subtotal: 46836.43, included: ['Full gut', 'New tile'], customerSupplies: ['Vanity'], notIncluded: ['Painting'] }],
    customerScopePublished: true,
    publishedCustomerScope: { services: [{ name: 'Bathroom', subtotal: 46836.43, included: ['Full gut', 'New tile'], supplied: ['Vanity'], excluded: ['Painting'] }] },
  },
};

(async () => {
  console.log('\n1. lib/customer-cards.js: the page\'s arithmetic on the server\n');
  {
    const c = CC.customerCards(FRANK);
    ok('FRANK\'S ONE CARD IS THE CUSTOMER TOTAL, $26,836.43 - not the stored $46,836.43', c.total === 26836.43 && c.cards.length === 1 && c.cards[0].title === 'Bathroom' && c.cards[0].subtotal === 26836.43 && c.published === true, JSON.stringify(c.cards));
    const two = clone(FRANK);
    two.estimate.publishedCustomerScope.services = [{ name: 'Bathroom', subtotal: 30000 }, { name: 'Painting', subtotal: 10000 }];
    const c2 = CC.customerCards(two);
    ok('two published cards are scaled proportionally to the hand-set total and add up exactly', c2.cards.map((x) => x.subtotal).join(',') === '20127.32,6709.11' && Math.round((20127.32 + 6709.11) * 100) === Math.round(26836.43 * 100), c2.cards.map((x) => x.subtotal).join(','));
    const unpub = clone(FRANK);
    unpub.estimate.customerScopePublished = false; unpub.customerFinalTotal = null;
    unpub.estimate.serviceBreakdown = [{ title: 'Bathroom', subtotal: 1 }, { title: 'Painting', subtotal: 1 }];
    unpub.estimate.labor.push({ section: 'Painting', item: 'Paint', qty: 10, unit: 'hrs', rate: 100 });
    unpub.estimate.labor.push({ section: 'General', item: 'Protection and cleanup', qty: 4, unit: 'hrs', rate: 100 });
    const c3 = CC.customerCards(unpub);
    /* labor 12000+20000 + 1000 painting + 400 loose; materials 5469.144; k 1.25
       Bathroom own 37469.144, Painting own 1000; loose 400 spread by labor weight 32000:1000 */
    ok('NOT PUBLISHED: cards are priced from the lines like the dashboard - own lines by section, loose lines spread by labor weight, markup on top - and sum to the total', c3.published === false && c3.cards.length === 2 && c3.cards[0].subtotal === 47321.28 && c3.cards[1].subtotal === 1265.15 && Math.round((c3.cards[0].subtotal + c3.cards[1].subtotal) * 100) === Math.round(c3.total * 100), JSON.stringify(c3.cards.map((x) => [x.title, x.subtotal])) + ' total ' + c3.total);
    const zero = clone(unpub);
    zero.estimate.serviceBreakdown.push({ title: 'Doors', subtotal: 0, included: ['Adjust doors'] });
    const c4 = CC.customerCards(zero);
    ok('a card with no priced lines is folded into the largest one, as the page does, and its wording travels', c4.cards[2].folded === 'Bathroom' && c4.cards[0].included.indexOf('Adjust doors') !== -1 && c4.cards.filter((x) => !x.folded).length === 2);
    const laborOnly = clone(FRANK);
    laborOnly.customerFinalTotal = null; laborOnly.estimate.showMaterialsCost = false;
    const c5 = CC.customerCards(laborOnly);
    ok('labor-only quote, no hand-set total: the card is the labor total with markup, $40,000.00', c5.total === 40000 && c5.cards[0].subtotal === 40000, c5.cards[0].subtotal + '');
  }

  console.log('\n2. The assistant quotes the price the customer reads\n');
  {
    STORES.estimates = new Map(); STORES.estimates.set(FRANK.ref, JSON.stringify(FRANK));
    sent = null;
    await bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'A-cards001', ref: FRANK.ref, chat: FRANK.ref, messages: [{ role: 'user', text: 'Review now again' }] }) });
    const sys = sent.system;
    const block = sys.slice(sys.indexOf('SERVICE CARDS THE CUSTOMER SEES'));
    ok('THE CARD IS $26,836.43 IN THE BLOCK, marked as the price her page shows, scaled to the total he set', /SERVICE CARDS THE CUSTOMER SEES \(prices exactly as her page shows them: the cards always add up to the customer total, which he set by hand, so every card is scaled to it - this is by construction, never a mismatch to report\):\n  Bathroom - \$26,836\.43\n    included: Full gut; New tile/.test(block), block.slice(0, 300));
    ok('...and $46,836.43 appears nowhere in the estimate block - only in the history line, which is true', sys.slice(sys.indexOf('THE GENERATED ESTIMATE')).indexOf('46,836.43') === -1 && /Edited: total \$46,836\.43 -> \$26,836\.43/.test(sys));
    const last = sent.messages[sent.messages.length - 1];
    const text = typeof last.content === 'string' ? last.content : last.content.map((c) => c.text || '').join('');
    ok('THE GLANCE ON HIS MESSAGE SAYS THE SAME: 1 card as the customer sees them: Bathroom $26,836.43', /customer total \$26,836\.43; 1 card as the customer sees them: Bathroom \$26,836\.43;/.test(text), text.slice(-300));
    ok('IT IS TOLD a hand-set total scales every card and that is never a mismatch, never a gap, never something to fix', /a total he set by hand scales every card with it - that is never a mismatch, never 'a gap', never something to fix/.test(sys));
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
