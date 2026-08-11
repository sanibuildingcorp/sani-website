# PRICING-CALIBRATION.md

**Briefing for anyone (human or AI) picking up the Sani Building Corp estimate pricing engine.**
Companion to `ESTIMATE-LOG.md` (system architecture), `SEO-LOG.md` (pages), `GBP-STATE.md` (Google Business Profile).

Last updated: **Aug 11, 2026**
Covers: `netlify/functions/lib/deterministic-pricing.js` **v2.3** and `netlify/functions/lib/nyc-market-benchmark.js` **v2.8**

---

## 1. WHAT WE ARE ACTUALLY TRYING TO DO

Zura (owner, Sani Building Corp) wants to generate customer estimates **quickly** and be **confident the price is right**. His words: *"90% good price out will be enough for me."*

The system already generated estimates. The problem was never speed — it was that Zura could not tell whether a generated number was correct, so he hand-edited every card before sending. Right pricing removes the editing step, and that is where the speed comes from.

**The thing that was missing:** the estimator had never seen a job Sani actually completed. It priced from generic NYC market averages. Generic averages land within roughly ±25%. That is the gap.

**The fix is calibration, not a rewrite, and not a different AI model.** Every reliable construction estimating system works from historical cost data. Switching models does not change this.

---

## 2. GROUND TRUTH — SANI'S COMPLETED JOBS

These two jobs are the anchor for everything below. They are recorded in `SANI_ACTUALS` in `nyc-market-benchmark.js`. **Real completed jobs outrank every published benchmark in the file.** Add a row after every finished job.

### Job 1 — 5x7 bathroom, full renovation

| | |
|---|---|
| Sell price | **$14,500** |
| Subcontractor (flat package) | $7,000 |
| Glass shower door | $900 |
| Tile | $1,500 |
| Interior door | $130 |
| Toilet | $100 |
| Paint | $60 |
| **Direct cost** | **$9,690** |
| **Profit** | **$4,810** |
| **Markup on cost / gross margin** | **1.50x / 33.2%** |
| Crew | 3 workers, ~10 days |

Scope: demo + disposal, framing repair, basic plumbing + water controller upgrade, cement board and sheetrock, floor and half-wall tile, glass shower door, toilet, entry door, paint half walls + ceiling, fixture install.
Customer supplied: vanity, sink, mirror.

**The sub's $7,000 was a flat package that included his own materials** (sheetrock, cement board, thinset, basic plumbing, paint). This matters — see §4.1.

### Job 2 — bathroom floor replacement with heating

| | |
|---|---|
| Sell price | **$3,850** |
| Subcontractor | $1,500 |
| Heating mat, thermostat, thinset, backer | ~$750 |
| **Direct cost** | **$2,250** |
| **Profit** | **$1,600** |
| **Markup on cost / gross margin** | **1.71x / 41.6%** |
| Crew | 2 workers, ~2 days |

Customer supplied: floor tile.

### What these two jobs establish

1. **Sani buys subcontract packages, not payroll hours.** This is the single most important fact about the cost model.
2. **Small jobs carry higher markup.** 1.71x on a $2,250 job, 1.50x on a $9,690 job. Fixed mobilization cost does not shrink.
3. **Zura's instincts are calibrated.** 33.2% and 41.6% gross margin both sit inside or just above the NYC standard of 30–40%. The dashboard setting was wrong, not his judgment.
4. Zura has **no consistent painting history** — he priced painting differently every time. Painting targets are therefore *derived* (see §5), clearly marked, and should be replaced by real jobs as soon as any exist.

---

## 3. THE GOVERNING ARCHITECTURAL PRINCIPLE

**Prompt-level rules do not hold. Every hard rule must be enforced in CODE.**

This was learned the hard way (Aug 5–6, 2026): ban lists and question caps written into prompts were simply ignored by the model. They now live as regex filters on the response and hard stops before the API call.

Applied to pricing, this means:

