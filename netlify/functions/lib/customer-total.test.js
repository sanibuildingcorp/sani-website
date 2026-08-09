// netlify/functions/lib/customer-total.test.js
//
// CONFORMANCE TEST.  Run:  node netlify/functions/lib/customer-total.test.js
//
// customer-total.js is the single definition of the customer-facing total, and
// every Netlify function imports it. The two HTML pages cannot: a browser page
// cannot require a Node module, and quote.html carries no <script src> at all
// because it is the one page that must render for a customer no matter what.
//
// So quote.html's calc() and dashboard.html's calcCustomerView() are deliberate
// copies - and copies drift. This test extracts them from the real files and
// asserts they agree with the library across every toggle state and every
// degenerate estimate. If someone edits one and not the others, this fails.
//
// Note: the pages are compared against computedCustomerTotal, not customerTotal.
// A stamped record.customerFinalTotal is a record-level fact; quote.html applies
// it after calc() the same way the library does, and dashboard.html deliberately
// ignores it because the contractor is editing the lines it would override.

"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const customerTotals = require("./customer-total");

const ROOT = path.join(__dirname, "..", "..", "..");

function extractBraced(src, signature) {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error("could not find: " + signature);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error("unbalanced braces after: " + signature);
}

// ---- quote.html calc() ----------------------------------------------------
const quoteSrc = fs.readFileSync(path.join(ROOT, "quote.html"), "utf8");
const quoteCtx = { rec: null, Math: Math, Number: Number, Array: Array, String: String };
vm.createContext(quoteCtx);
vm.runInContext(
  "const A=v=>Array.isArray(v)?v:[];const LT=l=>(+l.qty||0)*(+l.rate||0);\n" +
  extractBraced(quoteSrc, "function calc(e){"),
  quoteCtx, { filename: "quote.html" }
);

// ---- dashboard.html calcTotal() + calcCustomerView() ----------------------
const dashSrc = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");
const dashCtx = { Math: Math, Number: Number, Array: Array, String: String };
vm.createContext(dashCtx);
vm.runInContext(
  extractBraced(dashSrc, "function calcTotal(est) {") + "\n" +
  extractBraced(dashSrc, "function calcCustomerView(est) {"),
  dashCtx, { filename: "dashboard.html" }
);

// ---- fixtures -------------------------------------------------------------
const L = (q, r) => ({ item: "labor line", qty: q, rate: r, unit: "hrs", section: "Staircases" });
const M = (q, r) => ({ item: "material line", qty: q, rate: r, unit: "ea", section: "Staircases" });

const SHAPES = [
  ["SBC-260809-VUUI", { labor: [L(19868, 1)], materials: [M(17826, 1)], markupPct: 25 }],
  ["no materials",    { labor: [L(19868, 1)], materials: [],            markupPct: 25 }],
  ["no labor",        { labor: [],            materials: [M(17826, 1)], markupPct: 25 }],
  ["no lines",        { labor: [],            materials: [],            markupPct: 25 }],
  ["zero markup",     { labor: [L(1000, 1)],  materials: [M(500, 1)],   markupPct: 0 }],
  ["missing markup",  { labor: [L(1000, 1)],  materials: [M(500, 1)] }],
  ["fractional",      { labor: [L(3, 66.67)], materials: [M(7, 12.345)], markupPct: 18.5 }],
  ["junk qty/rate",   { labor: [{ item: "x", qty: "abc", rate: null }], materials: [M(100, 1)], markupPct: 25 }],
];
const TOGGLES = [
  ["labor only",     { showLaborCost: true,  showMaterialsCost: false }],
  ["materials only", { showLaborCost: false, showMaterialsCost: true }],
  ["both",           { showLaborCost: true,  showMaterialsCost: true }],
  ["neither",        { showLaborCost: false, showMaterialsCost: false }],
  ["displayMode total", { displayMode: "total" }],
  ["displayMode full",  { displayMode: "full" }],
  ["no flags at all",   {}],
];

let checks = 0, failures = 0;
function agree(label, a, b) {
  checks++;
  if (Math.abs(a - b) > 0.005) {
    failures++;
    console.log("  FAIL  " + label + "   library " + a.toFixed(2) + "   page " + b.toFixed(2));
  }
}

SHAPES.forEach(function (pair) {
  const shapeName = pair[0], shape = pair[1];
  TOGGLES.forEach(function (tpair) {
    const toggleName = tpair[0], toggles = tpair[1];
    const est = Object.assign({}, shape, toggles);
    const lib = customerTotals(est);
    const label = (shapeName + " / " + toggleName).padEnd(40);

    quoteCtx.rec = null;
    quoteCtx.__e = est;
    const qc = vm.runInContext("calc(__e)", quoteCtx);
    agree(label + " quote.html total    ", lib.computedCustomerTotal, qc.total);
    agree(label + " quote.html grand    ", lib.grandTotal, qc.grand);
    checks++;
    if (qc.showLabor !== lib.showLabor || qc.showMat !== lib.showMaterials || qc.bothHidden !== lib.bothHidden) {
      failures++;
      console.log("  FAIL  " + label + " quote.html display flags disagree");
    }

    dashCtx.__e = est;
    const dc = vm.runInContext("calcCustomerView(__e)", dashCtx);
    agree(label + " calcCustomerView    ", lib.computedCustomerTotal, dc.customerTotal);
    agree(label + " calcCustomerView lab", lib.showLabor ? lib.laborAmount : 0, dc.laborAmount);
    agree(label + " calcCustomerView mat", lib.showMaterials ? lib.materialsAmount : 0, dc.materialsAmount);
    checks++;
    if (dc.showLabor !== lib.showLabor || dc.showMaterials !== lib.showMaterials || dc.bothHidden !== lib.bothHidden) {
      failures++;
      console.log("  FAIL  " + label + " calcCustomerView display flags disagree");
    }

    // When both buckets are shown they must sum to the total, to the cent.
    if (lib.showLabor && lib.showMaterials) {
      agree(label + " rows sum to total   ", lib.customerTotal, lib.laborAmount + lib.materialsAmount);
    }
  });
});

// ---- stamped totals are validated identically ------------------------------
const base = { labor: [L(19868, 1)], materials: [M(17826, 1)], markupPct: 25, showLaborCost: true, showMaterialsCost: true };
[[30000, 30000], [60000, 60000], [0, 47117.5], [-500, 47117.5], ["abc", 47117.5], [null, 47117.5]].forEach(function (p) {
  const stamp = p[0], want = p[1];
  const lib = customerTotals(base, stamp === null ? {} : { customerFinalTotal: stamp });
  agree(("stamped " + JSON.stringify(stamp)).padEnd(40) + " library             ", want, lib.customerTotal);
  quoteCtx.rec = stamp === null ? {} : { customerFinalTotal: stamp };
  quoteCtx.__e = base;
  agree(("stamped " + JSON.stringify(stamp)).padEnd(40) + " quote.html          ", want, vm.runInContext("calc(__e)", quoteCtx).total);
});

console.log("\n  " + (checks - failures) + " / " + checks + " conformance checks passed");
if (failures) {
  console.log("\n  The pages and netlify/functions/lib/customer-total.js have DRIFTED.");
  process.exit(1);
}
