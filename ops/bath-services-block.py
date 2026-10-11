#!/usr/bin/env python3
"""Writes one "bathroom services" block into every bathroom page.

  "Have a look if the main bathroom renovation page and also other bathroom
   pages are understandable structured and if there is a correct chain
   between them and if visitors can easily identify what services is for"

Every bathroom page gets the same six service cards (photo, name, who it is
for), the guides, and all five boroughs, so any bathroom page links to every
other one. The page you are on is marked "You are here". On the main
bathroom page the block sits high up as the service picker; on the others it
sits just before the "Explore More" links. Existing words are not touched.
Safe to run again: the block lives between BATH-SERVICES markers.
"""
import pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent

SERVICES = [
    ("/bathroom-renovation", "renovation", "Full Bathroom Renovation",
     "A whole new bathroom: layout, tile, vanity, fixtures. Start to finish."),
    ("/tub-to-shower-conversion", "tub-to-shower", "Bathtub to Walk-In Shower",
     "No more stepping over the tub. A safe, low-entry shower, ideal for seniors."),
    ("/bathroom-wall-panels", "wall-panels", "Bathroom Wall Panels (No Demo)",
     "Waterproof vinyl panels glued over your old wall tile. Done in 1&ndash;3 days."),
    ("/bathroom-floor-tile-installation", "tile", "Bathroom &amp; Shower Tile",
     "New floor or shower tile, laid flat, waterproofed and sealed."),
    ("/shower-waterproofing", "waterproofing", "Shower Waterproofing &amp; Leaks",
     "Water stain below the bathroom? We find the leak and fix it at the source."),
    ("/tile-grouting-restoration", "grout", "Grout Repair &amp; Regrouting",
     "Cracked, dirty or moldy grout renewed, without replacing the tile."),
]
GUIDES = [("/tile-installation-cost-nyc", "Tile installation cost"),
          ("/commercial-tile-installation", "Commercial tile")]
AREAS = [("/bathroom-renovation-brooklyn", "Brooklyn"), ("/bathroom-renovation-manhattan", "Manhattan"),
         ("/bathroom-renovation-queens", "Queens"), ("/renovation-contractor-bronx", "Bronx"),
         ("/renovation-contractor-staten-island", "Staten Island")]

PAGES = ["bathroom-renovation", "tub-to-shower-conversion", "bathroom-wall-panels", "bathroom-floor-tile-installation",
         "shower-waterproofing", "tile-grouting-restoration", "commercial-tile-installation", "tile-installation-cost-nyc",
         "bathroom-renovation-brooklyn", "bathroom-renovation-manhattan", "bathroom-renovation-queens"]

CSS = """<style>
.bsx{padding:64px 22px;background:#fff;border-top:1px solid rgba(10,22,40,.08)}
.bsx-in{max-width:1180px;margin:0 auto}
.bsx-eye{color:#c8860a;font-size:12px;letter-spacing:3px;text-transform:uppercase;font-weight:700;margin:0 0 10px;text-align:center}
.bsx h2{font-size:clamp(26px,3.6vw,38px);line-height:1.15;color:#0a1628;margin:0 0 10px;text-align:center}
.bsx-lead{color:#4a5566;text-align:center;max-width:640px;margin:0 auto 32px}
.bsx-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.bsx-card{display:flex;flex-direction:column;background:#fff;border:1px solid rgba(10,22,40,.1);border-radius:14px;overflow:hidden;text-decoration:none;color:#0a1628;transition:box-shadow .25s,transform .25s,border-color .25s}
.bsx-card:hover{box-shadow:0 14px 34px rgba(10,22,40,.12);transform:translateY(-3px);border-color:#c8860a}
.bsx-card img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block}
.bsx-body{padding:16px 18px 18px;display:flex;flex-direction:column;gap:6px;flex:1}
.bsx-name{font-weight:700;font-size:19px;line-height:1.25}
.bsx-for{color:#4a5566;font-size:16px;line-height:1.5}
.bsx-go{margin-top:auto;padding-top:8px;color:#b07400;font-weight:700;font-size:15px}
.bsx-card.here{border:2px solid #c8860a;cursor:default}
.bsx-card.here .bsx-go{color:#0a1628}
.bsx-more{display:flex;flex-wrap:wrap;gap:10px 22px;justify-content:center;align-items:center;margin-top:28px;color:#4a5566;font-size:16px}
.bsx-more b{color:#0a1628}
.bsx-more a{color:#0a1628;text-decoration:underline;text-underline-offset:3px;text-decoration-color:#c8860a}
@media(max-width:900px){.bsx-grid{grid-template-columns:1fr 1fr}}
@media(max-width:600px){.bsx{padding:48px 16px}.bsx-grid{grid-template-columns:1fr;gap:12px}
 .bsx-card{flex-direction:row;align-items:stretch}.bsx-card img{width:118px;aspect-ratio:auto;height:auto;min-height:118px;flex:none}
 .bsx-body{padding:12px 14px}.bsx-name{font-size:17px}.bsx-for{font-size:15px}.bsx-go{font-size:14px;padding-top:4px}}
</style>"""


