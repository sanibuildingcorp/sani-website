# SEO-LOG.md — Sani Building Corp
Single source of truth for on-page SEO status. **Continuity protocol:** read this first every new chat. Only work PENDING / VERIFY rows during self-directed work; a direct Zura request always overrides and is done immediately regardless of status.

**Legend:** ✅ DONE = optimized, no action · 🔎 VERIFY = likely fine, confirm after next commit/crawl · ⏳ PENDING = known fix queued

_Last updated: Jun 27 2026 — by Claude. Authority Score 7; money keywords sit page 4–8. Per Jun 2026 core update, priority is consolidating thin/duplicate pages + earning topical depth, not adding pages._

---

## Location pages
| Page | URL | Status | Outstanding |
|---|---|---|---|
| Bronx | /renovation-contractor-bronx | ✅ DONE | **Rebuilt Jun 27** — was verbatim Nassau copy w/ cross-canonical. Now unique 755-word Bronx page, self-canonical, compliant title/meta, Bronx schema+FAQ. |
| Brooklyn | /renovation-contractor-brooklyn | ✅ DONE | **Jun 27** — added "general contractor brooklyn" (×6) + "contractors in Brooklyn" to title/H1/body; title→48ch, meta→156ch. |
| Manhattan | /renovation-contractor-manhattan | 🔎 VERIFY | Strong content (769w). Title 90ch + meta 260ch → trim (Tier 2). |
| Queens | /renovation-contractor-queens | 🔎 VERIFY | Strong content (708w). Title 84ch + meta 260ch → trim. |
| Long Island | /renovation-contractor-long-island | 🔎 VERIFY | OK (421w). Hub for Nassau/Suffolk spokes. |
| Nassau County | /renovation-contractor-nassau-county | ⏳ PENDING | Thin (255w, 100% boilerplate). Add OG/Twitter; trim title 105ch; rebuild as differentiated spoke. **Decision pending: rebuild deep vs consolidate.** |
| Staten Island | /renovation-contractor-staten-island | ⏳ PENDING | Thin (256w). Add OG/Twitter; trim title 98ch; rebuild deep. |
| Suffolk County | /renovation-contractor-suffolk-county | ⏳ PENDING | Thin (272w). Add OG/Twitter; trim title 89ch; rebuild as spoke w/ town list. |

## Core / hub pages
| Page | URL | Status | Outstanding |
|---|---|---|---|
| Homepage | / | ⏳ PENDING | H1 "&"+&lt;br&gt; cosmetic bug; add "general contractor brooklyn"; 54 internal .html links → clean URLs; title 83ch + meta 175ch trim; link to borough/stair/deck pages. |
| Services hub | /services | ⏳ PENDING | No schema, no OG, zero H2s; links to only 6 of ~30 pages; /lobby-restoration redirects here but no lobby content. Add ItemList/Breadcrumb schema + OG + links. |
| About | /about | ⏳ PENDING | "TrustedRenovation" spacing bug; meta 236ch trim. |
| Contact | /contact | ⏳ PENDING | Add ContactPoint/LocalBusiness schema + OG tags. |
| Gallery | /gallery | ⏳ PENDING | Missing canonical; absent from sitemap.xml; add ImageObject/ImageGallery schema. |

