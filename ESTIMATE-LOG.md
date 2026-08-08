# ESTIMATE-LOG.md

**Source of truth for the Sani Building Corp AI estimate system.**
Companion to `SEO-LOG.md` (pages) and `GBP-STATE.md` (Google Business Profile).

> **READ THIS FIRST, EVERY CHAT, BEFORE TOUCHING ANY ESTIMATE FILE.**
> Fetch: `https://raw.githubusercontent.com/sanibuildingcorp/sani-website/main/ESTIMATE-LOG.md`
> Then fetch the specific file being changed from `raw.githubusercontent.com/.../main/<file>`.
> Never build on a stale copy. Never re-litigate a decision already recorded in
> **Section 4 — Decisions & Why**; if a decision needs reversing, add a new dated row
> to Section 6 explaining what changed, don’t silently flip it.

Last updated: **Aug 8 2026**

-----

## 1. WHAT THE SYSTEM IS

A customer fills a 5-step wizard on the website. The request lands in Netlify Blobs
and in Zura’s inbox. In the dashboard, Zura clicks **Generate with AI**, which drafts a
scope + line items. Zura edits, chooses what the customer sees, and sends. The customer
opens a quote page and approves, declines, or requests changes.

**The core design constraint:** Zura is a non-developer working only through the GitHub
web UI. Every deliverable is a complete, ready-to-commit file. Never a patch or diff.

-----

## 2. FILE MAP — WHAT TOUCHES WHAT

|File                                       |Role                                      |Notes                                                                      |
|-------------------------------------------|------------------------------------------|---------------------------------------------------------------------------|
|`estimate.html`                            |The 5-step customer wizard                |Step order is NOT 1-2-3-4-5 in the markup; see §3                          |
|`netlify/functions/estimate-ai-question.js`|Generates ONE follow-up question at a time|Hard-enforced limits live here, not in the prompt                          |
|`netlify/functions/estimate-request.js`    |Saves the request to Blobs + emails Zura  |Builds the empty `estimate` shell                                          |
|`netlify/functions/generate-estimate.js`   |Calls Claude to draft scope + pricing     |The pricing brain                                                          |
|`dashboard.html`                           |Zura edits + sends (≈350KB, 7,700 lines)  |Div balance is **−2 at baseline** (JS string literal, not a real imbalance)|
|`quote.html`                               |What the customer sees                    |Also serves the no-prices scope-of-work view via `?sow=1`                  |
|`netlify/functions/send-quote.js`          |Emails the quote link                     |                                                                           |
|`netlify/functions/quote-response.js`      |Handles approve / decline / change request|                                                                           |
|`partials/site.css`                        |Shared site styles                        |**Loads AFTER the wizard’s inline `<style>` — see §4 “cascade collision”** |

**Storage:** Netlify Blobs, store name `estimates`, keyed by ref (`SBC-YYMMDD-XXXX`).
Handyman bookings are separate (Supabase). Don’t confuse the two.

-----

## 3. THE WIZARD FLOW (non-obvious)

`data-step` values in the markup do **not** match the numbers the customer sees.
Steps 3, 4, 6 and 7 are retired — markup kept, never navigated to.

```
data-step=1   "What kind of project?"   -> customer sees 1 of 5
data-step=8   "Where should we send…"   -> customer sees 2 of 5
data-step=5   "Tell us about the project" -> customer sees 3 of 5
data-step=2   AI follow-up questions    -> customer sees 4 of 5   (loops)
data-step="supplies"  Supplies grid     -> customer sees 4 of 5, label "Last One"
data-step=9   "Does this look right?"   -> customer sees 5 of 5
data-step="success"
```

`DISPLAY_STEP` / `STEP_LABELS` / `TOTAL_STEPS` control the progress bar.
String steps (`'supplies'`, `'ai-loading'`, `'success'`) skip the numeric progress
branch in `goToStep()` — `renderSupplies()` sets the bar manually so the form never
*looks* longer for adding the supplies question.

**Every exit from the AI questions must route to `'supplies'`, never straight to 9** —
including the “Skip these — send my request” link and the catch/fallback path. The
supplies question is the one question worth asking even when someone is bailing out.

-----

## 4. DECISIONS & WHY (do not silently reverse)

**Question budget: 1 service → 2 questions, 2+ → 3, hard cap 3.**
Plus the supplies step. People quit long forms; a lead that never arrives is worth zero,
while a slightly-off estimate still gets a phone call. Precision comes from the
conversation, not the form.

**The test for any question: does the answer move the price by REAL money, and is
there no other way to get it?** If not, don’t ask. Three tiers: *ask* (supplies, counts,
rough size, condition) · *assume* (sane default + confirm on site) · *ask later on the
phone* (tile grade, colours, scheduling).

**Banned question topics — enforced in CODE, not just the prompt.**
Prompt-only bans were tried first (Aug 5) and the model ignored them: it asked 5
questions when the cap was 4, and 4 of them were “who supplies X”. Prompt rules are a
suggestion; regex on the response is a guarantee.

