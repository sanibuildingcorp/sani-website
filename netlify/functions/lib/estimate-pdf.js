// netlify/functions/lib/estimate-pdf.js
//
// EVERY ESTIMATE AS A PDF FILE, FROM THE DASHBOARD.
//
//   "I need download or print function in my dashboard for let me download
//    each estimate" - both versions, as a PDF file download.
//
// Two files:
//
//   CUSTOMER  what the customer's page shows: the services, what each one
//             includes, the customer's supplies and what is not included,
//             the price of each service and the total. Built from the same
//             customer view the quote page gets (get-estimate customerPdfView:
//             the SENT version when there is one). Never a labor or material
//             line, a rate, the markup or an internal note.
//
//   INTERNAL  the contractor's working copy: every labor and material line
//             with quantity, rate and amount, the totals with the markup, the
//             customer's price, the assumptions and the estimator's notes.
//             "INTERNAL - NOT FOR THE CUSTOMER" on every page.
//
// The arithmetic is lib/customer-total.js, the one definition; the service
// prices are scaled to the customer total exactly as quote.html does it.

"use strict";

const { Doc, CONTENT_W } = require("./pdf-writer");
const { scopeCards } = require("./scope-pdf");
const { customerTotals } = require("./customer-total");

const NAVY = [0.04, 0.09, 0.16], GOLD = [0.66, 0.46, 0.16], GREY = [0.36, 0.42, 0.5];
const GREEN = [0.12, 0.48, 0.32], RED = [0.66, 0.27, 0.25], BROWN = [0.54, 0.36, 0.02], PALE = [0.96, 0.95, 0.93];
const A = (v) => (Array.isArray(v) ? v : []);
const C = (v) => String(v == null ? "" : v).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
function money(n) {
  const v = r2(n), neg = v < 0;
  return (neg ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  return (isFinite(d.getTime()) ? d : new Date()).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}
const CONTACT = "Sani Building Corp · Brooklyn, NY · fully insured · (332) 277-0990 · contact@sanibuildingcorp.com";

/* Options the customer ticked that are not yet written in as real lines
   (adoptedAt), as quote.html counts them. */
function chosenOptions(view) {
  return A(view && view.customerOptionSelections)
    .filter((o) => o && C(o.label) && !o.adoptedAt && num(o.price) > 0)
    .map((o) => ({ label: C(o.label), price: r2(o.price), section: C(o.section) }));
}

/* The service cards with their prices, scaled so they add up to the price the
   customer is quoted - quote.html's build() does the same. */
function pricedCards(estimate, total) {
  const cards = scopeCards(estimate);
  const priced = cards.filter((c) => num(c.subtotal) > 0);
  const sum = priced.reduce((s, c) => s + num(c.subtotal), 0);
  if (sum > 0 && total > 0) {
    priced.forEach((c) => { c.subtotal = r2(num(c.subtotal) * total / sum); });
    const diff = r2(total - priced.reduce((s, c) => s + c.subtotal, 0));
    if (diff) { const big = priced.reduce((a, b) => (b.subtotal > a.subtotal ? b : a), priced[0]); big.subtotal = r2(big.subtotal + diff); }
  }
  return cards;
}

function header(doc, label, title, v, dateIso) {
  const cust = v.customer || {}, rq = v.request || {};
  doc.text("SANI BUILDING CORP", { size: 10, bold: true, color: GOLD, after: 2 });
  doc.text(label, { size: 22, bold: true, color: NAVY, after: 2 });
  doc.text(title, { size: 14, bold: true, color: NAVY, after: 8 });
  if (C(cust.name)) doc.text("Prepared for: " + C(cust.name), { size: 10.5, color: GREY, after: 1 });
  const address = C(v.projectAddress) || C(cust.address) || C(rq.address);
  if (address) doc.text("Project address: " + address, { size: 10.5, color: GREY, after: 1 });
  doc.text((C(v.ref) ? "Reference: " + C(v.ref) + "   ·   " : "") + "Date: " + fmtDate(dateIso), { size: 10.5, color: GREY, after: 4 });
}

/**
 * The customer's estimate.
 * @param {object} view  get-estimate customerPdfView(record)
 * @param {object} [opts] now (ISO) for a stable date in tests
 */
function buildCustomerPdf(view, opts) {
  const v = view || {}, e = v.estimate || {}, rq = v.request || {};
  const title = C(e.projectTitle) || C(rq.service) || "Estimate";
  const doc = new Doc({ title: "Estimate — " + title, footerLeft: CONTACT, footerRight: C(v.ref) });
  header(doc, "Estimate", title, v, (opts && opts.now) || v.sentAt);
  if (v.notSentYet) doc.text("DRAFT — this estimate has not been sent to the customer yet.", { size: 10.5, bold: true, color: RED, after: 4 });
  doc.rule();

  if (C(e.summary)) { doc.text("Project summary", { size: 12, bold: true, color: NAVY, after: 3 }); doc.text(C(e.summary), { size: 11, after: 10 }); }
  if (C(e.timelineText)) { doc.text("Timeline", { size: 12, bold: true, color: NAVY, after: 3 }); doc.text(C(e.timelineText), { size: 11, after: 10 }); }

  const ct = customerTotals(e, v);
  const chosen = chosenOptions(v);
  const shown = ct.stampedTotal != null ? ct.stampedTotal : r2(ct.customerTotal + chosen.reduce((s, o) => s + o.price, 0));
  const cards = pricedCards(e, ct.customerTotal);
  const forCard = (t) => chosen.filter((o) => o.section && o.section.toLowerCase() === String(t).toLowerCase()).reduce((s, o) => s + o.price, 0);
  const W1 = CONTENT_W - 130, W2 = 130;

  if (shown > 0) {
    doc.text("Price by service", { size: 12, bold: true, color: NAVY, after: 4 });
    if (e.showSectionSubtotals !== false) {
      cards.filter((c) => num(c.subtotal) > 0).forEach((c) => {
        doc.row([{ text: c.title, w: W1 }, { text: money(c.subtotal + forCard(c.title)), w: W2, align: "right" }], { size: 11 });
      });
    }
    if (!ct.bothHidden) {
      if (ct.showLabor) doc.row([{ text: "Labor", w: W1, color: GREY }, { text: money(ct.laborAmount), w: W2, align: "right", color: GREY }], { size: 10.5 });
      if (ct.showMaterials) doc.row([{ text: "Materials", w: W1, color: GREY }, { text: money(ct.materialsAmount), w: W2, align: "right", color: GREY }], { size: 10.5 });
    }
    chosen.forEach((o) => doc.row([{ text: "Added: " + o.label, w: W1 }, { text: "+" + money(o.price), w: W2, align: "right" }], { size: 10.5 }));
    doc.space(3);
    doc.row([{ text: "Your estimate", w: W1, bold: true }, { text: money(shown), w: W2, align: "right", bold: true }], { size: 12.5, fill: PALE, after: 12 });
  }

  cards.forEach(function (c, i) {
    const price = num(c.subtotal) > 0 && e.showSectionSubtotals !== false ? "   ·   " + money(c.subtotal + forCard(c.title)) : "";
    doc.band((cards.length > 1 ? "Service " + (i + 1) + "  ·  " : "") + c.title + price);
    if (c.text) doc.text(c.text, { size: 11, after: 8 });
    const section = function (label, color, items, bullet) {
      if (!items.length) return;
      doc.ensure(40);
      doc.text(label, { size: 10.5, bold: true, color: color, after: 2 });
      items.forEach(function (it) { doc.text(it, { size: 10.5, indent: 6, bullet: bullet, after: 1 }); });
      doc.space(6);
    };
    section("Included in this service", GREEN, c.included, "•");
    section("Customer supplies", BROWN, c.supplies, "•");
    section("Not included", RED, c.excluded, "–");
    doc.space(6);
  });
  if (!cards.length) doc.text("The scope of work for this estimate has not been written yet.", { size: 11, color: GREY });
  return doc.build();
}

/**
 * The contractor's working copy. The whole stored record, as the dashboard has it.
 * @param {object} record
 * @param {object} [opts] now (ISO) for a stable date in tests
 */
function buildInternalPdf(record, opts) {
  const r = record || {}, e = r.estimate || {}, cust = r.customer || {}, rq = r.request || {};
  const title = C(e.projectTitle) || C(rq.service) || "Estimate";
  const doc = new Doc({ title: "Internal — " + title, footerLeft: "INTERNAL — NOT FOR THE CUSTOMER · Sani Building Corp", footerRight: C(r.ref) });
  doc.band("INTERNAL — NOT FOR THE CUSTOMER", { fill: [0.55, 0.16, 0.13] });
  header(doc, "Estimate — internal copy", title, r, opts && opts.now);
  const who = [C(cust.phone), C(cust.email)].filter(Boolean).join("   ·   ");
  if (who) doc.text(who, { size: 10.5, color: GREY, after: 1 });
  doc.text("Status: " + (C(r.status) || "new") + (r.sentAt ? "   ·   Sent " + fmtDate(r.sentAt) : "   ·   Not sent yet"), { size: 10.5, color: GREY, after: 4 });
  doc.rule();

  const ct = customerTotals(e, r);
  const W1 = CONTENT_W - 130, W2 = 130;
  doc.text("Totals", { size: 12, bold: true, color: NAVY, after: 4 });
  [["Labor (cost)", ct.labor], ["Materials (cost)", ct.materials], ["Subtotal", ct.subtotal], ["Markup (" + r2(ct.markupPct) + "%)", ct.markup]].forEach(function (x) {
    doc.row([{ text: x[0], w: W1 }, { text: money(x[1]), w: W2, align: "right" }], { size: 10.5 });
  });
  doc.row([{ text: "Grand total", w: W1, bold: true }, { text: money(ct.grandTotal), w: W2, align: "right", bold: true }], { size: 11.5, fill: PALE });
  doc.row([{ text: "Customer price" + (ct.stampedTotal != null ? " (agreed)" : "") + (ct.bothHidden ? "" : " — shown: " + [ct.showLabor ? "labor" : "", ct.showMaterials ? "materials" : ""].filter(Boolean).join(" + ")), w: W1, bold: true }, { text: money(ct.customerTotal), w: W2, align: "right", bold: true }], { size: 11.5, after: 12 });

  const table = function (label, lines) {
    const list = A(lines).filter((l) => l && C(l.item));
    if (!list.length) return;
    doc.band(label + "  ·  " + money(list.reduce((s, l) => s + num(l.qty) * num(l.rate), 0)), { size: 11.5 });
    const cols = [CONTENT_W - 250, 80, 80, 90];
    doc.row([{ text: "Item", w: cols[0], bold: true, color: GREY }, { text: "Qty", w: cols[1], align: "right", bold: true, color: GREY }, { text: "Rate", w: cols[2], align: "right", bold: true, color: GREY }, { text: "Amount", w: cols[3], align: "right", bold: true, color: GREY }], { size: 9.5 });
    let section = null;
    list.forEach(function (l) {
      const sec = C(l.section);
      if (sec && sec !== section) { section = sec; doc.text(sec, { size: 10, bold: true, color: GOLD, after: 1 }); }
      doc.row([
        { text: C(l.item), w: cols[0] },
        { text: r2(num(l.qty)) + (C(l.unit) ? " " + C(l.unit) : ""), w: cols[1], align: "right" },
        { text: money(num(l.rate)), w: cols[2], align: "right" },
        { text: money(num(l.qty) * num(l.rate)), w: cols[3], align: "right" },
      ], { size: 9.5, after: 2 });
    });
    doc.space(8);
  };
  table("Labor", e.labor);
  table("Materials", e.materials);

  const list = function (label, color, items) {
    const xs = A(items).map((x) => C(typeof x === "string" ? x : (x && (x.item || x.text || x.label)))).filter(Boolean);
    if (!xs.length) return;
    doc.ensure(44);
    doc.text(label, { size: 11, bold: true, color: color, after: 2 });
    xs.forEach((x) => doc.text(x, { size: 10, indent: 6, bullet: "•", after: 1 }));
    doc.space(6);
  };
  list("Customer supplies", BROWN, e.customerSupplied);
  list("Not included", RED, e.exclusions);
  list("Assumptions", GREY, e.assumptions);
  if (C(e.notes)) { doc.ensure(44); doc.text("Estimator notes", { size: 11, bold: true, color: GREY, after: 2 }); doc.text(C(e.notes), { size: 10, after: 6 }); }
  return doc.build();
}

function fileName(record, version) {
  const ref = C(record && record.ref).replace(/[^A-Za-z0-9-]+/g, "") || "estimate";
  const name = C(record && record.customer && record.customer.name).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (version === "internal" ? "Internal-Estimate-" : "Estimate-") + (name ? name + "-" : "") + ref + ".pdf";
}

module.exports = { buildCustomerPdf, buildInternalPdf, fileName, pricedCards, money };
