/* waiting-for-customer.test.js — run: node js/waiting-for-customer.test.js
 *
 *   "In the request when i sent questions to the customer can we add mark
 *    as waiting answer or something like this mark?"
 *   AI: "I can't do that - 'waiting' isn't a status this dashboard has."
 *
 * The mirror of REPLY NEEDED. He spoke last, or he marked it (or the
 * assistant did), and the customer has not written back: the card says
 * WAITING FOR CUSTOMER. It clears itself when the customer answers. Not a
 * status: a mark, on the record, set by mark-waiting (contractor only),
 * by the conversation button, or by the assistant's "waiting" action.
 */
const fs = require('fs'), path = require('path'), Module = require('module');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const STORES = {};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return request; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (o) => { const m = STORES[o.name] || (STORES[o.name] = new Map()); return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); }, setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); }, list: async () => ({ blobs: Array.from(m.keys()).map((key) => ({ key })) }) }; } } };
process.env.DASHBOARD_KEY = 'k';
const T = require(path.join(ROOT, 'netlify/functions/lib/thread.js'));
const mark = require(path.join(ROOT, 'netlify/functions/mark-waiting.js'));
const list = require(path.join(ROOT, 'netlify/functions/list-estimates.js'));
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const ASSIST = fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant.js'), 'utf8');

const him = (at, text) => ({ id: 'c-' + at, from: 'contractor', text: text || 'Is the floor concrete or wood?', at });
const them = (at, text) => ({ id: 'u-' + at, from: 'customer', text: text || 'Concrete.', at });
const rec = (o) => Object.assign({ ref: 'SBC-260914-48ZR', status: 'drafted', customer: { name: 'Arielle' }, request: { service: 'Bathroom' }, estimate: { labor: [], materials: [] }, thread: [] }, o || {});

console.log('\n1. The rule: waiting when he spoke last, over when they answer\n');
{
  ok('HE ASKED, NO ANSWER YET -> waiting', T.waitingOnCustomer(rec({ thread: [them('2026-09-20T10:00:00Z', 'hi'), him('2026-09-21T10:00:00Z')] })) === true);
  ok('they answered -> not waiting (that is REPLY NEEDED, the other badge)', T.waitingOnCustomer(rec({ thread: [him('2026-09-21T10:00:00Z'), them('2026-09-21T12:00:00Z')] })) === false && T.needsReply(rec({ thread: [him('2026-09-21T10:00:00Z'), them('2026-09-21T12:00:00Z')] })) === true);
  ok('no conversation at all -> not waiting', T.waitingOnCustomer(rec()) === false);
  ok('MARKED BY HAND with no message -> waiting', T.waitingOnCustomer(rec({ waitingOnCustomer: true, waitingSince: '2026-09-21T10:00:00Z' })) === true);
  ok('...and a customer message AFTER the mark ends it by itself', T.waitingOnCustomer(rec({ waitingOnCustomer: true, waitingSince: '2026-09-21T10:00:00Z', thread: [them('2026-09-21T11:00:00Z')] })) === false);
  ok('...a customer message from BEFORE the mark does not', T.waitingOnCustomer(rec({ waitingOnCustomer: true, waitingSince: '2026-09-21T10:00:00Z', thread: [them('2026-09-20T11:00:00Z')] })) === true);
  ok('CLEARED BY HAND after he spoke last -> not waiting, until he writes to them again', T.waitingOnCustomer(rec({ waitingOnCustomer: false, waitingCleared: '2026-09-21T11:00:00Z', thread: [him('2026-09-21T10:00:00Z')] })) === false && T.waitingOnCustomer(rec({ waitingOnCustomer: false, waitingCleared: '2026-09-21T11:00:00Z', thread: [him('2026-09-21T10:00:00Z'), him('2026-09-22T09:00:00Z')] })) === true);
  ok('a declined or completed job waits on nobody', T.waitingOnCustomer(rec({ status: 'declined', thread: [him('2026-09-21T10:00:00Z')] })) === false && T.waitingOnCustomer(rec({ status: 'completed', waitingOnCustomer: true })) === false);
}

