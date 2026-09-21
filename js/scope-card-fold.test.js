/* scope-card-fold.test.js — run: node js/scope-card-fold.test.js
 *
 *   "in the card that material lists and labors lists makes very long
 *    cards and as i know its not shows to the customer side ... make
 *    cards in my side shortness"
 *
 * Each Scope Control card folds its price lines behind one row - Labor N
 * lines · $X · Materials M lines · $Y ▸ show lines - closed by default,
 * open when he needs a line, and it stays open across the re-render every
 * edit causes. Included / supplies / not included stay as they were.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
function ext(name) {
  const s = DASH.search(new RegExp('(?:async )?function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = DASH.indexOf('{', s); j < DASH.length; j++) { if (DASH[j] === '{') d++; else if (DASH[j] === '}') { d--; if (!d) return DASH.slice(s, j + 1); } }
  throw new Error('unbalanced ' + name);
}

console.log('\nthe fold\n');
{
  ok('THE PRICE LINES SIT INSIDE A <details> WITH ONE SUMMARY ROW: labor count and total, materials count and total, a cue', /<details class="sc-lines-fold" data-nm="' \+ esc\(nm\) \+ '"' \+ \(linesOpen \? ' open' : ''\)/.test(DASH) && /var linesOpen = \(typeof SCOPE_LINES_OPEN !== 'undefined'\) && SCOPE_LINES_OPEN\[nm\] === true;/.test(DASH) && /<summary><span>Labor ' \+ lab\.length \+ ' line' \+ \(lab\.length === 1 \? '' : 's'\) \+ ' · ' \+ fmt\(labTot\) \+ '<\/span><span>Materials ' \+ mat\.length/.test(DASH) && /'▾ hide lines' : '▸ show lines'/.test(DASH));
  ok('...closed by default: nothing marks a card open until he opens it', /var SCOPE_LINES_OPEN = \{\};/.test(DASH));
  ok('...and the details closes before the wording groups, which are untouched', /html \+= '<\/div><\/details>';\s*\n\s*\/\* the three wording groups, all open, directly under the prices \*\//.test(DASH));
  ok('the totals come from the card\'s own lines at the markup, the same figures the editable subtotals use', /var labTot = scopeRowsRaw\(scopeRowsFor\(nm, "labor"\)\) \* kL, matTot = scopeRowsRaw\(scopeRowsFor\(nm, "materials"\)\) \* kL;/.test(DASH));
  ok('the summary has no browser marker and the cue sits at the right', /\.sc-lines-fold>summary::-webkit-details-marker\{display:none\}/.test(DASH) && /\.sc-lines-fold>summary \.sc-fold-cue\{margin-left:auto/.test(DASH));
  const cue = { textContent: '▸ show lines' };
  const el = { getAttribute: () => 'Bathroom', querySelector: (q) => (q === '.sc-fold-cue' ? cue : {}) };
  const ctx = { document: { querySelectorAll: () => [el] } };
  vm.createContext(ctx);
  vm.runInContext('var SCOPE_LINES_OPEN = {};\n' + ext('scopeLinesToggle'), ctx);
  vm.runInContext('scopeLinesToggle("Bathroom", true)', ctx);
  ok('OPENING A CARD IS REMEMBERED (so the next re-render keeps it open) and the cue flips', vm.runInContext('SCOPE_LINES_OPEN["Bathroom"] === true', ctx) && cue.textContent === '▾ hide lines');
  vm.runInContext('scopeLinesToggle("Bathroom", false)', ctx);
  ok('closing it is remembered too', vm.runInContext('SCOPE_LINES_OPEN["Bathroom"] === false', ctx) && cue.textContent === '▸ show lines');
  vm.runInContext('scopeLinesToggle("", true)', ctx);
  ok('a toggle with no card name is ignored', vm.runInContext('Object.keys(SCOPE_LINES_OPEN).length', ctx) === 1);
  const blocks = DASH.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
  let broken = null;
  blocks.forEach(function (bl, i) { try { new vm.Script(bl.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; } });
  ok('all ' + blocks.length + ' script blocks parse', broken === null, broken || '');
}
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
