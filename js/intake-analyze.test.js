/* intake-analyze.test.js — run: node js/intake-analyze.test.js
 *
 *   Simplewise "Analyzing your photo ... Detecting surfaces & materials" and
 *   an emoji on each question -> "Yes 1-3-4" (4, "Other", was already there).
 *
 * While the AI plans the follow-up questions the customer sees what it is
 * doing - their photo with a scan line and a list that ticks off - instead of
 * three dots. Only real steps; the last keeps spinning until the questions are
 * back. Each question gets an emoji picked in the page, not by the AI.
 * (Checked in Chromium at 390px.)
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const H = fs.readFileSync(path.join(__dirname, '..', 'estimate.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

ok('the planning call shows the analyzing screen first', /async function planIntakeQuestions\(\)\{\s*showStep\('ai-loading'\);\s*const azDone=analyzeStart\(\);/.test(H));
ok('...and finishes it before the first question, on success and on failure', /const data=await res\.json\(\);\s*await azDone\(\);/.test(H) && /catch\(e\)\{console\.error\(e\);await azDone\(\);await loadNextAIQuestion\(\);\}/.test(H));
ok('only real steps: description, photos (only when there are some), what is missing, the questions', /var steps=\['Reading your description'\];\s*if\(photos\.length\)steps\.push/.test(H) && /'Checking what is still missing','Preparing a few questions'/.test(H));
ok('the last step is never ticked before the answer is back', /if\(i<items\.length-1\)\{i\+\+;paint\(\);\}/.test(H));
ok('the one-at-a-time fallback still shows its dots', /id="ai-loading-dots"/.test(H) && /Preparing next question\.\.\./.test(H));
ok('the photo source is escaped', /src="'\+esc\(photos\[0\]\.data\)\+'"/.test(H));
ok('"Other — let me explain" is still on every choice question', /Other — let me explain/.test(H));

const start = H.indexOf('var Q_EMOJI_WORDS'), end = H.indexOf('function renderAIQuestion');
const ctx = {}; vm.createContext(ctx); vm.runInContext(H.slice(start, end), ctx);
const e = (label, topic) => ctx.questionEmoji({ label, topic });
ok('a size question gets a ruler', e('How big is the tub surround?', 'tile') === '📏');
ok('a leak question gets a drop', e('Is it still leaking?', 'water') === '💧');
ok('a building question gets a building', e('Is there an elevator in the building?', '') === '🏢');
ok('otherwise the trade: tile, plumbing, painting', e('Which tiles go on the floor?', 'tile') === '🧱' && e('Which fixtures change?', 'plumbing') === '🔧' && e('Which rooms?', 'painting') === '🎨');
ok('nothing matched: a tools emoji, never blank', e('Anything else?', '') === '🛠️');
ok('the question is set as text (never as HTML), the emoji put in front of it', /t2\.textContent=q\.label;\s*var em=questionEmoji\(q\);\s*if\(em&&t2\.insertAdjacentHTML\)t2\.insertAdjacentHTML\('afterbegin'/.test(H));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
