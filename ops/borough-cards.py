#!/usr/bin/env python3
"""Borough cards on the bathroom page, in the style of a Houzz listing.

  "What if we build like this layout style bathroom page with borough
   multiplayer cards? ... original designs, interesting and keep eye design,
   not too ai generated and also informative and catch visitors"
  Chosen: a new section on /bathroom-renovation; real Google reviews and the
  neighborhoods served - nothing invented.

One card per area: a swipeable strip of our own bathroom photos, the Sani
mark, the area, the Google rating, a few plain badges, a quote box (a real
Google review, word for word, or - where there is no review to show - what
we do there, in the area page's own words), the neighborhoods, and two
a link to the area's own page. ("Maybe the buttons is too much in every
card" - the one estimate button is the quick form under the cards.)

Everything a card says comes from the site already: reviews from the
homepage's Google review cards, neighborhoods from each area page, the
rating from the schema. No project counts and no review is tied to a place
it did not come from - the section says the quotes are Google reviews.

Writes between <!-- BOROUGH-CARDS:START --> and <!-- BOROUGH-CARDS:END -->,
right after the stats bar. Safe to run again.
"""
import html, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
P = ROOT / "bathroom-renovation.html"
IDX = (ROOT / "index.html").read_text()
START, END = "<!-- BOROUGH-CARDS:START -->", "<!-- BOROUGH-CARDS:END -->"
E = lambda s: html.escape(s, quote=True)

# the homepage's Google reviews, word for word
REVIEWS = {}
for m in re.finditer(r'class="review-card".*?(?=class="review-card"|</section>)', IDX, re.S):
    c = m.group(0)
    who = re.search(r'class="review-meta-name">([^<]+)<', c)
    txt = re.search(r'class="review-text[^"]*"[^>]*>(.*?)</(?:p|div)>', c, re.S)
    if txt:
        body = " ".join(re.sub(r"<[^>]+>", " ", txt.group(1)).split())
        name = next((g for g in (who.groups() if who else ()) if g), None)
        REVIEWS[body[:40]] = (name, body)

def review(starts):
    k = next(k for k in REVIEWS if k.startswith(starts[:40]) or starts.startswith(k[:30]))
    return REVIEWS[k]

def excerpt(t, n=150):
    if len(t) <= n: return t
    cut = t[:n].rsplit(" ", 1)[0].rstrip(",.;:!—- ")
    return cut + "…"

CARDS = [
  dict(area="Brooklyn", title="Bathroom Remodeling in Brooklyn", href="/bathroom-renovation-brooklyn",
       banner="Free estimate within 24 hours",
       badges=["Brownstones & pre-war", "Walk-in showers"],
       review="Zura and his team were INCREDIBLE",
       hoods="Park Slope, Williamsburg, Brooklyn Heights, DUMBO, Cobble Hill",
       photos=["images/bathroom-areas/bathroom-renovation-hero.jpg", "images/bathroom-areas/brooklyn-marble-tile.jpg", "images/bathroom-areas/brooklyn-walk-in-shower.jpg"]),
  dict(area="Manhattan", title="Bathroom Renovation in Manhattan", href="/bathroom-renovation-manhattan",
       badges=["Co-ops & condos", "Building rules handled"],
       review="Zura and the Sani Building Corp team were fantastic",
       hoods="Upper East Side, Upper West Side, Tribeca, SoHo, Chelsea",
       photos=["images/bathroom-areas/floor-tile-bathroom-floor-tileinstallation-nyc-porc.jpg", "images/bathroom-areas/bathroom-renovation-feat-shower.jpg", "images/bathroom-areas/brooklyn-intro.jpg"]),
  dict(area="Queens", title="Bathroom Remodeling in Queens", href="/bathroom-renovation-queens",
       badges=["Homes, co-ops & condos", "Custom tile"],
       review="Zura and the team are exceptional",
       hoods="Astoria, Long Island City, Jackson Heights, Forest Hills, Sunnyside",
       photos=["images/bathroom-areas/floor-tile-bathroom-floor-tileinstallation-nyc-porc-5.jpg", "images/bathroom-areas/floor-tile-photo-mrpjwbwz.jpg", "images/bathroom-areas/bathroom-renovation-project-3.jpg"]),
  dict(area="the Bronx", title="Bathroom Remodeling in the Bronx", href="/renovation-contractor-bronx",
       badges=["Two & three-family homes", "Waterproofing"],
       review="Great experience with Sani Building Corp",
       hoods="Riverdale, Pelham Bay, Throgs Neck, Morris Park, Parkchester",
       photos=["images/bathroom-areas/bathroom-renovation-project-2.jpg", "images/bathroom-areas/bathroom-renovation-feat-waterproofing.jpg", "images/bathroom-areas/floor-tile-floor-tile.jpg"]),
  dict(area="Staten Island", title="Bathroom Remodeling on Staten Island", href="/renovation-contractor-staten-island",
       banner="Heated floors available",
       badges=["Full remodels", "Heated floors"],
       about="From St. George to Tottenville, Sani Building Corp delivers full-scale kitchen, bathroom, and home renovations across Staten Island.",
       hoods="St. George to Tottenville",
       photos=["images/bathroom-areas/bathroom-renovation-project-3.jpg", "images/bathroom-areas/floor-tile-bathroom-floor-tileinstallation-nyc-porc-3.jpg", "images/bathroom-areas/floor-tile-bathroom-floor-tileinstallation-nyc-porc-4.jpg"]),
  dict(area="Long Island", title="Bathroom Remodeling on Long Island", href="/renovation-contractor-long-island",
       badges=["Homes & family bathrooms", "Walk-in showers"],
       about="Professional renovation contractor services throughout Long Island. Project-based pricing. Free estimates within 24 hours.",
       hoods="Garden City, Great Neck, Manhasset, Roslyn, Hempstead",
       photos=["images/bathroom-areas/brooklyn-marble-tile.jpg", "images/bathroom-areas/bathroom-renovation-hero.jpg", "images/bathroom-areas/floor-tile-bathroom-floor-tileinstallation-nyc-porc-2.jpg"]),
]

