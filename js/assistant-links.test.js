/* assistant-links.test.js — run: node js/assistant-links.test.js
 *
 *   "Yes make links tappable"
 *
 * The search answers end with "Sources:" and a list of URLs. They were
 * plain text. Now every http(s) URL in an ASSISTANT bubble is a link that
 * opens in a new tab. The one thing that would hurt: markup from the text
 * reaching the page. So the text is escaped first, and only URLs become <a>.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const DASH = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
function ext(name) {
  const s = DASH.search(new RegExp('function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = DASH.indexOf('{', s); j < DASH.length; j++) { if (DASH[j] === '{') d++; else if (DASH[j] === '}') { d--; if (!d) return DASH.slice(s, j + 1); } }
  throw new Error('unbalanced ' + name);
}
const ctx = { String, RegExp };
vm.createContext(ctx);
vm.runInContext(ext('esc') + '\n' + ext('aiLinkify'), ctx);
const L = (t) => vm.runInContext('aiLinkify(' + JSON.stringify(t) + ')', ctx);

console.log('\nURLs in an answer become links\n');
ok('A URL BECOMES A LINK that opens in a new tab', L('see https://www.homedepot.com/p/123 for it') === 'see <a href="https://www.homedepot.com/p/123" target="_blank" rel="noopener">https://www.homedepot.com/p/123</a> for it', L('see https://www.homedepot.com/p/123 for it'));
ok('a trailing period is not part of the link', /<a href="https:\/\/x\.com"[^>]*>https:\/\/x\.com<\/a>\./.test(L('Go to https://x.com.')), L('Go to https://x.com.'));
ok('a closing bracket is not part of the link', /<\/a>\)/.test(L('(https://x.com/a)')), L('(https://x.com/a)'));
ok('the Sources list gives one link per line', (L('Sources:\nhttps://a.com/1\nhttps://b.com/2').match(/<a /g) || []).length === 2);
ok('MARKUP IN THE TEXT IS ESCAPED, NOT RENDERED', L('<img src=x onerror=alert(1)> https://ok.com') === '&lt;img src=x onerror=alert(1)&gt; <a href="https://ok.com" target="_blank" rel="noopener">https://ok.com</a>');
ok('a fake link in the text is escaped too', L('<a href="javascript:alert(1)">click</a>').indexOf('<a ') === -1);
ok('an & in a URL stays a working href', /href="https:\/\/x\.com\/\?a=1&amp;b=2"/.test(L('https://x.com/?a=1&b=2')));
ok('plain text is untouched', L('no links here') === 'no links here');

console.log('\nboth bubbles use it, for the assistant side only\n');
ok('the drawer bubble', /\(mine \? esc\(m\.text\) : aiLinkify\(m\.text\)\)/.test(ext('aiBubble')));
ok('the record panel bubble', /\(mine \? esc\(m\.text\) : aiLinkify\(m\.text\)\)/.test(ext('askBubble')));
ok('links are styled so they look tappable', /\.ask-body a\{color:var\(--gold\);text-decoration:underline/.test(DASH));
const blocks = DASH.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
let broken = null;
blocks.forEach(function (b, i) { try { new vm.Script(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; } });
ok('all ' + blocks.length + ' script blocks parse', broken === null, broken || '');

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
