#!/usr/bin/env python3
"""Builds tub-to-shower-conversion.html: bathtub to walk-in shower.

  "Last couple days i have very good bookings for transforming bathtub to
   walking shower ... many are also disabled persons. I created explanation
   photos ... In some of them bathroom we can transform with only first line
   tile removing for tub removing and some of them we must have to demo whole
   walls tiles ... if current wall tiles are small format as subway tiles ...
   we may able to found matching tiles ... if them current tiles are big
   format then we must demo whole around tub walls tile"

It wears the shower waterproofing page's design: head extras, styles, menu,
footer, mobile bar and scripts are copied from shower-waterproofing.html; the
words, schema and FAQ are below. The FAQ schema is built from the same list as
the visible FAQ. Safe to run again.
"""
import json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = (ROOT / "shower-waterproofing.html").read_text()
URL = "https://www.sanibuildingcorp.com/tub-to-shower-conversion"
IMG = "images/tub-to-shower/"
PHONE = "332-277-0990"

TITLE = "Bathtub to Walk-In Shower Conversion NYC | Sani Building Corp"
DESC = ("Tub to walk-in shower conversion in NYC: safe low-entry showers for seniors and limited mobility, fully waterproofed, "
        "matching tile when possible. Fully insured, 3-year warranty. (332) 277-0990.")
OG_T = "Bathtub to Walk-In Shower Conversion NYC | Sani Building Corp"
OG_D = "Tub out, safe walk-in shower in. Two ways to convert, fully waterproofed, for NYC homes and apartments. Free estimates."

FAQ = [
    ("Can you convert my bathtub into a walk-in shower?",
     "Yes. We take out the tub, build a new waterproofed shower floor that slopes to the drain, waterproof the walls, tile it, "
     "and finish with a glass door or panel. Most NYC bathrooms with a standard tub alcove can be converted."),
    ("Do I have to replace all the wall tile?",
     "Not always. If your wall tile is small, like subway tile or small squares, we can often remove only the tub and the bottom rows of tile "
     "and continue with a matching tile, so the upper walls stay. If the tile is large format, or no exact match can be found, "
     "we replace the tile on the three shower walls so the new shower looks clean and finished. We tell you which one your bathroom needs at the estimate."),
    ("Is a walk-in shower safer for seniors and people with limited mobility?",
     "Yes, that is the main reason many of our customers convert. There is no tub wall to step over. We can build a low or flush entrance "
     "where the floor and drain allow, and add grab bars, a shower bench, a handheld shower and a slip-resistant floor tile."),
    ("Can the shower be curbless, with no step at all?",
     "Often a low or flush entrance is possible. It depends on the floor structure and where the drain can go, which we check before we price the job. "
     "If a fully flush entrance is not possible, we build the lowest curb the floor allows."),
    ("Can you help me design the new shower tile?",
     "Yes. When the tile on the shower walls is replaced, we help you choose a new design that works with the tile that stays on the other walls, "
     "which we do not touch. Many customers now choose two or three tile colors together — a main tile with a decor tile or an accent wall — "
     "for a modern look without redoing the whole bathroom. We show you the design options before any work starts."),
    ("How long does a tub to shower conversion take?",
     "Keeping the upper walls is the faster option. Replacing the tile on all three walls takes longer because the walls are rebuilt and waterproofed "
     "to full height. The waterproofing and the shower floor also need time to cure before the tile goes on. You get the schedule in writing with the price."),
    ("What is under the tile in your walk-in showers?",
     "A shower liner under a mortar floor that slopes to the drain, cement board on the walls, and a continuous liquid waterproofing layer on the walls "
     "and floor, sealed at every corner and seam. The tile is the finish; the waterproofing behind it is what keeps the water in."),
    ("Do you work in co-ops and apartment buildings?",
     "Yes. Most of our shower work is in NYC apartments, co-ops and condos. We protect the halls, follow the building's work rules and hours, "
     "and can send the insurance certificate your board or management company asks for."),
    ("Is the work guaranteed?",
     "Yes. Sani Building Corp is fully insured, and our shower work carries a 3-year workmanship warranty."),
    ("Which areas do you serve?",
     "Sani Building Corp is based in Brooklyn and serves all five NYC boroughs — Brooklyn, Manhattan, Queens, the Bronx and Staten Island — "
     "plus Long Island and Nassau County."),
]

