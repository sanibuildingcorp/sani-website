# Sani Estimate Generator v5 — new brain (NOT committed)

Written by Perplexity, Oct 6 2026. Nothing is in GitHub. Zura approves before anything is committed.

## Why the old one is wrong
`generate-estimate-background.js` asks the AI to invent every line, hour and rate, then
~1,850 lines of `deterministic-pricing.js` try to correct it. Different guess every time.
"Update estimate from chat" re-runs that whole thing (`pzChatUpdate()` -> `generateAI(true)`),
so one tap rewrites the whole estimate.

## How v5 works
```
request + chat + photos ──► READER (AI, 1 call) ──► reading (ids + quantities only)
                                  │ validate() in code: unknown ids out, qty clamped,
                                  │ no prices, no "General", no TV/gas/options/licensed
                                  ▼
            price-book-v5.js ──► ENGINE (code) ──► estimate (same fields the dashboard reads)
                                  lines · markup curve · min price · steps · timeline ·
                                  included · not included (max 5, job-specific) ·
                                  who supplies · finish cards · customer needs
```
- The AI cannot write a price. It can only pick a price-book id and a quantity.
- Same reading -> same price, every time.
- Not in the book -> "custom" line at $0 flagged "Needs your price".
- Small job (< 6 crew-hours): one light setup line, no permits/hidden-damage boilerplate.
- Chat update = re-read with the previous reading, rebuild, then put back every hand line,
  hand rate and hand text; returns a change list (old -> new, $) for Apply / Cancel; old
  estimate kept in `estimateHistory` for undo.

## Files
| File | What |
|---|---|
| `netlify/functions/lib/price-book-v5.js` | All prices (DRAFT — Zura must confirm) |
| `netlify/functions/lib/job-reader-v5.js` | Reader prompt + validator (rules in code) |
| `netlify/functions/lib/estimate-engine-v5.js` | Engine: build(), update(), diff() |
| `netlify/functions/generate-v5-background.js` | Netlify function: new / chat / apply |
| `js/estimator-v5.test.js` | 9 tests — `node js/estimator-v5.test.js` |

## Test results (seed prices)
| Job | Price | Sani actual |
|---|---|---|
| Toilet replacement | $880 | old quote $933 |
| Vanity install, customer supplies vanity | $931 | — |
| 5x7 full gut + paint, customer supplies vanity | $13,620 | $14,500 |

## To wire in (for Claude, one step at a time, after Zura's OK)
1. Add the 5 files as they are.
2. Dashboard "Generate estimate" -> POST `/.netlify/functions/generate-v5-background` `{ref, mode:"new"}`; poll `record.v5Status`.
3. "Update estimate from chat" -> `{ref, mode:"chat", offFacts:[unticked fact texts]}`; show
   `record.estimateV5Pending.changes` as a list with Apply / Cancel; Apply -> `{ref, apply:true}`.
   Never call `generateAI` from this button again.
4. Show `needsPrice` lines in orange with "Needs your price"; show `warnings`.
5. Wire photos: pass `photoBlocksForClaude(request, record)` into `readJob` (marked TODO).
6. Keep the old generator as a fallback button "Old generator" for 2 weeks, then remove.
7. Price book editable in the dashboard (Settings -> Price book) later; for now edit the file.

