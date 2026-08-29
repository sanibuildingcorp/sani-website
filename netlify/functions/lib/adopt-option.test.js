// node netlify/functions/lib/adopt-option.test.js
//
// Adopting an option the customer chose, at the price they were shown.
//
// The whole point of this file existing instead of "just press Regenerate" is
// that the generator is not deterministic. So the thing under test is not "does
// it add a line" — it is "does the customer's total land on exactly the number
// they were promised, and does it refuse when it would not".

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { adoptOption, targetBucket, optionLine } = require("./adopt-option");
const { collectOptions } = require("./quote-options");
const customerTotals = require("./customer-total");

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
};

/* Modelled on the live Zurabi record: a $3,710.55 bathroom with three
   alternatives, 25% markup, labour and materials both shown. */
function makeRecord(over) {
  const est = Object.assign({
    markupPct: 25,
    showLaborCost: true,
    showMaterialsCost: true,
    labor: [{ section: "Bathroom", item: "Plumber inspection", qty: 2, unit: "hrs", rate: 76 }],
    materials: [{ section: "Bathroom", item: "Ceiling access panel", qty: 1, unit: "ea", rate: 19.9 }],
    serviceBreakdown: [{
      title: "Bathroom",
      subtotal: 214.88,
      included: ["We protect the apartment"],
      customerSupplies: [],
      notIncluded: [
        "Mold assessment and remediation under NY State Article 32 if the wet area exceeds 10 sq ft — see Option A.",
        "Permit filing and co-op alteration fees.",
      ],
      options: [
        { label: "Option A — NY State Article 32 assessment and contained remediation", price: 3850 },
        { label: "Option C — Camera inspection of the waste line", price: 675 },
      ],
    }],
  }, (over || {}).estimate || {});
  return Object.assign({ ref: "SBC-TEST", estimate: est }, over || {}, { estimate: est });
}
const idOf = (rec, letter) => collectOptions(rec.estimate).filter((o) => o.letter === letter)[0].id;
const total = (rec) => customerTotals(rec.estimate, {}).customerTotal;

console.log("\nadopt-option\n");

