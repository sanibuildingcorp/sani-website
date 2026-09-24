/* steady-reprice.test.js — run: node js/steady-reprice.test.js
 *
 *   "go find and make it steadier": three presses of Re-price on the
 *   unchanged Astoria job gave $40,431, $38,074 and $31,778. Markup was the
 *   same 25%; labor went $24,524 -> $19,042 and materials $8,396 -> $6,381.
 *   The job was pinned - the estimator re-guessed every hour and product.
 *
 * When the job is unchanged (the scope pin is reused), the last estimate's
 * lines go into the pricing prompt and the estimator starts from them. Not a
 * floor or a ceiling: a line changes when the scope or the house rules say
 * so, and "Re-read the job from scratch" still prices from zero.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const GEN = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'), 'utf8');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
function ext(name) {
  const s = GEN.search(new RegExp('function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing ' + name);
  let d = 0;
  for (let j = GEN.indexOf('{', s); j < GEN.length; j++) { if (GEN[j] === '{') d++; else if (GEN[j] === '}') { d--; if (!d) return GEN.slice(s, j + 1); } }
}
const ctx = { Math, Number, String, Array, JSON };
vm.createContext(ctx);
vm.runInContext([ext('cleanText'), ext('anchorFrom'), ext('buildAnchorBlock')].join('\n'), ctx);

const ASTORIA = {
  labor: [
    { section: 'Bathroom', item: 'Bathroom demolition and debris loading', qty: 24, unit: 'hrs', rate: 75 },
    { section: 'Flooring', item: 'Install engineered hardwood flooring', qty: 40, unit: 'hrs', rate: 110 },
    { section: 'Whole Project', item: 'Project coordination and supervision', qty: 20, unit: 'hrs', rate: 120 },
  ],
  materials: [{ section: 'Bathroom', item: 'Waterproofing membrane, 100 sq ft roll', qty: 2, unit: 'roll', rate: 119 }],
};

console.log('\n1. The last estimate goes with the prompt\n');
{
  const a = vm.runInContext('anchorFrom(' + JSON.stringify(ASTORIA) + ')', ctx);
  ok('every labor and material line, with its section, quantity and rate', a.labor.length === 3 && a.materials.length === 1 && a.labor[0] === '- [Bathroom] Bathroom demolition and debris loading | 24 hrs | $75' && a.materials[0] === '- [Bathroom] Waterproofing membrane, 100 sq ft roll | 2 roll | $119', JSON.stringify(a));
  const b = vm.runInContext('buildAnchorBlock(anchorFrom(' + JSON.stringify(ASTORIA) + '))', ctx);
  ok('THE ESTIMATOR IS TOLD TO START FROM IT: keep hours, quantities and products unless the scope or house rules call for a change', /YOUR LAST ESTIMATE FOR THIS SAME JOB - START FROM IT/.test(b) && /Keep every task, its hours and its quantity, and every product and its quantity, unless the project understanding or the house rules call for something different\./.test(b) && /Do not re-guess hours or quantities that are already here\./.test(b));
  ok('...it may still fix a broken line or add missing work, and must say why', /You may fix a line that breaks a rule in this prompt/.test(b) && /Record every change you make in assumptions, with its reason\./.test(b));
  ok('...house rules win', /House rules above win over these lines where they conflict\./.test(b));
  ok('NOT A FLOOR OR A CEILING: no minimum, maximum or "no lower/higher than" in it', !/minimum|maximum|at least \$|no (lower|higher|less|more) than|never (below|above)|floor price|ceiling price/i.test(b));
  ok('...and the lines are all there', b.indexOf('- [Whole Project] Project coordination and supervision | 20 hrs | $120') !== -1);
  ok('nothing priced yet: no block (a first estimate is priced from zero)', vm.runInContext('anchorFrom(null)', ctx) === null && vm.runInContext('anchorFrom({ labor: [] })', ctx) === null && vm.runInContext('buildAnchorBlock(null)', ctx) === '');
  const long = { labor: Array.from({ length: 200 }, (_, i) => ({ item: 'Task ' + i, qty: 1, rate: 1 })) };
  ok('a very long estimate is capped (90 labor lines), so the prompt stays a sane size', vm.runInContext('anchorFrom(' + JSON.stringify(long) + ')', ctx).labor.length === 90);
}

console.log('\n2. Only when the job is the same\n');
{
  ok('THE GENERATOR anchors only when the scope pin was reused and it is not an added service', /const anchor = pin\.reuse && !addSvc \? anchorFrom\(previousEstimate\) : null;[\s\S]{0,160}const estimatePrompt = buildEstimatePrompt\(input, projectAnalysis, marketResearch, anchor\);/.test(GEN));
  ok('...the block rides in the pricing prompt, after the house rules and market research', /buildEstimatePrompt\(input, analysis, research, anchor\) \{\n  return `You are the Senior Construction Estimator for Sani Building Corp in the NYC metro area\.\$\{buildHouseRulesBlock\(input\)\}\$\{buildResearchBlock\(research\)\}\$\{buildAnchorBlock\(anchor\)\}/.test(GEN));
  ok('...and the run records how many lines it started from', /if \(anchor\) timing\.anchoredOnLines = anchor\.labor\.length \+ anchor\.materials\.length;/.test(GEN));
  ok('THE BUTTONS SAY IT: Re-price stays close; Re-read starts fresh', /Re-price keeps the same job and stays close to the current price\. Re-read starts fresh — use it when the customer tells you something new\./.test(DASH));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