MARK = ('<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M6 34V14L14 8L14 34M14 34V18L24 12L24 34M24 34V22L34 16L34 34" '
        'stroke="#f0a500" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>')
ICON = {
  "check": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  "pin": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  "tag": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8" r="1.4"/></svg>',
  "mail": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
}

def card(c, i):
    photos = "".join(
        f'<img src="{E(p)}" width="720" height="540" alt="{E("Bathroom remodel by Sani Building Corp, photo " + str(k + 1))}" loading="lazy" decoding="async">'
        for k, p in enumerate(c["photos"]))
    dots = "".join('<i class="on"></i>' if k == 0 else "<i></i>" for k in range(len(c["photos"])))
    banner = f'<div class="bc-banner">{ICON["tag"]}<span>{E(c["banner"])}</span></div>' if c.get("banner") else ""
    chips = "".join(f'<span class="bc-chip">{ICON["check"]}{E(b)}</span>' for b in ["Fully insured"] + c["badges"])
    if c.get("review"):
        name, body = review(c["review"])
        quote = (f'<figure class="bc-quote"><blockquote>“{E(excerpt(body))}”</blockquote>'
                 f'<figcaption>– {E(name or "Google reviewer")}, Google review</figcaption></figure>')
    else:
        quote = f'<div class="bc-quote bc-about"><p>{E(c["about"])}</p></div>'
    return f'''  <article class="bc-card">
    {banner}<div class="bc-photos" tabindex="0" aria-label="{E(c["area"])} bathroom photos, swipe for more">{photos}</div>
    <div class="bc-dots" aria-hidden="true">{dots}</div>
    <div class="bc-body">
      <div class="bc-mark">{MARK}</div>
      <h3>{E(c["title"])}</h3>
      <div class="bc-rating"><span class="bc-stars" aria-hidden="true">★★★★★</span><b>4.9</b><span>(67 Google reviews)</span></div>
      <div class="bc-kind">Bathroom Remodeling · Tile · Walk-in Showers</div>
      <div class="bc-chips">{chips}</div>
      {quote}
      <div class="bc-hoods">{ICON["pin"]}<span><b>Serving</b> {E(c["hoods"])}</span></div>
      <a class="bc-more" href="{E(c["href"])}">See {E(c["area"])} bathroom work →</a>
    </div>
  </article>'''