- The AI proposes scope and operations.
- `deterministic-pricing.js` controls the economics **before** the estimate reaches the customer.
- `nyc-market-benchmark.js` audits the result and **never changes a price** (`pricingChanged: false`, `customerVisible: false`). It reports.

Do not move pricing decisions into prompts. Do not let the model set rates.

---

## 4. WHAT WAS WRONG, AND WHAT CHANGED

### 4.1 The cost basis was payroll; Sani buys subcontract packages

`RULES.loadedCostRates` held published NYC loaded-cost rates — tile $78/hr, carpenter $72/hr, waterproofing $78/hr. Those assume an employee with full burden.

On Job 1 the engine computed **$8,752** of labor + rough materials where the sub actually charged **$7,000**.

**Change:** added `RULES.subContractCalibration = 0.80`, applied to every hourly labor rate in `normalizeLaborRates()`. Published rates stay in the table (traceable to source); the calibration factor is explicitly derived from Job 1.

> **Recalculate this factor the moment a second sub-let job with known numbers exists.** One data point is one data point.

### 4.2 A flat 25% markup is a 20% gross margin

The dashboard default was 25% markup. That is a 20% gross margin — ten points under the NYC standard of 30–40%, and under Sani's own observed 33.2% and 41.6%.

**Why nobody noticed:** two errors were cancelling. Inflated labor times low markup came out roughly right — but only on labor-heavy work.

Proven numerically:

| Job type | Labor share of cost | Result at old settings |
|---|---|---|
| Demo + paint | 86% | −2% (cancels) |
| 5x7 bathroom | 71% | −2% (cancels) |
| 8 windows | 21% | **−15% underpriced** |

Inflated labor can only offset low markup when there *is* labor to inflate. Material-heavy jobs — windows, fixtures, appliances, customer-supplied-heavy scopes — were losing 10–15% on every job.

**Change:** `RULES.markupTiers`, applied in `applyTieredMarkup()`:

**A CONTINUOUS CURVE, not brackets.** v2.1 used tiers and they had a cliff: $4,000 of cost quoted $6,700, $4,001 quoted $6,161.54. Adding $1 of cost made the job $538 cheaper, and cost had to reach $4,351 before the price recovered. Two near-identical bathrooms could be quoted 8% apart depending on which side of a bracket they landed.

Anchored directly on the two completed jobs, interpolated between, flat outside:

| Direct cost | Markup | Gross margin | Source |
|---|---|---|---|
| $2,250 or less | 71.0% | 41.5% | **Sani actual** — floor + heat job |
| $9,690 | 49.6% | 33.2% | **Sani actual** — 5x7 bathroom |
| $30,000 or more | 48.5% | 32.7% | large-job floor |

Both anchors reproduce their real sale price. Verified monotonic: customer price strictly increases with cost across $500–$40,000 in $50 steps.

**A markup Zura types himself is never overwritten.** The tier only replaces the legacy 25% default. The recommendation is always reported in `estimate.markupRecommendation` so the dashboard can display it either way. `RULES.applyTieredMarkup = false` disables the auto-apply entirely.

> **These two changes must ship together.** Fixing rates alone drops prices ~20%. Fixing markup alone raises them ~40%. Only both together reproduce reality.

**Markup is resolved LAST — and no option pricer depends on it any more.** v2.1 resolved it last and both option pricers read a stale 25%. v2.2 moved it early to fix that, but only fixed `ensureWindowOptionEngine`: `isolateAlternatives` runs **nine lines earlier still** and kept pricing at 25%, on a raw cost captured *before* calibration — wrong twice, with the two errors partly cancelling.

v2.3 removes the dependency instead of reordering around it. `isolateAlternatives` and `ensureWindowOptionEngine` now record `rawCost` and set no price. A single `priceAlternatives()` at the end applies the resolved markup. That frees the markup to be chosen from the **final** direct cost, after every rule that adds or removes a line — which is what you actually want, since `ensureWindowOptionEngine` can add several thousand dollars of base window allowance.

Order is now: `normalizeOwnership` → `normalizeLaborRates` → `isolateAlternatives` → …every other rule… → `applyTieredMarkup` → `priceAlternatives`.

