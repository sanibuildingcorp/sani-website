/* generate-unchecked.test.js — run: node js/generate-unchecked.test.js
 *
 *   "Keep everything is it at this moment but just make sure ones generate
 *    keeps all check box unchecked"
 *
 * Generate / Regenerate: Customer View Mode comes back all unchecked (the
 * customer sees one total, everything included), even when the last draft had
 * boxes checked. Adding a service keeps his boxes. Nothing else changes.
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const GEN = fs.readFileSync(path.join(ROOT, "netlify", "functions", "generate-estimate-background.js"), "utf8");
const D = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? "PASS  " : "FAIL  ") + n + (d ? "\n        " + d : "")); };
const FLAGS = ["showLaborCost", "showMaterialsCost", "showSectionSubtotals", "showLaborLines", "showMaterialLines", "showLaborLinePrices", "showMaterialLinePrices"];

ok("the generator lists all seven boxes", new RegExp("const VIEW_FLAGS = \\[" + FLAGS.map((f) => '"' + f + '"').join(", ") + "\\]").test(GEN));
const iKeep = GEN.indexOf("preserveContractorFields(carry.previous, estimate);"), iReset = GEN.indexOf("VIEW_FLAGS.forEach(function (k) { estimate[k] = false; });");
ok("...and unchecks them AFTER the old draft's settings are carried over, so the old boxes cannot come back", iKeep > 0 && iReset > iKeep && iReset - iKeep < 900 && /estimate\.viewReset = true;/.test(GEN));
ok("...only on a generation, not when a service is added", GEN.lastIndexOf("if (addSvc) {", iReset) > 0 && GEN.indexOf("} else {", GEN.lastIndexOf("if (addSvc) {", iReset)) < iReset);

/* the dashboard's own carry-over */
const cut = (name) => { const s = D.search(new RegExp("^function " + name + "\\s*\\(", "m")); let d = 0; for (let j = D.indexOf("{", s); j < D.length; j++) { if (D[j] === "{") d++; else if (D[j] === "}") { d--; if (!d) return D.slice(s, j + 1); } } };
const arr = D.match(/var CONTRACTOR_OWNED_ESTIMATE_FIELDS = \[[\s\S]*?\];/)[0];
const ctx = { renderEdit() {}, console };
vm.createContext(ctx);
vm.runInContext(arr + "\n" + cut("normalizeDisplayFlags") + "\n" + cut("applyGeneratedEstimate"), ctx);
const checked = () => Object.assign({ labor: [{ item: "x" }], contract: { on: true } }, ...FLAGS.map((f) => ({ [f]: true })));
ctx.currentRecord = { estimate: checked(), status: "drafted" };
vm.runInContext("applyGeneratedEstimate(" + JSON.stringify({ status: "drafted", estimate: Object.assign({ labor: [{ item: "new" }], viewReset: true }, ...FLAGS.map((f) => ({ [f]: false }))) }) + ")", ctx);
const e = ctx.currentRecord.estimate;
ok("Regenerate in the dashboard: every box unchecked", FLAGS.every((f) => e[f] === false), JSON.stringify(FLAGS.map((f) => e[f])));
ok("...his other settings still carried over (contract)", e.contract && e.contract.on === true && e.viewReset === undefined);

ctx.currentRecord = { estimate: checked(), status: "drafted" };
vm.runInContext("applyGeneratedEstimate(" + JSON.stringify({ status: "drafted", estimate: { labor: [{ item: "merged" }], showLaborCost: true, showSectionSubtotals: true } }) + ", true)", ctx);
ok("adding a service keeps his boxes", ctx.currentRecord.estimate.showLaborCost === true && ctx.currentRecord.estimate.showSectionSubtotals === true);

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