- who supplies / are you supplying → the supplies grid owns this
- quality / grade / tier / budget / mid-range / high-end / premium / luxury → everyone
  says high-end; it tells us nothing. Assume mid-range, Zura adjusts.
- brand, colour
- paint finish / sheen (matte, eggshell, satin, semi-gloss) → **same cost to buy, same
  cost to apply.** Zura’s words: *“Stupid question! Does not matter for price out.”*
- **whether installation / labour is needed** (“Does the vanity need installation
  labor?”, “No, vanity pre-installed”). This one was CREATED by the supplies grid: the
  model saw “customer supplies vanity” and started probing whether Sani still does the
  work. Supplying an item removes the MATERIAL cost, **never** the LABOUR. Offering the
  customer that choice can only delete real money from the quote. Regexes are narrow on
  purpose — “what flooring is currently installed” and “does existing flooring need to
  be removed” must still pass.

**NOT banned — these move the price by real money, keep them:**
window material (vinyl vs fibreglass vs aluminium), what’s currently on the floor
(drives removal + disposal labour), size, quantity, condition, access, occupancy.

**One question per trade topic, per session.** Aug 6: the AI asked “What type of
flooring is currently installed?” and “What’s currently on the floors being replaced?”
in the same run — same question, reworded, two slots burned, and two *contradictory*
answers (“Other/mixed” and “Hardwood or laminate”). Two answers about one thing is
worse than no answer, because Zura can’t tell which is true. The form now sends
`askedLabels`; the server derives covered trades and refuses repeats.
Generic questions (size, access, occupancy, deadline) are deliberately NOT topics, so
they can still be asked alongside a trade question.

**Supplies grid is a FIXED catalogue, not AI-generated.** The strings flow straight into
the estimate, so they must be byte-identical every time — “wall tile” one day and
“porcelain tile” the next would break grouping. The AI picks nothing here. Zura can
edit `SUPPLY_CATALOG` himself without a rebuild.

- Main products only. Never trade supplies (thinset, grout, tape, adhesive, fasteners) —
  those are always Sani’s. Nobody wants to be asked about screws.
- Nothing pre-selected: the common case is zero taps.
- Subtitle MUST say installation is included either way, or people won’t tick anything
  for fear of losing the labour.
- Hard cap 10 items. A long list is a list nobody reads.
- `SUPPLY_FROM_DESCRIPTION` adds items with no service button of their own (windows,
  doors, cabinets, appliances, light fixtures, radiator covers) by reading what the
  customer wrote. **There is no “Windows” service button** — that gap is why windows
  were missing from the grid on John Maxwell’s job.

**Ticking an item removes the MATERIAL, keeps the LABOUR.** Always. And the supplied
item is never priced/guessed — it appears at $0 labelled “supplied by owner”. Guessing
a value for tile the customer chose swings thousands and helps nobody.

**Photo analysis is OFF for pricing by default.** `usePhotoAnalysis` defaults false so
photos can’t inflate a price. Analysis is still saved and shown to Zura.

**Contractor notes override everything.** `extraRequest` in the dashboard is
authoritative and can resize the job. A contractor measurement always beats a vague
customer description.

**Cascade collision (fixed Aug 6, don’t undo):** `partials/site.css` loads AFTER the
wizard’s inline `<style>` and sets `body{color:var(--black)}` = #0e0e0e, plus it
re-declares `--gray`, `--border`, `--navy`, `--gold` in its own `:root`. Result: every
`h2.title` question heading rendered near-black on navy (only `h1.title` had its own
colour rule). Fix = an override `<style>` block placed AFTER the site.css link, scoped
to `.topbar` and `.wrap` only, so the shared menu/footer partials are untouched.
**If wizard text ever goes dark again, this is the cause.**

**LICENSE RULE:** never “licensed” anywhere — copy, schema, contracts, function output.
Always “fully insured”. Enforced in the `generate-estimate.js` prompt as a top-level rule.

**TV RULE:** no TV-mounting service, never mention TV anywhere.

-----

## 5. DATA MODEL (v3, Aug 5 2026)

`record.estimate` shape written by `generate-estimate.js`:

```
projectTitle, summary, scopeOfWork, timelineText, markupPct, notes
labor[]            { item, qty, unit, rate, section }
materials[]        { item, qty, unit, rate, section }
customerSupplied[] { item, section, note }        <- NEW v3, no price, no qty
exclusions[]       [ "short plain-language line" ] <- NEW v3, 3-8 lines
options[]          { label, description, price, section } <- NEW v3, NOT in grand total
```

`record.request.customerSupplies[]` — plain array of strings from the supplies grid.
Treated as **authoritative** by the estimator: never priced, labour kept.