provider = json.loads(re.search(r'<!-- Service Schema -->\n<script type="application/ld\+json">(.*?)</script>', SRC, re.S).group(1))["provider"]
service = {
    "@context": "https://schema.org", "@type": "Service",
    "name": "Bathtub to Walk-In Shower Conversion",
    "description": "Tub to walk-in shower conversions for NYC homes, apartments, co-ops and condos: tub removal, waterproofed shower floor and walls, "
                   "low or flush entrance where possible, grab bars and benches, matching or new tile. Fully insured, 3-year workmanship warranty.",
    "serviceType": ["Tub to Shower Conversion", "Bathtub to Walk-In Shower", "Walk-in Shower Installation",
                    "Senior-Friendly Shower", "Accessible Shower Conversion", "Shower Waterproofing"],
    "provider": provider,
    "areaServed": [{"@type": "City", "name": n} for n in ["Brooklyn", "Manhattan", "Queens", "Bronx", "Staten Island"]]
                  + [{"@type": "AdministrativeArea", "name": n} for n in ["Long Island", "Nassau County"]],
    "url": URL,
    "offers": {"@type": "Offer", "availability": "https://schema.org/InStock", "areaServed": "New York City"},
}
crumbs = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
    {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.sanibuildingcorp.com/"},
    {"@type": "ListItem", "position": 2, "name": "Bathroom Renovation", "item": "https://www.sanibuildingcorp.com/bathroom-renovation"},
    {"@type": "ListItem", "position": 3, "name": "Bathtub to Walk-In Shower", "item": URL}]}
faq_ld = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
    {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQ]}
ld = lambda o: '<script type="application/ld+json">' + json.dumps(o, ensure_ascii=False) + "</script>"
esc = lambda t: t.replace("&", "&amp;")

def sign(k, v):
    return f'      <div class="spec reveal"><div class="k">{k}</div><div class="v">{v}</div></div>'

def fig(img, alt, w, h, cap):
    return (f'<figure class="ts-fig reveal"><img class="zoom" src="{IMG}{img}" alt="{alt}" width="{w}" height="{h}" loading="lazy" decoding="async">'
            f'<figcaption>{cap}</figcaption></figure>')

faq_html = "\n".join(f'''      <div class="faq-item">
        <button class="faq-q">{esc(q)}<span class="plus">+</span></button>
        <div class="faq-a"><p>{esc(a)}</p></div>
      </div>''' for q, a in FAQ)

