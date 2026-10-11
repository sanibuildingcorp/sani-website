#!/usr/bin/env python3
"""Writes an "At a glance" answer box and a "Why NYC chooses us" strip into
every bathroom page, right after the hero.

  "Check other bathroom pages too and make them strong signal to google, AI
   and all search engines ... Give them best detailed explanations for let's
   them understand who we are and why they must recommend our business"

Search engines and AI assistants quote short, direct answers: what the
service is, who it is for, how long it takes, what the price depends on,
where we work and what is guaranteed. Every fact below is one the page
already states (its FAQ, its specs) or a company fact the owner confirmed:
since 2015, 4.9 stars on Google, fully insured, 3-year workmanship warranty,
insurance certificate on request, all five boroughs plus Long Island. No
"licensed" claim. Existing words are not touched. Safe to run again: the
block lives between BATH-GLANCE markers.
"""
import pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
AREAS = "All five NYC boroughs — Brooklyn, Manhattan, Queens, the Bronx and Staten Island — plus Long Island and Nassau County."
WARRANTY = "Fully insured, 3-year workmanship warranty, insurance certificate (COI) for your building on request."

PAGES = {
    "bathroom-renovation": ("Bathroom renovation", [
        ("What it is", "A complete bathroom remodel by our own team: demolition, waterproofing, tile, vanity, plumbing fixtures, lighting, painting and final clean-up."),
        ("Best for", "Outdated layouts, worn-out bathrooms, small NYC bathrooms that need more storage and light, and full gut renovations."),
        ("How long", "Usually 2–4 weeks; a full gut renovation 4–6 weeks. You get the schedule in writing."),
        ("Price", "A fixed, itemized written price based on size, materials and how much of the layout changes. Free estimate within 24 hours."),
        ("Faster options", "Wall panels over existing tile in 1–3 days, or a bathtub to walk-in shower conversion without a full remodel.")]),
    "tub-to-shower-conversion": ("Bathtub to walk-in shower", [
        ("What it is", "We remove the bathtub and build a fully waterproofed walk-in shower with a low or flush entrance where the floor and drain allow."),
        ("Best for", "Seniors, people with limited mobility, recovery after surgery, and anyone who never uses the tub."),
        ("Two ways", "Keep the upper wall tile and continue with a matching tile (small tile such as subway), or replace the tile on all three shower walls with a new design."),
        ("Safety extras", "Grab bars, a shower bench, a handheld shower and slip-resistant floor tile."),
        ("How long", "Keeping the upper walls is the faster option. You get the schedule in writing with the price.")]),
    "bathroom-floor-tile-installation": ("Bathroom &amp; shower tile installation", [
        ("What it is", "New bathroom floor and shower tile: subfloor prep, waterproofing, precise layout, tile setting and grout."),
        ("Best for", "Cracked, loose or dated floor tile, new shower floors, and bathrooms that need a fresh look without a full remodel."),
        ("How long", "A typical bathroom floor takes 2–4 days, usable after 24–48 hours of curing."),
        ("Price", "Typically $15–$35 per square foot installed, depending on the tile, the pattern and the subfloor. Free written estimate.")]),
    "shower-waterproofing": ("Shower waterproofing &amp; leak repair", [
        ("What it is", "We find where the water gets out, rebuild what is needed — shower pan, slope to the drain, waterproof membrane — and tile it back."),
        ("Signs you need it", "A water stain on the ceiling below, loose or hollow floor tile, grout that keeps cracking, mold that comes back."),
        ("How long", "A shower pan replacement usually takes a few days, including curing time. You get the schedule in writing."),
        ("Price", "A fixed written price for the scope after inspection — not an hourly guess.")]),
    "tile-grouting-restoration": ("Grout repair &amp; regrouting", [
        ("What it is", "Cracked, dirty, moldy or missing grout is cleaned or removed and renewed, and sealed — without replacing the tile."),
        ("Best for", "Showers and floors where the tile is still good but the grout is not."),
        ("How long", "A typical NYC bathroom takes 1 day; commercial floors may take 1–2 nights."),
        ("Price", "Grout cleaning typically $3–$6 per square foot; regrouting $8–$15 per square foot. Free itemized estimate.")]),
    "commercial-tile-installation": ("Commercial tile installation", [
        ("What it is", "Floor and wall tile for restaurants, retail, offices, medical spaces and commercial restrooms."),
        ("Best for", "Businesses that need durable, code-conscious tile with minimal downtime — evening, overnight and weekend schedules."),
        ("Price", "Typically $18–$45 per square foot installed, depending on the tile, the subfloor and the schedule. Free on-site estimate.")]),
    "tile-installation-cost-nyc": ("Tile installation cost in NYC", [
        ("Bathroom tile", "$15–$35 per square foot installed — labor, setting materials, waterproofing where needed and grout."),
        ("Commercial tile", "$18–$45 per square foot installed."),
        ("Not included", "The tile itself, which varies widely by material; we can supply tile at trade pricing."),
        ("How we price", "A fixed written price for the scope after we see the space or clear photos — never by the hour.")]),
    "bathroom-renovation-brooklyn": ("Bathroom remodeling in Brooklyn", [
        ("What it is", "Full bathroom remodels, walk-in showers, tub-to-shower conversions, tile and waterproofing for Brooklyn brownstones, pre-war apartments and row houses."),
        ("Local", "Based in Brooklyn (Brighton Beach), working across Park Slope, Williamsburg, Brooklyn Heights, DUMBO, Cobble Hill, Bay Ridge and more."),
        ("How long", "Usually 2–4 weeks; a full gut renovation 4–6 weeks."),
        ("Price", "A free, itemized written estimate based on size, finishes and scope.")]),
    "bathroom-renovation-manhattan": ("Bathroom remodeling in Manhattan", [
        ("What it is", "Bathroom remodels, walk-in showers, tile and waterproofing for Manhattan co-ops, condos and pre-war apartments."),
        ("Buildings", "We follow building work rules and hours, protect the halls, and send the insurance certificate your board or management asks for."),
        ("How long", "Usually 2–4 weeks; a full gut renovation 4–6 weeks."),
        ("Price", "A free, itemized written estimate based on size, fixtures and building requirements.")]),
    "bathroom-renovation-queens": ("Bathroom remodeling in Queens", [
        ("What it is", "Bathroom remodels, walk-in showers, tile and waterproofing for Queens homes, apartments, co-ops and condos."),
        ("How long", "Usually 2–4 weeks; a full gut renovation 4–6 weeks."),
        ("Price", "A free, itemized written estimate based on size, finishes and scope.")]),
}

