// netlify/functions/lib/bid-package.js
//
// THE BID PACKAGE READER: what the AI is asked, and what is kept of its answer.
//
//   "all files was down with so many files and needed read all files"
//
// bid-analyzer.html skims every file on his device and uploads ONE PDF of the
// pages about cabinets, millwork, the unit counts and the money rules, each
// stamped with the file and page it came from. analyze-bid-background sends
// that PDF with packagePrompt() and keeps normalizePackage() of the answer.
//
// Same trust rules as the takeoff: the AI reads and counts, it NEVER prices.
// The price of each kitchen type is made later in the estimate system, from a
// draft estimate he checks. Every count carries the page it came from.

"use strict";

/* Every string the page shows. The company never calls itself or anyone
   "licensed" (a real reading wrote "by licensed plumbing/electrical
   contractor"), so the word is taken out wherever the AI puts it. */
function str(v, max) { return String(v == null ? "" : v).replace(/\s*\blicensed\b/gi, "").replace(/\s+/g, " ").trim().slice(0, max || 400); }
function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  const s = String(v == null ? "" : v).replace(/[^0-9.\-]/g, "");
  if (!/\d/.test(s)) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}
function arr(v) { return Array.isArray(v) ? v : []; }
function conf(v) { return ["high", "medium", "low"].indexOf(String(v)) !== -1 ? String(v) : "low"; }

function packagePrompt(opts) {
  const o = opts || {};
  return `You read construction bid packages for Sani Building Corp, a fully insured NYC company that INSTALLS KITCHEN CABINETS, CASEWORK AND FINISH CARPENTRY / MILLWORK. It bids on multifamily buildings for general contractors.

The attached PDF is NOT the whole bid package. The contractor's device already kept only the pages about our trade and the money rules (${o.pagesKept || "?"} of ${o.pagesTotal || "?"} pages, from ${o.fileCount || "?"} file(s)). Each page is stamped at the top: "PAGE n | SOURCE: file p.x". "page" in your answer is always n, the page number in THIS PDF.

PAGE MAP:
${o.pageMap || "(none)"}
${o.notes ? "\nCONTRACTOR NOTES (true, use them):\n" + o.notes + "\n" : ""}
YOUR JOB:
1. Find the kitchen types (K1, Type A, 1BR kitchen...) and COUNT how many kitchens of each type the building has. Use the unit matrix / unit mix / apartment schedule first; floor plans if there is no matrix. Show the math in "count_source", e.g. "Unit matrix p.4: floors 2-6, 4 per floor = 20". If the matrix and the plans disagree, use the matrix, set confidence low and ask the GC.
2. For each kitchen type, list what is in it from the enlarged kitchen plans and interior elevations: base cabinets, wall cabinets, tall / pantry cabinets, sink base, drawer bases, corner units, end panels, appliance panels, fillers, toe kick, crown, light rail, hardware, and anything else of ours. Count boxes (EA); give widths when shown; give linear feet (LF) only when that is how the drawing shows it. If the elevations are not in the pages, say so and ask.
3. Other work of ours: vanities (when they are in the casework section), closet shelving, window stools, base, casing, wood trim, panelling - with quantity and where. Skip it when the pages do not show it.
4. The specs for our sections (06 41 00, 06 20 00, 12 35 30, or whatever they are called here): the requirements that change our price (materials, AWI grade, finish, who supplies cabinets, attic stock, mock-up, submittals, warranty).
5. WHO SUPPLIES THE CABINETS: "furnish_and_install" (we buy and install), "install_only" (owner / GC supplies them, we install), or "unclear".
6. What is NOT ours: countertops, appliances, plumbing, electrical, backing / blocking, anything the package gives to another trade. GAS RULE: we never set or connect an oven, range, cooktop or anything on a gas line - always list "Gas appliances - set and connected by the gas trade" in not_in_our_scope.
7. The money and paper rules: bid due date and time, walkthrough, insurance limits, bonds, retainage, payment terms, schedule / duration, prevailing wage, MWBE, submittals.
8. Questions for the GC: every thing we need to know to price and that the pages do not answer. One question each, written as you would email a general contractor, short and plain.

RULES:
- The contact is the person at the GENERAL CONTRACTOR (or owner) who receives bids - never a cabinet supplier, kitchen designer, architect or engineer. Leave contact_name, contact_email and contact_phone empty when the pages do not name that person.
- Never use the word "licensed".
- NEVER write a price, a rate or a dollar figure of your own. Copy a dollar figure only when the package states it (an insurance limit, an allowance on the bid form).
- Never guess a count. A count you cannot read from the pages is null, with a question for the GC.
- Plain English, short sentences. No shorthand except EA, LF, SF.
- KEEP IT SHORT - the answer must fit: at most 25 item lines per kitchen type (one line per cabinet size, with its count - never one line per box), at most 20 questions, at most 15 assumptions, notes of one sentence. No repeated facts.
- confidence: "high" = read directly from a schedule or a dimensioned drawing; "medium" = worked out from several pages; "low" = inferred or conflicting (and then ask a question).

RESPOND WITH ONLY VALID JSON (no markdown fences, no commentary), exactly this shape:
{
  "project": { "name": "", "address": "", "owner": "", "gc": "", "architect": "", "bid_due": "", "walkthrough": "", "contact_name": "", "contact_email": "", "contact_phone": "", "page": 1 },
  "project_summary": "2-3 plain sentences: the building, how many units, what our part is",
  "our_scope_summary": "2-3 plain sentences: what we would install",
  "supply": "furnish_and_install | install_only | unclear",
  "supply_note": "what the package says, with the page",
  "unit_types": [ { "unit_type": "A1", "description": "1 bedroom", "count": 20, "kitchen_type": "K1", "page": 4, "confidence": "high" } ],
  "kitchen_types": [
    {
      "name": "K1",
      "description": "L-shaped kitchen with island, 1 bedroom units",
      "count": 20,
      "count_source": "Unit matrix p.4: floors 2-6, 4 per floor = 20",
      "units": ["A1", "A2"],
      "pages": [4, 12, 13],
      "confidence": "high",
      "items": [ { "item": "Base cabinet 36 in", "qty": 2, "unit": "EA", "page": 12, "confidence": "high" } ],
      "notes": ["anything he must know about this kitchen type"]
    }
  ],
  "other_millwork": [ { "item": "Vanity 30 in", "qty": 40, "unit": "EA", "where": "all bathrooms", "page": 15, "confidence": "medium" } ],
  "specs": [ { "section": "06 41 00", "title": "Architectural wood casework", "page": 20, "requirements": ["AWI Custom grade", "Plywood boxes"] } ],
  "shared_pages": [20, 21],
  "not_in_our_scope": ["Countertops - by others (06 41 00 p.21)", "Gas appliances - set and connected by the gas trade"],
  "requirements": [ { "category": "bid_due | walkthrough | insurance | bond | retainage | payment | schedule | wage | mwbe | submittals | site | other", "text": "", "page": 2 } ],
  "questions_for_gc": [ { "question": "", "why": "what it changes in our price", "page": 12 } ],
  "missing_information": ["pages or facts the package should have and these pages do not"],
  "assumptions": ["every interpretation you made"]
}
"shared_pages" = the spec and rule pages every kitchen type's estimate should carry (not the kitchen drawings).`;
}

