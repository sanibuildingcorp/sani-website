// netlify/functions/lib/pdf-writer.js
//
// A SMALL PDF WRITER WITH NO DEPENDENCIES.
//
// Netlify functions are bundled; a PDF library that reads font files off disk
// at run time (pdfkit) is exactly the kind of dependency that works on a
// laptop and breaks in the function bundle. This writes PDF 1.4 by hand with
// the two standard fonts every reader carries (Helvetica, Helvetica-Bold),
// so nothing is embedded and nothing is read from disk. Text only, US Letter,
// word wrapping from the fonts' published widths, page numbers in the footer.
//
// It is enough for a scope of work; it is not a layout engine.

"use strict";

const W = 612, H = 792;                 // US Letter, points
const MARGIN_X = 54, TOP = 60, BOTTOM = 64;
const CONTENT_W = W - MARGIN_X * 2;

/* Advance widths, per 1000 em, for ASCII 32..126 - from the Adobe AFM files. */
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HELV_B = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

/* Characters outside ASCII that the standard fonts can show (WinAnsi), and
   the ones they cannot, mapped to something they can. */
const WINANSI = { "—": 151, "–": 150, "‘": 145, "’": 146, "“": 147, "”": 148, "•": 149, "…": 133, "·": 183, "×": 215, "é": 233, "è": 232, "ü": 252, "ö": 246, "ä": 228, "ñ": 241, "ç": 231, "°": 176, "½": 189, "¼": 188, "¾": 190, "®": 174, "©": 169 };
const FALLBACK = { "✓": "•", "✔": "•", "◆": "•", "◇": "•", "→": "->", "←": "<-", "≤": "<=", "≥": ">=", "‑": "-", " ": " ", "′": "'", "″": '"' };
const WIDE = { 151: 1000, 150: 556, 149: 350, 133: 1000, 183: 278, 215: 584, 176: 400 };

function normalize(s) {
  let out = "";
  for (const ch of String(s == null ? "" : s)) {
    const c = ch.codePointAt(0);
    if (c === 10 || c === 13 || c === 9) { out += ch === "\t" ? " " : ch; continue; }
    if (c >= 32 && c < 127) { out += ch; continue; }
    if (WINANSI[ch] != null) { out += ch; continue; }
    if (FALLBACK[ch] != null) { out += FALLBACK[ch]; continue; }
    if (c >= 160 && c <= 255) { out += ch; continue; }
    /* Emoji and anything else the standard fonts do not have: dropped. */
  }
  return out;
}

function charWidth(ch, bold) {
  const c = ch.codePointAt(0);
  const table = bold ? HELV_B : HELV;
  if (c >= 32 && c < 127) return table[c - 32];
  const w = WINANSI[ch];
  if (w != null) return WIDE[w] || 556;
  return 556;
}

function textWidth(s, size, bold) {
  let w = 0;
  for (const ch of s) w += charWidth(ch, bold);
  return (w * size) / 1000;
}

/* Wrap one paragraph to maxW points. Words longer than a line are broken. */
function wrapLine(text, size, bold, maxW) {
  const words = text.split(/ +/).filter(Boolean);
  const lines = [];
  let cur = "";
  const fits = (s) => textWidth(s, size, bold) <= maxW;
  words.forEach(function (w) {
    if (!fits(w)) {
      /* break a very long word by characters */
      let piece = "";
      for (const ch of w) {
        if (fits(cur ? cur + " " + piece + ch : piece + ch)) piece += ch;
        else { if (cur) { lines.push(cur + (piece ? " " + piece : "")); cur = ""; } else if (piece) lines.push(piece); piece = ch; }
      }
      w = piece;
    }
    const next = cur ? cur + " " + w : w;
    if (fits(next)) cur = next;
    else { if (cur) lines.push(cur); cur = w; }
  });
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function wrap(text, size, bold, maxW) {
  const out = [];
  normalize(text).split(/\r?\n/).forEach(function (p) { wrapLine(p.trim(), size, bold, maxW).forEach(function (l) { out.push(l); }); });
  return out;
}

/* A PDF string literal: WinAnsi bytes, escaped. Non-ASCII as octal. */
function literal(s) {
  let out = "(";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    let b = c < 127 ? c : (WINANSI[ch] != null ? WINANSI[ch] : (c <= 255 ? c : 63));
    if (b === 40 || b === 41 || b === 92) out += "\\" + String.fromCharCode(b);
    else if (b < 32 || b > 126) out += "\\" + ("00" + b.toString(8)).slice(-3);
    else out += String.fromCharCode(b);
  }
  return out + ")";
}

