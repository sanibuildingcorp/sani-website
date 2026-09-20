// netlify/functions/lib/add-service.js
//
// A SERVICE ADDED TO AN ESTIMATE THE CUSTOMER ALREADY AGREED TO.
//
//   "i need freeze current previous generated estimate for bathroom but i
//    want generate additional painting service price and scope of work
//    which will add in same estimate with own scope of work and price"
//
// Regenerating re-prices the whole job: every card, every line, every
// scope bullet comes back different, including the ones the customer
// accepted. So the new work is generated ON ITS OWN - the estimator is
// handed a request that holds only the new work - and the result is
// APPENDED to the estimate as its own section(s): its own lines, its own
// card, its own scope, its own price, under its own title. Nothing that
// was there before is touched: not a line, not a rate, not a bullet, not
// the markup, and the frozen sent version stays what she was sent until
// he sends again.
//
// Two halves, both pure so they can be tested without an AI:
//   addServiceRequest(record, text, service)  the request the estimator gets
//   mergeAddedService(record, fresh, meta)     the fresh estimate folded in
//
// The merge checks its own work: the part of the estimate that existed
// before must read back byte for byte, or it throws and nothing is saved.

"use strict";

const ADDED_MAX = 10;

function str(v) { return String(v == null ? "" : v).trim(); }
function arr(v) { return Array.isArray(v) ? v : []; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function key(v) { return str(v).toLowerCase(); }

/* ── THE REQUEST THE ESTIMATOR GETS ──────────────────────────────────────
   A copy of the record with a request that holds ONLY the new work: his
   words, the address and property from the record, no answers, no photos,
   no thread - all of those describe the job already priced, and a reader
   given them prices the bathroom again. The note tells the estimator what
   this is so it never re-prices what is already there. */
function addServiceRequest(record, text, service) {
  const rec = clone(record || {});
  const req = rec.request || {};
  const est = rec.estimate || {};
  const words = str(text);
  if (!words) throw new Error("Say what the additional service is");
  const already = arr(est.serviceBreakdown).map(function (c) { return str(c && (c.title || c.name)); }).filter(Boolean);
  const svc = str(service);
  rec.request = {
    service: svc || "Additional service",
    selectedServices: svc ? [svc] : [],
    propertyType: str(req.propertyType),
    timeline: str(req.timeline),
    sqft: str(req.sqft),
    description: words + "\n\n[ADDITIONAL SERVICE ON AN ESTIMATE ALREADY AGREED TO. The customer already has a priced estimate for: " +
      (already.length ? already.join(", ") : "other work") + ". That work is priced and is NOT part of this request. Price and describe ONLY the additional work above, as its own service" +
      (svc ? " named \"" + svc + "\"" : "") + ". Do not include, repeat or re-price any of the existing services.]",
    serviceAnswers: {}, answerTopics: {}, answerLabels: {}, customerSupplies: [], photos: [], photoCount: 0,
  };
  rec.thread = [];
  delete rec.projectAnalysis;
  delete rec.scopeFingerprint;
  return rec;
}

/* What the guard compares: everything money or wording in the estimate as it
   was. The merge may only APPEND to these. */
function baseFingerprint(estimate) {
  const e = estimate || {};
  return JSON.stringify({
    labor: arr(e.labor), materials: arr(e.materials), cards: arr(e.serviceBreakdown), sections: arr(e.scopeSections),
    supplied: arr(e.customerSupplied), markup: e.markupPct,
    published: e.publishedCustomerScope && arr(e.publishedCustomerScope.services),
    draft: e.manualCustomerScopeDraft && arr(e.manualCustomerScopeDraft.services),
    title: e.projectTitle, summary: e.summary, timeline: e.timelineText, scope: e.scopeOfWork,
  });
}
function prefixFingerprint(merged, base) {
  const m = merged || {}, b = base || {};
  const cut = function (list, n) { return arr(list).slice(0, arr(n).length); };
  return JSON.stringify({
    labor: cut(m.labor, b.labor), materials: cut(m.materials, b.materials), cards: cut(m.serviceBreakdown, b.serviceBreakdown), sections: cut(m.scopeSections, b.scopeSections),
    supplied: cut(m.customerSupplied, b.customerSupplied), markup: m.markupPct,
    published: b.publishedCustomerScope && cut(m.publishedCustomerScope && m.publishedCustomerScope.services, b.publishedCustomerScope.services),
    draft: b.manualCustomerScopeDraft && cut(m.manualCustomerScopeDraft && m.manualCustomerScopeDraft.services, b.manualCustomerScopeDraft.services),
    title: m.projectTitle, summary: m.summary, timeline: m.timelineText, scope: str(m.scopeOfWork) === str(b.scopeOfWork) ? m.scopeOfWork : (str(m.scopeOfWork).indexOf(str(b.scopeOfWork)) === 0 ? b.scopeOfWork : m.scopeOfWork),
  });
}

/* ── THE FRESH ESTIMATE, FOLDED IN ────────────────────────────────────────
   `fresh` is what the estimator produced for the new work alone. Its cards
   become new cards on the estimate; every one of its lines is filed under
   one of them (a loose line would otherwise be rescaled onto the old cards
   by the customer's page); its subtotals are restated at the estimate's own
   markup. A title that already exists gets " (additional)". The published
   scope and the private draft, when they exist, get the same card, so the
   customer's page and Scope Control both show it. A stamped total grows by
   exactly the new subtotal. Returns what was added. Mutates `record`. */
function mergeAddedService(record, fresh, meta) {
  const rec = record || {};
  const base = rec.estimate && typeof rec.estimate === "object" ? rec.estimate : null;
  if (!base) throw new Error("This record has no estimate to add to yet - generate it first");
  const f = fresh && typeof fresh === "object" ? fresh : {};
  if (!arr(f.labor).length && !arr(f.materials).length) throw new Error("The estimator priced nothing for the additional service");
  if (arr(base.addedServices).length >= ADDED_MAX) throw new Error("This estimate already has " + ADDED_MAX + " added services");
  const snap = snapshot(base);
  const before = baseFingerprint(snap);
  const baseMM = 1 + num(base.markupPct) / 100;
  const freshMM = 1 + num(f.markupPct) / 100;
  const factor = freshMM > 0 ? baseMM / freshMM : 1;

  /* the new cards, renamed away from any existing title */
  const taken = {};
  arr(base.serviceBreakdown).forEach(function (c) { taken[key(c && (c.title || c.name))] = true; });
  arr(base.publishedCustomerScope && base.publishedCustomerScope.services).forEach(function (s) { taken[key(s && (s.name || s.title))] = true; });
  const rename = {};
  let cards = arr(f.serviceBreakdown).filter(function (c) { return c && str(c.title || c.name); }).map(function (c) {
    const was = str(c.title || c.name);
    let title = was;
    if (taken[key(title)]) { title = was + " (additional)"; let n = 2; while (taken[key(title)]) { title = was + " (additional " + (n++) + ")"; } }
    taken[key(title)] = true;
    rename[key(was)] = title;
    return { title: title, included: arr(c.included).map(str).filter(Boolean), customerSupplies: arr(c.customerSupplies).map(str).filter(Boolean), notIncluded: arr(c.notIncluded).map(str).filter(Boolean), subtotal: round2(num(c.subtotal) * factor), options: arr(c.options).map(function (o) { return { label: str(o && o.label), description: str(o && o.description), price: round2(num(o && o.price) * factor) }; }).filter(function (o) { return o.label; }) };
  });
  if (!cards.length) {
    /* an estimator that wrote lines but no card: one card named after the service */
    const title0 = str(meta && meta.service) || "Additional work";
    let title = title0; let n = 2;
    while (taken[key(title)]) { title = title0 + " (additional" + (n > 2 ? " " + (n - 1) : "") + ")"; n++; }
    const cost = arr(f.labor).concat(arr(f.materials)).reduce(function (s, l) { return s + num(l.qty) * num(l.rate); }, 0);
    cards = [{ title: title, included: arr(f.labor).map(function (l) { return str(l.item); }).filter(Boolean).slice(0, 12), customerSupplies: [], notIncluded: [], subtotal: round2(cost * baseMM), options: [] }];
  }
  const first = cards[0].title;
  const sectionOf = function (line) {
    const s = key(line && line.section);
    if (rename[s]) return rename[s];
    const hit = cards.find(function (c) { return key(c.title) === s || key(c.title) === s + " (additional)"; });
    return hit ? hit.title : first;
  };
  const lines = function (list) {
    return arr(list).filter(function (l) { return l && str(l.item) && num(l.qty) > 0; }).map(function (l) {
      return { item: str(l.item), qty: num(l.qty), unit: str(l.unit) || "ea", rate: num(l.rate), section: sectionOf(l) };
    });
  };
  const labor = lines(f.labor), materials = lines(f.materials);
  if (!labor.length && !materials.length) throw new Error("The estimator priced nothing for the additional service");
  /* the card subtotals must be what its own lines cost at this estimate's markup */
  const own = {};
  cards.forEach(function (c) { own[c.title] = 0; });
  labor.concat(materials).forEach(function (l) { own[l.section] += num(l.qty) * num(l.rate); });
  const cardSum = cards.reduce(function (s, c) { return s + c.subtotal; }, 0);
  const lineSum = round2(Object.keys(own).reduce(function (s, t) { return s + own[t]; }, 0) * baseMM);
  if (Math.abs(cardSum - lineSum) >= 1) cards.forEach(function (c) { c.subtotal = round2(own[c.title] * baseMM); });
  const added = round2(cards.reduce(function (s, c) { return s + c.subtotal; }, 0));

  const est = base;
  est.labor = arr(est.labor).concat(labor);
  est.materials = arr(est.materials).concat(materials);
  est.serviceBreakdown = arr(est.serviceBreakdown).concat(cards);
  est.scopeSections = arr(est.scopeSections).concat(cards.map(function (c) { return { title: c.title, items: c.included.slice(0, 12) }; }));
  est.customerSupplied = arr(est.customerSupplied).concat(arr(f.customerSupplied).map(function (x) { return typeof x === "string" ? { item: str(x), section: first } : { item: str(x && x.item), section: sectionOf(x), note: str(x && x.note) }; }).filter(function (x) { return x.item; }));
  const scopeText = cards.map(function (c) { return c.title.toUpperCase() + ":\n" + c.included.map(function (i) { return "• " + i; }).join("\n"); }).join("\n\n");
  est.scopeOfWork = str(est.scopeOfWork) ? str(est.scopeOfWork) + "\n\n" + scopeText : scopeText;
  const pubRow = function (c) { return { name: c.title, subtotal: c.subtotal, included: c.included.slice(), supplied: c.customerSupplies.slice(), excluded: c.notIncluded.slice(), includedOff: [], suppliedOff: [], excludedOff: [] }; };
  if (est.publishedCustomerScope && Array.isArray(est.publishedCustomerScope.services)) {
    est.publishedCustomerScope.services = est.publishedCustomerScope.services.concat(cards.map(pubRow));
    est.publishedCustomerScope.updatedAt = new Date().toISOString();
  }
  if (est.manualCustomerScopeDraft && Array.isArray(est.manualCustomerScopeDraft.services)) {
    est.manualCustomerScopeDraft.services = est.manualCustomerScopeDraft.services.concat(cards.map(pubRow));
    est.manualCustomerScopeDraft.updatedAt = new Date().toISOString();
  }
  const entry = { at: new Date().toISOString(), titles: cards.map(function (c) { return c.title; }), subtotal: added, text: str(meta && meta.text).slice(0, 600), laborLines: labor.length, materialLines: materials.length };
  est.addedServices = arr(est.addedServices).concat([entry]);
  /* a stamped total is the price she was shown: it grows by exactly the new work */
  let stampedFrom = null, stampedTo = null;
  if (rec.customerFinalTotal != null && num(rec.customerFinalTotal) > 0) {
    stampedFrom = round2(rec.customerFinalTotal);
    stampedTo = round2(stampedFrom + added);
    rec.customerFinalTotal = stampedTo;
  }

  /* the guard: what was there reads back exactly */
  if (prefixFingerprint(est, snap) !== before) throw new Error("The merge would have changed the existing estimate; nothing was saved");
  return { titles: entry.titles, subtotal: added, stampedFrom: stampedFrom, stampedTo: stampedTo, laborLines: labor.length, materialLines: materials.length };
}
/* a copy of everything the guard watches, taken before the merge touches it */
function snapshot(estimate) {
  const e = estimate || {};
  return clone({ labor: arr(e.labor), materials: arr(e.materials), serviceBreakdown: arr(e.serviceBreakdown), scopeSections: arr(e.scopeSections), customerSupplied: arr(e.customerSupplied), markupPct: e.markupPct,
    publishedCustomerScope: e.publishedCustomerScope && Array.isArray(e.publishedCustomerScope.services) ? { services: e.publishedCustomerScope.services } : null,
    manualCustomerScopeDraft: e.manualCustomerScopeDraft && Array.isArray(e.manualCustomerScopeDraft.services) ? { services: e.manualCustomerScopeDraft.services } : null,
    projectTitle: e.projectTitle, summary: e.summary, timelineText: e.timelineText, scopeOfWork: e.scopeOfWork });
}

module.exports = { addServiceRequest, mergeAddedService, baseFingerprint, prefixFingerprint, snapshot, ADDED_MAX };
