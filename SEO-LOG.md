# SEO-LOG.md — Sani Building Corp

Single source of truth for on-page SEO. **Continuity protocol:** read this first every new chat. Self-directed work touches only PENDING/VERIFY rows; a direct Zura request always overrides and is done immediately regardless of status.

**Legend:** ✅ DONE · 🔎 VERIFY (confirm after commit/crawl) · ⏳ PENDING (fix queued)

*Last updated: Jun 27 2026 (batch 3) — by Claude. Authority Score 7; money keywords page 4–8. Priority per Jun 2026 core updates: consolidate thin/duplicate pages + topical depth, not new pages. **License rule enforced** — all “Licensed” claims stripped, “Fully insured” used.*

## Confirmed by Perplexity re-audit (post 21:46 commit): 5 FIXED, 0 regressions.

-----

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
|/handyman                                 |✅ DONE   |Retargeted Brooklyn; title 57 / meta 159; 46 links → clean.                                                      |
|/bathroom-renovation                      |✅ DONE   |title 54 / meta 158; all-borough/commercial intent; links clean.                                                 |
|/bathroom-renovation-brooklyn             |✅ DONE   |title 49 / meta 154; links clean. Sole Brooklyn target.                                                          |
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
