/* estimator-chat.test.js — run: node js/estimator-chat.test.js
 *
 *   "why i can't talk to the same AI which doing generates? ... i can give
 *    direction from the dashboard chat what to update, where to update, why
 *    to update ... where to add lines, where to change title or everything"
 *   "he can update everything line by line if need change only one separate
 *    line in already generated estimate and everywhere"
 *
 * 1. Inside an estimate the chat IS the estimator: the generator's model,
 *    his house rules, thinking, four minutes.
 * 2. It changes price lines (a "lines" action): one line, several, add,
 *    remove, move - shown with its money, applied only on Apply, the same
 *    way as a hand edit, then saved.
 * 3. Regenerate reads the chat as his instructions.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const STORES = {};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return request; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (o) => { const m = STORES[o.name] || (STORES[o.name] = new Map()); return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } }; } } };
const https = require('https');
let calls = [], replies = [];
const sse = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
https.request = function (opts, cb) {
  const res = { statusCode: 200, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  return { on() { return this; }, write(b) { calls.push(JSON.parse(b)); }, destroy() {}, end() { setImmediate(() => { const text = replies.length ? replies.shift() : 'ok'; cb(res); res._data(Buffer.from(sse({ type: 'message_start' }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text } }) + sse({ type: 'message_stop' }))); if (res._end) res._end(); }); } };
};
process.env.DASHBOARD_KEY = 'k'; process.env.ANTHROPIC_API_KEY = 'sk';
const fn = require(path.join(ROOT, 'netlify/functions/assistant.js'));
const bg = require(path.join(ROOT, 'netlify/functions/assistant-background.js'));
const SRC = fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant.js'), 'utf8');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const GEN = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'), 'utf8');

const REC = {
  ref: 'SBC-260925-Y373', status: 'drafted',
  customer: { name: 'Crismar Hibirmas', address: '409 Suydam St' },
  request: { service: 'Bathroom', description: '13 bathrooms, finish work.' },
  estimate: { projectTitle: '409 Suydam - 13 Bathrooms', markupPct: 25,
    labor: [{ section: 'Bathroom', item: 'Install cement backer board on bathroom floors (440 sf)', qty: 24, unit: 'hrs', rate: 54.4 },
      { section: 'Bathroom', item: 'Set customer-supplied toilets and sinks, install faucets and shower trim, 13 rooms', qty: 40, unit: 'hrs', rate: 76 }],
    materials: [{ section: 'Bathroom', item: 'Toilet setting kit - wax ring, closet bolts, flexible supply', qty: 13, unit: 'ea', rate: 22 }],
    serviceBreakdown: [{ title: 'Bathroom', included: ['Tile and waterproofing'], customerSupplies: [], notIncluded: [], subtotal: 10000 }] },
};
STORES.estimates = new Map(); STORES.estimates.set(REC.ref, JSON.stringify(REC)); STORES.estimates.set('house-rules', JSON.stringify({ rules: 'Tile setter $62.40/hr cost. Never price plumbing trim.' }));
const result = (job) => JSON.parse(STORES['assistant-jobs'].get(job));

(async () => {
  console.log('\n1. Inside an estimate, the chat is the estimator\n');
  {
    replies = ['Removing the plumbing trim.\nACTION: {"type":"lines","ref":"SBC-260925-Y373","ops":[{"op":"remove","line":"L2","item":"Set customer-supplied toilets and sinks, install faucets and shower trim, 13 rooms"},{"op":"remove","line":"M1","item":"Toilet setting kit"},{"op":"add","kind":"materials","section":"Bathroom","item":"Allowance - shower niches, 12 at $150","qty":"12","unit":"ea","rate":"$150"}]}'];
    calls = [];
    await bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'J-estimator-1', ref: REC.ref, chat: REC.ref, messages: [{ role: 'user', text: 'remove the plumbing trim and add a niche allowance 12 x 150' }] }) });
    const sent = calls[0] || {};
    ok('THE ESTIMATE\'S OWN CHAT RUNS ON THE GENERATOR\'S MODEL (ESTIMATOR_MODEL, as generate-estimate-background reads it)', sent.model === 'claude-opus-5' && /const ESTIMATOR_MODEL = process\.env\.ESTIMATOR_MODEL \|\| "claude-opus-5";/.test(SRC) && /const CLAUDE_MODEL = process\.env\.ESTIMATOR_MODEL \|\| "claude-opus-5";/.test(GEN), sent.model);
    ok('...it thinks (no thinking switch-off) and has 16,000 tokens', !('thinking' in sent) && sent.max_tokens === 16000);
    ok('...it is told it is the estimator of this job, and given his house rules', /YOU ARE THE ESTIMATOR OF THIS JOB - the same one that generated it/.test(sent.system) && /Tile setter \$62\.40\/hr cost\. Never price plumbing trim\./.test(sent.system));
    ok('...it sees every line with its id, L1.. and M1..', /L1 \| \[Bathroom\] \| Install cement backer board on bathroom floors \(440 sf\) \| 24 hrs \| @ \$54\.40 \| = \$1,305\.60/.test(sent.system) && /M1 \| \[Bathroom\] \| Toilet setting kit/.test(sent.system));
    ok('...and the margin is still never in its prompt (it drafts customer messages)', !/[Mm]arkup/.test(sent.system) && sent.system.indexOf('25%') === -1);
    const job = result('J-estimator-1');
    const act = (job.actions || [])[0] || {};
    ok('THE LINES ACTION COMES BACK with its operations cleaned: ids, kinds, numbers from "$150" and "12"', act.type === 'lines' && act.ops.length === 3 && act.ops[0].line === 'L2' && act.ops[1].kind === 'materials' && act.ops[2].qty === 12 && act.ops[2].rate === 150 && act.ops[2].kind === 'materials', JSON.stringify(act));
    ok('the four-minute clock for the estimator; the drawer keeps ninety seconds', /const ESTIMATOR_MS = 240000;/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant-background.js'), 'utf8')) && /const estimator = !!str\(body\.ref\) && str\(body\.chat\) === str\(body\.ref\);/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant-background.js'), 'utf8')));
    calls = []; replies = ['Maria is waiting.'];
    await bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'J-drawer-1', ref: REC.ref, chat: 'global', messages: [{ role: 'user', text: 'who is waiting?' }] }) });
    ok('THE DRAWER (chat "global") stays the fast helper, even with an estimate open', calls[0] && calls[0].model === 'claude-sonnet-5' && calls[0].thinking && calls[0].thinking.type === 'disabled' && !/YOU ARE THE ESTIMATOR/.test(calls[0].system));
    const bad = fn._cleanLineOps([{ op: 'delete', line: 'L1' }, { op: 'add', item: 'x' }, { op: 'change' }, { op: 'change', line: 'l 3', qty: '-4', rate: 'abc' }]);
    ok('an unknown op, an add with no qty/rate, a change naming no line are dropped; bad numbers are ignored', bad.length === 1 && bad[0].line === 'L3' && !('qty' in bad[0]) && !('rate' in bad[0]), JSON.stringify(bad));
    ok('it is told how: one action for every line change, the words copied, cost rates, Apply before anything moves', /ONE action holds every line change of his request/.test(SRC) && /item is ALWAYS copied from that line as it reads now/.test(SRC) && /nothing changes until he presses Apply/.test(SRC));
    ok('...and it can start a regeneration (reprice or reread), which reads this chat', /\{\\"type\\":\\"regenerate\\",\\"ref\\":\\"SBC-\.\.\.\\",\\"how\\":\\"reprice\\"\}/.test(SRC) && /The generator reads everything he wrote in THIS chat as his instructions/.test(SRC));
  }

  console.log('\n2. The dashboard applies it the way a hand edit is made\n');
  {
    const ext = (name) => { const s = DASH.search(new RegExp('function ' + name + '\\s*\\(')); let d = 0; for (let j = DASH.indexOf('{', s); j < DASH.length; j++) { if (DASH[j] === '{') d++; else if (DASH[j] === '}') { d--; if (!d) return DASH.slice(s, j + 1); } } };
    const ctx = { fmt: (n) => '$' + Number(n).toFixed(2) };
    vm.createContext(ctx);
    ['lineOpsNorm', 'lineOpsWords', 'lineOpsSame', 'lineOpsFind', 'lineOpsCost', 'lineOpsTotal', 'lineOpsPlan', 'lineOpsApply', 'lineOpText'].forEach((f) => vm.runInContext(ext(f), ctx));
    const est = JSON.parse(JSON.stringify(REC.estimate));
    const plan = ctx.lineOpsPlan(est, [
      { op: 'change', kind: 'labor', line: 'L1', item: 'Install cement backer board on bathroom floors (440 sf)', qty: 30 },
      { op: 'remove', kind: 'labor', line: 'L9', item: 'Set customer-supplied toilets and sinks, install faucets and shower trim, 13 rooms' },
      { op: 'remove', kind: 'materials', line: 'M1', item: 'Toilet setting kit - wax ring, closet bolts, flexible supply' },
      { op: 'add', kind: 'materials', section: 'bathroom', item: 'Allowance - shower niches, 12 at $150', qty: 12, unit: 'ea', rate: 150 },
      { op: 'change', kind: 'labor', item: 'Paint the hallway', qty: 5 } ]);
    ok('ONE LINE CHANGED BY ITS ID: L1 24 → 30 hrs, +$326.40', plan.steps[0].op === 'change' && plan.steps[0].index === 0 && plan.steps[0].after.qty === 30 && Math.abs(plan.steps[0].delta - 326.4) < 0.001);
    ok('A LINE THAT MOVED IS STILL FOUND BY ITS WORDS (L9 is wrong, the words find L2)', plan.steps[1].op === 'remove' && plan.steps[1].index === 1);
    ok('an added line goes to the existing service (case forgiven)', plan.steps[3].after.section === 'Bathroom' && plan.steps[3].delta === 1800);
    ok('WORDS THAT FIT NO LINE ARE NEVER GUESSED: left out and said', plan.skipped.length === 1 && /Paint the hallway/.test(plan.skipped[0].reason));
    ok('the plan adds up: +326.40 - 3040 - 286 + 1800 = -1199.60', Math.abs(plan.delta - (-1199.6)) < 0.001, String(plan.delta));
    ok('the confirm shows each line before → after with its money', /• L1: Install cement backer board on bathroom floors \(440 sf\)\n   24 hrs × \$54\.40 = \$1305\.60\n   → 30 hrs × \$54\.40 = \$1632\.00 \(\+\$326\.40\)/.test(ctx.lineOpText(plan.steps[0])) && /• Remove M1: Toilet setting kit/.test(ctx.lineOpText(plan.steps[2])));
    ctx.lineOpsApply(est, plan);
    ok('APPLIED: the changed line, both removals, the new allowance - and every other line untouched', est.labor.length === 1 && est.labor[0].qty === 30 && est.materials.length === 1 && /niches/.test(est.materials[0].item) && Math.abs(ctx.lineOpsTotal(est) - (30 * 54.4 + 1800)) < 0.001);
    const two = { labor: [{ item: 'Grout tile', qty: 1, rate: 1 }, { item: 'Grout tile', qty: 2, rate: 1 }], materials: [] };
    ok('words that fit TWO lines are not guessed either', ctx.lineOpsPlan(two, [{ op: 'remove', kind: 'labor', item: 'Grout tile' }]).skipped.length === 1);
    const exec = DASH.slice(DASH.indexOf('if (t === "lines") {'), DASH.indexOf('if (t === "regenerate") {'));
    ok('NOTHING MOVES BEFORE APPLY: the confirm comes first, then the hand-edit path (syncLines, scopeLinesRefresh), then saveDraft', exec.indexOf('await ask(log, render, ltext, "Apply and save", "Not now")') > -1 && exec.indexOf('await ask(') < exec.indexOf('lineOpsApply(') && exec.indexOf('lineOpsApply(') < exec.indexOf('scopeLinesRefresh()') && exec.indexOf('scopeLinesRefresh()') < exec.indexOf('await saveDraft()') && /syncLines\(\)/.test(exec));
    ok('...the confirm shows the customer\'s new total and warns when an agreed price is set by hand', /"\\nTotal " \+ fmt\(lwas \* lk\) \+ " → " \+ fmt\(lnow \* lk\)/.test(exec) && /was set by hand and does not move - use SET TOTAL if it should/.test(exec));
    ok('...only on the estimate that is open; a sent one says the customer still sees the sent version', /Open " \+ lref \+ " first/.test(exec) && /The customer still sees the sent version until you send an update\./.test(exec));
    ok('REGENERATE from the chat runs the same button path (with its own confirm)', /generateAI\(true, reread\);/.test(DASH));
    ok('the panel says it is the estimator and waits long enough for it', /your estimator — ask, or tell it what to change/.test(DASH) && /The estimator is thinking… this can take 1–3 minutes\./.test(DASH) && /AI_ANSWER_POLLS = 220;/.test(DASH));
  }

  console.log('\n3. Regenerate remembers the chat\n');
  {
    const src = GEN.slice(GEN.indexOf('const CHAT_TURNS_TO_GENERATOR'), GEN.indexOf('/* Said to the AI whenever drawings are attached'));
    const c = { cleanText: (v) => (v == null ? '' : String(v).trim()), setTimeout, Promise,
      loadChat: async () => [{ role: 'user', text: 'The cellar gets a vanity too.', at: '2026-09-26T10:00:00Z' }, { role: 'assistant', text: 'Noted.' }, { role: 'user', text: '(auto) These edits were NOT applied' }, { role: 'user', text: 'Plumbing trim is by the plumber - never price it.', at: '2026-09-26T10:05:00Z' }] };
    vm.createContext(c); vm.runInContext(src + ';this.f = chatInstructionsFor;', c);
    const got = await c.f('SBC-260925-Y373');
    ok('HIS MESSAGES ARE READ FROM THE ESTIMATE\'S CHAT, oldest first - his, not the AI\'s, not the automatic retries', got.length === 2 && got[0].said === 'The cellar gets a vanity too.' && got[1].said === 'Plumbing trim is by the plumber - never price it.' && got[0].at === '2026-09-26', JSON.stringify(got));
    ok('...a slow or broken chat store never stops the run', /catch \(e\) \{ return \[\]; \}/.test(src) && /setTimeout\(function \(\) \{ r\(\[\]\); \}, 4000\)/.test(src));
    ok('THEY RIDE IN input.contractor, which every AI stage carries', /input\.contractor\.chatInstructions = await chatInstructionsFor\(ref\);/.test(GEN));
    ok('the analysis treats them as contractor notes: authoritative, the latest winning, a question is not an instruction', /contractor\.chatInstructions are the contractor's own messages from this estimate's chat, oldest first: they are contractor notes too/.test(GEN));
    ok('the estimator follows every one (rule 21), and so does the repair', /21\. HIS CHAT IS HIS INSTRUCTION\./.test(GEN) && /Keep every instruction in input\.contractor\.chatInstructions/.test(GEN));
    ok('they are NOT in the scope fingerprint, so Re-price keeps the pinned job', !/chatInstructions/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/lib/scope-pin.js'), 'utf8')));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