/* ══ THE ONE THAT MATTERS ═════════════════════════════════════════════════ */
t("the customer's total rises by EXACTLY the price they were quoted", () => {
  const rec = makeRecord();
  const before = total(rec);
  const r = adoptOption(rec, idOf(rec, "A"));
  assert.ok(r.ok, r.reason);
  assert.strictEqual(Math.round((total(rec) - before) * 100) / 100, 3850,
    "moved by " + (total(rec) - before));
});
t("...and markup does not add itself on top", () => {
  // 25% markup: a naive rate of 3850 would have charged the customer 4812.50.
  const rec = makeRecord();
  const before = total(rec);
  adoptOption(rec, idOf(rec, "A"));
  assert.notStrictEqual(Math.round((total(rec) - before) * 100) / 100, 4812.5);
});
t("...with no markup either", () => {
  const rec = makeRecord({ estimate: { markupPct: 0 } });
  const before = total(rec);
  assert.ok(adoptOption(rec, idOf(rec, "A")).ok);
  assert.strictEqual(Math.round((total(rec) - before) * 100) / 100, 3850);
});
t("...at 45% markup", () => {
  const rec = makeRecord({ estimate: { markupPct: 45 } });
  const before = total(rec);
  assert.ok(adoptOption(rec, idOf(rec, "A")).ok);
  assert.strictEqual(Math.round((total(rec) - before) * 100) / 100, 3850);
});
t("it lands exactly at every markup from 0 to 60%, not just the tidy ones", () => {
  // The double-rounding bug this catches: at 45% the true total was
  // $4,099.2549 while before + price said $4,099.26, and the guard refused.
  const bad = [];
  for (let pct = 0; pct <= 60; pct++) {
    const rec = makeRecord({ estimate: { markupPct: pct } });
    const before = total(rec);
    const r = adoptOption(rec, idOf(rec, "A"));
    if (!r.ok) { bad.push(pct + "% refused: " + r.reason); continue; }
    const moved = Math.round((total(rec) - before) * 100) / 100;
    if (moved !== 3850) bad.push(pct + "% moved by " + moved);
  }
  assert.deepStrictEqual(bad, []);
});
t("...and at awkward option prices too", () => {
  const bad = [];
  [675, 1180, 99.99, 1234.56, 7.77, 50000].forEach(function (price) {
    const rec = makeRecord({ estimate: { markupPct: 45 } });
    rec.estimate.serviceBreakdown[0].options = [{ label: "Option A — thing", price: price }];
    const before = total(rec);
    const r = adoptOption(rec, idOf(rec, "A"));
    if (!r.ok) { bad.push(price + " refused: " + r.reason); return; }
    const moved = Math.round((total(rec) - before) * 100) / 100;
    if (moved !== price) bad.push(price + " moved by " + moved);
  });
  assert.deepStrictEqual(bad, []);
});
t("EXHAUSTIVE: markup x price x display mode, every one lands on the cent", () => {
  /* The guard refuses rather than being a cent out, which is right — but a
     refusal is a button that does not work, so "it refuses safely" is not good
     enough. This sweeps every combination the contractor can actually produce
     and requires all of them to succeed AND to move the total by exactly the
     quoted price. It found two separate rounding faults: the naive rate was a
     cent short at 45%, and the nudge-and-repeat correction oscillated forever
     between $1,429.25 and $1,429.27 on an $1,180 option. */
  const prices = [7.77, 99.99, 675, 1180, 1234.56, 3850, 50000];
  const modes = [[true, true], [true, false], [false, true], [false, false]];
  const bad = [];
  let n = 0;
  for (let pct = 0; pct <= 60; pct++) {
    for (const price of prices) {
      for (const mode of modes) {
        n++;
        const rec = makeRecord({ estimate: { markupPct: pct, showLaborCost: mode[0], showMaterialsCost: mode[1] } });
        rec.estimate.serviceBreakdown[0].options = [{ label: "Option A — thing", price: price }];
        const before = total(rec);
        const r = adoptOption(rec, idOf(rec, "A"));
        if (!r.ok) { if (bad.length < 5) bad.push(pct + "% $" + price + " " + mode + ": " + r.reason); continue; }
        const moved = Math.round((total(rec) - before) * 100) / 100;
        if (moved !== price) { if (bad.length < 5) bad.push(pct + "% $" + price + " " + mode + ": moved " + moved); }
      }
    }
  }
  assert.deepStrictEqual(bad, [], n + " combinations tried");
  assert.ok(n > 1500, "only " + n + " combinations");
});
t("two options adopted one after the other both land exactly", () => {
  const rec = makeRecord();
  const before = total(rec);
  assert.ok(adoptOption(rec, idOf(rec, "A")).ok);
  assert.ok(adoptOption(rec, idOf(rec, "C")).ok);
  assert.strictEqual(Math.round((total(rec) - before) * 100) / 100, 4525);
});

/* ══ THE BUCKET THE CUSTOMER IS SHOWN ═════════════════════════════════════
   Put the line where the customer cannot see it and the work is added for
   free. */
t("labor-only quotes get a labor line", () => {
  const rec = makeRecord({ estimate: { showLaborCost: true, showMaterialsCost: false } });
  const before = total(rec);
  const r = adoptOption(rec, idOf(rec, "A"));
  assert.strictEqual(r.bucket, "labor");
  assert.strictEqual(Math.round((total(rec) - before) * 100) / 100, 3850);
});
t("materials-only quotes get a MATERIALS line, or the customer pays nothing", () => {
  const rec = makeRecord({ estimate: { showLaborCost: false, showMaterialsCost: true } });
  const before = total(rec);
  const r = adoptOption(rec, idOf(rec, "A"));
  assert.strictEqual(r.bucket, "materials", "a labor line here adds $0 to their price");
  assert.strictEqual(Math.round((total(rec) - before) * 100) / 100, 3850);
});
t("a total-only quote still moves by the right amount", () => {
  const rec = makeRecord({ estimate: { showLaborCost: false, showMaterialsCost: false } });
  const before = total(rec);
  assert.ok(adoptOption(rec, idOf(rec, "A")).ok);
  assert.strictEqual(Math.round((total(rec) - before) * 100) / 100, 3850);
});
t("targetBucket never returns something that is not a bucket", () => {
  ["labor", "materials"].forEach(function (b) {
    assert.ok(["labor", "materials"].indexOf(b) !== -1);
  });
  assert.strictEqual(targetBucket({ showLabor: true, showMaterials: true }), "labor");
  assert.strictEqual(targetBucket({ showLabor: false, showMaterials: true }), "materials");
  assert.strictEqual(targetBucket({ showLabor: false, showMaterials: false }), "labor");
});

