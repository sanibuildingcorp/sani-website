#!/usr/bin/env node
/* Every public page: the homepage's fonts, and text an older reader can read.
 *
 *   "i need in all pages new fonts you set in home page and new page. Easy
 *    for reading old people"
 *
 * Measured before this: most reading text on the site was 13-14px on a phone.
 * This tool opens every public page in a real browser (Chromium, at a phone
 * width and a computer width), finds the reading text - paragraphs, list
 * items and table cells with a sentence in them, outside the menu and
 * footer - and writes one <style id="sbc-readable"> block into the page's
 * <head> that:
 *
 *   1. puts the homepage's fonts on it: Archivo for headings (every rule that
 *      asked for Playfair Display or Bebas Neue), Source Sans 3 for text
 *      (every rule that asked for DM Sans or Inter), read from the page's own
 *      CSS so nothing is guessed; the old Google Fonts link is swapped for the
 *      new one;
 *   2. makes reading text at least 17px, with 1.6 line height - by finding
 *      the exact rule that made each small paragraph small, and only at the
 *      screen width where it was small (a 18px desktop paragraph is not
 *      shrunk to 17);
 *   3. darkens text that fails the 4.5:1 contrast minimum against its own
 *      background.
 *
 * Words, links, images and layout are not touched. Safe to run again: the
 * block is removed before measuring, so each run measures the page as built.
 *
 * Run: python3 -m http.server 8765 (in the repo), then node ops/site-readable.js
 */
const fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.BASE || 'http://localhost:8765/';
const PRIVATE = ['dashboard.html', 'dashboard-shell.html', 'bid-analyzer.html', 'quote.html', 'invoice.html',
  'contract.html', 'agreement.html', 'estimate.html', 'handyman-estimate.html', 'review.html', 'googlee822c2a7421a7276.html'];
const MIN = 17;
const HEAD = "'Archivo','Playfair Display',system-ui,-apple-system,'Segoe UI',sans-serif";
const TEXT = "'Source Sans 3','DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif";
const FONTS = '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
  + '<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..100,500..800&family=Source+Sans+3:wght@400;500;600;700&display=swap" rel="stylesheet">';
const START = '<!-- SBC-READABLE:START -->', END = '<!-- SBC-READABLE:END -->';
const strip = (h) => h.replace(new RegExp(START + '[\\s\\S]*?' + END + '\\n?', 'g'), '');

/* Runs inside the page. Returns what this width needs. */
function measure(MIN) {
  const top = (s) => { const out = []; let d = 0, cur = ''; for (const c of s) { if (c === '(') d++; if (c === ')') d--; if (c === ',' && !d) { out.push(cur.trim()); cur = ''; } else cur += c; } if (cur.trim()) out.push(cur.trim()); return out; };
  const rules = [];
  const walk = (list) => { for (const r of list) {
    if (r.type === 1) rules.push(r);
    else if (r.type === 4) { if (matchMedia(r.conditionText || r.media.mediaText).matches) walk(r.cssRules); }
    else if (r.cssRules) walk(r.cssRules);
  } };
  for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch (e) { /* cross-origin sheet */ } }
  const ok = (p) => p && p.indexOf('::') === -1 && !/:(hover|focus|active|visited)/.test(p);
  const fam = { head: new Set(), text: new Set() };
  rules.forEach((r) => {
    const f = r.style.fontFamily || '';
    const k = /Playfair|Bebas/i.test(f) ? 'head' : /DM Sans|Inter\b/i.test(f) ? 'text' : '';
    if (k) top(r.selectorText).filter(ok).forEach((p) => fam[k].add(p));
  });
  const inlineSize = (el) => { const m = (el.getAttribute('style') || '').match(/font-size\s*:\s*([^;]+)/i); return m ? m[0].replace(/\s+/g, '') : ''; };
  const sizeRulesOn = (el) => { const out = []; rules.forEach((r) => { if (!r.style.fontSize) return; top(r.selectorText).filter(ok).forEach((p) => { try { if (el.matches(p)) out.push(p); } catch (e) {} }); }); return out; };
  const causeOf = (el) => {
    const tag = el.tagName.toLowerCase();
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const inl = inlineSize(n);
      if (inl) { const a = '[style*="' + (n.getAttribute('style').match(/font-size\s*:\s*[^;]+/i)[0]) + '"]'; return n === el ? [tag + a] : [a + ' ' + tag]; }
      const on = sizeRulesOn(n);
      if (on.length) return n === el ? on : on.map((p) => p + ' ' + tag);
    }
    return [tag];
  };
  const lum = (c) => { const v = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const rgba = (s) => { const m = s.match(/[\d.]+/g); if (!m) return null; return [+m[0], +m[1], +m[2], m.length > 3 ? +m[3] : 1]; };
  const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; const b = rgba(cs.backgroundColor); if (b && b[3] > 0.95) return b; } return [255, 255, 255, 1]; };
  const pathSel = (el) => { const tag = el.tagName.toLowerCase(); if (el.classList.length) return tag + '.' + [...el.classList].map(CSS.escape).join('.'); for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) { if (n.id) return '#' + CSS.escape(n.id) + ' ' + tag; if (n.classList.length) return '.' + [...n.classList].map(CSS.escape).join('.') + ' ' + tag; } return null; };
  const small = new Set(), dim = { light: new Set(), dark: new Set() };
  const els = [...document.querySelectorAll('p, li, dd, td')].filter((e) => !e.closest('nav, footer, #site-menu, #site-footer, .mobile-bar, script, noscript') && e.textContent.trim().length > 60 && e.offsetParent);
  els.forEach((e) => {
    const cs = getComputedStyle(e);
    if (parseFloat(cs.fontSize) < MIN - 0.25) causeOf(e).forEach((s) => small.add(s));
    const fg = rgba(cs.color), bg = bgOf(e);
    if (fg && bg) {
      const mix = fg.slice(0, 3).map((x, i) => x * fg[3] + bg[i] * (1 - fg[3]));
      const L1 = lum(mix), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const s = pathSel(e);
      if (ratio < 4.5 && s) dim[lum(bg) < 0.2 ? 'dark' : 'light'].add(s);
    }
  });
  /* grid boxes: bigger words must wrap inside a column, not widen it past
     the screen (a grid item's min-width is its longest word by default) */
  const grids = new Set();
  [...document.querySelectorAll('body *')].forEach((g) => {
    const d = getComputedStyle(g).display; if (d !== 'grid' && d !== 'inline-grid') return;
    if (g.classList.length) grids.add('.' + [...g.classList].map(CSS.escape).join('.'));
    else { const m = (g.getAttribute('style') || '').match(/grid-template-columns\s*:\s*[^;]+/i); if (m) grids.add('[style*="' + m[0] + '"]'); }
  });
  return { grids: [...grids], head: [...fam.head], text: [...fam.text], small: [...small], dark: [...dim.dark], light: [...dim.light], inlineHead: !!document.querySelector('[style*="Playfair"],[style*="Bebas"]') };
}

