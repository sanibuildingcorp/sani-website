#!/usr/bin/env python3
"""Builds shower-waterproofing.html: shower waterproofing, shower pan
replacement, leaking shower repair and tub-to-shower conversion.

  "Shower waterproofing, Shower pan replacement, Leaking shower repair,
   Tub to shower conversion" - the shower jobs Sani does. Semrush: shower
   waterproofing 1,900/mo (difficulty 13), shower pan replacement 880/mo (9),
   leaking shower repair 320/mo (18) - and no page on the site for any of them.

It wears the wall panels page's design: the same style block, menu, footer,
mobile bar and scripts are copied from bathroom-wall-panels.html, so the two
sister pages look alike and a fix to one design is one copy away. The words,
schema and FAQ are below; the FAQ schema is built from the same list as the
visible FAQ, so the two can never disagree. Safe to run again.
"""
import json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = (ROOT / "bathroom-wall-panels.html").read_text()
URL = "https://www.sanibuildingcorp.com/shower-waterproofing"
IMG = "images/shower-waterproofing/"
PHONE = "332-277-0990"

style = re.search(r"\n(<style>\n/\* ════════════ PAGE-SPECIFIC STYLES.*?</style>)\n</head>", SRC, re.S).group(1)
tail = SRC[SRC.index("</main>"):]
provider = json.loads(re.search(r'<!-- Service Schema -->\n<script type="application/ld\+json">(.*?)</script>', SRC, re.S).group(1))["provider"]

TITLE = "Shower Waterproofing &amp; Shower Pan Replacement NYC"
DESC = ("Leaking shower? We waterproof showers, replace shower pans, repair shower leaks and convert tubs "
        "to walk-in showers across NYC. Fully insured, 3-year workmanship warranty. (332) 277-0990.")

FAQ = [
    ("How do I know if my shower is leaking?",
     "The usual signs are a water stain on the ceiling below, floor tile that is loose or sounds hollow, grout that keeps cracking, "
     "a musty smell or mold that comes back after cleaning, and a soft floor or swollen baseboard outside the shower. "
     "In an apartment, a neighbor below often notices first."),
    ("Can you fix a leaking shower without redoing the whole bathroom?",
     "Often, yes. If the water gets out through cracked grout or failed caulk, regrouting and resealing may be all it needs. "
     "If the shower pan or drain is leaking, we replace the shower floor and waterproof it, and the walls can often stay."),
    ("What is shower waterproofing?",
     "Tile and grout are not waterproof on their own. Shower waterproofing is the membrane behind the tile, on the walls and the floor, "
     "sealed at every corner, seam, niche and pipe, so water that gets through the grout goes to the drain instead of into the walls and the floor below."),
    ("How long does a shower pan replacement take?",
     "Usually a few days. The old floor comes out, the new pan is built with the right slope to the drain, waterproofed and tested, "
     "and the materials need time to cure before the tile goes on. You get the schedule in writing with the price."),
    ("Can you convert my bathtub into a walk-in shower?",
     "Yes. We take out the tub, move or adjust the drain, build and waterproof a new shower pan, tile it, and finish with a glass door or panel "
     "and a built-in niche if you want one. It is one of the most asked-for bathroom upgrades in NYC apartments."),
    ("Do you work in co-ops and apartment buildings?",
     "Yes. Most of our shower work is in NYC apartments, co-ops and condos. We protect the halls, follow the building's work rules and hours, "
     "and can send the insurance certificate your board or management company asks for."),
    ("Is the work guaranteed?",
     "Yes. Sani Building Corp is fully insured, and our shower work carries a 3-year workmanship warranty."),
    ("Which areas do you serve?",
     "Sani Building Corp is based in Brooklyn and serves all five NYC boroughs — Brooklyn, Manhattan, Queens, the Bronx and Staten Island — "
     "plus Long Island and Nassau County."),
]

