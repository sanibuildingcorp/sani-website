/* quote-email-open.test.js — run: node js/quote-email-open.test.js
 *
 *   "This is how it's when i sent to my email, after i clicked view button
 *    it's opened inside the email not in new window, it's not tracking open,
 *    there is no print/save pdf, if i click to request then there is a
 *    print/save pdf"   - and the email said "Issued September 24", the page
 *    "Date issued September 23".
 *
 *   - Print / save as PDF has its own row under the buttons, in every state
 *     of the page, not only inside the message box.
 *   - The open ping is sent with fetch keepalive (Gmail's in-app browser can
 *     drop an Image nobody holds), the Image kept as the fallback.
 *   - The email prints New York's date, as the page does.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const Q = fs.readFileSync(path.join(ROOT, 'quote.html'), 'utf8');
const SQ = fs.readFileSync(path.join(ROOT, 'netlify/functions/send-quote.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
function ext(name) { const s = Q.search(new RegExp('function ' + name + '\\s*\\(')); if (s < 0) throw new Error('missing ' + name); let d = 0; for (let j = Q.indexOf('{', s); j < Q.length; j++) { if (Q[j] === '{') d++; else if (Q[j] === '}') { d--; if (!d) return Q.slice(s, j + 1); } } }

console.log('\n1. Print / save as PDF is always in view\n');
{
  const ctx = { E: (x) => String(x == null ? '' : x), encodeURIComponent, Date, ref: 'SBC-260806-YX1G', rec: null, messageBox: (open) => '<MSGBOX open=' + open + '>', validUntil: () => new Date(Date.now() + 86400000) };
  vm.createContext(ctx);
  vm.runInContext(ext('printRow') + ext('actionHtml'), ctx);
  const states = {
    'waiting for a go-ahead': vm.runInContext('actionHtml({name:"Zurabi"},false,false,true)', ctx),
    'contract to sign': vm.runInContext('actionHtml({name:"Zurabi"},false,true,true)', ctx),
    'already approved': vm.runInContext('actionHtml({name:"Zurabi"},true,false,true)', ctx),
    'not priced yet': vm.runInContext('actionHtml({name:"Zurabi"},false,false,false)', ctx),
  };
  ctx.rec = { sentAt: '2026-01-01T00:00:00Z' }; ctx.validUntil = () => new Date(0);
  states['expired'] = vm.runInContext('actionHtml({name:"Zurabi"},false,false,true)', ctx);
  Object.keys(states).forEach((k) => {
    const h = states[k];
    const pi = h.indexOf('class="printrow"'), mi = h.indexOf('<MSGBOX');
    ok('the print row is there, OUTSIDE the message box: ' + k, pi !== -1 && mi !== -1 && pi < mi && (h.match(/printQuote\(this\)/g) || []).length === 1, h.slice(0, 200));
  });
  ok('on the normal page it sits right under the note below the two buttons', /before anything is signed or paid\.<\/div>\$\{printRow\(\)\}<section class="card panel" id="a">/.test(Q));
  ok('the message box no longer has a second one', !/Add photos or files<input[^>]*><\/label><button[^>]*printQuote/.test(Q));
  ok('hidden on paper, like the other buttons', /\.panel,\.actions,\.printbtn,/.test(Q));
}

console.log('\n2. The open is tracked from inside the Gmail app\n');
{
  const hits = [], imgs = [];
  const mk = (withFetch, fetchFails) => {
    const ctx = { encodeURIComponent, Date, ref: 'SBC-260806-YX1G', SOW: false, sessionStorage: { getItem: () => null, removeItem() {} },
      Image: function () { const o = {}; Object.defineProperty(o, 'src', { set: (v) => imgs.push(v) }); return o; } };
    ctx.window = ctx;
    if (withFetch) ctx.fetch = (u, o) => { hits.push({ u, o }); return fetchFails ? Promise.reject(new Error('offline')) : Promise.resolve({ ok: true }); };
    vm.createContext(ctx); vm.runInContext(ext('track'), ctx); return ctx;
  };
  vm.runInContext('track()', mk(true, false));
  ok('THE PING GOES BY fetch WITH keepalive, so it is sent even as the in-app browser moves on', hits.length === 1 && /\/\.netlify\/functions\/track-quote-open\?ref=SBC-260806-YX1G&_=\d+/.test(hits[0].u) && hits[0].o.keepalive === true && hits[0].o.cache === 'no-store' && imgs.length === 0, JSON.stringify(hits));
  const c2 = mk(true, true);
  vm.runInContext('track()', c2);
  return new Promise((r) => setTimeout(r, 10)).then(() => {
    ok('...if fetch fails, the Image pixel is sent instead, and kept referenced', imgs.length === 1 && /track-quote-open\?ref=SBC-260806-YX1G/.test(imgs[0]) && !!c2.__sbcPing);
    vm.runInContext('track()', mk(false, false));
    ok('...a browser with no fetch uses the Image', imgs.length === 2);

    console.log('\n3. The email and the page print the same date\n');
    ok('THE EMAIL\'S "Issued" DATE IS NEW YORK\'S', /const issuedDate = new Date\(\)\.toLocaleDateString\("en-US", \{ month: "long", day: "numeric", year: "numeric", timeZone: "America\/New_York" \}\);/.test(SQ));
    const at = new Date('2026-09-24T01:34:00Z'); /* 9:34 pm in New York, September 23 */
    ok('...a 9:34 pm send reads September 23, as the page does', at.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }) === 'September 23, 2026');

    console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
    process.exit(fail ? 1 : 0);
  });
}
