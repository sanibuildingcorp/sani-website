# ESTIMATE-LOG.md
**Source of truth for the Sani Building Corp AI estimate system.**
Companion to `SEO-LOG.md` (pages) and `GBP-STATE.md` (Google Business Profile).

> **READ THIS FIRST, EVERY CHAT, BEFORE TOUCHING ANY ESTIMATE FILE.**
> Fetch: `https://raw.githubusercontent.com/sanibuildingcorp/sani-website/main/ESTIMATE-LOG.md`
> Then fetch the specific file being changed from `raw.githubusercontent.com/.../main/<file>`.
> Never build on a stale copy. Never re-litigate a decision already recorded in
> **Section 4 — Decisions & Why**; if a decision needs reversing, add a new dated row
> to Section 6 explaining what changed, don't silently flip it.

Last updated: **Aug 6 2026**

---

## 1. WHAT THE SYSTEM IS

A customer fills a 5-step wizard on the website. The request lands in Netlify Blobs
and in Zura's inbox. In the dashboard, Zura clicks **Generate with AI**, which drafts a
scope + line items. Zura edits, chooses what the customer sees, and sends. The customer
opens a quote page and approves, declines, or requests changes.

**The core design constraint:** Zura is a non-developer working only through the GitHub
web UI. Every deliverable is a complete, ready-to-commit file. Never a patch or diff.

---

## 2. FILE MAP — WHAT TOUCHES WHAT

| File | Role | Notes |
|---|---|---|
| `estimate.html` | The 5-step customer wizard | Step order is NOT 1-2-3-4-5 in the markup; see §3 |
| `netlify/functions/estimate-ai-question.js` | Generates ONE follow-up question at a time | Hard-enforced limits live here, not in the prompt |
| `netlify/functions/estimate-request.js` | Saves the request to Blobs + emails Zura | Builds the empty `estimate` shell |
| `netlify/functions/generate-estimate.js` | Calls Claude to draft scope + pricing | The pricing brain |
| `dashboard.html` | Zura edits + sends (≈350KB, 7,700 lines) | Div balance is **−2 at baseline** (JS string literal, not a real imbalance) |
| `quote.html` | What the customer sees | Also serves the no-prices scope-of-work view via `?sow=1` |
| `netlify/functions/send-quote.js` | Emails the quote link | |
| `netlify/functions/quote-response.js` | Handles approve / decline / change request | |
| `partials/site.css` | Shared site styles | **Loads AFTER the wizard's inline `<style>` — see §4 "cascade collision"** |

**Storage:** Netlify Blobs, store name `estimates`, keyed by ref (`SBC-YYMMDD-XXXX`).
Handyman bookings are separate (Supabase). Don't confuse the two.

---

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
including the "Skip these — send my request" link and the catch/fallback path. The
supplies question is the one question worth asking even when someone is bailing out.

---

## 4. DECISIONS & WHY (do not silently reverse)

**Question budget: 1 service → 2 questions, 2+ → 3, hard cap 3.**
Plus the supplies step. People quit long forms; a lead that never arrives is worth zero,
while a slightly-off estimate still gets a phone call. Precision comes from the
conversation, not the form.

**The test for any question: does the answer move the price by REAL money, and is
there no other way to get it?** If not, don't ask. Three tiers: *ask* (supplies, counts,
rough size, condition) · *assume* (sane default + confirm on site) · *ask later on the
phone* (tile grade, colours, scheduling).

**Banned question topics — enforced in CODE, not just the prompt.**
Prompt-only bans were tried first (Aug 5) and the model ignored them: it asked 5
questions when the cap was 4, and 4 of them were "who supplies X". Prompt rules are a
suggestion; regex on the response is a guarantee.
- who supplies / are you supplying → the supplies grid owns this
- quality / grade / tier / budget / mid-range / high-end / premium / luxury → everyone
  says high-end; it tells us nothing. Assume mid-range, Zura adjusts.
- brand, colour
- paint finish / sheen (matte, eggshell, satin, semi-gloss) → **same cost to buy, same
  cost to apply.** Zura's words: *"Stupid question! Does not matter for price out."*

**NOT banned — these move the price by real money, keep them:**
window material (vinyl vs fibreglass vs aluminium), what's currently on the floor
(drives removal + disposal labour), size, quantity, condition, access, occupancy.

**One question per trade topic, per session.** Aug 6: the AI asked "What type of
flooring is currently installed?" and "What's currently on the floors being replaced?"
in the same run — same question, reworded, two slots burned, and two *contradictory*
answers ("Other/mixed" and "Hardwood or laminate"). Two answers about one thing is
worse than no answer, because Zura can't tell which is true. The form now sends
`askedLabels`; the server derives covered trades and refuses repeats.
Generic questions (size, access, occupancy, deadline) are deliberately NOT topics, so
they can still be asked alongside a trade question.

