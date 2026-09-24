/* estimate-natural.test.js — run: node js/estimate-natural.test.js
 *
 *   The free estimate form (estimate.html), from Zura's screenshots:
 *   "Fix the 4 issues" + "Restyle in the new natural look".
 *     1. two headers on step 1 (the slim bar AND the site menu);
 *     2. "4 of 5" on every follow-up question - it looked stuck;
 *     3. the old dark navy look, unlike the new bathroom page;
 *     4. small grey hint lines, hard to read on navy.
 *   Same steps, questions and fields; the request goes where it always went.
 */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const H = fs.readFileSync(path.join(ROOT, 'estimate.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'partials/estimate-natural.css'), 'utf8');

console.log('\n1. One header\n');
ok('the page opens with the site menu showing, so the slim bar is hidden', /<body class="menu-on">/.test(H) && /body\.menu-on \.topbar\{display:none!important\}/.test(CSS));
ok('...leaving step 1 hides the menu and brings the slim bar back; going back to step 1 swaps them again', /function hideSiteMenu\(\)\{[^}]*classList\.add\('hidden'\);document\.body\.classList\.remove\('menu-on'\)\}/.test(H) && /function showSiteMenu\(\)\{[^}]*classList\.remove\('hidden'\);document\.body\.classList\.add\('menu-on'\)\}/.test(H));

console.log('\n2. The counter moves through the follow-ups\n');
ok('the counter has a place for "· Question 2 of 3"', /<span id="step-num">1<\/span> of <span id="step-total">5<\/span><span id="step-sub"><\/span>/.test(H));
ok('every follow-up question moves the bar and says which one it is', /function followUpProgress\(last\)\{/.test(H) && /function renderAIQuestion\(q\)\{[\s\S]{0,2500}followUpProgress\(\);\n  const c=document\.getElementById\('ai-question-container'\)/.test(H) && /' · Question '\+i\+' of '\+n/.test(H));
ok('...the supplies screen says "Last question" with the bar nearly full', /followUpProgress\(true\);\s*const sl=document\.getElementById\('step-label'\);if\(sl\)sl\.textContent='Last One';/.test(H) && /last\?0\.92/.test(H) && /' · Last question'/.test(H));
ok('...and a normal step clears it', /const ss=document\.getElementById\('step-sub'\);if\(ss\)ss\.textContent='';/.test(H));

console.log('\n3 + 4. The natural look, readable\n');
const blk = (H.match(/<!-- ESTIMATE-NATURAL:START -->([\s\S]*?)<!-- ESTIMATE-NATURAL:END -->/) || [, ''])[1];
ok('the look is on the page once, AFTER partials/site.css and the old palette, so it wins', (H.match(/ESTIMATE-NATURAL:START/g) || []).length === 1 && H.indexOf('<!-- ESTIMATE-NATURAL:START -->') > H.indexOf('<link rel="stylesheet" href="partials/site.css">') && H.indexOf('<!-- ESTIMATE-NATURAL:START -->') < H.indexOf('</head>'));
ok('...word for word the partial (edit partials/estimate-natural.css, then copy it in)', blk.indexOf(CSS.trim()) !== -1);
ok('...with the site\'s own fonts', /family=Archivo:wdth,wght@75\.\.100,500\.\.800&family=Source\+Sans\+3/.test(blk));
ok('warm cream page, white card, dark words, a charcoal pill button', /html,html body\{background:#faf8f4!important;color:#1f1d1a!important/.test(CSS) && /\.wrap \.card\{background:#fff!important/.test(CSS) && /\.wrap \.btn-continue\{background:var\(--n-ink\)!important;color:#fff!important;border-radius:999px!important/.test(CSS));
ok('the hint lines under each question are dark grey on white at 17px', /\.wrap p\.subtitle\{color:var\(--n-soft\)!important;font-size:17px!important/.test(CSS) && /--n-soft:#57524b/.test(CSS));
ok('the strip under the card sits on the cream page, not the site\'s navy footer colour', /\.estimate-footer\{[^}]*background:transparent!important/.test(CSS));
const sizes = (CSS.match(/font-size:(\d+(?:\.\d+)?)px/g) || []).map((s) => +s.match(/[\d.]+/)[0]);
ok('no text in the look is smaller than 12px (labels), reading text 15-17px', sizes.length > 20 && sizes.every((n) => n >= 12));
ok('no red, no navy in the new rules', !/#0d1b2a|#1a2d42|#0a1628|\bred\b/i.test(CSS.replace(/\/\*[\s\S]*?\*\//g, '')));

console.log('\n5. Nothing else changed\n');
{
  const fields = (s) => (s.match(/<(input|textarea|select)[^>]*>/g) || []).map((t) => (t.match(/\b(id|name)="([^"]+)"/g) || []).join(' ')).join('\n');
  let before = null; try { const sha = cp.execSync('git log --format=%H -n 1 -S "ESTIMATE-NATURAL:START" -- estimate.html', { cwd: ROOT }).toString().trim(); before = cp.execSync('git show ' + (sha ? sha + '~1' : 'HEAD') + ':estimate.html', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch (e) {}
  ok('every field the customer fills in is the same (ids and names)', !!before && fields(before) === fields(H) && fields(H).split('\n').length >= 8);
  ok('...and the request still goes to the same place', /fetch\('\/\.netlify\/functions\/estimate-request'/.test(H));
}
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
