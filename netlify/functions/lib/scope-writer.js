/* ============================================================================
   lib/scope-writer.js — writes the customer-facing scope of work
   ----------------------------------------------------------------------------
   WHY THIS EXISTS

   Until now the "Included" bullets on every customer quote came from
   SCOPE_PHASES in lib/deterministic-pricing.js: a hardcoded library of about
   sixteen pre-written sentences. The code regex-matched the priced line items
   against that library and printed whichever canned sentence hit.

       line item contains "tile"  ->  "Install wall and floor tile with full
                                       grouting, sealing and finish work"

   Two consequences, both fatal to the product:

   1. The scope never described the actual job. It could not say "24x48 matte
      travertine-look porcelain, installed vertically on three shower walls:
      valve wall 29" x 96", back wall 50.5" x 96", storage wall 28" x 96"",
      because it never read the customer's request. It matched a keyword.

   2. The library only covered bathroom, flooring, painting, windows and a
      handful of adjacent trades. A mirror install, furniture assembly, a deck,
      a staircase, a roof, a commercial fit-out matched almost nothing, so those
      jobs got a one-line scope or the raw internal task names. Sani prices work
      across every trade; the scope writer only knew four.

   THIS MODULE

   Runs AFTER pricing is final. It never touches money. It takes the finished
   estimate plus the project analysis and asks the model to write, per service,
   the paragraph a customer actually reads — real quantities, real dimensions,
   real materials, who supplies what, and what is deliberately left out.

   Then deterministic code enforces the parts a prompt cannot be trusted to hold
   (Law 3 — this codebase has been burned twice by prompt-only rules):

     - every priced service gets bullets, or the canned library fills that one in
     - no bullets for a service that is not on the estimate
     - no invented dollar figures inside the scope text
     - the word "licensed" and any licensing claim is stripped
     - bullets are trimmed to a readable length and de-duplicated
     - a failure here NEVER costs the estimate: any throw falls back to the
       existing phrase library, which is exactly what shipped before

   The pricing engine is untouched by design.
   ========================================================================== */

'use strict';

const MIN_BULLETS = 3;
const MAX_BULLETS = 8;
const MAX_BULLET_CHARS = 260;

/* Licensing claims are banned sitewide until Zura says otherwise. A prompt rule
   is not enough — this is the backstop. */
const LICENSE_RE = /\b(licen[sc]e[sd]?|licensing|licen[sc]ure)\b/gi;

/* The model must not put prices in the prose. Prices live in the price column,
   and a figure written into a sentence cannot be edited in the dashboard, so it
   silently contradicts the number beside it the moment the contractor adjusts a
   total. */
const MONEY_RE = /\$\s?\d[\d,]*(\.\d{1,2})?/g;

/* TV RULE — standing mandate: Sani does not offer TV mounting and it must not
   appear anywhere, on the site or on a document. A bullet that offers it is not
   softened, it is DROPPED: rewording it would leave a sentence describing work
   that will not happen. Caught by the harness — the model produced exactly this
   line when asked to misbehave, with the ban written plainly in the prompt.
   Prompt rules do not hold; this is the backstop. */
const TV_RE = /\btv\b|\btelevision\b|\bflat[- ]?screen\b|\bmonitor mount\b/i;

/* Marketing filler the prompt bans and the model reaches for anyway. Stripped
   rather than dropped — the sentence underneath is usually fine. */
const PUFFERY_RE = /\b(top[- ]?(quality|notch)|high[- ]?quality|state[- ]?of[- ]?the[- ]?art|best[- ]in[- ]class|premium quality|world[- ]class|superior quality)\b/gi;

function str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }
function clean(v) { return str(v).replace(/\s+/g, ' ').trim(); }
function norm(v) { return clean(v).toLowerCase(); }

function stripBanned(t) {
  return clean(
    str(t)
      .replace(LICENSE_RE, 'insured')
      .replace(MONEY_RE, '')
      .replace(PUFFERY_RE, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,.;:])/g, '$1')
  );
}

/* A bullet that survives stripping can still be one we must not print at all. */
function bannedOutright(t) { return TV_RE.test(str(t)); }

/* Two bullets that say the same thing in different words are worse than one:
   the customer reads it as padding. Compare on content words only. */
function contentKey(t) {
  return norm(t)
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !/^(the|and|for|with|will|that|this|from|into|your|all|any|are|new|per|its)$/.test(w))
    .sort()
    .join(' ');
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  (list || []).forEach(x => {
    const t = clean(x);
    if (!t) return;
    const k = contentKey(t);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(t);
  });
  return out;
}

