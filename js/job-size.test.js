/* job-size.test.js — run: node js/job-size.test.js
 *
 *   "in the basement bathroom in one small area was floor tile little down
 *    and cracked and in the wall corner subway tile too ... so simple job
 *    just lifting up add mortar and put it back down in level ... but this
 *    AI write down like this: ohh my gosh it's need check plumbing ohh."
 *
 * The generator matched the size of the job to the trade, not to the
 * request. Now: the customer's words are read for a repair up front, both
 * prompts carry THE SIZE OF THE JOB IS THE SIZE OF THE REQUEST, a repair's
 * services with no work described get no lines and no card, the scope
 * writer says one to four lines, and the renovation checks stand down.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'netlify/functions/lib/scope-writer.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
function ext(name) {
  const s = SRC.search(new RegExp('(?:async )?function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = SRC.indexOf('{', s); j < SRC.length; j++) { if (SRC[j] === '{') d++; else if (SRC[j] === '}') { d--; if (!d) return SRC.slice(s, j + 1); } }
  throw new Error('unbalanced ' + name);
}
const J = require(path.join(ROOT, 'netlify/functions/lib/job-size.js'));

console.log('\n1. The customer\'s words: a repair is a repair\n');
{
  ok('"floor tile little down and cracked ... fix back" reads as a repair', J.readsAsRepair('In the basement bathroom in one small area the floor tile is a little down and cracked, and in the wall corner a subway tile too. Please fix them back.') === true);
  ok('"one tile came off the shower wall" reads as a repair; "a few tiles loose" too', J.readsAsRepair('One tile came off the shower wall.') === true && J.readsAsRepair('A few tiles are loose near the door') === true);
  ok('a full renovation, a gut, "replace the floor tile" and an empty description do not', J.readsAsRepair('Full bathroom renovation, tub to shower.') === false && J.readsAsRepair('Gut the bathroom and fix everything') === false && J.readsAsRepair('Replace the floor tile, it is cracked') === false && J.readsAsRepair('') === false);
  ok('isRepair reads the analyst\'s project_type', J.isRepair({ project_type: 'repair' }) === true && J.isRepair({ project_type: 'Repair - tile' }) === true && J.isRepair({ project_type: 'partial renovation' }) === false && J.isRepair(null) === false);
  ok('sizeHint: a repair description puts the hint at the top of the analysis prompt; a renovation puts nothing', /^THE CUSTOMER'S WORDS READ AS A REPAIR \(fix \/ cracked \/ loose \/ a few tiles, and nothing about renovating\): project_type is "repair" unless the record clearly says otherwise, and the scope is the repair only\.\n\n$/.test(J.sizeHint({ request: { description: 'cracked tile, please fix' } })) && J.sizeHint({ request: { description: 'full renovation' } }) === '');
  const a = { project_type: 'repair', selected_trades: ['Bathroom', 'Water Damage', 'General', 'Flooring'], confirmed_scope: [{ trade: 'Bathroom', scope_items: ['Lift the loose floor tiles, re-bed in mortar, level and regrout'] }, { trade: 'Water Damage', scope_items: [] }, { trade: 'Flooring', scope_items: [] }], assumptions: ['x'] };
  J.trimRepairTrades(a);
  ok('TRIM: a repair keeps only the services with work described, and says why the others are not priced', a.selected_trades.join(',') === 'Bathroom' && a.assumptions[1] === 'Selected on the form, no work described, not priced: Water Damage, General, Flooring', JSON.stringify(a.selected_trades) + ' ' + JSON.stringify(a.assumptions));
  const b = { project_type: 'full renovation', selected_trades: ['Bathroom', 'Flooring'], confirmed_scope: [{ trade: 'Bathroom', scope_items: ['x'] }] };
  J.trimRepairTrades(b);
  ok('a renovation is not trimmed; a repair with no work anywhere is left as it was', b.selected_trades.length === 2 && J.trimRepairTrades({ project_type: 'repair', selected_trades: ['A', 'B'], confirmed_scope: [] }).selected_trades.length === 2);
}

console.log('\n2. The generator: both prompts carry the rule, the normalizer trims, the checks stand down\n');
{
  const ctx = { JSON, String, Array, Number, Math, Set, Object, jobSize: J };
  vm.createContext(ctx);
  ['cleanText', 'titleCase', 'toStringArray', 'unique', 'clamp', 'normalizeProjectAnalysis', 'labOf', 'buildProjectAnalysisPrompt'].forEach((n) => vm.runInContext(ext(n), ctx));
  ctx.RAW = { project_type: 'repair', selected_trades: ['Bathroom'], confirmed_scope: [{ trade: 'Bathroom', scope_items: ['Re-set the loose tiles'] }], pricing_readiness: { status: 'READY_TO_ESTIMATE', confidence_score: 85 } };
  ctx.INPUT = { request: { description: 'cracked tile please fix', service: 'Bathroom', selectedServices: ['Bathroom', 'Water Damage', 'Flooring'], customerSupplies: [] } };
  const norm = vm.runInContext('normalizeProjectAnalysis(RAW, INPUT)', ctx);
  ok('NORMALIZE: the form\'s Water Damage and Flooring, with no work described, are dropped from a repair; the estimator prices Bathroom only', norm.selected_trades.join(',') === 'Bathroom' && /not priced: Water Damage, Flooring/.test(norm.assumptions.join('|')), JSON.stringify(norm.selected_trades) + ' ' + JSON.stringify(norm.assumptions));
  ctx.RAW2 = { project_type: 'full renovation', selected_trades: ['Bathroom'], confirmed_scope: [{ trade: 'Bathroom', scope_items: ['x'] }], pricing_readiness: {} };
  ok('...a renovation keeps every selected service as before', vm.runInContext('normalizeProjectAnalysis(RAW2, INPUT)', ctx).selected_trades.join(',') === 'Bathroom,Water Damage,Flooring');
  const prompt = vm.runInContext('buildProjectAnalysisPrompt(INPUT)', ctx);
  ok('THE ANALYSIS PROMPT: the repair hint at the top of the rules, rule 0 the size of the job, rules 9 and 15 amended', /THE CUSTOMER'S WORDS READ AS A REPAIR[^\n]*\n\nCORE ANALYSIS RULES:\n0\. THE SIZE OF THE JOB IS THE SIZE OF THE REQUEST\. First decide project_type/.test(prompt) && /9\. In a renovation, every selected trade must be represented[^\n]*In a REPAIR, a selected service the customer described no work for keeps EMPTY scope_items \(rule 0\)/.test(prompt) && /For a repair, the most reasonable interpretation IS the repair the customer described\./.test(prompt), prompt.slice(prompt.indexOf('CORE ANALYSIS RULES') - 220, prompt.indexOf('CORE ANALYSIS RULES') + 120));
  ok('THE ESTIMATOR PROMPT: rule 0 prices a repair as a repair - 2 to 6 lines, no coordination, no diagnostics, no waterproofing, empty services get no lines; rule 12 excepts a repair', /ESTIMATING METHOD:\\n0\. \$\{jobSize\.SIZE_RULE_ESTIMATOR\}\\n1\./.test(SRC) && /typically 2 to 6 labor lines/.test(J.SIZE_RULE_ESTIMATOR) && /NO project coordination or supervision line/.test(J.SIZE_RULE_ESTIMATOR) && /A selected service with empty scope_items gets NO lines/.test(J.SIZE_RULE_ESTIMATOR) && /A REPAIR is the exception: it is priced as a repair \(rule 0\), never grown into a renovation\./.test(SRC));
  ok('THE CHECKS STAND DOWN for a repair: no protection/cleanup demand, no supervision demand, and a warning past eight lines', /const repair = jobSize\.isRepair\(analysis\);\s*const renovationLike = !repair && /.test(SRC) && /const multiTrade = !repair && analysis\.selected_trades/.test(SRC) && /if \(repair && estimate\.labor\.length > 8\) warnings\.push\(`A repair with \$\{estimate\.labor\.length\} labor lines - check the estimator did not turn it into a renovation\.`\)/.test(SRC));
  ok('THE SCOPE WRITER: a repair gets one to four lines and is told to say only what is fixed; the minimum is passed to the enforcement', /\$\{jobSize\.isRepair\(analysis\) \? 1 : MIN_BULLETS\} to \$\{jobSize\.isRepair\(analysis\) \? 4 : MAX_BULLETS\} bullets/.test(SW) && /THIS IS A REPAIR: say only what is fixed and how, in one to four short lines/.test(SW) && /if \(!included\.length\) \{/.test(SW) && (SW.match(/jobSize\.isRepair\(analysis\) \? 1 : MIN_BULLETS\)/g) || []).length === 2);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
