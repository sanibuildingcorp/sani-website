/* generation-resume.test.js — run: node js/generation-resume.test.js
 *
 * THE COMPLAINT.
 *
 *   "in the process of generating if i fold browser or phone the generator stops
 *    and do not keeps continuously, because of it's takes longer i can't keep
 *    open till it's finish"
 *
 * The generator never stopped. generate-estimate-background is a Netlify
 * BACKGROUND function — the browser's whole part in it is a POST that returns 202
 * in 200ms, after which the estimator runs on Netlify's side for up to fifteen
 * minutes with nothing attached to it. A locked phone cannot reach that.
 *
 * What a locked phone kills is the WATCHING, and the old watcher was a bare
 * `for (i < 160) { setTimeout(3000) }` loop living in the page. A backgrounded
 * mobile tab has its timers frozen and is then discarded outright, taking the
 * loop, the jobId and any knowledge that a run existed with it. The estimate
 * finished, into silence. The contractor pressed Generate again and paid for a
 * second run of a job that was already done.
 *
 * So these tests are about the run outliving the page: a note on disk, a
 * wall-clock deadline, and a poll that happens on the unlock rather than whenever
 * a frozen timer gets round to it.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* Keeps a leading `async` — slicing from `function` alone turns an async
   declaration into a syntax error the moment it contains an await. */
function ext(name) {
  const s = HTML.search(new RegExp('(async )?function ' + name + '\\('));
  if (s < 0) throw new Error('missing ' + name);
  let d = 0;
  for (let j = HTML.indexOf('{', s); j < HTML.length; j++) {
    if (HTML[j] === '{') d++;
    else if (HTML[j] === '}') { d--; if (!d) return HTML.slice(s, j + 1); }
  }
}
function extVar(name) {
  const m = HTML.match(new RegExp('var ' + name + ' = [^;]+;'));
  if (!m) throw new Error('missing var ' + name);
  return m[0];
}

/* A browser small enough to see through. setTimeout is a queue the test drives
   by hand, so "the phone was asleep for four minutes" is expressible. */
function mkctx(opts) {
  opts = opts || {};
  const ctx = {
    console, String, Number, Array, Object, Boolean, Math, JSON, Date, Promise,
    Error, encodeURIComponent, isNaN,
  };
  ctx.window = ctx; ctx.globalThis = ctx;

  const cell = { data: {}, throws: !!opts.storageThrows };
  ctx.localStorage = {
    getItem: function (k) {
      if (cell.throws) throw new Error('SecurityError: private mode');
      return Object.prototype.hasOwnProperty.call(cell.data, k) ? cell.data[k] : null;
    },
    setItem: function (k, v) {
      if (cell.throws) throw new Error('SecurityError: private mode');
      cell.data[k] = String(v);
    },
  };

  const timers = [];
  ctx.setTimeout = function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; };

  const listeners = { document: {}, window: {} };
  function on(bag) {
    return function (type, fn) { (bag[type] = bag[type] || []).push(fn); };
  }
  function off(bag) {
    return function (type, fn) { bag[type] = (bag[type] || []).filter(function (f) { return f !== fn; }); };
  }
  ctx.document = {
    hidden: false,
    addEventListener: on(listeners.document),
    removeEventListener: off(listeners.document),
    getElementById: function (id) { return (opts.elements || {})[id] || null; },
  };
  ctx.addEventListener = on(listeners.window);
  ctx.removeEventListener = off(listeners.window);

  ctx.fetch = opts.fetch || function () { return Promise.reject(new Error('no fetch stub')); };

  vm.createContext(ctx);
  [extVar('AI_JOB_KEY'), extVar('AI_JOB_MAX_MS')].forEach(function (s) { vm.runInContext(s, ctx); });
  ['aiJobsRead', 'aiJobsWrite', 'aiJobsPrune', 'aiJobStart', 'aiJobClear', 'aiJobFor',
    'aiPollVerdict', 'sleepUntilVisibleOr', 'watchGeneration'].forEach(function (n) {
    vm.runInContext(ext(n), ctx);
  });

  return {
    ctx: ctx,
    cell: cell,
    run: function (expr) { return vm.runInContext(expr, ctx); },
    call: function (fn) { return vm.runInContext('(' + fn + ')', ctx); },
    /* Fire every timer currently queued, repeatedly, letting promises settle in
       between — the awaits inside watchGeneration each need a turn. */
    flush: async function (rounds) {
      for (let i = 0; i < (rounds || 60); i++) {
        const due = timers.splice(0, timers.length);
        due.forEach(function (t) { t.fn(); });
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      }
    },
    pending: function () { return timers.length; },
    fire: function (target, type) {
      (listeners[target][type] || []).slice().forEach(function (f) { f(); });
    },
    count: function (target, type) { return (listeners[target][type] || []).length; },
  };
}

