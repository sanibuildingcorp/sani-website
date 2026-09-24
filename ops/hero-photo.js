#!/usr/bin/env node
/* The hero photo shows whole, on every page, the way the homepage and the
 * bathroom page do it.
 *
 *   "For all pages hero background photos are not shows full, how did you
 *    make for home page can you make same for other pages?" ... "Merge it
 *    and do the other pages"
 *
 * Most pages stretched their hero photo over the whole hero behind a navy
 * tint; on a phone the hero is two or three screens of words tall, so the
 * photo was zoomed in and mostly hidden. This tool opens each page in
 * Chromium, finds the hero (the first <section>), its photo (an <img> in a
 * background layer, or a CSS background-image) and the photo's shape, and
 * writes one <style id="sbc-hero"> block into the page's <head> that:
 *   - hides the old photo layer and its tint (display:none - nothing is
 *     removed from the page);
 *   - paints the same photo on the hero's own ::before, behind everything:
 *       computers: on the right at its own shape, the words on warm
 *       charcoal (#1c1a18) on the left, fading into it;
 *       phones: full width at its own height at the top - the whole photo,
 *       nothing cropped - fading into charcoal under the words;
 *   - gives the hero words a soft shadow, so they stay readable on the photo.
 *
 * Where the words were centred, they move to the left on a computer, onto
 * the charcoal, so they never run across the photo.
 *
 * A page is left alone, and named in the output, when its hero is not a
 * photo behind white words: a photo in the layout (a split or a boxed
 * photo), dark words, or no photo.
 *
 * Safe to run again: the block is removed before measuring.
 * Run: python3 -m http.server 8765 (in the repo), then node ops/hero-photo.js
 */
const fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.BASE || 'http://localhost:8765/';
const SKIP = ['dashboard.html', 'dashboard-shell.html', 'bid-analyzer.html', 'quote.html', 'invoice.html', 'contract.html',
  'agreement.html', 'estimate.html', 'handyman-estimate.html', 'review.html', 'googlee822c2a7421a7276.html', '404.html',
  'index.html',               /* ops/home-restyle.py */
  'bathroom-renovation.html', /* done by hand first, js/hero-photo.test.js */
  'painting.html'             /* a slideshow of photos, kept as it is */];
const START = '<!-- SBC-HERO:START -->', END = '<!-- SBC-HERO:END -->';
const strip = (h) => h.replace(new RegExp(START + '[\\s\\S]*?' + END + '\\n?', 'g'), '');
const INK = '#1c1a18', C = (a) => 'rgba(24,22,20,' + a + ')';

