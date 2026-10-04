/* phase2-progress.test.js — run: node js/phase2-progress.test.js
 *
 *   Simplewise "Building your estimate 65%" + "Edit with AI"
 *   -> "Yes go start" (Phase 2).
 *
 * 1. Generation shows a percent from the stage the server reports.
 * 2. Edit with AI on Scope and Estimate goes through the same Ask AI path.
 * (The screens were checked in Chromium at 390px.)
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

(async () => {
  /* progress */
  const g = DASH.slice(DASH.indexOf('var GEN_STAGE_PCT'), DASH.indexOf('function genProgressBar'));
  const c = {}; vm.createContext(c); vm.runInContext(g, c);
  ok('progress follows the stage: reading 5%, pricing 40%, scope 90%', c.genPct('Reading the job', 0) === 5 && c.genPct('Pricing the work', 0) === 40 && c.genPct('Writing the scope of work', 0) === 90);
  ok('inside a stage it creeps but never reaches the next stage, and never 100 before the end', c.genPct('Reading the job', 10 * 60000) === 24 && c.genPct('Writing the scope of work', 60 * 60000) === 98);
  ok('the button shows the percent and the stage; it never goes backwards', /lastPct = Math\.max\(lastPct, genPct\(stage, Date\.now\(\) - stageAt\)\)/.test(DASH));

  /* edit with AI */
  ok('Edit with AI sends through askSend (same chat, same before/after confirm on price changes)', /ask\.value = text;[\s\S]{0,600}await askSend\(\)/.test(DASH));
  ok('...on the Scope and Estimate tabs', /\['scope', 'estimate'\]\.forEach\(function\(k\)\{\s*var holder/.test(DASH));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
