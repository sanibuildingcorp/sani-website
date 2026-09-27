/* bid-triage.js — which pages of a bid package are about OUR work.
 *
 *   "i had registered in Blue book but i was registered for painting and it's
 *    was so hard to price out, all files was down with so many files and
 *    needed read all files"
 *
 * A multifamily bid package is thousands of pages: every trade's specs, MEP,
 * structural, civil. The cabinet installer needs maybe forty of them - the
 * casework and finish carpentry specs, the unit matrix, the enlarged kitchen
 * plans and elevations, the finish schedule, and the pages that set the
 * money rules (bid form, insurance, retainage, schedule).
 *
 * bid-analyzer.html reads the text of every page on the device (pdf.js),
 * scores it here, and keeps the best pages up to MAX_PAGES. Only those pages
 * are uploaded and read by the AI. Pure functions, no DOM: the page loads it
 * as a script, the tests require() it.
 */
(function (root) {
  "use strict";

  var MAX_PAGES = 90;           /* the AI reads one PDF of at most 100 pages */
  var MAX_BYTES = 30 * 1024 * 1024;

  /* [pattern, weight, label]. Patterns run on the page text in upper case,
     spaces squeezed. Each hit counts up to 3 times. */
  var STRONG = [
    [/06\s?41\s?00|ARCHITECTURAL WOOD CASEWORK/g, 12, "Spec 06 41 00 casework"],
    [/06\s?20\s?00|FINISH CARPENTRY/g, 12, "Spec 06 20 00 finish carpentry"],
    [/12\s?35\s?30|RESIDENTIAL CASEWORK/g, 12, "Spec 12 35 30 residential casework"],
    [/06\s?40\s?00|ARCHITECTURAL WOODWORK/g, 10, "Architectural woodwork"],
    [/KITCHEN CABINET|CABINETRY|CASEWORK/g, 8, "Cabinets"],
    [/MILLWORK/g, 8, "Millwork"],
    [/ENLARGED (UNIT|KITCHEN|APARTMENT)|TYPICAL UNIT PLAN|UNIT PLANS?\b/g, 9, "Enlarged unit plans"],
    [/KITCHEN ELEVATION|INTERIOR ELEVATION/g, 9, "Kitchen / interior elevations"],
    [/UNIT MATRIX|UNIT MIX|UNIT SCHEDULE|APARTMENT MIX|APARTMENT SCHEDULE|UNIT DISTRIBUTION|UNIT TYPE/g, 10, "Unit matrix"],
    [/FINISH SCHEDULE|ROOM FINISH/g, 7, "Finish schedule"],
    [/\bCABINETS?\b/g, 3, "Cabinets"],
    [/BASE CABINET|WALL CABINET|UPPER CABINET|TALL CABINET|PANTRY CABINET|FILLER|TOE ?KICK|LIGHT RAIL|CROWN MOLDING/g, 4, "Cabinet parts"],
    [/\bVANITY\b|VANITIES/g, 2, "Vanities"],
    [/\bKITCHEN\b/g, 2, "Kitchen"]
  ];
  var MONEY = [
    [/BID FORM|PROPOSAL FORM|FORM OF PROPOSAL|BID PROPOSAL/g, 7, "Bid form"],
    [/SCOPE OF WORK|SUMMARY OF WORK|01\s?10\s?00|WORK INCLUDED/g, 6, "Scope / summary of work"],
    [/INVITATION TO BID|REQUEST FOR (PROPOSAL|QUOTE|QUOTATION)|INSTRUCTIONS TO BIDDERS/g, 6, "Invitation / instructions"],
    [/INSURANCE REQUIREMENTS|CERTIFICATE OF INSURANCE|ADDITIONAL INSURED|GENERAL LIABILITY/g, 5, "Insurance"],
    [/RETAINAGE|RETAINER|PAYMENT APPLICATION|SCHEDULE OF VALUES|PAYMENT TERMS/g, 5, "Payment / retainage"],
    [/PROJECT SCHEDULE|CONSTRUCTION SCHEDULE|MILESTONE|SUBSTANTIAL COMPLETION/g, 4, "Schedule"],
    [/BIDS? (ARE )?DUE|BID DATE|DUE DATE|PRE-?BID|WALK-?THROUGH|SITE VISIT/g, 5, "Bid due / walkthrough"],
    [/PREVAILING WAGE|DAVIS-?BACON|CERTIFIED PAYROLL|MWBE|M\/WBE|SECTION 3/g, 4, "Wage / MWBE rules"],
    [/ALTERNATES?\b|ADDEND(UM|A)/g, 3, "Alternates / addenda"],
    [/SUBMITTALS?|SHOP DRAWINGS?/g, 2, "Submittals"],
    [/COUNTERTOPS?|APPLIANCES?|HARDWARE/g, 2, "Tops / appliances / hardware"]
  ];
  /* Other trades. A page full of these words and none of ours is not ours. */
  var OTHER = /\bDUCT|CFM\b|CIRCUIT|PANELBOARD|SPRINKLER|CONDUIT|REBAR|FOOTING|\bBEAM SCHEDULE|PLUMBING RISER|FIRE ALARM|SANITARY|STORM DRAIN|ROOFING|MASONRY|CURTAIN WALL|ELEVATOR|STEEL DECK/g;

  /* File names that say "our sheets" when the pages themselves have no text
     (a scanned drawing set). */
  var NAME_OURS = /cabinet|casework|millwork|kitchen|carpentry|06[ _-]?41|06[ _-]?20|12[ _-]?35|interior[ _-]?elev|enlarged|unit[ _-]?(plan|matrix|mix)|finish[ _-]?sched|bid[ _-]?form|scope|instructions|itb|rfp|rfq/i;
  var NAME_OTHER = /mep|mechanical|electrical|plumbing|structural|civil|fire[ _-]?(alarm|protection)|sprinkler|hvac|geotech|survey|landscape/i;

  function squeeze(t) { return String(t || "").toUpperCase().replace(/\s+/g, " "); }

  function countHits(text, rules, out) {
    var score = 0;
    rules.forEach(function (r) {
      var m = text.match(r[0]);
      if (!m) return;
      score += r[1] * Math.min(3, m.length);
      if (out.indexOf(r[2]) === -1) out.push(r[2]);
    });
    return score;
  }

  /* One page's text -> { score, why[], textless }. */
  function scorePage(text) {
    var t = squeeze(text);
    var why = [];
    if (t.replace(/[^A-Z0-9]/g, "").length < 25) return { score: 0, why: why, textless: true };
    var ours = countHits(t, STRONG, why);
    var money = countHits(t, MONEY, why);
    var score = ours + money;
    var other = (t.match(OTHER) || []).length;
    if (other >= 4 && ours < 12) score = score * 0.3;
    return { score: Math.round(score * 10) / 10, why: why, textless: false };
  }

  function scoreFileName(name) {
    var n = String(name || "");
    if (NAME_OTHER.test(n) && !NAME_OURS.test(n)) return -1;
    return NAME_OURS.test(n) ? 1 : 0;
  }

  /* pages: [{ file (index), page (1-based), score, textless, name }]
     Returns the pages to keep, in file order then page order. When every page
     fits, every page is kept - nothing is thrown away that did not need to be.
     A scanned file (no text anywhere) keeps all its pages when its name says
     it is ours, else only its first page (the cover / sheet index). The first
     page of every file gets a small score, so the sheet index is read. */
  function pickPages(pages, opts) {
    var max = (opts && opts.max) || MAX_PAGES;
    var all = (opts && opts.mode) === "all";
    var list = (pages || []).map(function (p) { return Object.assign({}, p); });
    if (list.length <= max) return list.map(function (p) { p.keep = "all"; return p; });

    var textlessFile = {};
    list.forEach(function (p) {
      if (!(p.file in textlessFile)) textlessFile[p.file] = true;
      if (!p.textless) textlessFile[p.file] = false;
    });
    list.forEach(function (p) {
      var s = Number(p.score) || 0;
      if (all) s = 1;
      else if (textlessFile[p.file]) s = scoreFileName(p.name) > 0 ? 4 : (p.page === 1 ? 2 : 0);
      else if (p.page === 1) s = Math.max(s, 2);
      p.rank = s;
    });
    var picked = list.filter(function (p) { return p.rank > 0; });
    if (all) picked = list.slice();
    picked.sort(function (a, b) { return b.rank - a.rank || a.file - b.file || a.page - b.page; });
    picked = picked.slice(0, max);
    picked.sort(function (a, b) { return a.file - b.file || a.page - b.page; });
    return picked;
  }

  /* When the kept pages are too heavy (big drawing sheets), drop the
     lowest-ranked ones: keep the best `n`. Order stays file / page. */
  function trimTo(picked, n) {
    var best = picked.slice().sort(function (a, b) { return (b.rank || 0) - (a.rank || 0) || a.file - b.file || a.page - b.page; }).slice(0, Math.max(1, n));
    return best.sort(function (a, b) { return a.file - b.file || a.page - b.page; });
  }

  /* The ASCII line stamped at the top of each kept page, so the AI (and he)
     can always tell where the page came from. The standard PDF font has no
     non-Latin letters, so the name is reduced to plain characters. */
  function stampText(name, page, i) {
    var n = String(name || "file").replace(/[^\x20-\x7E]/g, "_").slice(0, 70);
    return "PAGE " + i + "  |  SOURCE: " + n + "  p." + page;
  }

  /* "p.1 = SOW.pdf p.1" lines for the prompt. */
  function pageMapText(picked, names) {
    return (picked || []).map(function (p, i) {
      return "p." + (i + 1) + " = " + String((names && names[p.file]) || p.name || "file") + " p." + p.page;
    }).join("\n");
  }

  /* ONE DRAFT ESTIMATE PER KITCHEN TYPE: what create-estimate is sent.
     The description is what the estimator reads and prices: the count, one
     kitchen's contents, who supplies the boxes, what is not ours, the rules.
     No price in it - the estimate system makes the price. */
  function clip(s, n) { s = String(s == null ? "" : s).replace(/\s*\blicensed\b/gi, "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function draftFor(R, kt) {
    var P = (R && R.project) || {};
    var n = kt && kt.count != null ? kt.count : null;
    var name = clip(kt && kt.name, 40) || "Kitchen";
    var proj = clip(P.name, 60) || "Bid package";
    var out = [];
    out.push("BID FOR A GENERAL CONTRACTOR - kitchen cabinet installation, multifamily building.");
    out.push("Project: " + proj + (P.address ? ", " + clip(P.address, 100) : "") + (P.gc ? ". General contractor: " + clip(P.gc, 80) : "") + (P.bid_due ? ". Bids due: " + clip(P.bid_due, 60) : "") + ".");
    out.push("Kitchen type " + name + (kt.description ? " (" + clip(kt.description, 120) + ")" : "") + ": " + (n != null ? n + " kitchens" : "count not confirmed") + (kt.units && kt.units.length ? " - units " + kt.units.slice(0, 12).join(", ") : "") + ".");
    if (kt.count_source) out.push("How they were counted: " + clip(kt.count_source, 200) + ".");
    if (n != null) out.push("Price all " + n + " kitchens of this type: the work of one kitchen times " + n + ".");
    var items = (kt.items || []).slice(0, 30).map(function (it) { return "- " + clip(it.item, 70) + (it.qty != null ? ": " + it.qty + " " + (it.unit || "EA") : ""); });
    if (items.length) out.push("In ONE kitchen:\n" + items.join("\n"));
    else out.push("The cabinet list for one kitchen was not found in the pages - read the attached drawings.");
    out.push(R.supply === "install_only" ? "Cabinets are supplied by others - we install only (unload, distribute to the units, assemble if needed, install, adjust, hardware)." : R.supply === "furnish_and_install" ? "We furnish and install the cabinets." : "Who supplies the cabinets is not clear yet - price the installation, and list the question.");
    var specs = (R.specs || []).map(function (s) { return clip((s.section ? s.section + " " : "") + (s.requirements || []).slice(0, 4).join("; "), 200); }).filter(Boolean).slice(0, 4);
    if (specs.length) out.push("Spec requirements: " + specs.join(" | ") + ".");
    var notOurs = (R.not_in_our_scope || []).slice(0, 8).map(function (x) { return clip(x, 90); });
    if (!notOurs.some(function (x) { return /gas/i.test(x); })) notOurs.push("Gas appliances - set and connected by the gas trade");
    out.push("Not in our work: " + notOurs.join("; ") + ".");
    var rules = (R.requirements || []).filter(function (r) { return /retainage|payment|insurance|bond|schedule|wage|site/.test(r.category); }).slice(0, 6).map(function (r) { return clip(r.text, 110); });
    if (rules.length) out.push("Bid rules: " + rules.join("; ") + ".");
    (kt.notes || []).slice(0, 3).forEach(function (x) { out.push("Note: " + clip(x, 160)); });
    out.push("The bid pages for this kitchen type are attached as a PDF.");
    var description = out.join("\n");
    if (description.length > 1990) description = description.slice(0, 1989) + "…";
    return {
      service: "Carpentry",
      projectTitle: clip("Kitchen type " + name + (n != null ? " - " + n + " kitchens" : "") + " - " + proj, 110),
      description: description
    };
  }

  var api = { MAX_PAGES: MAX_PAGES, MAX_BYTES: MAX_BYTES, scorePage: scorePage, scoreFileName: scoreFileName, pickPages: pickPages, trimTo: trimTo, stampText: stampText, pageMapText: pageMapText, draftFor: draftFor };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BidTriage = api;
})(this);
