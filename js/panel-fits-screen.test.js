/* panel-fits-screen.test.js — run: node js/panel-fits-screen.test.js
 *
 *   "Make it in screen with" - on the iPhone the job panel showed its right
 *   half only, cut on the left, with the list behind it on the right.
 *
 * Two ways that happens, both closed here:
 *   1. Safari zooms in when a text box under 16px is tapped, and stays zoomed.
 *      maximum-scale=1 stops the automatic zoom (pinch-zoom by hand still works
 *      on the iPhone).
 *   2. Anything inside the panel wider than the screen made the whole panel
 *      scroll sideways. The panel now clips sideways overflow, long words and
 *      links wrap, and the phone page never scrolls sideways.
 * Measured in a browser: a 700px block added to the panel left nothing to
 * scroll (scrollWidth = the screen, 390) and a long link wrapped inside it.
 */
const fs = require('fs'), path = require('path');
const DASH = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n); };

ok('NO AUTOMATIC ZOOM WHEN A TEXT BOX IS TAPPED (maximum-scale=1), once', (DASH.match(/<meta name="viewport"/g) || []).length === 1 && /<meta name="viewport" content="width=device-width, initial-scale=1\.0, maximum-scale=1\.0">/.test(DASH));
ok('...never user-scalable=no: he can still pinch-zoom', !/user-scalable\s*=\s*no/i.test(DASH));
ok('THE JOB PANEL NEVER SLIDES SIDEWAYS: its backdrop does not scroll sideways', /\.modal-backdrop \{ overflow-x: hidden; overscroll-behavior-x: none; \}/.test(DASH));
ok('...the panel clips what is wider than it, instead of growing', /\.modal-card \{ max-width: min\(1000px, 100%\); overflow-wrap: anywhere; overflow-x: clip; \}/.test(DASH));
ok('...long words and links wrap; pictures, tables and boxes stay inside it', /overflow-wrap: anywhere/.test(DASH) && /\.modal-card :where\(img, video, canvas, iframe, table, pre, textarea, input, select\) \{ max-width: 100%; \}/.test(DASH));
{
  const phone = DASH.slice(DASH.indexOf('@media (max-width: 640px) {', 2000));
  ok('...and on a phone the page itself never scrolls sideways', /\/\* Edit modal — full screen on mobile \*\/\n  \.modal-backdrop \{ padding: 0; \}\n  html, body \{ overflow-x: hidden; \}/.test(phone));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