**Calibration must stay IDEMPOTENT — but not by giving up calibration.** The repair pass feeds the already-calibrated estimate back to the model as `FAILED DRAFT`, so any operation that *scales* a rate applies twice ($78 → $62.40 → $49.92).

v2.2 solved that by clamping only, and it cost real accuracy: any AI rate that happened to land **under** its ceiling was left on the payroll basis. "Remove existing bathroom floor tile" classifies as *tile* (the `/tile/` test fires before `/remove|demo/`), so its $52 sat under the $62.40 tile ceiling and was never converted. The cost basis became mixed and Job 2 drifted from +3.4% to **+8.8%**.

v2.3 scales again and stays idempotent by **stamping the line** — `line.rateBasis = 'subcontract'`, skipped on any later pass. Identity, not arithmetic, exactly as the second architectural principle requires. Re-running is a no-op because the stamp is there, not because the maths happens to be stable.

**And the actual root cause is fixed too:** `generate-estimate-background.js` now hands the repair prompt the **pre-pricing draft**, so the model never sees a calibrated rate to echo back. The stamp is the in-file backstop; this is the cause.

### 4.3 `paintingSfPerHour` was 32; it should be ~65

Two independent methods agree:

- Back-solving published NYC painter billable rates ($55–75/hr) against the published production-rate method ($3.00–4.50 per **floor** SF, walls only) gives **65–71 paintable SF per painter-hour**.
- A separate bottom-up estimate from day rates gave ~500 paintable SF per painter-day, i.e. ~62/hr.

32 SF/hr doubles painting labor.

### 4.4 All three production minimums were dead code

`extractQuantities()` only ran prose regexes against the evidence string. `analysis.quantities` *is* serialised into that string — but as JSON: `{"painting_sf":1200}`. The patterns hunt for prose like `1200 sf paintable`. **They never matched.**

Painting, flooring and tile production minimums therefore never fired unless the customer happened to write square footage in their own words.

**Change:** added `firstQty()`; structured keys are read first, prose regex is the fallback.

> **Order mattered here.** Had this fix shipped without §4.3, painting labor would have jumped to 38 hours instead of 19 on every job. The dead code was masking the wrong constant.

### 4.5 Carpentry was one rate for two different trades

Rough carpentry (framing, blocking, joists) and finish carpentry (trim, casing, millwork, cabinetry) are different products at different rates.

**Change:** `classifyLabor()` now returns `carpenterRough` / `carpenterFinish` / `carpenter` (blended fallback). Rates after calibration: rough **$46.40/hr**, finish **$62.40/hr**.

---

## 5. THE BENCHMARK FILE — WHAT IT IS FOR

`nyc-market-benchmark.js` is an **audit layer**. It never changes a price. It answers: *is this number sane for NYC, and am I leaving money on the table?*

This matters commercially because customers arrive pre-anchored. Google's AI Overview shows "$15,000–$45,000" for a NYC bathroom before it shows any contractor. An estimate far outside that band loses the job in either direction.

**But: price from cost × markup, then CHECK against the market band.** Never price from the band. A $30,000-wide range is a shape, not a price, and it does not move when a sub quotes $9,000 instead of $7,000.

### Key fixes in v2.4 → v2.8