**`section` is required on every labor and material line.** Before v3, `quote.html`
guessed sections from a hardcoded keyword regex (`/window/`, `/paint/`, `/floor/`…).
That worked for John Maxwell’s job by luck and would silently mislabel anything else.
`sectionOf(name, line)` now reads `line.section` first and only falls back to keywords
for pre-v3 estimates. **Backwards compatibility is deliberate — old estimates in Blobs
must keep rendering exactly as before.**

Section ordering on the quote: known trades first (Bathroom, Kitchen, Flooring,
Painting, Carpentry, Windows), then any custom section, with **“General” always last**.

-----

## 6. CHANGE LOG

### Aug 5 2026 — v3 data model

- `generate-estimate.js` rewritten: added `section` on every line, `customerSupplied[]`,
  `exclusions[]`, `options[]`, `houseRules` passthrough, reads
  `request.customerSupplies`. Added the **negative-instruction scan** (hunt for
  “I’m providing”, “no ___”, “excluded”, “except”, “remains” BEFORE pricing).
  max_tokens 3000 → 4000.
- `quote.html`: three new customer-facing blocks — **Supplied By You**, **Not Included
  In This Price**, **Options To Choose From**. `?sow=1` hides priced options, keeps the
  two scope blocks.

### Aug 6 2026 — wizard fixes

- `estimate.html`: cascade-collision colour fix (§4).
- New final step `data-step="supplies"` + `SUPPLY_CATALOG` + review row + payload field.
- `estimate-request.js`: saves `customerSupplies`, gold highlight row in Zura’s email,
  blank v3 fields in the estimate shell.
- `estimate-ai-question.js`: prompt-level bans → **ignored by the model** → replaced
  with hard code gates: question cap enforced before the API call, banned-topic regex
  on the response (label + questionId + options), bans moved to the top of the prompt.
  Budget cut to 1+svcN capped at 3.
- Added paint-finish/sheen to the ban list.
- Added `SUPPLY_FROM_DESCRIPTION` keyword rules (windows etc.).
- Added **one-question-per-trade-topic** enforcement via `askedLabels`.
- Banned installation/labour-needed questions (new failure mode caused by the supplies
  grid — see Decisions).
- **Trade header on every question** (Zura’s request). The function returns `topic` +
  `topicLabel` with each question; the form shows it in the eyebrow and progress label,
  so a multi-service customer sees BATHROOM / PAINTING / WINDOWS above the question
  instead of a generic “Project Details”. Reuses `TOPIC_PATTERNS` so there is ONE
  definition of what counts as a trade (also used by the duplicate blocker).
  Fallbacks: a generic question (size, access, damage) on a SINGLE-service request
  shows that service; on a multi-service request it shows “Project Details”.
- **Answers are now filed by trade.** `answerTopics` (questionId -> trade) is recorded in
  the form, saved by `estimate-request.js` into `request.answerTopics`, and
  `generate-estimate.js` groups the answers by trade in the prompt, telling the model to
  reuse those trade names as the `section` on the matching lines. This closes the loop:
  intake trade -> answer -> line `section` -> per-service subtotal on the quote.

### Aug 8 2026 — dashboard security, one-card-per-service, grouping fixed

**Security (closed).** The dashboard password was a `const` in the client JS of six
public pages. It is now server-side only.

- New `js/dashboard-auth.js` — shared browser helper. `sbcIsAuthed`, `sbcVisitsKey`,
  `sbcLogout`, `sbcVerifyPassword`. Everything is a `var` or a function declaration so
  it hoists past Law 4. **The password must never be added to this file.**
- New `netlify/functions/dashboard-login.js` — checks `DASHBOARD_PASSWORD` with
  `crypto.timingSafeEqual`, hands back `VISITS_KEY` on success.
- `dashboard.html`, `bid-analyzer.html`, `page-editor.html`, `seo-content.html`,
  `keyword-volumes.html`, `image-studio.html` all load the helper; zero occurrences of
  the old literal remain.
- **Path trap, cost about an hour:** the two new files were first committed as
  `netlify/functions/dashboardauth.js` and `dashboardlogin.js` (hyphens dropped by the
  GitHub upload flow), then as `netlify/functions/js/dashboard-auth.js`. The browser
  helper belongs at **`js/dashboard-auth.js`**, the function at
  **`netlify/functions/dashboard-login.js`**. Symptom of getting it wrong: the UNLOCK
  button sticks on "CHECKING…" forever, because `sbcVerifyPassword` is undefined and
  `tryLogin()` throws before its `.then()` can reset the button. `_redirects` ends with
  `/* /404.html 404`, so a missing script returns an HTML page rather than a 404 the
  console makes obvious.
- `sw.js` v6: dashboard URLs and `/js/dashboard-auth.js` are matched by **pathname
  only** and never cached. v5 required an `accept: text/html` header, but
  `dashboard-shell.html` fetches `/dashboard.html?core=4` with `accept: */*`, so that
  request fell into the cache-first branch and the installed home-screen app served a
  frozen dashboard while a normal browser tab loaded the new one.