main = f'''<main class="wp">

<!-- ============ HERO ============ -->
<section class="wp-hero">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <span class="eyebrow">Tub to Walk-In Shower &middot; NYC</span>
      <h1>Bathtub to Walk-In Shower Conversion <span class="italic-accent">— Safe, Easy and Waterproof</span></h1>
      <p class="hero-sub">Stepping over a tub wall gets harder every year. We take out the tub and build a fully waterproofed walk-in shower with a low, easy entrance — safer for seniors, for anyone with limited mobility, and simply nicer for everyone.</p>
      <ul class="hero-list">
        <li>No tub wall to step over</li>
        <li>Low or flush entrance where possible</li>
        <li>Grab bars, bench, handheld shower</li>
        <li>Matching tile, or a new accent design</li>
        <li>3-year workmanship warranty</li>
      </ul>
      <div class="hero-actions">
        <a href="#quote" class="btn btn-gold">Get a free estimate</a>
        <a href="tel:3322770990" class="hero-phone">📞 {PHONE}</a>
      </div>
    </div>
    <div class="ba-shell">
      <div class="ba-frame"><img class="ts-hero-img zoom" src="{IMG}bathtub-to-walk-in-shower-two-steps.jpg" alt="Bathtub to walk-in shower conversion in an NYC bathroom: tub and bottom tile row removed, then a new walk-in shower with glass door" width="1536" height="1024" fetchpriority="high" decoding="async"></div>
      <p class="ba-caption"><strong>Before and after:</strong> the tub comes out, a walk-in shower goes in.</p>
    </div>
  </div>
</section>

<!-- ============ WHO IT IS FOR ============ -->
<section class="wp-section specs">
  <div class="wrap">
    <div class="section-head reveal">
      <span class="eyebrow">Who it is for</span>
      <h2>Is a walk-in shower right for you?</h2>
      <p>Most of our customers convert for one of these reasons.</p>
    </div>
    <div class="spec-grid">
{sign("Seniors", "Stay safe and independent at home — no climbing over a tub")}
{sign("Limited mobility", "A low, wide entrance, grab bars and a seat where you need them")}
{sign("After an injury or surgery", "Easier, safer showers while you recover, and after")}
{sign("You never use the tub", "More open space and a modern bathroom")}
{sign("Old leaking tub area", "New waterproofing behind the walls and under the floor")}
{sign("Selling or renting", "A walk-in shower is one of the most wanted bathroom upgrades")}
    </div>
    <div class="ts-safe">
      {fig("senior-walk-in-shower-grab-bars-bench.jpg", "Senior-friendly walk-in shower with grab bars, a built-in bench and a handheld shower in an NYC bathroom", 895, 1200, "Grab bars, a bench and a handheld shower.")}
      {fig("low-entry-walk-in-shower-grab-bar.jpg", "Low-entry walk-in shower with glass door and grab bar after a bathtub conversion", 900, 1200, "A low, easy entrance where the tub used to be.")}
    </div>
  </div>
</section>

<!-- ============ TWO WAYS ============ -->
<section class="wp-section" id="two-ways">
  <div class="wrap">
    <div class="section-head reveal">
      <span class="eyebrow">Two ways we convert</span>
      <h2>Keep your walls, or new walls?</h2>
      <p>It depends on the tile you have now. We check it at the free estimate — or send us a photo of your tub wall and we will tell you.</p>
    </div>
    <div class="ts-ways">
      <article class="ts-way reveal">
        <span class="ts-tag">Option 1 · Faster, lower cost</span>
        <h3>Keep the upper wall tile</h3>
        <p>We remove the tub and only the bottom rows of wall tile, build and waterproof the new shower floor and lower walls, and continue with a matching tile. Your upper walls stay as they are.</p>
        <p class="ts-when"><b>Works when:</b> your wall tile is small, like subway tile or small squares, and we can find an exact or very close match.</p>
        {fig("walk-in-shower-step-by-step-pan-liner.jpg", "Walk-in shower step by step: tub removed, shower pan liner, cement board, wall waterproofing, finished matching tile and sloped shower floor", 1024, 1536, "Step by step: tub out, pan liner, cement board, waterproofing, matching tile.")}
      </article>
      <article class="ts-way reveal">
        <span class="ts-tag ts-tag--b">Option 2 · Full new look</span>
        <h3>Replace the tile on all three shower walls</h3>
        <p>We cut clean lines, remove the tub and the tile on the three shower walls, install new cement board, waterproof the walls to full height and tile them with your new design — we help you choose it, including accent walls and decor tiles — then add the glass.</p>
        <p class="ts-when"><b>Needed when:</b> your wall tile is large format, or no matching tile can be found, so a patch would show.</p>
        {fig("walk-in-shower-full-wall-replacement.jpg", "Walk-in shower full wall replacement: clean cut lines, tub and wall tile removed, pan liner and cement board, full-height waterproofing, new tile and glass", 1024, 1536, "Full wall replacement, with a clean, color-matched edge to the rest of the bathroom.")}
      </article>
    </div>
  </div>
</section>

<!-- ============ DESIGN ============ -->
<section class="wp-section" id="design" style="background:var(--white);border-top:1px solid var(--line)">
  <div class="wrap">
    <div class="section-head reveal">
      <span class="eyebrow">Design your new shower</span>
      <h2>Accent walls and tile combinations, matched to the tile you keep</h2>
      <p>When the tile on the three shower walls comes off, you get to choose a new design. We help you pick tile that works with the tile on your other walls, which stays as it is — we do not touch or demolish it. The result is a modern bathroom without a full renovation.</p>
    </div>
    <div class="ts-trend reveal">
      <div class="ts-tr"><b>Two or three colors together</b><span>A main tile with one or two matching colors — today's most popular bathroom look.</span></div>
      <div class="ts-tr"><b>Decor tiles</b><span>A patterned or botanical decor tile on one wall, or as a band or a niche.</span></div>
      <div class="ts-tr"><b>Accent wall</b><span>One shower wall in a bold color, stone or marble look, the other walls calm.</span></div>
      <div class="ts-tr"><b>Tied to what stays</b><span>Colors, tile size and grout lines chosen to sit well next to the tile we keep.</span></div>
    </div>
    <div class="ts-gal">
      {fig("accent-decor-tile-walk-in-shower-green.jpg", "Walk-in shower with green tile and a botanical decor tile accent wall", 900, 1200, "Green tile with a decor accent wall.")}
      {fig("accent-wall-walk-in-shower-glass.jpg", "Walk-in shower with a patterned accent wall behind glass and marble-look tile around it", 900, 1200, "Patterned accent wall, marble-look walls.")}
      {fig("walk-in-shower-wood-look-accent.jpg", "Walk-in shower with wood-look accent tile and light stone tile", 900, 1200, "Wood-look accent with light stone tile.")}
      {fig("two-tone-walk-in-shower-gold.jpg", "Two-tone walk-in shower with marble-look tile and gold fixtures", 712, 986, "Two-tone tile with gold fixtures.")}
      {fig("accent-wall-tile-plan-walk-in-shower.jpg", "Walk-in shower tile plan with an accent wall tile, shower floor mosaic and matching floor tile", 900, 1200, "A tile plan: accent wall, shower floor and floor tile.")}
      {fig("walk-in-shower-light-tile-combination.jpg", "Bright walk-in shower with light wall tile and wood-look floor", 896, 1195, "Light tile, warm floor.")}
    </div>
    <div class="section-head reveal" style="margin-top:44px">
      <h2 style="font-size:clamp(24px,3vw,32px)">See your options before we start</h2>
      <p>We show you design options with the colors and tiles side by side, so you can choose with confidence.</p>
    </div>
    <div class="ts-opts">
      {fig("bathroom-tile-design-option-olive-cream.jpg", "Bathroom tile design option with olive green shower tile and cream walls", 1200, 800, "Design option: olive and cream.")}
      {fig("bathroom-tile-design-option-green-botanical.jpg", "Bathroom tile design option with a green botanical decor accent wall", 1200, 800, "Design option: green and botanical decor.")}
    </div>
  </div>
</section>

<!-- ============ UNDER THE TILE ============ -->
<section class="wp-section" style="background:var(--white);border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
  <div class="wrap">
    <div class="section-head reveal">
      <span class="eyebrow">What you do not see</span>
      <h2>What is under the tile</h2>
      <p>Tile is only the finish. A walk-in shower stays dry because of the layers behind and under it — and that is where we take the most care.</p>
    </div>
    <ol class="ts-layers reveal">
      <li><b>Solid subfloor</b> checked and repaired where the tub was.</li>
      <li><b>Shower liner</b> under the floor, turned up the walls.</li>
      <li><b>Sloped mortar bed</b> so every drop runs to the drain.</li>
      <li><b>Cement board</b> on the walls, joints treated.</li>
      <li><b>Liquid waterproofing</b> on walls and floor, sealed at every corner.</li>
      <li><b>Tile, grout and glass</b> — the part you see.</li>
    </ol>
    <div class="ts-figs">
      {fig("walk-in-shower-step-by-step-layers.jpg", "Walk-in shower step by step with a cutaway view of tile, liquid waterproofing, cement board and wall studs", 1024, 1536, "Cutaway: how the layers fit together.")}
      {fig("shower-pan-layers.jpg", "Shower pan layers: plywood subfloor, builders felt, mortar base, shower liner, mortar top layer and tile", 478, 641, "Shower floor layers, from subfloor to tile.")}
      {fig("shower-drain-cutaway.jpg", "Shower drain cutaway showing waterproof membrane, thinset, mortar bed, tile, sloped mortar bed and drain trap", 476, 644, "The drain: where the slope and the waterproofing meet.")}
    </div>
  </div>
</section>

<!-- ============ PROCESS ============ -->
<section class="wp-section">
  <div class="wrap">
    <div class="section-head reveal">
      <span class="eyebrow">How it works</span>
      <h2>From bathtub to walk-in shower in five steps</h2>
      <p>You get the price and the schedule in writing before any work starts.</p>
    </div>
    <div class="process">
      <div class="pstep reveal"><div class="num">1</div><h3>Free estimate</h3><p>We look at the tile, the floor and the drain, and tell you which option fits.</p></div>
      <div class="pstep reveal"><div class="num">2</div><h3>Written price</h3><p>A fixed price and schedule — tile choice, entrance, glass and extras included.</p></div>
      <div class="pstep reveal"><div class="num">3</div><h3>Tub out</h3><p>Tub and tile removed. Halls and floors protected, debris taken away.</p></div>
      <div class="pstep reveal"><div class="num">4</div><h3>Build &amp; waterproof</h3><p>Liner, sloped floor, cement board and waterproofing, sealed at every seam.</p></div>
      <div class="pstep reveal"><div class="num">5</div><h3>Tile, glass &amp; safety</h3><p>Tile, glass door or panel, grab bars and bench — then a final walkthrough with you.</p></div>
    </div>
  </div>
</section>

<!-- ============ PANELS OPTION ============ -->
<section class="wp-section" style="background:var(--white);border-top:1px solid var(--line)">
  <div class="wrap">
    <div class="section-head reveal">
      <span class="eyebrow">Keeping the tub?</span>
      <h2>Want to keep your tub but fix the walls?</h2>
      <p>If you like your tub and only the walls around it are old, cracked or leaking, waterproof PVC wall panels go right over the old tile in 1–2 days, with no demolition.</p>
      <p style="margin-top:22px"><a href="/bathroom-wall-panels" class="btn btn-navy">See bathroom wall panels (no demo)</a></p>
    </div>
  </div>
</section>

<!-- ============ CTA BAND ============ -->
<section class="wp-section cta-band" id="quote">
  <div class="wrap">
    <h2>Get a free walk-in shower estimate</h2>
    <p>Send us a photo of your tub and the wall tile, or call us. We will tell you which option your bathroom needs and what it costs. Serving Brooklyn and all five NYC boroughs, plus Long Island and Nassau County.</p>
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
'''

