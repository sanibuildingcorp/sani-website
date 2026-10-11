#!/usr/bin/env python3
"""Manhattan signals for Google and AI search.

  "Make sure Manhattan prioritizes! All Manhattan's borough! ... most my
   customers are from manhattan and i need keep this algorithm"

Search Console (Jul-Oct 2026): the Manhattan pages are indexed and seen
thousands of times but sit around position 20-26; the home page had no plain
link to the Manhattan bathroom, kitchen, painting or handyman pages (the menu
and footer are loaded by script). This writes, between MANHATTAN markers:
  1. on the five Manhattan pages: "Manhattan neighborhoods we serve" (every
     area, grouped) and "Our Manhattan services" plain links;
  2. on the home page: a Manhattan services row in "Where We Work";
  3. in each Manhattan page's Service data: areaServed as real places inside
     Manhattan, New York, instead of loose words.
Existing words are not changed. Safe to run again.
"""
import json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
AREAS = {
    "Uptown": ["Inwood", "Washington Heights", "Hudson Heights", "Hamilton Heights", "Harlem", "East Harlem", "Morningside Heights", "Sugar Hill"],
    "Upper East &amp; West Side": ["Upper East Side", "Lenox Hill", "Yorkville", "Carnegie Hill", "Upper West Side", "Lincoln Square", "Manhattan Valley", "Roosevelt Island"],
    "Midtown": ["Midtown", "Midtown East", "Hell's Kitchen", "Hudson Yards", "Murray Hill", "Kips Bay", "Turtle Bay", "Sutton Place", "Tudor City", "NoMad", "Gramercy", "Flatiron", "Chelsea"],
    "Downtown": ["Greenwich Village", "West Village", "East Village", "SoHo", "NoHo", "Nolita", "Tribeca", "Lower East Side", "Chinatown", "Little Italy", "Financial District", "Battery Park City", "Two Bridges", "Stuyvesant Town"],
}
SERVICES = [("/renovation-contractor-manhattan", "Apartment &amp; co-op renovation in Manhattan"),
            ("/bathroom-renovation-manhattan", "Bathroom remodeling in Manhattan"),
            ("/kitchen-cabinet-installation-manhattan", "Kitchen cabinet installation in Manhattan"),
            ("/painting-manhattan", "Apartment painting in Manhattan"),
            ("/handyman-manhattan", "Handyman services in Manhattan"),
            ("/bathroom-wall-panels", "Shower wall panels over existing tile"),
            ("/tub-to-shower-conversion", "Bathtub to walk-in shower")]
PAGES = ["renovation-contractor-manhattan", "bathroom-renovation-manhattan", "kitchen-cabinet-installation-manhattan", "painting-manhattan", "handyman-manhattan"]

CSS = """<style>
.mhn{padding:56px 20px;background:#f7f5f2;border-top:1px solid rgba(10,22,40,.08)}
.mhn-in{max-width:1080px;margin:0 auto}
.mhn-eye{color:#c8860a;font-size:12px;letter-spacing:3px;text-transform:uppercase;font-weight:700;margin:0 0 8px}
.mhn h2{font-size:clamp(26px,3.4vw,36px);line-height:1.15;color:#0a1628;margin:0 0 10px}
.mhn-lead{color:#2c3646;line-height:1.7;max-width:780px;margin:0 0 22px}
.mhn-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.mhn-grid div{background:#fff;border:1px solid rgba(10,22,40,.1);border-radius:14px;padding:16px 18px}
.mhn-grid h3{font-size:16px;margin:0 0 8px;color:#0a1628}.mhn-grid p{margin:0;color:#3a4556;line-height:1.7;font-size:15.5px}
.mhn-svc{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px;padding:0;list-style:none}
.mhn-svc a{display:inline-block;background:#0a1628;color:#fff;border-radius:999px;padding:10px 16px;text-decoration:none;font-weight:600;font-size:15px}
.mhn-svc a[aria-current]{background:#c8860a}
@media(max-width:900px){.mhn-grid{grid-template-columns:1fr 1fr}}
@media(max-width:560px){.mhn{padding:42px 16px}.mhn-grid{grid-template-columns:1fr}}
</style>"""


def block(page):
    groups = "".join(f"<div><h3>{g}</h3><p>{', '.join(n.replace(chr(39), '&#39;') for n in ns)}</p></div>" for g, ns in AREAS.items())
    svc = "".join(f"<li><a href=\"{u}\"{' aria-current=\"page\"' if u == '/' + page else ''}>{t}</a></li>" for u, t in SERVICES)
    return (f"<!-- MANHATTAN-AREAS:START -->\n{CSS}\n<section class=\"mhn\" aria-labelledby=\"mhn-title\"><div class=\"mhn-in\">"
            f"<p class=\"mhn-eye\">All of Manhattan</p><h2 id=\"mhn-title\">Manhattan neighborhoods we serve</h2>"
            f"<p class=\"mhn-lead\">Manhattan is where most of our customers live. We work in co-ops, condos, pre-war buildings, "
            f"brownstones and rentals from Inwood to the Financial District — following building work hours and rules, protecting "
            f"halls and elevators, and sending the insurance certificate (COI) your board or management needs.</p>"
            f"<div class=\"mhn-grid\">{groups}</div>"
            f"<h3 style=\"margin:28px 0 0;color:#0a1628\">Our Manhattan services</h3><ul class=\"mhn-svc\">{svc}</ul>"
            f"</div></section>\n<!-- MANHATTAN-AREAS:END -->\n")


def places():
    city = {"@type": "City", "name": "Manhattan", "containedInPlace": {"@type": "State", "name": "New York"}}
    return [city] + [{"@type": "Place", "name": n + ", Manhattan", "containedInPlace": {"@type": "City", "name": "Manhattan"}}
                     for ns in AREAS.values() for n in ns]


for page in PAGES:
    f = ROOT / f"{page}.html"
    h = f.read_text()
    h = re.sub(r"<!-- MANHATTAN-AREAS:START -->.*?<!-- MANHATTAN-AREAS:END -->\n", "", h, flags=re.S)
    k = h.index('<div id="site-footer"></div>')
    h = h[:k] + block(page) + h[k:]
    for raw in re.findall(r'<script type="application/ld\+json">(.*?)</script>', h, re.S):
        o = json.loads(raw)
        if o.get("@type") == "Service":
            o["areaServed"] = places()
            h = h.replace(raw, json.dumps(o, ensure_ascii=False), 1)
    f.write_text(h)
    print("manhattan block:", page)

# home page: plain links to every Manhattan service page
f = ROOT / "index.html"
h = f.read_text()
h = re.sub(r"\s*<!-- MANHATTAN-HOME:START -->.*?<!-- MANHATTAN-HOME:END -->", "", h, flags=re.S)
row = ("\n    <!-- MANHATTAN-HOME:START -->\n    <div class=\"areas-group\">\n      <h3 class=\"areas-group-title\">Manhattan Services</h3>\n      <div class=\"areas-grid\">\n"
       + "".join(f"        <a href=\"{u}\" class=\"area-pill{' featured' if i < 2 else ''}\">{t.replace(' in Manhattan', '')}</a>\n" for i, (u, t) in enumerate(SERVICES[:5]))
       + "      </div>\n    </div>\n    <!-- MANHATTAN-HOME:END -->")
anchor = '<h3 class="areas-group-title">NYC Boroughs</h3>'
i = h.index(anchor); j = h.index("</div>\n    </div>", i) + len("</div>\n    </div>")
h = h[:j] + row + h[j:]
f.write_text(h)
print("home page Manhattan row written")
