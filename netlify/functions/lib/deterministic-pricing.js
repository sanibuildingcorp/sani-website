// Sani Building Corp — deterministic estimator guardrails v2.3
// Pricing polish: cost-based labor + single markup + duplication controls.
// Aug 8, 2026 · v2.1 Aug 10, 2026 · v2.2 Aug 11, 2026 · v2.3 Aug 11, 2026
//
// v2.3 — three things v2.2 left open, all found by executing the file:
//  F. isolateAlternatives WAS NEVER MOVED. v2.2 relocated applyTieredMarkup to just
//     after normalizeLaborRates, which fixed ensureWindowOptionEngine — but
//     isolateAlternatives runs NINE LINES EARLIER and still priced every alternative at
//     the legacy 25%. It also captured the raw cost BEFORE calibration, so an option was
//     wrong twice and the two errors partly cancelled. Both pricing sites now defer:
//     they record rawCost, and one priceAlternatives() pass at the end applies the
//     resolved markup to a calibrated basis.
//  G. Clamp-only calibration left the cost basis MIXED. Any AI rate that happened to
//     land under its ceiling stayed on the payroll basis — "Remove existing bathroom
//     floor tile" classifies as tile, its $52 sits under the $62.40 tile ceiling, and
//     it was never calibrated. Job 2 drifted from +3.4% to +8.8% against its real sale
//     price. Calibration now SCALES again (correct basis) and stays idempotent by
//     STAMPING the line — identity, not arithmetic. Re-running is a no-op because the
//     stamp is already there, not because the maths happens to be stable.
//  H. buildCustomerScope's plain-language scope was overwritten. It wrote outcome
//     sentences, then consolidateCustomerPresentation replaced serviceBreakdown with raw
//     text(l.item). Customers read internal task names. consolidate now asks for the
//     same phrases, and the phrases are service-aware so a Flooring card no longer says
//     "Remove the existing bathroom".
//
// v2.2 — fixes five defects found by executing the engine (Claude Code review, Aug 11):
//  A. Tiered markup had a CLIFF. $4,000 cost quoted $6,700; $4,001 quoted $6,161.54.
//     Adding $1 of cost made a job $538 cheaper, and cost had to reach $4,351 before the
//     price recovered. Replaced with a continuous curve anchored on the two real jobs.
//  B. Calibration was NOT IDEMPOTENT. The repair pass feeds the already-calibrated
//     estimate back to the model and re-runs pricing, so echoed rates were scaled by
//     0.80 twice (tile $78 -> $62.40 -> $49.92). Now clamp-only, which is idempotent.
//  C. Markup resolved LAST, so isolateAlternatives and ensureWindowOptionEngine priced
//     options at the stale 25% while the base carried 54%. Resolved once, early.
//  D. Walk-up exemption read estimate.notes, which never carries it. Now requestEvidence.
//  E. Version stamps still said v2.0-cost-based.
//
// v2.1 CHANGES — all four verified against Sani's own completed jobs:
//  1. SUB_CONTRACT_CALIBRATION (0.80). The published loaded-cost table assumes payroll.
//     Sani buys SUBCONTRACT packages. On the real 5x7 bathroom the engine computed
//     $8,752 of labor + rough materials where the sub actually charged $7,000.
//  2. TIERED MARKUP. A flat 25% markup is a 20% gross margin — ten points under the NYC
//     standard of 30-40%, and under Sani's own observed 33.2% and 41.6%. Inflated labor
//     was hiding this: the two errors cancel ONLY on labor-heavy work. On a material-heavy
//     job (8 windows, 21% labor) the estimate came out 15% under. Both are fixed together;
//     fixing either alone breaks pricing.
//  3. paintingSfPerHour 32 -> 65. Two independent sources agree: back-solving published
//     NYC billable rates gives 65-71 paintable SF/painter-hour. 32 doubled painting labor.
//  4. Carpentry split into rough and finish. One rate could not cover both framing
//     ($46-70 loaded) and trim/millwork ($67-97 loaded).
//
// IMPORTANT ARCHITECTURE:
// AI understands scope and proposes operations.
// This file controls the economics before the estimate reaches the customer.
//
// PRINCIPLE:
// labor line rates here are INTERNAL LOADED COST rates, not customer selling rates.
// Dashboard markupPct is applied ONCE after labor + materials.
// This prevents "selling rate + 25% markup" double-loading.

const { marketAudit } = require('./nyc-market-benchmark');

const RULES = {
  markupDefault: 25,                 /* legacy fallback only; see markupTiers */
  /* Sani buys subcontract packages, not payroll. Published loaded-cost rates assume an
     employee with full burden. Calibrated against the completed 5x7 bathroom: engine
     labor + rough materials $8,752 vs the sub's actual flat $7,000. Recalculate this
     the moment a second sub-let job with known numbers exists. */
  subContractCalibration: 0.80,
  /* Markup by direct cost, from SANI_ACTUALS: 1.71x on a $2,250 job, 1.50x on a $9,690
     job. Expressed as percent to match the dashboard field. Gross margin in brackets. */
  /* OFF — Zura, Aug 23 2026. The curve below overrode his own markup field with 48-71%
     depending on job size, so a bathroom he priced at 25% shipped at 49.4%. He sets the
     markup in the dashboard; nothing here may override it. The curve is kept only as a
     reference number shown in the dashboard advice line. */
  applyTieredMarkup: false,
  /* CONTINUOUS markup curve, not brackets. Anchored on the two completed jobs so both
     reproduce exactly: $2,250 cost sold at 71%, $9,690 cost sold at 49.6%. Between and
     beyond the anchors the rate is linearly interpolated, which keeps customer price
     strictly increasing with cost — brackets did not (see v2.2 note A). */
  markupCurve: [
    { directCost: 2250,  markupPct: 71.0, note: 'Sani actual — bathroom floor + heat, 41.5% gross margin' },
    { directCost: 9690,  markupPct: 49.6, note: 'Sani actual — 5x7 bathroom, 33.2% gross margin' },
    { directCost: 30000, markupPct: 48.5, note: 'Large job floor — 32.7% gross margin' }
  ],
  paintingSfPerHour: 65,             /* was 32 — see header note 3 */
  engineeredHardwoodSfPerHour: 16,
  largeFormatTileSfPerHour: 5,
  loadedCostRates: {
    helper: 48,
    demo: 52,
    painter: 55,
    carpenter: 72,                   /* blended fallback when rough/finish is unclear */
    carpenterRough: 58,              /* base $32-48 x 1.45 burden */
    carpenterFinish: 78,             /* base $45-65 x 1.50 burden */
    flooring: 72,
    tile: 78,
    plumber: 95,
    electrician: 95,
    glazing: 82,
    windows: 75,
    drywall: 68,
    waterproofing: 78,
    supervision: 68,
    general: 60
  },
  maxLoadedRates: {
    helper: 58,
    demo: 62,
    painter: 65,
    carpenter: 85,
    carpenterRough: 70,
    carpenterFinish: 97,
    flooring: 85,
    tile: 90,
    plumber: 110,
    electrician: 110,
    glazing: 95,
    windows: 90,
    drywall: 80,
    waterproofing: 90,
    supervision: 85,
    general: 75
  }
};

const num = v => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const money = v => Math.round((Number(v) || 0) * 100) / 100;
const text = v => String(v == null ? '' : v).trim();
const norm = v => text(v).toLowerCase();
const sumLines = lines => (lines || []).reduce((s, l) => s + num(l.qty) * num(l.rate), 0);

function evidence(input, analysis) {
  return [
    input?.request?.description,
    input?.request?.sqft,
    input?.contractor?.extraRequest,
    input?.request?.contractorNotes,
    input?.request?.extraNotes,
    JSON.stringify(input?.request?.groupedAnswers || {}),
    JSON.stringify(analysis?.quantities || {}),
    JSON.stringify(analysis?.confirmed_scope || [])
  ].filter(Boolean).join(' | ');
}
function requestEvidence(input, analysis) { return norm(evidence(input, analysis)); }

function findQty(e, patterns) {
  for (const re of patterns) {
    const m = e.match(re);
    if (m) return num(String(m[1]).replace(/,/g, ''));
  }
  return 0;
}
function scopedText(raw, label, nextLabels) {
  const end = nextLabels.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp('(?:^|\\n)\\s*\\d+\\.\\s*' + label + '\\b([\\s\\S]*?)(?=\\n\\s*\\d+\\.\\s*(?:' + end + ')\\b|$)', 'i');
  const m = raw.match(re);
  return m ? m[1] : '';
}
/* Read the analysis pass's STRUCTURED quantities before falling back to prose regex.
   v2.0 only regexed the evidence string. analysis.quantities is serialised into that
   string as JSON ({"painting_sf":1200}), which none of the prose patterns can match —
   so all three production minimums below were dead unless the customer happened to
   write "1200 sf paintable" in their own words. Structured first, prose second. */
function firstQty(q, keys) {
  for (const k of keys) {
    const v = num(q && q[k]);
    if (v) return v;
  }
  return 0;
}