function block(phone, desk, fontsToo) {
  const both = (k) => phone[k].filter((s) => desk[k].indexOf(s) !== -1);
  const only = (a, b, k) => a[k].filter((s) => b[k].indexOf(s) === -1);
  const is = (list) => 'html body :is(' + list.join(',') + ')';
  const uniq = (a) => Array.from(new Set(a));
  let css = '/* generated by ops/site-readable.js - the homepage fonts, reading text at least ' + MIN + 'px */\n';
  if (fontsToo) {
    css += 'html body{font-family:' + TEXT + '}\n';
    const text = uniq(phone.text.concat(desk.text)), head = uniq(phone.head.concat(desk.head));
    if (text.length) css += is(text) + '{font-family:' + TEXT + '!important}\n';
    css += is(head.concat(['h1', 'h2', 'h3'])) + '{font-family:' + HEAD + '!important;letter-spacing:-.01em}\n';
    css += 'html body :is(h1,h2,h3) :is(em,i,.italic-accent),html body .italic-accent{font-style:normal!important}\n';
  }
  /* words styled inline, on every page (the homepage too) */
  css += 'html body [style*="DM Sans"],html body [style*="Inter"]{font-family:' + TEXT + '!important}\n';
  css += 'html body :is([style*="Playfair"],[style*="Bebas"]){font-family:' + HEAD + '!important}\n';
  const s = (list) => is(list) + '{font-size:' + MIN + 'px!important;line-height:1.6!important}';
  if (both('small').length) css += s(both('small')) + '\n';
  if (only(phone, desk, 'small').length) css += '@media(max-width:899px){' + s(only(phone, desk, 'small')) + '}\n';
  if (only(desk, phone, 'small').length) css += '@media(min-width:900px){' + s(only(desk, phone, 'small')) + '}\n';
  const grids = uniq(phone.grids.concat(desk.grids));
  if (grids.length) css += is(grids) + '>*{min-width:0}\n';
  css += 'html body :is(p,li,dd,td,h1,h2,h3,h4){overflow-wrap:break-word}\n';
  const light = uniq(phone.light.concat(desk.light)), dark = uniq(phone.dark.concat(desk.dark));
  if (light.length) css += '/* too faint on a light background */\n' + is(light) + '{color:#3b4450!important}\n';
  if (dark.length) css += '/* too faint on a dark background */\n' + is(dark) + '{color:rgba(255,255,255,.88)!important}\n';
  return css;
}

(async () => {
  const only = process.argv.slice(2);
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && PRIVATE.indexOf(f) === -1 && (!only.length || only.indexOf(f) !== -1));
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  for (const f of pages) {
    const file = path.join(ROOT, f);
    let html = strip(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, html);
    const home = f === 'index.html';          /* its fonts come from ops/home-restyle.py */
    const got = {};
    for (const [k, w] of [['phone', 390], ['desk', 1300]]) {
      const p = await b.newPage({ viewport: { width: w, height: 900 } });
      await p.goto(BASE + f, { waitUntil: 'load' });
      got[k] = await p.evaluate(measure, MIN);
      await p.close();
    }
    /* the old font link out, the homepage's in */
    html = html.replace(/<link rel="preload" as="style" href="https:\/\/fonts\.googleapis\.com\/css2\?family=(?:Playfair|Bebas)[^>]*>\n?/g, '')
      .replace(/<noscript><link href="https:\/\/fonts\.googleapis\.com\/css2\?family=(?:Playfair|Bebas)[^>]*><\/noscript>\n?/g, '')
      .replace(/<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=(?:Playfair|Bebas)[^>]*>\n?/g, '');
    const fonts = home ? '' : FONTS + '\n';
    const out = START + '\n' + fonts + '<style id="sbc-readable">\n' + block(got.phone, got.desk, !home) + '</style>\n' + END + '\n';
    html = html.replace('</head>', out + '</head>');
    fs.writeFileSync(file, html);
    console.log(f.padEnd(44), 'small:', got.phone.small.length + '/' + got.desk.small.length, ' faint:', got.phone.light.length + got.phone.dark.length);
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
