/* estimator-output-cap.test.js — run: node js/estimator-output-cap.test.js
 *
 *   "AI generation failed: Claude response hit the 16000-token limit and
 *    was cut off. Raise max_tokens for this call or shorten the prompt."
 *
 * Thinking shares max_tokens with the answer. The understanding stage had
 * 16,000; a job with photos and a long thread thought past it and the JSON
 * never came, so the whole run failed with a message he cannot act on.
 * Now the stage has the same 32,000 as the pricing pass, and any call cut
 * at max_tokens is tried once more with double the room (up to 64,000)
 * before it fails - with a message that says what to press.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
function ext(name) {
  const s = SRC.search(new RegExp('(?:async )?function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = SRC.indexOf('{', s); j < SRC.length; j++) { if (SRC[j] === '{') d++; else if (SRC[j] === '}') { d--; if (!d) return SRC.slice(s, j + 1); } }
  throw new Error('unbalanced ' + name);
}

/* an https that answers each request from a script of stop reasons */
let sentCaps = [], script = [];
const ctx = {
  console: { log() {} }, String, Number, Array, Object, JSON, RegExp, Buffer, Promise, Error, Math, setImmediate,
  CLAUDE_MODEL: 'claude-opus-5', CLAUDE_EFFORT: 'high',
  https: { request: function (opts, cb) {
    let payload = null;
    return { on() { return this; }, setTimeout() {}, destroy() {}, write(b) { payload = JSON.parse(b); }, end() {
      sentCaps.push(payload.max_tokens);
      const stop = script.shift() || 'end_turn';
      const res = { statusCode: 200, _d: null, _e: null, on(ev, fn) { if (ev === 'data') this._d = fn; if (ev === 'end') this._e = fn; return this; } };
      setImmediate(() => { cb(res); res._d(Buffer.from(JSON.stringify({ stop_reason: stop, content: [{ type: 'thinking', thinking: '...' }, { type: 'text', text: stop === 'max_tokens' ? '{"half":' : '{"whole":true}' }] }))); res._e(); });
    } };
  } },
};
vm.createContext(ctx);
vm.runInContext(ext('callClaude'), ctx);
const call = (cap) => vm.runInContext("callClaude('k', 'THE PROMPT', " + cap + ")", ctx);

(async () => {
  console.log('\n1. The understanding stage has the room the pricing pass has\n');
  ok('THE ANALYSIS CALL ASKS FOR 32,000 TOKENS, not 16,000', /rawAnalysis = await callClaude\(anthropicKey, analysisPrompt, 32000, null, photoBlocks\);/.test(SRC) && !/analysisPrompt, 16000/.test(SRC));
  ok('the pricing and repair passes keep 32,000', /callClaude\(anthropicKey, estimatePrompt, 32000\)/.test(SRC) && /callClaude\(anthropicKey, repairPrompt, 32000\)/.test(SRC));

  console.log('\n2. A response cut at max_tokens is tried once more with double the room\n');
  {
    sentCaps = []; script = ['max_tokens', 'end_turn'];
    const text = await call(16000);
    ok('TWO REQUESTS: 16,000 then 32,000, and the second answer is the one returned', sentCaps.join(',') === '16000,32000' && text === '{"whole":true}', sentCaps.join(',') + ' -> ' + text);
    sentCaps = []; script = ['end_turn'];
    const t2 = await call(32000);
    ok('a whole answer is not retried', sentCaps.join(',') === '32000' && t2 === '{"whole":true}');
    sentCaps = []; script = ['max_tokens', 'end_turn'];
    await call(40000);
    ok('the retry never asks past the 64,000 ceiling', sentCaps.join(',') === '40000,64000', sentCaps.join(','));
  }

  console.log('\n3. Cut twice, it fails with a message he can act on\n');
  {
    sentCaps = []; script = ['max_tokens', 'max_tokens'];
    let err = null;
    try { await call(32000); } catch (e) { err = e; }
    ok('two cuts: 32,000 then 64,000, then the error', sentCaps.join(',') === '32000,64000' && !!err, sentCaps.join(','));
    ok('...the message names the cap and says to press Generate again, not "raise max_tokens"', !!err && /hit the 64000-token limit and was cut off, even after a retry with more room\. Press Generate again; if it happens again, shorten the description or split the job\./.test(err.message) && !/Raise max_tokens/.test(err.message), err && err.message);
    sentCaps = []; script = ['max_tokens'];
    err = null;
    try { await call(64000); } catch (e) { err = e; }
    ok('already at the ceiling, one cut is the end: no retry', sentCaps.join(',') === '64000' && !!err);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
