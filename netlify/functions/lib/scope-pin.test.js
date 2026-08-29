// node netlify/functions/lib/scope-pin.test.js
//
// Pinning the job. The two failures this has to sit between:
//
//   TOO LOOSE — the job is re-decided on every generation, so one request comes
//   back as a $3,710 ceiling repair and then a $20,895 bathroom renovation.
//   That is what was happening.
//
//   TOO TIGHT — the job is pinned so hard that a customer who finally answers
//   the question blocking their estimate is ignored, and the estimate carries on
//   as if they never spoke. That would be worse.
//
// So every test here is about which side of that line a given change falls on.

const assert = require("assert");
const { scopeFingerprint, resolveScopePin, stableStringify, REASONS } = require("./scope-pin");

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
};

/* The live record that produced the complaint. */
function makeInput(over) {
  const base = {
    ref: "SBC-260828-IE0L",
    customer: { name: "Zurabi", phone: "3479028788", email: "z@example.com", address: "3855 Shore Pkwy, 1K" },
    request: {
      service: "Bathroom",
      selectedServices: ["Bathroom"],
      propertyType: "Apartment / Co-op",
      timeline: "Not specified",
      sqft: "",
      description: "my bathroom is old and there's water coming through the ceiling",
      groupedAnswers: { Bathroom: [{ question: "Is the leak still active, or has it been stopped?", answer: "Stopped, but stains remain" }] },
      customerSupplies: [],
      photoAnalysis: [],
      conversation: [],
    },
    contractor: { extraRequest: "", houseRules: "" },
  };
  const o = over || {};
  return {
    ref: base.ref,
    customer: Object.assign({}, base.customer, o.customer || {}),
    request: Object.assign({}, base.request, o.request || {}),
    contractor: Object.assign({}, base.contractor, o.contractor || {}),
  };
}
const PINNED_ANALYSIS = { project_type: "repair", project_summary: "Fix the leak and repair the ceiling.", selected_trades: ["Bathroom"] };
function pinnedRecord(input) {
  return { projectAnalysis: PINNED_ANALYSIS, scopeFingerprint: scopeFingerprint(input || makeInput()) };
}

console.log("\nscope-pin\n");