function rgb(c) {
  const a = Array.isArray(c) && c.length === 3 ? c : [0, 0, 0];
  return a.map(function (v) { return (Math.round(v * 1000) / 1000).toString(); }).join(" ");
}

function Doc(opts) {
  const o = opts || {};
  this.title = String(o.title || "Document");
  this.footerLeft = String(o.footerLeft || "");
  this.footerRight = String(o.footerRight || "");
  this.pages = [];
  this.y = 0;
  this.newPage();
}

Doc.prototype.newPage = function () {
  this.pages.push([]);
  this.y = H - TOP;
};
Doc.prototype.ops = function () { return this.pages[this.pages.length - 1]; };
Doc.prototype.ensure = function (h) { if (this.y - h < BOTTOM) this.newPage(); };
Doc.prototype.space = function (n) { this.y -= n; if (this.y < BOTTOM) this.newPage(); };

/**
 * A paragraph.
 * @param {string} text
 * @param {object} [s] size, bold, color [r,g,b] 0..1, indent (pt), bullet (string), after (pt), lineHeight (factor)
 */
Doc.prototype.text = function (text, s) {
  const st = s || {};
  const size = st.size || 11, bold = !!st.bold, color = st.color || [0.05, 0.09, 0.16];
  const indent = st.indent || 0, bullet = st.bullet ? normalize(st.bullet) : "";
  const bulletW = bullet ? Math.max(textWidth(bullet + " ", size, bold), 12) : 0;
  const lh = size * (st.lineHeight || 1.4);
  const lines = wrap(text, size, bold, CONTENT_W - indent - bulletW);
  const x = MARGIN_X + indent + bulletW;
  for (let i = 0; i < lines.length; i++) {
    this.ensure(lh);
    this.y -= lh;
    const ops = this.ops();
    if (i === 0 && bullet) ops.push("BT /" + (bold ? "F2" : "F1") + " " + size + " Tf " + rgb(color) + " rg " + (MARGIN_X + indent) + " " + this.y.toFixed(2) + " Td " + literal(bullet) + " Tj ET");
    ops.push("BT /" + (bold ? "F2" : "F1") + " " + size + " Tf " + rgb(color) + " rg " + x + " " + this.y.toFixed(2) + " Td " + literal(lines[i]) + " Tj ET");
  }
  this.y -= st.after != null ? st.after : 4;
  return this;
};

Doc.prototype.rule = function (color) {
  this.ensure(10);
  this.y -= 5;
  this.ops().push("q " + rgb(color || [0.85, 0.87, 0.9]) + " RG 0.6 w " + MARGIN_X + " " + this.y.toFixed(2) + " m " + (W - MARGIN_X) + " " + this.y.toFixed(2) + " l S Q");
  this.y -= 7;
  return this;
};

/**
 * A table row: the first cell wraps in its width, the others sit on its first
 * line. For the estimate PDFs' line items and totals.
 * @param {Array<{text:string,w:number,align?:string,bold?:boolean,color?:number[]}>} cells  widths in points, left to right
 * @param {object} [s] size, after, fill [r,g,b] behind the row
 */