**Supplies grid is a FIXED catalogue, not AI-generated.** The strings flow straight into
the estimate, so they must be byte-identical every time — "wall tile" one day and
"porcelain tile" the next would break grouping. The AI picks nothing here. Zura can
edit `SUPPLY_CATALOG` himself without a rebuild.
- Main products only. Never trade supplies (thinset, grout, tape, adhesive, fasteners) —
  those are always Sani's. Nobody wants to be asked about screws.
- Nothing pre-selected: the common case is zero taps.
- Subtitle MUST say installation is included either way, or people won't tick anything
  for fear of losing the labour.
- Hard cap 10 items. A long list is a list nobody reads.
- `SUPPLY_FROM_DESCRIPTION` adds items with no service button of their own (windows,
  doors, cabinets, appliances, light fixtures, radiator covers) by reading what the
  customer wrote. **There is no "Windows" service button** — that gap is why windows
  were missing from the grid on John Maxwell's job.

**Ticking an item removes the MATERIAL, keeps the LABOUR.** Always. And the supplied
item is never priced/guessed — it appears at $0 labelled "supplied by owner". Guessing
a value for tile the customer chose swings thousands and helps nobody.

**Photo analysis is OFF for pricing by default.** `usePhotoAnalysis` defaults false so
photos can't inflate a price. Analysis is still saved and shown to Zura.

**Contractor notes override everything.** `extraRequest` in the dashboard is
authoritative and can resize the job. A contractor measurement always beats a vague
customer description.

