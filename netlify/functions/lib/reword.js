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
const scopeText = require("./scope-text");
const FIELD_KEYS = { summary: "summary", scope: "scopeOfWork", title: "projectTitle", timeline: "timelineText" };
/* ── THE CONTRACT'S WORDS ──────────────────────────────────────────────────
     "can you read contract too?" - "I can't open or read the contract."
   record.contract.sections holds the agreement the customer signs: scope
   lines, materials lines, the timeline, the project type and five clauses.
   Its words can be fixed here like the estimate's; its total and payment
   amounts are in the money fingerprint and never move; a SIGNED contract
   is never changed. */
const CONTRACT_LISTS = { contractscope: "scopeOfWork", contractmaterials: "materialsList" };
const CONTRACT_FIELDS = { contracttimeline: "timeline", contracttype: "projectType" };
const CLAUSES = { hiddenConditions: /hidden|conceal/, changeOrder: /change/, warranty: /warrant/, cancellation: /cancel/, permitsAndInsurance: /permit|insur/ };
function clauseKey(service) {
  const s = norm(service);
  return Object.keys(CLAUSES).filter(function (k) { return CLAUSES[k].test(s); })[0] || "";
}
const LINE_KEYS = { labor: "labor", material: "materials" };

/* Everything that is money, in a stable string. Anything else may change. */
function moneyFingerprint(record, renamed) {
  const est = (record && record.estimate) || {};
  /* A service card renamed moves no money: compared under its new name. */
  const nm = function (v) { const k = str(v).toLowerCase(); return renamed && Object.prototype.hasOwnProperty.call(renamed, k) ? renamed[k] : v; };
  const line = function (l) { return [l && l.qty, l && l.unit, l && l.rate, l && l.total, nm(l && l.section)].map(function (v) { return v == null ? "" : String(v); }).join("|"); };
  return JSON.stringify({
    labor: arr(est.labor).map(line), materials: arr(est.materials).map(line),
    markup: est.markupPct, final: record && record.customerFinalTotal,
    subtotals: arr(est.serviceBreakdown).map(function (s) { return [nm(s && s.title), s && s.subtotal].join("|"); }),
    options: arr(est.options).map(function (o) { return [o && o.label, o && o.price].join("|"); }),
    cardOptions: arr(est.serviceBreakdown).map(function (s) { return arr(s && s.options).map(function (o) { return [o && o.label, o && o.price].join("|"); }); }),
    parked: arr(est.parkedLines).length, materialsTotal: est.materialsTotalEstimate,
    pubSubtotals: arr(est.publishedCustomerScope && est.publishedCustomerScope.services).map(function (s) { return [nm(s && (s.name || s.title)), s && s.subtotal].join("|"); }),
    contract: record && record.contract && typeof record.contract === "object"
      ? [record.contract.total, record.contract.signed ? 1 : 0].concat(arr(record.contract.sections && record.contract.sections.paymentSchedule).map(function (p) { return [p && p.label, p && p.amount].join("|"); })).join("|")
      : "",
  });
}

/* The text of one card line, whether it is a string or an object. */
function lineText(x) { return typeof x === "string" ? x : str(x && (x.text || x.item || x.label || x.name)); }
function withText(x, t) { return typeof x === "string" ? t : Object.assign({}, x, { text: t }); }

function cardName(s) { return norm(s && (s.title || s.service || s.section || s.name)); }
/* "Bathroom" names the "Bathroom Renovation" card too: the same name
   forgiven, one containing the other, or most words shared. */