const MAX = 15 * 60 * 1000;

(async function () {
console.log('\na generation that outlives the page\n');

/* ── THE NOTE ON DISK ───────────────────────────────────────────────────────
   Without this there is simply no way back to a run: the page is gone and the
   jobId went with it. */
console.log('the note that survives the page being thrown away\n');
{
  const h = mkctx();
  h.run('aiJobStart("SBC-260829-QW6E", "ai-abc", 1000)');
  const j = h.run('JSON.stringify(aiJobFor("SBC-260829-QW6E", 2000))');
  ok('a started run is written down', JSON.parse(j).jobId === 'ai-abc');
  ok('...with the clock time it started at', JSON.parse(j).startedAt === 1000);
  ok('...and it is really in localStorage, not just in memory',
    (h.cell.data.sbcAiJobs || '').indexOf('ai-abc') !== -1, h.cell.data.sbcAiJobs);
  ok('an unknown ref has nothing', h.run('aiJobFor("SBC-NOPE", 2000)') === null);
}
{
  /* Real wall-clock times here: aiJobClear prunes against Date.now(), so a
     fixture dated 1970 would be swept away before the clear proved anything. */
  const h = mkctx();
  h.run('aiJobStart("A", "ai-1", Date.now()); aiJobStart("B", "ai-2", Date.now())');
  ok('starting a run on a second estimate does not lose the first',
    h.run('aiJobFor("A").jobId') === 'ai-1' && h.run('aiJobFor("B").jobId') === 'ai-2');
  h.run('aiJobClear("A")');
  ok('clearing one leaves the other', h.run('aiJobFor("A")') === null && h.run('aiJobFor("B").jobId') === 'ai-2');
}
{
  const h = mkctx();
  h.run('aiJobStart("A", "ai-1", 0)');
  ok('a run older than the deadline is not picked back up', h.run('aiJobFor("A", ' + (MAX + 1) + ')') === null);
  ok('...and one inside it still is', h.run('aiJobStart("A","ai-1",0); !!aiJobFor("A", ' + (MAX - 1000) + ')') === true);
  h.run('aiJobFor("A", ' + (MAX + 1) + ')');
  ok('...and the expired note is swept up rather than kept forever',
    (h.cell.data.sbcAiJobs || '{}').indexOf('ai-1') === -1, h.cell.data.sbcAiJobs);
}
{
  const h = mkctx();
  h.cell.data.sbcAiJobs = 'not json at all {{{';
  ok('corrupt storage reads as empty instead of throwing', h.run('JSON.stringify(aiJobsRead())') === '{}');
  h.cell.data.sbcAiJobs = '["an","array"]';
  ok('...and so does the wrong shape', h.run('JSON.stringify(aiJobsRead())') === '{}');
}
{
  /* Safari private mode throws on every localStorage call. A generation must not
     fail because of where it was being watched from — the cost is the automatic
     reconnect, never the estimate. */
  const h = mkctx({ storageThrows: true });
  let threw = '';
  try { h.run('aiJobStart("A","ai-1",1000); aiJobClear("A"); aiJobFor("A")'); } catch (e) { threw = e.message; }
  ok('storage that throws outright does not break a generation', threw === '', threw);
  ok('...it just has nothing to reconnect to', h.run('aiJobFor("A")') === null);
}

/* ── WHAT ONE POLL MEANS ────────────────────────────────────────────────────
   The live loop and the reconnect both ask this, so they cannot disagree about
   whether a run is finished. */
console.log('\nreading the record\n');
{
  const h = mkctx();
  const v = (rec, id, ms) => h.run('aiPollVerdict(' + JSON.stringify(rec) + ',' + JSON.stringify(id) + ',' + ms + ').state');
  const DONE = { aiJobId: 'ai-1', aiStatus: 'done', estimate: { labor: [{ item: 'x' }] } };

  ok('a finished run is finished', v(DONE, 'ai-1', 5000) === 'done');
  ok('still running means wait', v({ aiJobId: 'ai-1', aiStatus: 'running' }, 'ai-1', 5000) === 'wait');
  ok('no record yet means wait', v(null, 'ai-1', 5000) === 'wait');
  ok('done but with no priced labor is not done', v({ aiJobId: 'ai-1', aiStatus: 'done', estimate: { labor: [] } }, 'ai-1', 5000) === 'wait');
  ok('an errored run is an error', v({ aiJobId: 'ai-1', aiStatus: 'error', aiError: 'no API key' }, 'ai-1', 5000) === 'error');
  ok('...carrying the reason', h.run('aiPollVerdict({aiJobId:"ai-1",aiStatus:"error",aiError:"no API key"},"ai-1",1).message') === 'no API key');
  ok('...and a fallback when there is none', /reported an error/.test(h.run('aiPollVerdict({aiJobId:"ai-1",aiStatus:"error"},"ai-1",1).message')));

  ok('A PREVIOUS RUN\'S SUCCESS IS NOT THIS ONE\'S — it is still just wait',
    v(Object.assign({}, DONE, { aiJobId: 'ai-OLD' }), 'ai-1', 5000) === 'wait');

  ok('a wait that has run past the deadline is a timeout', v({ aiJobId: 'ai-1', aiStatus: 'running' }, 'ai-1', MAX) === 'timeout');
  ok('A RUN THAT FINISHED LATE IS STILL FINISHED — the clock does not throw it away',
    v(DONE, 'ai-1', MAX + 60000) === 'done');
  ok('...and a late error is still an error, not a timeout',
    v({ aiJobId: 'ai-1', aiStatus: 'error', aiError: 'x' }, 'ai-1', MAX + 1) === 'error');
}

/* ── WAKING UP ──────────────────────────────────────────────────────────────
   The reason a locked phone felt like a dead generator: everything hung on a
   timer the phone had frozen. */
console.log('\nwaking the page polls at once instead of waiting on a frozen timer\n');
{
  const h = mkctx();
  let done = false;
  h.ctx.mark = function () { done = true; };
  h.run('sleepUntilVisibleOr(3000).then(mark)');
  await Promise.resolve();
  ok('it does not resolve on its own', done === false);
  h.ctx.document.hidden = false;
  h.fire('document', 'visibilitychange');
  await Promise.resolve(); await Promise.resolve();
  ok('UNLOCKING THE PHONE POLLS IMMEDIATELY, without waiting out the timer', done === true);
}
{
  const h = mkctx();
  let done = false;
  h.ctx.mark = function () { done = true; };
  h.ctx.document.hidden = true;
  h.run('sleepUntilVisibleOr(3000).then(mark)');
  h.fire('document', 'visibilitychange');
  await Promise.resolve(); await Promise.resolve();
  ok('a visibility change that leaves the page STILL hidden does not wake it', done === false);
}
{
  const h = mkctx();
  let done = false;
  h.ctx.mark = function () { done = true; };
  h.run('sleepUntilVisibleOr(3000).then(mark)');
  h.fire('window', 'pageshow');
  await Promise.resolve(); await Promise.resolve();
  ok('a page restored from the back/forward cache wakes it too', done === true);
}
{
  const h = mkctx();
  let done = false;
  h.ctx.mark = function () { done = true; };
  h.run('sleepUntilVisibleOr(3000).then(mark)');
  await h.flush(1);
  ok('and the timer still works when nothing wakes it', done === true);
}
{
  const h = mkctx();
  h.run('sleepUntilVisibleOr(3000)');
  ok('it registers on visibility, pageshow and focus',
    h.count('document', 'visibilitychange') === 1 && h.count('window', 'pageshow') === 1 && h.count('window', 'focus') === 1);
  h.fire('window', 'pageshow');
  await Promise.resolve();
  ok('...and takes every one of them back off — a 15-minute run must not leak 300 listeners',
    h.count('document', 'visibilitychange') === 0 && h.count('window', 'pageshow') === 0 && h.count('window', 'focus') === 0);
}

/* ── THE WATCH ITSELF ───────────────────────────────────────────────────────── */
console.log('\nwatching a run to its end\n');

function polling(states, opts) {
  let n = 0;
  const h = mkctx(Object.assign({
    fetch: function () {
      const s = states[Math.min(n++, states.length - 1)];
      if (s === 'DOWN') return Promise.reject(new Error('network'));
      if (s === '500') return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve(s); } });
    },
  }, opts || {}));
  return h;
}
const RUNNING = { aiJobId: 'ai-1', aiStatus: 'running' };
const FINISHED = { aiJobId: 'ai-1', aiStatus: 'done', status: 'drafted', estimate: { labor: [{ item: 'Demo', total: 400 }] } };

