/* sent-stamp.test.js — run: node js/sent-stamp.test.js
 *
 *   "In sent status i need replace it with sent and date and time, so with
 *    it i can see which day i sent and how long i waiting for"
 *
 * The SENT (and OPENED) badge on a list card carries when it went out, in
 * New York time, and how many days since.
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
const ctx = { Date, String, Math };
vm.createContext(ctx);
vm.runInContext(ext('sentStamp'), ctx);
const NOW = Date.parse('2026-09-21T16:00:00Z');
const stamp = (sentAt) => vm.runInContext('sentStamp(' + JSON.stringify({ sentAt }) + ', ' + NOW + ')', ctx);

ok('sent Aug 24 at 2:10 PM New York, read on Sep 21 noon: the day, the time, and 27 whole days waiting', stamp('2026-08-24T18:10:00Z') === 'Aug 24, 2:10 PM · 27 days waiting' && stamp('2026-08-24T10:00:00Z') === 'Aug 24, 6:00 AM · 28 days waiting', stamp('2026-08-24T18:10:00Z'));
ok('sent yesterday: 1 day waiting; sent today: today', stamp('2026-09-20T13:00:00Z') === 'Sep 20, 9:00 AM · 1 day waiting' && stamp('2026-09-21T13:00:00Z') === 'Sep 21, 9:00 AM · today', stamp('2026-09-20T13:00:00Z') + ' | ' + stamp('2026-09-21T13:00:00Z'));
ok('no sent date: nothing added', stamp('') === '' && vm.runInContext('sentStamp(null)', ctx) === '');
ok('THE CARD BADGE carries it for sent and opened only, escaped, after the status', /\(\/\^\(sent\|opened\)\$\/\.test\(String\(e\.status\)\) && sentStamp\(e\) \? ' · ' \+ esc\(sentStamp\(e\)\) : ''\) \+ '<\/span>'/.test(DASH));
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