**The grouping bug — root cause found.** `syncLines()` rebuilt `estimate.labor` and
`estimate.materials` from the DOM, which carries only item / qty / unit / rate. Every
other field was destroyed on each Save Draft and each `recalc()` — above all `section`.
With no `section`, `quote.html` fell back to keyword guessing, General redistribution
and scaling to the grand total, so the dashboard showed five service cards and the
customer's quote showed two, for the same money. `syncLines()` now carries the previous
object across by `data-idx` and overwrites only the four fields the form owns. It also
returns early when the table body is empty but the array is not — rebuilding from an
unpainted table would delete every priced line in the record.

**The contractor's grouping is now the customer's grouping.**

- `scopeCleanCopy()` writes `subtotal` on every published service.
- `quote.html` `pubList()` + `finalizeServices()`: when the published scope carries
  numeric subtotals they are the ONLY truth — same card names, same order, same prices,
  no keyword guessing, no redistribution, no rescaling. Estimates published before this
  change carry no subtotals and fall through to the old
  `foldZeroPriceServices(pubScope(...))` path untouched.
- The cards are reconciled to the headline total: if the contractor removed a priced
  service, the difference is parked on the largest card so the customer never reads a
  sum that disagrees with their own total.

**One card per service (dashboard).** `renderScopeControl()` rewritten. Each service is
one card with four tabs — Prices / Included / Supplies / Not incl. — holding its own
labor and materials lines alongside its wording. The top Labor and Materials tables are
kept but collapsed into `<details class="lm-fold">`; delete them only once the cards
have proven themselves. New: `SC_TAB`, `scopeSetTab`, `scopeLinesFor`, `scopePriceEdit`,
`scopePriceDelete`, `scopePriceAdd`, `scopeLinesRefresh`, `scopeCardsRepaint`.

**`scopeMergeService()` — move a whole service into another.** Relabels `section` on
every matching line so the price travels with the wording, merges the three wording
arrays with topic dedupe, drops the source card. On `v8.2-deterministic-four-service`
records it also folds the source `serviceBreakdown` row into the destination and removes
it, because `scopeServiceSubtotal()` reads `serviceBreakdown` first on those records —
relabelling the lines alone left the destination showing its old figure.

**Caught by the Claude Code audit, not by us — read this before touching the cards.**
Each card handler bakes a *global* index into `estimate.labor` / `estimate.materials`.
`addLine()` and `deleteLine()` mutate those arrays, and `recalc()` does **not** re-render
the panel, so after one delete in the top table an edit inside a card silently rewrote a
line belonging to a **different service**. Both now call `scopeCardsRepaint()`.
**Never move that call into `recalc()`** — `attachLineListeners()` fires `recalc` on
every `input` event, and re-rendering mid-keystroke steals focus.

**Known, pre-existing, not fixed:** `foldZeroPriceServices` drops a service whose
subtotal is *negative* (a credit line). The customer's total stays correct; the credit
just stops being visible as its own card. Requires a negative rate to reach — the inputs
carry `min="0"`, which browsers do not enforce against paste. Fix if ever needed:
`s.subtotal !== 0` in place of `s.subtotal > 0` in `quote.html`.


### Aug 8 2026 (later) — parked price lines, and the card visual pass

**"Not included" now moves money, reversibly.** Moving a wording item into Not
included removes the matching price line from the estimate; moving it back restores
the identical line — same qty, rate, unit and every AI-written field, because the
line object itself is stored, not a copy.

Lines are **parked**, never deleted: `estimate.parkedLines[] = { kind, ownerText,
service, idx, line }`. `parkedLines` is field 16 of
`CONTRACTOR_OWNED_ESTIMATE_FIELDS`, so Save Draft and Regenerate cannot drop it, and
`scopeCleanCopy` omits it so it never reaches the customer.