{
  const h = polling([RUNNING, RUNNING, FINISHED]);
  h.run('aiJobStart("A","ai-1",Date.now())');
  h.ctx.out = {};
  h.run('watchGeneration("A","ai-1",Date.now()).then(function(d){out.d=d},function(e){out.e=e.message})');
  await h.flush(8);
  ok('it polls until the estimate lands', h.ctx.out.d && h.ctx.out.d.estimate.labor[0].item === 'Demo', JSON.stringify(h.ctx.out));
  ok('...and carries the status across', h.ctx.out.d && h.ctx.out.d.status === 'drafted');
  ok('...and tears up the note, so it is not resumed forever', h.run('aiJobFor("A")') === null);
}
{
  const h = polling(['DOWN', '500', RUNNING, FINISHED]);
  h.ctx.out = {};
  h.run('watchGeneration("A","ai-1",Date.now()).then(function(d){out.d=d},function(e){out.e=e.message})');
  await h.flush(10);
  ok('A DEAD NETWORK IS SURVIVED — the phone loses signal, the run does not',
    h.ctx.out.d && h.ctx.out.d.estimate.labor.length === 1, JSON.stringify(h.ctx.out));
}
{
  const stale = { aiJobId: 'ai-PREVIOUS', aiStatus: 'done', estimate: { labor: [{ item: 'the old estimate' }] } };
  const h = polling([stale, stale, FINISHED]);
  h.ctx.out = {};
  h.run('watchGeneration("A","ai-1",Date.now()).then(function(d){out.d=d},function(e){out.e=e.message})');
  await h.flush(8);
  ok('the previous estimate sitting on the record is not mistaken for this run',
    h.ctx.out.d && h.ctx.out.d.estimate.labor[0].item === 'Demo', JSON.stringify(h.ctx.out));
}
{
  const h = polling([{ aiJobId: 'ai-1', aiStatus: 'error', aiError: 'The estimator ran out of tokens' }]);
  h.run('aiJobStart("A","ai-1",Date.now())');
  h.ctx.out = {};
  h.run('watchGeneration("A","ai-1",Date.now()).then(function(d){out.d=d},function(e){out.e=e.message})');
  await h.flush(6);
  ok('a real failure is reported, in the estimator\'s own words', h.ctx.out.e === 'The estimator ran out of tokens', JSON.stringify(h.ctx.out));
  ok('...and the note is cleared, so it is not retried on every open', h.run('aiJobFor("A")') === null);
}
{
  const h = polling([RUNNING]);
  h.run('aiJobStart("A","ai-1",1)');
  h.ctx.out = {};
  /* Started fifteen minutes ago and still running. */
  h.run('watchGeneration("A","ai-1", Date.now() - ' + (MAX + 5000) + ').then(function(d){out.d=d},function(e){out.e=e.message})');
  await h.flush(6);
  ok('a run that truly never finishes gives up after 15 minutes', /15 minutes/.test(h.ctx.out.e || ''), JSON.stringify(h.ctx.out));
  ok('...pointing at the function log that would say why', /generate-estimate-background/.test(h.ctx.out.e || ''));
  ok('...and clears the note', h.run('aiJobFor("A")') === null);
}
{
  const btn = { disabled: false, innerHTML: '' };
  const h = polling([RUNNING, FINISHED], { elements: { 'gen-btn': btn } });
  h.ctx.out = {};
  h.run('watchGeneration("A","ai-1", Date.now() - 42000).then(function(d){out.d=d},function(e){out.e=e.message})');
  await h.flush(8);
  ok('the button counts real elapsed seconds, not ticks it managed to run',
    /Generating… 4[23]s/.test(btn.innerHTML) || /Generating… 4\ds/.test(btn.innerHTML), btn.innerHTML);
}
{
  /* The button is redrawn by renderEdit() while a run is in flight; holding a
     reference to the old element would silently stop updating anything. */
  const h = polling([RUNNING, RUNNING, FINISHED], { elements: {} });
  let lookups = 0;
  h.ctx.document.getElementById = function () { lookups++; return null; };
  h.ctx.out = {};
  h.run('watchGeneration("A","ai-1",Date.now()).then(function(d){out.d=d},function(e){out.e=e.message})');
  await h.flush(8);
  ok('the button is looked up fresh every tick, so a re-render does not orphan it', lookups >= 3, 'lookups=' + lookups);
  ok('...and a missing button does not stop the watch', h.ctx.out.d && !!h.ctx.out.d.estimate, JSON.stringify(h.ctx.out));
}