console.log('\n2. mark-waiting: the mark, the history line, the clear\n');
(async () => {
  STORES.estimates = new Map();
  STORES.estimates.set('SBC-260914-48ZR', JSON.stringify(rec({ thread: [them('2026-09-20T10:00:00Z', 'can you quote?')] })));
  const post = (body, headers) => mark.handler({ httpMethod: 'POST', headers: headers === undefined ? { 'x-sbc-key': 'k' } : headers, body: JSON.stringify(body) });
  let r = await post({ ref: 'sbc-260914-48zr', waiting: true, by: 'assistant' });
  let saved = JSON.parse(STORES.estimates.get('SBC-260914-48ZR'));
  ok('MARK: 200, the record carries the mark and when, the answer says waiting', r.statusCode === 200 && JSON.parse(r.body).waitingOnCustomer === true && saved.waitingOnCustomer === true && /^\d{4}-/.test(saved.waitingSince), r.body);
  ok('...one history line, naming who marked it', saved.history.length === 1 && saved.history[0].kind === 'waiting' && saved.history[0].text === "Marked waiting for the customer's answer (assistant)", JSON.stringify(saved.history));
  r = await post({ ref: 'SBC-260914-48ZR', waiting: false });
  saved = JSON.parse(STORES.estimates.get('SBC-260914-48ZR'));
  ok('CLEAR: the mark is off, the answer says not waiting, a second history line', r.statusCode === 200 && JSON.parse(r.body).waitingOnCustomer === false && saved.waitingOnCustomer === false && saved.history[1].text === 'No longer waiting for the customer');
  r = await post({ ref: 'SBC-000000-NOPE' });
  ok('an unknown ref -> 404', r.statusCode === 404);
  r = await post({ ref: 'SBC-260914-48ZR' }, {});
  ok('no key -> 401', r.statusCode === 401);

  console.log('\n3. The list carries the verdict for every card\n');
  STORES.estimates.set('SBC-260901-ARWQ', JSON.stringify(rec({ ref: 'SBC-260901-ARWQ', thread: [him('2026-09-21T10:00:00Z')] })));
  const lr = await list.handler({ httpMethod: 'GET', headers: { 'x-sbc-key': 'k' } });
  const rows = JSON.parse(lr.body).estimates;
  const byRef = {}; rows.forEach((x) => { byRef[x.ref] = x; });
  ok('list-estimates: waitingOnCustomer true where he asked last, false where the mark was cleared', byRef['SBC-260901-ARWQ'].waitingOnCustomer === true && byRef['SBC-260914-48ZR'].waitingOnCustomer === false, JSON.stringify(rows.map((x) => [x.ref, x.waitingOnCustomer])));

  console.log('\n4. The dashboard: the badge, the button, the assistant action\n');
  ok('THE CARD shows ⏳ WAITING FOR CUSTOMER (never beside REPLY NEEDED), in its own colour', /\(!threadNeedsReply\(e\) && threadWaiting\(e\) \? '<span class="badge waiting-customer">⏳ WAITING FOR CUSTOMER<\/span>' : ''\)/.test(DASH) && /\.badge\.waiting-customer\{background:#6b5b95;color:#fff\}/.test(DASH));
  ok('threadWaiting: the list row takes the server verdict; an open record is judged from its thread and its mark, same rule as the server', /function threadWaiting\(r\)/.test(DASH) && /if \(typeof r\.waitingOnCustomer === "boolean" && !Array\.isArray\(r\.thread\)\) return r\.waitingOnCustomer;/.test(DASH) && /if \(!last \|\| last\.from !== "contractor"\) return false;\s*if \(r\.waitingOnCustomer === false && r\.waitingCleared\) return new Date\(last\.at\)\.getTime\(\) > new Date\(r\.waitingCleared\)\.getTime\(\);/.test(DASH));
  ok('THE CONVERSATION HEADER has the badge and a Mark waiting for customer / Clear waiting button that calls mark-waiting', /cnvWaitingHtml\(r\) \+ '<\/div>'/.test(DASH) && /Mark waiting for customer/.test(DASH) && /Clear waiting/.test(DASH) && /sbcFetch\("\/\.netlify\/functions\/mark-waiting"/.test(DASH));
  ok('THE ASSISTANT ACTION "waiting": confirm bubble, then mark-waiting, then the list repaints', /if \(t === "waiting"\) \{/.test(DASH) && /as waiting for the customer's answer\?" : "\?"\), won \? "Mark it" : "Clear it", "Leave it"\)/.test(DASH) && /await markWaiting\(wref, won\);/.test(DASH));
  ok('the screen the assistant reads says which jobs are waiting', /waiting: \(typeof threadWaiting === "function"\) \? !!threadWaiting\(e\) : false \};/.test(DASH) && /WAITING FOR THE CUSTOMER'S ANSWER/.test(ASSIST));
  ok('the assistant may send it and is told never to say there is no such status', /waiting: \["ref"\]/.test(ASSIST) && /MARK AN ESTIMATE AS WAITING FOR THE CUSTOMER'S ANSWER: ACTION: \{\\"type\\":\\"waiting\\",\\"ref\\":\\"SBC-\.\.\.\\"\}/.test(ASSIST) && /Never answer that there is no such status - this is how it is done\./.test(ASSIST));
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
