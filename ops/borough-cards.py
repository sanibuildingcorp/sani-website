#!/usr/bin/env python3
"""Bathroom remodeling near you - ONE Sani section with area tabs.

  "It's looks like next door and yelp and other website which cards looks
   separately workers offers. I need redesign this with super popular
   interesting web page for lets customer choose us and contact us for
   bathroom renovations!"
  -> Six look-alike listing cards became one branded block: the rating and
  trust line once, a tab per area, one big panel (photos, our own bathroom
  text, neighborhoods, "Get my free estimate" + call), and the real Google
  reviews together underneath.

Earlier brief (kept for the record): a Houzz-style listing.

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
  dict(area="Brooklyn", seo='Bathroom remodeling in Brooklyn brownstones, pre-war apartments and row houses: full gut renovations, walk-in showers, tub-to-shower conversions, marble and porcelain tile, shower waterproofing and new vanities. One crew from demolition to the final caulk line.', form='Brooklyn', title="Bathroom Remodeling in Brooklyn", href="/bathroom-renovation-brooklyn",
       banner="Free estimate within 24 hours",
       badges=["Brownstones & pre-war", "Walk-in showers"],
       review="Zura and his team were INCREDIBLE",
       hoods="Park Slope, Williamsburg, Brooklyn Heights, DUMBO, Cobble Hill",
       photos=["images/bathroom-areas/bathroom-renovation-hero.jpg", "images/bathroom-areas/brooklyn-marble-tile.jpg", "images/bathroom-areas/brooklyn-walk-in-shower.jpg"]),
  dict(area="Manhattan", seo="Bathroom renovation in Manhattan co-ops and condos: we work within your building's rules, provide the certificate of insurance and keep the hallway clean. Walk-in showers, custom tile, waterproofing, vanities and lighting for small and master bathrooms.", form='Manhattan', title="Bathroom Renovation in Manhattan", href="/bathroom-renovation-manhattan",
       badges=["Co-ops & condos", "Building rules handled"],
       review="Zura and the Sani Building Corp team were fantastic",
       hoods="Upper East Side, Upper West Side, Tribeca, SoHo, Chelsea",
       photos=["images/bathroom-areas/floor-tile-bathroom-floor-tileinstallation-nyc-porc.jpg", "images/bathroom-areas/bathroom-renovation-feat-shower.jpg", "images/bathroom-areas/brooklyn-intro.jpg"]),
  dict(area="Queens", seo='Bathroom remodeling in Queens homes, co-ops and condos: custom tile showers, tub replacements, walk-in showers, floor and wall tile, vanities and toilets. Clear written estimates and a tidy job site every day.', form='Queens', title="Bathroom Remodeling in Queens", href="/bathroom-renovation-queens",
       badges=["Homes, co-ops & condos", "Custom tile"],
       review="Zura and the team are exceptional",
       hoods="Astoria, Long Island City, Jackson Heights, Forest Hills, Sunnyside",
       photos=["images/bathroom-areas/floor-tile-bathroom-floor-tileinstallation-nyc-porc-5.jpg", "images/bathroom-areas/floor-tile-photo-mrpjwbwz.jpg", "images/bathroom-areas/bathroom-renovation-project-3.jpg"]),
  dict(area="the Bronx", seo='Bathroom remodeling in the Bronx for two- and three-family homes and apartments: shower waterproofing, new tile, tub-to-shower conversions, vanities and full bathroom renovations, planned so the household keeps one working bathroom where possible.', form='Bronx', title="Bathroom Remodeling in the Bronx", href="/renovation-contractor-bronx",
       badges=["Two & three-family homes", "Waterproofing"],
       review="Great experience with Sani Building Corp",
       hoods="Riverdale, Pelham Bay, Throgs Neck, Morris Park, Parkchester",
       photos=["images/bathroom-areas/bathroom-renovation-project-2.jpg", "images/bathroom-areas/bathroom-renovation-feat-waterproofing.jpg", "images/bathroom-areas/floor-tile-floor-tile.jpg"]),
  dict(area="Staten Island", seo='Bathroom remodeling on Staten Island: full bathroom remodels, heated floors, walk-in showers, tile and new vanities for family homes from St. George to Tottenville.', form='Staten Island', title="Bathroom Remodeling on Staten Island", href="/renovation-contractor-staten-island",
       banner="Heated floors available",
       badges=["Full remodels", "Heated floors"],
       hoods="St. George to Tottenville",
       photos=["images/bathroom-areas/bathroom-renovation-project-3.jpg", "images/bathroom-areas/floor-tile-bathroom-floor-tileinstallation-nyc-porc-3.jpg", "images/bathroom-areas/floor-tile-bathroom-floor-tileinstallation-nyc-porc-4.jpg"]),
  dict(area="Long Island", seo='Bathroom remodeling on Long Island: family bathrooms, master bathroom renovations, walk-in showers, tile and vanities in Nassau County homes.', form='Long Island', title="Bathroom Remodeling on Long Island", href="/renovation-contractor-long-island",
       badges=["Homes & family bathrooms", "Walk-in showers"],
       hoods="Garden City, Great Neck, Manhasset, Roslyn, Hempstead",
       photos=["images/bathroom-areas/brooklyn-marble-tile.jpg", "images/bathroom-areas/bathroom-renovation-hero.jpg", "images/bathroom-areas/floor-tile-bathroom-floor-tileinstallation-nyc-porc-2.jpg"]),
]

ICON = {
  "check": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  "pin": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  "phone": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
}
slug = lambda a: re.sub(r"[^a-z]+", "-", a.lower().replace("the ", "")).strip("-")

def tab(c, i):
    on = i == 0
    return (f'<button type="button" class="bc-tab{" on" if on else ""}" role="tab" id="bc-t-{slug(c["area"])}" '
            f'aria-controls="bc-p-{slug(c["area"])}" aria-selected="{"true" if on else "false"}">{E(c["area"].replace("the Bronx", "Bronx"))}</button>')

def panel(c, i):
    where = ("on " if c["area"] in ("Staten Island", "Long Island") else "in ") + c["area"]
    photos = "".join(
        f'<img src="{E(p)}" width="720" height="540" alt="{E("Bathroom remodeling " + where + " by Sani Building Corp, photo " + str(k + 1))}" loading="lazy" decoding="async">'
        for k, p in enumerate(c["photos"]))
    dots = "".join('<i class="on"></i>' if k == 0 else "<i></i>" for k in range(len(c["photos"])))
    badge = f'<span class="bc-badge">{E(c["banner"])}</span>' if c.get("banner") else ""
    items = "".join(f'<li>{ICON["check"]}{E(b)}</li>' for b in ["Fully insured"] + c["badges"])
    return f'''  <article class="bc-panel{" on" if i == 0 else ""}" id="bc-p-{slug(c["area"])}" role="tabpanel" aria-labelledby="bc-t-{slug(c["area"])}">
    <div class="bc-media"><div class="bc-photos" tabindex="0" aria-label="{E(c["area"])} bathroom photos, swipe for more">{photos}</div>{badge}<div class="bc-dots" aria-hidden="true">{dots}</div></div>
    <div class="bc-body">
      <h3>{E(c["title"])}</h3>
      <p class="bc-seo">{E(c["seo"])}</p>
      <ul class="bc-list">{items}</ul>
      <p class="bc-hoods">{ICON["pin"]}<span><b>Serving</b> {E(c["hoods"])}</span></p>
      <div class="bc-actions"><a class="bc-cta" href="#quick-estimate" data-area="{E(c["form"])}">Get my free estimate</a><a class="bc-call" href="tel:3322770990">{ICON["phone"]}(332) 277-0990</a></div>
      <a class="bc-more" href="{E(c["href"])}">See {E(c["area"])} bathroom work &rarr;</a>
    </div>
  </article>'''

def quote(starts):
    name, body = review(starts)
    return (f'<figure class="bc-rv"><div class="bc-stars" aria-label="5 stars">★★★★★</div><blockquote>“{E(excerpt(body))}”</blockquote>'
            f'<figcaption>{E(name or "Google reviewer")} · Google review</figcaption></figure>')

CSS = """<style id="borough-cards-css">
/* bathroom remodeling near you - ops/borough-cards.py */
.bc-section{background:#f3f1ec;padding:72px 20px}
.bc-inner{max-width:1180px;margin:0 auto}
.bc-head{max-width:760px;margin:0 0 26px}
.bc-head .eyebrow{color:var(--gold)}
.bc-head h2{font-size:clamp(30px,4.4vw,46px);line-height:1.08;color:#15181e;margin:10px 0 12px}
.bc-head p{color:#4a525e;font-size:17px;line-height:1.6;margin:0}
.bc-trust{display:flex;flex-wrap:wrap;gap:10px 18px;margin-top:16px;font-size:15.5px;color:#15181e}
.bc-trust span{display:inline-flex;align-items:center;gap:6px;font-weight:600}
.bc-trust svg{width:16px;height:16px;fill:none;stroke:#1f8a4c;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.bc-stars{color:#f5b301;letter-spacing:1px}
.bc-tabs{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;margin:0 0 18px;padding:2px}
.bc-tabs::-webkit-scrollbar{display:none}
.bc-tab{flex:none;font:inherit;font-size:16px;font-weight:700;color:#15181e;background:#fff;border:1.5px solid #d9d3c7;border-radius:999px;padding:11px 20px;cursor:pointer}
.bc-tab:hover{border-color:#15181e}
.bc-tab.on{background:#15181e;border-color:#15181e;color:#fff}
.bc-tab:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
.bc-panel{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 18px 40px -22px rgba(20,24,30,.35);margin-bottom:18px}
.bc-section.js .bc-panel:not(.on){display:none}
.bc-media{position:relative;background:#ddd;min-width:0;min-height:440px;overflow:hidden}
.bc-photos{position:absolute;inset:0;display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none}
.bc-photos::-webkit-scrollbar{display:none}
.bc-photos img{flex:0 0 100%;width:100%;height:100%;object-fit:cover;scroll-snap-align:start}
.bc-badge{position:absolute;top:14px;left:14px;background:#15181e;color:#fff;font-size:14px;font-weight:700;padding:7px 12px;border-radius:999px}
.bc-dots{position:absolute;left:0;right:0;bottom:12px;display:flex;justify-content:center;gap:7px}
.bc-dots i{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.6)}
.bc-dots i.on{background:#fff}
.bc-body{padding:28px 30px;display:flex;flex-direction:column}
.bc-body h3{font-size:clamp(23px,2.6vw,30px);line-height:1.15;color:#15181e;margin:0 0 12px}
.bc-seo{font-size:16.5px;line-height:1.65;color:#2b313b;margin:0 0 16px}
.bc-list{list-style:none;margin:0 0 14px;padding:0;display:flex;flex-wrap:wrap;gap:8px}
.bc-list li{display:inline-flex;align-items:center;gap:6px;background:#f1efea;border-radius:999px;padding:7px 12px;font-size:14.5px;font-weight:600;color:#15181e}
.bc-list svg{width:15px;height:15px;fill:none;stroke:#1f8a4c;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.bc-hoods{display:flex;gap:8px;align-items:flex-start;font-size:15.5px;line-height:1.45;color:#15181e;margin:0 0 20px}
.bc-hoods svg{flex:none;width:18px;height:18px;margin-top:2px;fill:none;stroke:#15181e;stroke-width:1.8}
.bc-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:auto}
.bc-cta{flex:1 1 220px;display:flex;align-items:center;justify-content:center;background:#f0a500;color:#15181e!important;text-decoration:none;font-weight:800;font-size:17px;padding:15px 18px;border-radius:10px}
.bc-cta:hover{background:#ffb81c}
.bc-call{flex:1 1 180px;display:flex;align-items:center;justify-content:center;gap:8px;border:1.5px solid #15181e;color:#15181e!important;text-decoration:none;font-weight:700;font-size:16.5px;padding:14px 16px;border-radius:10px}
.bc-call svg{width:18px;height:18px;fill:none;stroke:#15181e;stroke-width:1.9;stroke-linejoin:round}
.bc-call:hover{background:#15181e;color:#fff!important}.bc-call:hover svg{stroke:#fff}
.bc-more{margin-top:14px;align-self:flex-start;color:#15181e!important;font-weight:700;font-size:15.5px;text-decoration:underline;text-underline-offset:3px}
.bc-reviews{margin-top:34px}
.bc-reviews h3{font-size:clamp(22px,2.6vw,28px);color:#15181e;margin:0 0 14px}
.bc-rv-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.bc-rv{margin:0;background:#fff;border:1px solid #e3ddd2;border-radius:12px;padding:16px}
.bc-rv .bc-stars{font-size:16px}
.bc-rv blockquote{margin:8px 0 10px;font-size:16px;line-height:1.55;color:#15181e}
.bc-rv figcaption{font-size:14px;color:#5d6470}
.bc-note{margin:14px 0 0;font-size:14.5px;color:#5d6470}
@media(max-width:980px){.bc-panel{grid-template-columns:1fr}.bc-media{min-height:0;aspect-ratio:4/3}.bc-rv-row{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:640px){.bc-section{padding:52px 16px}.bc-body{padding:20px 18px 22px}.bc-tabs{margin-left:-16px;margin-right:-16px;padding:2px 16px}
.bc-rv-row{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none}.bc-rv-row::-webkit-scrollbar{display:none}.bc-rv{flex:0 0 82%;scroll-snap-align:start}}
</style>"""

JS = """<script>
/* bathroom remodeling near you: area tabs, photo dots, and "Get my free
   estimate" fills in the area on the quick form below */
(function(){
  var sec=document.getElementById('boroughs'); if(!sec) return;
  sec.classList.add('js');
  var tabs=sec.querySelectorAll('.bc-tab'), panels=sec.querySelectorAll('.bc-panel');
  function show(i,focus){for(var k=0;k<tabs.length;k++){var on=k===i;tabs[k].classList.toggle('on',on);tabs[k].setAttribute('aria-selected',on?'true':'false');tabs[k].tabIndex=on?0:-1;panels[k].classList.toggle('on',on);} if(focus) tabs[i].focus();}
  for(var i=0;i<tabs.length;i++)(function(i){tabs[i].addEventListener('click',function(){show(i);});tabs[i].addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();show((i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length,true);}});})(i);
  show(0);
  sec.querySelectorAll('.bc-panel').forEach(function(c){var s=c.querySelector('.bc-photos'),d=c.querySelectorAll('.bc-dots i');if(!s||!d.length)return;s.addEventListener('scroll',function(){var i=Math.round(s.scrollLeft/Math.max(1,s.clientWidth));for(var k=0;k<d.length;k++)d[k].className=k===i?'on':'';},{passive:true});});
  sec.querySelectorAll('.bc-cta[data-area]').forEach(function(a){a.addEventListener('click',function(){var sel=document.querySelector('#qeForm select[name="borough"]');if(sel){for(var k=0;k<sel.options.length;k++){if(sel.options[k].text===a.getAttribute('data-area')){sel.selectedIndex=k;break;}}}});});
})();
</script>"""

REVIEW_STARTS = [c["review"] for c in CARDS if c.get("review")]
TRUST = ('<div class="bc-trust"><span><span class="bc-stars" aria-hidden="true">★★★★★</span> 4.9 · 68 Google reviews</span>'
         f'<span>{ICON["check"]}Fully insured</span><span>{ICON["check"]}Free estimate within 24 hours</span></div>')

section = (START + "\n" + CSS + "\n"
  + '<section class="bc-section" id="boroughs">\n<div class="bc-inner">\n'
  + '  <div class="bc-head"><div class="eyebrow">Bathroom remodeling · NYC &amp; Long Island</div>'
  + '<h2>Bathroom Remodeling Near You</h2>'
  + '<p>One Sani Building Corp crew in every borough. Pick your area, see our bathroom work there, and get a free estimate.</p>'
  + TRUST + '</div>\n'
  + '  <div class="bc-tabs" role="tablist" aria-label="Choose your area">' + "".join(tab(c, i) for i, c in enumerate(CARDS)) + '</div>\n'
  + "\n".join(panel(c, i) for i, c in enumerate(CARDS)) + '\n'
  + '  <div class="bc-reviews"><h3>What our customers say</h3><div class="bc-rv-row">'
  + "".join(quote(r) for r in REVIEW_STARTS) + '</div>\n'
  + '  <p class="bc-note">Quotes are from our Google reviews.</p></div>\n'
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
print("bathroom near you:", len(CARDS), "areas;", len(REVIEW_STARTS), "Google reviews")
