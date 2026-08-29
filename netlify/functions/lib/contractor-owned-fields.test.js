// node netlify/functions/lib/contractor-owned-fields.test.js
//
// THE FAILURE THIS FILE IS ABOUT.
//
//   Generate → lock the phone → come back → the quote photos are gone.
//
// record.estimate is replaced wholesale by every generation. The contractor's own
// settings inside it — photos, contract, customer view mode, a manually set final
// total — were put back by dashboard.html at the end of its poll loop, in memory,
// in the browser. So the protection existed exactly as long as a browser stayed
// awake, and a locked phone is precisely when one does not.
//
// The preservation is now on the server, where the overwrite happens. These tests
// hold it there, and hold the two lists together: a field in one list and not the
// other is a field that survives only when someone is watching.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  CONTRACTOR_OWNED_ESTIMATE_FIELDS,
  preserveContractorFields,
  preservedFieldNames,
} = require("./contractor-owned-fields");

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
};

console.log("\ncontractor-owned fields\n");

/* ── THE TWO LISTS ARE ONE LIST ────────────────────────────────────────────── */
const DASH = fs.readFileSync(path.join(__dirname, "..", "..", "..", "dashboard.html"), "utf8");

function dashboardList() {
  const start = DASH.indexOf("var CONTRACTOR_OWNED_ESTIMATE_FIELDS = [");
  assert.ok(start > 0, "dashboard.html no longer declares CONTRACTOR_OWNED_ESTIMATE_FIELDS");
  const open = DASH.indexOf("[", start);
  let depth = 0, end = -1;
  for (let i = open; i < DASH.length; i++) {
    if (DASH[i] === "[") depth++;
    else if (DASH[i] === "]") { depth--; if (!depth) { end = i; break; } }
  }
  assert.ok(end > 0, "unterminated array");
  /* Array.from: the value comes back from another vm realm, where Array is a
     different constructor, and deepStrictEqual refuses to compare across the two
     however identical the contents. */
  return Array.from(vm.runInNewContext("(" + DASH.slice(open, end + 1) + ")"));
}

t("the dashboard's list and the server's list are identical, in the same order", () => {
  assert.deepStrictEqual(dashboardList(), CONTRACTOR_OWNED_ESTIMATE_FIELDS);
});
t("every field the contractor can lose is actually named", () => {
  /* Not exhaustive — a reminder of what this is protecting. Each of these was
     hand-configured by a human and is invisible to the estimator. */
  ["quotePhotos", "contract", "customerFinalTotal", "finishGroups",
    "publishedCustomerScope", "parkedLines", "savedMaterials"].forEach((k) => {
    assert.ok(CONTRACTOR_OWNED_ESTIMATE_FIELDS.indexOf(k) !== -1, "missing: " + k);
  });
});
t("nothing AI-owned is in the list — regenerating is supposed to replace those", () => {
  ["labor", "materials", "summary", "scopeOfWork", "serviceBreakdown", "scopeSections",
    "exclusions", "customerSupplied", "options", "assumptions", "validation",
    "pricingReadiness", "clarificationQuestions", "repairReport"].forEach((k) => {
    assert.strictEqual(CONTRACTOR_OWNED_ESTIMATE_FIELDS.indexOf(k), -1, "AI-owned field pinned: " + k);
  });
});

/* ── WHAT IT DOES ──────────────────────────────────────────────────────────── */
function priorEstimate() {
  return {
    labor: [{ item: "old line", total: 1 }],
    quotePhotos: ["a.jpg", "b.jpg"],
    contract: { deposit: 30, terms: "Net 15" },
    customerFinalTotal: 20300,
    finishGroups: [{ name: "Tile", options: [] }],
    showLaborCost: false,
    parkedLines: [{ item: "Vanity", total: 1200 }],
    markupRecommendation: { rate: 28 },
  };
}
function freshFromAi() {
  return {
    labor: [{ item: "new line", total: 2 }],
    materials: [],
    summary: "A newly generated estimate",
    markupRecommendation: { rate: 25 },
  };
}

