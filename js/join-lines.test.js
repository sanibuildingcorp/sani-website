/* join-lines.test.js — run: node js/join-lines.test.js
 *
 *   "There is a so many double times with different prices" - one shared line
 *   (debris, protection, cleanup) split into 0.77 hrs + 2.23 hrs on ONE card.
 *   Same card, words, unit and rate -> one line, same money.
 *   (The estimate screen went back to the version before the tabs; the join
 *   runs on new estimates only.)
 */
"use strict";
const fs = require("fs"), path = require("path");
const { joinSameLines } = require("../netlify/functions/lib/join-lines");
const GEN = fs.readFileSync(path.join(__dirname, "..", "netlify", "functions", "generate-estimate-background.js"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? "PASS  " : "FAIL  ") + n + (d ? "\n        " + d : "")); };

const L = () => [
  { section: "Bathroom", item: "Bag debris and carry out through the service elevator", qty: 0.77, unit: "hrs", rate: 41.6, sbcSharedSplit: true },
  { section: "Bathroom", item: "Bag debris and carry out through the service elevator", qty: 2.23, unit: "hrs", rate: 41.6, sbcSharedSplit: true },
  { section: "Bathroom", item: "Debris haul-away and dump fee, small load", qty: 0.26, unit: "load", rate: 185 },
  { section: "Bathroom", item: "Debris haul-away and dump fee, small load", qty: 0.74, unit: "load", rate: 185 },
  { section: "Tile", item: "Bag debris and carry out through the service elevator", qty: 1, unit: "hrs", rate: 41.6 },
  { section: "Bathroom", item: "Tile installation", qty: 10, unit: "hrs", rate: 62.4 },
  { section: "Bathroom", item: "Tile installation", qty: 4, unit: "hrs", rate: 41.6 },
];
const money = (a) => Math.round(a.reduce((s, l) => s + l.qty * l.rate, 0) * 100) / 100;

[["server lib", joinSameLines]].forEach(([who, join]) => {
  const before = L(), after = join(before);
  ok(who + ": the split pieces on one card are one line", after.filter((l) => /Bag debris/.test(l.item) && l.section === "Bathroom").length === 1 && after.filter((l) => /haul-away/.test(l.item)).length === 1);
  ok(who + ": ...with the whole quantity", after.find((l) => /Bag debris/.test(l.item) && l.section === "Bathroom").qty === 3 && after.find((l) => /haul-away/.test(l.item)).qty === 1);
  ok(who + ": the money is exactly the same", money(after) === money(before), money(before) + " vs " + money(after));
  ok(who + ": a line on another card stays apart", after.filter((l) => l.section === "Tile").length === 1);
  ok(who + ": a different rate stays apart", after.filter((l) => l.item === "Tile installation").length === 2);
  ok(who + ": the input is not changed", before.length === 7 && before[0].qty === 0.77);
});

ok("a new estimate is joined before it is saved", /estimate = consolidateCustomerPresentation\(estimate, projectAnalysis, input\);\n[^\n]*\n\s*estimate = joinEstimateLines\(estimate\);/.test(GEN));

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