/* ══ THE SCOPE MOVES WITH THE MONEY ═══════════════════════════════════════ */
t("the service subtotal rises by the price", () => {
  const rec = makeRecord();
  adoptOption(rec, idOf(rec, "A"));
  assert.strictEqual(rec.estimate.serviceBreakdown[0].subtotal, 4064.88);
});
t("the work joins the included list", () => {
  const rec = makeRecord();
  adoptOption(rec, idOf(rec, "A"));
  const inc = rec.estimate.serviceBreakdown[0].included;
  assert.strictEqual(inc.length, 2);
  assert.ok(/Article 32/.test(inc[1]), inc[1]);
});
t("the 'Option A —' menu prefix is stripped from the line", () => {
  const line = optionLine({ label: "Option A — NY State Article 32 assessment", price: 100, section: "Bathroom" }, 1);
  assert.strictEqual(line.item.indexOf("Option A"), -1, line.item);
  assert.ok(/Article 32/.test(line.item));
});
t("a label with no menu prefix survives intact", () => {
  const line = optionLine({ label: "Upgrade to a heated floor", price: 100, section: "Bathroom" }, 1);
  assert.strictEqual(line.item, "Upgrade to a heated floor");
});
t("the option is removed from the alternatives, so it cannot be sold twice", () => {
  const rec = makeRecord();
  adoptOption(rec, idOf(rec, "A"));
  const left = rec.estimate.serviceBreakdown[0].options.map((o) => o.label);
  assert.strictEqual(left.length, 1);
  assert.ok(/Option C/.test(left[0]));
});
t("the exclusion that pointed at it is retired", () => {
  const rec = makeRecord();
  adoptOption(rec, idOf(rec, "A"));
  const ni = rec.estimate.serviceBreakdown[0].notIncluded;
  assert.strictEqual(ni.length, 1);
  assert.ok(/Permit filing/.test(ni[0]));
});
t("an unrelated service is not touched", () => {
  const rec = makeRecord();
  rec.estimate.serviceBreakdown.push({ title: "Painting", subtotal: 900, included: ["paint"], options: [] });
  adoptOption(rec, idOf(rec, "A"));
  const p = rec.estimate.serviceBreakdown[1];
  assert.strictEqual(p.subtotal, 900);
  assert.strictEqual(p.included.length, 1);
});

/* ══ IT REFUSES RATHER THAN GUESSES ═══════════════════════════════════════ */
t("the same option cannot be added twice", () => {
  const rec = makeRecord();
  rec.customerOptionSelections = [{ id: idOf(rec, "A"), label: "Option A", price: 3850 }];
  const id = idOf(rec, "A");
  assert.ok(adoptOption(rec, id).ok);
  const second = adoptOption(rec, id);
  assert.ok(!second.ok);
  assert.ok(/already in the estimate/.test(second.reason), second.reason);
});
t("an id this estimate does not have is refused", () => {
  const rec = makeRecord();
  const r = adoptOption(rec, "opt-made-up-zzz");
  assert.ok(!r.ok);
  assert.ok(/no option with that id/.test(r.reason));
});
t("no id at all is refused", () => {
  assert.ok(!adoptOption(makeRecord(), "").ok);
  assert.ok(!adoptOption(makeRecord(), null).ok);
});
t("a zero-priced option is refused rather than added for nothing", () => {
  const rec = makeRecord();
  rec.estimate.serviceBreakdown[0].options.push({ label: "Option D — free advice", price: 0 });
  const id = collectOptions(rec.estimate).filter((o) => o.letter === "D")[0].id;
  const r = adoptOption(rec, id);
  assert.ok(!r.ok);
  assert.ok(/no price/.test(r.reason), r.reason);
});
t("an estimate with no lines has nothing to add to", () => {
  const rec = { estimate: { labor: [], materials: [], serviceBreakdown: [{ title: "B", options: [{ label: "Option A — x", price: 500 }] }] } };
  const id = collectOptions(rec.estimate)[0].id;
  const r = adoptOption(rec, id);
  assert.ok(!r.ok);
  assert.ok(/no total to add to/.test(r.reason), r.reason);
});
t("junk input does not throw", () => {
  assert.ok(!adoptOption(null, "x").ok);
  assert.ok(!adoptOption({}, "x").ok);
  assert.ok(!adoptOption({ estimate: null }, "x").ok);
});