function clampPage(p, max) {
  const n = Math.round(Number(p));
  if (!isFinite(n) || n < 1) return null;
  return max && n > max ? null : n;
}
function pages(list, max) {
  const out = [];
  arr(list).forEach(function (p) { const n = clampPage(p, max); if (n && out.indexOf(n) === -1) out.push(n); });
  return out.sort(function (a, b) { return a - b; }).slice(0, 60);
}
function item(it, max) {
  return { item: str(it && it.item, 200), qty: num(it && it.qty), unit: str(it && it.unit, 12).toUpperCase(), where: str(it && it.where, 160), page: clampPage(it && it.page, max), confidence: conf(it && it.confidence) };
}

/* The AI's answer, cleaned: every field the page reads exists and has the
   right type, pages point at real pages, and counts are checked against each
   other - a unit list that does not add up to the kitchen count becomes a
   question for the GC instead of a silent wrong number. */
function normalizePackage(parsed, meta) {
  const P = parsed && typeof parsed === "object" ? parsed : {};
  const m = meta || {};
  const max = Number(m.pagesKept) || 0;
  const pr = P.project && typeof P.project === "object" ? P.project : {};
  const project = {};
  ["name", "address", "owner", "gc", "architect", "bid_due", "walkthrough", "contact_name", "contact_email", "contact_phone"].forEach(function (k) { project[k] = str(pr[k], 200); });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(project.contact_email)) project.contact_email = "";
  project.page = clampPage(pr.page, max);

  const unitTypes = arr(P.unit_types).slice(0, 80).map(function (u) {
    return { unit_type: str(u && u.unit_type, 60), description: str(u && u.description, 160), count: num(u && u.count), kitchen_type: str(u && u.kitchen_type, 60), page: clampPage(u && u.page, max), confidence: conf(u && u.confidence) };
  }).filter(function (u) { return u.unit_type || u.kitchen_type; });

  const questions = arr(P.questions_for_gc).slice(0, 60).map(function (q) {
    return typeof q === "string" ? { question: str(q, 400), why: "", page: null } : { question: str(q && q.question, 400), why: str(q && q.why, 300), page: clampPage(q && q.page, max) };
  }).filter(function (q) { return q.question; });

  const checks = [];
  const kitchenTypes = arr(P.kitchen_types).slice(0, 30).map(function (k, i) {
    const name = str(k && k.name, 60) || ("Type " + (i + 1));
    const kt = {
      name: name,
      description: str(k && k.description, 240),
      count: num(k && k.count),
      count_source: str(k && k.count_source, 300),
      units: arr(k && k.units).map(function (u) { return str(u, 40); }).filter(Boolean).slice(0, 40),
      pages: pages(k && k.pages, max),
      confidence: conf(k && k.confidence),
      items: arr(k && k.items).slice(0, 80).map(function (it) { return item(it, max); }).filter(function (it) { return it.item; }),
      notes: arr(k && k.notes).map(function (n) { return str(n, 300); }).filter(Boolean).slice(0, 12),
    };
    if (kt.count !== null) kt.count = Math.max(0, Math.round(kt.count));
    /* The unit list against the kitchen count. */
    const mine = unitTypes.filter(function (u) { return u.kitchen_type && u.kitchen_type.toLowerCase() === name.toLowerCase() && u.count !== null; });
    const sum = mine.reduce(function (a, u) { return a + u.count; }, 0);
    if (mine.length && kt.count !== null && sum !== kt.count) {
      const msg = "Kitchen type " + name + ": the unit list adds up to " + sum + " kitchens, the count says " + kt.count + ".";
      checks.push(msg);
      kt.confidence = "low";
      questions.push({ question: "Please confirm how many kitchens of type " + name + " are in the building: the unit list shows " + sum + " and the other count shows " + kt.count + ".", why: "It multiplies our whole price for this kitchen type.", page: kt.pages[0] || null });
    }
    if (kt.count === null) checks.push("Kitchen type " + name + ": no count found.");
    return kt;
  });
  const counted = kitchenTypes.filter(function (k) { return k.count !== null; });

  return {
    mode: "package",
    project: project,
    project_summary: str(P.project_summary, 800),
    our_scope_summary: str(P.our_scope_summary, 800),
    supply: ["furnish_and_install", "install_only"].indexOf(String(P.supply)) !== -1 ? String(P.supply) : "unclear",
    supply_note: str(P.supply_note, 400),
    unit_types: unitTypes,
    kitchen_types: kitchenTypes,
    total_kitchens: counted.length ? counted.reduce(function (a, k) { return a + k.count; }, 0) : null,
    other_millwork: arr(P.other_millwork).slice(0, 60).map(function (it) { return item(it, max); }).filter(function (it) { return it.item; }),
    specs: arr(P.specs).slice(0, 20).map(function (s) {
      return { section: str(s && s.section, 30), title: str(s && s.title, 120), page: clampPage(s && s.page, max), requirements: arr(s && s.requirements).map(function (r) { return str(r, 300); }).filter(Boolean).slice(0, 20) };
    }),
    shared_pages: pages(P.shared_pages, max),
    not_in_our_scope: arr(P.not_in_our_scope).map(function (x) { return str(x, 300); }).filter(Boolean).slice(0, 40),
    requirements: arr(P.requirements).slice(0, 60).map(function (r) { return { category: str(r && r.category, 30).toLowerCase() || "other", text: str(r && r.text, 400), page: clampPage(r && r.page, max) }; }).filter(function (r) { return r.text; }),
    questions_for_gc: questions,
    missing_information: arr(P.missing_information).map(function (x) { return str(x, 300); }).filter(Boolean).slice(0, 40),
    assumptions: arr(P.assumptions).map(function (x) { return str(x, 300); }).filter(Boolean).slice(0, 60),
    checks: checks,
    files: arr(m.files).slice(0, 200).map(function (f) { return { name: str(f && f.name, 160), pages: num(f && f.pages) || 0, kept: num(f && f.kept) || 0, scanned: !!(f && f.scanned) }; }),
    pages_kept: max,
    pages_total: Number(m.pagesTotal) || 0,
    page_map: arr(m.pageMap).slice(0, 120).map(function (p) { return { file: str(p && p.file, 160), page: num(p && p.page) || 0 }; }),
  };
}

/* The model's text -> the JSON object in it. */
function parseJson(text) {
  const t = String(text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(t); } catch (e) { /* fall through */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a !== -1 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { /* fall through */ } }
  return null;
}

module.exports = { packagePrompt, normalizePackage, parseJson };
