/* assistant-contract.test.js — run: node js/assistant-contract.test.js
 *
 *   "can you read contract too?"
 *   "I can't open or read the contract PDF itself from here."
 *
 * It was on the record all along. The contract the customer signs -
 * scope lines, materials, timeline, payment schedule, clauses, total,
 * signed or not - is now printed for the assistant, with a note when the
 * estimate has moved away from it; and its words can be fixed with the
 * same reword, never its amounts, never once it is signed.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const clone = (o) => JSON.parse(JSON.stringify(o));
function ext(name) {
  const s = DASH.search(new RegExp('(?:async )?function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = DASH.indexOf('{', s); j < DASH.length; j++) { if (DASH[j] === '{') d++; else if (DASH[j] === '}') { d--; if (!d) return DASH.slice(s, j + 1); } }
  throw new Error('unbalanced ' + name);
}
const STORES = { estimates: new Map() };
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return request; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (o) => { const m = STORES[o.name] || (STORES[o.name] = new Map()); return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); }, setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); } }; } } };
const https = require('https');
let sent = null;
const sse = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
https.request = function (opts, cb) {
  const res = { statusCode: 200, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  return { on() { return this; }, write(b) { sent = JSON.parse(b); }, destroy() {}, end() { setImmediate(() => { cb(res); res._data(Buffer.from(sse({ type: 'message_start' }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Read it.' } }) + sse({ type: 'message_stop' }))); if (res._end) res._end(); }); } };
};
process.env.DASHBOARD_KEY = 'k'; process.env.ANTHROPIC_API_KEY = 'sk';
const R = require(path.join(ROOT, 'netlify/functions/lib/reword.js'));
const fn = require(path.join(ROOT, 'netlify/functions/reword-estimate.js'));
const bg = require(path.join(ROOT, 'netlify/functions/assistant-background.js'));

function record() {
  return {
    ref: 'SBC-260813-WPPF', status: 'sent', customerFinalTotal: 26836.43, customer: { name: 'Frank Gaynor' },
    request: { service: 'Bathroom', description: 'Full gut.' },
    estimate: { projectTitle: 'Full Gut Bathroom', markupPct: 25, labor: [{ section: 'Bathroom', item: 'Demo', qty: 10, unit: 'hrs', rate: 100 }], materials: [], serviceBreakdown: [{ title: 'Bathroom', included: ['Demo'], customerSupplies: [], notIncluded: [], subtotal: 1250 }] },
    contract: {
      total: 26836.43, generatedAt: '2026-09-21T19:01:00Z',
      sections: {
        projectType: 'Manhattan Co-op Bathroom Renovation — Tub-to-Walk-In-Shower Conversion (140 W 69th St, Unit 62B)',
        scopeOfWork: ['Installation of all wall and floor tile including shower walls, niche, bathroom floor', 'Coordination and installation of frameless or semi-frameless glass shower enclosure following field measurement after tile completion', 'Final painting of ceiling and any non-tiled wall surfaces, thorough final cleaning'],
        materialsList: ['Protection materials: Ram Board/masonite floor protection, polyethylene sheeting', 'Plumbing rough materials: copper or PEX supply lines, fittings'],
        timeline: 'Co-op approval track requires 1-2 weeks from signed contract for preparation and submission of alteration package',
        paymentSchedule: [{ label: 'Deposit — due upon signing', amount: 10734.58 }, { label: 'Mid-project payment', amount: 10734.58 }, { label: 'Final payment', amount: 5367.27 }],
        clauses: { hiddenConditions: 'This contract is based upon visible conditions at 140 W 69th St Unit 62B as of the estimate date.', changeOrder: 'Any modification must be documented in a written change order signed by both parties.', warranty: 'One year on workmanship.', cancellation: 'Cancellation within 3 days is free.', permitsAndInsurance: 'Sani Building Corp is fully insured.' },
      },
    },
  };
}

(async () => {
  console.log('\n1. The assistant reads the contract\n');
  {
    STORES.estimates.set('SBC-260813-WPPF', JSON.stringify(record()));
    sent = null;
    await bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'A-ct001', ref: 'SBC-260813-WPPF', chat: 'SBC-260813-WPPF', messages: [{ role: 'user', text: 'can you read contract too?' }] }) });
    const sys = sent.system;
    const block = sys.slice(sys.indexOf('THE CONTRACT ('));
    ok('THE CONTRACT IS IN THE PROMPT: total, not signed, project type, every scope and materials line, the timeline', /THE CONTRACT \(the customer signs this to approve/.test(block) && /Contract total: \$26,836\.43 - not signed yet \(last edited 2026-09-21\)/.test(block) && /Project type: Manhattan Co-op Bathroom Renovation/.test(block) && /Contract scope of work \(3\):\n  - Installation of all wall and floor tile[^\n]*\n  - Coordination and installation of frameless[^\n]*\n  - Final painting of ceiling/.test(block) && /Contract materials & finishes \(2\):/.test(block) && /Contract timeline: Co-op approval track requires 1-2 weeks/.test(block), block.slice(0, 600));
    ok('...the payment schedule with its rows and that it equals the total, and every clause', /Payment schedule \(3 rows, \$26,836\.43 = the contract total\):\n  - Deposit — due upon signing: \$10,734\.58\n  - Mid-project payment: \$10,734\.58\n  - Final payment: \$5,367\.27/.test(block) && /Hidden & concealed conditions clause: This contract is based upon visible conditions/.test(block) && /Warranty clause: One year on workmanship\./.test(block) && /Permits & insurance clause: Sani Building Corp is fully insured\./.test(block), block.slice(600, 1400));
    ok('...and no drift line when the estimate total is the contract total', !/MOVED AWAY FROM THE CONTRACT/.test(block));
    ok('IT IS TOLD: read it like the estimate, never say you cannot open it; compare and fix the wording with contract wheres; amounts are not yours; a signed contract is never changed', /THE CONTRACT is in the job below when one exists/.test(sys) && /never say you cannot open it/.test(sys) && /contractscope, contractmaterials, contracttimeline, contracttype, contractclause/.test(sys) && /a signed contract is never changed - say that and stop/.test(sys));

    const moved = record(); moved.customerFinalTotal = 30000; STORES.estimates.set('SBC-260813-WPPF', JSON.stringify(moved));
    sent = null;
    await bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'A-ct002', ref: 'SBC-260813-WPPF', chat: 'SBC-260813-WPPF', messages: [{ role: 'user', text: 'does the contract match?' }] }) });
    ok('THE ESTIMATE MOVED AWAY FROM THE CONTRACT: the block says so with both totals and what to press', /THE ESTIMATE HAS MOVED AWAY FROM THE CONTRACT: estimate total \$30,000\.00, contract total \$26,836\.43 - he can press Update contract total/.test(sent.system), (sent.system.match(/MOVED AWAY[^\n]*/) || [''])[0]);
    const signed = record(); signed.contract.signed = { name: 'Frank Gaynor', at: '2026-09-20T12:00:00Z' }; STORES.estimates.set('SBC-260813-WPPF', JSON.stringify(signed));
    sent = null;
    await bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'A-ct003', ref: 'SBC-260813-WPPF', chat: 'SBC-260813-WPPF', messages: [{ role: 'user', text: 'contract?' }] }) });
    ok('a signed contract is marked signed, by whom and when', /Contract total: \$26,836\.43 - SIGNED by Frank Gaynor on 2026-09-20; a signed contract is never changed/.test(sent.system));
  }

  console.log('\n2. The contract\'s words can be fixed; its money and a signed contract cannot\n');
  {
    const rec = record();
    const before = R.moneyFingerprint(rec);
    const out = R.applyEdits(rec, [
      { where: 'contract scope', from: 'Coordination and installation of frameless or semi-frameless glass shower enclosure following field measurement after tile completion', to: 'Supply and installation of a 28" frameless glass shower door beside a 26" half wall, field-measured after the tile is set' },
      { where: 'contractscope', from: '', to: 'Supply and install a backlit LED framed mirror and a separate recessed medicine cabinet' },
      { where: 'contract materials', from: 'Plumbing rough materials: copper or PEX supply lines, fittings', to: 'Plumbing rough materials: PEX supply lines, fittings, pressure-balance shower valve body' },
      { where: 'contract timeline', from: '1-2 weeks', to: '2-3 weeks' },
      { where: 'contract type', from: 'Tub-to-Walk-In-Shower', to: 'Tub-to-Walk-In Shower' },
      { where: 'contract clause', service: 'warranty', from: 'One year', to: 'Two years' },
      { where: 'contractclause', service: 'permits and insurance', from: '', to: 'Sani Building Corp is fully insured and files all permits.' },
    ]);
    const s = rec.contract.sections;
    ok('A CONTRACT SCOPE LINE IS REPLACED, one added, a materials line replaced', s.scopeOfWork[1] === 'Supply and installation of a 28" frameless glass shower door beside a 26" half wall, field-measured after the tile is set' && s.scopeOfWork.length === 4 && s.scopeOfWork[3] === 'Supply and install a backlit LED framed mirror and a separate recessed medicine cabinet' && /pressure-balance shower valve body$/.test(s.materialsList[1]), JSON.stringify(out));
    ok('the timeline phrase, the project type and two clauses (by name) are changed', /2-3 weeks/.test(s.timeline) && /Tub-to-Walk-In Shower Conversion/.test(s.projectType) && s.clauses.warranty === 'Two years on workmanship.' && s.clauses.permitsAndInsurance === 'Sani Building Corp is fully insured and files all permits.', JSON.stringify(s.clauses));
    ok('seven applied, none skipped; THE MONEY FINGERPRINT - contract total and payment rows included - did not move', out.applied.length === 7 && out.skipped.length === 0 && R.moneyFingerprint(rec) === before && rec.contract.total === 26836.43 && rec.contract.sections.paymentSchedule[0].amount === 10734.58);
    ok('the fingerprint MOVES on a payment amount or the contract total', (() => { const a = record(); a.contract.sections.paymentSchedule[0].amount = 1; const b = record(); b.contract.total = 1; return R.moneyFingerprint(a) !== before && R.moneyFingerprint(b) !== before; })());
    let err = null;
    try { const sg = record(); sg.contract.signed = { name: 'Frank', at: '2026-09-20T12:00:00Z' }; R.applyEdits(sg, [{ where: 'contractscope', from: '', to: 'x' }]); } catch (e) { err = e; }
    ok('A SIGNED CONTRACT IS REFUSED WHOLE', !!err && /The contract is signed; a signed contract is never changed/.test(err.message), err && err.message);
    err = null;
    try { R.applyEdits(record(), [{ where: 'contractclause', service: 'the fine print', from: '', to: 'x' }]); } catch (e) { err = e; }
    ok('a clause not named is refused with the five names', !!err && /Which clause\? Name it in service: hidden conditions, change orders, warranty, cancellation, or permits and insurance/.test(err.message));
    err = null;
    try { const nc = record(); delete nc.contract; R.applyEdits(nc, [{ where: 'contractscope', from: '', to: 'x' }]); } catch (e) { err = e; }
    ok('no contract yet: says to generate it first', !!err && /There is no contract on this estimate yet/.test(err.message));
    ok('cleanWhere: "Contract Scope of Work", "contract_materials", "contract-timeline", "contract project type", "contract terms" all land', ['Contract Scope of Work', 'contract_materials', 'contract-timeline', 'contract project type', 'contract terms'].map((w) => R.cleanEdit({ where: w }).where).join(',') === 'contractscope,contractmaterials,contracttimeline,contracttype,contractclause');

    STORES.estimates.set('SBC-260813-WPPF', JSON.stringify(record()));
    const r = await fn.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ ref: 'SBC-260813-WPPF', edits: [{ where: 'contract timeline', from: '1-2 weeks', to: '2-3 weeks' }] }) });
    const body = JSON.parse(r.body);
    ok('over the function: applied, saved, and the contract comes back for the panel', r.statusCode === 200 && body.success === true && /2-3 weeks/.test(body.contract.sections.timeline) && /2-3 weeks/.test(JSON.parse(STORES.estimates.get('SBC-260813-WPPF')).contract.sections.timeline));
    const rs = await fn.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ ref: 'SBC-260813-WPPF', edits: [{ where: 'contract timeline', from: '2-3', to: '9' }, { where: 'included', service: 'Bathroom', from: 'Demo', to: 'Demolition' }] }) });
    STORES.estimates.set('SBC-260813-WPPF', JSON.stringify((() => { const x = record(); x.contract.signed = { name: 'F', at: '2026-09-20T12:00:00Z' }; return x; })()));
    const rsg = await fn.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ ref: 'SBC-260813-WPPF', edits: [{ where: 'contract timeline', from: '1-2', to: '9' }, { where: 'included', service: 'Bathroom', from: 'Demo', to: 'Demolition' }] }) });
    ok('a signed contract over the function: 422 with the reason, and the estimate edit in the same request is not saved either', rs.statusCode === 200 && rsg.statusCode === 422 && /never changed/.test(JSON.parse(rsg.body).error) && JSON.parse(STORES.estimates.get('SBC-260813-WPPF')).estimate.serviceBreakdown[0].included[0] === 'Demo');
  }

  console.log('\n3. The dashboard redraws the contract panel after a contract reword\n');
  {
    const calls = { panel: 0, rendered: 0 };
    const ctx = {
      String, JSON, Array, Object, Number, Error, RegExp, Math, Date, console, encodeURIComponent, Promise, setTimeout: (f) => f(),
      estimates: [{ ref: 'SBC-260813-WPPF', status: 'sent' }], currentRecord: { ref: 'SBC-260813-WPPF', estimate: {}, contract: { total: 1, sections: { timeline: 'old' } } },
      visits: [], activeTab: 'all', renderTabs() {}, renderList() {}, openEdit() {}, closeEdit() {}, aiClose() {}, aiStartSearch() {}, AI_LOG: [], aiRender() {}, aiSave() {}, aiTurn: (m) => m, aiScreen: () => null, aiAsk: async () => ({ reply: '', actions: [] }),
      renderEdit() { calls.rendered++; }, toast() {}, confirm: () => true, document: { getElementById: () => null },
      sbcFetch: async () => ({ ok: true, json: async () => ({ success: true, applied: [{ changed: 1 }], skipped: [], estimate: { labor: [] }, contract: { total: 1, sections: { timeline: 'new' } } }) }),
    };
    ctx.window = { renderContractPanel() { calls.panel++; } };
    vm.createContext(ctx);
    ['aiExec', 'aiResendSkipped', 'aiRunActions'].forEach((n) => vm.runInContext(ext(n), ctx));
    await vm.runInContext('aiExec({ type: "reword", ref: "SBC-260813-WPPF", edits: [{ where: "contract timeline", from: "old", to: "new" }] })', ctx);
    ok('THE RETURNED CONTRACT GOES ONTO THE OPEN RECORD and the contract panel is redrawn', ctx.currentRecord.contract.sections.timeline === 'new' && calls.panel === 1 && calls.rendered === 1);
    await vm.runInContext('aiExec({ type: "reword", ref: "SBC-260813-WPPF", edits: [{ where: "summary", from: "", to: "x" }] })', ctx);
    ok('an estimate-only reword leaves the contract panel alone', calls.panel === 1);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
