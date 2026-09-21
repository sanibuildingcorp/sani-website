/* open-edit-patience.test.js — run: node js/open-edit-patience.test.js
 *
 *   [screenshot: "LOADING…", and nothing else, for minutes]
 *
 * Opening an estimate fetched the record with no timeout: on a weak signal
 * the request can sit with no answer for minutes and the card said
 * "Loading…" for as long. Now: twenty seconds, then one more try, then the
 * card with Retry saying what happened. A 5xx on the first try is tried once
 * more too.
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

function harness(script) {
  /* script: a list of behaviours, one per fetch: 'hang' | 'ok' | 502 */
  const calls = [], card = { innerHTML: '' };
  const ctx = {
    console, String, Number, Math, Date, JSON, Error, Promise, Object, Array, encodeURIComponent, setTimeout, clearTimeout, AbortController,
    OPEN_TIMEOUT_MS: 40,
    document: { getElementById: (id) => (id === 'edit-card' ? card : { classList: { add() {} } }), body: { style: {} } },
    esc: (s) => String(s), normalizeDisplayFlags() {}, renderEdit() { calls.push('rendered'); }, resumeGenerationIfRunning() {}, askLoadHistory() {},
    currentRecord: null,
    fetch: (url, opts) => new Promise((resolve, reject) => {
      const b = script.shift();
      calls.push(b === 'hang' ? 'hang' : b === 'ok' ? 'ok' : 'status ' + b);
      if (b === 'hang') { opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }); return; }
      if (b === 'ok') return resolve({ ok: true, status: 200, json: async () => ({ ref: 'A', estimate: { labor: [] } }) });
      resolve({ ok: false, status: b, json: async () => ({}) });
    }),
  };
  vm.createContext(ctx);
  ['fetchRecordWithPatience', 'openEdit'].forEach((n) => vm.runInContext(ext(n), ctx));
  return { ctx, calls, card, run: () => vm.runInContext('openEdit("A")', ctx) };
}

(async () => {
  console.log('\nopening an estimate no longer waits forever\n');
  {
    const h = harness(['hang', 'ok']);
    await h.run();
    ok('THE FIRST FETCH HANGS: it is given up after the timeout and tried once more, and the record opens', h.calls.join(',') === 'hang,ok,rendered' && h.ctx.currentRecord && h.ctx.currentRecord.ref === 'A', h.calls.join(','));
  }
  {
    const h = harness(['hang', 'hang']);
    await h.run();
    ok('TWO HANGS: the card says no answer came, names the seconds, and offers Retry', h.calls.join(',') === 'hang,hang' && /No answer in 0 seconds - weak signal\?/.test(h.card.innerHTML) && /↻ Retry/.test(h.card.innerHTML) && /openEdit\('A'\)/.test(h.card.innerHTML), h.card.innerHTML.slice(0, 200));
  }
  {
    const h = harness([502, 'ok']);
    await h.run();
    ok('a 502 on the first try (a function killed at ten seconds) is tried once more', h.calls.join(',') === 'status 502,ok,rendered');
  }
  {
    const h = harness([404]);
    await h.run();
    ok('a 404 is not retried: the card says Load failed (404)', h.calls.join(',') === 'status 404' && /Load failed \(404\)/.test(h.card.innerHTML));
  }
  ok('the live timeout is twenty seconds', /var OPEN_TIMEOUT_MS = 20000;/.test(DASH));
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