/* ══ THE WIRING ═══════════════════════════════════════════════════════════════
   All of the above is inert if the click and the reopen do not use it. */
console.log('\nthe dashboard actually uses it\n');
ok('the click writes the run down BEFORE settling in to wait',
  HTML.indexOf('aiJobStart(ref, jobId, startedAt)') !== -1 &&
  HTML.indexOf('aiJobStart(ref, jobId, startedAt)') < HTML.indexOf('applyGeneratedEstimate(await watchGeneration(ref, jobId, startedAt))'));
ok('the click waits via the shared watcher', /applyGeneratedEstimate\(await watchGeneration\(ref, jobId, startedAt\)\)/.test(HTML));
ok('REOPENING A RECORD PICKS UP A RUN LEFT GOING', /resumeGenerationIfRunning\(ref\);/.test(HTML));
ok('...after renderEdit, so there is a button to update',
  HTML.indexOf('renderEdit();\n    /* If a generation for this record was still running') !== -1 ||
  HTML.lastIndexOf('renderEdit();', HTML.indexOf('resumeGenerationIfRunning(ref);')) > 0);
ok('...and both paths apply the result the same way, through one function',
  (HTML.match(/applyGeneratedEstimate\(/g) || []).length >= 3);
ok('the contractor is told when it finished while they were away', /finished while you were away/.test(HTML));
ok('the old 8-minute tick-counting loop is gone', !/Timed out after 8 minutes/.test(HTML) && !/i < 160/.test(HTML));
ok('the browser now waits as long as the background function is allowed to run',
  /var AI_JOB_MAX_MS = 15 \* 60 \* 1000;/.test(HTML));
ok('the generation still starts through the background function',
  /\/\.netlify\/functions\/generate-estimate-background/.test(HTML));
ok('a resumed run still restores the contractor-owned fields',
  /CONTRACTOR_OWNED_ESTIMATE_FIELDS\.forEach/.test(ext('applyGeneratedEstimate')));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
})();
