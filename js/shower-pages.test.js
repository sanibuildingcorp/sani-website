/* shower-pages.test.js — run: node js/shower-pages.test.js
 *
 *   "find better keywords for my services" ... "I need more around bathroom
 *    and tile work" ... "Remember i also have bathroom wall panels
 *    installation which also can be shower waterproofing"
 *   Panels: acrylic and PVC. Shower jobs: waterproofing, shower pan
 *   replacement, leaking shower repair, tub to shower conversion.
 *
 * Semrush (US): shower wall panels 18,100/mo, acrylic 5,400, PVC 3,600,
 * shower surround panels 2,400; shower waterproofing 1,900 (difficulty 13),
 * shower pan replacement 880 (9), leaking shower repair 320 (18). The panels
 * page ranked for none of them; the shower jobs had no page.
 *
 *   1. The wall panels page names what people search: shower wall panels,
 *      installation, acrylic, PVC, shower surround, grout-free.
 *   2. A new page, /shower-waterproofing, for the four shower jobs.
 *   3. Both are linked from the menu, the footer, the bathroom pages, the
 *      grout page and the water damage page, and listed in the sitemap and
 *      llms.txt.
 *   4. The navy "Request an estimate" button had navy words on it.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const tag = (h, re) => { const m = h.match(re); return m ? m[1] : ''; };
const lds = (h) => (h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || []).map((b) => JSON.parse(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')));
const text = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
const visibleFaq = (h) => { const out = []; const re = /<button class="faq-q">([\s\S]*?)<span class="plus">\+<\/span><\/button>\s*<div class="faq-a"><p>([\s\S]*?)<\/p><\/div>/g; let m; while ((m = re.exec(h))) out.push([text(m[1]), text(m[2])]); return out; };
const faqSame = (h) => { const f = lds(h).find((x) => x['@type'] === 'FAQPage'); const v = visibleFaq(h); return !!f && f.mainEntity.length === v.length && f.mainEntity.every((q, i) => q.name === v[i][0] && q.acceptedAnswer.text === v[i][1]); };

console.log('\n1. The wall panels page says what people search\n');
{
  const h = read('bathroom-wall-panels.html');
  const t = tag(h, /<title>([^<]*)<\/title>/), d = tag(h, /<meta name="description" content="([^"]*)"/);
  ok('THE TITLE SAYS "Shower Wall Panels Installation", acrylic and PVC', /Shower Wall Panels Installation NYC/.test(t) && /Acrylic &amp; PVC/.test(t) && t.length <= 70, t);
  ok('...the description says acrylic, PVC, shower surround, grout-free', /acrylic and PVC shower wall panels/i.test(d) && /shower surround/i.test(d) && /grout-free/i.test(d), d);
  ok('the one h1 says shower wall panel installation', (h.match(/<h1[\s>]/g) || []).length === 1 && /<h1>Shower &amp; Bathroom Wall Panel Installation/.test(h));
  ok('an "Acrylic & PVC shower wall panels" section, with a grout-free alternative to tile, linking the shower page', /<h2>Acrylic &amp; PVC shower wall panels<\/h2>/.test(h) && /<h2>A grout-free alternative to shower tile<\/h2>/.test(h) && /href="\/shower-waterproofing"/.test(h));
  ok('...it never offers what he does not install (solid surface, laminate)', !/solid surface|laminate/i.test(h));
  const svc = lds(h).find((x) => x['@type'] === 'Service');
  ok('the schema names acrylic, PVC and shower surround panels', ['Acrylic Shower Wall Panels', 'PVC Shower Wall Panels', 'Shower Surround Panels'].every((s) => svc.serviceType.indexOf(s) !== -1));
  const bc = lds(h).find((x) => x['@type'] === 'BreadcrumbList');
  ok('the breadcrumb points at the canonical address (www, no .html)', bc.itemListElement.every((i) => /^https:\/\/www\.sanibuildingcorp\.com\//.test(i.item) && !/\.html$/.test(i.item)));
  ok('THE FAQ SCHEMA IS WORD FOR WORD THE VISIBLE FAQ, new questions included', faqSame(h) && /Acrylic or PVC shower wall panels/.test(h) && /Can wall panels fix a leaking shower\?/.test(h));
}

console.log('\n2. /shower-waterproofing: the four shower jobs\n');
{
  const F = 'shower-waterproofing.html';
  ok('the page exists', fs.existsSync(path.join(ROOT, F)));
  const h = read(F);
  const t = tag(h, /<title>([^<]*)<\/title>/);
  ok('THE TITLE SAYS shower waterproofing and shower pan replacement', /^Shower Waterproofing &amp; Shower Pan Replacement NYC/.test(t) && t.length <= 70, t);
  ok('canonical, index, full snippets', /<link rel="canonical" href="https:\/\/www\.sanibuildingcorp\.com\/shower-waterproofing">/.test(h) && /<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large/.test(h));
  ok('one h1', (h.match(/<h1[\s>]/g) || []).length === 1);
  ['Shower waterproofing', 'Shower pan replacement', 'Leaking shower repair', 'Tub to shower conversion'].forEach((j) =>
    ok('...a card for "' + j + '"', new RegExp('<h3>' + j + '</h3>').test(h)));
  const svc = lds(h).find((x) => x['@type'] === 'Service');
  ok('Service schema with the four jobs and the business\'s own provider block', ['Shower Waterproofing', 'Shower Pan Replacement', 'Leaking Shower Repair', 'Tub to Shower Conversion'].every((s) => svc.serviceType.indexOf(s) !== -1) && svc.provider['@id'] === 'https://www.sanibuildingcorp.com/#organization' && svc.provider.telephone === '+1-332-277-0990');
  ok('THE FAQ SCHEMA IS WORD FOR WORD THE VISIBLE FAQ', faqSame(h) && visibleFaq(h).length >= 6);
  ok('fully insured, the 3-year workmanship warranty - never "licensed", never TV mounting', /fully insured/i.test(h) && /3-year workmanship warranty/.test(h) && !/licens/i.test(h) && !/tv mount/i.test(h));
  ok('no invented prices on it', !/\$\d/.test(h));
  const imgs = (h.match(/src="(images\/shower-waterproofing\/[^"]+)"/g) || []).map((s) => s.slice(5, -1));
  ok('its own photos, all there, each under 200 KB', imgs.length >= 5 && imgs.every((i) => fs.existsSync(path.join(ROOT, i)) && fs.statSync(path.join(ROOT, i)).size < 200 * 1024), imgs.join(', '));
  ok('a share image, 1200x630', fs.existsSync(path.join(ROOT, 'images/og/shower-waterproofing-og.jpg')) && /og:image" content="https:\/\/www\.sanibuildingcorp\.com\/images\/og\/shower-waterproofing-og\.jpg"/.test(h));
  ok('it wears the wall panels page\'s design: the same style block, menu, footer and scripts', h.indexOf(read('bathroom-wall-panels.html').match(/<style>\n\/\* ════════════ PAGE-SPECIFIC STYLES[\s\S]*?<\/style>/)[0]) !== -1 && /<div id="site-menu"><\/div>/.test(h) && /<script src="partials\/site\.js"><\/script>/.test(h));
  ok('...and it points back at the panels for walls-only jobs', /href="\/bathroom-wall-panels" class="btn btn-navy"/.test(h));
}

console.log('\n3. Google can find both\n');
{
  const menu = read('partials/menu.html'), foot = read('partials/footer.html');
  ok('THE MENU says "Shower Wall Panels" (it said "Bathroom Refresh") and lists shower waterproofing, desktop and phone', (menu.match(/href="\/bathroom-wall-panels"[^>]*>(?:<span[^>]*>)?Shower Wall Panels/g) || []).length === 2 && (menu.match(/href="\/shower-waterproofing"/g) || []).length === 2 && !/Bathroom Refresh/.test(menu));
  ok('...so does the footer', /href="\/bathroom-wall-panels">Shower Wall Panels/.test(foot) && /href="\/shower-waterproofing"/.test(foot));
  ['bathroom-renovation', 'bathroom-renovation-brooklyn', 'bathroom-renovation-manhattan', 'bathroom-renovation-queens', 'tile-grouting-restoration', 'water-damage'].forEach((p) =>
    ok('/' + p + ' links the shower page and "Shower Wall Panels"', /class="sbc-ilink" href="\/shower-waterproofing"/.test(read(p + '.html')) && /class="sbc-ilink" href="\/bathroom-wall-panels">Shower Wall Panels</.test(read(p + '.html'))));
  const sm = read('sitemap.xml');
  ok('the sitemap lists the new page', /<loc>https:\/\/www\.sanibuildingcorp\.com\/shower-waterproofing<\/loc>/.test(sm));
  const ll = read('llms.txt');
  ok('llms.txt describes both, PVC included', /\(https:\/\/www\.sanibuildingcorp\.com\/shower-waterproofing\)/.test(ll) && /acrylic and PVC shower wall panels/i.test(ll));
}

console.log('\n4. The navy button can be read\n');
{
  const css = read('bathroom-wall-panels.html');
  ok('".wp a{color:inherit}" no longer paints the navy button\'s words navy', /\.wp \.btn-navy,\.wp \.btn-navy:hover\{color:#fff\}/.test(css) && css.indexOf('.wp .btn-navy,') > css.indexOf('.wp a{color:inherit}'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
