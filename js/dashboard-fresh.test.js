/* dashboard-fresh.test.js — run: node js/dashboard-fresh.test.js
 *
 *   "Now in google browser it was shows me and was did his job. In safari
 *    still was not doing"
 *
 * Safari keeps a tab alive for days; its JavaScript is from whenever the
 * page was last fully loaded. A fix goes live and the phone keeps running
 * the old dashboard. The shell now remembers the ETag of the dashboard it
 * loaded and, whenever the tab comes back to the front, asks the server
 * (no cache) whether it still stands; when it does not, the page reloads
 * itself. At most one check a minute.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, 'dashboard-shell.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

function run(opts) {
  const script = SHELL.match(/<script>([\s\S]*?)<\/script>/)[1];
  const calls = { fetches: [], reloads: 0, listeners: {} };
  const tags = opts.tags.slice();
  const ctx = {
    console: { error() {} }, String, Date, Promise, Error, JSON,
    location: { reload() { calls.reloads++; } },
    document: { hidden: false, body: { innerHTML: '' }, open() {}, write() {}, close() {}, addEventListener(t, f) { (calls.listeners[t] = calls.listeners[t] || []).push(f); } },
    fetch(url, o) {
      calls.fetches.push({ url, method: (o && o.method) || 'GET', cache: o && o.cache });
      const tag = tags.length > 1 ? tags.shift() : tags[0];
      return Promise.resolve({ ok: true, headers: { get: (h) => (h === 'etag' ? tag : null) }, text: async () => '<html><body>page</body></html>' });
    },
  };
  ctx.window = ctx; ctx.window.addEventListener = (t, f) => { (calls.listeners[t] = calls.listeners[t] || []).push(f); };
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  return { ctx, calls };
}

(async () => {
  console.log('\nthe shell reloads itself when a newer dashboard is deployed\n');
  {
    const h = run({ tags: ['"v1"', '"v1"', '"v2"'] });
    await new Promise((r) => setTimeout(r, 10));
    ok('THE PAGE IS FETCHED WITHOUT CACHE and its ETag remembered; the listeners go on after the real page is written in', h.calls.fetches.length === 1 && /\/dashboard\.html\?core=5$/.test(h.calls.fetches[0].url) && h.calls.fetches[0].cache === 'no-store' && (h.calls.listeners.visibilitychange || []).length === 1 && (h.calls.listeners.pageshow || []).length === 1 && (h.calls.listeners.focus || []).length === 1, JSON.stringify(h.calls));
    /* the minute: a check right after the load is skipped */
    let changed = await h.ctx.window.sbcFreshCheck();
    ok('a check within a minute of the load asks nothing', changed === false && h.calls.fetches.length === 1);
    /* a minute later: same tag -> nothing */
    h.ctx.Date.now = (() => { const real = Date.now; let off = 61000; return () => real() + off; })();
    changed = await h.ctx.window.sbcFreshCheck();
    ok('A MINUTE LATER THE TAB COMES BACK: a HEAD request, no cache; the same ETag means no reload', changed === false && h.calls.fetches.length === 2 && h.calls.fetches[1].method === 'HEAD' && h.calls.fetches[1].cache === 'no-store' && h.calls.reloads === 0);
    h.ctx.Date.now = (() => { const real = Date.now; return () => real() + 130000; })();
    changed = await h.ctx.window.sbcFreshCheck();
    ok('A NEW ETAG: the page reloads itself', changed === true && h.calls.reloads === 1, h.calls.reloads + '');
    h.ctx.document.hidden = true;
    h.ctx.Date.now = (() => { const real = Date.now; return () => real() + 260000; })();
    ok('a hidden tab is not checked', (await h.ctx.window.sbcFreshCheck()) === false && h.calls.fetches.length === 3);
  }
  {
    const h = run({ tags: ['"v1"'] });
    await new Promise((r) => setTimeout(r, 10));
    h.ctx.fetch = () => Promise.reject(new Error('offline'));
    h.ctx.Date.now = (() => { const real = Date.now; return () => real() + 61000; })();
    ok('offline: the check fails quietly, no reload', (await h.ctx.window.sbcFreshCheck()) === false && h.calls.reloads === 0);
  }
  ok('the dashboard HTML itself is served with must-revalidate and the shell with no-store', /for = "\/\*\.html"\s*\[headers\.values\]\s*Cache-Control = "public, max-age=0, must-revalidate"/.test(fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8')) && /for = "\/dashboard-shell\.html"\s*\[headers\.values\]\s*Cache-Control = "no-store, max-age=0"/.test(fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8')));
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