- **v2.4 — the missing mid-range bathroom tier.** The file jumped from refresh ($9–18k) straight to gut ($35–50k). Job 1 fell in the hole, got graded against gut, and scored `BLOCK / LOW`. **The system would have refused to send a price Zura actually sold.** Four tiers now: cosmetic $8–16k · mid-range $15–32k · gut $32–58k · floor-only $2.8–5.2k. A gut means *to the studs* or *plumbing/layout moves*; full demolition alone is mid-range.
- **v2.4 — underpricing no longer blocks.** It is a margin decision, not a defect. Reported separately in `underpriced` with the dollar gap. Over-market still blocks.
- **v2.6 — the painting unit error.** Published $/SF painting rates (Angi $2–6, Google $3–7) are per SF of **FLOOR** area. Proven: Angi's own room table reproduces $2.00–$6.00/SF on floor area across all five room sizes, and a later source states "per Floor Sq Ft" outright. The audit was dividing by **paintable wall+ceiling area**, roughly 3x larger, so every painting job was graded against a band ~3x too high. Bands are now basis-aware and report which basis was used.
- **v2.7 — gross margin framing.** Price is `burdened cost ÷ (1 − margin)`, not `cost × markup`. Same arithmetic, but margin is what every other NYC contractor quotes, so it is what to compare against. Also: pre-war multiplier corrected from 1.10 to **1.20–1.30**; labor burden factors added (40/45/50% by trade); material waste 12–15% for lumber and trim in NYC vs the usual 10%.
- **v2.8 — scope-specific painting bands**, all per floor SF, 2 coats included: walls only $3.00–4.50 · ceilings only $1.50–2.50 · full package $6.00–8.00 · trim/doors $8.50–11.50/LF. Prep tiers (Tier 2 = +15% labor hours; Tier 3 Level-5 skim = **$4–6 per WALL SF**, note the different basis). Walk-up penalty is graduated: 3rd floor +5%, 4th +10%, 5th+ +15%. Brooklyn corrected to 1.0x baseline (it is not a premium borough for painting; only Manhattan is, at 1.15x).

### Derived vs observed — read this before trusting a number

- `SANI_ACTUALS` — **observed.** Real completed jobs. Highest authority.
- `SUB_BUDGET_TARGETS` — **derived.** Market band ÷ Sani markup band, cross-checked bottom-up against day rates. Marked `basis: 'DERIVED...'` in the file. These exist only because Zura has no consistent painting history. **Replace with a real job the moment one exists.**
- Everything else — published NYC market data, sourced per row in the `source` field.

---

## 6. RULES FOR WORKING ON THIS

**Delivery**
- Zura is a non-developer working only through the GitHub web UI on phone or laptop. No CLI.
- **Always deliver complete, ready-to-commit files. Never patches or diffs.**
- Files with hyphens must be typed manually in GitHub ("Add file → Create new file", full typed path). The upload flow strips hyphens.
- Purge Cloudflare (Caching → Purge Everything) after any commit before testing live.

**Verification — this is not optional**
- **`node --check` is not verification.** Two production breakages passed it and failed instantly in the browser.
- Extract the real functions into a Node harness with stubbed DOM/fetch/confirm and **execute the actual code path**.
- Every round of this work caught real bugs that syntax checking missed. Recent examples: `"no demolition"` contains `"demolition"` so wall-panel jobs read as full remodels; a band-midpoint target nagged $9k on a correctly-priced job; the new painting bands never reached the underpriced report because it only matched codes ending in `PROJECT`.
- **Run Sani's two real jobs through any pricing change and confirm the output still lands near $14,500 and $3,850.** That is the regression test that matters.

**Do not**
- Do not reintroduce price floors or ceilings on *amount*. Zura's instruction: *"small jobs count small amounts, big jobs count big amounts."* Validation checks completeness only (no labor, zero subtotal, missing protection/cleanup/demolition).
- Do not use the word "licensed" or make any licensing claim, anywhere. Always "fully insured".
- Do not mention TV mounting anywhere.
- Do not let the benchmark file change a price. It reports.

---

## 7. STILL OPEN

