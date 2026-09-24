#!/usr/bin/env python3
"""The bathroom page in the calm, natural look (partials/bath-natural.css).

  "I like how it's looks them site more human makes, more natural and more
   professional" - Re-Bath's New York page, without its red accent.

Does three things to bathroom-renovation.html, and is safe to run again:
  1. gives the sections the tab bar points at an id (services, before-after,
     compare, process, projects, faq) - the words are not touched;
  2. puts the tab bar right after the hero: Free Estimate, Areas, Services,
     Before & After, Process, Projects, FAQ;
  3. appends partials/bath-natural.css last, so it wins over the older rules.
"""
import pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
P = ROOT / "bathroom-renovation.html"
page = P.read_text()
css = (ROOT / "partials/bath-natural.css").read_text()

IDS = [('<section class="eyn-section">', "services"), ('<section class="ba-section">', "before-after"),
       ('<section class="compare-section">', "compare"), ('<section class="process-section">', "process"),
       ('<section class="projects-section">', "projects"), ('<section class="faq-section">', "faq")]
for tag, i in IDS:
    if tag in page:
        assert page.count(tag) == 1, tag
        page = page.replace(tag, tag[:-1] + ' id="' + i + '">')
    assert ('id="' + i + '"') in page, i

TABS = ('<nav class="n-tabs" aria-label="On this page"><div class="n-tabs-in">'
        '<a class="n-go" href="/estimate">Free Estimate</a>'
        '<a href="#boroughs">Areas</a><a href="#services">Services</a><a href="#before-after">Before &amp; After</a>'
        '<a href="#process">Process</a><a href="#projects">Projects</a><a href="#faq">FAQ</a>'
        '</div></nav>')

def put(text, start, end, block, where):
    if start in text:
        return re.sub(re.escape(start) + r".*?" + re.escape(end), lambda m: start + block + end, text, flags=re.S)
    i = text.index(where)
    return text[:i] + start + block + end + "\n" + text[i:]

page = put(page, "<!-- NATURAL-TABS:START -->", "<!-- NATURAL-TABS:END -->", TABS, "<!-- ============ STATS BAR ============ -->")
page = put(page, "<!-- NATURAL-CSS:START -->", "<!-- NATURAL-CSS:END -->", '<style id="bath-natural">\n' + css.strip() + "\n</style>", "</body>")
P.write_text(page)
print("bathroom page: natural look applied")
