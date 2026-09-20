// netlify/functions/lib/reword.js
//
// CHANGE THE WORDS OF AN ESTIMATE. NEVER THE NUMBERS.
//
//   "Can you upgrade them in estimate without touching prices?"
//
// The assistant found contradictions inside an estimate - brushed-gold in
// the line items, matte-black in the included text, two mirror sizes - and
// could not fix them: its only action added a fact to the description, which
// is priced again on Re-read. This is the other action: an edit to the TEXT
// of an estimate, applied here, with every price, quantity, unit, subtotal,
// markup and total left exactly as it was. That is not a promise; it is
// checked: the money of the record is fingerprinted before and after, and
// an edit that would change it is refused whole.
//
// One edit: { where, service, from, to }
//   where    included | excluded | supplies   a line in a service card
//            labor | material                 the NAME of a price line
//            summary | scope | title | timeline   one text field
//   service  the service card (for included/excluded/supplies), any case;
//            empty means every card
//   from     the text as it is now (matched whole, ignoring case and spacing;
//            for a text field, a phrase inside it). Empty + where=included/
//            excluded/supplies means ADD the line.
//   to       the new text. Empty means REMOVE the line (cards only).
//
// The same wording lives in up to three places (the estimator's service
// breakdown, the published customer scope, the private draft); an edit to a
// card line is made in all of them, so the dashboard and the customer's copy
// cannot disagree. The customer's page still shows the SENT version until
// he sends an update - that is the sent-version rule and it is not changed.

"use strict";

function str(v) { return String(v == null ? "" : v).trim(); }
function norm(s) { return str(s).toLowerCase().replace(/\s+/g, " "); }
function arr(v) { return Array.isArray(v) ? v : []; }

const CARD_KEYS = {
  included: ["included", "items", "scope"],
  excluded: ["notIncluded", "exclusions", "excluded"],
  supplies: ["customerSupplies", "customerSupplied", "supplied"],
};
const FIELD_KEYS = { summary: "summary", scope: "scopeOfWork", title: "projectTitle", timeline: "timelineText" };
const LINE_KEYS = { labor: "labor", material: "materials" };

/* Everything that is money, in a stable string. Anything else may change. */
function moneyFingerprint(record) {
  const est = (record && record.estimate) || {};
  const line = function (l) { return [l && l.qty, l && l.unit, l && l.rate, l && l.total, l && l.section].map(function (v) { return v == null ? "" : String(v); }).join("|"); };
  return JSON.stringify({
    labor: arr(est.labor).map(line), materials: arr(est.materials).map(line),
    markup: est.markupPct, final: record && record.customerFinalTotal,
    subtotals: arr(est.serviceBreakdown).map(function (s) { return [s && s.title, s && s.subtotal].join("|"); }),
    options: arr(est.options).map(function (o) { return [o && o.label, o && o.price].join("|"); }),
    cardOptions: arr(est.serviceBreakdown).map(function (s) { return arr(s && s.options).map(function (o) { return [o && o.label, o && o.price].join("|"); }); }),
    parked: arr(est.parkedLines).length, materialsTotal: est.materialsTotalEstimate,
    pubSubtotals: arr(est.publishedCustomerScope && est.publishedCustomerScope.services).map(function (s) { return [s && (s.name || s.title), s && s.subtotal].join("|"); }),
  });
}

/* The text of one card line, whether it is a string or an object. */
function lineText(x) { return typeof x === "string" ? x : str(x && (x.text || x.item || x.label || x.name)); }
function withText(x, t) { return typeof x === "string" ? t : Object.assign({}, x, { text: t }); }

function cardName(s) { return norm(s && (s.title || s.service || s.section || s.name)); }

/* Apply one card edit to one list; returns how many lines changed. */
function editList(list, from, to) {
  if (!Array.isArray(list)) return 0;
  let n = 0;
  if (!from) { if (to && !list.some(function (x) { return norm(lineText(x)) === norm(to); })) { list.push(to); n++; } return n; }
  for (let i = list.length - 1; i >= 0; i--) {
    if (norm(lineText(list[i])) !== norm(from)) continue;
    if (to) list[i] = withText(list[i], to); else list.splice(i, 1);
    n++;
  }
  return n;
}