## Price book (DRAFT seed — Zura, check every number)
| id | Service | Item | Unit | Sani cost/unit (labor) | Materials |
|---|---|---|---|---|---|
| protect | Whole Project | Protection: floors, hallway, elevator | job | $120 | Floor protection paper & tape $45/kit |
| cleanup | Whole Project | Daily cleanup, debris removal & final clean | job | $180 | Contractor bags & disposal $60/job |
| setup_small | Whole Project | Small job: protection, cleanup & disposal | job | $60 | Drop cloths, bags & disposal $15/job |
| bath_demo_gut | Bathroom | Bathroom demolition to studs + disposal | sf | $28 |  |
| bath_rough_plumb | Bathroom | Plumbing rough-in, fixtures in same location | job | $1100 | Valves, fittings & supply lines $260/kit |
| bath_backer | Bathroom | Cement board & sheetrock walls | sf | $4.5 | Cement board / moisture-resistant board $16/sheet; Screws, tape, mud $40/kit |
| waterproof | Bathroom | Shower waterproofing membrane | sf | $3.5 | Waterproofing membrane $119/roll |
| wall_tile | Bathroom | Wall tile installation | sf | $14 | Wall tile $4.5/sf (customer can supply); Thinset, grout & trim kit $140/kit |
| floor_tile | Bathroom | Floor tile installation incl. leveling | sf | $15 | Floor tile $4/sf (customer can supply); Mortar, leveler & grout kit $95/kit |
| floor_heat | Bathroom | Electric floor heating mat + thermostat | sf | $6 | Floor heating mat $12/sf (customer can supply); Thermostat $180/ea (customer can supply) |
| regrout | Bathroom | Remove old grout, regrout & seal | sf | $12 | Grout, sealer & caulk kit $85/kit (customer can supply) |
| recaulk | Bathroom | Remove & replace silicone caulk | lf | $4 | Silicone caulk $12/tube |
| toilet | Bathroom | Remove old toilet, install new, connect & test | ea | $220 | Toilet, elongated 2-piece with seat $199/ea (customer can supply); Wax ring, bolts & supply line $35/kit |
| toilet_flushometer | Bathroom | Flushometer toilet (no tank) replace | ea | $380 | Wall-hung/flushometer bowl $320/ea (customer can supply); Flush valve kit $190/ea (customer can supply) |
| vanity | Bathroom | Remove old vanity, install new, connect & test | ea | $300 | Vanity with top, 30 in $489/ea (customer can supply); Faucet $129/ea (customer can supply); Drain, trap & supply kit $55/kit |
| shower_glass | Bathroom | Glass shower door install | ea | $350 | Glass shower door $900/ea (customer can supply) |
| bath_accessories | Bathroom | Install accessories (bar, hooks, paper holder, mirror) | ea | $45 | Bathroom accessory $35/ea (customer can supply) |
| exhaust_fan | Bathroom | Replace exhaust fan (existing duct & wiring) | ea | $220 | Exhaust fan $140/ea (customer can supply) |
| paint_prep | Painting | Patch, sand & spot prime | room | $110 | Patch, primer & tape kit $45/kit |
| paint_walls | Painting | Paint walls, 2 coats | sf | $1.1 | Interior paint $58/gal (customer can supply) |
| paint_ceiling | Painting | Paint ceilings, 2 coats | sf | $1 | Ceiling paint $48/gal (customer can supply) |
| paint_trim | Painting | Paint trim & baseboard | lf | $2.2 | Semi-gloss trim paint $62/gal |
| paint_door | Painting | Paint door & frame, both sides | ea | $85 | Door paint $62/gal |
| skim | Painting | Skim coat walls | sf | $1.8 | Joint compound $22/box |
| drywall_patch | Handyman | Drywall patch, tape, finish (small) | ea | $120 | Patch, tape & mud kit $25/kit |
| handyman_hour | Handyman | Handyman labor | hr | $75 |  |
| door_install | Carpentry | Install pre-hung interior door | ea | $220 | Pre-hung interior door $130/ea (customer can supply); Hinges/handle set $35/ea (customer can supply) |
| trim_install | Carpentry | Install baseboard / casing | lf | $4.5 | Baseboard / casing $2.2/lf (customer can supply); Nails, caulk & filler $30/kit |
| floor_remove | Flooring | Remove existing flooring + disposal | sf | $1.8 |  |
| lvp | Flooring | Install vinyl plank / laminate | sf | $2.8 | Vinyl plank flooring $2.9/sf (customer can supply); Underlayment & transitions $60/kit |
| cabinet_box | Kitchen | Install kitchen cabinet (per box) | ea | $95 | Shims, screws & fillers $40/kit |
| backsplash | Kitchen | Backsplash tile installation | sf | $16 | Backsplash tile $6/sf (customer can supply); Thinset & grout kit $60/kit |

## Fixes after Claude's review (PR #251)
1. No `temperature`; `max_tokens` 12000.
2. "Update from chat" never writes `record.estimate`: always a pending draft with Apply/Cancel. An old-generator estimate gets a full draft marked "Check every line".
3. A hand price on a book line replaces that line (never charged twice).
4. Record is re-read before saving; only this run's fields are written (messages, autosaves, chatFacts kept).
5. Apply / Cancel / Undo moved to `estimate-v5-apply.js` (normal function, answers after the write with the saved estimate).
6. Dashboard key (`x-sbc-key`) on both functions; dashboard uses `sbcFetch`.
7. "↶ Undo last AI change" link next to AI read.
8. No price floor. His markup is kept on every rebuild/update; the curve is used only for a brand-new estimate.
- Customer-supplied items: no $0 material row; shown in the card's "You supply" list, labor kept.
- `finishStatus` uses the dashboard values. "range hood" is no longer banned. `ea` limit 200.
- Testing: the deploy preview uses LIVE data — test only on a dummy estimate.
