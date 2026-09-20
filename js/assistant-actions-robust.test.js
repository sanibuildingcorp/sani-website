/* assistant-actions-robust.test.js — run: node js/assistant-actions-robust.test.js
 *
 *   "⚠ The assistant returned nothing. Try again."  (twice, on "analyze his
 *    requirements and current scope of work and found where need updates")
 *
 * The model answered - with a describe action holding the analysis - but
 * pretty-printed over several lines, or with a quote inside the text. The
 * JSON failed, the ACTION line was dropped, and what was left was nothing.
 * A reply that had words must never become "nothing".
 */
const fs = require('fs'), path = require('path'), Module = require('module');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return '@netlify/blobs'; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: () => ({ get: async () => null, set: async () => {} }) } };
const https = require('https');
let reply = '';
const sse = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
https.request = function (opts, cb) {
  const res = { statusCode: 200, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  return { on() { return this; }, write() {}, destroy() {}, end() { setImmediate(() => { cb(res); res._data(Buffer.from(sse({ type: 'message_start' }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: reply } }) + sse({ type: 'message_stop' }))); if (res._end) res._end(); }); } };
};
process.env.DASHBOARD_KEY = 'k'; process.env.ANTHROPIC_API_KEY = 'sk';
const fn = require(path.join(ROOT, 'netlify/functions/assistant.js'));
const ask = async (text) => { reply = text; const r = await fn.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ messages: [{ role: 'user', text: 'analyze his requirements and find where need updates' }] }) }); return { code: r.statusCode, body: JSON.parse(r.body) }; };

(async () => {
  console.log('\na reply that had words never becomes "nothing"\n');
  {
    const r = await ask('ACTION: {\n  "type": "describe",\n  "ref": "SBC-260901-ARWQ",\n  "text": "Customer confirmed the vanity, shower controls and hardware; wants the wall panels changed to the alternative panel he approved."\n}');
    ok('PRETTY-PRINTED JSON OVER SEVERAL LINES IS JOINED BACK INTO ONE ACTION', r.code === 200 && r.body.actions.length === 1 && r.body.actions[0].type === 'describe' && r.body.actions[0].ref === 'SBC-260901-ARWQ' && /wall panels changed/.test(r.body.actions[0].text), JSON.stringify(r.body));
    ok('...and the half-JSON lines are not shown as prose; with no words the reply is "Done."', r.body.reply === 'Done.', r.body.reply);
  }
  {
    const r = await ask('Adding two facts.\nACTION: {"type":"describe","ref":"SBC-260901-ARWQ","text":"He wrote "everything is confirmed" and wants the 3\' panel."}');
    ok('A QUOTE INSIDE THE TEXT no longer kills the action - read loosely', r.body.actions.length === 1 && r.body.actions[0].ref === 'SBC-260901-ARWQ' && /He wrote "everything is confirmed" and wants the 3' panel\./.test(r.body.actions[0].text), JSON.stringify(r.body.actions));
    ok('...the words before it are the reply', r.body.reply === 'Adding two facts.');
  }
  {
    const r = await ask('ACTION: {"type":"describe","ref":"SBC-260901-ARWQ","text":"He wrote "everything" is confirmed."}\nACTION: {"type":"open","ref":"SBC-260901-ARWQ"}');
    ok('two actions on two lines, one of them loose, both survive', r.body.actions.length === 2 && r.body.actions[0].type === 'describe' && r.body.actions[1].type === 'open');
  }
  {
    const r = await ask('ACTION: this is not json at all, just the analysis written after the word action');
    ok('WHEN EVERY LINE WAS AN ACTION AND NONE COULD BE READ, THE WORDS ARE SHOWN - never "returned nothing"', r.code === 200 && r.body.reply === 'this is not json at all, just the analysis written after the word action' && r.body.actions.length === 0, JSON.stringify(r.body));
  }
  {
    const r = await ask('Opening it.\nACTION: {"type":"open","ref":"SBC-1"}');
    ok('a well-formed action still works exactly as before', r.body.reply === 'Opening it.' && r.body.actions.length === 1 && r.body.actions[0].ref === 'SBC-1');
    const r2 = await ask('ACTION: {"type":"delete-everything","ref":"SBC-1"}\nDone that.');
    ok('an unknown type is still dropped, the words kept', r2.body.actions.length === 0 && r2.body.reply === 'Done that.');
    const r3 = await ask('ACTION: {"type":"status","ref":"SBC-1","status":"paid"}');
    ok('a status outside the list is still refused', r3.body.actions.length === 0);
  }
  {
    const A = fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant.js'), 'utf8');
    ok('the model is told: one line of valid JSON, single quotes inside text, words before any action', /An ACTION line is ONE line of valid JSON/.test(A) && /use single quotes, never double quotes/.test(A) && /Always write at least one line of words before any ACTION line/.test(A));
    ok('a truncated answer still carries no actions', /if \(truncated\) continue;/.test(A));
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