PAGE_CSS = """<style>
/* this page only */
.ts-hero-img{width:100%;aspect-ratio:3/2;object-fit:cover;display:block;border-radius:8px}
.ts-ways{display:grid;grid-template-columns:1fr 1fr;gap:26px}
.ts-way{background:var(--white);border:1px solid var(--line);border-radius:16px;padding:26px 24px;display:flex;flex-direction:column;gap:12px}
.ts-way h3{margin:0;font-size:24px;line-height:1.25}
.ts-way p{margin:0}
.ts-tag{align-self:flex-start;background:#e8f4ef;color:#1d6b4a;font-weight:700;font-size:13px;letter-spacing:.04em;text-transform:uppercase;padding:6px 12px;border-radius:30px}
.ts-tag--b{background:#fbf1de;color:#8a5a00}
.ts-when{background:#f7f5f2;border-left:3px solid #c8860a;padding:12px 14px;border-radius:6px}
.ts-fig{margin:6px 0 0}
.ts-fig img{width:100%;height:auto;display:block;border-radius:10px;border:1px solid var(--line)}
.ts-fig figcaption{font-size:15px;color:#5a6474;margin-top:8px}
.ts-safe{display:grid;grid-template-columns:1fr 1fr;gap:18px;max-width:760px;margin:30px auto 0}
.ts-trend{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:0 0 28px}
.ts-tr{background:#f7f5f2;border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:6px}
.ts-tr b{color:#0a1628;font-size:18px}.ts-tr span{color:#4a5566}
.ts-gal{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.ts-gal .ts-fig img{aspect-ratio:3/4;object-fit:cover}
.ts-opts{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.ts-layers{max-width:760px;margin:0 auto 30px;padding-left:22px;display:grid;gap:10px}
.ts-figs{display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:20px;align-items:start}
@media(max-width:900px){.ts-ways,.ts-figs,.ts-opts{grid-template-columns:1fr}.ts-way{padding:20px 16px}.ts-trend,.ts-gal{grid-template-columns:1fr 1fr}.ts-gal{gap:10px}.ts-gal .ts-fig figcaption{font-size:14px}}
</style>"""