**Cascade collision (fixed Aug 6, don't undo):** `partials/site.css` loads AFTER the
wizard's inline `<style>` and sets `body{color:var(--black)}` = #0e0e0e, plus it
re-declares `--gray`, `--border`, `--navy`, `--gold` in its own `:root`. Result: every
`h2.title` question heading rendered near-black on navy (only `h1.title` had its own
colour rule). Fix = an override `<style>` block placed AFTER the site.css link, scoped
to `.topbar` and `.wrap` only, so the shared menu/footer partials are untouched.
**If wizard text ever goes dark again, this is the cause.**

**LICENSE RULE:** never "licensed" anywhere — copy, schema, contracts, function output.
Always "fully insured". Enforced in the `generate-estimate.js` prompt as a top-level rule.

**TV RULE:** no TV-mounting service, never mention TV anywhere.

---

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
That worked for John Maxwell's job by luck and would silently mislabel anything else.
`sectionOf(name, line)` now reads `line.section` first and only falls back to keywords
for pre-v3 estimates. **Backwards compatibility is deliberate — old estimates in Blobs
must keep rendering exactly as before.**

Section ordering on the quote: known trades first (Bathroom, Kitchen, Flooring,
Painting, Carpentry, Windows), then any custom section, with **"General" always last**.

---

## 6. CHANGE LOG

### Aug 5 2026 — v3 data model
- `generate-estimate.js` rewritten: added `section` on every line, `customerSupplied[]`,
  `exclusions[]`, `options[]`, `houseRules` passthrough, reads
  `request.customerSupplies`. Added the **negative-instruction scan** (hunt for
  "I'm providing", "no ___", "excluded", "except", "remains" BEFORE pricing).
  max_tokens 3000 → 4000.
- `quote.html`: three new customer-facing blocks — **Supplied By You**, **Not Included
  In This Price**, **Options To Choose From**. `?sow=1` hides priced options, keeps the
  two scope blocks.

### Aug 6 2026 — wizard fixes
- `estimate.html`: cascade-collision colour fix (§4).
- New final step `data-step="supplies"` + `SUPPLY_CATALOG` + review row + payload field.
- `estimate-request.js`: saves `customerSupplies`, gold highlight row in Zura's email,
  blank v3 fields in the estimate shell.
- `estimate-ai-question.js`: prompt-level bans → **ignored by the model** → replaced
  with hard code gates: question cap enforced before the API call, banned-topic regex
  on the response (label + questionId + options), bans moved to the top of the prompt.
  Budget cut to 1+svcN capped at 3.
- Added paint-finish/sheen to the ban list.
- Added `SUPPLY_FROM_DESCRIPTION` keyword rules (windows etc.).
- Added **one-question-per-trade-topic** enforcement via `askedLabels`.
- **Trade header on every question** (Zura's request). The function returns `topic` +
  `topicLabel` with each question; the form shows it in the eyebrow and progress label,
  so a multi-service customer sees BATHROOM / PAINTING / WINDOWS above the question
  instead of a generic "Project Details". Reuses `TOPIC_PATTERNS` so there is ONE
  definition of what counts as a trade (also used by the duplicate blocker).
  Fallbacks: a generic question (size, access, damage) on a SINGLE-service request
  shows that service; on a multi-service request it shows "Project Details".
- **Answers are now filed by trade.** `answerTopics` (questionId -> trade) is recorded in
  the form, saved by `estimate-request.js` into `request.answerTopics`, and
  `generate-estimate.js` groups the answers by trade in the prompt, telling the model to
  reuse those trade names as the `section` on the matching lines. This closes the loop:
  intake trade -> answer -> line `section` -> per-service subtotal on the quote.

---

## 7. OPEN / NOT YET BUILT

**PENDING — dashboard.html (step 3 of the v3 build).** The estimator now *writes*
`customerSupplied`, `exclusions`, `options` and `section`, and the quote page *shows*
them — but Zura cannot yet EDIT them before sending. This is the missing link.
Needs: add/remove supplied items, edit exclusions, manage options, set the section on
each line. Note the −2 baseline div balance.

**PENDING — house rules box.** `generate-estimate.js` already accepts a `houseRules`
string and injects it above the generic NYC pricing guidelines. No UI yet. The point:
Zura's real rates and standard exclusions live in an editable dashboard box, not in a
.js file, so updating them never needs a commit. **This is the answer to "how do I stop
upgrading it every time."**

**PENDING — scope version 2 / re-generate against a new document.** Scope arrives in
stages: a rough form first, then a precise document. Right now a stage-two scope means
rebuilding line items by hand. Needs: paste/upload the updated scope, regenerate with
the new document authoritative over the original form, Zura's edits preserved.

**PENDING — document upload at intake.** John Maxwell's PDF had measurements no form
field would ever capture. Feed the document to the AI whole instead of flattening it
into a paragraph. Highest-value single change identified.

**PENDING — step abandonment tracking.** The form only records on submit, so anyone who
quits at question 3 is invisible. A tiny event per step turns "which question loses
people" from opinion into fact. Cheap.

**CONSIDER — add "Windows" as a real service.** No windows button exists, yet window
replacement is clearly work Sani sells. Would give a proper supplies entry, its own
estimate section, and a page to rank. **Check Semrush volume before building anything.**

**CONSIDER — a third "not sure yet" state on supplies.** Real customers haven't decided
at form time; right now that ambiguity becomes a wrong assumption in the price.

**KNOWN COSMETIC:** the review screen's DETAILS row concatenates all `serviceAnswers`,
so junk from old runs can look odd. Self-clears as bad questions stop being asked.

---

## 8. REGRESSION CHECKLIST (run before every estimate-system delivery)

1. `node --check` on every `.js` file and every inline `<script>` block.
2. Div balance: 0 for `estimate.html` / `quote.html`; **−2 baseline** for `dashboard.html`.
3. `json.loads` on the JSON shape embedded in the `generate-estimate.js` prompt.
4. Zero occurrences of "licensed" (except the rule text that forbids it).
5. Ban filter: assert every known-bad question BLOCKS **and** every known-good question
   is KEPT. False positives that kill good questions are as bad as leaks.
6. Duplicate-topic: replay a two-flooring-question sequence, assert the second blocks.
7. Old-estimate compatibility: a record with no `section` / `customerSupplied` /
   `exclusions` / `options` must render exactly as it did before.
8. Supplies catalogue: simulate a real multi-service selection, check the list, the
   10-item cap, and that description keywords add the right extras.
9. Partials intact (header/footer never reinvented).

---

## 9. TROUBLESHOOTING MAP — "X is broken, look here"

| Symptom | Look at |
|---|---|
| Wizard text dark / unreadable | §4 cascade collision — the override block in `estimate.html` |
| A stupid question appears | `BANNED_PATTERNS` in `estimate-ai-question.js` — add the pattern, test both ways |
| Same question asked twice | `TOPIC_PATTERNS` / `askedLabels` wiring |
| Too many questions | `maxQs` + the hard stop before the API call |
| Supplied item still priced | `request.customerSupplies` → the `suppliedBlock` in `generate-estimate.js` |
| Supply item missing from the grid | `SUPPLY_CATALOG` (by service) + `SUPPLY_FROM_DESCRIPTION` (by keyword) |
| Sections wrong on the quote | `section` on the lines, then `sectionOf()` in `quote.html` |
| Wrong/missing trade header on a question | `TOPIC_PATTERNS` + `TOPIC_LABELS` in `estimate-ai-question.js` |
| Price far too high | Sizing rules in the `generate-estimate.js` prompt; check the smallest-reasonable-interpretation rule and `extraRequest` |
| Quote shows nothing new after a commit | **Cloudflare → Caching → Purge Everything** |
| Confirmation email never arrives | Netlify `submission-created` trigger silently never fires on this site — use the direct client-to-function pattern |

---

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
replacement quoted separately. That's the one thing on the job nobody can see yet.

Deadline was **Fri Aug 7 2026**. Status when this log was written: not yet sent —
blocked on the dashboard editor, or to be typed manually.