function tidyBullet(t) {
  if (bannedOutright(t)) return '';
  let s = stripBanned(t);
  if (!s) return '';
  s = s.replace(/^[-•*\d.)\s]+/, '');           // model sometimes re-adds its own bullet glyph
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (s.length > MAX_BULLET_CHARS) {
    const cut = s.slice(0, MAX_BULLET_CHARS);
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(', '), cut.lastIndexOf(' '));
    s = (stop > 60 ? cut.slice(0, stop) : cut).replace(/[,;:\s]+$/, '');
  }
  if (!/[.!?]$/.test(s)) s += '.';
  return s;
}

/* ---------------------------------------------------------------------------
   What the model is shown. Everything it needs to describe the work, and
   nothing about internal cost — rates and markup are none of the scope's
   business, and putting them in the prompt invites them into the prose.
--------------------------------------------------------------------------- */
function servicePayload(estimate, serviceName) {
  const pick = (arr) => (arr || [])
    .filter(l => norm(l && l.section) === norm(serviceName))
    .map(l => ({
      item: clean(l.item),
      qty: Number(l.qty) || 0,
      unit: clean(l.unit)
    }))
    .filter(l => l.item);

  return {
    service: serviceName,
    priced_labor_tasks: pick(estimate.labor),
    priced_materials: pick(estimate.materials)
  };
}

function tradeScopeFromAnalysis(analysis, serviceName) {
  const rows = (analysis && analysis.confirmed_scope) || [];
  const hit = rows.filter(r => {
    const t = norm(r && r.trade);
    const s = norm(serviceName);
    return t && s && (t === s || t.includes(s) || s.includes(t));
  });
  const items = [];
  const exclusions = [];
  const quantities = {};
  hit.forEach(r => {
    (r.scope_items || []).forEach(x => items.push(clean(x)));
    (r.customer_exclusions || []).forEach(x => exclusions.push(clean(x)));
    Object.assign(quantities, r.quantities || {});
  });
  return { items: items.filter(Boolean), exclusions: exclusions.filter(Boolean), quantities };
}

function buildScopePrompt(estimate, analysis, input) {
  const services = (estimate.serviceBreakdown || [])
    .map(s => clean(s && (s.title || s.name || s.section)))
    .filter(Boolean);

  const perService = services.map(name => ({
    ...servicePayload(estimate, name),
    ...tradeScopeFromAnalysis(analysis, name)
  }));

  const req = (input && input.request) || {};

  return `You are writing the SCOPE OF WORK section of a construction estimate for Sani Building Corp, a New York City renovation and repair contractor. This document goes straight to the paying customer.

You are NOT pricing anything. The prices are already final. Your only job is to describe the work in plain, specific, professional language.

THE CUSTOMER'S OWN REQUEST
${JSON.stringify({
  description: clean(req.description),
  service: clean(req.service),
  address: clean(req.address),
  answers: req.answers || req.questionAnswers || {}
}, null, 2)}

WHAT THE ANALYST CONFIRMED, AND WHAT IS PRICED, PER SERVICE
${JSON.stringify(perService, null, 2)}

PROJECT-WIDE QUANTITIES
${JSON.stringify((analysis && analysis.quantities) || {}, null, 2)}

SITE CONDITIONS
${JSON.stringify((analysis && analysis.site_conditions) || {}, null, 2)}

WRITE, FOR EACH SERVICE LISTED ABOVE:

"included" — ${MIN_BULLETS} to ${MAX_BULLETS} bullets describing what Sani will actually do, in order of how the work happens.
  - Use the REAL numbers wherever the data gives them: square footage, linear feet, dimensions, room names, fixture counts, floor level, tile size and finish, paint coats, product names the customer named.
  - Name locations. "Three shower walls: valve wall 29 x 96, back wall 50.5 x 96, storage wall 28 x 96" beats "tile the shower".
  - Say who supplies what. If the customer is supplying a material, write "owner-supplied" and name it.
  - Cover preparation, protection, the work itself, and cleanup — but only where those are genuinely priced for this service.
  - Write to a smart adult who is not a builder. No trade jargon without a plain-language anchor. No marketing adjectives. No "high-quality", "top-notch", "state-of-the-art".
  - One idea per bullet. Full sentences.

"notIncluded" — 0 to 4 bullets, ONLY where there is a real limit worth stating.
  - Anything the customer themselves said to leave out belongs here, in wording close to theirs and as a COMPLETE thought. Never a fragment: "except the tiled shower walls" alone reads as excluding the whole bathroom.
  - Real boundaries of this service. Do not repeat project-wide items like permits or concealed conditions — those are stated once at the foot of the quote.
  - Leave the array empty rather than inventing a limit.

HARD RULES
- Never write a dollar amount, a rate, an hourly figure or a percentage anywhere.
- Never write "licensed", "licence", or any licensing claim. Sani is insured; say insured if it is relevant at all.
- Never mention TV mounting.
- Never invent work that is not in the priced tasks or the confirmed scope. If the data is thin, write fewer bullets — do not pad.
- Never name another contractor, or a competitor's product, unless the customer named it first.
- Use the exact service names given above as keys. Do not rename, merge, split or add services.

Return JSON only. No preamble, no markdown fence:
{
  "services": [
    { "service": "<exact name from above>", "included": ["..."], "notIncluded": ["..."] }
  ],
  "timeline": "<one short sentence the customer reads about duration and scheduling, or empty string>"
}`;
}