## Service pages
| Page | URL | Status | Outstanding |
|---|---|---|---|
| Handyman | /handyman | ✅ DONE | **Jun 27** — retargeted NYC→Brooklyn; title "Brooklyn Handyman | Same-Day Service" (57ch), H1 leads Brooklyn, exact "brooklyn handyman same day" added, meta cleaned to 159ch. |
| Bathroom Reno NYC | /bathroom-renovation | ⏳ PENDING | Cannibalizes /bathroom-renovation-brooklyn (pos ~75 for bklyn term); shift to all-borough/commercial intent; meta 238ch. |
| Bathroom Reno Brooklyn | /bathroom-renovation-brooklyn | ⏳ PENDING | Make sole Brooklyn target; meta 284ch trim; add "bathroom remodeling brooklyn" (vol 390) to H2/body. |
| Bathroom Reno Manhattan | /bathroom-renovation-manhattan | 🔎 VERIFY | Meta trim. |
| Bathroom Reno Queens | /bathroom-renovation-queens | 🔎 VERIFY | Meta trim. |
| Bathroom Floor Tile | /bathroom-floor-tile-installation | 🔎 VERIFY | Reciprocal link to bathroom-renovation. |
| Bathroom Wall Panels | /bathroom-wall-panels | ⏳ PENDING | H1 missing "bathroom wall panels"; meta 260ch; **FAQPage schema bug — verify 7 mainEntity have @type:Question**. |
| Kitchen Cabinets NYC | /kitchen-cabinet-installation | ⏳ PENDING | Title/meta trim. |
| Kitchen Cabinets Brooklyn/Manhattan/Queens | /kitchen-cabinet-installation-{borough} | ⏳ PENDING | Only 1 img w/ empty alt each; add project photos + og:image + alt; meta 220–232ch. |
| Painting NYC | /painting | 🔎 VERIFY | Schema rebuilt (11Q) + visible price prior session; meta trim. |
| Painting Brooklyn | /painting-brooklyn | 🔎 VERIFY | Meta trim. |
| Painting Manhattan | /painting-manhattan | 🔎 VERIFY | De-duped vs brooklyn prior session; meta trim. |
| Painting Queens | (none) | ⏳ PENDING | Coverage gap — no Queens painting page; create to match bathroom/kitchen coverage. |
| Flooring | /flooring | 🔎 VERIFY | Schema rebuilt (8Q) prior session; meta trim. |
| Carpentry | /carpentry | ⏳ PENDING | Front-load "Carpentry NYC / NY carpentry" (vol 880, pos 51) in title/H1; meta 221ch; schema rebuilt (8Q) prior session. |
| Water Damage | /water-damage | 🔎 VERIFY | Meta trim. |
| Deck Building / Renovation | /deck-building, /deck-renovation | 🔎 VERIFY | Complete Twitter card (title/desc/image). |
| Exterior Carpentry | /exterior-carpentry | 🔎 VERIFY | — |
| Stairs ×4 | /stair-building, -renovation, -restoration, -upgrade | ⏳ PENDING | 4-way near-duplicate (same template/boroughs/FAQ). Consolidate to 1–2 or sharply differentiate. |

## Funnel / system / tools
| Page | URL | Status | Outstanding |
|---|---|---|---|
| Estimate wizard | /estimate | ⏳ PENDING | 10 H1 tags; no canonical; add noindex (funnel, not content). |
| Review capture | /review | ⏳ PENDING | Add noindex (thin utility). |
| Handyman estimate | /handyman-estimate | ✅ DONE | noindex set. |
| Internal tools | /dashboard, /quote, /agreement | ✅ DONE | noindex + in robots.txt. |
| Invoice | /invoice | 🔎 VERIFY | noindex + in robots.txt (already disallowed). |
| Tools NOT in robots | /contract, /image-studio, /seo-content, /keyword-volumes | ⏳ PENDING | Add to robots.txt Disallow. **keyword-volumes leaks SEO strategy — urgent.** |

## Cross-site / technical
| Item | Status | Outstanding |
|---|---|---|
| Internal links use .html | ⏳ PENDING | Sitewide: every internal .html link forces a 301 hop (homepage 54, handyman 46, kitchen 45). Global find/replace to clean URLs. |
| Meta descriptions | ⏳ PENDING | ~25 pages 200–289ch → trim to ≤160. |
| Title tags | ⏳ PENDING | ~20 pages 75–105ch → trim to ≤60 ("{Keyword} {Borough} | Sani Building Corp"). |
| /lobby-restoration redirect | ⏳ PENDING | Redirects to /services (1,404 GSC impressions, pos 12.5 wasted). Repoint to relevant page or restore dedicated page. |
| robots.txt | ⏳ PENDING | Add Disallow: contract, image-studio, seo-content, keyword-volumes. |
| sitemap.xml | ⏳ PENDING | Add /gallery. |
| BreadcrumbList schema | ⏳ PENDING | Only on 3 pages; add sitewide to service/location pages. |
| H1 spacing bugs | ⏳ PENDING | "&" + br (home), "TrustedRenovation" (about), stray newlines in location H1s. |
| robots.txt + sitemap.xml validity | ✅ DONE | Verified correct (raw bytes + XML parser). Do not re-enable Cloudflare robots mgmt or add AI-bot Disallow. |

---
## Active priority queue (next)
1. **Decide Nassau/Staten Island/Suffolk:** rebuild deep vs consolidate into Long Island hub.
2. Trim all over-length titles (≤60) + metas (≤160) — mechanical sitewide pass.
3. robots.txt: block keyword-volumes / image-studio / seo-content / contract.
4. Homepage: H1 fix + "general contractor brooklyn" + internal links to clean URLs.
5. Stair ×4 consolidation.
6. services.html rebuild (schema + OG + H2 + link to all pages) — fixes /lobby-restoration signal too.

_After commits → Cloudflare Purge Everything → GSC Request Indexing on changed URLs → re-run Semrush._