Doc.prototype.row = function (cells, s) {
  const st = s || {};
  const size = st.size || 10, lh = size * 1.35;
  const first = cells[0] || { text: "", w: CONTENT_W };
  const lines = wrap(first.text, size, !!first.bold, first.w - 6);
  const h = lines.length * lh;
  this.ensure(h + 2);
  const ops = this.ops();
  if (st.fill) ops.push("q " + rgb(st.fill) + " rg " + MARGIN_X + " " + (this.y - h - 3).toFixed(2) + " " + CONTENT_W + " " + (h + 4).toFixed(2) + " re f Q");
  let x = MARGIN_X;
  const top = this.y;
  cells.forEach(function (c, i) {
    const bold = !!c.bold, color = rgb(c.color || [0.05, 0.09, 0.16]);
    const ls = i === 0 ? lines : [wrap(c.text, size, bold, 10000)[0] || ""];
    ls.forEach(function (line, j) {
      const y = top - lh * (j + 1);
      const tw = textWidth(line, size, bold);
      const tx = c.align === "right" ? x + c.w - tw - 2 : x + 2;
      ops.push("BT /" + (bold ? "F2" : "F1") + " " + size + " Tf " + color + " rg " + tx.toFixed(2) + " " + y.toFixed(2) + " Td " + literal(line) + " Tj ET");
    });
    x += c.w;
  });
  this.y = top - h - (st.after != null ? st.after : 3);
  return this;
};

/* A filled band behind a heading. */
Doc.prototype.band = function (text, s) {
  const st = s || {};
  const size = st.size || 12.5, h = size * 2;
  this.ensure(h + 6);
  const y0 = this.y - h;
  this.ops().push("q " + rgb(st.fill || [0.04, 0.09, 0.16]) + " rg " + MARGIN_X + " " + y0.toFixed(2) + " " + CONTENT_W + " " + h + " re f Q");
  this.ops().push("BT /F2 " + size + " Tf " + rgb(st.color || [1, 1, 1]) + " rg " + (MARGIN_X + 10) + " " + (y0 + h * 0.34).toFixed(2) + " Td " + literal(normalize(text)) + " Tj ET");
  this.y = y0 - 8;
  return this;
};

Doc.prototype.build = function () {
  const n = this.pages.length;
  const objects = [];
  const add = function (body) { objects.push(body); return objects.length; };
  add("<< /Type /Catalog /Pages 2 0 R >>");                                // 1
  const pagesIdx = add("");                                                // 2, filled below
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");      // 3
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"); // 4
  const infoIdx = add("<< /Title " + literal(normalize(this.title)) + " /Producer (Sani Building Corp) /Creator (sanibuildingcorp.com) >>"); // 5
  const pageIds = [];
  for (let i = 0; i < n; i++) {
    const footer = [];
    const fy = 40;
    if (this.footerLeft) footer.push("BT /F1 8.5 Tf 0.45 0.5 0.56 rg " + MARGIN_X + " " + fy + " Td " + literal(normalize(this.footerLeft)) + " Tj ET");
    const right = (this.footerRight ? normalize(this.footerRight) + "  ·  " : "") + "Page " + (i + 1) + " of " + n;
    footer.push("BT /F1 8.5 Tf 0.45 0.5 0.56 rg " + (W - MARGIN_X - textWidth(right, 8.5, false)).toFixed(2) + " " + fy + " Td " + literal(right) + " Tj ET");
    footer.push("q 0.85 0.87 0.9 RG 0.5 w " + MARGIN_X + " " + (fy + 14) + " m " + (W - MARGIN_X) + " " + (fy + 14) + " l S Q");
    const content = this.pages[i].concat(footer).join("\n");
    const cIdx = add("<< /Length " + Buffer.byteLength(content, "latin1") + " >>\nstream\n" + content + "\nendstream");
    const pIdx = add("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + W + " " + H + "] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents " + cIdx + " 0 R >>");
    pageIds.push(pIdx);
  }
  objects[pagesIdx - 1] = "<< /Type /Pages /Kids [" + pageIds.map(function (id) { return id + " 0 R"; }).join(" ") + "] /Count " + n + " >>";

  let out = "%PDF-1.4\n%âãÏÓ\n";
  const offsets = [];
  objects.forEach(function (body, i) {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += (i + 1) + " 0 obj\n" + body + "\nendobj\n";
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
  offsets.forEach(function (off) { out += ("0000000000" + off).slice(-10) + " 00000 n \n"; });
  out += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R /Info " + infoIdx + " 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return Buffer.from(out, "latin1");
};

module.exports = { Doc, wrap, textWidth, normalize, literal, CONTENT_W };