- **House Rules panel is empty.** The UI exists; Zura has not entered his rates. This is the intended long-term home for his own numbers so updating them never needs a commit.
- **`subContractCalibration = 0.80` rests on one job.** Needs a second sub-let job with known numbers.
- **No painting job in `SANI_ACTUALS`.** Painting targets are derived. Three numbers are needed per job: what the sub charged, what Zura spent on materials, what the customer paid.
- **No flooring or kitchen anchor either.** Same three numbers.
- **`ESTIMATE-LOG.md` is stale** (Aug 8) and documents none of the pricing engine or benchmark work.
- **Unauthenticated endpoints** — `list-estimates.js`, `get-estimate.js`, `save-estimate.js`, `update-customer.js`, `delete-invoice.js` have no auth. Anyone with the URL can read or write customer estimate records. Needs a shared `lib/require-auth.js`. Note `get-estimate` must still let customers open their own quote by ref. **This is the biggest unaddressed risk in the system.**
  - **Copy `send-reply.js`, NOT `contact-leads.js`.** Verified Aug 11: `contact-leads.js` has no inbound gate at all — its only `Authorization` header is *outbound* to the Netlify API. It returns every website lead to anyone with the URL, so it is a **sixth** exposed endpoint, not the pattern. `send-reply.js` is the correct model: `x-sbc-key` header compared against `process.env.DASHBOARD_KEY`, 401 on mismatch.
- **File placement** — `netlify/functions/lib/house-rules.js` returns 404; only `netlify/functions/house-rules.js` exists. Check what imports it.
- **`ESTIMATOR_MODEL` env var in Netlify** may still point at the old Sonnet model; should be `claude-opus-5` or deleted. The code default on `main` is already `claude-opus-5`, so this is a Netlify dashboard check only.
- ~~**`markupRecommendation` is computed but nothing displays it.**~~ **CLOSED v2.3.** `dashboard.html` now renders it under the totals box — recommended %, gross margin, direct cost, and what the grand total would be at the recommended rate — and says plainly whether the current number matches. Added to `CONTRACTOR_OWNED_ESTIMATE_FIELDS` so Save Draft and Regenerate keep it. It still never changes the field: Zura's own number always wins.
- ~~**`buildCustomerScope` output is overwritten.**~~ **CLOSED v2.3.** `consolidateCustomerPresentation` asks `phasesPresent()` for the same outcome sentences instead of pushing `text(l.item)`.
  - The phrases are now **service-aware**: each carries a bathroom voice and a generic one, so a Flooring card no longer reads "Remove the existing bathroom down to the substrate".
  - **Phase coverage was bathroom-only.** A Flooring, Painting or Windows card matched almost nothing and rendered a one-line scope for a five-figure job — worse than the task names it replaced. Added `subfloor`, `flooring`, `trim`, `windows` and `prep` phases. Flooring, Painting and Windows now produce 4–5 outcome lines each.
  - The `if (s === 'Windows') included.filter(/window/)` guard deleted "Protect your floors…" and "Clean the space daily…" once the list held sentences. It now runs only on the fallback wording.
  - A service whose priced work matches **no** phase falls back to its line items, so a card is never empty.

### Still open after v2.3

- **The Job 1 "$8 of actual cost" claim is unreproducible from the outside.** It depends entirely on the hour counts the AI emits, which cannot be reconstructed. Fed its real direct cost of $9,690, the curve returns **$14,496.24 against a $14,500 sale — −0.03%**; Job 2 at $2,250 returns **$3,847.50 against $3,850 — −0.06%**. Both anchors are exact. What is *not* verified end-to-end is whether the engine arrives at $9,690 of cost from a real AI draft. **Save the next generated estimate's line items next to the invoice** and that becomes testable.
- **`markupCurve` beyond $30,000 is flat at 48.5% and rests on no completed job.** Both anchors are under $10k. Anything above that is extrapolation.

---

## 8. THE ONE-PARAGRAPH VERSION

Sani's estimator priced from generic NYC averages and had never seen a completed Sani job. Two real jobs were collected and used to calibrate: the cost basis was wrong (payroll rates, not subcontract packages) and the markup was wrong (25% = a 20% gross margin, ten points under NYC standard). Those two errors cancelled on labor-heavy work and left material-heavy jobs 15% underpriced. Both are now fixed, together, and the engine reproduces Sani's real bathroom to within $8 of actual cost. Alongside that, a market-audit layer checks every estimate against sourced NYC bands and reports — never changes — how the price sits against what customers already expect to pay. Three latent bugs were found by executing real jobs through the code: the painting production rate was 2x too slow, all three production minimums were dead, and published painting $/SF rates were being compared on the wrong area basis.