/* ══ WHAT IS REMEMBERED ═══════════════════════════════════════════════════ */
t("the customer's selection is marked adopted, not deleted", () => {
  const rec = makeRecord();
  const id = idOf(rec, "A");
  rec.customerOptionSelections = [{ id: id, label: "Option A — …", price: 3850, section: "Bathroom" }];
  adoptOption(rec, id);
  assert.strictEqual(rec.customerOptionSelections.length, 1, "the record of what they chose stays");
  assert.ok(rec.customerOptionSelections[0].adoptedAt);
});
t("a total the customer already accepted is never overwritten", () => {
  const rec = makeRecord();
  rec.customerFinalTotal = 4064.88;
  adoptOption(rec, idOf(rec, "A"));
  assert.strictEqual(rec.customerFinalTotal, 4064.88);
});

/* ══ THE DASHBOARD'S REGENERATE WARNING ═══════════════════════════════════
   Executed from dashboard.html, because a warning that does not fire is the
   same as no warning. */
console.log("\nthe Regenerate warning fires when a price is already promised\n");
const DASH = fs.readFileSync(path.join(__dirname, "..", "..", "..", "dashboard.html"), "utf8");
function ext(src, name) {
  const s = src.search(new RegExp("function " + name + "\\("));
  if (s < 0) throw new Error("missing " + name);
  let d = 0;
  for (let j = src.indexOf("{", s); j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) return src.slice(s, j + 1); }
  }
}
const dctx = { console, Number, String, Array, Object, Math, JSON };
vm.createContext(dctx);
vm.runInContext(
  'var CUSTOMER_HAS_SEEN = ["sent","opened","accepted","review_requested","invoiced","paid","completed"];' +
  'function calcCustomerView(){ return { customerTotal: 3710.55 }; }' +
  ext(DASH, "regenerateWarning"), dctx);
const warn = (r) => vm.runInContext("regenerateWarning(" + JSON.stringify(r) + ")", dctx);

t("a draft nobody has seen gets no extra warning", () => {
  assert.strictEqual(warn({ status: "drafted", estimate: {} }), "");
  assert.strictEqual(warn({ status: "new", estimate: {} }), "");
});
t("an estimate the customer has been sent warns, and names the price", () => {
  const w = warn({ status: "sent", estimate: {}, customerFinalTotal: 3710.55 });
  assert.ok(w.length > 0);
  assert.ok(/already seen/.test(w), w);
  assert.ok(/3,710\.55/.test(w), w);
});
t("every status the customer can have seen warns", () => {
  ["sent", "opened", "accepted", "review_requested", "invoiced", "paid", "completed"].forEach(function (st) {
    assert.ok(warn({ status: st, estimate: {} }).length > 0, st + " did not warn");
  });
});
t("a chosen option warns that its fixed price will not survive", () => {
  const w = warn({ status: "sent", estimate: {}, customerOptionSelections: [{ id: "a", label: "Option A", price: 3850 }] });
  assert.ok(/fixed price/.test(w), w);
  assert.ok(/Add to the estimate/.test(w), "it must point at the safe route instead");
});
t("two chosen options are counted correctly", () => {
  const w = warn({ status: "sent", estimate: {}, customerOptionSelections: [{ id: "a" }, { id: "b" }] });
  assert.ok(/2 options they chose/.test(w), w);
});
t("a chosen option warns even on a record that was never marked sent", () => {
  const w = warn({ status: "drafted", estimate: {}, customerOptionSelections: [{ id: "a" }] });
  assert.ok(w.length > 0, "they cannot have chosen it without seeing it");
});
t("junk does not throw", () => {
  assert.strictEqual(warn(null), "");
  assert.strictEqual(typeof warn({}), "string");
});

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
