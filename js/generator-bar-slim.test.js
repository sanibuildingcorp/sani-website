/* generator-bar-slim.test.js — run: node js/generator-bar-slim.test.js
 *
 *   "I marked with red lines and X this section we don't need any more, any
 *    updates now i can rewrite direct in customer description and we can
 *    remove that for let's make dashboard again little shorter and unused
 *    functions remove"
 *
 * The "Use for this estimate" toggles and the "Measurements, corrections &
 * extra notes" box are gone from the AI generator bar, on the first-time bar
 * and on the REGENERATE bar. The helpers that read them are gone too.
 * generateAI still posts a valid payload: the description and the answers are
 * always used, and the server keeps its defaults.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
function ext(name) {
  const s = DASH.search(new RegExp('(?:async )?function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = DASH.indexOf('{', s); j < DASH.length; j++) { if (DASH[j] === '{') d++; else if (DASH[j] === '}') { d--; if (!d) return DASH.slice(s, j + 1); } }
  throw new Error('unbalanced ' + name);
}

console.log('\nthe crossed-out section is gone\n');
{
  const code = stripComments(DASH);
  ok('NO "Use for this estimate" TOGGLES', !/Use for this estimate/.test(code) && !/id="use-description"/.test(code) && !/id="use-answers"/.test(code));
  ok('NO "Measurements, corrections & extra notes" BOX', !/Measurements, corrections/.test(code) && !/id="ai-extra-request"/.test(code));
  ok('the helpers that built and read them are gone', !/aiToggleHtml|aiExtraHtml|aiToggleStyle|aiChk\(|extraEl\b/.test(code));
  const bars = code.match(/<div class="ai-bar">[\s\S]*?<button class="btn-ai"/g) || [];
  ok('both generator bars still exist, and neither carries a textarea or a checkbox', bars.length === 2 && bars.every((b) => !/textarea|checkbox/.test(b)), bars.length + ' bars');
  ok('the Edit button on the request card is still how he rewrites the description', /onclick="sbcEditCustomer\(\)"/.test(code));
}

console.log('\ngenerateAI still posts a valid payload\n');
{
  const src = ext('generateAI');
  ok('generateAI no longer looks for the removed inputs', !/ai-extra-request|use-description|use-answers|aiChk/.test(stripComments(src)));
  let posted = null;
  const ctx = {
    String, Number, Date, Math, JSON, console: { log() {}, error() {}, warn() {} },
    currentRecord: { ref: 'SBC-1', status: 'new', estimate: {} },
    SBC_HOUSE_RULES: 'rules',
    confirm: () => true, regenerateWarning: () => '', toast: () => {}, esc: (s) => String(s),
    document: { getElementById: (id) => id === 'gen-btn' ? { disabled: false, innerHTML: '' } : null },
    fetch: async (url, o) => { posted = { url, body: JSON.parse(o.body) }; throw new Error('stop here'); },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  (async () => {
    try { await vm.runInContext('generateAI()', ctx); } catch (e) { /* the test fetch stops the run on purpose */ }
    ok('IT POSTS TO THE BACKGROUND GENERATOR', posted !== null && /generate-estimate-background/.test(posted.url), posted && posted.url);
    const b = posted && posted.body;
    ok('...using the description and the answers, no extra notes', !!b && b.useDescription === true && b.useAnswers === true && b.extraRequest === '', JSON.stringify(b));
    ok('...with the ref, a job id, reanalyze false and the house rules', !!b && b.ref === 'SBC-1' && /^ai-/.test(b.jobId) && b.reanalyze === false && b.houseRules === 'rules');

    console.log('\nthe server keeps its defaults\n');
    const G = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'), 'utf8');
    ok('a missing or true useDescription/useAnswers means "use it"', /body\.useDescription === false \? "" : cleanText\(request\.description\)/.test(G) && /body\.useAnswers === false \? \{\} : groupedAnswers/.test(G));
    ok('an empty extraRequest is cleaned, not crashed on', /extraRequest: cleanText\(body\.extraRequest\)/.test(G));

    const blocks = DASH.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    let broken = null;
    blocks.forEach(function (bl, i) { try { new vm.Script(bl.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; } });
    ok('all ' + blocks.length + ' script blocks parse', broken === null, broken || '');
    console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
    process.exit(fail ? 1 : 0);
  })().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
}
