/* list-load-error.test.js — run: node js/list-load-error.test.js
 *
 *   [three screenshots: every count 0, "LOADING…", then "NO ESTIMATES HERE YET"]
 *   "Something went wrong"
 *
 * The list page had ONE face for two very different facts: "you have no
 * estimates" and "the request for your estimates failed". A 401 (the stored key
 * refused), a 500 (Blobs) and a 502 (Netlify killed list-estimates at ten
 * seconds) all fell through with estimates = [] and the page said, in the same
 * words it uses for a brand-new business, that there were none. He read that as
 * every estimate being gone.
 *
 * And list-estimates itself invited the 502: it read every record in series,
 * one round trip each. Thirty records, fine. A couple of hundred, past the
 * kill. Reads are independent; they now run a few at a time.
 *
 * Both halves are exercised here with the real code: loadEstimates against a
 * fake fetch, readAll against a store that records how many reads are in
 * flight at once.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');

const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

function ext(src, name) {
  const s = src.search(new RegExp('(?:async )?function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = src.indexOf('{', s); j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return src.slice(s, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

(async function () {
  /* ══ THE DASHBOARD SAYS WHAT HAPPENED ═══════════════════════════════════ */
  console.log('\na failed list is reported as a failure, not as an empty business\n');
  const host = { innerHTML: '' };
  const mk = (fetchImpl) => {
    const ctx = {
      console: { error() {} }, String, JSON, Error, Number, Promise, Array,
      estimates: ['stale'], handymanBookings: [], visits: [],
      esc: (s) => String(s == null ? '' : s),
      renderTabs() {}, renderList() { host.innerHTML = 'LIST RENDERED'; },
      document: { getElementById: () => host },
      sbcFetch: fetchImpl, fetch: async () => ({ ok: true, json: async () => ({}) }),
    };
    vm.createContext(ctx);
    vm.runInContext(ext(DASH, 'loadEstimates'), ctx);
    return ctx;
  };
  const res = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(body), text: async () => body });

  {
    const c = mk(res(401, JSON.stringify({ error: 'Bad or missing dashboard key' })));
    await vm.runInContext('loadEstimates()', c);
    ok('A 401 SHOWS AN ERROR WITH THE STATUS, not "no estimates here yet"',
      /Could not load/.test(host.innerHTML) && /HTTP 401/.test(host.innerHTML) && !/No estimates/i.test(host.innerHTML), host.innerHTML.slice(0, 160));
    ok('...and tells him what to do about it', /log in again/i.test(host.innerHTML));
    ok('...and passes the server\'s own words through', /Bad or missing dashboard key/.test(host.innerHTML));
    ok('the stale list is NOT wiped and re-rendered as empty', c.estimates[0] === 'stale' && host.innerHTML !== 'LIST RENDERED');
  }
  {
    const c = mk(res(502, '<html>Task timed out</html>'));
    await vm.runInContext('loadEstimates()', c);
    ok('a 502 (Netlify killed the function) says so and offers Retry',
      /HTTP 502/.test(host.innerHTML) && /longer than Netlify allows/i.test(host.innerHTML) && /onclick="loadEstimates\(\)"/.test(host.innerHTML), host.innerHTML.slice(0, 200));
  }
  {
    const c = mk(async () => { throw new Error('Failed to fetch'); });
    await vm.runInContext('loadEstimates()', c);
    ok('a network failure (sbcFetch rejected, caught to null) is reported as HTTP 0 with a connection hint',
      /HTTP 0/.test(host.innerHTML) && /connection/i.test(host.innerHTML), host.innerHTML.slice(0, 160));
  }
  {
    const c = mk(res(200, JSON.stringify({ estimates: [{ ref: 'A' }, { ref: 'B' }] })));
    await vm.runInContext('loadEstimates()', c);
    ok('a good response still renders the list', c.estimates.length === 2 && host.innerHTML === 'LIST RENDERED');
  }
  {
    const c = mk(res(200, JSON.stringify({ estimates: [] })));
    await vm.runInContext('loadEstimates()', c);
    ok('a genuinely empty list still renders (and only then does the empty state apply)', c.estimates.length === 0 && host.innerHTML === 'LIST RENDERED');
  }

  /* ══ LIST-ESTIMATES READS IN PARALLEL ═══════════════════════════════════ */
  console.log('\nlist-estimates reads records a few at a time, not one after another\n');
  {
    const origResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
      if (request === '@netlify/blobs') return '@netlify/blobs';
      return origResolve.call(this, request, ...rest);
    };
    require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: () => ({}) } };
    const fn = require(path.join(ROOT, 'netlify/functions/list-estimates.js'));

    let inFlight = 0, peak = 0, reads = 0;
    const store = {
      get: (k) => new Promise((resolve) => {
        inFlight++; peak = Math.max(peak, inFlight); reads++;
        setTimeout(() => { inFlight--; resolve(k === 'bad' ? null : { ref: k }); }, 5);
      }),
    };
    const keys = Array.from({ length: 40 }, (_, i) => 'K' + i).concat(['bad']);
    const t0 = Date.now();
    const out = await fn._readAll(store, keys, 12);
    const took = Date.now() - t0;
    ok('EVERY RECORD IS READ', reads === 41, reads + ' reads');
    ok('...CONCURRENTLY — more than one in flight at once', peak > 1, 'peak in flight ' + peak);
    ok('...but never more than the cap', peak <= 12, 'peak in flight ' + peak);
    ok('forty-one 5ms reads finish far faster than 41 × 5ms in series', took < 100, took + 'ms');
    ok('a null record is dropped, the rest kept, order preserved',
      out.length === 40 && out[0].ref === 'K0' && out[39].ref === 'K39');

    const failing = { get: (k) => k === 'K3' ? Promise.reject(new Error('boom')) : Promise.resolve({ ref: k }) };
    const out2 = await fn._readAll(failing, ['K1', 'K2', 'K3', 'K4'], 2);
    ok('one failing read does not sink the list — the other three come back', out2.length === 3 && !out2.some(r => r.ref === 'K3'));

    const SRC = fs.readFileSync(path.join(ROOT, 'netlify/functions/list-estimates.js'), 'utf8');
    ok('the handler uses it', /await readAll\(store, blobs\.map\(\(b\) => b\.key\), READ_CONCURRENCY\)/.test(SRC));
    ok('the series loop is gone', !/for \(const blob of blobs\)/.test(SRC));
    ok('it is still gated', /requireDashboardKey\(event/.test(SRC));
  }

  /* ══ THE ORPHANED DRAWER FRAGMENT ═══════════════════════════════════════ */
  console.log('\nthe stray "Dashboard / Customer Form / Refresh Data / Logout" block is gone from the page bottom\n');
  {
    const code = DASH.replace(/<!--[\s\S]*?-->/g, '');
    ok('no orphaned drawer-footer markup', code.indexOf('class="drawer-footer"') === -1 && code.indexOf('Refresh Data') === -1);
    ok('no orphaned "Dashboard" sub-label', code.indexOf('class="drawer-sub"') === -1);
    ok('the real drawer (with the menu buttons) is still there',
      /<div id="sbc-drawer"/.test(DASH) && /id="menu-send-link"/.test(DASH) && /id="menu-new-invoice"/.test(DASH));
  }

  console.log('\nevery script block in dashboard.html still parses\n');
  {
    const blocks = DASH.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    let broken = null;
    blocks.forEach(function (b, i) {
      try { new vm.Script(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); }
      catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; }
    });
    ok('all ' + blocks.length + ' blocks parse', broken === null, broken || '');
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e));
  console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed\n');
  process.exit(1);
});