CSS = """<style id="borough-cards-css">
/* borough cards - ops/borough-cards.py */
.bc-section{background:#f3f1ec;padding:72px 20px}
.bc-inner{max-width:1180px;margin:0 auto}
.bc-head{max-width:720px;margin:0 0 30px}
.bc-head .eyebrow{color:var(--gold)}
.bc-head h2{font-size:clamp(28px,4vw,42px);line-height:1.1;color:#15181e;margin:10px 0 12px}
.bc-head p{color:#4a525e;font-size:17px;line-height:1.6;margin:0}
.bc-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}
.bc-card{background:#fff;border:1px solid #e3ddd2;border-radius:6px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 1px 2px rgba(20,24,30,.05)}
.bc-banner{display:flex;align-items:center;gap:8px;background:#15181e;color:#fff;font-size:15px;font-weight:600;padding:10px 16px}
.bc-banner svg{width:17px;height:17px;fill:none;stroke:#f0a500;stroke-width:2;stroke-linejoin:round}
.bc-photos{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;aspect-ratio:4/3;background:#ddd}
.bc-photos::-webkit-scrollbar{display:none}
.bc-photos img{flex:0 0 100%;width:100%;height:100%;object-fit:cover;scroll-snap-align:start}
.bc-dots{display:flex;justify-content:center;gap:7px;padding:10px 0 0}
.bc-dots i{width:8px;height:8px;border-radius:50%;background:#cfcac0}
.bc-dots i.on{background:#15181e}
.bc-body{position:relative;padding:8px 18px 20px;display:flex;flex-direction:column;flex:1}
.bc-mark{position:absolute;top:-44px;left:16px;width:52px;height:52px;border-radius:50%;background:#15181e;border:3px solid #fff;display:grid;place-items:center;box-shadow:0 2px 6px rgba(0,0,0,.2)}
.bc-mark svg{width:30px;height:30px}
.bc-body h3{font-size:21px;line-height:1.2;color:#15181e;margin:18px 0 6px}
.bc-rating{display:flex;align-items:center;gap:6px;font-size:16px;color:#15181e}
.bc-stars{color:#f5b301;letter-spacing:1px;font-size:18px}
.bc-rating span:last-child{color:#4a525e}
.bc-kind{color:#4a525e;font-size:15px;margin:4px 0 12px}
.bc-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
.bc-chip{display:inline-flex;align-items:center;gap:6px;background:#f1efea;border-radius:4px;padding:6px 10px;font-size:14.5px;font-weight:600;color:#15181e}
.bc-chip svg{width:15px;height:15px;fill:none;stroke:#1f8a4c;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.bc-quote{border:1px solid #e3ddd2;border-radius:4px;padding:14px 14px 12px;margin:0 0 14px}
.bc-quote blockquote{margin:0;font-size:17px;line-height:1.55;color:#15181e}
.bc-quote figcaption{margin-top:8px;font-size:14.5px;color:#5d6470}
.bc-about p{margin:0;font-size:17px;line-height:1.55;color:#15181e}
.bc-hoods{display:flex;gap:8px;align-items:flex-start;font-size:15.5px;line-height:1.45;color:#15181e;margin-bottom:16px}
.bc-hoods svg{flex:none;width:18px;height:18px;margin-top:2px;fill:none;stroke:#15181e;stroke-width:1.8}
.bc-cta{margin-top:auto;display:flex;align-items:center;justify-content:center;gap:10px;background:#15181e;color:#fff!important;text-decoration:none;font-weight:700;font-size:17px;padding:14px;border-radius:4px}
.bc-cta svg{width:19px;height:19px;fill:none;stroke:#fff;stroke-width:2}
.bc-cta:hover{background:#2b2926}
.bc-more{margin-top:auto;display:block;text-align:center;color:#15181e!important;font-weight:700;font-size:16px;text-decoration:none;border:1.5px solid #15181e;border-radius:999px;padding:12px 14px}
.bc-more:hover{background:#15181e;color:#fff!important}
.bc-note{margin:18px 0 0;font-size:14.5px;color:#5d6470}
@media(max-width:980px){.bc-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:640px){.bc-section{padding:52px 14px}.bc-grid{grid-template-columns:1fr;gap:18px}}
</style>"""

JS = """<script>
/* borough cards: the dots follow the photo in view */
(function(){document.querySelectorAll('.bc-card').forEach(function(c){var s=c.querySelector('.bc-photos'),d=c.querySelectorAll('.bc-dots i');if(!s||!d.length)return;s.addEventListener('scroll',function(){var i=Math.round(s.scrollLeft/Math.max(1,s.clientWidth));for(var k=0;k<d.length;k++)d[k].className=k===i?'on':'';},{passive:true});});})();
</script>"""

section = (START + "\n" + CSS + "\n"
  + '<section class="bc-section" id="boroughs">\n<div class="bc-inner">\n'
  + '  <div class="bc-head"><div class="eyebrow">Across NYC &amp; Long Island</div>'
  + '<h2>Bathroom Remodeling Near You</h2>'
  + '<p>One team, every borough. Pick your area to see our bathroom work there and get a free estimate.</p></div>\n'
  + '<div class="bc-grid">\n' + "\n".join(card(c, i) for i, c in enumerate(CARDS)) + '\n</div>\n'
  + '  <p class="bc-note">Quotes are from our Google reviews.</p>\n'
  + '</div>\n</section>\n' + JS + "\n" + END)

page = P.read_text()
if START in page:
    page = re.sub(re.escape(START) + r".*?" + re.escape(END), lambda m: section, page, flags=re.S)
else:
    anchor = "<!-- ============ NO-DEMO PROMO BAND ============ -->"
    assert page.count(anchor) == 1
    page = page.replace(anchor, section + "\n\n" + anchor)
P.write_text(page)
for c in CARDS:
    for p in c["photos"]:
        assert (ROOT / p).exists(), p
print("borough cards:", len(CARDS), "areas;", sum(1 for c in CARDS if c.get("review")), "with a Google review")