function applyCardEdit(record, e) {
  const est = record.estimate || (record.estimate = {});
  const keys = CARD_KEYS[e.where];
  const wantService = norm(e.service);
  let n = 0;
  const cards = [];
  arr(est.serviceBreakdown).forEach(function (s) { if (s && (!wantService || cardName(s) === wantService)) cards.push({ row: s, keys: keys }); });
  const pubKeys = { included: ["included"], excluded: ["excluded", "notIncluded"], supplies: ["supplied", "customerSupplies"] }[e.where];
  [est.publishedCustomerScope, est.manualCustomerScopeDraft].forEach(function (scope) {
    arr(scope && scope.services).forEach(function (s) { if (s && (!wantService || cardName(s) === wantService)) cards.push({ row: s, keys: pubKeys }); });
  });
  arr(est.scopeSections).forEach(function (s) { if (e.where === "included" && s && (!wantService || norm(s.title) === wantService)) cards.push({ row: s, keys: ["items"] }); });
  cards.forEach(function (c) {
    let touched = false;
    c.keys.forEach(function (k) { if (Array.isArray(c.row[k])) { const m = editList(c.row[k], e.from, e.to); if (m) { n += m; touched = true; } } });
    /* Adding to a card that has no such list yet: make the first key. */
    if (!e.from && e.to && !touched) { c.row[c.keys[0]] = c.row[c.keys[0]] || []; if (Array.isArray(c.row[c.keys[0]])) n += editList(c.row[c.keys[0]], "", e.to); }
  });
  return n;
}

function applyLineEdit(record, e) {
  const est = record.estimate || {};
  const list = arr(est[LINE_KEYS[e.where]]);
  let n = 0;
  if (!e.from || !e.to) return 0;
  list.forEach(function (l) {
    if (!l || typeof l !== "object") return;
    const cur = str(l.item);
    if (norm(cur) === norm(e.from) || (norm(cur).indexOf(norm(e.from)) !== -1 && norm(e.from).length >= 8)) {
      l.item = norm(cur) === norm(e.from) ? e.to : cur.replace(new RegExp(escapeRe(e.from), "i"), e.to);
      n++;
    }
  });
  return n;
}

function applyFieldEdit(record, e) {
  const est = record.estimate || (record.estimate = {});
  const key = FIELD_KEYS[e.where];
  const cur = str(est[key]);
  if (!e.to && !e.from) return 0;
  if (e.from && cur) {
    const re = new RegExp(escapeRe(e.from), "i");
    if (!re.test(cur)) return 0;
    est[key] = cur.replace(re, e.to);
    return 1;
  }
  if (!e.from && e.to) { est[key] = e.to; return 1; }
  return 0;
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function cleanEdit(e) {
  const o = e && typeof e === "object" ? e : {};
  return { where: norm(o.where).replace(/s$/, "").replace(/^supplie$/, "supplies").replace(/^materials?$/, "material").replace(/^not.?included$|^exclusion$/, "excluded"),
    service: str(o.service).slice(0, 120), from: str(o.from).slice(0, 1000), to: str(o.to).slice(0, 1000) };
}
const WHERE = ["included", "excluded", "supplies", "labor", "material", "summary", "scope", "title", "timeline"];

/**
 * Apply text edits to a record, in place. Throws if the money changed.
 * @returns {{applied: object[], skipped: object[]}}
 */
function applyEdits(record, edits) {
  if (!record || typeof record !== "object") throw new Error("No record");
  const before = moneyFingerprint(record);
  const applied = [], skipped = [];
  arr(edits).slice(0, 20).map(cleanEdit).forEach(function (e) {
    if (WHERE.indexOf(e.where) === -1) { skipped.push(Object.assign({ reason: "unknown where" }, e)); return; }
    if (!e.from && !e.to) { skipped.push(Object.assign({ reason: "nothing to change" }, e)); return; }
    let n = 0;
    if (CARD_KEYS[e.where]) n = applyCardEdit(record, e);
    else if (LINE_KEYS[e.where]) n = applyLineEdit(record, e);
    else n = applyFieldEdit(record, e);
    if (n) applied.push(Object.assign({ changed: n }, e)); else skipped.push(Object.assign({ reason: "not found" }, e));
  });
  if (moneyFingerprint(record) !== before) throw new Error("An edit would have changed a price or a quantity. Nothing was saved.");
  return { applied: applied, skipped: skipped };
}

module.exports = { applyEdits, moneyFingerprint, cleanEdit, WHERE };
