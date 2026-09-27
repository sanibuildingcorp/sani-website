/* gallery-top3.test.js — run: node js/gallery-top3.test.js
 *
 *   "Build your top 3 first"
 *
 * 1. A live wall: two rows of his work sliding past at the top.
 * 2. Before & after: drag the line; it sweeps once by itself when seen.
 * 3. "Get this look": on every photo, in the viewer and on each before/after;
 *    the estimate form opens with that photo attached. Only a picture from
 *    this site's own images/ folder is accepted.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const G = fs.readFileSync(path.join(ROOT, 'gallery.html'), 'utf8');
const EST = fs.readFileSync(path.join(ROOT, 'estimate.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

console.log('\n1. the live wall\n');
const wall = (G.match(/<section class="lw"[\s\S]*?<\/section>/) || [''])[0];
const wallImgs = [...wall.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1]);
ok('two rows, every photo of the grid on it, each row doubled for a seamless loop', /class="lw-row lw-a"/.test(wall) && /class="lw-row lw-b"/.test(wall) && wallImgs.length === 54);
ok('the doubled copies are hidden from screen readers and the keyboard', (wall.match(/tabindex="-1" aria-hidden="true"/g) || []).length === 27);
ok('small pictures only (the wall never loads the full photos)', wallImgs.every((f) => fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).size < 150 * 1024));
ok('it pauses under the mouse and stands still for anyone who asks for less motion', /\.lw:hover \.lw-track\{animation-play-state:paused\}/.test(G) && /@media\(prefers-reduced-motion:reduce\)\{\.lw-track\{animation:none\}/.test(G));
ok('a tap on the wall opens that photo in the viewer', /document\.querySelector\('\.gallery-item\[data-img="'\+b\.getAttribute\('data-for'\)\+'"\]'\)/.test(G));

console.log('\n2. before & after\n');
const figs = [...G.matchAll(/<figure class="ba">[\s\S]*?<\/figure>/g)].map((m) => m[0]);
ok('two before/after sliders: the roof deck and the galley kitchen', figs.length === 2 && /roof-deck-before\.jpg/.test(figs[0]) && /galley-kitchen-after\.jpg/.test(figs[1]));
ok('each has a before and an after of the same size, labelled', figs.every((f) => { const s = [...f.matchAll(/src="(images\/before-after\/[^"]+)" width="(\d+)" height="(\d+)"/g)]; return s.length === 2 && s[0][2] === s[1][2] && s[0][3] === s[1][3] && s.every((x) => fs.existsSync(path.join(ROOT, x[1]))); }) && figs.every((f) => /class="ba-tag ba-tag-b">Before</.test(f) && /class="ba-tag ba-tag-a">After</.test(f)));
ok('drag or arrow keys: a real range input drives the line', figs.every((f) => /<input class="ba-range" type="range" min="0" max="100" value="50" aria-label="Drag to compare before and after: /.test(f)) && /f\.style\.setProperty\('--pos', v\+'%'\)/.test(G));
ok('it sweeps once by itself when first seen, and stops the moment he touches it', /new IntersectionObserver/.test(G) && /if\(f\.dataset\.touched\) return;/.test(G));

console.log('\n3. get this look\n');
ok('on every tile (where there is a mouse) and in the viewer for the photo on screen', /a\.className='tile-look'/.test(G) && /btn\.className='lb-look'; btn\.textContent='Get a price for this look/.test(G) && /@media\(hover:none\)\{\.tile-look\{display:none\}\}/.test(G));
ok('...and on each before/after, to a photo that exists', figs.every((f) => { const m = /class="ba-look" href="\/estimate\?look=([^&"]+)/.exec(f); return m && fs.existsSync(path.join(ROOT, m[1])); }));
const rx = new RegExp(/if\(!(\/.*?\/i)\.test\(look\)/.exec(EST.slice(EST.indexOf('"GET THIS LOOK" FROM THE GALLERY')))[1].slice(1, -2), 'i');
const accept = (look) => rx.test(look) && look.indexOf('..') === -1;
ok('THE FORM ONLY TAKES A PICTURE FROM THIS SITE: images/... yes; another site, a script or ../ no', accept('images/cabinet-work/shaker-kitchen-sink-wall-crown-molding.jpg') && accept('images/before-after/roof-deck-after.jpg') && !accept('https://evil.example/x.jpg') && !accept('//evil.example/x.jpg') && !accept('images/../../netlify/functions/x.jpg') && !accept('javascript:alert(1)') && !accept('images/x.svg'));
ok('the photo is attached the same way a photo he adds is, and step 1 says so', /formData\.photos\.push\(\{name:'Gallery look'\+\(title\?': '\+title:''\),data:data,kind:'image',slot:'other'\}\);/.test(EST) && /You picked this look/.test(EST) && /<b>You picked this look'\+\(title\?': '\+esc\(title\):''\)/.test(EST));
ok('the matching service is ticked only where there is one (no Kitchen service to guess)', /var SVC=\{bathroom:'bathroom',flooring:'flooring',carpentry:'carpentry',restoration:'water-damage'\};/.test(G));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
