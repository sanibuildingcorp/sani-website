/* model-upgrades.test.js — run: node js/model-upgrades.test.js
 *
 *   "Now upgrade any other AI models as you recommended"
 *
 * Four functions ran on gpt-4o-mini - two generations old at the same price -
 * and three on Claude Sonnet 4.5. They move to gpt-5-mini and Sonnet 5.
 *
 * THE THING THAT BITES: the GPT-5 family is not a drop-in for gpt-4o-mini on
 * the chat-completions endpoint. It REJECTS `temperature` (only the default is
 * allowed), it wants `max_completion_tokens` instead of `max_tokens`, and that
 * cap now also covers the model's own reasoning tokens - so a cap that was
 * comfortable for gpt-4o-mini can cut the answer off mid-JSON unless
 * `reasoning_effort` is kept minimal and the cap is raised. A model-name swap
 * that leaves `temperature: 0.3` in place is a 400 on every call, and the
 * handyman form would stop producing questions the moment it deployed.
 *
 * So this file reads the real payload each function builds, not the file text.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FN = (f) => path.join(ROOT, 'netlify/functions', f);
const read = (f) => fs.readFileSync(FN(f), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* Evaluate the object literal that starts at `anchor` in `src`, with the free
   identifiers it uses supplied by `scope`. */
function literalAt(src, anchor, scope) {
  const s = src.indexOf(anchor);
  if (s < 0) throw new Error('anchor not found: ' + anchor);
  const start = src.indexOf('{', s);
  let d = 0;
  for (let j = start; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return vm.runInNewContext('(' + src.slice(start, j + 1) + ')', Object.assign({ process: { env: {} } }, scope)); }
  }
  throw new Error('unbalanced literal at ' + anchor);
}

/* ══ THE FOUR OPENAI CALLERS ══════════════════════════════════════════════ */
console.log('\nthe mini-model callers send what gpt-5-mini accepts\n');
const OPENAI = [
  ['handyman-analyze.js', 'const payload = {', { SYSTEM_PROMPT: 's', userContent: [] }],
  ['handyman-questions.js', 'const payload = {', { content: [] }],
  /* Anchored on the call, not on a bare "JSON.stringify({" - the file has an
     earlier one, and the first run of this test evaluated that literal instead
     and reported four failures against a payload that was correct. */
  ['find-materials.js', 'openaiPost(openaiKey, JSON.stringify({', { prompt: 'p' }],
];
OPENAI.forEach(function ([file, anchor, scope]) {
  const body = literalAt(read(file), anchor, scope);
  ok(file + ': model is gpt-5-mini', body.model === 'gpt-5-mini', body.model);
  ok(file + ': NO temperature — the GPT-5 family rejects it with a 400', !('temperature' in body), JSON.stringify(body.temperature));
  ok(file + ': max_completion_tokens, not max_tokens', typeof body.max_completion_tokens === 'number' && !('max_tokens' in body));
  ok(file + ': reasoning kept minimal so the cap is spent on the answer', body.reasoning_effort === 'minimal');
  ok(file + ': the cap was raised above the old one (reasoning tokens count against it now)', body.max_completion_tokens >= 2000, String(body.max_completion_tokens));
  ok(file + ': MINI_MODEL in the environment overrides the model without a deploy',
    /process\.env\.MINI_MODEL \|\| "gpt-5-mini"/.test(read(file)));
});
ok('handyman-submit records the same default model name in Supabase',
  /process\.env\.MINI_MODEL \|\| "gpt-5-mini"/.test(read('handyman-submit.js')));
ok('the vision calls still send images (gpt-5-mini takes image_url the same way)',
  /type: "image_url"/.test(read('handyman-analyze.js')) && /type: "image_url"/.test(read('handyman-questions.js')));
ok('handyman-analyze still forces JSON output', /response_format: \{ type: "json_object" \}/.test(read('handyman-analyze.js')));

/* ══ THE THREE SONNET CALLERS ═════════════════════════════════════════════ */
console.log('\nthe Sonnet 4.5 callers are on Sonnet 5\n');
['generate-contract-background.js', 'analyze-bid-background.js', 'estimate-ai-question.js'].forEach(function (f) {
  const src = read(f);
  ok(f + ': claude-sonnet-5', /claude-sonnet-5/.test(src) && !/claude-sonnet-4-5/.test(src));
  ok(f + ': no temperature or top_p sent (Claude 5 rejects non-default sampling)', !/temperature:|top_p:/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
});

/* ══ NOTHING OLD LEFT ═════════════════════════════════════════════════════ */
console.log('\nno live function still names the old models\n');
{
  const fns = fs.readdirSync(path.join(ROOT, 'netlify/functions')).filter(f => f.endsWith('.js'));
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  /* generate-estimate.js is the retired synchronous estimator with no caller;
     it is left as it was, on purpose, and excluded here. */
  const old = fns.filter(f => f !== 'generate-estimate.js' && /gpt-4o-mini|claude-sonnet-4-5/.test(strip(read(f))));
  ok('no live function calls gpt-4o-mini or Sonnet 4.5 any more', old.length === 0, old.join(', '));
}

/* ══ THE ESTIMATOR'S READER ═══════════════════════════════════════════════ */
console.log('\nthe estimate is read and priced by the same model\n');
{
  const src = read('generate-estimate-background.js');
  ok('stage 1 (understanding) runs on Claude whenever an Anthropic key exists',
    /if \(anthropicKey\) \{\s*rawAnalysis = await callClaude\(anthropicKey, analysisPrompt, 16000, null, photoBlocks\);/.test(src));
  ok('stage 3 (pricing) is the same CLAUDE_MODEL', /const CLAUDE_MODEL = process\.env\.ESTIMATOR_MODEL \|\| "claude-opus-5"/.test(src));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
