/* generation-stages.test.js — run: node js/generation-stages.test.js
 *
 *   "Generating… 655s" - "It's still loading"
 *
 * A background function dies at fifteen minutes with nothing written, and
 * thinking made every stage slower. So: the stage the run is in goes on the
 * record and onto the button ("Generating… 655s · Pricing the work"), and
 * the optional stages give way when the clock is short - market research
 * under seven minutes left, the repair pass under four, the written scope
 * under two - so a priced estimate arrives on time.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'), 'utf8');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
function ext(src, name) {
  const s = src.search(new RegExp('(?:async )?function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = src.indexOf('{', s); j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) return src.slice(s, j + 1); } }
  throw new Error('unbalanced ' + name);
}
const between = (a, b) => SRC.slice(SRC.indexOf(a), SRC.indexOf(b));

(async () => {
  console.log('\n1. The server writes the stage it is in, in order, and clears it at the end\n');
  {
    const order = ['"Reading the job"', '"Checking current prices"', '"Pricing the work"', '"Checking the draft"', '"Looking up material prices"', '"Writing the scope of work"'];
    const idx = order.map((s) => SRC.indexOf('await markStage(' + s + ')'));
    ok('SIX STAGES, each written before its call, in the order the run makes them', idx.every((i) => i > 0) && idx.every((i, k) => k === 0 || i > idx[k - 1]), idx.join(','));
    ok('markStage puts the name and the time on the record and saves it, and a failed save is swallowed', /record\.aiStage = name;\s*record\.aiStageAt = new Date\(\)\.toISOString\(\);\s*if \(store\) \{ try \{ await store\.setJSON\(ref, record\); \} catch \(_\) \{\} \}/.test(SRC));
    ok('the stage is cleared when the run is done and when it fails', /record\.aiStatus = "done";\s*record\.aiStage = "";/.test(SRC) && /s2\.record\.aiStatus = "error";\s*s2\.record\.aiStage = "";/.test(SRC));
    ok('the reading stage is marked only when the job is actually re-read (a reused pin skips it)', between('if (pin.reuse) {', 'timing.analysisMs').indexOf('await markStage("Reading the job")') > between('if (pin.reuse) {', 'timing.analysisMs').indexOf('} else {'));
  }

  console.log('\n2. The clock: thirteen minutes, and the optional stages give way\n');
  {
    ok('the run deadline is thirteen minutes, set when the run starts', /const RUN_MS = 13 \* 60 \* 1000;/.test(SRC) && /RUN_DEADLINE = timing\.startedAt \+ RUN_MS;/.test(SRC));
    ok('MARKET RESEARCH IS SKIPPED with under seven minutes left, and says so in the timing', /const RESEARCH_MIN_MS = 7 \* 60 \* 1000/.test(SRC) && /if \(MARKET_RESEARCH_ON && anthropicKey && timeLeft\(\) < RESEARCH_MIN_MS\) \{\s*timing\.researchSkipped = "out of time: " \+ secondsUsed\(timing\) \+ " already used reading the job";/.test(SRC));
    ok('THE REPAIR PASS IS SKIPPED with under four minutes left - inside its try, so the first draft stands and the report says why', /REPAIR_MIN_MS = 4 \* 60 \* 1000/.test(SRC) && /try \{\s*\/\*[^*]*\*\/\s*if \(timeLeft\(\) < REPAIR_MIN_MS\) throw new Error\("out of time: " \+ secondsUsed\(timing\) \+ " already used; the first draft stands unrepaired"\);/.test(SRC) && /timing\.repairSkipped = String\(\(repairError && repairError\.message\) \|\| repairError\)/.test(SRC));
    ok('THE WRITTEN SCOPE IS SKIPPED with under two minutes left; the template wording stands', /SCOPE_MIN_MS = 2 \* 60 \* 1000/.test(SRC) && /if \(anthropicKey && timeLeft\(\) < SCOPE_MIN_MS\) \{\s*timing\.scopeSkipped = "out of time: "/.test(SRC));
    ok('the pricing pass itself is never skipped', !/timeLeft\(\)[^\n]*estimatePrompt/.test(SRC) && /await markStage\("Pricing the work"\);\s*const estimatePrompt = buildEstimatePrompt/.test(SRC));
    /* timeLeft with no clock is infinite, so every guard passes outside a run */
    const ctx = { Date, Infinity, RUN_DEADLINE: 0 };
    vm.createContext(ctx);
    vm.runInContext(ext(SRC, 'timeLeft'), ctx);
    ok('timeLeft(): no clock means no limit; with a clock, the milliseconds that remain', vm.runInContext('timeLeft()', ctx) === Infinity && (vm.runInContext('RUN_DEADLINE = Date.now() + 5000; timeLeft()', ctx) > 4000));
  }

  console.log('\n3. The button says the stage after the seconds\n');
  {
    const polls = [
      { aiJobId: 'ai-1', aiStatus: 'running', aiStage: 'Reading the job' },
      { aiJobId: 'ai-1', aiStatus: 'running', aiStage: 'Pricing the work' },
      { aiJobId: 'ai-1', aiStatus: 'done', aiStage: '', estimate: { labor: [{ item: 'x' }] }, status: 'drafted', customerFinalTotal: 5 },
    ];
    const labels = [];
    const btn = { disabled: false, _html: '', set innerHTML(v) { this._html = v; labels.push(v); }, get innerHTML() { return this._html; } };
    const ctx = {
      console, Date, String, Number, Math, JSON, Promise, Error, encodeURIComponent, Object, Array,
      setTimeout: (fn) => setImmediate(fn), clearTimeout: () => {},
      document: { hidden: false, addEventListener() {}, removeEventListener() {}, getElementById: (id) => (id === 'gen-btn' ? btn : null) },
      window: { addEventListener() {}, removeEventListener() {} },
      addEventListener() {}, removeEventListener() {},
      esc: (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
      fetch: async () => ({ ok: true, json: async () => polls.shift() }),
      aiJobClear() {},
    };
    vm.createContext(ctx);
    vm.runInContext(DASH.split('\n').find((l) => l.startsWith('var AI_JOB_MAX_MS')), ctx);
    ['aiPollVerdict', 'sleepUntilVisibleOr', 'watchGeneration'].forEach((n) => vm.runInContext(ext(DASH, n), ctx));
    const out = await vm.runInContext('watchGeneration("A", "ai-1", Date.now() - 655000)', ctx);
    ok('THE LABEL CARRIES THE STAGE from the second poll on: "Generating… 655s", then "· Reading the job", then "· Pricing the work"', labels.length === 3 && /Generating… 65[5-9]s$/.test(labels[0]) && /· Reading the job$/.test(labels[1]) && /· Pricing the work$/.test(labels[2]), labels.join(' || '));
    ok('...and the run still ends with the estimate', out && out.status === 'drafted' && out.customerFinalTotal === 5);
    ok('a stage from another job is ignored', /if \(rec && rec\.aiJobId === jobId && rec\.aiStatus === "running"\) stage = String\(rec\.aiStage \|\| ""\);/.test(DASH));
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
