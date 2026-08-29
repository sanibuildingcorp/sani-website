// node netlify/functions/lib/quote-options.test.js
//
// The options a customer can add to their own job, and the ceiling that stops
// the number in their browser from becoming the number on the contract.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { optionId, optionLetter, collectOptions, resolveSelection, selectionSnapshot, finishUpgradeTotal } = require("./quote-options");

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
};

/* The three alternatives from the live bathroom estimate that started this. */
const EST = {
  markupPct: 0,
  showLaborCost: true,
  showMaterialsCost: true,
  labor: [{ qty: 1, unit: "ls", rate: 2000 }],
  materials: [{ qty: 1, unit: "ls", rate: 1710.55 }],
  serviceBreakdown: [{
    title: "Bathroom",
    subtotal: 3710.55,
    options: [
      { label: "Option A — NY State Article 32 assessment and contained remediation", description: "If affected area exceeds 10 sq ft", price: 3850 },
      { label: "Option B — Repaint bathroom walls to match the refreshed ceiling", description: "", price: 1180 },
      { label: "Option C — Camera inspection of the waste line serving the fixtures", description: "", price: 675 },
    ],
  }],
};
const ID = (l) => optionId(l);
const A_ID = ID("Option A — NY State Article 32 assessment and contained remediation");
const B_ID = ID("Option B — Repaint bathroom walls to match the refreshed ceiling");
const C_ID = ID("Option C — Camera inspection of the waste line serving the fixtures");

console.log("\nquote-options\n");

/* ── ids ───────────────────────────────────────────────────────────────── */
t("the same label always gives the same id", () => {
  assert.strictEqual(ID("Option A — Do the thing"), ID("Option A — Do the thing"));
});
t("whitespace and case do not change the id", () => {
  assert.strictEqual(ID("Option A — Do the thing"), ID("  option a — DO   the thing  "));
});
t("two different labels give different ids", () => {
  assert.notStrictEqual(A_ID, B_ID);
});
t("two long labels sharing their first 40 characters stay distinct", () => {
  const a = "Option A — a very long alternative label that runs on and on, first variant";
  const b = "Option A — a very long alternative label that runs on and on, second variant";
  assert.notStrictEqual(ID(a), ID(b));
});
t("an id is url- and attribute-safe", () => {
  assert.ok(/^opt-[a-z0-9-]+$/.test(A_ID), A_ID);
});
t("the option letter is read off the label", () => {
  assert.strictEqual(optionLetter("Option A — whatever"), "A");
  assert.strictEqual(optionLetter("option c: camera"), "C");
  assert.strictEqual(optionLetter("Upgrade the tile"), "");
});

/* ── collecting ────────────────────────────────────────────────────────── */
t("every option on the estimate is collected", () => {
  const all = collectOptions(EST);
  assert.strictEqual(all.length, 3);
  assert.deepStrictEqual(all.map((o) => o.letter), ["A", "B", "C"]);
  assert.deepStrictEqual(all.map((o) => o.price), [3850, 1180, 675]);
  assert.deepStrictEqual(all.map((o) => o.section), ["Bathroom", "Bathroom", "Bathroom"]);
});
t("estimate.options is collected too", () => {
  const all = collectOptions({ options: [{ section: "Windows", label: "Option A — Replace all windows", price: 900 }] });
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].section, "Windows");
});
t("an option written in both places is one option, not two", () => {
  const est = {
    serviceBreakdown: [{ title: "Bathroom", options: [{ label: "Option A — Remediation", price: 3850 }] }],
    options: [{ section: "Bathroom", label: "Option A — Remediation", price: 3850 }],
  };
  assert.strictEqual(collectOptions(est).length, 1);
});
t("the deterministic breakdown supplies the price when both wrote it", () => {
  const est = {
    serviceBreakdown: [{ title: "Bathroom", options: [{ label: "Option A — Remediation", price: 3850 }] }],
    options: [{ section: "Bathroom", label: "Option A — Remediation", price: 99 }],
  };
  assert.strictEqual(collectOptions(est)[0].price, 3850);
});
t("an option with no label is not an option", () => {
  assert.strictEqual(collectOptions({ options: [{ label: "  ", price: 500 }] }).length, 0);
});
t("an estimate with no options collects nothing, and does not throw", () => {
  assert.deepStrictEqual(collectOptions({}), []);
  assert.deepStrictEqual(collectOptions(null), []);
  assert.deepStrictEqual(collectOptions({ serviceBreakdown: "nonsense", options: 7 }), []);
});

