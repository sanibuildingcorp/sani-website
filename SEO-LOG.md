# SEO-LOG.md — Sani Building Corp

Single source of truth for on-page SEO. **Continuity protocol:** read this first every new chat. Self-directed work touches only PENDING/VERIFY rows; a direct Zura request always overrides and is done immediately regardless of status.

**Legend:** ✅ DONE · 🔎 VERIFY (confirm after commit/crawl) · ⏳ PENDING (fix queued)

*Updated Jul 25 2026 (see Jul 25 batch below; handyman-manhattan PUBLISHED with commercial/after-hours angle — un-shelved by Zura's direct request; commercial-handyman remains shelved). Prior: Jul 17 2026 (Brooklyn bathroom remodel retarget + IndexNow auto-submit). Prior update: Jul 7 2026 (image split — see section below). Prior update: Jun 27 2026 (batch 3) — by Claude. Authority Score 7; money keywords page 4–8. Priority per Jun 2026 core updates: consolidate thin/duplicate pages + topical depth, not new pages. **License rule enforced** — all “Licensed” claims stripped, “Fully insured” used.*

## Confirmed by Perplexity re-audit (post 21:46 commit): 5 FIXED, 0 regressions.

-----

## Technical / indexing

|Item                     |Status   |Notes                                                                                                                     |
|-------------------------|---------|---------------------------------------------------------------------------------------------------------------------------|
|Bing Webmaster Tools     |✅ DONE   |Verified Jul 17 via GSC import; both sitemaps Success (39 URLs); Site Scan queued.                                        |
|IndexNow auto-submit     |⏳ PENDING|Wix-era feed died Jun 2026. Fix delivered Jul 17: key file `a7ebddc053e946f89c2a38f825fdd941.txt` (site root) + `netlify/functions/deploy-succeeded.mjs` — pings Bing with all sitemap URLs on every deploy. Commit both.|

-----

## Jul 25 2026 batch (this session)

|Item                          |Status   |Notes                                                                                                              |
|------------------------------|---------|-------------------------------------------------------------------------------------------------------------------|
|/ (homepage)                  |🔎 VERIFY |Hero layer fix (user photo on top, Unsplash removed from hero), rc→66, 9 svc cards (added Handyman/Tile/Decks), design polish v1 (warm bg, gold miter corners), ALL 29 photo slots converted to real <img> (9 svc + 20 strip) — Studio-editable. Slots to fill: images/home/handyman.jpg, tile.jpg, deck.jpg. Re-upload facade to images/home/project-7.jpg (deck photo overwrote it).|
|/tile-grouting-restoration    |🔎 VERIFY |Navy 404-fallback fixed (cards stay white), commercial CTA hardened gold, max letter contrast, color-scheme light, Semrush retitle: “Grout Repair, Regrouting & Color Sealing NYC” (grout color sealing 5,400/mo KD 6!, regrout shower cluster ~2,400/mo, grout repair near me 1,300/mo). 7 empty photo slots remain.|
|sitemap.xml                   |⏳ PENDING|40 URLs (added /handyman-manhattan) — commit with page.|
|_redirects                    |⏳ PENDING|Added /handyman-manhattan.html→/handyman-manhattan — deliver as _redirects.txt, rename on commit (no extension).|

## Location pages

|Page                                 |Status  |Notes                                                                                                            |
|-------------------------------------|--------|-----------------------------------------------------------------------------------------------------------------|
|/renovation-contractor-bronx         |✅ DONE  |Rebuilt unique (was Nassau copy); self-canonical; title/meta compliant; links clean.                             |
|/renovation-contractor-brooklyn      |✅ DONE  |“general contractor brooklyn” ×6; title 48 / meta 156; links clean.                                              |
|/renovation-contractor-manhattan     |✅ DONE  |title 52 / meta 154; links clean. Strong content.                                                                |
|/renovation-contractor-queens        |✅ DONE  |title 49 / meta 153; links clean. Strong content.                                                                |
|/renovation-contractor-long-island   |✅ DONE  |title 54 / meta 144; links clean. LI hub.                                                                        |
|/renovation-contractor-nassau-county |🔎 VERIFY|title 56 / meta 145 / OG added. **Still thin (~255w)** — rebuild deep OR consolidate into LI hub (decision open).|
|/renovation-contractor-staten-island |🔎 VERIFY|title 56 / meta 133 / OG added. Still thin — rebuild deep.                                                       |
|/renovation-contractor-suffolk-county|🔎 VERIFY|title 57 / meta 141 / OG added. Still thin — rebuild as spoke w/ town list.                                      |

## Core / hub pages

|Page     |Status   |Notes                                                                                                                                                  |
|---------|---------|-------------------------------------------------------------------------------------------------------------------------------------------------------|
|/ (index)|✅ DONE   |title 54 (“General Contractor Brooklyn & NYC”) / meta 144; H1 entity fixed; 54 internal links → clean URLs.                                            |
|/about   |✅ DONE   |title 33 / meta 155; H1 spacing fixed; links clean.                                                                                                    |
|/contact |✅ DONE   |GeneralContractor + ContactPoint schema + OG added; links clean.                                                                                       |
|/gallery |✅ DONE   |canonical + ImageGallery schema + OG added; **added to sitemap.xml**; links clean.                                                                     |
|/services|⏳ PENDING|**Next up.** Add ItemList + BreadcrumbList schema, OG, H2 hierarchy, links to all ~30 pages. Now the /lobby-restoration redirect no longer points here.|

## Service pages

|Page                                      |Status   |Notes                                                                                                            |
|------------------------------------------|---------|-----------------------------------------------------------------------------------------------------------------|
|/handyman                                 |🔎 VERIFY |Jul 25: “fix absolutely everything” positioning (12 cat groups, 15 pills), ALL TV mentions removed, FAQ Q4+Q10 rewritten (12=12 sync), rc→66, work gallery added (8 slots images/handyman/work-1..8.jpg), Manhattan pill → /handyman-manhattan. Confirm after commit.|
|/handyman-manhattan                       |🔎 VERIFY |**NEW Jul 25 (Zura direct request).** Commercial/after-hours angle: biz band (offices/restaurants/retail/PM), night-work USP, COI FAQ, 12 neighborhoods, shared work gallery (same work-*.jpg slots as /handyman), rating band → Google reviews. Targets: handyman manhattan (KD 18), handyman nyc 720/mo, handyman services nyc 210/mo. Schema: Service+FAQ(8)+Breadcrumb, rc=66. Added to sitemap (40 URLs) + _redirects. Hero slot: images/handyman/manhattan-hero.jpg (upload!). Confirm after commit + crawl.|
|/bathroom-renovation                      |✅ DONE   |title 54 / meta 158; all-borough/commercial intent; links clean.                                                 |
|/bathroom-renovation-brooklyn             |🔎 VERIFY |**Retargeted Jul 17 to “bathroom remodeling brooklyn” (720/mo, KD 17; competitor #1 proves winnable).** New title/H1/meta/schema/headings; URL unchanged. Confirm after commit + crawl.|
|/bathroom-renovation-manhattan            |✅ DONE   |title 50 / meta 153; links clean.                                                                                |
|/bathroom-renovation-queens               |✅ DONE   |title 47 / meta 152; links clean.                                                                                |
|/bathroom-floor-tile-installation         |✅ DONE   |title 51 / meta 150; links clean.                                                                                |
|/bathroom-wall-panels                     |✅ DONE   |title 45 / meta 146; **H1 now contains “Bathroom Wall Panels”**; links clean. FAQ schema — verify 7 Q have @type.|
|/kitchen-cabinet-installation             |✅ DONE   |title 53 / meta 146; 45 links → clean.                                                                           |
|/kitchen-…-brooklyn/manhattan/queens      |🔎 VERIFY |titles 56–59 / metas 154–159; og:image + alt added. **Still need real project photos uploaded** (1 img each).    |
|/painting                                 |✅ DONE   |title 45 / meta 146; links clean.                                                                                |
|/painting-brooklyn                        |✅ DONE   |title 50 / meta 147; links clean.                                                                                |
|/painting-manhattan                       |✅ DONE   |title 51 / meta 143; links clean.                                                                                |
|/painting-queens                          |⏳ PENDING|Coverage gap — create to match bathroom/kitchen borough coverage.                                                |
|/flooring                                 |✅ DONE   |title 46 / meta 150; links clean.                                                                                |
|/carpentry                                |✅ DONE   |“Carpentry NYC” front-loaded title/H1; meta 159; links clean.                                                    |
|/water-damage                             |✅ DONE   |title 49 / meta 149; links clean.                                                                                |
|/deck-building, /deck-renovation          |✅ DONE   |titles 38/40, metas 142/134; links clean.                                                                        |
|/exterior-carpentry                       |✅ DONE   |title 43 / meta 136; links clean.                                                                                |
|/stair-renovation, -restoration, -building|✅ DONE   |titles/metas trimmed; links clean.                                                                               |
|/stair-upgrade                            |✅ DONE   |links clean. **Stair ×4 still near-duplicate cluster — consolidate/differentiate (PENDING strategic).**          |

## Funnel / system / tools

|Page                                              |Status|Notes                                                                                                                        |
|--------------------------------------------------|------|-----------------------------------------------------------------------------------------------------------------------------|
|/estimate                                         |✅ DONE|noindex + canonical added; 10 H1 → 1 H1 (rest H2); links clean.                                                              |
|/review                                           |✅ DONE|noindex added; links clean.                                                                                                  |
|/handyman-estimate, /dashboard, /quote, /agreement|✅ DONE|noindex set. (dashboard div-balance −2 is known JS baseline — don’t “fix”.)                                                  |
|Internal tools .html links                        |⏳ LOW |contract/invoice/image-studio/seo-content/keyword-volumes still use .html internally — noindex, SEO-irrelevant, low priority.|

## Cross-site / technical

|Item                         |Status         |Notes                                                                                                                        |
|-----------------------------|---------------|-----------------------------------------------------------------------------------------------------------------------------|
|Internal .html links (FIX 1) |✅ DONE (public)|**partials/menu (83→0) + footer (17→0) cleaned = sitewide nav fixed**, plus all public body pages. Only noindex tools remain.|
|Meta descriptions ≤160       |✅ DONE         |All public pages compliant.                                                                                                  |
|Title tags ≤60               |✅ DONE         |All public pages compliant.                                                                                                  |
|/lobby-restoration redirect  |✅ DONE         |Repointed /services → /renovation-contractor-manhattan (recovers 1,404 impressions).                                         |
|robots.txt                   |✅ DONE         |keyword-volumes + 3 tools blocked.                                                                                           |
|sitemap.xml                  |✅ DONE         |/gallery added; XML valid.                                                                                                   |
|Nassau/Staten/Suffolk OG     |✅ DONE         |OG/Twitter added all three.                                                                                                  |
|BreadcrumbList sitewide      |⏳ PENDING      |Add to service/location pages.                                                                                               |
|robots.txt + sitemap validity|✅ DONE         |Verified. Don’t re-enable CF robots mgmt or AI-bot Disallow.                                                                 |

-----

## Active queue (next)

1. **/services rebuild** (schema + OG + H2 + links to all pages).
1. **Decide Nassau/Staten/Suffolk:** rebuild deep vs consolidate into LI hub.
1. **Stair ×4 consolidation** (near-duplicate).
1. /painting-queens (coverage gap).
1. Kitchen borough real project photos (upload).
1. BreadcrumbList schema sitewide.

*After commit → Cloudflare Purge Everything → GSC Request Indexing on changed URLs → re-run Semrush.*

## Jul 3 — Backlink analysis + Citation Pack

- Backlink truth: ~200 of 218 links are scraper spam (auto “aged domains” bot pages) — Google ignores them; do NOT disavow. Real genuine links ≈ 3 follow + few directories. Authority Score 7 confirmed as THE ranking ceiling.
- Lost vital link: americasrenovators.com “Best Home Remodelers in Brooklyn” broke May 23 — restore it (in pack, item #1).
- **CITATION-PACK.md delivered** — exact NAP block, categories, short/medium/long descriptions (no “licensed”), services list, 12-directory priority order (Yelp→Houzz→Angi→Thumbtack→Bing→Apple→Nextdoor→BBB→Foursquare→Porch/BuildZoom→Brooklyn Chamber), tracking checklist. This is Pillar 3 execution — highest-leverage remaining action alongside photo uploads.

## Jul 3 — Estimate funnel tracking (GA4)

- /estimate wizard now fires custom GA4 events: **estimate_view** (page open + source page), **estimate_start** (moved past step 1), **estimate_step** (every step, with step_number), **estimate_abandon** (left without finishing, with furthest step reached), **estimate_complete** (success screen). source_page param = the page they clicked from (referrer path, persisted per session).
- Implementation: wrapper around goToStep() + pagehide listener; beacon transport; safe if gtag late-loads. Wizard JS node-checked.
- ZURA SETUP (one-time, 3 min): GA4 → Admin → Custom definitions → Create custom dimension ×2: (1) name “Source Page”, scope Event, parameter `source_page`; (2) name “Step Number”, scope Event, parameter `step_number`. Without this, events still record but params won’t show in standard reports (Realtime shows immediately).
- Where to look: Reports → Engagement → Events (counts) · Explore → Funnel exploration (estimate_view → estimate_start → estimate_complete) · click estimate_abandon → step_number = where people quit.

## Jul 3 — Live form-start notifications (email to phone)

- NEW netlify/functions/form-alert.js — emails Zura instantly via Resend (from [estimates@sanibuildingcorp.com](mailto:estimates@sanibuildingcorp.com) to CONTRACTOR_EMAIL/[sanibuildingcorp@gmail.com](mailto:sanibuildingcorp@gmail.com)): 🟢 form START (source page + step) and 🟡 ABANDON (quit step + any partial name/phone/service = callable partial leads). Uses existing env vars, no setup needed.
- estimate.html tracker wired: start → fetch keepalive; abandon → sendBeacon. One alert per session each. GA4 events unchanged.
- Dashboard already logs visits via track-visit.js → Supabase (no change needed).

## Jul 3 — Visit alerts + alert debug tools
- Debug finding: estimate.html tracker + form-alert.js ARE committed correctly; test failure was likely Cloudflare cache or Gmail spam. Added direct test URL to isolate.
- **form-alert.js v2:** GET ?test=1 → sends ✅ test email (browser-openable, bypasses front-end entirely); new type "visit" (👀 email with page + referrer).
- **partials/site.js:** appended visit-alert IIFE — one 👀 email per visitor session, sitewide. Owner silencing: open any page with **?owner=1** once per device (stored in localStorage). Internal tool pages excluded. GA4/menu/footer verified intact, node-checked.
- Volume note: expect roughly 5–20 visit emails/day at current traffic.

## Image architecture — SPLIT (Jul 7 2026)
All shared image paths split to per-page unique paths (`images/<page-slug>/<file>`, homepage=`images/home/`). 364 refs rewritten across 39 pages; 242 clone pairs. One-time `clone-images.js` (?key=sani-split-2026) clones existing photos to new paths in ONE commit via git tree API, then delete the function. Every page now fully independent — uploads in Image Studio affect only that page. Empty slots stay empty (photo upload still #1 pending item). Image Studio bulk upload + auto-compress (~120KB target) live.

## Thin-content fix (Jul 7 2026)
Semrush Jul 7: Health 95% (+1). Fixed low word count / low text-HTML ratio: contact 169→416w, services 180→413w, gallery 183→408w (design-matched content sections, residential+commercial, Manhattan-first, insured). Remaining 130 "broken internal images" = empty per-page slots after split → Zura bulk-uploading photos via Image Studio. 2 "blocked from crawling" + 2 "one internal link" pages: review next session.

## Homepage duplicate-URL row (Jul 7 2026)
Semrush showed homepage twice (with/without trailing slash) — cosmetic crawl artifact, canonical already correct (…com/). Normalized 5 no-slash refs (JSON-LD url fields) to trailing slash in: index, about, contact, services, tile-grouting-restoration. Gallery ratio 0.04→0.07 after content fix (markup-heavy page, low priority). contact/services word-count content confirmed committed.