function extractQuantities(input, analysis) {
  const raw = evidence(input, analysis);
  const q = (analysis && analysis.quantities) || {};
  const desc = text(input?.request?.description);
  const floor = scopedText(desc, 'FLOORING', ['PAINTING', 'WINDOW']);
  const paint = scopedText(desc, 'PAINTING', ['WINDOW']);
  const bath = scopedText(desc, 'BATHROOM RENOVATION', ['FLOORING', 'PAINTING', 'WINDOW']);
  return {
    paintingSf: firstQty(q, ['painting_sf', 'paintingSf', 'paintable_sf', 'paintableSf']) || findQty(paint || raw, [
      /(?:approximately|approx\.?)\s*([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square\s*feet)\s+(?:of\s+)?paintable/i,
      /paintable(?:\s+surface)?[^\d]{0,30}([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square\s*feet)/i,
      /([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square\s*feet)[^|\n]{0,35}(?:paintable|painting)/i
    ]),
    flooringSf: firstQty(q, ['flooring_sf', 'flooringSf', 'floor_sf', 'floorSf']) || findQty(floor || raw, [
      /total\s*(?:approximately|approx\.?)?\s*[:=-]?\s*([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square\s*feet)/i,
      /(?:approximately|approx\.?)\s*([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square\s*feet)/i
    ]),
    tileSf: firstQty(q, ['tile_sf', 'tileSf']) || findQty(bath || raw, [
      /(?:total\s+tile\s+installation|tile\s+installation)[^\d]{0,25}([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square\s*feet)/i,
      /approximately\s*([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square\s*feet)[^\n]{0,30}(?:shower|wall|floor|tile)/i
    ])
  };
}

/* ===========================================================================
   SERVICE VOCABULARY — v9, selection-gated
   ---------------------------------------------------------------------------
   WHAT WENT WRONG (New Leaf Pilates Studio, SBC-260805-Q6CT, Aug 2026)

   The customer ordered interior painting, wall-mounted mirrors, patch flooring
   and furniture assembly. The quote came back with a "Bathroom $9,976.72" card
   and a "Flooring $9,035.62" card, both showing NO labor lines and NO material
   lines. There is no bathroom in that job.

   Two defects, both structural:

   1. canonicalService took `selected` — the trades the customer actually asked
      for — and used it on exactly one branch (Painting). Every other branch
      classified on keywords alone. The word "glass" in a mirror-panel line and
      the word "tile" in a floor-patch line both fell into the Bathroom bucket.
      A keyword could invent a service the customer never bought.

   2. The customer-facing card set was hardcoded to four names:
      ['Bathroom','Flooring','Painting','Windows']. Mirrors, furniture assembly,
      doors, drywall, carpentry and handyman work matched no card at all, so
      their cost landed in `generalBase` — which consolidateCustomerPresentation
      then redistributes across the surviving cards in proportion to cost. That
      is precisely why both cards carried a large price while listing nothing:
      the money arrived through the General redistribution, not through any line
      the card owned.

   THE FIX (Law 3 — enforce in code, not in the prompt)

   - The vocabulary now covers the trades Sani actually sells.
   - canonicalService can NEVER return a service outside the allowed set. It
     walks the vocabulary in order and takes the first pattern match whose
     service is allowed; a match on a service the customer did not buy is
     skipped, not honoured. If nothing allowed matches, the line goes to the
     single allowed service when there is exactly one, otherwise to General.
   - "Handyman" and "General" are containers, not trades. When the customer's
     only selection is a container, the allowed set is derived from the words in
     the customer's own request instead — so a Handyman ticket can still split
     into Painting / Mirrors & Glass / Flooring cards, but can only produce a
     Bathroom card if the customer actually said bathroom, shower, tub, toilet
     or vanity.

   Order is load-bearing. Bathroom sits ahead of Tile, Plumbing and
   Waterproofing so a real bathroom job keeps collecting its tile and plumbing
   lines onto the Bathroom card exactly as before. Those services only become
   reachable when Bathroom is NOT in the allowed set.
=========================================================================== */

const CONTAINER_SERVICES = ['Handyman', 'General'];

/* `strong` entries win before the ordered walk: words that name one trade and
   nothing else. "Mirror" is never a bathroom line unless the customer bought a
   bathroom, and even then the shower-glass guard below keeps it out. */
const SERVICE_VOCAB = [
  { name: 'Windows',           ev: /\bwindow/,
                               strong: /\bwindow\b|window sash|window sill|glazing bead/,
                               item: /window|sash|glazing bead/,                                   sec: /window/,
                               trade: /window/ },
  { name: 'Doors',             ev: /\bdoor\b|doorway/,
                               strong: /\bdoor slab\b|door jamb|doorway|lockset|door hardware/,
                               item: /\bdoor\b|doorway|jamb|lockset|hinge/,                        sec: /\bdoor/,
                               trade: /\bdoor/ },
  { name: 'Mirrors & Glass',   ev: /\bmirror/,
                               strong: /\bmirror\b|glass panel|glass wall|glazier/,
                               item: /mirror|glass panel|glass wall|glazier/,                      sec: /mirror|glass/,
                               trade: /mirror|glass|glazier/,
                               not: /shower|tub|bath|vanity|shower door/ },
  { name: 'Furniture Assembly',ev: /furniture/,
                               strong: /furniture assembl|assemble furniture|flat.?pack|furniture install|furniture moving/,
                               item: /furniture|assembl|flat.?pack|shelving unit|desk install/,    sec: /furniture/,
                               trade: /furniture/ },
  { name: 'Painting',          ev: /paint/,
                               strong: /\bpaint\b|painter|primer coat/,
                               item: /paint|painter|primer|spackle|skim coat/,                     sec: /paint/,
                               trade: /paint/ },
  { name: 'Bathroom',          item: /bath|shower|vanity|toilet|\btub\b|lavatory|backer|thinset|grout|tile|waterproof|plumb|faucet|glass|glaz/,
                               sec: /bath|shower|plumb|tile|waterproof/,
                               trade: /bath/,
                               ev: /bathroom|\bshower\b|\btub\b|toilet|vanity|lavatory/ },
  { name: 'Kitchen',           item: /kitchen|cabinet|countertop|backsplash|range hood/,           sec: /kitchen|cabinet/,
                               trade: /kitchen|cabinet/,
                               ev: /kitchen/ },
  { name: 'Flooring',          ev: /\bfloor|hardwood|laminate|vinyl plank/,
                               item: /engineered hardwood|hardwood floor|flooring|floor patch|patch floor|quarter.?round|subfloor|underlayment|transition strip|baseboard|vinyl plank|laminate floor/,
                               sec: /floor/,
                               trade: /floor/,
                               not: /bath|shower/ },
  { name: 'Tile',              ev: /\btil(e|ing)\b/,
                               item: /tile|thinset|grout|backer ?board|mortar bed/,                sec: /tile/,
                               trade: /tile/ },
  { name: 'Carpentry',         ev: /carpentry|millwork|framing/,
                               item: /carpentry|framing|trim work|moulding|molding|millwork|blocking/, sec: /carpentry|framing|trim/,
                               trade: /carpentry|framing|trim/ },
  { name: 'Drywall',           ev: /drywall|sheetrock/,
                               item: /drywall|sheetrock|gypsum|joint compound|tape and finish/,    sec: /drywall|sheetrock/,
                               trade: /drywall|sheetrock/ },
  { name: 'Electrical',        ev: /electric|lighting/,
                               item: /electric|outlet|receptacle|gfci|light fixture|switch|circuit|wiring/, sec: /electric/,
                               trade: /electric/ },
  { name: 'Plumbing',          ev: /plumb/,
                               item: /plumb|supply line|waste line|shut.?off valve|p.?trap|faucet/, sec: /plumb/,
                               trade: /plumb/ },
  { name: 'Waterproofing',     ev: /waterproof/,
                               item: /waterproof|membrane|vapor barrier|flood test/,               sec: /waterproof/,
                               trade: /waterproof/ },
  { name: 'Stairs',            ev: /\bstair|staircase|\btread\b|\briser\b|banister|newel/,
                               strong: /\bstair(s|case|well)?\b|\btread\b|\briser\b|newel post|banister/,
                               item: /stair|tread|riser|newel|banister/,                             sec: /stair/,
                               trade: /stair/ },
  { name: 'Deck',              ev: /\bdeck\b|decking/,
                               item: /\bdeck\b|decking|timbertech|railing post/,                   sec: /deck/,
                               trade: /deck/ },
  { name: 'Handyman',          item: /handyman|odd job|small repair|mount(?:ing)? (?:tv|shelf|shelves)|hang (?:shelf|shelves|picture)/, sec: /handyman/,
                               trade: /handyman|general repair/ }
];

const VOCAB_BY_NAME = SERVICE_VOCAB.reduce((a, v) => { a[v.name] = v; return a; }, {});

function genericOperation(item) {
  const i = norm(item);
  if (!i) return false;
  const specific = SERVICE_VOCAB.some(v => v.item.test(i) && !(v.not && v.not.test(i)));
  if (specific) return false;
  return /project management|project coordination|coordination|supervision|general conditions|general labor|final project cleanup|final cleanup|walk[- ]?through|site protection|material haul|walk[- ]?up.*haul|debris removal|debris disposal|disposal haul|jobsite setup/.test(i);
}

/* Map one trade name the customer or the analyst wrote onto a canonical service. */
function tradeToService(trade) {
  const t = norm(trade);
  if (!t) return '';
  const hit = SERVICE_VOCAB.find(v => (v.trade || v.item).test(t) && !(v.not && v.not.test(t)));
  return hit ? hit.name : '';
}

/* The allowed set. Everything downstream is confined to this list. */
function allowedServiceSet(selected) {
  const out = [];
  (selected || []).forEach(x => {
    const n = tradeToService(x);
    if (n && !out.includes(n)) out.push(n);
  });
  return out;
}

function containerOnly(allowed) {
  return !allowed.length || allowed.every(x => CONTAINER_SERVICES.includes(x));
}

function canonicalService(section, item, selected) {
  const i = norm(item), sec = norm(section);
  const allowed = Array.isArray(selected) && selected.__sbcResolved
    ? selected.slice()
    : allowedServiceSet(selected);

  /* No usable allowed set (legacy call sites pass []) — fall back to the old
     ordered walk with no gate, so Windows detection and the option helpers that
     deliberately pass [] keep behaving exactly as they did. */
  const gated = allowed.length > 0;
  const permitted = n => !gated || allowed.includes(n) || CONTAINER_SERVICES.includes(n);

  if (genericOperation(i)) return 'General';

  /* Strong words first: they name one trade and nothing else. */
  for (const v of SERVICE_VOCAB) {
    if (!v.strong || !v.strong.test(i)) continue;
    if (v.not && v.not.test(i)) continue;
    if (permitted(v.name)) return v.name;
  }
  /* Ordered walk on the item wording. */
  for (const v of SERVICE_VOCAB) {
    if (!v.item.test(i)) continue;
    if (v.not && v.not.test(i)) continue;
    if (permitted(v.name)) return v.name;
  }
  /* Then the section wording. */
  for (const v of SERVICE_VOCAB) {
    if (!v.sec || !v.sec.test(sec)) continue;
    if (v.not && v.not.test(sec)) continue;
    if (permitted(v.name)) return v.name;
  }
  if (/project management|supervision|coordination|general conditions|general labor|cleanup|site protection/.test(sec)) return 'General';

  /* Nothing allowed matched. A single-service job absorbs the line rather than
     spawning a card the customer never asked for. */
  const real = allowed.filter(x => !CONTAINER_SERVICES.includes(x));
  if (real.length === 1) return real[0];
  if (gated) return 'General';
  return text(section) || 'General';
}

/* Resolve the definitive service set for one estimate, once, and hand the SAME
   resolved array to every classifier call below. When the customer's only
   selection is a container ("Handyman"), the set is rebuilt from the words in
   his own request — so the ticket can still split into real cards, but a
   Bathroom card requires him to have actually written bathroom/shower/tub/
   toilet/vanity. */
function resolveServiceSet(analysis, input, estimate) {
  let allowed = allowedServiceSet(analysis?.selected_trades || []);
  /* ══ EVIDENCE ALWAYS RUNS, NOT ONLY WHEN THE TRADE LIST IS EMPTY. ══════════
     This gate used to be `if (containerOnly(allowed))`, so the customer's own
     words were read only when the wizard produced nothing but Handyman/General.
     The moment ONE real trade was selected, everything else the customer asked
     for became invisible.

     The Pilates studio picked Painting, Flooring and Handyman. "Handyman" is a
     container — it names no trade — and it was carrying the mirrors and the
     furniture assembly. Because Painting and Flooring were also selected, the
     set was not container-only, evidence never ran, and Mirrors & Glass and
     Furniture Assembly were never admitted. Their lines were then re-filed onto
     Painting by canonicalService and two real trades disappeared from the
     estimate with their money folded into another card.

     That is the same defect as a phantom card seen from the other side, and it
     gets worse with every trade added to the vocabulary. Evidence now always
     runs, and its findings are UNIONED with the selected trades: what the
     customer picked, plus what the customer described. Still nothing sourced
     from the estimator's own output, so no phantom can enter this way. */
  {
    const ev = norm([
      text(input?.request?.description),
      text(input?.request?.service),
      ...(input?.request?.selectedServices || []).map(text),
      /* ══ THE TRADE NAME IS EVIDENCE. THE TASK TEXT IS NOT. ══════════════════
         `scope_items` used to be concatenated in here, and that is the last place
         the phantom Windows card was coming from. The analyst wrote a perfectly
         correct painting task — "mask trim, glass and windows before spraying" —
         and this line handed the word "windows" to the vocabulary matcher as
         though the customer had bought windows. A Windows card appeared, and then
         canonicalService filed the masking labour under it, so it even had money
         and lines and survived every emptiness check downstream.

         It is the same category error as reading the estimator's own line items:
         a noun inside a description of HOW work is done is not a thing the
         customer purchased. `trade` is an explicit naming of a trade and is kept.
         The customer's own description is kept. The task text is not evidence. */
      ...(analysis?.confirmed_scope || []).map(s => text(s.trade))
      /* THE ESTIMATOR'S OWN LINE ITEMS ARE NOT EVIDENCE. THEY USED TO BE, AND THAT
         WAS THE BUG BEHIND EVERY PHANTOM CARD.

         A painting line reading "mask trim, glass and windows before spraying"
         made this function believe the customer had bought Windows. A protection
         line mentioning a mirror made it believe they had bought a Bathroom. On
         the Pilates studio — painting, wall mirrors, floor patching, furniture,
         no windows and no bathroom anywhere in the request — that produced a
         Windows card and a Bathroom card, each holding an identical half of the
         money with no lines under either, because no line truly belonged to them
         and the shared-cost split fed them regardless.

         The set of services must come from what the CUSTOMER asked for: the
         services they selected, the words they wrote, and the trades the analyst
         confirmed from those words. The estimate is the answer; it cannot also be
         the question. Incidental nouns inside a task description are not a
         purchase. This closes the phantom-card class for every trade at once,
         rather than one keyword at a time. */
    ].join(' | '));
    const found = [];
    SERVICE_VOCAB.forEach(v => {
      if (CONTAINER_SERVICES.includes(v.name)) return;
      const re = v.ev || v.strong || v.item;
      if (re.test(ev) && !(v.not && v.not.test(ev)) && !found.includes(v.name)) found.push(v.name);
    });
    /* Tile patching inside a flooring scope is one service to the customer, not
       two cards. Tile only stands alone when there is no Flooring scope to own
       it, or when it belongs to a Bathroom. */
    if (found.includes('Tile') && found.includes('Flooring') && !found.includes('Bathroom')) {
      found.splice(found.indexOf('Tile'), 1);
    }
    /* Containers are placeholders. Once evidence has named the real trades a
       container was standing in for, it must not linger and collect lines. But
       if evidence found nothing at all, the container stays — it is better to
       show one honest "Handyman" card than no card. */
    const real = allowed.filter(x => !CONTAINER_SERVICES.includes(x));
    const union = real.slice();
    found.forEach(f => { if (!union.includes(f)) union.push(f); });
    if (union.length) allowed = union;
    else if (!allowed.length) allowed = found;
  }
  const arr = allowed.slice();
  Object.defineProperty(arr, '__sbcResolved', { value: true, enumerable: false });
  return arr;
}

/* A line stamped sbcSharedSplit was placed deliberately by attributeSharedLines in
   generate-estimate-background.js: genuinely shared work - coordination, cleanup,
   protection, debris - divided across the customer's real services in proportion to
   their LABOUR, one line per service.

   canonicalService reads the item WORDING before it looks at the section, and
   "project coordination", "final cleanup" and "debris disposal" all read as generic.
   Without this guard the very next stage after the split sends every one of them back
   to General, and the fifth card the customer never asked for reappears on his quote.

   The stamp is precise - it marks only lines this pipeline created - so honouring it
   costs canonicalService nothing for any other line. The section is still checked
   against the selected services, so a stale or hand-edited stamp can never pin a line
   to a service that does not exist. */
function pinnedService(line, selected) {
  if (!line || !line.sbcSharedSplit) return '';
  const sec = text(line.section);
  if (!sec) return '';
  return (selected || []).some(x => norm(x) === norm(sec)) ? sec : '';
}

function classifyLabor(line) {
  const s = norm(`${line?.section || ''} ${line?.item || ''}`);
  if (/plumb|toilet|faucet|valve|drain|supply line|shower trim/.test(s)) return 'plumber';
  if (/electric|wiring|outlet|switch|light fixture|exhaust fan/.test(s)) return 'electrician';
  if (/glass|glaz|shower enclosure/.test(s)) return 'glazing';
  if (/window/.test(s)) return 'windows';
  if (/tile|grout|thinset/.test(s)) return 'tile';
  if (/waterproof|kerdi|membrane|shower pan/.test(s)) return 'waterproofing';
  if (/engineered hardwood|hardwood|flooring install|subfloor|transition/.test(s)) return 'flooring';
  if (/paint|primer|painter|spackle/.test(s)) return 'painter';
  if (/drywall|sheetrock|cement board|backer board|taping|mudding|sanding/.test(s)) return 'drywall';
  if (/finish carpen|trim|molding|baseboard|casing|crown|millwork|cabinet/.test(s)) return 'carpenterFinish';
  if (/rough carpen|framing|stud|blocking|joist|subfloor|sheathing/.test(s)) return 'carpenterRough';
  if (/carpent|door/.test(s)) return 'carpenter';
  if (/demo|demolition|remove|debris|haul|disposal/.test(s)) return 'demo';
  if (/project management|project coordination|supervision|trade scheduling/.test(s)) return 'supervision';
  if (/helper|laborer|cleanup|protection|setup|material handling/.test(s)) return 'helper';
  return 'general';
}

function calibratedRate(v) { return money(num(v) * (Number(RULES.subContractCalibration) || 1)); }

/* A line already converted to the subcontract basis carries this stamp. Re-running is a
   no-op because the STAMP is there, not because the arithmetic happens to be stable.
   v2.2 chose clamp-only for idempotency and paid for it: any AI rate that landed under
   its ceiling was left on the payroll basis, so the cost basis was mixed and Job 2 drifted
   from +3.4% to +8.8% against its real sale price. Identity, never arithmetic. */
const RATE_BASIS_SUBCONTRACT = 'subcontract';

function normalizeLaborRates(estimate, adjustments) {
  const cal = Number(RULES.subContractCalibration) || 1;
  (estimate.labor || []).forEach(line => {
    const unit = norm(line.unit);
    if (!/hr|hour/.test(unit)) return;
    if (line.rateBasis === RATE_BASIS_SUBCONTRACT) return;   // already converted
    const cls = classifyLabor(line);
    /* The published table is payroll-basis. Calibrate to what Sani actually pays a sub
       BEFORE comparing, so the ceiling is a real ceiling and not a payroll one. */
    const target = calibratedRate(RULES.loadedCostRates[cls] || RULES.loadedCostRates.general);
    const ceiling = calibratedRate(RULES.maxLoadedRates[cls] || RULES.maxLoadedRates.general);
    const old = num(line.rate);
    if (!old) return;
    if (old > ceiling) {
      line.rate = target;
      line.rateBasis = RATE_BASIS_SUBCONTRACT;
      adjustments.push({
        type: 'LABOR_RATE_NORMALIZED',
        item: text(line.item),
        laborClass: cls,
        fromRate: old,
        toLoadedCostRate: target,
        subContractCalibration: cal,
        reason: 'AI returned a rate above Sani\'s sub-let loaded cost ceiling. Dashboard markup is applied separately.'
      });
      return;
    }
    /* Under the ceiling but still on the payroll basis the AI was trained on. Convert it,
       exactly as v2.1 did — the stamp above is what makes this safe to re-run, so the
       cost basis stays uniform across every line instead of depending on where each AI
       guess happened to land. */
    if (cal !== 1) {
      const scaled = calibratedRate(old);
      if (Math.abs(scaled - old) >= 0.01) {
        line.rate = scaled;
        line.rateBasis = RATE_BASIS_SUBCONTRACT;
        adjustments.push({
          type: 'LABOR_RATE_CALIBRATED_TO_SUBCONTRACT',
          item: text(line.item),
          laborClass: cls,
          fromRate: old,
          toRate: scaled,
          subContractCalibration: cal,
          reason: 'Published loaded-cost rates assume payroll. Sani buys subcontract packages; factor is from the completed 5x7 bathroom.'
        });
      } else {
        line.rateBasis = RATE_BASIS_SUBCONTRACT;
      }
    }
  });
}

/* Markup from job size, from Sani's own completed jobs. A flat 25% is a 20% gross margin,
   below both the NYC 30-40% standard and Sani's observed 33.2% / 41.6%.
   Continuous: interpolate between anchors, flat outside them. A bracketed step made the
   customer price fall as cost rose, which is never acceptable. */
function resolveMarkupPct(directCost) {
  const c = RULES.markupCurve;
  if (directCost <= c[0].directCost) return { markupPct: c[0].markupPct, note: c[0].note };
  const last = c[c.length - 1];
  if (directCost >= last.directCost) return { markupPct: last.markupPct, note: last.note };
  for (let i = 0; i < c.length - 1; i++) {
    const a = c[i], b = c[i + 1];
    if (directCost > a.directCost && directCost <= b.directCost) {
      const t = (directCost - a.directCost) / (b.directCost - a.directCost);
      const pct = Math.round((a.markupPct + t * (b.markupPct - a.markupPct)) * 10) / 10;
      return { markupPct: pct, note: `Interpolated between $${a.directCost} and $${b.directCost} anchors` };
    }
  }
  return { markupPct: last.markupPct, note: last.note };
}

function applyTieredMarkup(estimate, adjustments) {
  if (!RULES.applyTieredMarkup) return;
  const directCost = sumLines(estimate.labor) + sumLines(estimate.materials);
  if (!(directCost > 0)) return;
  const tier = resolveMarkupPct(directCost);
  const current = Number(estimate.markupPct);
  /* Only replace the legacy default. A contractor who typed his own number keeps it. */
  const isLegacyDefault = !Number.isFinite(current) || current === RULES.markupDefault;
  estimate.markupRecommendation = {
    directCost: money(directCost),
    recommendedMarkupPct: tier.markupPct,
    grossMargin: Math.round((1 - 1 / (1 + tier.markupPct / 100)) * 1000) / 10,
    tier: tier.note,
    basis: 'SANI_ACTUALS markup bands; NYC standard gross margin 30-40%'
  };
  if (!isLegacyDefault) return;
  estimate.markupPct = tier.markupPct;
  adjustments.push({
    type: 'MARKUP_TIERED',
    fromMarkupPct: Number.isFinite(current) ? current : null,
    toMarkupPct: tier.markupPct,
    directCost: money(directCost),
    reason: tier.note + '. Flat 25% was a 20% gross margin, under the NYC 30-40% standard and under Sani\'s own completed jobs.'
  });
}

function laborMatches(line, kind) {
  const s = norm(`${line.section || ''} ${line.item || ''}`);
  if (kind === 'painting') return /paint|painter|wall.*ceiling|ceiling.*wall/.test(s);
  if (kind === 'flooring') return /engineered hardwood|hardwood floor|flooring install|floor installer/.test(s) && !/bath|tile|shower/.test(s);
  if (kind === 'tile') return /tile setter|tile install|large[- ]format|24\s*[x×]\s*48/.test(s);
  return false;
}

/* PRODUCTION MINIMUMS ARE ADVISORY ONLY — Zura, Aug 23 2026.
   This used to RAISE labour hours to hit a published production rate and could never
   lower them, so every rate that was even slightly pessimistic became a one-way ratchet
   on price. largeFormatTileSfPerHour of 5 turned 170 SF of tile into a 34-hour floor on
   that line alone. He wants the estimate to be what the model and the live market say,
   not what a table says. The finding is still recorded so it is visible, but it no
   longer moves a number. */
const ENFORCE_PRODUCTION_MINIMUMS = false;

function enforceProductionMinimum(estimate, kind, minHours, reason, adjustments) {
  if (!minHours) return;
  if (!ENFORCE_PRODUCTION_MINIMUMS) {
    const seen = (estimate.labor || []).filter(l => laborMatches(l, kind))
      .reduce((s2, l) => s2 + num(l.qty), 0);
    if (seen + 0.01 < minHours) {
      adjustments.push({ type: 'PRODUCTION_HOURS_NOTE', kind, estimatedHours: Math.round(seen * 10) / 10,
        referenceHours: Math.ceil(minHours), reason, note: 'Advisory only — no hours were added.' });
    }
    return;
  }
  const matches = (estimate.labor || []).filter(l => laborMatches(l, kind));
  if (!matches.length) {
    adjustments.push({ type: 'MISSING_PRODUCTION_LINE', kind, minimumHours: Math.ceil(minHours), reason });
    return;
  }
  const current = matches.reduce((s, l) => s + num(l.qty), 0);
  if (current + 0.01 >= minHours) return;
  const target = matches.slice().sort((a, b) => num(b.qty) - num(a.qty))[0];
  target.qty = Math.ceil(num(target.qty) + (minHours - current));
  adjustments.push({
    type: 'PRODUCTION_HOURS_RAISED',
    kind,
    fromHours: current,
    toHours: matches.reduce((s, l) => s + num(l.qty), 0),
    changedLine: target.item,
    reason
  });
}

function removeOverlappingLabor(estimate, adjustments) {
  const lines = estimate.labor || [];
  const drop = new Set();
  function has(re) { return lines.findIndex(l => re.test(norm(l.item))); }
  function removeIfBoth(broadRe, narrowRe, label) {
    const bi = has(broadRe), ni = has(narrowRe);
    if (bi >= 0 && ni >= 0 && bi !== ni) {
      const broad = norm(lines[bi].item);
      if ((label === 'bath-demo' && /complete|full/.test(broad)) || (label === 'tile-finish' && /grout|caulk|seal/.test(broad))) {
        drop.add(ni);
        adjustments.push({
          type: 'OVERLAP_REMOVED',
          removedItem: lines[ni].item,
          coveredBy: lines[bi].item,
          reason: 'Avoid duplicate labor charge for the same operation.'
        });
      }
    }
  }
  removeIfBoth(/complete|full.*bathroom.*demolition|complete bathroom demolition/, /tub\/?shower removal|remove.*tub|bathtub removal/, 'bath-demo');
  removeIfBoth(/tile installation.*grout|tile.*grout.*caulk/, /tile grouting|grouting.*caulking|grout.*seal/, 'tile-finish');
  estimate.labor = lines.filter((_, i) => !drop.has(i));
}

function capGeneralConditions(estimate, adjustments, input, analysis) {
  const labor = estimate.labor || [];
  const generalIdx = [];
  let specificCost = 0, generalCost = 0;
  labor.forEach((l, i) => {
    const cost = num(l.qty) * num(l.rate);
    if (genericOperation(l.item) || classifyLabor(l) === 'supervision') {
      generalIdx.push(i);
      generalCost += cost;
    } else {
      specificCost += cost;
    }
  });
  if (!specificCost || !generalCost) return;
  /* v2.1 read estimate.notes, which the AI schema documents as "Internal estimator notes
     only" — walk-up and access facts arrive in input.request.description, so the
     exemption never fired and real fifth-floor walk-ups got the tight 12% cap on exactly
     the jobs that need protection and haul labour. capUnneededRoughIn below already uses
     requestEvidence correctly; this now matches it. */
  const evidenceText = requestEvidence(input, analysis) + ' ' + norm(estimate.notes || '');
  const exceptional = /no elevator|walk[- ]?up|walkup|restricted hours|night work|occupied.*protection|[3-9](?:rd|th)\s+floor/.test(evidenceText);
  const maxRatio = exceptional ? 0.18 : 0.12;
  const maxGeneral = specificCost * maxRatio;
  if (generalCost <= maxGeneral) return;
  const factor = maxGeneral / generalCost;
  generalIdx.forEach(i => {
    const l = labor[i];
    const oldQty = num(l.qty);
    if (!oldQty) return;
    l.qty = Math.max(1, Math.round(oldQty * factor * 2) / 2);
  });
  adjustments.push({
    type: 'GENERAL_CONDITIONS_NORMALIZED',
    fromCost: money(generalCost),
    targetMaxCost: money(maxGeneral),
    ratio: maxRatio,
    reason: 'Prevents protection/cleanup/coordination labor from stacking excessively on top of direct trade labor.'
  });
}

function normalizeOwnership(estimate, analysis, adjustments) {
  /* Must use the RESOLVED set, not raw selected_trades. On a container-only
     ticket ("Handyman") the raw list maps to no real trade, and the gate in
     canonicalService would rewrite every line.section to General before
     consolidateCustomerPresentation ever got to look at it. */
  const selected = resolveServiceSet(analysis, null, estimate);
  ['labor', 'materials'].forEach(bucket => (estimate[bucket] || []).forEach(line => {
    /* Honour a deliberate split before re-deriving from the wording. */
    const next = pinnedService(line, selected) || canonicalService(line.section, line.item, selected);
    if (next && next !== line.section) {
      adjustments.push({ type: 'SERVICE_REASSIGNED', bucket, item: line.item, from: line.section, to: next });
      line.section = next;
    }
  }));
  (estimate.customerSupplied || []).forEach(x => {
    if (x && typeof x === 'object') x.section = canonicalService(x.section, x.item, selected);
  });
  (estimate.options || []).forEach(o => {
    o.section = canonicalService(o.section, `${o.label || ''} ${o.description || ''}`, selected);
  });
}

function altCode(line) {
  const s = norm(`${line.item || ''} ${line.description || ''} ${line.label || ''}`);
  const m = s.match(/\boption\s*([b-z])\b/);
  if (m) return `Option ${m[1].toUpperCase()}`;
  if (/\balternate\b|\balternative\b/.test(s)) return 'Alternate';
  return '';
}
function isAlt(line) { return !!altCode(line); }

function isolateAlternatives(estimate, adjustments) {
  estimate.options = Array.isArray(estimate.options) ? estimate.options : [];
  const grouped = {};
  ['labor', 'materials'].forEach(bucket => {
    const keep = [];
    (estimate[bucket] || []).forEach(line => {
      const code = altCode(line);
      if (!code) { keep.push(line); return; }
      const key = `${text(line.section) || 'General'}|${code}`;
      const base = num(line.qty) * num(line.rate);
      grouped[key] = grouped[key] || { section: line.section || 'General', label: `${code} — alternative`, raw: 0 };
      grouped[key].raw += base;
      adjustments.push({ type: 'ALTERNATIVE_REMOVED_FROM_BASE', bucket, item: line.item, baseCost: money(base) });
    });
    estimate[bucket] = keep;
  });
  /* NO PRICE HERE. This function runs before the markup is resolved, so anything it
     priced would carry the legacy 25% while the base work carried the real rate — an
     alternative shown at $1,875 that should read $2,436. Record the calibrated raw cost
     and let priceAlternatives() apply the resolved markup once, at the end. */
  Object.values(grouped).forEach(o => {
    if (!estimate.options.some(x => norm(x.label) === norm(o.label))) {
      estimate.options.push({
        section: o.section,
        label: o.label,
        description: 'Mutually exclusive alternative; excluded from base Grand Total until selected.',
        rawCost: money(o.raw)
      });
    }
  });
}

/* One place, one markup. Every option that carries a rawCost is priced from the same
   number the base estimate uses, so the customer never sees an alternative on a
   different margin from the work printed beside it. */
function priceAlternatives(estimate, adjustments) {
  const mm = 1 + num(estimate.markupPct || RULES.markupDefault) / 100;
  let priced = 0;
  (estimate.options || []).forEach(o => {
    if (!o || !Number.isFinite(Number(o.rawCost))) return;
    o.price = money(num(o.rawCost) * mm);
    delete o.rawCost;
    priced++;
  });
  if (priced) {
    adjustments.push({
      type: 'ALTERNATIVES_PRICED_AT_BASE_MARKUP',
      count: priced,
      markupPct: Number(estimate.markupPct),
      reason: 'Alternatives are priced from the same calibrated cost basis and the same markup as the base estimate.'
    });
  }
}

function windowRequested(input, analysis) {
  const e = requestEvidence(input, analysis);
  return /window/.test(e) && (/replace|replacement|repair|option\s*a|option\s*b/.test(e));
}
function optionLetter(o) {
  const s = norm(`${o?.label || ''} ${o?.description || ''}`);
  const m = s.match(/\boption\s*([a-z])\b/);
  return m ? m[1].toUpperCase() : '';
}
function isWindowLine(line) {
  return canonicalService(line?.section, line?.item, []) === 'Windows' && !genericOperation(line?.item);
}
function parseWindowCount(input, analysis) {
  const raw = evidence(input, analysis);
  let total = 0, m;
  const re = /(\d+(?:\.\d+)?)\s*["”]?\s*[x×]\s*(\d+(?:\.\d+)?)\s*["”]?[^|\n]{0,45}?(?:quantity|qty)\s*[:#-]?\s*(\d+)/gi;
  while ((m = re.exec(raw))) total += Number(m[3]) || 0;
  const simple = raw.match(/(?:replace|replacement of|all)\s+(\d+)\s+(?:existing\s+)?windows?/i);
  if (!total && simple) total = Number(simple[1]) || 0;
  return total || 6;
}

function ensureWindowOptionEngine(estimate, analysis, input, adjustments) {
  if (!windowRequested(input, analysis)) return;
  estimate.options = Array.isArray(estimate.options) ? estimate.options : [];
  const mm = 1 + num(estimate.markupPct || RULES.markupDefault) / 100;
  let hasBase = [...(estimate.labor || []), ...(estimate.materials || [])].some(isWindowLine);
  const optionA = estimate.options.find(o =>
    canonicalService(o.section, `${o.label || ''} ${o.description || ''}`, []) === 'Windows' && optionLetter(o) === 'A'
  );
  if (!hasBase && optionA && (num(optionA.price) > 0 || num(optionA.rawCost) > 0)) {
    /* rawCost is already pre-markup; a legacy record only carries price. */
    const preMarkup = num(optionA.rawCost) > 0 ? money(num(optionA.rawCost)) : money(num(optionA.price) / mm);
    estimate.materials.push({ section: 'Windows', item: `${text(optionA.label) || 'Window Option A'} — selected base allowance`, qty: 1, unit: 'allowance', rate: preMarkup });
    estimate.options = estimate.options.filter(o => o !== optionA);
    hasBase = true;
    adjustments.push({ type: 'BASE_OPTION_PROMOTED', service: 'Windows', option: 'A', customerPrice: money(optionA.price) });
  }
  if (!hasBase) {
    const count = parseWindowCount(input, analysis);
    const hours = Math.max(12, Math.ceil(count * 3.25));
    estimate.labor.push({ section: 'Windows', item: `Window Option A — remove existing windows, prepare openings, install and finish ${count} specified replacement windows`, qty: hours, unit: 'hrs', rate: RULES.loadedCostRates.windows });
    estimate.materials.push({ section: 'Windows', item: `Window Option A — ${count} specified replacement windows allowance`, qty: count, unit: 'ea', rate: 780 });
    adjustments.push({ type: 'WINDOW_BASE_SYNTHESIZED', option: 'A', windowCount: count });
  }
  estimate.optionSelections = estimate.optionSelections || {};
  estimate.optionSelections.Windows = { selected: 'Option A', baseIncluded: true, alternatives: [] };
  estimate.options = estimate.options.filter(o => !(canonicalService(o.section, `${o.label || ''} ${o.description || ''}`, []) === 'Windows' && optionLetter(o) === 'A'));
  const hasB = estimate.options.some(o => canonicalService(o.section, `${o.label || ''} ${o.description || ''}`, []) === 'Windows' && optionLetter(o) === 'B');
  if (!hasB) {
    const count = parseWindowCount(input, analysis);
    const adjust = Math.max(0, count - 2);
    const raw = (8 + adjust * 1.25) * RULES.loadedCostRates.windows + 2200 + adjust * 85;
    estimate.options.push({
      section: 'Windows',
      label: 'Option B — Replace 2 premium acoustic windows + adjust remaining existing windows',
      description: 'Alternative requested by customer. Replace two bedroom windows with premium acoustic windows and repair/adjust the remaining existing windows. Excluded from base Grand Total until selected.',
      rawCost: money(raw)
    });
  }
  /* optionSelections is rebuilt in applyDeterministicPricing AFTER priceAlternatives,
     so the alternatives it lists carry final prices rather than undefined. */
}

function rebuildWindowSelections(estimate) {
  if (!estimate.optionSelections || !estimate.optionSelections.Windows) return;
  estimate.optionSelections.Windows.alternatives = (estimate.options || [])
    .filter(o => canonicalService(o.section, `${o.label || ''} ${o.description || ''}`, []) === 'Windows')
    .map(o => ({ label: o.label, description: o.description, price: money(o.price) }));
}

function calculateTotals(estimate) {
  const labor = money(sumLines(estimate.labor));
  const materials = money(sumLines(estimate.materials));
  const subtotal = money(labor + materials);
  const markupPct = Number.isFinite(Number(estimate.markupPct)) ? Number(estimate.markupPct) : RULES.markupDefault;
  const markup = money(subtotal * markupPct / 100);
  return { labor, materials, subtotal, markupPct, markup, grandTotal: money(subtotal + markup) };
}

function buildHealth(estimate, analysis, q, adjustments, input) {
  const issues = [];
  if ((estimate.labor || []).some(isAlt) || (estimate.materials || []).some(isAlt)) {
    issues.push({ severity: 'BLOCK', code: 'ALTERNATIVE_IN_BASE_TOTAL', message: 'A mutually exclusive alternate is still inside base labor/materials.' });
  }
  if (windowRequested(input, analysis) && ![...(estimate.labor || []), ...(estimate.materials || [])].some(isWindowLine)) {
    issues.push({ severity: 'BLOCK', code: 'WINDOW_BASE_OPTION_MISSING', message: 'Windows were requested, but the selected base window option is not priced.' });
  }
  const normalized = adjustments.filter(a => a.type === 'LABOR_RATE_NORMALIZED').length;
  if (normalized) {
    issues.push({ severity: 'INFO', code: 'SELLING_RATES_CONVERTED_TO_COST', message: `${normalized} AI hourly rate(s) were converted to internal loaded-cost rates before markup.` });
  }
  return {
    status: issues.some(i => i.severity === 'BLOCK') ? 'BLOCKED' : 'PASS',
    issues,
    quantities: q,
    totals: calculateTotals(estimate),
    deterministicAdjustments: adjustments,
    checkedAt: new Date().toISOString(),
    version: 'deterministic-v2.3-cost-based'
  };
}

/* ── Rule: never bill a trade that the exclusions say is not included ──────────
   The estimator writes line items and exclusions independently, so an estimate can
   charge 25 hrs of plumbing while its own NOT INCLUDED list says plumbing rough-in
   is excluded. A customer who reads both loses trust immediately.
   Resolution: keep the WORK (it was priced deliberately) and drop the contradicting
   exclusion. Never silently delete revenue here. */
const EXCLUSION_TRADE_PATTERNS = [
  { kind: 'plumbing',    re: /\bplumb|\bpipe|\bdrain|\bwaste line|\bsupply line/i },
  { kind: 'electrical',  re: /\belectric|\bwiring|\boutlet|\bgfci|\bcircuit|\bpanel\b/i },
  { kind: 'tile',        re: /\btile|\bgrout|\bbacksplash/i },
  { kind: 'painting',    re: /\bpaint|\bprimer/i },
  { kind: 'flooring',    re: /\bflooring|\bhardwood|\blaminate|\bunderlayment/i },
  { kind: 'drywall',     re: /\bdrywall|\bsheetrock|\btaping/i },
  { kind: 'waterproofing', re: /\bwaterproof|\bkerdi|\bmembrane/i },
  { kind: 'windows',     re: /\bwindow/i },
  { kind: 'glazing',     re: /\bglass|\bshower door|\benclosure/i }
];

function billedTrades(estimate) {
  const set = {};
  (estimate.labor || []).forEach(l => {
    const t = norm(l.item);
    EXCLUSION_TRADE_PATTERNS.forEach(p => { if (p.re.test(t)) set[p.kind] = true; });
  });
  return set;
}

function reconcileExclusions(estimate, adjustments) {
  const billed = billedTrades(estimate);
  const kept = [];
  const dropped = [];
  (estimate.exclusions || []).forEach(x => {
    const t = norm(typeof x === 'string' ? x : (x && x.item) || '');
    /* An exclusion that carves out a LOCATION rather than a trade is legitimate even
       when we bill that trade ("flooring outside the bathroom", "work in other rooms"). */
    const locationCarveOut = /outside|other room|beyond|elsewhere|not in scope|another (room|area)/i.test(t);
    const conflict = !locationCarveOut && EXCLUSION_TRADE_PATTERNS.some(p => p.re.test(t) && billed[p.kind]);
    if (conflict) dropped.push(text(x)); else kept.push(x);
  });
  if (!dropped.length) return;
  estimate.exclusions = kept;
  adjustments.push({
    type: 'EXCLUSION_CONFLICT_REMOVED',
    removed: dropped,
    reason: 'These exclusions named trades that this estimate actually charges for. Charging for work the quote calls excluded is the fastest way to lose a customer.'
  });
}

/* ── Rule: no rough-in when the customer says fixtures stay put ────────────────
   "All plumbing keeps same locations" / "no relocation of plumbing or fixtures"
   means there is no rough-in to do. Connection, trim, set and test all remain. */
function capUnneededRoughIn(estimate, input, analysis, adjustments) {
  const ev = requestEvidence(input || {}, analysis || {});
  const staysPut = /(no|without)\s+(plumbing\s+)?(re-?rout|relocat)|same location|existing location|remain in (their|the) current location|keeps? same location/i.test(ev);
  if (!staysPut) return;
  const removed = [];
  estimate.labor = (estimate.labor || []).filter(l => {
    const t = norm(l.item);
    const isRoughIn = /rough[- ]?in/.test(t);
    const isTrade = /\bplumb|\belectric/.test(t);
    /* Keep anything that is connection / set / trim / test work. */
    const isConnection = /connect|trim|valve trim|set |install fixture|test|inspect/.test(t);
    if (isRoughIn && isTrade && !isConnection) { removed.push(text(l.item)); return false; }
    return true;
  });
  if (!removed.length) return;
  adjustments.push({
    type: 'ROUGH_IN_REMOVED_FIXTURES_STAY',
    removed,
    reason: 'The customer stated fixtures remain in their existing locations, so there is no rough-in scope. Connections, trim and testing were kept.'
  });
}

/* ── Rule: one selected service means ONE customer-facing service card ────────
   The estimator sections lines by TRADE (framing, drywall, painting, waterproofing).
   That is right for internal costing and wrong for the customer, because a single
   bathroom job then renders as six cards - Bathroom $19,642 plus Framing $1,605 plus
   Drywall $3,477 and so on - while the Bathroom card's own scope list already names
   that same framing and drywall work. The totals are correct, but it reads as being
   billed twice, which loses a correctly priced job.
   When the customer selected exactly one service, every line is filed under it.
   Alternatives keep their own section so options still render separately. */
function serviceTitle(v) {
  return text(v).replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function collapseSingleServicePresentation(estimate, analysis, input, adjustments) {
  const selected = (analysis && Array.isArray(analysis.selected_trades) ? analysis.selected_trades : [])
    .map(text).filter(Boolean);
  const requested = (input && input.request && Array.isArray(input.request.selectedServices)
    ? input.request.selectedServices : []).map(text).filter(Boolean);
  const list = selected.length ? selected : requested;
  if (list.length !== 1) return;                       // multi-service jobs keep their trade cards
  const target = serviceTitle(list[0]);
  if (!target) return;
  const movedFrom = {};
  ['labor', 'materials'].forEach(kind => {
    (estimate[kind] || []).forEach(l => {
      if (isAlt(l)) return;                            // alternatives stay separate
      const was = text(l.section);
      if (was === target) return;
      if (was) movedFrom[was] = (movedFrom[was] || 0) + 1;
      l.section = target;
    });
  });
  const names = Object.keys(movedFrom);
  if (!names.length) return;
  adjustments.push({
    type: 'SERVICE_CARDS_COLLAPSED',
    into: target,
    mergedSections: names,
    reason: 'The customer selected one service. Splitting it into trade cards duplicates the same work in the quote and reads as double billing.'
  });
}

/* ── Rule: never list the same supplied item twice ────────────────────────────
   "Vanity and sink" and "Vanity & sink" are the same thing to a customer. */
function dedupeCustomerSupplied(estimate, adjustments) {
  const key = v => norm(text(typeof v === 'string' ? v : (v && v.item) || ''))
    .replace(/\s*&\s*/g, ' and ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const seen = {};
  const out = [];
  let dropped = 0;
  (estimate.customerSupplied || []).forEach(x => {
    const k = key(x);
    if (!k) return;
    if (seen[k]) { dropped++; return; }
    seen[k] = true;
    out.push(x);
  });
  if (!dropped) return;
  estimate.customerSupplied = out;
  adjustments.push({ type: 'CUSTOMER_SUPPLIED_DEDUPED', dropped, reason: 'Same item listed more than once under different wording.' });
}

/* ══════════════════════════════════════════════════════════════════════════════
   CUSTOMER SCOPE LANGUAGE

   A homeowner does not read "Debris bagging, carrying to street level" and learn
   anything. They want to know: is the old bathroom taken out and taken away, is the
   shower waterproofed properly, who is buying the tile, and what could still cost
   extra. Internal task names are for the contractor's line items; the customer gets
   outcomes.

   This is deliberately deterministic - a fixed phrase per phase of work, chosen by
   what the estimate ACTUALLY prices. Not model prose, so it reads the same on every
   estimate and can never invent work that is not in the price.
   ═════════════════════════════════════════════════════════════════════════════ */
/* Each phase carries the bathroom voice and a generic one. A Flooring card that said
   "Remove the existing bathroom down to the substrate" would be worse than the raw task
   name it replaced, so the wording follows the service. */
const SCOPE_PHASES = [
  { key: 'protect',    re: /protect|setup|floor covering|dust barrier|masking/i,
    say: 'Protect your floors, hallways and adjacent finishes before any work starts' },
  { key: 'demo',       re: /demolition|demo\b|remove existing|tear ?out|strip/i,
    say: 'Remove the existing bathroom down to the substrate',
    generic: 'Remove the existing work and prepare the surfaces underneath' },
  { key: 'disposal',   re: /debris|dumpster|disposal|haul|carry|dump fee/i,
    say: 'Bag, carry out and legally dispose of all construction debris' },
  { key: 'framing',    re: /framing|metal stud|blocking|stud repair/i,
    say: 'Repair framing and add blocking where fixtures and grab bars will mount' },
  { key: 'substrate',  re: /drywall|cement board|backer|durock|sheetrock|substrate/i,
    say: 'Install new moisture-resistant wall and ceiling substrate',
    generic: 'Install and finish new wall and ceiling substrate' },
  { key: 'prep',       re: /surface prep|patch|spackle|skim coat|sand(ing)? (walls|surfaces)|caulk gaps/i,
    say: 'Patch, sand and prepare every surface before finishing',
    generic: 'Patch, sand and prepare every surface before finishing' },
  { key: 'waterproof', re: /waterproof|kerdi|membrane|schluter|redgard/i,
    say: 'Install a full waterproofing system in the shower and wet areas' },
  { key: 'plumbing',   re: /plumb|valve|rough-?in|supply line|drain|wax ring/i,
    say: 'Connect all plumbing and set your fixtures in their existing locations',
    generic: 'Complete all plumbing connections required by this work' },
  { key: 'electrical', re: /electric|wiring|gfci|outlet|light fixture|exhaust fan/i,
    say: 'Complete electrical connections for lighting, ventilation and outlets' },
  { key: 'tile',       re: /tile|grout|thinset|mortar/i,
    say: 'Install wall and floor tile with full grouting, sealing and finish work',
    generic: 'Install tile with full grouting, sealing and finish work' },
  /* Without these a Flooring, Painting or Windows card matched almost nothing and the
     customer got a one-line scope for a five-figure job — worse than the task names it
     replaced. Every service the engine can produce needs real phase coverage. */
  { key: 'subfloor',   re: /subfloor|underlayment|level(ing)? compound|floor prep/i,
    say: 'Prepare and level the subfloor before the new floor goes down',
    generic: 'Prepare and level the subfloor before the new floor goes down' },
  { key: 'flooring',   re: /engineered hardwood|hardwood|flooring install|install.*floor|laminate|vinyl plank|lvp/i,
    say: 'Install the new flooring throughout the included areas',
    generic: 'Install the new flooring, including cuts, fitting and finish details' },
  { key: 'trim',       re: /quarter.?round|baseboard|shoe mould|transition strip|threshold|casing|crown/i,
    say: 'Fit transitions, baseboard and trim so every edge is finished',
    generic: 'Fit transitions, baseboard and trim so every edge is finished' },
  { key: 'windows',    re: /window|sash|glazing bead|sill/i,
    say: 'Remove the existing windows, prepare the openings and install the new units',
    generic: 'Remove the existing windows, prepare the openings, install the new units and seal them weathertight' },
  { key: 'fixtures',   re: /vanity|toilet|faucet|shower trim|sink|shower kit|shower pan/i,
    say: 'Install and connect the vanity, toilet, faucet and shower fittings',
    generic: 'Install and connect every specified fixture and fitting' },
  { key: 'accessories',re: /grab bar|mirror|curtain bar|toilet paper|accessor|towel/i,
    say: 'Mount all bathroom accessories and hardware',
    generic: 'Mount all specified accessories and hardware' },
  { key: 'door',       re: /door|privacy lock|door stop|frame install/i,
    say: 'Install the new door, frame and hardware' },
  { key: 'paint',      re: /paint|primer|prime\b/i,
    say: 'Prime and paint all new wall and ceiling surfaces',
    generic: 'Prepare, prime and paint every included wall, ceiling, door and trim surface' },
  { key: 'cleanup',    re: /cleanup|clean-?up|final clean|touch-?up|protection removal/i,
    say: 'Clean the space daily and leave it finished, protected and ready to use' },
  { key: 'management', re: /coordination|supervision|project management|scheduling/i,
    say: 'Coordinate and supervise every trade, inspection and delivery' }
];

/* Exclusions a homeowner genuinely needs to see. Real risks and real money, in plain
   words - never boundary lines invented to separate one internal section from another. */
const STANDARD_EXCLUSIONS = [
  'Permits, filing and inspection fees, if your building or the city requires them',
  'Hidden conditions found behind walls or under the floor once demolition starts',
  'Mold, asbestos or lead remediation, if any is discovered',
  'Structural work beyond ordinary framing repair',
  'Heating, cooling or ventilation changes not listed above'
];

/* On a single-room job there is no "outside", so an exclusion that carves out a
   location is meaningless and reads as though work is being taken away. */
const LOCATION_CARVE_OUT = /outside|other room|another (room|area)|beyond (this|the) (room|bathroom|kitchen)|elsewhere/i;

/* filterSection: which lines to read ('' = every line). voice: which wording to use.
   On a collapsed single-bathroom job they differ — read everything, speak as Bathroom. */
function phasesPresent(estimate, filterSection, voice) {
  const hits = {};
  ['labor', 'materials'].forEach(kind => {
    (estimate[kind] || []).forEach(l => {
      if (filterSection && text(l.section) !== filterSection) return;
      if (isAlt(l)) return;
      const t = text(l.item);
      SCOPE_PHASES.forEach(p => { if (p.re.test(t)) hits[p.key] = true; });
    });
  });
  const bathroom = norm(voice === undefined ? filterSection : voice) === 'bathroom';
  return SCOPE_PHASES.filter(p => hits[p.key]).map(p => (bathroom ? p.say : (p.generic || p.say)));
}

function suppliedNames(estimate) {
  return (estimate.customerSupplied || [])
    .map(x => text(typeof x === 'string' ? x : (x && x.item) || ''))
    .filter(Boolean);
}

/* Rewrites the customer-facing scope into outcomes. Line items, quantities and
   prices are untouched - this only changes what the customer reads. */
function buildCustomerScope(estimate, analysis, adjustments) {
  const sections = [];
  const seen = {};
  ['labor', 'materials'].forEach(kind => {
    (estimate[kind] || []).forEach(l => {
      if (isAlt(l)) return;
      const sec = text(l.section) || 'General';
      if (!seen[sec]) { seen[sec] = true; sections.push(sec); }
    });
  });
  if (!sections.length) return;

  const single = sections.length === 1;
  const supplied = suppliedNames(estimate);

  /* Exclusions: keep the customer's own carve-outs and real risks, drop the
     internal boundary lines, then guarantee the standard risk list is present. */
  const keptExclusions = [];
  const droppedExclusions = [];
  (estimate.exclusions || []).forEach(x => {
    const t = text(typeof x === 'string' ? x : (x && x.item) || '');
    if (!t) return;
    if (single && LOCATION_CARVE_OUT.test(t)) { droppedExclusions.push(t); return; }
    if (/insurance|certificate of insurance|\bcoi\b/i.test(t)) { droppedExclusions.push(t); return; }
    keptExclusions.push(t);
  });
  /* Match by TOPIC, not by wording. "Structural modifications beyond minor metal stud
     framing repairs" and "Structural work beyond ordinary framing repair" are the same
     exclusion said twice, and a customer reading both assumes sloppiness. */
  const EXCLUSION_TOPICS = [
    { key: 'permit',     re: /permit|filing|expedit|inspection fee/i },
    { key: 'concealed',  re: /hidden|conceal|behind (the )?wall|under (the )?floor|unforeseen/i },
    { key: 'hazmat',     re: /mold|asbestos|lead\b|remediation/i },
    { key: 'structural', re: /structural/i },
    { key: 'hvac',       re: /hvac|ventilation|ductwork|heating|cooling/i }
  ];
  const topicOf = v => (EXCLUSION_TOPICS.find(t => t.re.test(text(v))) || {}).key || '';
  const covered = {};
  keptExclusions.forEach(x => { const t = topicOf(x); if (t) covered[t] = true; });
  STANDARD_EXCLUSIONS.forEach(x => {
    const t = topicOf(x);
    if (t && covered[t]) return;      // customer already has this risk covered
    if (t) covered[t] = true;
    keptExclusions.push(x);
  });
  estimate.exclusions = keptExclusions;

  /* Supplied items are the customer's money, so say so plainly and never price them. */
  const suppliedLine = supplied.length
    ? `You are supplying: ${supplied.join(', ')}. Installation is included in the price above; the cost of these items is not.`
    : '';

  estimate.serviceBreakdown = sections.map(sec => {
    const included = phasesPresent(estimate, single ? '' : sec, sec);
    return {
      title: sec,
      included,
      customerSupplies: supplied,
      notIncluded: keptExclusions,
      subtotal: 0,
      options: []
    };
  });
  if (suppliedLine) estimate.customerSuppliedNote = suppliedLine;

  adjustments.push({
    type: 'CUSTOMER_SCOPE_REWRITTEN',
    phases: estimate.serviceBreakdown[0] ? estimate.serviceBreakdown[0].included.length : 0,
    droppedExclusions,
    reason: 'Customer-facing scope now describes outcomes in plain language instead of internal task names. Location carve-outs removed on single-room jobs because there is no other location in scope.'
  });
}

/* ── LUMP MATERIAL LINES ARE THE PRICE BUG ────────────────────────────────────
   A material line written as "1 allowance x $4,200" is a number the model invented
   with nothing anchoring it. It cannot be checked against a real product price, the
   contractor cannot edit one item inside it, and the customer cannot be told what it
   buys. It is how a bathroom under 40 SF came back with $22,700 of materials while a
   competing app, given the identical description, itemised the same room at $549 for
   the vanity and $199 for the toilet and landed at a third of the price.

   The prompt now demands itemised products. This is the backstop, because prompt
   rules alone have failed three times in this codebase. A lump line is not deleted -
   deleting it would silently drop real scope - it is FLAGGED so it is visible in the
   dashboard and in validation, and capped at a defensible ceiling so one invented
   number cannot dominate the estimate. */
const LUMP_UNIT = /^\s*(allowance|lump\s*sum|ls|package|pkg|misc|miscellaneous|various|assorted)\s*$/i;
const LUMP_ITEM = /\b(allowance|and accessories|and sundries|misc\b|miscellaneous|package|assorted)\b/i;
/* Applies ONLY to lines lib/material-prices.js could not look up. A line with a
   real retail price attached is never touched — the price of a toilet is the
   price of a toilet, and no ceiling here may second-guess it. */
const LUMP_CEILING = 1500;

function flagLumpMaterials(estimate, adjustments) {
  (estimate.materials || []).forEach(m => {
    const unit = String((m && m.unit) || '');
    const qty = num(m.qty), rate = num(m.rate);
    const value = qty * rate;
    if (m.sbcPricedFrom) return;   /* priced from a real listing — leave it alone */
    const looksLump = LUMP_UNIT.test(unit) || (qty <= 1 && LUMP_ITEM.test(String(m.item || '')));
    if (!looksLump || value <= LUMP_CEILING) return;
    const was = rate;
    m.rate = money(LUMP_CEILING / (qty || 1));
    m.sbcLumpCapped = true;
    adjustments.push({
      type: 'LUMP_MATERIAL_CAPPED',
      item: text(m.item),
      section: text(m.section),
      fromRate: money(was),
      toRate: money(m.rate),
      reason: 'Un-itemised material line. Itemise it as real products with real quantities, then price each one.'
    });
  });
}

function applyDeterministicPricing(estimate, analysis, input) {
  const out = JSON.parse(JSON.stringify(estimate || {}));
  out.labor = Array.isArray(out.labor) ? out.labor : [];
  out.materials = Array.isArray(out.materials) ? out.materials : [];
  out.customerSupplied = Array.isArray(out.customerSupplied) ? out.customerSupplied : [];
  out.exclusions = Array.isArray(out.exclusions) ? out.exclusions : [];
  out.options = Array.isArray(out.options) ? out.options : [];
  if (!Number.isFinite(Number(out.markupPct))) out.markupPct = RULES.markupDefault;
  const adjustments = [];
  const q = extractQuantities(input || {}, analysis || {});
  /* ORDER MATTERS AND THIS IS THE ORDER.
     Ownership, then rates — so an alternative's raw cost is captured on the calibrated
     basis. Then isolateAlternatives lifts alternatives OUT of the base, so the markup is
     chosen from what the customer is actually buying. Neither option pricer needs the
     markup any more (both record rawCost), which is what finally allows the markup to be
     resolved from the FINAL direct cost, after every rule that adds or removes a line. */
  normalizeOwnership(out, analysis || {}, adjustments);
  flagLumpMaterials(out, adjustments);
  normalizeLaborRates(out, adjustments);
  isolateAlternatives(out, adjustments);
  removeOverlappingLabor(out, adjustments);
  capGeneralConditions(out, adjustments, input, analysis);
  capUnneededRoughIn(out, input || {}, analysis || {}, adjustments);
  ensureWindowOptionEngine(out, analysis || {}, input || {}, adjustments);
  normalizeOwnership(out, analysis || {}, adjustments);
  enforceProductionMinimum(out, 'painting', q.paintingSf ? q.paintingSf / RULES.paintingSfPerHour : 0, `${q.paintingSf} paintable SF ÷ ${RULES.paintingSfPerHour} SF/labor-hour`, adjustments);
  enforceProductionMinimum(out, 'flooring', q.flooringSf ? q.flooringSf / RULES.engineeredHardwoodSfPerHour : 0, `${q.flooringSf} flooring SF ÷ ${RULES.engineeredHardwoodSfPerHour} SF/labor-hour`, adjustments);
  enforceProductionMinimum(out, 'tile', q.tileSf ? q.tileSf / RULES.largeFormatTileSfPerHour : 0, `${q.tileSf} tile SF ÷ ${RULES.largeFormatTileSfPerHour} SF/labor-hour`, adjustments);
  collapseSingleServicePresentation(out, analysis || {}, input || {}, adjustments);
  dedupeCustomerSupplied(out, adjustments);
  /* Last, so it sees the final labor list after every other rule has run. */
  reconcileExclusions(out, adjustments);
  /* Every line that will ever exist now exists. Choose the markup from that number, then
     price the alternatives from the same one. */
  applyTieredMarkup(out, adjustments);
  priceAlternatives(out, adjustments);
  rebuildWindowSelections(out);
  out.deterministicPricing = {
    version: 'v2.3-cost-based',
    pricingBasis: 'Internal loaded labor cost + materials + one dashboard markup',
    quantities: q,
    adjustments
  };
  /* Runs last: the scope must describe the FINAL priced work, after every
     removal, collapse and reconciliation rule above has already run. */
  buildCustomerScope(out, analysis || {}, adjustments);
  out.estimateHealth = buildHealth(out, analysis || {}, q, adjustments, input || {});
  out.marketAudit = marketAudit(out, analysis || {}, input || {});
  return out;
}

function phraseKey(s) {
  return norm(s)
    .replace(/&/g, ' and ')
    .replace(/\b(sherwin\s*williams|sherwin-williams)\b/g, 'paintbrand')
    .replace(/\b(engineered\s+hardwood\s+flooring|engineered\s+hardwood|hardwood\s+flooring|flooring\s+material)\b/g, 'hardwood')
    .replace(/\b(sink\s*\/\s*vanity|vanity\s*\/\s*sink|vanity\s+and\s+sink|sink\s+and\s+vanity)\b/g, 'vanity sink')
    .replace(/\b(customer[- ]supplied|customer supplied|customer supplies|customer supply|by customer)\b/g, ' ')
    .replace(/\b(provide|provided|use|supply|supplied|install|installation|existing|new|all|the|for|with|work|item|materials?)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokenSet(s) { return new Set(phraseKey(s).split(' ').filter(x => x.length > 2)); }
function near(a, b) {
  const ka = phraseKey(a), kb = phraseKey(b);
  if (!ka || !kb) return ka === kb;
  if (ka === kb || ka.includes(kb) || kb.includes(ka)) return true;
  const A = tokenSet(a), B = tokenSet(b);
  if (!A.size || !B.size) return false;
  let common = 0;
  A.forEach(x => { if (B.has(x)) common++; });
  return common / Math.min(A.size, B.size) >= .68;
}
function dedupe(list) {
  const out = [];
  (list || []).map(x => text(typeof x === 'string' ? x : (x?.item || x?.label || x?.description || ''))).filter(Boolean).forEach(x => { if (!out.some(y => near(x, y))) out.push(x); });
  return out;
}

function isSingleBathroomProject(input) {
  const req = input?.request || {};
  const service = norm(req.service || '');
  const desc = norm(req.description || '');
  const bathroomPrimary = /bathroom/.test(service) || /full\s+gut\s+bathroom|bathroom\s+(?:renovation|remodel|upgrade)/.test(desc);
  if (!bathroomPrimary) return false;
  const outside = /(?:whole|entire|full)\s+(?:apartment|home|house).*paint|paint(?:ing)?\s+(?:the\s+)?(?:whole|entire|full)\s+(?:apartment|home|house)|bedroom|living\s+room|dining\s+room|engineered\s+hardwood|hardwood\s+floor|window\s+replacement|replace\s+windows|separate\s+pricing\s+for\s+(?:flooring|painting|windows?)/.test(desc);
  return !outside;
}

/* The card set is no longer a hardcoded four. It is the resolved service set,
   kept in vocabulary order, narrowed to the services that either the customer
   selected or that priced lines actually landed on. A service can appear here
   only if it survived the gate in canonicalService, so no card can exist for
   work the customer did not buy. */
function selectedCustomerServices(analysis, estimate, input, allowed) {
  if (isSingleBathroomProject(input)) return ['Bathroom'];
  const set = allowed || resolveServiceSet(analysis, input, estimate);
  const e = requestEvidence(input, analysis);
  const lines = [...(estimate.labor || []), ...(estimate.materials || [])]
    .map(x => canonicalService(x.section, x.item, set));
  const order = SERVICE_VOCAB.map(v => v.name);
  const candidates = set.filter(x => !CONTAINER_SERVICES.includes(x));
  /* Trade-specific special cases do not belong here. There was one for Windows
     (`x === 'Windows' && /window/.test(e)`) and it was dead code besides, because
     `candidates` is drawn from `set`, so `set.includes(x)` was already true for
     every candidate and the whole filter passed everything through. A service
     survives on the same terms as every other service: the customer asked for it,
     or a priced line belongs to it. */
  const keep = candidates.filter(x => set.includes(x) || lines.includes(x));
  const out = keep.length ? keep : candidates;
  return order.filter(x => out.includes(x));
}
function exclusionOwner(x, allowed) {
  const s = norm(x);
  const gated = Array.isArray(allowed) && allowed.length > 0;
  const ok = n => !gated || allowed.includes(n);
  if (/window|scaffold|rigging|exterior/.test(s) && ok('Windows')) return 'Windows';
  if (/mirror|glass panel|glass wall/.test(s) && ok('Mirrors & Glass')) return 'Mirrors & Glass';
  if (/furniture|assembl/.test(s) && ok('Furniture Assembly')) return 'Furniture Assembly';
  if (/paint|kitchen.*paint|tiled shower|skim coat|plaster/.test(s) && ok('Painting')) return 'Painting';
  if (/floor|underlayment|transition|baseboard|subfloor/.test(s) && ok('Flooring')) return 'Flooring';
  if (/bath|shower|plumb|fixture|vanity|toilet|glass|tile|waterproof|faucet/.test(s) && ok('Bathroom')) return 'Bathroom';
  if (/tile|grout|thinset/.test(s) && ok('Tile')) return 'Tile';
  return 'Project';
}
function supplyText(x) { return text(typeof x === 'string' ? x : (x?.item || x?.label || x?.description || '')); }
function supplySection(x, allowed) { return x && typeof x === 'object' ? canonicalService(x.section, x.item || x.label || x.description, allowed || []) : ''; }

function consolidateCustomerPresentation(estimate, analysis, input) {
  const out = estimate;
  const singleBath = isSingleBathroomProject(input);
  /* Resolved ONCE and handed to every classifier call below, so one estimate
     cannot be classified against two different service sets. */
  const allowed = resolveServiceSet(analysis, input, out);
  let services = selectedCustomerServices(analysis, out, input, allowed);
  if (!services.length) return out;
  const mm = 1 + (Number(out.markupPct) || RULES.markupDefault) / 100;
  const map = {};
  services.forEach(s => map[s] = { title: s, included: [], customerSupplies: [], notIncluded: [], subtotal: 0, options: [] });
  let generalBase = 0;
  const projectExclusions = [];
  (out.labor || []).forEach(l => {
    const s = singleBath ? 'Bathroom' : (pinnedService(l, allowed) || canonicalService(l.section, l.item, allowed));
    const cost = num(l.qty) * num(l.rate);
    /* COST ONLY. The wording comes from phasesPresent below. Pushing text(l.item) here
       is what silently threw away buildCustomerScope's plain-language scope and put
       "Debris bagging, carrying and disposal" back in front of the customer. */
    if (map[s]) { map[s].subtotal += cost; } else { generalBase += cost; }
  });
  (out.materials || []).forEach(m => {
    const s = singleBath ? 'Bathroom' : (pinnedService(m, allowed) || canonicalService(m.section, m.item, allowed));
    const cost = num(m.qty) * num(m.rate);
    if (map[s]) { map[s].subtotal += cost; } else { generalBase += cost; }
  });
  /* Outcomes, in the voice of the service. Falls back to the line items only if a
     service prices work that matches no phase at all, so a card is never left empty. */
  const fromPhases = {};
  services.forEach(s => {
    const said = phasesPresent(out, singleBath ? '' : s, singleBath ? 'Bathroom' : s);
    if (said.length) { map[s].included = said; fromPhases[s] = true; return; }
    [...(out.labor || []), ...(out.materials || [])].forEach(l => {
      const owner = singleBath ? 'Bathroom' : (pinnedService(l, allowed) || canonicalService(l.section, l.item, allowed));
      if (owner === s && !isAlt(l)) map[s].included.push(text(l.item));
    });
  });
  /* ══ A SERVICE THAT OWNS NO PRICED LINE IS NOT A SERVICE. ══════════════════
     One rule, every trade, forever. Not a keyword, not a ban list, not a prompt.

     Every phantom card this system has produced — Windows on a Pilates studio,
     Bathroom on a job with no bathroom — had the same shape: a card holding no
     labour line and no materials line. Upstream causes differ and new ones will
     appear as new trades are added. The shape does not. So the check is on the
     shape.

     It runs BEFORE the shared-cost split on purpose. Splitting first is what let
     an empty card walk away with half the money: with `direct` at zero the
     fallback share is 1/services.length, which funds every empty card equally.
     Money is now divided only among services that actually did work. */
  const ownsLines = {};
  services.forEach(s => ownsLines[s] = 0);
  [...(out.labor || []), ...(out.materials || [])].forEach(l => {
    const s = singleBath ? 'Bathroom' : (pinnedService(l, allowed) || canonicalService(l.section, l.item, allowed));
    if (ownsLines[s] !== undefined) ownsLines[s] += 1;
  });
  const dropped = services.filter(s => !ownsLines[s]);
  if (dropped.length && dropped.length < services.length) {
    dropped.forEach(s => { delete map[s]; });
    services = services.filter(s => ownsLines[s] > 0);
  }

  const direct = services.reduce((a, s) => a + map[s].subtotal, 0);
  if (generalBase > 0) {
    services.forEach(s => {
      const share = direct > 0 ? map[s].subtotal / direct : 1 / services.length;
      map[s].subtotal += generalBase * share;
    });
  }
  (out.customerSupplied || []).forEach(x => {
    const t = supplyText(x);
    if (!t) return;
    let s = singleBath ? 'Bathroom' : supplySection(x, allowed);
    if (!map[s]) {
      const low = norm(t);
      /* Was: `else s = 'Bathroom'`. An unrecognised customer-supplied item was
         dropped onto the Bathroom card even on jobs with no bathroom. It now
         goes to the one service on the job, or to the first card, never to a
         service picked out of the air. */
      const guess = canonicalService('', t, allowed);
      if (map[guess]) s = guess;
      else if (/paint/.test(low) && map['Painting']) s = 'Painting';
      else if (/hardwood|flooring|floor/.test(low) && map['Flooring']) s = 'Flooring';
      else if (/window/.test(low) && map['Windows']) s = 'Windows';
      else if (/mirror|glass/.test(low) && map['Mirrors & Glass']) s = 'Mirrors & Glass';
      else s = services[0];
    }
    if (map[s]) map[s].customerSupplies.push(t);
  });
  (out.exclusions || []).forEach(x => {
    const t = supplyText(x);
    if (!t) return;
    const owner = singleBath ? 'Bathroom' : exclusionOwner(t, allowed);
    if (map[owner]) map[owner].notIncluded.push(t); else projectExclusions.push(t);
  });
  (out.options || []).forEach(o => {
    const s = singleBath ? 'Bathroom' : canonicalService(o.section, `${o.label || ''} ${o.description || ''}`, allowed);
    if (!map[s]) return;
    const opt = { label: text(o.label) || 'Alternative', description: text(o.description), price: money(o.price) };
    map[s].options.push(opt);
    /* This note used to be printed for Windows and no other trade. An alternative
       is an alternative on every card. */
    map[s].notIncluded.push(`${opt.label}${opt.price ? ` — $${opt.price.toFixed(2)}` : ''} alternative (not included in current total)`);
  });
  services.forEach(s => {
    const v = map[s];
    v.included = dedupe(v.included);
    v.customerSupplies = dedupe(v.customerSupplies);
    v.notIncluded = dedupe(v.notIncluded).filter(x => !v.customerSupplies.some(y => near(x, y)));
    /* This filter existed to strip raw task names that were not about windows. Applied to
       outcome sentences it deletes "Protect your floors…" and "Clean the space daily…" and
       leaves the Windows card with one line, so it now runs only on the fallback wording. */
    /* Removed: a Windows-only keyword filter on `included`. Every card now keeps
       the wording its own lines produced. */
    v.subtotal = money(v.subtotal * mm);
  });
  out.serviceBreakdown = services.map(s => map[s]);
  out.projectExclusions = dedupe([...(out.projectExclusions || []), ...projectExclusions]);
  out.scopeSections = [];
  out.customerPresentationVersion = 'v9.0-deterministic-services';
  return out;
}

module.exports = { applyDeterministicPricing, consolidateCustomerPresentation };