/* ── resolving what the browser sent ───────────────────────────────────── */
t("two selected options add up", () => {
  const r = resolveSelection(EST, [A_ID, C_ID]);
  assert.strictEqual(r.selected.length, 2);
  assert.strictEqual(r.total, 4525);
});
t("all three can be taken together", () => {
  assert.strictEqual(resolveSelection(EST, [A_ID, B_ID, C_ID]).total, 5705);
});
t("selecting nothing costs nothing", () => {
  assert.strictEqual(resolveSelection(EST, []).total, 0);
  assert.strictEqual(resolveSelection(EST, null).total, 0);
});
t("the same id twice is one option, not two", () => {
  const r = resolveSelection(EST, [A_ID, A_ID, A_ID]);
  assert.strictEqual(r.selected.length, 1);
  assert.strictEqual(r.total, 3850);
});
t("an id this record does not have is reported, never priced", () => {
  const r = resolveSelection(EST, [A_ID, "opt-invented-by-a-browser-9z9z"]);
  assert.strictEqual(r.total, 3850);
  assert.deepStrictEqual(r.unknown, ["opt-invented-by-a-browser-9z9z"]);
});
t("junk ids do not throw", () => {
  const r = resolveSelection(EST, [null, "", 7, {}, []]);
  assert.strictEqual(r.total, 0);
});
t("a flood of ids is capped", () => {
  const many = [];
  for (let i = 0; i < 500; i++) many.push("opt-junk-" + i);
  assert.ok(resolveSelection(EST, many).unknown.length <= 40);
});
t("the snapshot keeps label and price, not just the id", () => {
  const snap = selectionSnapshot(resolveSelection(EST, [A_ID]).selected);
  assert.strictEqual(snap.length, 1);
  assert.strictEqual(snap[0].price, 3850);
  assert.ok(snap[0].label.indexOf("Article 32") !== -1);
  assert.strictEqual(snap[0].section, "Bathroom");
});

/* ══ THE CEILING ═══════════════════════════════════════════════════════════
   acceptFinalTotal lives in quote-response.js. It is lifted out and executed
   here rather than reimplemented, because the thing under test is the exact
   arithmetic that decides what a customer is charged. */
const QR = fs.readFileSync(path.join(__dirname, "..", "quote-response.js"), "utf8");
function ext(src, name) {
  const s = src.search(new RegExp("function " + name + "\\("));
  if (s < 0) throw new Error("missing " + name);
  let d = 0;
  for (let j = src.indexOf("{", s); j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) return src.slice(s, j + 1); }
  }
}
const ctx = {
  require, module: { exports: {} }, console, Math, Date, Number, String, Array, Object,
  customerTotals: require("./customer-total"),
  resolveSelection, selectionSnapshot, finishUpgradeTotal,
};
vm.createContext(ctx);
vm.runInContext(ext(QR, "applyOptionSelection") + "\n" + ext(QR, "acceptFinalTotal"), ctx);
const acceptFinalTotal = ctx.acceptFinalTotal;

/* customerTotals on EST: labor 2000 + materials 1710.55, markup 0, both shown. */
const BASE = 3710.55;
const rec = () => ({ estimate: JSON.parse(JSON.stringify(EST)) });

console.log("\nthe ceiling on what a customer can submit\n");