function sameCard(name, want) {
  if (!want) return true;
  const a = loose(name), b = loose(want);
  if (!a) return false;
  if (a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return true;
  return overlap(a, b) >= FUZZY;
}

/* ── FORGIVING MATCHING ───────────────────────────────────────────────────
     "Here are the wording fixes" - and only one of four landed. The model
     quotes a line with a plain dash where the estimate has an en dash, a
     straight quote for a curly one, drops the trailing period, or gives
     the gist of a line rather than its letters. "from must be copied
     EXACTLY" was a rule the model could not always keep, and every miss
     was a silent "not found". So: exact first; then the same words with
     dashes, quotes, spacing, case and end punctuation forgiven; then, for
     a card line or a whole sentence, the line that shares most of its
     words (six in ten or more). One line at most is changed by a fuzzy
     match, and never a line that shares less than that. */
const STOP = { the: 1, and: 1, for: 1, with: 1, that: 1, this: 1, are: 1, not: 1, from: 1, into: 1, onto: 1, all: 1, any: 1, one: 1, per: 1, its: 1, our: 1, your: 1, his: 1, her: 1, will: 1, was: 1, were: 1, has: 1, have: 1, had: 1, than: 1, then: 1 };
const FUZZY = 0.6;
function loose(s) {
  return str(s).toLowerCase()
    .replace(/[‐-―−]/g, "-").replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, "\"").replace(/…/g, "...")
    .replace(/^[\s•*\-–—·]+/, "").replace(/[\s.;:,]+$/, "").replace(/\s+/g, " ").trim();
}
/* the words of a line for comparison: quotes and periods dropped (24"x30"
   is 24x30), every other mark a space (half-wall is half wall), short and
   filler words out */