t("THE FIX: the photos survive a regeneration with nobody watching", () => {
  const next = preserveContractorFields(priorEstimate(), freshFromAi());
  assert.deepStrictEqual(next.quotePhotos, ["a.jpg", "b.jpg"]);
});
t("...and so do the contract, the manual total, the finish groups and the parked money", () => {
  const next = preserveContractorFields(priorEstimate(), freshFromAi());
  assert.deepStrictEqual(next.contract, { deposit: 30, terms: "Net 15" });
  assert.strictEqual(next.customerFinalTotal, 20300);
  assert.strictEqual(next.finishGroups.length, 1);
  assert.strictEqual(next.parkedLines[0].total, 1200);
});
t("a customer-view choice of FALSE is kept, not treated as absent", () => {
  const next = preserveContractorFields(priorEstimate(), freshFromAi());
  assert.strictEqual(next.showLaborCost, false, "false is a decision the contractor made");
});
t("the new AI work is NOT overwritten — that is the point of regenerating", () => {
  const next = preserveContractorFields(priorEstimate(), freshFromAi());
  assert.strictEqual(next.labor[0].item, "new line");
  assert.strictEqual(next.summary, "A newly generated estimate");
});
t("where both have the field, the contractor's value wins", () => {
  const next = preserveContractorFields(priorEstimate(), freshFromAi());
  assert.deepStrictEqual(next.markupRecommendation, { rate: 28 },
    "same as the dashboard has always done — a hand-set markup is not the AI's to change");
});
t("a first generation keeps every default the estimator chose", () => {
  const next = preserveContractorFields(null, freshFromAi());
  assert.deepStrictEqual(next.markupRecommendation, { rate: 25 });
  assert.strictEqual(next.quotePhotos, undefined);
});
t("null and undefined fields are not copied over as null", () => {
  const next = preserveContractorFields({ quotePhotos: null, contract: undefined }, freshFromAi());
  assert.ok(!("quotePhotos" in next), "a null must not shadow the estimator's default");
  assert.ok(!("contract" in next));
});
t("junk does not throw", () => {
  assert.strictEqual(preserveContractorFields(null, null), null);
  assert.strictEqual(preserveContractorFields("x", "y"), "y");
  assert.deepStrictEqual(preserveContractorFields({}, {}), {});
});
t("it returns the same object it was given, mutated", () => {
  const next = freshFromAi();
  assert.strictEqual(preserveContractorFields(priorEstimate(), next), next);
});

/* ── IT SAYS WHAT IT CARRIED ───────────────────────────────────────────────── */
t("preservedFieldNames lists exactly what was carried across", () => {
  const names = preservedFieldNames(priorEstimate());
  assert.deepStrictEqual(names.slice().sort(), [
    "contract", "customerFinalTotal", "finishGroups", "markupRecommendation",
    "parkedLines", "quotePhotos", "showLaborCost",
  ]);
});
t("...and is empty for a first generation", () => {
  assert.deepStrictEqual(preservedFieldNames(null), []);
  assert.deepStrictEqual(preservedFieldNames({}), []);
});

/* ══ THE WIRING ═══════════════════════════════════════════════════════════════
   A perfect library the generator does not call protects nothing. */
console.log("\nthe generator actually uses it\n");
const GEN = fs.readFileSync(path.join(__dirname, "..", "generate-estimate-background.js"), "utf8");

t("the generator imports it", () => {
  assert.ok(/require\(["']\.\/lib\/contractor-owned-fields["']\)/.test(GEN));
});
t("it snapshots the previous estimate BEFORE the run starts", () => {
  const snapAt = GEN.indexOf("const previousEstimate =");
  const runAt = GEN.indexOf('record.aiStatus = "running"');
  assert.ok(snapAt > 0, "no snapshot taken");
  assert.ok(snapAt < runAt, "the snapshot must be taken before anything downstream can touch record.estimate");
});
t("it preserves BEFORE the wholesale overwrite, not after", () => {
  const preserveAt = GEN.indexOf("preserveContractorFields(previousEstimate, estimate)");
  const writeAt = GEN.indexOf("record.estimate = estimate;");
  assert.ok(preserveAt > 0, "preserveContractorFields is never called");
  assert.ok(preserveAt < writeAt, "preserving after the write would be too late");
});
t("what it carried is recorded on the estimate", () => {
  assert.ok(/estimate\.preservedContractorFields = preservedFieldNames\(previousEstimate\)/.test(GEN));
});

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
