/* assistant-empty-stream.test.js — run: node js/assistant-empty-stream.test.js
 *
 *   "⚠ The assistant returned nothing. Try again."  (three times in a row)
 *
 * That sentence names the symptom, not the cause. The stream is watched
 * now: an empty answer says which events came and what the stop reason
 * was, a refusal and a max_tokens stop get their own words, and the
 * background path gets more room to write.
 */
const fs = require('fs'), path = require('path'), Module = require('module');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

const STORES = {};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return '@netlify/blobs'; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (o) => { const m = STORES[o.name] || (STORES[o.name] = new Map()); return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); } }; } } };
const https = require('https');
let frames = [], sent = null;
const sse = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
https.request = function (opts, cb) {
  const res = { statusCode: 200, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  return { on() { return this; }, write(b) { sent = JSON.parse(b); }, destroy() {}, end() { setImmediate(() => { cb(res); res._data(Buffer.from(frames.map(sse).join(''))); if (res._end) res._end(); }); } };
};
process.env.DASHBOARD_KEY = 'k'; process.env.ANTHROPIC_API_KEY = 'sk';
const fn = require(path.join(ROOT, 'netlify/functions/assistant.js'));
const bg = require(path.join(ROOT, 'netlify/functions/assistant-background.js'));
const ask = async (fr, h) => { frames = fr; const r = await (h || fn).handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'A-empty0001', messages: [{ role: 'user', text: 'upgrade them in estimate' }] }) }); return { code: r.statusCode, body: JSON.parse(r.body) }; };

(async () => {
  console.log('\nan empty stream says what it contained\n');
  {
    let r = await ask([{ type: 'message_start' }, { type: 'content_block_start', content_block: { type: 'text' } }, { type: 'content_block_stop' }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }]);
    ok('NO TEXT AT ALL -> the error names the stop reason and the events', r.code === 502 && /returned nothing \(stop: end_turn; stream: message_start, content_block_start\[text\], content_block_stop, message_delta, message_stop\)/.test(r.body.error), r.body.error);
    r = await ask([{ type: 'message_start' }, { type: 'message_delta', delta: { stop_reason: 'refusal' } }, { type: 'message_stop' }]);
    ok('a refusal gets its own words', /declined to answer that one/.test(r.body.error), r.body.error);
    r = await ask([{ type: 'message_start' }, { type: 'message_delta', delta: { stop_reason: 'max_tokens' } }, { type: 'message_stop' }]);
    ok('running out of room before the first word gets its own words', /ran out of room/.test(r.body.error), r.body.error);
    r = await ask([{ type: 'message_start' }, { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }]);
    ok('a stream of only thinking deltas is named as such', /content_block_delta\[thinking_delta\]/.test(r.body.error), r.body.error);
    r = await ask([{ type: 'message_start' }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Here you go.' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }]);
    ok('a normal answer is unchanged', r.code === 200 && r.body.reply === 'Here you go.');
    r = await ask([{ type: 'message_start' }, { type: 'content_block_delta', delta: { type: 'text_delta', text: '   \n  ' } }, { type: 'message_stop' }]);
    ok('whitespace only counts as nothing, and says so', r.code === 502 && /returned nothing/.test(r.body.error));
  }
  console.log('\nthe background path has room for a long action\n');
  {
    await ask([{ type: 'message_start' }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }, { type: 'message_stop' }], bg);
    ok('assistant-background asks for 2500 tokens; the sync function keeps 800', sent.max_tokens === 2500 && (await ask([{ type: 'message_start' }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }, { type: 'message_stop' }]), sent.max_tokens === 800));
    const job = JSON.parse(STORES['assistant-jobs'].get('A-empty0001'));
    ok('...and the job carries the answer', job.status === 'done' && job.reply === 'ok');
    await ask([{ type: 'message_start' }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }], bg);
    ok('an empty answer in the background lands in the job as the same informative error', /returned nothing \(stop: end_turn/.test(JSON.parse(STORES['assistant-jobs'].get('A-empty0001')).error));
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
/* appended: the cause, once the error named it */
(async () => {
  const fs2 = require('fs'), path2 = require('path');
  const A = fs2.readFileSync(path2.join(__dirname, '..', 'netlify/functions/assistant.js'), 'utf8');
  const C = fs2.readFileSync(path2.join(__dirname, '..', 'netlify/functions/lib/claude.js'), 'utf8');
  const okk = (n, c) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n); };
  okk('THINKING IS SWITCHED OFF on the assistant call - the budget is for the words (only the estimator inside an estimate keeps it, with 16,000 tokens)', /\.\.\.\(est && est\.think \? \{\} : \{ thinking: \{ type: "disabled" \} \}\),/.test(A));
  okk('...and on the digest / alert calls', /thinking: \{ type: "disabled" \} \}, payload\)/.test(C));
  okk('the max_tokens message names the stream, so a thinking-only stream shows as such', /ran out of room before writing anything \(stream: " \+ \(events/.test(A));
})();
