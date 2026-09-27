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

  /* ONE DRAFT ESTIMATE FOR THE WHOLE BID - one service card per kitchen type.

       "it was maked several estimate draft in dashboard, it split for couple
        different projects" - eight $0 drafts for one building, one per
        kitchen type. One bid is one estimate now: every kitchen type is a
        service of it (its own card and price), the GC and the address once.

     The description is what the estimator reads and prices; the full
     takeoff goes with the bid pages as an attached PDF (takeoffLines), so a
     long package loses nothing to the description's length. No price in it -
     the estimate system makes the price. */
  var DESC_MAX = 2990;   /* the estimate keeps 3,000 characters of description */
  function clip(s, n) { s = String(s == null ? "" : s).replace(/\s*\blicensed\b/gi, "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, Math.max(0, n - 1)) + "…" : s; }

  /* A kitchen type's service name. The estimate splits its services on
     "," "/" and "&", so those never appear in a name ("Type 01
     (Kitchen/Kitchenette)" would have become two services). */
  function sectionNames(types) {
    var used = {};
    return (types || []).map(function (k, i) {
      var n = clip(String((k && k.name) || "").replace(/[,/&]+/g, " or "), 44) || ("Type " + (i + 1));
      if (!/^kitchen/i.test(n)) n = "Kitchen " + (/^type\b/i.test(n) ? n : "Type " + n);
      var base = n, j = 2;
      while (used[n.toLowerCase()]) n = base + " " + (j++);
      used[n.toLowerCase()] = true;
      return n;
    });
  }
  function countText(k) { return k && k.count != null ? k.count + (k.count === 1 ? " kitchen" : " kitchens") : "count not confirmed"; }
  function oneKitchen(k) {
    return (k.items || []).map(function (it) { return clip(it.item, 60) + (it.qty != null ? " x" + it.qty + (it.unit && it.unit !== "EA" ? " " + it.unit : "") : ""); }).join("; ");
  }

  function draftForBid(R, types) {
    R = R || {};
    types = (types || []).filter(Boolean);
    var P = R.project || {};
    var names = sectionNames(types);
    var proj = clip(P.name, 60) || "Bid package";
    var counted = types.filter(function (k) { return k.count != null; });
    var allCounted = types.length && counted.length === types.length;
    var total = counted.reduce(function (a, k) { return a + k.count; }, 0);
    var head = [];
    head.push("BID FOR A GENERAL CONTRACTOR - kitchen cabinet installation, multifamily building. ONE estimate for the whole bid: each kitchen type below is its own service - price each one in its own section, named exactly as the service.");
    head.push("Project: " + proj + (P.address ? ", " + clip(P.address, 100) : "") + (P.gc ? ". General contractor: " + clip(P.gc, 80) : "") + (P.bid_due ? ". Bids due: " + clip(P.bid_due, 60) : "") + ".");
    head.push(R.supply === "install_only" ? "Cabinets are supplied by others - we install only (unload, distribute to the units, assemble if needed, install, adjust, hardware)." : R.supply === "furnish_and_install" ? "We furnish and install the cabinets." : "Who supplies the cabinets is not clear yet - price the installation, and list the question.");
    head.push("Where a count is given, price all kitchens of that type: the work of one kitchen times the count. Where the count is not confirmed, price ONE kitchen of that type and say so in its section.");
    var tail = [];
    var notOurs = (R.not_in_our_scope || []).slice(0, 8).map(function (x) { return clip(x, 90); });
    if (!notOurs.some(function (x) { return /gas/i.test(x); })) notOurs.push("Gas appliances - set and connected by the gas trade");
    tail.push("Not in our work: " + notOurs.join("; ") + ".");
    var rules = (R.requirements || []).filter(function (r) { return /retainage|payment|insurance|bond|schedule|wage|site/.test(r.category); }).slice(0, 5).map(function (r) { return clip(r.text, 100); });
    if (rules.length) tail.push("Bid rules: " + rules.join("; ") + ".");
    tail.push("The full takeoff (every item, page and question) and the bid pages are attached as one PDF.");
    var fixed = head.join("\n").length + tail.join("\n").length + 2 + types.length;
    var room = Math.max(60, Math.floor((DESC_MAX - fixed) / Math.max(1, types.length)));
    var body = types.map(function (k, i) {
      var line = "- " + names[i] + (k.description ? " (" + clip(k.description, 70) + ")" : "") + ": " + countText(k) + (k.units && k.units.length ? ", units " + k.units.slice(0, 8).join(" ") : "") + ".";
      var one = oneKitchen(k);
      line += one ? " One kitchen: " + one + "." : " Cabinet list: read the attached pages.";
      return clip(line, room);
    });
    var description = head.concat(body, tail).join("\n");
    if (description.length > DESC_MAX) description = description.slice(0, DESC_MAX - 1) + "…";
    return {
      service: names.join(", "),
      sections: names,
      projectTitle: clip("Bid: " + proj + " - kitchen cabinets, " + types.length + (types.length === 1 ? " kitchen type" : " kitchen types") + (allCounted ? ", " + total + " kitchens" : ""), 110),
      description: description
    };
  }

  /* The full takeoff, line by line, for the PDF that goes with the draft.
     "# " starts a heading. */
  function takeoffLines(R, types) {
    R = R || {};
    var P = R.project || {}, out = [], names = sectionNames(types);
    var L = function (s) { s = clip(s, 600); if (s) out.push(s); };
    out.push("# BID TAKEOFF - " + clip(P.name || "Bid package", 80));
    L("Prepared by Sani Building Corp from the bid pages attached after this summary. A draft for review - not a price.");
    [["Address", P.address], ["Owner", P.owner], ["General contractor", P.gc], ["Architect", P.architect], ["Bids due", P.bid_due], ["Walkthrough", P.walkthrough]].forEach(function (x) { if (x[1]) L(x[0] + ": " + x[1]); });
    L("Who supplies the cabinets: " + (R.supply === "install_only" ? "others - we install only" : R.supply === "furnish_and_install" ? "we furnish and install" : "not clear yet") + (R.supply_note ? ". " + R.supply_note : ""));
    if (R.project_summary) L(R.project_summary);
    (types || []).forEach(function (k, i) {
      out.push("# " + names[i] + " - " + countText(k));
      if (k.description) L(k.description);
      if (k.count_source) L("Counted: " + k.count_source);
      if (k.units && k.units.length) L("Units: " + k.units.join(", "));
      if (k.pages && k.pages.length) L("Pages: " + k.pages.map(function (p) { return "p." + p; }).join(" "));
      (k.items || []).forEach(function (it) { L("- " + it.item + (it.qty != null ? ": " + it.qty + " " + (it.unit || "EA") : "") + (it.page ? " (p." + it.page + ")" : "")); });
      (k.notes || []).forEach(function (n) { L("Note: " + n); });
    });
    var list = function (title, arr, fmt) { arr = arr || []; if (!arr.length) return; out.push("# " + title); arr.forEach(function (x, i) { L(fmt(x, i)); }); };
    list("Other millwork", R.other_millwork, function (it) { return "- " + it.item + (it.qty != null ? ": " + it.qty + " " + (it.unit || "") : "") + (it.where ? " - " + it.where : "") + (it.page ? " (p." + it.page + ")" : ""); });
    list("Specs", R.specs, function (s) { return "- " + [s.section, s.title].filter(Boolean).join(" ") + (s.page ? " (p." + s.page + ")" : "") + ((s.requirements || []).length ? ": " + s.requirements.join("; ") : ""); });
    list("Not in our work", R.not_in_our_scope, function (x) { return "- " + x; });
    list("Bid rules", R.requirements, function (r) { return "- " + r.text + (r.page ? " (p." + r.page + ")" : ""); });
    list("Questions for the GC", R.questions_for_gc, function (q, i) { return (i + 1) + ". " + q.question; });
    list("Missing from the package", R.missing_information, function (x) { return "- " + x; });
    list("Assumed", R.assumptions, function (x) { return "- " + x; });
    return out;
  }

  var api = { MAX_PAGES: MAX_PAGES, MAX_BYTES: MAX_BYTES, scorePage: scorePage, scoreFileName: scoreFileName, pickPages: pickPages, trimTo: trimTo, stampText: stampText, pageMapText: pageMapText, sectionNames: sectionNames, draftForBid: draftForBid, takeoffLines: takeoffLines };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BidTriage = api;
})(this);