/* Runs inside the page. */
async function probe() {
  const DYN = ['sbc-std', 'in', 'reveal', 'visible', 'loaded', 'active', 'is-active'];
  const cls = (e) => (e.getAttribute('class') || '').split(/\s+/).filter((c) => c && DYN.indexOf(c) === -1);
  const step = (e) => { const c = cls(e); if (c.length) return e.tagName.toLowerCase() + c.map((x) => '.' + CSS.escape(x)).join(''); return e.tagName.toLowerCase() + ':nth-child(' + ([...e.parentElement.children].indexOf(e) + 1) + ')'; };
  const hero = [...document.querySelectorAll('section')].find((s) => !s.closest('#site-menu, nav, header'));
  if (!hero) return { skip: 'no hero section' };
  let heroSel = hero.id ? '#' + CSS.escape(hero.id) : step(hero);
  if (document.querySelectorAll(heroSel).length !== 1) return { skip: 'hero selector not unique: ' + heroSel };
  const rel = (el) => { const parts = []; for (let n = el; n !== hero; n = n.parentElement) parts.unshift(step(n)); return heroSel + ' > ' + parts.join(' > '); };
  const H = hero.getBoundingClientRect();
  const isLayer = (e) => { const cs = getComputedStyle(e); return cs.position === 'absolute' || cs.position === 'fixed'; };
  const covers = (e) => { const r = e.getBoundingClientRect(); return r.width >= H.width * 0.8 && r.height >= H.height * 0.6; };
  const abs = (u) => { const x = new URL(u, location.href); return x.pathname.replace(/^\//, '') + x.search; };

  let photo = null, hide = [];
  /* the photo behind the words: an <img> whose empty wrapper covers the
     hero - not a thumbnail in a strip or a card further down it */
  const layerOf = (i) => { let l = i; while (l.parentElement !== hero && l.parentElement.textContent.trim() === '' && !l.parentElement.querySelector('a,button,h1,h2,p')) l = l.parentElement; return l; };
  const imgs = [...hero.querySelectorAll('img')].filter((i) => i.naturalWidth >= 500 && !/\.svg/.test(i.src));
  const img = imgs.find((i) => covers(layerOf(i)) && (isLayer(layerOf(i)) || isLayer(i)));
  if (!img && imgs.length && !/url\(/.test([hero, ...hero.querySelectorAll('*')].map((e) => getComputedStyle(e).backgroundImage).join(' '))) {
    const big = imgs.find((i) => { const r = i.getBoundingClientRect(); return r.width > H.width * 0.3 && r.height > 250; });
    if (big) return { skip: 'the photo is part of the layout (' + rel(layerOf(big)) + ')' };
  }
  if (img) {
    const layer = layerOf(img);
    photo = { url: img.getAttribute('src'), w: img.naturalWidth, h: img.naturalHeight };
    hide.push(rel(layer));
  } else {
    const el = [hero, ...hero.querySelectorAll('*')].find((e) => /url\(/.test(getComputedStyle(e).backgroundImage) && covers(e));
    if (!el) return { skip: 'no photo behind the words' };
    const u = abs(getComputedStyle(el).backgroundImage.match(/url\("?([^")]+)"?\)/)[1]);
    const im = new Image(); im.src = u; try { await im.decode(); } catch (e) { return { skip: 'photo would not load: ' + u }; }
    photo = { url: u, w: im.naturalWidth, h: im.naturalHeight };
    if (el !== hero) hide.push(rel(el));
  }
  /* tints and patterns laid over the photo: empty, absolute, covering */
  [...hero.children].forEach((c) => {
    if (hide.indexOf(rel(c)) !== -1 || c.textContent.trim() !== '' || !isLayer(c) || !covers(c)) return;
    const cs = getComputedStyle(c);
    if (cs.backgroundImage !== 'none' || !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)) hide.push(rel(c));
  });
  const after = getComputedStyle(hero, '::after');
  const killAfter = after.content !== 'none' && after.position === 'absolute' && (after.backgroundImage !== 'none' || !/rgba\(0, 0, 0, 0\)/.test(after.backgroundColor)) && parseFloat(after.width) >= H.width * 0.8;
  const h1 = hero.querySelector('h1');
  if (h1) { const m = getComputedStyle(h1).color.match(/[\d.]+/g).map(Number); const L = (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; if (L < 0.5) return { skip: 'dark words on a light hero' }; }
  /* centred words would run over the photo on a computer: the block that
     holds the h1 moves to the left, onto the charcoal, as on the homepage */
  let wrap = null;
  if (h1 && getComputedStyle(h1).textAlign === 'center') { let w = h1; while (w.parentElement !== hero) w = w.parentElement; wrap = rel(w); }
  return { heroSel, photo, hide, killAfter, wrap };
}

function block(r) {
  const R = (r.photo.h / r.photo.w).toFixed(3), url = r.photo.url.replace(/'/g, "\\'");
  const H = 'html body ' + r.heroSel;
  let css = '/* generated by ops/hero-photo.js - the whole hero photo, as on the homepage */\n';
  css += H + '{position:relative;isolation:isolate;background:' + INK + '!important}\n';
  if (r.hide.length) css += 'html body :is(' + r.hide.join(',') + '){display:none!important}\n';
  if (r.killAfter) css += H + '::after{display:none!important}\n';
  css += H + "::before{content:''!important;display:block!important;position:absolute!important;inset:0!important;z-index:-1!important;pointer-events:none;opacity:1!important;transform:none!important;filter:none!important;"
    + 'background:linear-gradient(90deg,' + INK + ' 0%,' + INK + ' 46%,' + C('.45') + ' 62%,' + C('.08') + " 100%),url('" + url + "') right center/auto 100% no-repeat," + INK + '!important}\n';
  css += H + ' :is(h1,h2,p){text-shadow:0 1px 14px rgba(0,0,0,.6)}\n';
  if (r.wrap) {
    const W = 'html body ' + r.wrap;
    css += '@media(min-width:900px){' + W + '{max-width:min(620px,50vw)!important;margin-left:max(40px,calc((100vw - 1240px)/2))!important;margin-right:auto!important;text-align:left!important}'
      + W + ' :is(h1,h2,p,div,span,ul){text-align:left!important;margin-left:0!important;margin-right:0!important}'
      + W + ' :is(div,ul,p){justify-content:flex-start!important;align-items:flex-start}}\n';
  }
  css += '@media(max-width:899px){' + H + '::before{background:linear-gradient(180deg,' + C('.55') + ' 0,' + C('.30') + ' calc(' + R + '*45vw),' + C('.78') + ' calc(' + R + '*100vw - 90px),' + INK + ' calc(' + R + "*100vw)),url('" + url + "') center top/100% auto no-repeat," + INK + '!important}}\n';
  return css;
}

(async () => {
  const only = process.argv.slice(2);
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && SKIP.indexOf(f) === -1 && (!only.length || only.indexOf(f) !== -1));
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
  for (const f of pages) {
    const file = path.join(ROOT, f);
    const html = strip(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, html);
    await p.goto(BASE + f, { waitUntil: 'load' });
    const r = await p.evaluate(probe);
    if (r.skip) { console.log(f.padEnd(44), 'left alone:', r.skip); continue; }
    fs.writeFileSync(file, html.replace('</head>', START + '\n<style id="sbc-hero">\n' + block(r) + '</style>\n' + END + '\n</head>'));
    console.log(f.padEnd(44), r.photo.url.split('?')[0], r.photo.w + 'x' + r.photo.h, 'hid', r.hide.length, r.killAfter ? '+::after' : '');
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