function words(s) {
  return loose(s).replace(/["'.]/g, "").replace(/[^a-z0-9$%]+/g, " ").split(/\s+/).filter(function (w) { return w.length > 2 && !STOP[w]; });
}
function overlap(a, b) {
  const A = {}, B = {};
  words(a).forEach(function (w) { A[w] = 1; }); words(b).forEach(function (w) { B[w] = 1; });
  const ka = Object.keys(A), kb = Object.keys(B);
  if (!ka.length || !kb.length) return 0;
  let both = 0; ka.forEach(function (w) { if (B[w]) both++; });
  return both / (ka.length + kb.length - both);
}
/* a regex for `from` inside a text: dashes, quotes, spacing and case forgiven */
function looseRe(from) {
  const parts = loose(from).split(" ").filter(Boolean).map(function (w) {
    return escapeRe(w).replace(/-/g, "[-\\u2010-\\u2015\\u2212]").replace(/'/g, "['\\u2018\\u2019]").replace(/"/g, "[\"\\u201c\\u201d]");
  });
  return new RegExp(parts.join("\\s+"), "i");
}
function bestLine(list, from, min) {
  let best = -1, score = 0;
  list.forEach(function (x, i) { const s = overlap(lineText(x), from); if (s > score) { score = s; best = i; } });
  return score >= (min || FUZZY) ? best : -1;
}

/* Apply one card edit to one list; returns how many lines changed. */
function editList(list, from, to) {
  if (!Array.isArray(list)) return 0;
  let n = 0;
  if (!from) { if (to && !list.some(function (x) { return loose(lineText(x)) === loose(to); })) { list.push(to); n++; } return n; }
  /* 1. the same line, forgiven */
  for (let i = list.length - 1; i >= 0; i--) {
    if (loose(lineText(list[i])) !== loose(from)) continue;
    if (to) list[i] = withText(list[i], to); else list.splice(i, 1);
    n++;
  }
  if (n) return n;
  /* 2. a phrase inside a line: replace the phrase, keep the rest */
  if (to && loose(from).length >= 12) {
    const re = looseRe(from);
    for (let i = 0; i < list.length; i++) {
      const t = lineText(list[i]);
      if (re.test(t)) { list[i] = withText(list[i], t.replace(re, to)); n++; }
    }
    if (n) return n;
  }
  /* 3. the line that shares most of its words */
  const b = bestLine(list, from);
  if (b >= 0) { if (to) list[b] = withText(list[b], to); else list.splice(b, 1); n = 1; }
  return n;
}

function applyCardEdit(record, e) {
  const est = record.estimate || (record.estimate = {});
  /* ONE SCOPE OF WORK: when the box still mirrors the cards, a card line
     reworded here is reworded there too. A scope the contractor typed by
     hand is his and is left alone. See lib/scope-text.js. */
  const mirror = e.where === "included" && scopeText.mirrorsCards(est);
  const r = applyCardEditInner(est, e);
  if (mirror && r && (typeof r === "number" || r.already)) scopeText.syncScopeText(est);
  return r;
}

function applyCardEditInner(est, e) {
  const keys = CARD_KEYS[e.where];
  const wantService = norm(e.service);
  let n = 0;
  const cards = [];
  arr(est.serviceBreakdown).forEach(function (s) { if (s && sameCard(cardName(s), wantService)) cards.push({ row: s, keys: keys }); });
  const pubKeys = { included: ["included"], excluded: ["excluded", "notIncluded"], supplies: ["supplied", "customerSupplies"] }[e.where];
  [est.publishedCustomerScope, est.manualCustomerScopeDraft].forEach(function (scope) {
    arr(scope && scope.services).forEach(function (s) { if (s && sameCard(cardName(s), wantService)) cards.push({ row: s, keys: pubKeys }); });
  });
  arr(est.scopeSections).forEach(function (s) { if (e.where === "included" && s && sameCard(norm(s.title), wantService)) cards.push({ row: s, keys: ["items"] }); });
  let already = 0;
  cards.forEach(function (c) {
    let touched = false;
    c.keys.forEach(function (k) { if (Array.isArray(c.row[k])) { const m = editList(c.row[k], e.from, e.to); if (m) { n += m; touched = true; } } });
    /* Adding to a card that has no such list yet: make the first key. */
    if (!e.from && e.to && !touched) { c.row[c.keys[0]] = c.row[c.keys[0]] || []; if (Array.isArray(c.row[c.keys[0]])) n += editList(c.row[c.keys[0]], "", e.to); }
    /* ALREADY DONE: the old line is gone and the new one is there - this
       edit landed on an earlier try whose reply was lost. Counted as
       applied, so a retry never reports a change that happened as missing. */
    if (!touched && e.to && c.keys.some(function (k) { return Array.isArray(c.row[k]) && c.row[k].some(function (x) { return loose(lineText(x)) === loose(e.to); }); })) already++;
  });
  return n || (already ? { already: already } : 0);
}

/* ── RENAME A SERVICE CARD ────────────────────────────────────────────────
     "In estimate let's my Ask AI able to edit service cards title too."
   Windows -> Trim & Hardware: the card in every copy (the estimator's
   cards, the published scope, the draft, the sections), every price line
   filed under it so its price follows it, customer supplies and options
   filed under it, an added section's record, and the scope-of-work header.
   Money does not move (checked under the new name). A name another card
   already has is refused - two cards would become one. */
function applyServiceRename(record, e) {
  const est = record.estimate || (record.estimate = {});
  const to = str(e.to).replace(/\s+/g, " ").slice(0, 80);
  if (!to || !e.from) return 0;
  const names = [];
  arr(est.serviceBreakdown).forEach(function (s) { const t = str(s && (s.title || s.service || s.section || s.name)); if (t && names.indexOf(t) === -1) names.push(t); });
  [est.publishedCustomerScope, est.manualCustomerScopeDraft].forEach(function (sc) { arr(sc && sc.services).forEach(function (s) { const t = str(s && (s.name || s.title)); if (t && !names.some(function (n) { return n.toLowerCase() === t.toLowerCase(); })) names.push(t); }); });
  const exact = names.filter(function (n) { return loose(n) === loose(e.from); });
  const hit = exact.length ? exact : names.filter(function (n) { return sameCard(norm(n), norm(e.from)); });
  if (hit.length !== 1) return 0;
  const old = hit[0], oldK = old.toLowerCase();
  if (oldK === to.toLowerCase()) return old === to ? { already: 1 } : 0;
  if (names.some(function (n) { return n.toLowerCase() === to.toLowerCase(); })) { const err = new Error("A card named \"" + to + "\" already exists - renaming " + old + " would merge two cards. Nothing was saved."); err.refuse = true; throw err; }
  const mirror = scopeText.mirrorsCards(est);
  const is = function (v) { return str(v).toLowerCase() === oldK; };
  let n = 0;
  arr(est.serviceBreakdown).forEach(function (s) { if (!s) return; ["title", "service", "section", "name"].forEach(function (k) { if (is(s[k])) { s[k] = to; n++; } }); });
  [est.publishedCustomerScope, est.manualCustomerScopeDraft].forEach(function (sc) { arr(sc && sc.services).forEach(function (s) { if (!s) return; ["name", "title"].forEach(function (k) { if (is(s[k])) { s[k] = to; n++; } }); }); });
  arr(est.scopeSections).forEach(function (s) { if (s && is(s.title)) { s.title = to; n++; } });
  ["labor", "materials", "customerSupplied", "options", "parkedLines"].forEach(function (k) { arr(est[k]).forEach(function (l) { if (l && typeof l === "object" && is(l.section)) l.section = to; }); });
  arr(est.addedServices).forEach(function (a) { if (a && Array.isArray(a.titles)) a.titles = a.titles.map(function (t) { return is(t) ? to : t; }); });
  if (mirror) scopeText.syncScopeText(est);
  else if (str(est.scopeOfWork)) est.scopeOfWork = str(est.scopeOfWork).replace(new RegExp("^" + escapeRe(old) + "(\\s*[:\u2014-][^\\n]*)?$", "gim"), function (m, rest) { return to.toUpperCase() + (rest || ":"); });
  if (!n) return 0;
  (record.__renamed || Object.defineProperty(record, "__renamed", { value: {}, enumerable: false, writable: true }).__renamed)[oldK] = to;
  return 1;
}

function applyLineEdit(record, e) {
  const est = record.estimate || {};
  const list = arr(est[LINE_KEYS[e.where]]);
  let n = 0;
  if (!e.from || !e.to) return 0;
  let already = 0;
  const re = looseRe(e.from);
  list.forEach(function (l) {
    if (!l || typeof l !== "object") return;
    const cur = str(l.item);
    if (loose(cur) === loose(e.from)) { l.item = e.to; n++; }
    else if (loose(e.from).length >= 8 && re.test(cur)) { l.item = cur.replace(re, e.to); n++; }
    else if (loose(cur) === loose(e.to)) already++;
  });
  if (!n && !already) {
    /* the price line that shares most of its words - a higher bar than a
       card line, because a wrong rename here lands on a priced row */
    const rows = list.filter(function (l) { return l && typeof l === "object"; });
    const b = bestLine(rows.map(function (l) { return str(l.item); }), e.from, 0.7);
    if (b >= 0) { rows[b].item = e.to; n = 1; }
  }
  return n || (already ? { already: already } : 0);
}

function applyFieldEdit(record, e) {
  return applyTextEdit(record.estimate || (record.estimate = {}), FIELD_KEYS[e.where], e);
}
/* One text field on any object: a phrase replaced, a sentence by its gist,
   or the whole field when from is empty. */
function applyTextEdit(est, key, e) {
  const cur = str(est[key]);
  if (!e.to && !e.from) return 0;
  if (e.from && cur) {
    let re = new RegExp(escapeRe(e.from), "i");
    if (!re.test(cur)) re = looseRe(e.from);
    if (re.test(cur)) { est[key] = cur.replace(re, e.to); return 1; }
    if (e.to && loose(cur).indexOf(loose(e.to)) !== -1) return { already: 1 };
    /* a whole sentence given by its gist: the sentence that shares most of
       its words, replaced whole (or removed when to is empty) */
    if (words(e.from).length >= 4) {
      const parts = cur.split(/(\n+|(?<=[.!?;:])\s+)/);
      let best = -1, score = 0;
      for (let i = 0; i < parts.length; i += 2) {
        const s = overlap(parts[i], e.from);
        const ratio = words(parts[i]).length / Math.max(1, words(e.from).length);
        if (s > score && ratio >= 0.4 && ratio <= 2.5) { score = s; best = i; }
      }
      if (best >= 0 && score >= FUZZY) {
        parts[best] = e.to;
        est[key] = parts.join("").replace(/[ \t]{2,}/g, " ").replace(/\s+([.!?;:,])/g, "$1").trim();
        return 1;
      }
    }
    return 0;
  }
  if (!e.from && e.to) { if (norm(cur) === norm(e.to)) return { already: 1 }; est[key] = e.to; return 1; }
  return 0;
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/* A whole scope of work is long; a card line is not. The cap follows the
   field, so "replace the scope" can carry the complete new text. */
const TEXT_CAP = { scope: 8000, summary: 2000, contractclause: 2000, contracttimeline: 1000 };
function textCap(where) { return TEXT_CAP[where] || 1000; }
function cleanWhere(v) {
  const w = norm(v).replace(/[\s_-]+/g, "");
  if (/^contract/.test(w)) {
    if (/scope/.test(w)) return "contractscope";
    if (/material/.test(w)) return "contractmaterials";
    if (/timeline|schedule/.test(w)) return "contracttimeline";
    if (/type|title/.test(w)) return "contracttype";
    if (/clause|term|condition|warrant|cancel|permit|change/.test(w)) return "contractclause";
    return w;
  }
  if (/^(servicetitle|servicename|cardtitle|cardname|card|rename|renameservice|renamecard)$/.test(w)) return "service";
  return w.replace(/s$/, "").replace(/^supplie$/, "supplies").replace(/^materials?$/, "material").replace(/^not.?included$|^exclusion$/, "excluded");
}
function cleanEdit(e) {
  const o = e && typeof e === "object" ? e : {};
  const where = cleanWhere(o.where);
  return { where: where, service: str(o.service).slice(0, 120), from: str(o.from).slice(0, textCap(where)), to: str(o.to).slice(0, textCap(where)) };
}
const WHERE = ["included", "excluded", "supplies", "labor", "material", "summary", "scope", "title", "timeline", "service", "contractscope", "contractmaterials", "contracttimeline", "contracttype", "contractclause"];

/* The contract's lines and fields. A signed contract is refused whole. */
function applyContractEdit(record, e) {
  const ct = record.contract;
  if (!ct || typeof ct !== "object" || !ct.sections) throw new Error("There is no contract on this estimate yet - generate it first.");
  if (ct.signed) throw new Error("The contract is signed; a signed contract is never changed. Nothing was saved.");
  const s = ct.sections;
  if (CONTRACT_LISTS[e.where]) {
    const k = CONTRACT_LISTS[e.where];
    if (!Array.isArray(s[k])) s[k] = [];
    const n = editList(s[k], e.from, e.to);
    if (n) return n;
    return e.to && s[k].some(function (x) { return loose(lineText(x)) === loose(e.to); }) ? { already: 1 } : 0;
  }
  if (CONTRACT_FIELDS[e.where]) return applyTextEdit(s, CONTRACT_FIELDS[e.where], e);
  if (e.where === "contractclause") {
    const key = clauseKey(e.service);
    if (!key) throw new Error("Which clause? Name it in service: hidden conditions, change orders, warranty, cancellation, or permits and insurance.");
    s.clauses = s.clauses && typeof s.clauses === "object" ? s.clauses : {};
    return applyTextEdit(s.clauses, key, e);
  }
  return 0;
}

/**
 * Apply text edits to a record, in place. Throws if the money changed.
 * @returns {{applied: object[], skipped: object[]}}
 */
function applyEdits(record, edits) {
  if (!record || typeof record !== "object") throw new Error("No record");
  const snapshot = JSON.parse(JSON.stringify({ estimate: record.estimate || {}, customerFinalTotal: record.customerFinalTotal, contract: record.contract }));
  record.__renamed = undefined;
  const applied = [], skipped = [];
  arr(edits).slice(0, 20).map(cleanEdit).forEach(function (e) {
    if (WHERE.indexOf(e.where) === -1) { skipped.push(Object.assign({ reason: "unknown where" }, e)); return; }
    if (!e.from && !e.to) { skipped.push(Object.assign({ reason: "nothing to change" }, e)); return; }
    let n = 0;
    if (e.where === "service") n = applyServiceRename(record, e);
    else if (CARD_KEYS[e.where]) n = applyCardEdit(record, e);
    else if (LINE_KEYS[e.where]) n = applyLineEdit(record, e);
    else if (/^contract/.test(e.where)) n = applyContractEdit(record, e);
    else n = applyFieldEdit(record, e);
    /* "title (Windows): Windows -> Trim & Hardware" - the model meant the
       card, not the estimate's title. A title edit that finds nothing, whose
       from IS a card's name, renames that card. */
    if (!n && e.where === "title" && e.from) { const r = applyServiceRename(record, Object.assign({}, e, { where: "service" })); if (r) { n = r; e = Object.assign({}, e, { where: "service" }); } }
    if (n && typeof n === "object") applied.push(Object.assign({ changed: 0, already: n.already }, e));
    else if (n) applied.push(Object.assign({ changed: n }, e));
    else skipped.push(Object.assign({ reason: "not found" }, e));
  });
  const renamed = record.__renamed || null;
  delete record.__renamed;
  if (moneyFingerprint(record) !== moneyFingerprint(snapshot, renamed)) throw new Error("An edit would have changed a price or a quantity. Nothing was saved.");
  return { applied: applied, skipped: skipped };
}

module.exports = { applyEdits, moneyFingerprint, cleanEdit, textCap, WHERE, loose, overlap, looseRe };
