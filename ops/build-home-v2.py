#!/usr/bin/env python3
"""Splice the v2 homepage (partials/home-v2.html + partials/home-v2.css) into
index.html.

Replaces everything from the hero section through the areas section, and the
closing CTA section, with the v2 markup. Keeps the <head> (meta, schema, the
FAQ schema whose text the v2 FAQ repeats word for word), the menu and footer
placeholders, the contact form and every script. Safe to run twice: a page
that already carries v2 is rebuilt from its own markers.
"""
import re, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
page = (ROOT / "index.html").read_text()
body = (ROOT / "partials/home-v2.html").read_text()
css = (ROOT / "partials/home-v2.css").read_text()

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..100,600..800&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">')
START, END = "<!-- HOME-V2:START -->", "<!-- HOME-V2:END -->"
CSS_START, CSS_END = "<!-- HOME-V2-CSS:START -->", "<!-- HOME-V2-CSS:END -->"
block = START + "\n" + body.strip() + "\n" + END
css_block = CSS_START + FONTS + '<style id="home-v2-css">\n' + css.strip() + "\n</style>" + CSS_END

if START in page:
    page = re.sub(re.escape(START) + r".*?" + re.escape(END), lambda m: block, page, flags=re.S)
else:
    a = page.index("<!-- ══════════ HERO ══════════ -->")
    b = page.index("<!-- ══════════ CONTACT FORM ══════════ -->")
    page = page[:a] + block + "\n\n" + page[b:]
    c = page.index("<!-- ══════════ CTA ══════════ -->")
    d = page.index("</section>", c) + len("</section>")
    page = page[:c] + page[d:]

if CSS_START in page:
    page = re.sub(re.escape(CSS_START) + r".*?" + re.escape(CSS_END), lambda m: css_block, page, flags=re.S)
else:
    i = page.index("</head>")
    page = page[:i] + css_block + "\n" + page[i:]

(ROOT / "index.html").write_text(page)
print("index.html rebuilt with home v2")