service = {
    "@context": "https://schema.org", "@type": "Service",
    "name": "Shower Waterproofing, Shower Pan Replacement & Leaking Shower Repair",
    "description": "Shower waterproofing membranes, shower pan replacement, leaking shower repair and tub-to-shower conversions "
                   "for NYC apartments, co-ops, condos, homes and businesses. Fully insured, 3-year workmanship warranty.",
    "serviceType": ["Shower Waterproofing", "Shower Pan Replacement", "Leaking Shower Repair",
                    "Tub to Shower Conversion", "Walk-in Shower Installation", "Bathroom Waterproofing"],
    "provider": provider,
    "areaServed": [{"@type": "City", "name": n} for n in ["Brooklyn", "Manhattan", "Queens", "Bronx", "Staten Island"]]
                  + [{"@type": "AdministrativeArea", "name": n} for n in ["Long Island", "Nassau County"]],
    "url": URL,
    "offers": {"@type": "Offer", "availability": "https://schema.org/InStock", "areaServed": "New York City"},
}
crumbs = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
    {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.sanibuildingcorp.com/"},
    {"@type": "ListItem", "position": 2, "name": "Bathroom Renovation", "item": "https://www.sanibuildingcorp.com/bathroom-renovation"},
    {"@type": "ListItem", "position": 3, "name": "Shower Waterproofing", "item": URL}]}
faq_ld = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
    {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQ]}
ld = lambda o: '<script type="application/ld+json">' + json.dumps(o, ensure_ascii=False) + "</script>"
esc = lambda t: t.replace("&", "&amp;")

def job(ico, h, p, img, alt):
    return f'''      <div class="benefit reveal">
        <div class="benefit-text"><div class="ico">{ico}</div><h3>{h}</h3><p>{p}</p></div>
        <div class="benefit-photo surface--white"><img class="zoom" src="{IMG}{img}" alt="{alt}" width="825" height="1100" decoding="async" loading="lazy"></div>
      </div>'''

def sign(k, v):
    return f'      <div class="spec reveal"><div class="k">{k}</div><div class="v">{v}</div></div>'

faq_html = "\n".join(f'''      <div class="faq-item">
        <button class="faq-q">{esc(q)}<span class="plus">+</span></button>
        <div class="faq-a"><p>{esc(a)}</p></div>
      </div>''' for q, a in FAQ)

