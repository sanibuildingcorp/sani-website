/* bath-natural.test.js — run: node js/bath-natural.test.js
 *
 *   "I like how it's looks them site more human makes, more natural and
 *    more professional" (Re-Bath's New York page) - "Accent color i don't
 *    need red".
 *
 * ops/bath-natural.py gives /bathroom-renovation a calm, light look: the
 * photo whole in a frame with dark words on cream, pill buttons, a tab bar
 * that stays under the menu, one warm charcoal band with slanted edges.
 * Same words, same sections, no red.
 */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const H = fs.readFileSync(path.join(ROOT, 'bathroom-renovation.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'partials/bath-natural.css'), 'utf8');

ok('the look is on the page once, LAST, so it wins over the older rules', (H.match(/<style id="bath-natural">/g) || []).length === 1 && H.lastIndexOf('<style') === H.indexOf('<style id="bath-natural">') && H.indexOf('<!-- NATURAL-CSS:END -->') < H.indexOf('</body>'));
ok('...and it is the partial, word for word (edit the partial, then run ops/bath-natural.py)', H.indexOf(CSS.trim()) !== -1);
const tabs = (H.match(/<nav class="n-tabs"[\s\S]*?<\/nav>/) || [''])[0];
ok('THE TAB BAR sits right after the hero, before the stats bar', !!tabs && H.indexOf(tabs) > H.indexOf('<section class="page-hero">') && H.indexOf(tabs) < H.indexOf('<section class="stats-bar">'));
const targets = (tabs.match(/href="#([a-z-]+)"/g) || []).map((s) => s.slice(7, -1));
ok('...every tab lands on a section that exists (' + targets.join(', ') + ')', targets.length === 7 && targets.every((t) => new RegExp('<section [^>]*id="' + t + '"').test(H)));
ok('...the first tab is a Free Estimate pill that goes to the quick form on the page', /<a class="n-go" href="#quick-estimate">Free Estimate<\/a>/.test(tabs) && /<section class="qe" id="quick-estimate"/.test(H));
ok('...it stays under the menu (78px, 68px on a phone)', /\.n-tabs\{position:sticky;top:78px/.test(CSS) && /@media\(max-width:600px\)\{\.n-tabs\{top:68px\}/.test(CSS));
ok('THE HERO IS LIGHT: cream behind dark words, the photo whole in a frame (no tint over it)', /\.page-hero\{background:var\(--n-cream\)!important/.test(CSS) && /\.page-hero-bg-blur::after\{display:none!important\}/.test(CSS) && /\.page-hero-text h1\{color:var\(--n-ink\)!important/.test(CSS) && /\.page-hero-bg-blur img\{position:static!important;width:100%!important;height:100%!important/.test(CSS));
ok('...on a phone the photo comes first, above the words, FULL WIDTH edge to edge at 4:3, right under the menu', /\.page-hero-bg-blur\{position:relative!important;inset:auto!important;width:100%!important;margin:0!important;aspect-ratio:4\/3;border-radius:0!important;box-shadow:none!important\}/.test(CSS) && /html body \.page-hero\{display:block!important;padding:0 0 8px!important\}/.test(CSS));
ok('calm pill buttons in sentence case', /\{border-radius:999px!important;text-transform:none!important/.test(CSS));
ok('one warm charcoal band with slanted edges (the process)', /\.process-section\{background:var\(--n-dark\)!important;clip-path:polygon\(0 4vw,100% 0,100% calc\(100% - 4vw\),0 100%\)/.test(CSS));
ok('buttons on the dark bands stay readable', /\.btn-primary\{background:#d9a54a!important;color:var\(--n-ink\)!important\}/.test(CSS));
ok('NO RED anywhere in the look (its rules, not its comments)', !/#(c00|f00|e00|d00|b00|a00|900)\b|#(c|d|e|b|a|9)[0-2][0-2][0-2][0-3][0-3]\b|\bred\b|crimson|maroon|burgundy/i.test(CSS.replace(/\/\*[\s\S]*?\*\//g, '')));
{
  /* "maybe we can add our quick contact form with nice design" */
  const f = (H.match(/<form name="contact" method="POST" id="qeForm"[\s\S]*?<\/form>/) || [''])[0];
  const C = fs.readFileSync(path.join(ROOT, 'contact.html'), 'utf8');
  const reg = (C.match(/<form name="contact"[\s\S]*?<\/form>/) || [''])[0];
  const names = (f.match(/name="([a-z-]+)"/g) || []).map((s) => s.slice(6, -1)).filter((n) => n !== 'contact');
  ok('THE QUICK FORM posts to the contact page\'s own Netlify form ("contact"), every field one that form already has', !!f && /<input type="hidden" name="form-name" value="contact">/.test(f) && names.length >= 7 && names.every((n) => new RegExp('name="' + n + '"').test(reg)), names.join(', '));
  ok('...it does NOT register a second "contact" form (Netlify would learn the short one and drop contact.html\'s address and photo fields)', !/data-netlify/.test(f) && /data-netlify="true"/.test(reg));
  ok('...it asks for name, phone, email, area and the job, marks the job as a bathroom, and keeps the honeypot', ['name', 'phone', 'email', 'borough', 'message', 'bot-field'].every((n) => names.indexOf(n) !== -1) && /name="service" value="Bathroom Renovation"/.test(f));
  ok('...and sends the lead where the contact page sends it: Netlify, the confirmation email, the dashboard', /fetch\('\/',\{method:'POST',body:d\}\)/.test(H) && /\/\.netlify\/functions\/send-confirmation/.test(H) && /\/\.netlify\/functions\/contact-to-estimate/.test(H) && /contactRef:ref/.test(H));
  ok('...its reference matches the format the dashboard turns into an SBC number', /var ref='contact-'\+String\(t\.getFullYear\(\)\)\.slice\(2\)\+p\(t\.getMonth\(\)\+1\)\+p\(t\.getDate\(\)\)\+'-'\+Math\.random\(\)\.toString\(36\)\.slice\(2,6\)/.test(H) && /\^contact-\(\\d\{6\}\)-\(\[a-z0-9\]\{4\}\)\$/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/contact-to-estimate.js'), 'utf8')));
  ok('the badges under the hero are hidden - the numbers bar right below says the same', /html body \.page-hero \.hero-cred-cards\{display:none!important\}/.test(CSS));
}
{
  const words = (s) => s.replace(/<nav class="n-tabs"[\s\S]*?<\/nav>/, '').replace(/<!-- QUICK-ESTIMATE:START -->[\s\S]*?<!-- QUICK-ESTIMATE:END -->/, '').replace(/<!-- BOROUGH-CARDS:START -->[\s\S]*?<!-- BOROUGH-CARDS:END -->/, '').replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  let before = null; try { before = cp.execSync('git show HEAD:bathroom-renovation.html', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch (e) {}
  if (before && /NATURAL-CSS/.test(before)) before = null;  /* already committed: compare with the last page without it */
  if (!before) { try { const sha = cp.execSync('git log --format=%H -n 1 -S "NATURAL-CSS:START" -- bathroom-renovation.html', { cwd: ROOT }).toString().trim(); if (sha) before = cp.execSync('git show ' + sha + '~1:bathroom-renovation.html', { cwd: ROOT }).toString(); } catch (e) {} }
  ok('THE WORDS ARE THE SAME as before the new look (the tab bar, borough cards and quick form aside)', !!before && words(before) === words(H) && words(H).length > 5000);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