t("the quoted total with no options is accepted", () => {
  const r = rec(); acceptFinalTotal(r, BASE, []);
  assert.strictEqual(r.customerFinalTotal, BASE);
  assert.ok(!r.rejectedFinalTotal);
});
t("the quote plus a chosen option is accepted", () => {
  const r = rec(); acceptFinalTotal(r, BASE + 3850, [A_ID]);
  assert.strictEqual(r.customerFinalTotal, 7560.55);
  assert.ok(!r.rejectedFinalTotal);
});
t("the quote plus two chosen options is accepted", () => {
  const r = rec(); acceptFinalTotal(r, BASE + 4525, [A_ID, C_ID]);
  assert.strictEqual(r.customerFinalTotal, 8235.55);
});
t("below the quote is refused and the quote stands", () => {
  const r = rec(); acceptFinalTotal(r, 100, []);
  assert.strictEqual(r.customerFinalTotal, BASE);
  assert.strictEqual(r.rejectedFinalTotal.reason, "below the quoted total");
});
t("ABOVE the quote with no option to justify it is refused", () => {
  // The old rule accepted anything at or above the quote. It would have written
  // a million dollars onto the contract.
  const r = rec(); acceptFinalTotal(r, 1000000, []);
  assert.strictEqual(r.customerFinalTotal, BASE);
  assert.strictEqual(r.rejectedFinalTotal.reason, "above the quote plus the options selected");
  assert.strictEqual(r.rejectedFinalTotal.allowedAtMost, BASE);
});
t("a total above the quote plus what was chosen is clamped to the ceiling", () => {
  const r = rec(); acceptFinalTotal(r, BASE + 3850 + 500, [A_ID]);
  assert.strictEqual(r.customerFinalTotal, 7560.55);
  assert.strictEqual(r.rejectedFinalTotal.allowedAtMost, 7560.55);
});
t("claiming an option the record does not have buys nothing", () => {
  const r = rec(); acceptFinalTotal(r, BASE + 3850, ["opt-i-made-this-up-abc"]);
  assert.strictEqual(r.customerFinalTotal, BASE, "an invented id must not raise the ceiling");
  assert.deepStrictEqual(r.rejectedOptionSelections.ids, ["opt-i-made-this-up-abc"]);
});
t("the price comes from the record, never from the browser", () => {
  // The browser says Option C is worth 50,000. The record says 675.
  const r = rec(); acceptFinalTotal(r, BASE + 50000, [C_ID]);
  assert.strictEqual(r.customerFinalTotal, round(BASE + 675));
});
t("what was chosen is recorded even when the arithmetic is refused", () => {
  const r = rec(); acceptFinalTotal(r, 100, [A_ID]);
  assert.strictEqual(r.customerOptionSelections.length, 1);
  assert.strictEqual(r.customerOptionTotal, 3850);
});
t("choosing nothing clears a previous selection", () => {
  const r = rec();
  acceptFinalTotal(r, BASE + 3850, [A_ID]);
  acceptFinalTotal(r, BASE, []);
  assert.deepStrictEqual(r.customerOptionSelections, []);
  assert.strictEqual(r.customerFinalTotal, BASE);
});
t("a request that carries no selections at all leaves the old behaviour alone", () => {
  const r = rec(); acceptFinalTotal(r, BASE);
  assert.strictEqual(r.customerFinalTotal, BASE);
  assert.strictEqual(r.customerOptionSelections, undefined);
});
t("no total submitted still records the selection", () => {
  const r = rec(); acceptFinalTotal(r, null, [A_ID]);
  assert.strictEqual(r.customerOptionTotal, 3850);
  assert.strictEqual(r.customerFinalTotal, undefined);
});
t("a non-numeric total is refused", () => {
  const r = rec(); acceptFinalTotal(r, "free", []);
  assert.strictEqual(r.rejectedFinalTotal.reason, "not a positive number");
  assert.strictEqual(r.customerFinalTotal, undefined);
});
t("an estimate with no lines trusts nothing", () => {
  const r = { estimate: { labor: [], materials: [] } };
  acceptFinalTotal(r, 5000, []);
  assert.strictEqual(r.customerFinalTotal, undefined);
  assert.strictEqual(r.rejectedFinalTotal.reason, "no server-side total to check against");
});

/* ══ THE CONTRACT HAS TO SAY WHAT IT CHARGES FOR ═══════════════════════════
   The added options are already in the contract total. A contract that charges
   $3,850 for Article 32 remediation and never mentions it in the scope is a
   dispute the customer would win. The prompt asks the model to include them;
   this code decides. */
console.log("\nthe contract scope carries the options the customer paid for\n");
const GC = fs.readFileSync(path.join(__dirname, "..", "generate-contract-background.js"), "utf8");
const withAddedOptions = (function () {
  const c = { module: { exports: {} }, String, Array, RegExp };
  vm.createContext(c);
  vm.runInContext(ext(GC, "withAddedOptions") + "; this.f = withAddedOptions;", c);
  return c.f;
})();

