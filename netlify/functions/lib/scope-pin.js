// netlify/functions/lib/scope-pin.js
//
// PIN THE JOB. RE-PRICE IT. DO NOT RE-DECIDE IT.
//
// The complaint that produced this file:
//
//   "i don't know why it's makes so big difference between previous
//    generations and this last generation"
//
// Same customer, same request, nothing changed. First run: "Bathroom Ceiling
// Water-Damage Repair", $3,710.55 — inspect the leak, patch the ceiling, paint.
// Second run: "Bathroom RENOVATION with Ceiling Water-Damage Repair",
// $20,895.25 — demolition, 70 sq ft of wall tile, a new vanity, a new toilet.
//
// The prices did not drift. THE JOB CHANGED. The customer had written "my
// bathroom is old and there's water coming through the ceiling", which honestly
// supports both readings, and nothing in the system chose between them and held
// on to the choice.
//
// The generate function stores its answer on the record as projectAnalysis —
// and never reads it back. So every press of Regenerate re-asks "what job is
// this?" from scratch, and on an ambiguous sentence it can answer differently
// every time. That is the whole mechanism.
//
// So: the analysis is pinned. Regenerate re-prices THE SAME JOB. Re-deciding
// what the job is becomes a separate, deliberate act with its own button.
//
// ══ WHAT MUST STILL BREAK THE PIN ═══════════════════════════════════════════
// A pin that ignored new information would be worse than the problem it solves:
// a customer answers the question that was blocking the estimate, and the
// estimate carries on pretending they never spoke. So the pin is keyed to the
// INPUT it was derived from. Anything that changes what the customer or the
// contractor said — a new reply in the thread, an edited description, a
// different set of services, a note typed into the extra-request box — makes
// the pin stale, and the job is read again automatically.
//
// The pin is therefore not "never re-analyse". It is "re-analyse when something
// was actually said, not merely because a button was pressed twice".

"use strict";

/* Deterministic JSON: same content, same string, whatever order the keys
   happen to be in. JSON.stringify preserves insertion order, and two records
   carrying identical information can easily have been built in a different
   order — which would look like a change and re-read the job for nothing. */
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map(function (k) {
    return JSON.stringify(k) + ":" + stableStringify(value[k]);
  }).join(",") + "}";
}

function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/* THE PARTS OF THE INPUT THAT DECIDE WHAT THE JOB IS.
   buildProjectAnalysisPrompt embeds the whole `input` object, so in principle
   everything counts — but a corrected phone number is not a change of scope,
   and re-reading the job because someone fixed a typo in an email address would
   reintroduce exactly the surprise this file exists to remove.
   The address stays in: it feeds site conditions, walk-up and parking. */
function scopeInputs(input) {
  const i = input || {};
  const req = i.request || {};
  const con = i.contractor || {};
  return {
    address: String((i.customer || {}).address || ""),
    service: req.service,
    selectedServices: req.selectedServices,
    propertyType: req.propertyType,
    timeline: req.timeline,
    sqft: req.sqft,
    description: req.description,
    groupedAnswers: req.groupedAnswers,
    customerSupplies: req.customerSupplies,
    photoAnalysis: req.photoAnalysis,
    conversation: req.conversation,
    extraRequest: con.extraRequest,
    houseRules: con.houseRules,
  };
}

/* A short, stable name for one exact set of scope inputs. Two generations that
   share this string were asked the same question about the same job. */
function scopeFingerprint(input) {
  return "sc1-" + djb2(stableStringify(scopeInputs(input)));
}

/* ── WHY A GENERATION IS OR IS NOT ALLOWED TO REUSE THE PINNED JOB ────────── */
const REASONS = {
  NO_PIN: "no pinned scope on this record yet — reading the job for the first time",
  ASKED: "you asked to re-read the job from scratch",
  CHANGED: "the request changed since the scope was pinned — reading it again",
  TOGGLES: "the inputs to the estimate were switched on or off — reading it again",
  PINNED: "re-pricing the same job that was pinned before",
};

/**
 * Decide whether this generation may reuse the job definition already on the
 * record, or has to work it out again.
 *
 * @param {object} record  the stored record
 * @param {object} input   what buildEstimatorInput() produced for THIS run
 * @param {object} body    the request body (reanalyze, useDescription, ...)
 * @returns {{reuse:boolean, analysis:(object|null), reason:string, fingerprint:string, storedFingerprint:(string|null)}}
 */
function resolveScopePin(record, input, body) {
  const rec = record || {};
  const req = body || {};
  const fingerprint = scopeFingerprint(input);
  const stored = typeof rec.scopeFingerprint === "string" ? rec.scopeFingerprint : null;
  const analysis = rec.projectAnalysis && typeof rec.projectAnalysis === "object" ? rec.projectAnalysis : null;

  const out = { reuse: false, analysis: null, reason: "", fingerprint: fingerprint, storedFingerprint: stored };

  /* An explicit "re-read the job" always wins, and is the only way to get a
     different reading out of an unchanged request. */
  if (req.reanalyze === true) { out.reason = REASONS.ASKED; return out; }

  /* Nothing pinned: either a first generation, or a record written before this
     existed. Read the job, then pin it. */
  if (!analysis || !stored) { out.reason = REASONS.NO_PIN; return out; }

  /* Something was actually said. The pin is stale and MUST be replaced — a
     customer who answers the question that was blocking their estimate has to
     see that answer change the estimate. */
  if (stored !== fingerprint) { out.reason = REASONS.CHANGED; return out; }

  out.reuse = true;
  out.analysis = analysis;
  out.reason = REASONS.PINNED;
  return out;
}

module.exports = {
  scopeFingerprint,
  scopeInputs,
  resolveScopePin,
  stableStringify,
  REASONS,
};
