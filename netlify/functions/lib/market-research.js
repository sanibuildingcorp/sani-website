/* ============================================================================
   lib/market-research.js — live NYC pricing research
   ----------------------------------------------------------------------------
   WHY THIS EXISTS

   Zura's question, and it was the right one: when he asks Claude in chat what
   something costs in New York right now, Claude searches the web and comes back
   with current numbers. His estimator could not. It priced from two places only:

     - lib/nyc-market-benchmark.js, a static file someone has to maintain
     - whatever the model happened to learn during training

   Both go stale, and neither knows what porcelain tile or a vinyl double-hung
   actually costs this month. That is the real gap between a chat with Claude and
   the estimate his system produces.

   This module closes it. Before the estimate is priced, it runs one research
   pass with Anthropic's server-side web search tool and asks for current
   NYC-metro unit costs for the specific trades and materials in THIS job.

   PRECEDENCE — this is the part that matters

   Live research is ADVISORY. It informs the estimate; it never sets it. Order of
   authority, highest first:

     1. HOUSE RULES         — Zura's own rates. Always win. Nothing overrides them.
     2. SANI_ACTUALS        — what his completed jobs really cost.
     3. LIVE RESEARCH       — this module. Current market, but scraped and fallible.
     4. STATIC BENCHMARK    — nyc-market-benchmark.js, the floor of last resort.

   A number from a web page can be a national average, a retail sticker, a
   marketing page, or simply wrong. So every finding passes a sanity gate before
   it is allowed near the prompt, and the prompt itself is told plainly that
   these are reference points, not instructions.

   FAILURE IS FREE. If search is unavailable, times out, returns nothing usable,
   or the JSON is malformed, this returns null and the estimate is built exactly
   the way it is built today. Nothing about the existing pipeline depends on it.
   ========================================================================== */

'use strict';

/* One search pass. Enough to cover a multi-trade job, bounded so a runaway
   research call cannot eat the estimate's time budget. */
const MAX_SEARCHES = 6;
const MAX_FINDINGS = 24;
const RESEARCH_TOKENS = 8000;

/* Absolute plausibility bounds per unit. These are not pricing opinions — they
   are the outer edge of "a human contractor could believe this". Anything
   outside is a scrape error: a phone number read as a price, a whole-project
   figure filed as a unit cost, a cent-denominated value. */
const UNIT_BOUNDS = {
  sf:    [0.25, 400],      // per square foot
  lf:    [0.5, 600],       // per linear foot
  hr:    [15, 400],        // per hour, contractor cost basis
  ea:    [1, 25000],       // each — a window, a vanity, a door
  day:   [200, 5000],
  ls:    [50, 250000],     // lump sum / allowance
  gal:   [10, 400],
  box:   [5, 800],
  roll:  [5, 800],
  sheet: [5, 500]
};