Matching wording to a price line is fuzzy by nature — "Complete bathroom demolition
including tub/shower removal" vs a line called "Complete bathroom demo".
`scopeMatchScore` is stem-aware (a word counts when one is a prefix of the other and
at least 4 chars, so demolition≈demo, flooring≈floor), needs two real words in common,
and needs half the price line covered. One match acts silently with a toast. **More
than one match asks**, listing every line and its price — a service card is full of
siblings ("remove existing vanity" / "remove existing toilet", "wall tile" / "floor
tile") and no scoring rule can know which the exclusion meant. Cancelling leaves the
wording *and* the prices untouched: the park runs BEFORE the wording moves, because
the other order left an item reading "Not included" while the estimate still charged
for it — the exact conflict `EXCLUSION_CONFLICT_REMOVED` catches on the AI pass, which
never sees a manual dashboard edit.

**THE ONE LESSON, learned six times in a row.** A parked line is found by its owning
wording plus its owning service. *Every* path that changes either must retarget the
parked entry, or the money becomes unreachable — no line in the estimate, no wording on
screen, no card, nothing to explain the shortfall. All six were found by the Claude Code
audit, not by us, and each was the same bug wearing different clothes:

1. Editing the exclusion text → `scopeEditItem` retargets `ownerText`
2. Two services with identical wording ("Final clean up") → unpark keys on
   `ownerText` AND `service`; restoring on text alone pulled another service's line
   into the wrong card
3. Deleting the service card → `scopeDeleteService` unparks first, and its confirm no
   longer claims "Pricing is not affected"
4. Renaming a service → `scopeRenameService` retargets `service`
5. Merging a service → `scopeMergeService` retargets to the destination. **Note the
   trap:** merge worked before fix 2 only *because* unpark ignored the service. Adding
   the service check without this would have converted a working path into a new bug
6. **Rebuild Draft from AI** and `scopeDraft()`'s silent rebuild of a missing/malformed
   draft → `scopeUnparkAll()` first. The silent path has no prompt, so it errs toward
   giving money back
7. **Blanking** the exclusion text rather than deleting it → `scopeCleanCopy` strips
   empty wording on both Save Draft and Publish, so `""` is a delete in everything but
   name; `scopeEditItem` unparks instead of retargeting

**Rule for anyone adding to this:** before touching a function that renames, replaces,
merges or removes scope wording or a service, ask what happens to a parked line owned
by it. Restoring is always recoverable. Stranding never is.

**Known, not fixed:** typing an exclusion directly with **+ Add** under Not included
parks nothing — only moving an item in from Included or Customer supplies does. A
hand-typed "Shower glass not included" can therefore sit beside a live charge for
shower glass.

**Visual pass on the service cards.** Navy header per card, white service name, gold
subtotal at 17px, full-width tab strip with a gold active underline, rounder corners
and a soft shadow. Move-into and Remove sit on one row. Zura asked explicitly for the
colours only — **no font change**; the dashboard stays on Bebas Neue + Inter and
Playfair must not be reintroduced here. The stale "Bathroom / Windows / Painting /
Flooring — grouped automatically from line names" helper text under Customer View Mode
was replaced, since grouping is no longer automatic.


### Aug 8 2026 (later still) — merging a service is now reversible

**Merging is destructive.** It relabels `section` on the source's price lines to the
destination's name, so afterwards nothing in the record remembers which lines used to be
Flooring. `scopeMergeService` therefore snapshots to `estimate.lastMerge` BEFORE touching
anything: the source card, its index, the destination's three wording arrays, the
destination's **whole** `serviceBreakdown` row, the source `serviceBreakdown` row and its
index. Each moved line is stamped `l.sbcPrevSection`; each parked entry the source owned
is stamped `p.sbcPrevService`. `scopeUndoMerge()` reverses all of it and a gold
**↩ Undo merge of X** button renders in `sc-actions` while `lastMerge` is set.
`lastMerge` is field 17 of `CONTRACTOR_OWNED_ESTIMATE_FIELDS`.

**Only the most recent merge is reversible.** Merge twice and the first one's lines can no
longer be told apart. This is a deliberate limit, not an oversight — see the stamp rule.

**Restore the whole breakdown row, not just its subtotal.** The merge also appends the
source's `included` / `customerSupplies` / `notIncluded` / `options` to the destination
row. Restoring the number alone left that wording duplicated on the destination. Both
rows also go back at their original index so the list does not reshuffle.

**Four defects found by the Claude Code audit — all the same shape as before.**

1. **Duplicate card → a price the customer is shown that does not exist.**
   `scopeServiceSubtotal` groups by NAME. If the contractor had recreated "Flooring" by
   hand, undo produced two cards of that name, both reporting the same lines, and
   `scopeCleanCopy` published both. The customer's price-by-service list then showed
   $200 that isn't real while the headline total stayed correct. Undo now **refuses**
   when a card of that name exists (case- and whitespace-insensitive via `scopeNorm`),
   and the check runs before the confirm and before any mutation, so refusing leaves the
   record byte-identical and `lastMerge` intact — remove the clashing card and retry.

2. **Undo stole the destination's own parked money.** The snapshot recorded parked
   entries by `ownerText` only. If the destination had its own parked line worded the
   same ("Final clean up" is on nearly every service), both matched and both went to the
   source. This is the SAME collision already fixed in `scopeUnparkFor`, reintroduced in
   its mirror. Fixed by stamping identity (`sbcPrevService`), not text.

3. **Stale stamps from an un-undone merge were swept up by a later undo**, dragging lines
   back into a service the contractor had deliberately merged away. Fixed by clearing
   **every** stamp at the START of `scopeMergeService`, and unconditionally at the end of
   the undo. That makes "a stamp exists" mean "belongs to the one pending merge" — the
   only invariant that actually holds.

4. **`lastMerge` was never cleared.** Rebuild Draft from AI, then press the still-visible
   undo: the AI's fresh wording was replaced by the pre-merge snapshot and a discarded
   card came back. Now nulled by `scopeRebuildFromAI`, by `scopeDraft`'s silent rebuild,
   and by `scopeDeleteService` when either named card is removed.

**The generalised rule, now proven twice over:** anything that makes a change reversible
has to record IDENTITY, never wording, and every path that renames, replaces, merges or
removes the thing being remembered must retarget or discard the snapshot. Wording repeats
across services; names get retyped; drafts get rebuilt. See also the parked-lines entry
above — items 1-7 there are the same lesson in a different costume.

**Note:** `scopeUndoMerge` is the first thing in the scope-control code to call `alert()`.
Blocking, and invisible to anything driving the page headlessly.


### Aug 8 2026 (final round) — every merge undoable, and editable card totals

**Undo is a stack, not a single slot.** `estimate.lastMerge` became
`estimate.mergeHistory[]`, each entry with a unique `id`; one **↩ Undo merge of X**
button renders per pending merge, newest first. `mergeHistory` is in
`CONTRACTOR_OWNED_ESTIMATE_FIELDS`. `scopeMergeStack()` migrates older records that
still carry `lastMerge`.

Two design errors had to be corrected to get there, both mine, both found by testing
rather than by reading:

- **Merges into the same destination blocked each other.** The first version restored
  the destination's wording from a "before" copy, which wiped whatever the other merges
  had added. Merging Flooring, Painting AND Carpentry into Bathroom is the ordinary
  case, not an exotic one. Merges now record `addedToDst` (the wording actually
  appended, after dedupe) and `addedSubtotal` / `addedRowArrays`, and undo **subtracts
  its own delta** instead of restoring a snapshot.
- **A line moved twice could only remember one merge.** Flooring→Bathroom then
  Bathroom→Painting: the second merge overwrote the first one's stamp. Lines and parked
  entries now carry a CHAIN, `sbcMergeIds[]`, and undo pops the last id.

`scopeUndoBlockedBy` blocks an undo only when a later merge **consumed this merge's
destination** — that is the one true conflict, because the card the lines must go back
into no longer exists. Anything else is independent.

Restored cards land at `Math.min(srcIndex, dstIndex)`. Undo in the order offered and the
original card order is restored exactly; undo out of order and a card lands beside the
one it came out of. Cosmetic only — money, wording and subtotals are exact either way.

**Each card's subtotal is an editable field.** `scopeSetServiceTotal(si, raw)` scales
every labor and materials line in that service by `targetRaw / base`, where `targetRaw`
is the typed figure divided by the markup multiplier. The grand total follows because it
is still the sum of the lines — never a number typed over the top. Other cards are
untouched, parked lines are never scaled (excluded work is not in the estimate), and a
card with no priced lines is refused with a message rather than silently ignored.

**Input parsing is where this feature bites.** Every one of these was a real defect:

- `Number("")` is `0`, so `"abc"` scaled the card to zero and wiped its prices
- `"1e9"` survived the digit-strip as `"19"` and quietly set the card to nineteen dollars
  — the guard tests the ORIGINAL string for letters, not the stripped one
- `"0.001"` rounded every rate to `0.00` and removed the service from the estimate; the
  floor is one cent
- a minus sign is rejected outright rather than stripped, because charging a positive
  number for something typed as negative is a silent misread

**Rounding drift.** Rounding each rate to the cent leaves a few cents over. A line with
qty 14 can only move the total in 14c steps, so the remainder is absorbed on ONE line —
a qty-1 line where one exists (a whole cent of rate is a whole cent of total), otherwise
four decimals on the largest. Verified across 12 consecutive set-total cycles on awkward
quantities with zero accumulated drift.

**The interaction that mattered.** On a v8.2 record, setting the total of a card that
holds a pending merge re-based `serviceBreakdown` without re-basing the delta that undo
would later subtract. Rows and lines then disagreed per service — published A=150/B=550
while the lines said A=300/B=400 — **and the customer quote reads the rows, not the
lines**. `scopeSetServiceTotal` now scales every pending contribution into that card by
the same factor the row moved by, including the legacy `dstRowBefore` / `srcRow`
snapshot fields that the older undo branch still reads.

**Copy correction:** the undo dialog used to promise the source returns "exactly as they
were". Once totals became editable that stopped being true — re-price a combined card and
both halves carry the change, so the source comes back at its scaled figure. The money is
conserved and the behaviour is right; the sentence now says so.


-----

## 7. OPEN / NOT YET BUILT

**PENDING — dashboard.html (step 3 of the v3 build).** The estimator now *writes*
`customerSupplied`, `exclusions`, `options` and `section`, and the quote page *shows*
them — but Zura cannot yet EDIT them before sending. This is the missing link.
Needs: add/remove supplied items, edit exclusions, manage options, set the section on
each line. Note the −2 baseline div balance.

**PENDING — house rules box.** `generate-estimate.js` already accepts a `houseRules`
string and injects it above the generic NYC pricing guidelines. No UI yet. The point:
Zura’s real rates and standard exclusions live in an editable dashboard box, not in a
.js file, so updating them never needs a commit. **This is the answer to “how do I stop
upgrading it every time.”**

**PENDING — scope version 2 / re-generate against a new document.** Scope arrives in
stages: a rough form first, then a precise document. Right now a stage-two scope means
rebuilding line items by hand. Needs: paste/upload the updated scope, regenerate with
the new document authoritative over the original form, Zura’s edits preserved.

**PENDING — document upload at intake.** John Maxwell’s PDF had measurements no form
field would ever capture. Feed the document to the AI whole instead of flattening it
into a paragraph. Highest-value single change identified.

**PENDING — step abandonment tracking.** The form only records on submit, so anyone who
quits at question 3 is invisible. A tiny event per step turns “which question loses
people” from opinion into fact. Cheap.

**CONSIDER — add “Windows” as a real service.** No windows button exists, yet window
replacement is clearly work Sani sells. Would give a proper supplies entry, its own
estimate section, and a page to rank. **Check Semrush volume before building anything.**

**CONSIDER — a third “not sure yet” state on supplies.** Real customers haven’t decided
at form time; right now that ambiguity becomes a wrong assumption in the price.

**KNOWN COSMETIC:** the review screen’s DETAILS row concatenates all `serviceAnswers`,
so junk from old runs can look odd. Self-clears as bad questions stop being asked.

-----

## 8. REGRESSION CHECKLIST (run before every estimate-system delivery)

> **Syntax checking is NOT verification.** Execute the changed code path in a Node
> harness with a stubbed DOM before shipping. Two production breakages passed
> `node --check` and failed instantly in the browser.

Added Aug 8 2026:

- [ ] `syncLines()` still preserves `section` and every other non-DOM field.
- [ ] Delete a row from the top Labor table, then edit a price inside a service card —
      the edit must land on the line you clicked, in the right service.
- [ ] Move a whole service into another: grand total identical before and after.
- [ ] Publish, then open the customer link — same card names, order and prices as the
      dashboard. No `$0.00` card.
- [ ] An estimate published before Aug 8 2026 still renders the old way.
- [ ] `grep -c L0nd0n12` on all six admin pages returns 0.
- [ ] Exclude a wording item, then un-exclude it: the estimate total returns to the
      exact figure it started at and `parkedLines` is empty.
- [ ] With money parked, try each of: edit the wording, blank the wording, delete the
      wording, rename the service, merge the service, delete the service, Rebuild Draft
      from AI. In every case the money is either still reachable or already returned.
- [ ] Exclude something that matches two sibling lines: the prompt lists both with
      prices, and Cancel leaves the wording where it was.
- [ ] Merge a service, then Undo: `labor`, `materials`, `manualCustomerScopeDraft` and
      `serviceBreakdown` must be byte-identical to before the merge.
- [ ] Merge, recreate the source card by hand, press Undo: it must REFUSE, and the
      record must be untouched.
- [ ] Merge twice, undo once: the first merge's lines stay merged, no stamps remain.
- [ ] Rebuild Draft from AI with an undo pending: the undo button disappears and the
      AI wording survives.
- [ ] Merge three services into one card, then undo them in a different order than they
      were made: every subtotal is exact and the grand total is unchanged.
- [ ] Chain a merge (A into B, then B into C) and try to undo the first: it must refuse
      and name what to undo first.
- [ ] Type a card total. The lines scale, the grand total follows, other cards do not
      move, and parked lines are untouched.
- [ ] Type junk into a card total: `abc`, `1e9`, `0.001`, `-500`. Every one leaves the
      card exactly as it was.
- [ ] On a v8.2 record: merge, set the merged card's total, undo. Each card's
      `serviceBreakdown` row must equal its own lines, and the rows must sum to the
      headline total.

1. `node --check` on every `.js` file and every inline `<script>` block.
1. Div balance: 0 for `estimate.html` / `quote.html`; **−2 baseline** for `dashboard.html`.
1. `json.loads` on the JSON shape embedded in the `generate-estimate.js` prompt.
1. Zero occurrences of “licensed” (except the rule text that forbids it).
1. Ban filter: assert every known-bad question BLOCKS **and** every known-good question
   is KEPT. False positives that kill good questions are as bad as leaks.
1. Duplicate-topic: replay a two-flooring-question sequence, assert the second blocks.
1. Old-estimate compatibility: a record with no `section` / `customerSupplied` /
   `exclusions` / `options` must render exactly as it did before.
1. Supplies catalogue: simulate a real multi-service selection, check the list, the
   10-item cap, and that description keywords add the right extras.
1. Partials intact (header/footer never reinvented).

-----

## 9. TROUBLESHOOTING MAP — “X is broken, look here”

|Symptom                                 |Look at                                                                                                                |
|----------------------------------------|-----------------------------------------------------------------------------------------------------------------------|
|Wizard text dark / unreadable           |§4 cascade collision — the override block in `estimate.html`                                                           |
|A stupid question appears               |`BANNED_PATTERNS` in `estimate-ai-question.js` — add the pattern, test both ways                                       |
|Same question asked twice               |`TOPIC_PATTERNS` / `askedLabels` wiring                                                                                |
|Too many questions                      |`maxQs` + the hard stop before the API call                                                                            |
|Supplied item still priced              |`request.customerSupplies` → the `suppliedBlock` in `generate-estimate.js`                                             |
|Supply item missing from the grid       |`SUPPLY_CATALOG` (by service) + `SUPPLY_FROM_DESCRIPTION` (by keyword)                                                 |
|Sections wrong on the quote             |`section` on the lines, then `sectionOf()` in `quote.html`                                                             |
|Wrong/missing trade header on a question|`TOPIC_PATTERNS` + `TOPIC_LABELS` in `estimate-ai-question.js`                                                         |
|Price far too high                      |Sizing rules in the `generate-estimate.js` prompt; check the smallest-reasonable-interpretation rule and `extraRequest`|
|Quote shows nothing new after a commit  |**Cloudflare → Caching → Purge Everything**                                                                            |
|UNLOCK button stuck on “CHECKING…”       |`/js/dashboard-auth.js` is missing or at the wrong path — `_redirects` returns the 404 HTML page, the script never defines `sbcVerifyPassword`|
|Dashboard works in a browser, not in the home-screen app|Stale service-worker cache — commit `sw.js` v6, purge Cloudflare, delete and re-add the home-screen icon|
|Dashboard shows 5 service cards, customer sees 2|`section` was stripped off the price lines by `syncLines()`; re-Publish after the Aug 8 fix|
|Edit in one service card changed a line in another|Stale global index — `addLine`/`deleteLine` must call `scopeCardsRepaint()`|
|Estimate total dropped and nothing explains it|A price line is parked by a “Not included” wording item — check `estimate.parkedLines`; un-exclude or delete that wording to get it back|
|Money parked but no wording anywhere on screen |Its owner was renamed, merged, blanked or rebuilt without retargeting — see the Aug 8 log entry, rule at the end|
|Excluding one item removed a neighbour's price too|`scopeMatchScore` matched siblings; the multi-match prompt should have asked — Cancel and delete the price line by hand instead|
|Two cards with the same name, prices doubled|Undo merge created a duplicate — `scopeServiceSubtotal` groups by name, so both report the same lines. Should be refused; if seen, delete one card|
|Undo merge button will not work           |A card of that name already exists — rename or remove it, then undo|
|Undo merge button vanished                |`lastMerge` was cleared by Rebuild Draft from AI, a silent draft rebuild, or deleting either card. Merges before that are not reversible|
|Lines returned to a service you had merged away|Stale `sbcPrevSection` stamp from an earlier un-undone merge — fixed Aug 8; only one merge is ever reversible|
|A card total will not accept what I type   |Junk guard — letters, a minus sign, or under one cent are all rejected; `1e9` and `0.001` are typos, not figures|
|Card totals and the customer quote disagree|On v8.2 records the quote reads `serviceBreakdown`, not the lines. Setting a total must re-base any pending merge delta into that card — fixed Aug 8|
|Undo merge says one thing, prices say another|Re-pricing a combined card moves both halves; undo splits by line, it does not rewind. Total is conserved|
|Confirmation email never arrives        |Netlify `submission-created` trigger silently never fires on this site — use the direct client-to-function pattern     |

-----

## 10. LIVE CASE — John Maxwell (Astoria/LIC, ref SBC-260803-N827)

Kept because it drove the whole v3 design and is not finished.

Submitted Aug 3 via the form; **then** sent a written scope PDF with different numbers.
The form-based draft came to **$42,054.38** and is now stale.

Form → PDF changes: shower pan **remains** (no tub-to-shower conversion, no new pan) ·
bathroom smaller, tile ≈87 SF · flooring 800 → **640 SF**, bathroom excluded · painting
≈2,600 SF, **kitchen excluded**, **owner supplies paint** · windows 6 → **8** in four
sizes · owner also supplies vanity, sink, faucet, toilet, shower rough-in, trim, head,
flooring.

He asked for **four separate prices** (bathroom w/ glass, flooring, painting, windows)
and **two window options** (A: replace all · B: two acoustic laminated masters + repair
balances/springs on the rest). He explicitly declined underlayment, baseboards and
transition strips, and wants ¼ round where needed plus acceptance of flooring delivery.

**Recommended addition:** contingency line — if the existing pan/drain fails inspection,
replacement quoted separately. That’s the one thing on the job nobody can see yet.

Deadline was **Fri Aug 7 2026**. Status when this log was written: not yet sent —
blocked on the dashboard editor, or to be typed manually.