/* ── the fingerprint ───────────────────────────────────────────────────── */
t("the same request gives the same fingerprint", () => {
  assert.strictEqual(scopeFingerprint(makeInput()), scopeFingerprint(makeInput()));
});
t("key order does not change it", () => {
  const a = { request: { description: "x", service: "Bathroom" }, contractor: {}, customer: {} };
  const b = { customer: {}, contractor: {}, request: { service: "Bathroom", description: "x" } };
  assert.strictEqual(scopeFingerprint(a), scopeFingerprint(b));
});
t("stableStringify sorts keys", () => {
  assert.strictEqual(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
  assert.strictEqual(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
});
t("stableStringify survives nulls, arrays and undefined", () => {
  assert.strictEqual(stableStringify(null), "null");
  assert.strictEqual(stableStringify(undefined), "null");
  assert.strictEqual(stableStringify([1, { b: 2, a: 1 }]), '[1,{"a":1,"b":2}]');
});
t("a fingerprint is short and safe to store", () => {
  assert.ok(/^sc1-[a-z0-9]+$/.test(scopeFingerprint(makeInput())), scopeFingerprint(makeInput()));
});

/* ── THINGS THAT MUST NOT BREAK THE PIN ────────────────────────────────── */
const SAME = [
  ["a corrected phone number", { customer: { phone: "9990001111" } }],
  ["a corrected email", { customer: { email: "new@example.com" } }],
  ["a corrected name spelling", { customer: { name: "Zura" } }],
];
SAME.forEach(([what, over]) => {
  t("not a scope change: " + what, () => {
    assert.strictEqual(scopeFingerprint(makeInput(over)), scopeFingerprint(makeInput()));
  });
});

/* ── THINGS THAT MUST BREAK IT ─────────────────────────────────────────── */
const DIFFERENT = [
  ["the customer edits their description", { request: { description: "actually just fix the ceiling, leave the bathroom alone" } }],
  ["the customer replies in the thread", { request: { conversation: [{ from: "customer", text: "it is about 40 sq ft" }] } }],
  ["a service is added", { request: { selectedServices: ["Bathroom", "Painting"] } }],
  ["a service is removed", { request: { selectedServices: [] } }],
  ["an answer changes", { request: { groupedAnswers: { Bathroom: [{ question: "q", answer: "Still leaking now" }] } } }],
  ["the contractor types an extra instruction", { contractor: { extraRequest: "ceiling only, no renovation" } }],
  ["the house rules change", { contractor: { houseRules: "Full bathroom gut: $18,000-$35,000" } }],
  ["the property type changes", { request: { propertyType: "Single-family home" } }],
  ["the address changes", { customer: { address: "1 Other Street" } }],
  ["photos get analysed", { request: { photoAnalysis: [{ detected: "Cracked wall tile" }] } }],
  ["the customer names what they are supplying", { request: { customerSupplies: ["Vanity & sink"] } }],
  ["a timeline is given", { request: { timeline: "ASAP — emergency or urgent" } }],
  ["a square footage is given", { request: { sqft: "45" } }],
];
DIFFERENT.forEach(([what, over]) => {
  t("IS a scope change: " + what, () => {
    assert.notStrictEqual(scopeFingerprint(makeInput(over)), scopeFingerprint(makeInput()));
  });
});

/* ══ THE DECISION ═════════════════════════════════════════════════════════ */
console.log("\nwhich generations may reuse the pinned job\n");

t("a first generation has nothing to reuse", () => {
  const r = resolveScopePin({}, makeInput(), {});
  assert.strictEqual(r.reuse, false);
  assert.strictEqual(r.reason, REASONS.NO_PIN);
});
t("a record written before pinning existed is read fresh, then pinned", () => {
  const r = resolveScopePin({ projectAnalysis: PINNED_ANALYSIS }, makeInput(), {});
  assert.strictEqual(r.reuse, false, "no stored fingerprint means the pin cannot be trusted");
  assert.ok(r.fingerprint, "and this run stamps one");
});
t("THE FIX: an unchanged request re-prices the SAME job", () => {
  const input = makeInput();
  const r = resolveScopePin(pinnedRecord(input), input, {});
  assert.strictEqual(r.reuse, true, r.reason);
  assert.strictEqual(r.analysis.project_type, "repair", "the ceiling repair, not a renovation");
  assert.strictEqual(r.reason, REASONS.PINNED);
});
t("...twice, and a third time", () => {
  const input = makeInput();
  const rec = pinnedRecord(input);
  [1, 2, 3].forEach(function () {
    assert.strictEqual(resolveScopePin(rec, input, {}).reuse, true);
  });
});
t("asking to re-read the job wins over the pin", () => {
  const input = makeInput();
  const r = resolveScopePin(pinnedRecord(input), input, { reanalyze: true });
  assert.strictEqual(r.reuse, false);
  assert.strictEqual(r.reason, REASONS.ASKED);
});
t("...and only the literal true does it, not a stray truthy value", () => {
  const input = makeInput();
  assert.strictEqual(resolveScopePin(pinnedRecord(input), input, { reanalyze: "no" }).reuse, true);
  assert.strictEqual(resolveScopePin(pinnedRecord(input), input, { reanalyze: false }).reuse, true);
  assert.strictEqual(resolveScopePin(pinnedRecord(input), input, {}).reuse, true);
});

/* ══ THE OTHER FAILURE: A PIN THAT IGNORES THE CUSTOMER ═══════════════════ */
t("A CUSTOMER REPLY BREAKS THE PIN — this must never be ignored", () => {
  const pinnedAt = makeInput();
  const now = makeInput({ request: { conversation: [{ from: "customer", text: "the bathroom is about 40 square feet" }] } });
  const r = resolveScopePin(pinnedRecord(pinnedAt), now, {});
  assert.strictEqual(r.reuse, false, "the customer answered — the job must be read again");
  assert.strictEqual(r.reason, REASONS.CHANGED);
});
t("...and so does an edited description", () => {
  const pinnedAt = makeInput();
  const now = makeInput({ request: { description: "just fix the ceiling please" } });
  assert.strictEqual(resolveScopePin(pinnedRecord(pinnedAt), now, {}).reuse, false);
});
t("...and so does the contractor's own correction", () => {
  const pinnedAt = makeInput();
  const now = makeInput({ contractor: { extraRequest: "ceiling only" } });
  assert.strictEqual(resolveScopePin(pinnedRecord(pinnedAt), now, {}).reuse, false);
});
t("every DIFFERENT case above breaks the pin, not just the ones spot-checked", () => {
  const pinnedAt = makeInput();
  const rec = pinnedRecord(pinnedAt);
  const missed = [];
  DIFFERENT.forEach(([what, over]) => {
    if (resolveScopePin(rec, makeInput(over), {}).reuse) missed.push(what);
  });
  assert.deepStrictEqual(missed, []);
});
t("every SAME case above keeps the pin", () => {
  const pinnedAt = makeInput();
  const rec = pinnedRecord(pinnedAt);
  const broke = [];
  SAME.forEach(([what, over]) => {
    if (!resolveScopePin(rec, makeInput(over), {}).reuse) broke.push(what);
  });
  assert.deepStrictEqual(broke, []);
});

/* ── it must not throw on anything ─────────────────────────────────────── */
t("junk does not throw", () => {
  assert.strictEqual(resolveScopePin(null, null, null).reuse, false);
  assert.strictEqual(resolveScopePin({}, {}, {}).reuse, false);
  assert.strictEqual(resolveScopePin({ projectAnalysis: "nonsense", scopeFingerprint: 7 }, makeInput(), {}).reuse, false);
});
t("a fingerprint can always be taken, even of nothing", () => {
  assert.ok(scopeFingerprint(null));
  assert.ok(scopeFingerprint({}));
});

/* ══ THE WIRING ═══════════════════════════════════════════════════════════
   A perfect library that the generator does not call changes nothing. */
console.log("\nthe generator actually uses it\n");
const fs = require("fs");
const path = require("path");
const GEN = fs.readFileSync(path.join(__dirname, "..", "generate-estimate-background.js"), "utf8");

t("the generator imports the pin", () => {
  assert.ok(/require\(["']\.\/lib\/scope-pin["']\)/.test(GEN));
});
t("it asks before running the analysis", () => {
  assert.ok(/resolveScopePin\(record, input, body\)/.test(GEN));
});
t("the analysis call is INSIDE the else branch, not before it", () => {
  const pinAt = GEN.indexOf("resolveScopePin(record, input, body)");
  const callAt = GEN.indexOf("buildProjectAnalysisPrompt(input)");
  assert.ok(pinAt > 0 && callAt > pinAt, "the API call must not run before the decision");
});
t("the fingerprint is written back onto the record", () => {
  assert.ok(/record\.scopeFingerprint = pin\.fingerprint/.test(GEN));
});
t("the dashboard sends the re-read flag", () => {
  const DASH = fs.readFileSync(path.join(__dirname, "..", "..", "..", "dashboard.html"), "utf8");
  assert.ok(/reanalyze: reanalyze === true/.test(DASH), "the flag must reach the function");
  assert.ok(/generateAI\(true,false\)/.test(DASH), "re-price button");
  assert.ok(/generateAI\(true,true\)/.test(DASH), "re-read button");
});

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
