/* short-readiness.test.js — run: node js/short-readiness.test.js
 *
 *   "This explanation texts makes so long and i don't read it too, can you
 *    remove it? Keep only timing shows" ... "there is a customer preferred
 *    color and ... it says opposite ... the painting color doesn't affect on
 *    price and doesn't matter what color will choose customer."
 *
 * The "How sure is this estimate?" panel shows one status line (with the
 * confidence) and the timing - no repair report, no reason paragraph, no
 * question list. The generator never asks about paint color, brand or
 * sheen: the analysis prompt says so, and the normalizer drops any such
 * question or missing item the model writes anyway.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
function ext(src, name) {
  const s = src.search(new RegExp('(?:async )?function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = src.indexOf('{', s); j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) return src.slice(s, j + 1); } }
  throw new Error('unbalanced ' + name);
}

console.log('\n1. The panel: one status line and the timing\n');
{
  const a = DASH.indexOf('var readinessHtml = (function ()');
  const b = DASH.indexOf('})();', a);
  const body = DASH.slice(a, b);
  ok('NO REASON PARAGRAPH, NO "Priced, but on assumptions..." sentence', body.indexOf('esc(pr.reason)') === -1 && body.indexOf('esc(st.s)') === -1);
  ok('NO QUESTION LIST ("What it could not work out...")', body.indexOf('What it could not work out') === -1 && body.indexOf('qs.forEach') === -1);
  ok('NO REPAIR REPORT ("The first draft failed N checks")', body.indexOf('The first draft failed') === -1 && body.indexOf('est.repairReport') === -1);
  ok('THE STATUS PILL AND THE CONFIDENCE STAY, ONE LINE', /esc\(st\.t\)/.test(body) && /% confident/.test(body));
  ok('THE TIMING STAYS', /Took ' \+ esc\(secs\(total\)\) \+ ' to generate/.test(body) && /Writing the estimate/.test(body));
  ok('the "job re-read / same job" pill stays', /Job re-read/.test(body));
}

console.log('\n2. The generator never asks about paint color\n');
{
  const ctx = { JSON, String, Array, Number, Math, Set, Object, jobSize: require(path.join(ROOT, 'netlify/functions/lib/job-size.js')) };
  vm.createContext(ctx);
  ['cleanText', 'titleCase', 'toStringArray', 'unique', 'clamp', 'normalizeProjectAnalysis'].forEach((n) => vm.runInContext(ext(SRC, n), ctx));
  ctx.RAW = { project_type: 'partial renovation', selected_trades: ['Painting'], confirmed_scope: [{ trade: 'Painting', scope_items: ['Walls, trim and closets in two rooms'] }],
    clarification_questions: [
      { question: 'What is the ceiling height in the living room and bedroom?', pricing_importance: 'critical' },
      { question: 'What color would you like - is Benjamin Moore Simply White confirmed?', pricing_importance: 'high' },
      { question: 'What sheen would you like for the walls and for trim?', helper_text: 'Eggshell or satin', pricing_importance: 'medium' },
      { question: 'Will the apartment be furnished while we paint?', pricing_importance: 'high' },
    ],
    missing_information: [{ question: 'Paint color not confirmed', priority: 'optional' }, { question: 'Ceiling height', priority: 'critical' }],
    pricing_readiness: { status: 'PRELIMINARY_ESTIMATE_WITH_ASSUMPTIONS', confidence_score: 74 } };
  ctx.INPUT = { request: { description: 'Paint 2 rooms, Benjamin Moore Simply White', service: 'Painting', selectedServices: ['Painting'], customerSupplies: [] } };
  const out = vm.runInContext('normalizeProjectAnalysis(RAW, INPUT)', ctx);
  const qs = out.clarification_questions.map((q) => q.question);
  ok('THE COLOR AND SHEEN QUESTIONS ARE DROPPED; ceiling height and furnished stay', qs.length === 2 && /ceiling height/.test(qs[0]) && /furnished/.test(qs[1]), JSON.stringify(qs));
  ok('...and "paint color not confirmed" is not listed as missing', out.missing_information.length === 1 && /Ceiling/.test(out.missing_information[0].question));
  ok('THE ANALYSIS PROMPT says paint color, brand and sheen never change the price, and to use the customer\'s color as given', /13a\. PAINT COLOR, BRAND AND SHEEN NEVER CHANGE THE PRICE\. Never ask about them, never list them as missing or unconfirmed, and never make them an assumption\. If the customer named a color or a brand, use it exactly as given\./.test(SRC));
}
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