WHY = [("Since 2015", "Serving NYC homes and businesses"), ("4.9 ★ on Google", "Rated by real customers"),
       ("Fully insured", "COI for your building on request"), ("3-year warranty", "On our workmanship"),
       ("Our own team", "Start to finish, no subcontractor hand-offs"), ("Written price", "Free estimate within 24 hours")]

CSS = """<style>
.bgl{padding:56px 20px;background:#fff;border-bottom:1px solid rgba(10,22,40,.08)}
.bgl-in{max-width:1080px;margin:0 auto}
.bgl-eye{color:#c8860a;font-size:12px;letter-spacing:3px;text-transform:uppercase;font-weight:700;margin:0 0 8px}
.bgl h2{font-size:clamp(26px,3.4vw,36px);line-height:1.15;color:#0a1628;margin:0 0 20px}
.bgl-dl{display:grid;grid-template-columns:200px 1fr;margin:0;border:1px solid rgba(10,22,40,.1);border-radius:14px;overflow:hidden}
.bgl-dl dt,.bgl-dl dd{margin:0;padding:14px 18px;border-top:1px solid rgba(10,22,40,.08)}
.bgl-dl dt:first-of-type,.bgl-dl dt:first-of-type+dd{border-top:0}
.bgl-dl dt{background:#f7f5f2;font-weight:700;color:#0a1628}
.bgl-dl dd{color:#2c3646;line-height:1.6}
.bgl-why{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-top:22px}
.bgl-why div{background:#0a1628;color:#fff;border-radius:12px;padding:14px 12px;text-align:center}
.bgl-why b{display:block;color:#f0a500;font-size:17px;line-height:1.2}.bgl-why span{display:block;font-size:14px;color:rgba(255,255,255,.78);margin-top:4px}
.bgl-cta{margin:20px 0 0;font-weight:600;color:#0a1628}.bgl-cta a{color:#b07400}
@media(max-width:900px){.bgl-why{grid-template-columns:repeat(3,1fr)}}
@media(max-width:600px){.bgl{padding:42px 16px}.bgl-dl{grid-template-columns:1fr}.bgl-dl dt{border-top:1px solid rgba(10,22,40,.08);padding:12px 14px 4px;background:#fff;color:#b07400;font-size:14px;text-transform:uppercase;letter-spacing:.06em}
 .bgl-dl dd{border-top:0;padding:0 14px 12px}.bgl-dl dt:first-of-type{border-top:0}.bgl-why{grid-template-columns:1fr 1fr}}
</style>"""


def block(name, rows):
    rows = rows + [("Where", AREAS), ("Guarantee", WARRANTY)]
    dl = "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in rows)
    why = "".join(f"<div><b>{a}</b><span>{b}</span></div>" for a, b in WHY)
    return (f"<!-- BATH-GLANCE:START -->\n{CSS}\n<section class=\"bgl\" aria-labelledby=\"bgl-title\"><div class=\"bgl-in\">"
            f"<p class=\"bgl-eye\">At a glance</p><h2 id=\"bgl-title\">{name} with Sani Building Corp</h2>"
            f"<dl class=\"bgl-dl\">{dl}</dl>"
            f"<div class=\"bgl-why\" aria-label=\"Why NYC customers choose Sani Building Corp\">{why}</div>"
            f"<p class=\"bgl-cta\">Questions? Call <a href=\"tel:3322770990\">(332) 277-0990</a> or send photos for a free estimate.</p>"
            f"</div></section>\n<!-- BATH-GLANCE:END -->\n")


for page, (name, rows) in PAGES.items():
    f = ROOT / f"{page}.html"
    h = f.read_text()
    h = re.sub(r"<!-- BATH-GLANCE:START -->.*?<!-- BATH-GLANCE:END -->\n", "", h, flags=re.S)
    if page == "bathroom-renovation":
        at = h.index("<!-- BATH-SERVICES:START -->")      # just above the service picker
    else:
        h1 = h.index("<h1")
        at = h.index("</section>", h1) + len("</section>\n")  # right after the hero
        nxt = h.find("<!-- NATURAL-TABS:START -->", at - 2)
        if nxt != -1 and nxt - at < 40:
            at = h.index("</nav>", nxt) + len("</nav>")
    h = h[:at] + block(name, rows) + h[at:]
    f.write_text(h)
    print("glance written:", page)