/* ---------------------------------------------------------------------------
   Enforcement. The prompt above asks for all of this; none of it is trusted.
--------------------------------------------------------------------------- */
function applyScopeToEstimate(estimate, written, fallbackFor) {
  const cards = estimate.serviceBreakdown || [];
  const byName = {};
  (written && written.services ? written.services : []).forEach(s => {
    const k = norm(s && s.service);
    if (k) byName[k] = s;
  });

  let usedAi = 0, usedFallback = 0;

  cards.forEach(card => {
    const name = clean(card.title || card.name || card.section);
    const got = byName[norm(name)];

    let included = dedupe((got && Array.isArray(got.included) ? got.included : []).map(tidyBullet)).slice(0, MAX_BULLETS);
    const notIncluded = dedupe((got && Array.isArray(got.notIncluded) ? got.notIncluded : []).map(tidyBullet)).slice(0, 4);

    /* A card with too little to say falls back to whatever the old phrase
       library produced for it. Never leave a priced service with an empty or
       one-line scope — that is worse than the canned wording it replaced. */
    if (included.length < MIN_BULLETS) {
      const prior = Array.isArray(card.included) ? card.included.filter(Boolean) : [];
      if (prior.length >= included.length) {
        included = dedupe(prior.map(tidyBullet)).slice(0, MAX_BULLETS);
        usedFallback++;
      } else {
        usedAi++;
      }
    } else {
      usedAi++;
    }

    card.included = included;

    /* The writer's exclusions ADD to what the pipeline already parked there —
       customer_exclusions extracted upstream must not be thrown away. */
    const existing = Array.isArray(card.notIncluded) ? card.notIncluded.map(tidyBullet) : [];
    card.notIncluded = dedupe(existing.concat(notIncluded)).slice(0, 6);
  });

  const tl = stripBanned(written && written.timeline);
  if (tl && tl.length > 8) estimate.customerTimeline = tl;

  estimate.scopeWriter = {
    version: 'scope-writer-v1',
    servicesWritten: usedAi,
    servicesFallback: usedFallback,
    at: new Date().toISOString()
  };
  if (fallbackFor) estimate.scopeWriter.note = fallbackFor;
  return estimate;
}

/* ---------------------------------------------------------------------------
   Entry point. `call` is injected so this module stays free of transport and
   can be executed directly in a test harness.
     call(prompt, maxTokens) -> Promise<string>
--------------------------------------------------------------------------- */
async function writeCustomerScope(estimate, analysis, input, call, parseJson) {
  if (!estimate || !Array.isArray(estimate.serviceBreakdown) || !estimate.serviceBreakdown.length) return estimate;
  if (typeof call !== 'function') return estimate;

  try {
    const raw = await call(buildScopePrompt(estimate, analysis, input), 8000);
    const written = typeof parseJson === 'function' ? parseJson(raw, 'customer scope') : JSON.parse(raw);
    return applyScopeToEstimate(estimate, written, null);
  } catch (err) {
    /* The estimate is already complete and correctly priced by the time we get
       here. A scope-writing failure must never cost the contractor that work —
       keep the phrase-library wording and record why. */
    console.error('scope writer failed, keeping phrase-library scope:', err && err.stack ? err.stack : err);
    return applyScopeToEstimate(estimate, null, String((err && err.message) || err).slice(0, 200));
  }
}

module.exports = {
  writeCustomerScope,
  bannedOutright,
  buildScopePrompt,
  applyScopeToEstimate,
  tidyBullet,
  dedupe,
  stripBanned,
  MIN_BULLETS,
  MAX_BULLETS
};
