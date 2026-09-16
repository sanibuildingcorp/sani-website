/* visits-calendar.test.js — run: node js/visits-calendar.test.js
 *
 *   "i need your help for plane booking or on site visits calendar with
 *    notifications"
 *
 * The site-visit planner was already built: a form, Today / Tomorrow /
 * Upcoming groups, a one-tap Google Calendar link, done and delete. And no
 * way to reach it. renderList() dispatched on activeTab === "visits", but
 * "visits" was in neither tab list, so no button ever set it. This file
 * proves the tab is in both menus and lands on the real screen, that the
 * endpoint behind it is gated and the page sends the key, and that the
 * reminder cron is declared where Netlify reads it.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const VISITS_FN = fs.readFileSync(path.join(ROOT, 'netlify/functions/visits.js'), 'utf8');
const TOML = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* Evaluate an array literal out of the page, so the check is on what the
   browser will actually hold and not on a regex over the text. */
function arr(prefix) {
  const s = HTML.indexOf(prefix);
  if (s < 0) throw new Error('missing ' + prefix);
  const e = HTML.indexOf('];', s);
  return vm.runInNewContext('(' + HTML.slice(s + prefix.length, e + 1).replace(/^\s*=\s*/, '') + ')');
}

/* ══ THE TAB IS IN BOTH MENUS ═════════════════════════════════════════════ */
console.log('\nthe Visits tab can be reached\n');
const TABS = arr('const TABS =');
const SBC = arr('var SBC_TABS =');
ok('VISITS IS IN THE DESKTOP TAB ROW', TABS.some(t => t && t.id === 'visits'), TABS.map(t => t.id).join(','));
ok('VISITS IS IN THE ☰ MENU', SBC.some(t => t && t.id === 'visits'), SBC.filter(Boolean).map(t => t.id).join(','));
ok('both spell the id the dispatcher checks for', /if \(activeTab === "visits"\) \{\s*renderVisitsTab\(\);\s*return;/.test(HTML));
ok('...and renderVisitsTab is still the real screen, with the form and the groups',
  /function renderVisitsTab\(\)\{/.test(HTML) && /Schedule a site visit/.test(HTML) && /group\("→ Tomorrow"/.test(HTML));
ok('the ☰ menu already counts open visits for the badge', /counts\.visits = visits\.filter\(function\(v\)\{ return !v\.done; \}\)\.length;/.test(HTML));
ok('it sits next to Handyman, before Customers, in both',
  TABS.findIndex(t => t.id === 'visits') === TABS.findIndex(t => t.id === 'handyman') + 1 &&
  SBC.findIndex(t => t && t.id === 'visits') === SBC.findIndex(t => t && t.id === 'handyman') + 1);
ok('the one-tap Google Calendar link is still on every visit card', /href="'\+gcalLink\(v\)\+'"/.test(HTML) && /function gcalLink\(v\)\{/.test(HTML));

/* ══ THE ENDPOINT IS GATED AND THE PAGE SENDS THE KEY ═════════════════════ */
console.log('\nvisits.js is contractor-only, and the dashboard knows it\n');
ok('VISITS.JS CALLS THE ONE GATE', /require\("\.\/lib\/require-dashboard-key"\)/.test(VISITS_FN) && /const denied = requireDashboardKey\(event, cors\(\)\);\s*if \(denied\) return denied;/.test(VISITS_FN));
ok('...before the store is opened', VISITS_FN.indexOf('requireDashboardKey(event') < VISITS_FN.indexOf('const s = store();'));
ok('...and answers OPTIONS without a key, so the browser preflight passes', /httpMethod === "OPTIONS"/.test(VISITS_FN));
const calls = HTML.match(/(?:sbcFetch|fetch)\("\/\.netlify\/functions\/visits"/g) || [];
ok('THE PAGE TALKS TO IT FOUR TIMES: load, create, done, delete', calls.length === 4, calls.length + ' calls');
ok('...EVERY ONE THROUGH sbcFetch — a bare fetch would 401 in front of him', calls.every(c => c.indexOf('sbcFetch') === 0), calls.join('\n        '));
ok('sbcFetch is the helper that attaches x-sbc-key', /headers\["x-sbc-key"\] = sbcKey\(\);/.test(fs.readFileSync(path.join(ROOT, 'js/dashboard-auth.js'), 'utf8')));

/* ══ THE REMINDER IS SCHEDULED ════════════════════════════════════════════ */
console.log('\nthe reminder email runs on a schedule Netlify can see\n');
ok('THE CRON IS DECLARED IN netlify.toml', /\[functions\."visit-reminders"\]\s*\n\s*schedule = "0 11,22 \* \* \*"/.test(TOML));
ok('...for a function that exists', fs.existsSync(path.join(ROOT, 'netlify/functions/visit-reminders.js')));
ok('...and .github/workflows stays empty - no cron sneaks in there',
  !fs.existsSync(path.join(ROOT, '.github/workflows')) || fs.readdirSync(path.join(ROOT, '.github/workflows')).length === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