function str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }
function clean(v) { return str(v).replace(/\s+/g, ' ').trim(); }
function num(v) {
  const n = Number(String(v == null ? '' : v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

function normUnit(u) {
  const s = clean(u).toLowerCase().replace(/[^a-z]/g, '');
  if (/^(sf|sqft|squarefoot|squarefeet|persf)$/.test(s)) return 'sf';
  if (/^(lf|linearfoot|linearfeet|perlf)$/.test(s)) return 'lf';
  if (/^(hr|hour|hours|manhour|mh|perhour)$/.test(s)) return 'hr';
  if (/^(ea|each|unit|piece|pc|pcs)$/.test(s)) return 'ea';
  if (/^(day|daily|perday)$/.test(s)) return 'day';
  if (/^(ls|lumpsum|allowance|job|project)$/.test(s)) return 'ls';
  if (/^(gal|gallon|gallons)$/.test(s)) return 'gal';
  if (/^(box|bx)$/.test(s)) return 'box';
  if (/^(roll|rl)$/.test(s)) return 'roll';
  if (/^(sheet|sht|panel)$/.test(s)) return 'sheet';
  return '';
}

/* ---------------------------------------------------------------------------
   The sanity gate. Nothing reaches the estimator that fails this.
--------------------------------------------------------------------------- */
function gateFinding(f) {
  if (!f || typeof f !== 'object') return null;

  const item = clean(f.item);
  const trade = clean(f.trade);
  const unit = normUnit(f.unit);
  if (!item || !unit) return null;

  let low = num(f.low);
  let high = num(f.high);

  /* A single figure is usable; treat it as a point, not a range. */
  if (!Number.isFinite(low) && Number.isFinite(high)) low = high;
  if (!Number.isFinite(high) && Number.isFinite(low)) high = low;
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;

  if (low > high) { const t = low; low = high; high = t; }
  if (low <= 0) return null;

  const bounds = UNIT_BOUNDS[unit];
  if (!bounds) return null;
  if (low < bounds[0] || high > bounds[1]) return null;

  /* A "range" spanning two orders of magnitude tells the estimator nothing and
     usually means two unrelated figures were merged. */
  if (high / low > 12) return null;

  return {
    trade: trade || 'General',
    item,
    unit,
    low: Math.round(low * 100) / 100,
    high: Math.round(high * 100) / 100,
    basis: clean(f.basis).slice(0, 120),
    source: clean(f.source).slice(0, 160)
  };
}

function gateAll(list) {
  const out = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach(f => {
    const g = gateFinding(f);
    if (!g) return;
    const k = (g.trade + '|' + g.item + '|' + g.unit).toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(g);
  });
  return out.slice(0, MAX_FINDINGS);
}

/* ---------------------------------------------------------------------------
   What we ask the web for. Specific to THIS job — a generic "what does
   renovation cost" search returns national averages and helps nobody.
--------------------------------------------------------------------------- */
function buildResearchPrompt(analysis, input) {
  const req = (input && input.request) || {};
  const trades = ((analysis && analysis.selected_trades) || []).map(clean).filter(Boolean);
  const scope = ((analysis && analysis.confirmed_scope) || []).map(r => ({
    trade: clean(r && r.trade),
    items: (r && r.scope_items || []).map(clean).slice(0, 12),
    quantities: (r && r.quantities) || {}
  }));

  return `You are a construction cost researcher for a New York City renovation contractor. Today is ${new Date().toISOString().slice(0, 10)}.

Use web search to find CURRENT unit costs for the specific work below, in the New York City metro area. Search for what a CONTRACTOR pays — subcontract package rates, supply-house and big-box material prices — not what a homeowner is quoted retail.

THE JOB
${JSON.stringify({ address: clean(req.address), service: clean(req.service), description: clean(req.description).slice(0, 2000) }, null, 2)}

TRADES ON THIS JOB
${JSON.stringify(trades, null, 2)}

CONFIRMED SCOPE AND QUANTITIES
${JSON.stringify(scope, null, 2)}

WHAT TO RESEARCH
- For each trade, the installed labor rate or production rate in NYC right now.
- For each named material — tile, flooring, paint, windows, mirror glass, fixtures — the current NYC price at the relevant size and grade. If the customer named a product or brand, price THAT product.
- Anything unusual in this job where a stale number would be badly wrong.

Run at most ${MAX_SEARCHES} searches. Prefer supplier and supply-house pricing, trade publications, and current contractor cost data. Ignore lead-generation sites that publish only wide national ranges.

RULES
- Report the NYC metro figure. If you can only find a national figure, say so in "basis" and do not silently present it as local.
- Give a realistic low and high, not a spread so wide it is useless.
- If you cannot find a credible current figure for something, LEAVE IT OUT. An omission is fine; a guess dressed as research is not.
- Never invent a source.

Return JSON only, no markdown fence:
{
  "findings": [
    { "trade": "Painting", "item": "Interior repaint, walls and ceilings, two coats", "unit": "sf", "low": 2.4, "high": 3.2, "basis": "NYC metro, contractor cost basis, labor only", "source": "<site or publication>" }
  ],
  "notes": "<one sentence on anything the estimator should treat with caution, or empty>"
}

Allowed "unit" values: sf, lf, hr, ea, day, ls, gal, box, roll, sheet.`;
}

/* ---------------------------------------------------------------------------
   The block handed to the estimator. Tone is deliberate: reference, not order.
--------------------------------------------------------------------------- */
function buildResearchBlock(research) {
  if (!research || !research.findings || !research.findings.length) return '';
  const rows = research.findings
    .map(f => `  - [${f.trade}] ${f.item}: $${f.low}–$${f.high} per ${f.unit}${f.basis ? ` (${f.basis})` : ''}${f.source ? ` — ${f.source}` : ''}`)
    .join('\n');

  return `\n\nCURRENT MARKET PRICING, RESEARCHED TODAY (${research.asOf})
These figures were looked up on the web for this specific job. Use them to sanity-check your own numbers — especially for materials, where prices move.

${rows}${research.notes ? `\n\n  Caution: ${research.notes}` : ''}

HOW MUCH WEIGHT TO GIVE THIS
- Sani's own HOUSE RULES above outrank every figure here. If a house rule covers an item, use the house rule and ignore the researched number entirely.
- Sani's completed-job actuals outrank these figures too.
- These are market reference points, not instructions. They are scraped from the open web and can be a national average, a retail sticker, or simply wrong. If a figure contradicts what you know about NYC contractor pricing, trust your judgment and price accordingly.
- Do NOT add a line item just because it appears in this list. Price the job that was requested.`;
}

/* ---------------------------------------------------------------------------
   Entry point. `searchCall(prompt, maxTokens)` must be a function that calls the
   model WITH the web search tool enabled and resolves to its text.
   Returns a research object, or null — and null is a completely normal outcome.
--------------------------------------------------------------------------- */
async function researchMarketPricing(analysis, input, searchCall, parseJson) {
  if (typeof searchCall !== 'function') return null;
  const trades = (analysis && analysis.selected_trades) || [];
  if (!trades.length) return null;

  try {
    const raw = await searchCall(buildResearchPrompt(analysis, input), RESEARCH_TOKENS);
    const parsed = typeof parseJson === 'function' ? parseJson(raw, 'market research') : JSON.parse(raw);
    const findings = gateAll(parsed && parsed.findings);
    if (!findings.length) return null;
    return {
      findings,
      notes: clean(parsed && parsed.notes).slice(0, 300),
      asOf: new Date().toISOString().slice(0, 10),
      version: 'market-research-v1',
      accepted: findings.length,
      rejected: Math.max(0, ((parsed && parsed.findings) || []).length - findings.length)
    };
  } catch (err) {
    /* Research is a bonus pass. Losing it costs nothing; letting it throw would
       cost the whole estimate. */
    console.error('market research skipped:', err && err.message ? err.message : err);
    return null;
  }
}

module.exports = {
  researchMarketPricing,
  buildResearchPrompt,
  buildResearchBlock,
  gateFinding,
  gateAll,
  normUnit,
  MAX_SEARCHES,
  UNIT_BOUNDS
};
