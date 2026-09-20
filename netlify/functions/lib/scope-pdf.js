// netlify/functions/lib/scope-pdf.js
//
// THE SCOPE OF WORK AS A PDF FILE.
//
//   "Yes build the download PDF button"
//
// The scope link is a web page, and inside the Gmail app's browser a web page
// cannot print. A file can be saved from anywhere. This lays out the same
// scope-only view the page renders (lib/scope-only.js has already removed
// every price and every private matter) as a PDF: the project, who it is
// for, the summary and timeline, then each service with what is included,
// what the customer supplies, what is not included, and the alternatives by
// name. No price appears because none reaches this file.

"use strict";

const { Doc } = require("./pdf-writer");

const NAVY = [0.04, 0.09, 0.16], GOLD = [0.78, 0.53, 0.04], GREY = [0.36, 0.42, 0.5];
const GREEN = [0.12, 0.48, 0.32], RED = [0.66, 0.27, 0.25], BROWN = [0.54, 0.36, 0.02];

const INSTRUCTION_RE = /^\s*(do not|don't|dont|please do not|do NOT)\b|\bdo not (price|assume|treat|quote|estimate)\b|estimating instruction|note to estimator/i;
const A = (v) => (Array.isArray(v) ? v : []);
const C = (v) => String(v == null ? "" : v).trim();
const N = (v) => C(v).toLowerCase();
function uniq(list) {
  const seen = new Set(), out = [];
  A(list).forEach(function (x) {
    const t = typeof x === "string" ? C(x) : C(x && (x.item || x.label || x.name || x.text));
    const k = N(t).replace(/[^a-z0-9]+/g, " ").trim();
    if (t && !seen.has(k)) { seen.add(k); out.push(t); }
  });
  return out;
}
const cleanExclusions = (list) => uniq(list).filter((x) => !INSTRUCTION_RE.test(x));

/**
 * The service cards, the way quote.html shows them: the estimator's service
 * breakdown, wearing the published wording where the contractor published
 * some. Published services with no card of their own are folded into the
 * first card, as the page does. Cards with nothing to say are dropped.
 */
function scopeCards(estimate) {
  const e = estimate || {};
  const cards = A(e.serviceBreakdown).map(function (s) {
    return {
      title: C(s && (s.title || s.service || s.section || s.name)) || "Service",
      included: uniq(A(s && (s.included || s.items || s.scope))),
      supplies: uniq(A(s && (s.customerSupplies || s.customerSupplied || s.supplied))),
      excluded: cleanExclusions(A(s && (s.notIncluded || s.exclusions || s.excluded))),
      options: [],
    };
  });
  if (e.customerScopePublished === true && A(e.publishedCustomerScope && e.publishedCustomerScope.services).length) {
    const idx = new Map();
    e.publishedCustomerScope.services.forEach(function (ps) { const k = N(ps && (ps.name || ps.title)); if (k) idx.set(k, ps); });
    cards.forEach(function (c) {
      const ps = idx.get(N(c.title)); if (!ps) return;
      c.included = uniq(A(ps.included));
      c.supplies = uniq(A(ps.supplied || ps.customerSupplies));
      c.excluded = cleanExclusions(A(ps.excluded || ps.notIncluded));
      idx.delete(N(c.title));
    });
    idx.forEach(function (ps) {
      if (!cards.length) { cards.push({ title: C(ps.name || ps.title) || "Scope of work", included: [], supplies: [], excluded: [], options: [] }); }
      const main = cards[0];
      main.included = uniq(main.included.concat(A(ps.included)));
      main.supplies = uniq(main.supplies.concat(A(ps.supplied || ps.customerSupplies)));
      main.excluded = cleanExclusions(main.excluded.concat(A(ps.excluded || ps.notIncluded)));
    });
  }
  /* Legacy records: no service breakdown, a scope text or sections instead. */
  if (!cards.length) {
    const text = C(e.scopeOfWork) || A(e.scopeSections).map((x) => C(x && x.title) + "\n" + A(x && x.items).map((i) => "• " + C(i)).join("\n")).join("\n\n").trim();
    if (text || A(e.customerSupplied).length || A(e.exclusions).length) {
      cards.push({ title: "Scope of work", text: text, included: [], supplies: uniq(A(e.customerSupplied)), excluded: cleanExclusions(A(e.exclusions)), options: A(e.options).filter((o) => o && C(o.label)).map((o) => ({ label: C(o.label), description: C(o.description) })) });
    }
  }
  return cards.filter((c) => c.text || c.included.length || c.supplies.length || c.excluded.length || c.options.length);
}

function fmtDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  return (isFinite(d.getTime()) ? d : new Date()).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

/**
 * @param {object} view  a scope-only customer view (get-estimate's scopeView)
 * @param {object} [opts] now (ISO) for a stable date in tests
 * @returns {Buffer} the PDF
 */
function buildScopePdf(view, opts) {
  const v = view || {}, e = v.estimate || {}, cust = v.customer || {}, rq = v.request || {};
  const ref = C(v.ref);
  const title = C(e.projectTitle) || C(rq.service) || "Scope of work";
  const address = C(v.projectAddress) || C(cust.address);
  const doc = new Doc({
    title: "Scope of Work — " + title,
    footerLeft: "Scope of work · no pricing is included · Sani Building Corp · fully insured · (332) 277-0990",
    footerRight: ref,
  });

  doc.text("SANI BUILDING CORP", { size: 10, bold: true, color: GOLD, after: 2 });
  doc.text("Scope of Work", { size: 22, bold: true, color: NAVY, after: 2 });
  doc.text(title, { size: 14, bold: true, color: NAVY, after: 8 });
  if (C(cust.name)) doc.text("Prepared for: " + C(cust.name), { size: 10.5, color: GREY, after: 1 });
  if (address) doc.text("Project address: " + address, { size: 10.5, color: GREY, after: 1 });
  doc.text((ref ? "Reference: " + ref + "   ·   " : "") + "Date: " + fmtDate(opts && opts.now), { size: 10.5, color: GREY, after: 4 });
  doc.rule();
  doc.text("This document lists the work to be performed, what is and is not included, and the timeline. It contains no pricing. Prepared by Sani Building Corp, Brooklyn, NY · fully insured · (332) 277-0990 · contact@sanibuildingcorp.com", { size: 9.5, color: GREY, after: 10 });

  if (C(e.summary)) {
    doc.text("Project summary", { size: 12, bold: true, color: NAVY, after: 3 });
    doc.text(C(e.summary), { size: 11, after: 10 });
  }
  if (C(e.timelineText)) {
    doc.text("Timeline", { size: 12, bold: true, color: NAVY, after: 3 });
    doc.text(C(e.timelineText), { size: 11, after: 10 });
  }

  const cards = scopeCards(e);
  cards.forEach(function (c, i) {
    doc.band((cards.length > 1 ? "Service " + (i + 1) + "  ·  " : "") + c.title);
    if (c.text) doc.text(c.text, { size: 11, after: 8 });
    const section = function (label, color, items, bullet) {
      if (!items.length) return;
      doc.text(label, { size: 10.5, bold: true, color: color, after: 2 });
      items.forEach(function (it) { doc.text(it, { size: 10.5, indent: 6, bullet: bullet, after: 1 }); });
      doc.space(6);
    };
    section("Included in this service", GREEN, c.included, "•");
    section("Customer supplies", BROWN, c.supplies, "•");
    section("Not included", RED, c.excluded, "–");
    /* No "Optional alternatives" block: "I need to completely remove
       alternative offers, i never use them and remove from everywhere." */
    doc.space(6);
  });
  if (!cards.length) doc.text("The scope of work for this project has not been written yet.", { size: 11, color: GREY });
  /* No closing paragraph: the footer on every page already says who made
     this and how to reach them, and a closing line alone on a fresh page is
     the only thing it would ever add. */
  return doc.build();
}

function fileName(view) {
  const ref = C(view && view.ref).replace(/[^A-Za-z0-9-]+/g, "") || "estimate";
  return "Scope-of-Work-" + ref + ".pdf";
}

module.exports = { buildScopePdf, scopeCards, fileName };
