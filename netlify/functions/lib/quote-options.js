// netlify/functions/lib/quote-options.js
//
// THE ALTERNATIVES THE CUSTOMER CAN ACTUALLY CHOOSE.
//
// An estimate can carry priced alternatives — "Option A — NY State Article 32
// assessment and containment, $3,850", "Option C — camera inspection, $675".
// They were printed on the quote as read-only rows: a price with no way to say
// yes. A customer who wanted one had to write a message and wait, and most
// simply did not.
//
// Two rules govern this file, and both exist because this is money the customer
// adds to their own bill:
//
//   1. AN OPTION IS IDENTIFIED, NOT MATCHED. Every option gets a stable id
//      derived from its label. The browser sends ids back; the
//      server re-derives them from its own copy of the record and takes the
//      price from THERE. A price that arrives from a browser is never the price
//      that is charged.
//
//   2. THE CEILING IS THE SUM OF WHAT WAS ACTUALLY CHOSEN. quote-response
//      already refused a total below the quote. That is only half a rule: it
//      would have accepted the quote plus a million dollars. The customer may
//      raise their total by exactly the options they selected and by nothing
//      else.

"use strict";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function norm(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim();
}

/* A stable id for one option, derived from its LABEL AND NOTHING ELSE.
   Content-derived because there is nowhere to stamp an id on the thousands of
   records that already exist, and both sides have to reach the same id from the
   same record with no coordination.

   The section is deliberately NOT part of it. quote.html files an option under
   the service its own trade() logic picks; this file reads the section straight
   off serviceBreakdown. Those two disagree often enough that including the
   section would have produced ids the server could not resolve — and an
   unresolved id is not a visible error, it is an option the customer ticked,
   paid for on screen, and did not get charged for or receive. Money, silently.

   The 32-bit suffix keeps two long labels sharing their first 40 characters
   from collapsing into one id. */
function optionId(label) {
  const basis = norm(label);
  let h = 5381;
  for (let i = 0; i < basis.length; i++) h = ((h << 5) + h + basis.charCodeAt(i)) >>> 0;
  const slug = basis.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return "opt-" + (slug || "x") + "-" + h.toString(36);
}

/* Which option letter, if the label names one. Used to retire a "Not included"
   line that only exists to point at an option the customer has now bought:
   leaving "…see Option A" on the page under a selected Option A contradicts
   itself in the customer's own copy. */
function optionLetter(label) {
  const m = norm(label).match(/\boption\s+([a-f])\b/);
  return m ? m[1].toUpperCase() : "";
}

/* Every option on the estimate, from both places they are written.
   serviceBreakdown[].options is the deterministic path; estimate.options is
   what the estimator returns. Deduped by id — the same option written in both
   places is one option, not two. */
function collectOptions(estimate) {
  const est = estimate || {};
  const out = [];
  const seen = Object.create(null);

  /* Deduped by id, first write wins. Two options carrying the SAME label are one
     option: whichever of the two places wrote it first supplies the price. That
     is the right answer for the case this actually happens in - the same option
     written into both serviceBreakdown and estimate.options - and it is why
     serviceBreakdown, the deterministic side, is read first below. */
  function add(section, o) {
    if (!o || typeof o !== "object") return;
    const label = String(o.label || "").trim();
    if (!label) return;
    const id = optionId(label);
    if (seen[id]) return;
    seen[id] = 1;
    out.push({
      id: id,
      section: String(section || o.section || "").trim(),
      label: label,
      description: String(o.description || "").trim(),
      price: round2(num(o.price)),
      letter: optionLetter(label),
    });
  }

  (Array.isArray(est.serviceBreakdown) ? est.serviceBreakdown : []).forEach(function (s) {
    const sec = (s && (s.title || s.service || s.section || s.name)) || "";
    (Array.isArray(s && s.options) ? s.options : []).forEach(function (o) { add(sec, o); });
  });
  (Array.isArray(est.options) ? est.options : []).forEach(function (o) { add(o && o.section, o); });

  return out;
}

/* Resolve the ids a browser sent against the record's own options.
   Unknown ids are reported, never priced. Duplicates collapse. An option with
   no price adds nothing — it is a choice, not a charge. */
function resolveSelection(estimate, ids) {
  const all = collectOptions(estimate);
  const byId = Object.create(null);
  all.forEach(function (o) { byId[o.id] = o; });

  const selected = [];
  const unknown = [];
  const seen = Object.create(null);

  (Array.isArray(ids) ? ids : []).slice(0, 40).forEach(function (raw) {
    const id = String(raw == null ? "" : raw).trim();
    if (!id || seen[id]) return;
    seen[id] = 1;
    if (byId[id]) selected.push(byId[id]);
    else unknown.push(id.slice(0, 80));
  });

  const total = round2(selected.reduce(function (s, o) { return s + o.price; }, 0));
  return { all: all, selected: selected, unknown: unknown, total: total };
}

/* ══ FINISH UPGRADES RAISE THE TOTAL TOO. ═══════════════════════════════════
   A separate, older mechanism: the contractor offers finish choices (tile,
   fixtures) with one marked default, and swapping to another shows the customer
   a "+$" upgrade. That is a legitimate reason for a submitted total to sit above
   the quote, and the first version of the ceiling did not know about it — it
   would have clamped every finish swap back down to the quote and quietly cost
   the contractor the upgrade.

   Priced from the record wherever the record can price it: when the estimate
   carries finishGroups, the upgrade is read from the matching option there and
   the browser's number is ignored. When it does not, the submitted figure is
   used and recorded, because refusing it would break a live feature whose prices
   live only in the selection. */
function finishUpgradeTotal(estimate, finishSelections) {
  const list = Array.isArray(finishSelections) ? finishSelections.slice(0, 40) : [];
  if (!list.length) return 0;

  const groups = Array.isArray((estimate || {}).finishGroups) ? estimate.finishGroups : [];
  const known = Object.create(null);
  groups.forEach(function (g) {
    (Array.isArray(g && g.options) ? g.options : []).forEach(function (o) {
      if (!o) return;
      known[norm(g.name) + "|" + norm(o.name)] = num(o.upgrade);
    });
  });
  const haveGroups = Object.keys(known).length > 0;

  return round2(list.reduce(function (sum, s) {
    if (!s || typeof s !== "object") return sum;
    if (haveGroups) {
      const key = norm(s.groupName || s.group) + "|" + norm(s.optionName || s.option);
      return sum + (key in known ? known[key] : 0);
    }
    const up = num(s.upgrade);
    return sum + (up > 0 ? up : 0);
  }, 0));
}

/* What the record should remember. A snapshot, not just ids: the contractor can
   edit an option's label afterwards, and the id would then no longer resolve.
   What the customer agreed to has to survive that. */
function selectionSnapshot(selected) {
  return (selected || []).map(function (o) {
    return { id: o.id, section: o.section, label: o.label, price: o.price };
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    optionId: optionId,
    optionLetter: optionLetter,
    collectOptions: collectOptions,
    resolveSelection: resolveSelection,
    selectionSnapshot: selectionSnapshot,
    finishUpgradeTotal: finishUpgradeTotal,
  };
} else if (typeof window !== "undefined") {
  window.sbcQuoteOptions = {
    optionId: optionId,
    optionLetter: optionLetter,
    collectOptions: collectOptions,
    resolveSelection: resolveSelection,
    selectionSnapshot: selectionSnapshot,
    finishUpgradeTotal: finishUpgradeTotal,
  };
}