h = SRC
h = re.sub(r"<title>.*?</title>", f"<title>{TITLE}</title>", h, count=1, flags=re.S)
h = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{DESC}">', h, count=1)
h = re.sub(r'<meta name="keywords" content="[^"]*">',
           '<meta name="keywords" content="tub to shower conversion NYC, bathtub to walk-in shower, walk-in shower for seniors, '
           'accessible shower conversion, low threshold shower, curbless shower NYC, tub replacement with shower Brooklyn">', h, count=1)
h = h.replace("https://www.sanibuildingcorp.com/shower-waterproofing", URL)
h = re.sub(r'(<meta (?:property="og:title"|name="twitter:title") content=")[^"]*"', lambda m: m.group(1) + OG_T + '"', h)
h = re.sub(r'(<meta (?:property="og:description"|name="twitter:description") content=")[^"]*"', lambda m: m.group(1) + OG_D + '"', h)
h = h.replace("images/og/shower-waterproofing-og.jpg", "images/og/tub-to-shower-og.jpg")
h = re.sub(r'<link rel="preload" as="image" href="[^"]*"', f'<link rel="preload" as="image" href="{IMG}bathtub-to-walk-in-shower-two-steps.jpg"', h, count=1)
h = re.sub(r'(<!-- Service Schema -->\n)<script type="application/ld\+json">.*?</script>', lambda m: m.group(1) + ld(service), h, count=1, flags=re.S)
h = re.sub(r'(<!-- Breadcrumb Schema -->\n)<script type="application/ld\+json">.*?</script>', lambda m: m.group(1) + ld(crumbs), h, count=1, flags=re.S)
h = re.sub(r'(<!-- FAQ Schema[^\n]*\n)<script type="application/ld\+json">.*?</script>', lambda m: m.group(1) + ld(faq_ld), h, count=1, flags=re.S)
h = h.replace("</head>", PAGE_CSS + "\n</head>", 1)
a, b = h.index('<main class="wp">'), h.index("</main>")
h = h[:a] + main + h[b:]
(ROOT / "tub-to-shower-conversion.html").write_text(h)
print("tub-to-shower-conversion.html built")