def block(page):
    main = page == "bathroom-renovation"
    cards = []
    for href, img, name, line in SERVICES:
        here = href == "/" + page
        tag = "div" if here else "a"
        attr = ' aria-current="page"' if here else f' href="{href}"'
        go = "You are here" if here else "See this service &rarr;"
        cards.append(f'<{tag} class="bsx-card{" here" if here else ""}"{attr}><img src="/images/bath-services/{img}.jpg" '
                     f'alt="{name.replace("&amp;", "and").replace("&ndash;", "-")} in NYC by Sani Building Corp" width="480" height="360" loading="lazy" decoding="async">'
                     f'<span class="bsx-body"><span class="bsx-name">{name}</span><span class="bsx-for">{line}</span>'
                     f'<span class="bsx-go">{go}</span></span></{tag}>')
    link = lambda xs: " &middot; ".join(f'<a href="{h}">{n}</a>' for h, n in xs if h != "/" + page)
    eye, h2, lead = (("Bathroom services", "Choose your bathroom service",
                      "Not sure which one you need? Pick the closest one, or call us and we will tell you for free.")
                     if main else ("All bathroom services", "Other bathroom services",
                                   "Our own team for every bathroom job, from a small grout repair to a full renovation."))
    return (f"<!-- BATH-SERVICES:START -->\n{CSS}\n<section class=\"bsx\" aria-labelledby=\"bsx-title\"><div class=\"bsx-in\">"
            f"<p class=\"bsx-eye\">{eye}</p><h2 id=\"bsx-title\">{h2}</h2><p class=\"bsx-lead\">{lead}</p>"
            f"<div class=\"bsx-grid\">{''.join(cards)}</div>"
            f"<p class=\"bsx-more\"><span><b>Guides:</b> {link(GUIDES)}</span><span><b>Areas:</b> {link(AREAS)}</span></p>"
            f"</div></section>\n<!-- BATH-SERVICES:END -->\n")


for page in PAGES:
    f = ROOT / f"{page}.html"
    h = f.read_text()
    h = re.sub(r"<!-- BATH-SERVICES:START -->.*?<!-- BATH-SERVICES:END -->\n", "", h, flags=re.S)
    if page == "bathroom-renovation":
        at = h.index('<section class="stats-bar">')
    elif "Explore More" not in h:
        at = h.index("</main>")
    else:
        e = h.index("Explore More")
        at = h.rfind("<section", 0, e)
        style = h.rfind('<style>.sbc-ilink', 0, at)
        if style != -1 and at - style < 600:
            at = style
    h = h[:at] + block(page) + h[at:]
    f.write_text(h)
    print("block written:", page)
