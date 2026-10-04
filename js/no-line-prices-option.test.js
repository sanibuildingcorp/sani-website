// The "...with prices" choices under Labor/Materials breakdown were removed:
// a breakdown lists WHAT is included, never what each line costs.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "dashboard.html"), "utf8");

assert.ok(!/data-kind="laborLinePrices"/.test(html), "labor ...with prices row is gone");
assert.ok(!/data-kind="materialLinePrices"/.test(html), "materials ...with prices row is gone");
assert.ok(/data-kind="laborLines"/.test(html) && /data-kind="materialLines"/.test(html), "the breakdown choices stay");

/* An older estimate that had one on is switched off when it opens. */
const m = html.match(/if \(est\.showLaborLinePrices === true \|\| est\.showMaterialLinePrices === true\) \{[\s\S]*?\n  \}/);
assert.ok(m, "renderEdit switches old line-price choices off");
const est = { showLaborLinePrices: true, showMaterialLinePrices: false };
new Function("est", m[0])(est);
assert.strictEqual(est.showLaborLinePrices, false);
assert.strictEqual(est.showMaterialLinePrices, false);

console.log("no-line-prices-option: ok");