t("an option the model left out is appended verbatim", () => {
  const out = withAddedOptions(["Demolition of existing tile", "Install new waterproofing"],
    ["Option A — NY State Article 32 assessment and contained remediation"]);
  assert.strictEqual(out.length, 3);
  assert.ok(out[2].indexOf("Article 32") !== -1);
});
t("an option the model DID write, in its own words, is not duplicated", () => {
  const out = withAddedOptions(
    ["Perform NY State Article 32 assessment with contained remediation as specified"],
    ["Option A — NY State Article 32 assessment and contained remediation"]);
  assert.strictEqual(out.length, 1);
});
t("two added options both land", () => {
  const out = withAddedOptions(["Demolition"], [
    "Option A — NY State Article 32 assessment and contained remediation",
    "Option C — Camera inspection of the waste line serving the fixtures",
  ]);
  assert.strictEqual(out.length, 3);
});
t("no added options changes nothing", () => {
  // Arrays come back from the vm realm, so compare contents, not identity.
  assert.strictEqual(withAddedOptions(["a", "b"], []).join("|"), "a|b");
  assert.strictEqual(withAddedOptions(["a"], null).join("|"), "a");
});
t("an empty scope still gets the options", () => {
  assert.strictEqual(withAddedOptions([], ["Option B — Repaint the walls to match"]).length, 1);
});
t("junk scope does not throw", () => {
  assert.strictEqual(withAddedOptions(null, []).length, 0);
  assert.strictEqual(withAddedOptions("nonsense", ["Option A — do it"]).length, 1);
});

/* ══ FINISH UPGRADES ═══════════════════════════════════════════════════════
   The older mechanism, and the one the first version of this ceiling broke: a
   customer who swaps to a dearer tile legitimately submits a total above the
   quote, and clamping that back down costs the contractor the upgrade. */
console.log("\nfinish upgrades raise the ceiling too\n");

const WITH_GROUPS = Object.assign({}, EST, {
  finishGroups: [{ name: "Wall tile", options: [
    { name: "Standard ceramic", isDefault: true, upgrade: 0 },
    { name: "Large-format porcelain", upgrade: 1200 },
  ] }],
});

t("no finish selections add nothing", () => {
  assert.strictEqual(finishUpgradeTotal(WITH_GROUPS, []), 0);
  assert.strictEqual(finishUpgradeTotal(WITH_GROUPS, null), 0);
});
t("an upgrade is priced from the RECORD, not the browser", () => {
  const sent = [{ group: "Wall tile", option: "Large-format porcelain", upgrade: 99999 }];
  assert.strictEqual(finishUpgradeTotal(WITH_GROUPS, sent), 1200);
});
t("the default option adds nothing", () => {
  assert.strictEqual(finishUpgradeTotal(WITH_GROUPS, [{ group: "Wall tile", option: "Standard ceramic" }]), 0);
});
t("a finish the record does not offer adds nothing", () => {
  assert.strictEqual(finishUpgradeTotal(WITH_GROUPS, [{ group: "Wall tile", option: "Gold leaf", upgrade: 5000 }]), 0);
});
t("groupName/optionName are accepted as well as group/option", () => {
  assert.strictEqual(finishUpgradeTotal(WITH_GROUPS, [{ groupName: "Wall tile", optionName: "Large-format porcelain" }]), 1200);
});
t("with no finishGroups on the record the submitted upgrade is used", () => {
  // A live path whose prices exist only in the selection. Refusing it would
  // break the feature; a negative "upgrade" is still never a discount.
  assert.strictEqual(finishUpgradeTotal(EST, [{ group: "Tile", option: "Fancy", upgrade: 500 }]), 500);
  assert.strictEqual(finishUpgradeTotal(EST, [{ group: "Tile", option: "Fancy", upgrade: -500 }]), 0);
});
t("a finish upgrade raises the accepted ceiling", () => {
  const r = { estimate: JSON.parse(JSON.stringify(WITH_GROUPS)) };
  acceptFinalTotal(r, BASE + 1200, [], [{ group: "Wall tile", option: "Large-format porcelain" }]);
  assert.strictEqual(r.customerFinalTotal, round(BASE + 1200));
  assert.ok(!r.rejectedFinalTotal);
});
t("an option AND a finish upgrade together", () => {
  const r = { estimate: JSON.parse(JSON.stringify(WITH_GROUPS)) };
  acceptFinalTotal(r, BASE + 3850 + 1200, [A_ID], [{ group: "Wall tile", option: "Large-format porcelain" }]);
  assert.strictEqual(r.customerFinalTotal, round(BASE + 5050));
});
t("a finish upgrade does not license an unrelated raise", () => {
  const r = { estimate: JSON.parse(JSON.stringify(WITH_GROUPS)) };
  acceptFinalTotal(r, BASE + 90000, [], [{ group: "Wall tile", option: "Large-format porcelain" }]);
  assert.strictEqual(r.customerFinalTotal, round(BASE + 1200));
  assert.strictEqual(r.rejectedFinalTotal.reason, "above the quote plus the options selected");
});

function round(n) { return Math.round(n * 100) / 100; }

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
