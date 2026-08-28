/* dashboard-auth.test.js — run: node js/dashboard-auth.test.js */
/* js/dashboard-auth.js — executed with stubbed storage and fetch.
   The key plumbing is what makes the gates usable instead of a lockout, so it
   gets the same treatment as the server side. */
const fs = require('fs'), vm = require('vm');
const SRC = fs.readFileSync(require('path').join(__dirname, 'dashboard-auth.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? pass++ : fail++; console.log((c ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

function mkStore() {
  const m = {};
  return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); },
           removeItem: k => { delete m[k]; }, _m: m };
}

function ctx(opts) {
  opts = opts || {};
  const c = {
    console, JSON, Object, String, Boolean, Number, Array,
    localStorage: mkStore(), sessionStorage: mkStore(),
    _calls: [],
    fetch: (url, init) => {
      c._calls.push({ url, init });
      if (opts.status === 'throw') return Promise.reject(new Error('network'));
      const status = opts.status || 200;
      return Promise.resolve({
        status,
        ok: status >= 200 && status < 300,
        json: () => opts.badJson ? Promise.reject(new Error('bad')) : Promise.resolve(opts.body || {}),
      });
    },
  };
  c.window = c; c.globalThis = c;
  vm.createContext(c);
  vm.runInContext(SRC, c);
  return c;
}
const R = (c, code) => vm.runInContext(code, c);

(async () => {
  console.log('\n1. sbcKey reads both stores, hand-typed first');
  {
    const c = ctx();
    ok('empty when nothing stored', R(c, 'sbcKey()') === '');
    c.localStorage.setItem('sbcKey', 'from-local');
    ok('reads localStorage', R(c, 'sbcKey()') === 'from-local');
    const c2 = ctx();
    c2.sessionStorage.setItem('sbcKey', 'from-session');
    ok('falls back to sessionStorage', R(c2, 'sbcKey()') === 'from-session');
  }

  console.log('\n2. Login stores the key handed back by the server');
  {
    const c = ctx({ body: { ok: true, visitsKey: 'v', dashboardKey: 'server-key' } });
    const res = await R(c, 'sbcVerifyPassword("pw")');
    ok('login succeeds', res.ok === true, JSON.stringify(res));
    ok('the write key is now available to every page', R(c, 'sbcKey()') === 'server-key', R(c, 'sbcKey()'));
    ok('the visits key still works as before', c.sessionStorage.getItem('sbc-visits-key') === 'v');
    ok('the auth flag is set', c.sessionStorage.getItem('sbc-auth') === '1');
  }

  console.log('\n3. A hand-typed key is never overwritten by login');
  {
    const c = ctx({ body: { ok: true, dashboardKey: 'server-key' } });
    c.localStorage.setItem('sbcKey', 'typed-by-hand');
    await R(c, 'sbcVerifyPassword("pw")');
    ok('the owner\'s own key wins', R(c, 'sbcKey()') === 'typed-by-hand', R(c, 'sbcKey()'));
  }

  console.log('\n4. Old server that does not send dashboardKey');
  {
    const c = ctx({ body: { ok: true, visitsKey: 'v' } });
    const res = await R(c, 'sbcVerifyPassword("pw")');
    ok('login still succeeds, does not throw', res.ok === true, JSON.stringify(res));
    ok('and no bogus key is stored', R(c, 'sbcKey()') === '', R(c, 'sbcKey()'));
  }

  console.log('\n5. sbcFetch always attaches the key');
  {
    const c = ctx();
    c.localStorage.setItem('sbcKey', 'K');
    await R(c, 'sbcFetch("/x", { method: "POST", body: "{}" })');
    const call = c._calls[0];
    ok('x-sbc-key is attached', call.init.headers['x-sbc-key'] === 'K', JSON.stringify(call.init.headers));
    ok('Content-Type defaulted for a body', call.init.headers['Content-Type'] === 'application/json',
       JSON.stringify(call.init.headers));
  }
  {
    const c = ctx();
    c.localStorage.setItem('sbcKey', 'K');
    await R(c, 'sbcFetch("/x", { method: "POST", headers: { "Content-Type": "text/plain", "X-Other": "1" }, body: "hi" })');
    const h = c._calls[0].init.headers;
    ok('caller headers are preserved', h['X-Other'] === '1' && h['Content-Type'] === 'text/plain', JSON.stringify(h));
    ok('and the key is still added', h['x-sbc-key'] === 'K');
  }
  {
    const c = ctx();
    c.localStorage.setItem('sbcKey', 'K');
    await R(c, 'sbcFetch("/x")');   // no options at all — the list-estimates shape
    ok('works with no options argument', c._calls[0].init.headers['x-sbc-key'] === 'K',
       JSON.stringify(c._calls[0].init));
  }

  console.log('\n6. A 401 clears the stale key');
  {
    const c = ctx({ status: 401 });
    c.localStorage.setItem('sbcKey', 'stale');
    const r = await R(c, 'sbcFetch("/x", { method: "POST", body: "{}" })');
    ok('the 401 is passed through to the caller', r.status === 401, String(r.status));
    ok('the stale key is dropped', R(c, 'sbcKey()') === '', R(c, 'sbcKey()'));
  }

  console.log('\n7. Storage that throws (Safari private mode) must not break the page');
  {
    const c = ctx();
    const boom = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); },
                   removeItem() { throw new Error('denied'); } };
    c.localStorage = boom; c.sessionStorage = boom;
    let threw = null;
    try { ok('sbcKey returns "" instead of throwing', R(c, 'sbcKey()') === ''); }
    catch (e) { threw = e; ok('sbcKey returns "" instead of throwing', false, e.message); }
    try { await R(c, 'sbcFetch("/x")'); ok('sbcFetch still issues the request', c._calls.length === 1); }
    catch (e) { ok('sbcFetch still issues the request', false, e.message); }
    try { R(c, 'sbcLogout()'); ok('sbcLogout does not throw', true); }
    catch (e) { ok('sbcLogout does not throw', false, e.message); }
  }

  console.log('\n8. Logout clears the write key too');
  {
    const c = ctx({ body: { ok: true, dashboardKey: 'server-key' } });
    await R(c, 'sbcVerifyPassword("pw")');
    R(c, 'sbcLogout()');
    ok('the key does not survive logout', R(c, 'sbcKey()') === '', R(c, 'sbcKey()'));
    ok('and neither does the auth flag', R(c, 'sbcIsAuthed()') === false);
  }

  console.log('\n──────────────────────────────');
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  console.log('──────────────────────────────');
})();
