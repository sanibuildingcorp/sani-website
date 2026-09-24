/* home-v2.test.js — run: node js/home-v2.test.js
 *
 *   "they are looking too AI generic, i need better icons, better designs"
 *
 * The v2 homepage (partials/home-v2.html + home-v2.css, spliced into
 * index.html by ops/build-home-v2.py): one type pair, one icon set drawn in
 * one stroke style, the company's own photos. What must not change while it
 * looks different: the H1, the FAQ text the FAQ schema repeats, the contact
 * form, and the rules that hold on every page.
 */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const IDX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const PART = fs.readFileSync(path.join(ROOT, 'partials/home-v2.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'partials/home-v2.css'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

console.log('\n1. It is on the page, built from the partials\n');
ok('index.html carries the v2 block and its stylesheet, once each', (IDX.match(/<!-- HOME-V2:START -->/g) || []).length === 1 && (IDX.match(/<!-- HOME-V2-CSS:START -->/g) || []).length === 1);
ok('...and the page is exactly what the build makes (run ops/build-home-v2.py after editing a partial)', (() => { const tmp = IDX; cp.execSync('python3 ops/build-home-v2.py', { cwd: ROOT }); const again = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'); fs.writeFileSync(path.join(ROOT, 'index.html'), tmp); return again === tmp; })());
ok('the old sections are gone: no strip, no marquee, no carousel, no stock gallery', !/class="services-strip"|class="marquee-section"|id="reviewsCarousel"|class="gallery-grid"|class="cta-section"/.test(IDX));

console.log('\n2. What must not change\n');
ok('ONE H1, the one the page ranks with', (IDX.match(/<h1/g) || []).length === 1 && /<h1>General contractor in Brooklyn &amp; NYC<\/h1>/.test(IDX));
const schema = JSON.parse(IDX.match(/<script type="application\/ld\+json">(\{"@context":"https:\/\/schema\.org","@type":"FAQPage"[\s\S]*?)<\/script>/)[1]);
const faq = [...PART.matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map((m) => [m[1], m[2]]);
ok('THE FAQ ON THE PAGE IS WORD FOR WORD THE FAQ SCHEMA (Google checks they match)', faq.length === schema.mainEntity.length && faq.every((q, i) => q[0] === schema.mainEntity[i].name && q[1] === schema.mainEntity[i].acceptedAnswer.text));
ok('the contact form is untouched: same form, same ids the submit script uses', /<form class="contact-form" name="contact" method="POST" data-netlify="true"[^>]*id="estimateForm">/.test(IDX) && ['cfSubmitBtn', 'cfSuccess', 'cfError'].every((id) => IDX.indexOf('id="' + id + '"') !== -1));
ok('the hero stays Sani\'s own-work collage, preloaded', /<img src="images\/hero\/home-hero\.webp\?v=\d+"[^>]*fetchpriority="high"/.test(PART));
ok('never "licensed", never TV mounting', !/licens/i.test(PART) && !/\btv\b|television/i.test(PART));
ok('the warranty is the 3 years the contract says', /3-year warranty/.test(PART) && !/[0-24-9]-year warranty/.test(PART));

console.log('\n3. One icon set, real photos, readable on a phone\n');
const used = [...new Set([...PART.matchAll(/<use href="#(i-[a-z-]+)"\/>/g)].map((m) => m[1]))];
const defined = [...PART.matchAll(/<symbol id="(i-[a-z-]+)"/g)].map((m) => m[1]);
ok('every icon used is drawn in the sprite, and every drawn icon is used', used.every((u) => defined.includes(u)) && defined.every((d) => used.includes(d)), 'missing: ' + used.filter((u) => !defined.includes(u)) + ' unused: ' + defined.filter((d) => !used.includes(d)));
ok('...all in one stroke style (the .v2-ico rule), no icon in a circle', /\.v2-ico\{[^}]*stroke-width:1\.7/.test(CSS) && !/border-radius:50%/.test(CSS));
const imgs = [...PART.matchAll(/src="([^"?]+)/g)].map((m) => m[1]);
ok('every photo is on disk', imgs.length >= 7 && imgs.every((f) => fs.existsSync(path.join(ROOT, f))), imgs.filter((f) => !fs.existsSync(path.join(ROOT, f))).join(', '));
ok('...and has its width and height, so the page does not jump while loading', [...PART.matchAll(/<img [^>]*>/g)].every((m) => /width="\d+"/.test(m[0]) && /height="\d+"/.test(m[0])));
ok('the before/after photos are light (under 100 KB each)', fs.readdirSync(path.join(ROOT, 'images/v2')).every((f) => fs.statSync(path.join(ROOT, 'images/v2', f)).size < 100 * 1024));
ok('buttons are big enough to tap (52px)', /\.v2-btn\{[^}]*min-height:52px/.test(CSS));
ok('scoped: every rule is under .v2 (or the contact heading), so the menu and footer keep theirs', CSS.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.trim()).filter((r) => r && !/^@media|^@keyframes/.test(r)).every((r) => { const sel = r.split('{').slice(-2)[0].trim(); return !sel || /(^|,)\s*\.v2|\.contact-section/.test(sel) || /^[a-z-]+:/.test(sel); }));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
