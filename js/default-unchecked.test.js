/* default-unchecked.test.js — run: node js/default-unchecked.test.js
 *
 *   "Keep them always unchecked until i check them manually" - the price on
 *   each service card, the labor/material lists and their "...with prices".
 */
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const DASH = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");
const GEN = fs.readFileSync(path.join(ROOT, "netlify", "functions", "generate-estimate-background.js"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c) => { c === true ? pass++ : fail++; console.log((c === true ? "PASS  " : "FAIL  ") + n); };

/* The generator's step, run on a fresh draft and on one that carries his choice. */
const m = GEN.match(/\["showSectionSubtotals", "showLaborLines", "showMaterialLines", "showLaborLinePrices", "showMaterialLinePrices"\]\.forEach\(function \(k\) \{\n\s*if \(typeof estimate\[k\] !== "boolean"\) estimate\[k\] = false;\n\s*\}\);/);
ok("a new draft sets all five to unchecked", !!m);
if (m) {
  const fresh = {}; new Function("estimate", m[0])(fresh);
  ok("...fresh draft: all five false", ["showSectionSubtotals", "showLaborLines", "showMaterialLines", "showLaborLinePrices", "showMaterialLinePrices"].every((k) => fresh[k] === false));
  const his = { showLaborLines: true }; new Function("estimate", m[0])(his);
  ok("...a box he checked stays checked", his.showLaborLines === true && his.showSectionSubtotals === false);
}
ok("it runs before the draft is saved", GEN.indexOf("estimate[k] = false") < GEN.indexOf("record.estimate = estimate;"));

const d = DASH.match(/if \(!r\.sentAt && est\.showSectionSubtotals === undefined\) est\.showSectionSubtotals = false;/);
ok("dashboard: an unsent quote opens with the service-card price unchecked", !!d);
if (d) {
  const unsent = { est: {} }, sent = { est: {} };
  new Function("r", "est", d[0])({}, unsent.est);
  new Function("r", "est", d[0])({ sentAt: "2026-10-01T00:00:00Z" }, sent.est);
  ok("...unsent: unchecked", unsent.est.showSectionSubtotals === false);
  ok("...already sent: left as the customer saw it", sent.est.showSectionSubtotals === undefined);
}

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