main = f'''<main class="wp">

<!-- ============ HERO ============ -->
<section class="wp-hero">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <span class="eyebrow">Shower Waterproofing &middot; NYC</span>
      <h1>Shower Waterproofing &amp; Shower Pan Replacement <span class="italic-accent">— Leaks Fixed at the Source</span></h1>
      <p class="hero-sub">Stain on the ceiling below? Loose floor tile, grout that keeps cracking? We find where the water gets out, open only what has to come out, rebuild and waterproof the shower, and tile it back.</p>
      <ul class="hero-list">
        <li>Leaking shower repair</li>
        <li>Shower pan replacement</li>
        <li>Waterproof membrane</li>
        <li>Tub to shower conversion</li>
        <li>3-year workmanship warranty</li>
      </ul>
      <div class="hero-actions">
        <a href="#quote" class="btn btn-gold">Get a free estimate</a>
        <a href="tel:3322770990" class="hero-phone">📞 {PHONE}</a>
      </div>
    </div>
    <div class="ba-shell">
      <div class="ba-frame"><img class="sw-hero-img zoom" src="{IMG}walk-in-shower-waterproofed-nyc.jpg" alt="Walk-in shower with a waterproofed pan, built-in niche and glass door, finished by Sani Building Corp in NYC" width="825" height="1100" fetchpriority="high" decoding="async"></div>
      <p class="ba-caption"><strong>Waterproofed first, then tiled</strong> — one of our finished walk-in showers.</p>
    </div>
  </div>
</section>

<!-- ============ SIGNS ============ -->
<section class="wp-section specs">
  <div class="wrap">
    <div class="section-head reveal">
      <span class="eyebrow">Is your shower leaking?</span>
      <h2>Six signs the water is getting out</h2>
      <p>A shower can leak for months before it shows. If you see any of these, have it checked before the damage spreads to the floor or the apartment below.</p>
    </div>
    <div class="spec-grid">
{sign("Ceiling below", "A water stain or bubbling paint under the bathroom")}
{sign("Floor tile", "Loose, cracked or hollow-sounding tile in the shower")}
{sign("Grout", "Grout that keeps cracking or falling out")}
{sign("Mold", "Mold or a musty smell that comes back after cleaning")}
{sign("Caulk", "Caulk that will not stay sealed at the corners")}
{sign("Outside the shower", "A soft floor or swollen baseboard next to it")}
    </div>
  </div>
</section>

<!-- ============ THE FOUR JOBS ============ -->
<section class="wp-section">
  <div class="wrap">
    <div class="section-head reveal">
      <span class="eyebrow">What we do</span>
      <h2>Four shower jobs, done properly</h2>
      <p>Tile is the finish. What keeps the water in is underneath it — that is the part we rebuild.</p>
    </div>
    <div class="benefits">
{job("💧", "Shower waterproofing", "A waterproof membrane on the walls and the floor, behind the tile, sealed at every corner, seam, niche and pipe.", "shower-waterproofing-brooklyn.jpg", "Waterproofed corner shower with glass door in a Brooklyn bathroom")}
{job("🧱", "Shower pan replacement", "The old leaking pan comes out. We rebuild the slope to the drain, waterproof it and tile it again.", "shower-pan-replacement-nyc.jpg", "New shower pan being tiled with hexagon mosaic after replacement in NYC")}
{job("🔍", "Leaking shower repair", "We find where the water gets out — grout, drain, pan, valve or glass — and fix that, not only the stain.", "leaking-shower-repair-nyc.jpg", "Leaking shower floor opened up for repair in an NYC apartment")}
{job("🚿", "Tub to shower conversion", "The tub comes out and a waterproofed walk-in shower goes in, with glass and a built-in niche if you want one.", "tub-to-shower-conversion-nyc.jpg", "Walk-in shower with glass enclosure after a tub to shower conversion in NYC")}
    </div>
  </div>
</section>

<!-- ============ PROCESS ============ -->
<section class="wp-section" style="background:var(--white);border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
  <div class="wrap">
    <div class="section-head reveal">
      <span class="eyebrow">How it works</span>
      <h2>From leak to dry in five steps</h2>
      <p>You get the price and the schedule in writing before any work starts.</p>
    </div>
    <div class="process">
      <div class="pstep reveal"><div class="num">1</div><h3>Inspection</h3><p>We find where the water is getting out, and how far it has gone.</p></div>
      <div class="pstep reveal"><div class="num">2</div><h3>Written price</h3><p>A fixed price for the scope — not an hourly guess.</p></div>
      <div class="pstep reveal"><div class="num">3</div><h3>Tear-out</h3><p>Only what has to come out. Halls and floors protected.</p></div>
      <div class="pstep reveal"><div class="num">4</div><h3>Rebuild &amp; waterproof</h3><p>New pan and slope to the drain, membrane sealed at every seam, then tested with water.</p></div>
      <div class="pstep reveal"><div class="num">5</div><h3>Tile &amp; finish</h3><p>Tile, grout, glass and caulk — a shower that stays dry.</p></div>
    </div>
  </div>
</section>

<!-- ============ PANELS OPTION ============ -->
<section class="wp-section">
  <div class="wrap">
    <div class="section-head reveal">
      <span class="eyebrow">Walls only?</span>
      <h2>No need to re-tile the walls</h2>
      <p>If the pan is sound and the water comes through the grout on the walls, waterproof acrylic or PVC wall panels can go right over the old tile in 1–2 days — with no grout left to fail. We tell you at the estimate which one your shower needs.</p>
      <p style="margin-top:22px"><a href="/bathroom-wall-panels" class="btn btn-navy">See shower wall panels</a></p>
    </div>
  </div>
</section>

<!-- ============ CTA BAND ============ -->
<section class="wp-section cta-band" id="quote">
  <div class="wrap">
    <h2>Get a free shower estimate</h2>
    <p>Tell us what you see — a stain, a loose tile, a tub you want gone — and we will tell you what it needs. Serving Brooklyn and all five NYC boroughs, plus Long Island and Nassau County.</p>
    <div class="cta-actions">
      <a href="tel:3322770990" class="phone-big">📞 {PHONE}</a>
      <a href="/contact" class="btn btn-navy">Request an estimate</a>
    </div>
  </div>
</section>

<!-- ============ FAQ ============ -->
<section class="wp-section">
  <div class="wrap">
    <div class="section-head reveal">
      <span class="eyebrow">Good to know</span>
      <h2>Frequently asked questions</h2>
    </div>
    <div class="faq" id="faq">
{faq_html}
    </div>
  </div>
</section>
<style>.sbc-ilink{{display:inline-block;padding:11px 20px;background:#fff;border:1px solid rgba(10,22,40,0.12);border-radius:30px;color:#0a1628;text-decoration:none;font-size:14px;font-weight:500;transition:all .2s}}.sbc-ilink:hover{{border-color:#c8860a;color:#c8860a;box-shadow:0 4px 16px rgba(0,0,0,.06)}}</style>
<section style="padding:72px 28px;background:#f7f5f2">
  <div style="max-width:960px;margin:0 auto;text-align:center">
    <div style="color:#c8860a;font-size:12px;letter-spacing:3px;text-transform:uppercase;font-weight:600;margin-bottom:14px">Explore More</div>
    <h2 style="font-family:'Playfair Display',serif;font-size:clamp(24px,3.5vw,34px);color:#0a1628;margin:0 0 28px;line-height:1.2">Related Services &amp; Service Areas</h2>
    <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center">
      <a class="sbc-ilink" href="/bathroom-wall-panels">Shower Wall Panels</a>
      <a class="sbc-ilink" href="/tile-grouting-restoration">Regrouting &amp; Tile Repair</a>
      <a class="sbc-ilink" href="/bathroom-renovation">Bathroom Remodeling NYC</a>
      <a class="sbc-ilink" href="/bathroom-floor-tile-installation">Bathroom Floor Tile</a>
      <a class="sbc-ilink" href="/bathroom-renovation-brooklyn">Bathroom Renovation Brooklyn</a>
      <a class="sbc-ilink" href="/bathroom-renovation-manhattan">Bathroom Renovation Manhattan</a>
      <a class="sbc-ilink" href="/bathroom-renovation-queens">Bathroom Renovation Queens</a>
      <a class="sbc-ilink" href="/water-damage">Water Damage Repair</a>
      <a class="sbc-ilink" href="/tile-installation-cost-nyc">Tile Installation Cost</a>
    </div>
  </div>
</section>
'''

head = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
<title>{TITLE}</title>
<meta name="description" content="{DESC}">
<meta name="keywords" content="shower waterproofing NYC, shower pan replacement, leaking shower repair, shower leak repair Brooklyn, tub to shower conversion NYC, walk-in shower installation, bathroom waterproofing">
<link rel="canonical" href="{URL}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="{URL}">
    <meta property="og:title" content="Shower Waterproofing &amp; Pan Replacement NYC | Sani Building Corp">
    <meta property="og:description" content="Leaking shower? Waterproofing, shower pan replacement, leak repair and tub-to-shower conversions across NYC. Fully insured. Free estimates.">
    <meta property="og:image" content="https://www.sanibuildingcorp.com/images/og/shower-waterproofing-og.jpg">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Shower Waterproofing &amp; Pan Replacement NYC | Sani Building Corp">
    <meta name="twitter:description" content="Leaking shower? Waterproofing, shower pan replacement, leak repair and tub-to-shower conversions across NYC. Fully insured. Free estimates.">
    <meta name="twitter:image" content="https://www.sanibuildingcorp.com/images/og/shower-waterproofing-og.jpg">
<link rel="preload" as="image" href="{IMG}walk-in-shower-waterproofed-nyc.jpg" fetchpriority="high">

<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;0,700;0,800;1,500;1,600&family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet">

<!-- Shared site styles (menu + footer + palette) -->
<link rel="stylesheet" href="partials/site.css">

<!-- Service Schema -->
{ld(service)}

<!-- Breadcrumb Schema -->
{ld(crumbs)}

<!-- FAQ Schema (built from the same list as the visible FAQ) -->
{ld(faq_ld)}

{style}
<style>
/* this page only: a photo where the wall panels page has its slider */
.sw-hero-img{{width:100%;aspect-ratio:4/5;object-fit:cover;display:block;border-radius:8px}}
@media(max-width:900px){{.sw-hero-img{{aspect-ratio:4/3}}}}
</style>
</head>
<body>

<!-- Menu loaded from partials/menu.html via partials/site.js -->
<div id="site-menu"></div>

'''

(ROOT / "shower-waterproofing.html").write_text(head + main + tail)
print("shower-waterproofing.html built")
