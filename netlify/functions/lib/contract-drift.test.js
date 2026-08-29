// node netlify/functions/lib/contract-drift.test.js
//
//   "I updated price in this project, customer requested and now i try update
//    contract too but it's still regenerate with old price"
//
// THE LIVE JOB THIS COMES FROM. SBC-260821-KQNQ, a three-storey staircase.
// The estimate said $20,000.03. The contract said $10,000.01, split
// 4000 / 4000 / 2000.01. A customer could have signed for half the job, and
// nothing anywhere on the screen said the two numbers disagreed.
//
// THREE SEPARATE FAULTS PRODUCED THAT, and all three are tested here:
//
//   1. NOTHING COMPARED THEM. The contract stores its own total, taken once at
//      generation. The estimate moves afterwards and no code ever looks again.
//
//   2. save-contract COULD NOT CHANGE THE TOTAL. It wrote `total: prev.total`,
//      unconditionally — so no edit, of any kind, could ever correct the price.
//      This is why trying to fix it by hand did nothing.
//
//   3. THE POLLER ACCEPTED THE OLD CONTRACT. Pressing Generate with one already
//      present makes the server answer "cached" and skip; it is a background
//      function so that reply never reaches the browser; the first poll found the
//      previous contract still sitting there and announced "Contract ready" over
//      the very total he was trying to replace.
//
// And the line that must not be crossed: a SIGNED contract is a record of what
// somebody agreed to. It is reported on, never rescaled.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { contractDrift, rescaleSchedule, defaultSchedule, retotalContract } = require("./contract-total");

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
};
const sum = (rows) => Math.round(rows.reduce((s, p) => s + p.amount, 0) * 100) / 100;

/* The record as it actually stood: a $20,000.03 estimate and a $10,000.01
   contract. Labor and materials are set so the customer total lands exactly
   there through the ordinary markup path. */
function kqnq(over) {
  const o = over || {};
  return Object.assign({
    ref: "SBC-260821-KQNQ",
    status: "opened",
    customer: { name: "Cono Designs LLC" },
    /* The price he set by hand when the customer asked for the change — the
       "Set total to a number" control. It is the figure the customer is being
       charged, so it is the figure the contract has to state. */
    customerFinalTotal: 20000.03,
    estimate: {
      markupPct: 25,
      showLaborCost: true,
      showMaterialsCost: true,
      labor: [{ section: "Carpentry", item: "Squeak elimination", qty: 1, unit: "ls", rate: 13115.85 }],
      materials: [{ section: "Carpentry", item: "Fasteners and adhesive", qty: 1, unit: "ls", rate: 2884.38 }],
    },
    contract: {
      generatedAt: "2026-08-21T14:00:00.000Z",
      total: 10000.01,
      sections: {
        projectType: "3-Story Staircase Squeak Elimination",
        scopeOfWork: ["Install protection", "Re-secure treads"],
        paymentSchedule: [
          { label: "Deposit — due upon signing", amount: 4000 },
          { label: "Mid-project payment", amount: 4000 },
          { label: "Final payment — due upon completion", amount: 2000.01 },
        ],
        clauses: {},
      },
    },
  }, o);
}

console.log("\nthe contract against the estimate\n");

/* ── 1. IT IS NOTICED AT ALL ────────────────────────────────────────────── */
{
  const d = contractDrift(kqnq());
  t("THE LIVE CASE: a $10,000.01 contract on a $20,000.03 estimate is drift", () => {
    assert.strictEqual(d.contractTotal, 10000.01);
    assert.strictEqual(d.estimateTotal, 20000.03, "customer total");
    assert.strictEqual(d.drifted, true);
  });
  t("...and it says by how much", () => assert.strictEqual(d.delta, 10000.02));
}
t("a contract that matches is not drift", () => {
  const r = kqnq(); r.contract.total = 20000.03;
  assert.strictEqual(contractDrift(r).drifted, false);
});
t("with no stamped total it falls back to the lines, as the quote does", () => {
  const r = kqnq({ customerFinalTotal: null });
  assert.strictEqual(r.customerFinalTotal, null);
  assert.ok(contractDrift(r).estimateTotal > 19000, String(contractDrift(r).estimateTotal));
});
t("a cent of rounding is not drift — nobody needs telling about that", () => {
  const r = kqnq(); r.contract.total = 20000.02;
  assert.strictEqual(contractDrift(r).drifted, false);
  const r2 = kqnq(); r2.contract.total = 20001.50;
  assert.strictEqual(contractDrift(r2).drifted, true, "a dollar and a half is");
});
t("a record with no contract has nothing to disagree with", () => {
  const d = contractDrift(kqnq({ contract: null }));
  assert.strictEqual(d.hasContract, false);
  assert.strictEqual(d.drifted, false);
});
t("a contract shell with no sections does not count as one", () => {
  assert.strictEqual(contractDrift(kqnq({ contract: { total: 5 } })).hasContract, false);
});
t("an estimate that computes to nothing never reports drift — that would be noise", () => {
  const r = kqnq({ customerFinalTotal: null, estimate: { labor: [], materials: [], markupPct: 25 } });
  assert.strictEqual(contractDrift(r).drifted, false);
});
t("a stamped customer total wins, because that is what they are being charged", () => {
  assert.strictEqual(contractDrift(kqnq({ customerFinalTotal: 24500 })).estimateTotal, 24500);
});
t("...and a nonsense stamp is ignored rather than quoted", () => {
  assert.ok(contractDrift(kqnq({ customerFinalTotal: 0 })).estimateTotal > 0);
  assert.ok(contractDrift(kqnq({ customerFinalTotal: -5 })).estimateTotal > 0);
});
t("junk does not throw", () => {
  assert.strictEqual(contractDrift(null).drifted, false);
  assert.strictEqual(contractDrift({}).drifted, false);
  assert.strictEqual(contractDrift({ contract: "nonsense", estimate: 7 }).drifted, false);
});

/* ══ THE LINE: A SIGNED CONTRACT ═══════════════════════════════════════════ */
console.log("\na signed contract is a record of what was agreed\n");
{
  const r = kqnq();
  r.contract.signed = { name: "Y. Kono", at: "2026-08-22T10:00:00.000Z" };
  const d = contractDrift(r);
  t("A SIGNED CONTRACT IS NEVER 'DRIFTED' — it is simply what was agreed", () => {
    assert.strictEqual(d.signed, true);
    assert.strictEqual(d.drifted, false);
  });
  t("...but the difference is still reported, so it can be raised with the customer", () => {
    assert.strictEqual(d.delta, 10000.02);
  });
  t("...and retotalContract refuses to touch it", () => {
    assert.strictEqual(retotalContract(r), null);
  });
}

/* ══ MOVING THE MONEY ══════════════════════════════════════════════════════ */
console.log("\nrescaling the payment schedule\n");
{
  const rows = kqnq().contract.sections.paymentSchedule;
  const out = rescaleSchedule(rows, 20000.03);
  t("THE SCHEDULE SUMS TO THE NEW TOTAL, EXACTLY", () => assert.strictEqual(sum(out), 20000.03));
  /* The PROPERTY, not cents worked out by hand — twice today a hand-derived
     figure was wrong where the code was right. Each row must land within a cent
     or two of its old share of the job, and the sum must be exact. */
  t("each payment keeps its share of the job", () => {
    const before = kqnq().contract.sections.paymentSchedule;
    const oldTotal = sum(before);
    out.forEach((p, i) => {
      const want = Math.round((before[i].amount / oldTotal) * 20000.03 * 100) / 100;
      assert.ok(Math.abs(p.amount - want) <= 0.03,
        before[i].label + ": " + p.amount + " vs " + want + " (was " + before[i].amount + " of " + oldTotal + ")");
    });
  });
  t("...so the 40/40/20 shape survives — it is what the customer planned around", () => {
    assert.ok(Math.abs(out[0].amount / 20000.03 - 0.4) < 0.005, String(out[0].amount));
    assert.ok(Math.abs(out[2].amount / 20000.03 - 0.2) < 0.005, String(out[2].amount));
  });
  t("...and every label the contractor wrote survives", () => {
    assert.deepStrictEqual(out.map((p) => p.label), rows.map((p) => p.label));
  });
  t("the number of rows does not change", () => assert.strictEqual(out.length, 3));
}
t("the remainder lands on the LAST row, so it is never a cent out", () => {
  const odd = [{ label: "A", amount: 1 }, { label: "B", amount: 1 }, { label: "C", amount: 1 }];
  const out = rescaleSchedule(odd, 100.01);
  assert.strictEqual(sum(out), 100.01, JSON.stringify(out));
});
t("scaling DOWN works too — a price can be reduced", () => {
  const out = rescaleSchedule(kqnq().contract.sections.paymentSchedule, 5000);
  assert.strictEqual(sum(out), 5000);
  assert.strictEqual(out.length, 3);
});
t("a schedule summing to zero has no shares to keep, so the standard split is used", () => {
  const out = rescaleSchedule([{ label: "TBD", amount: 0 }], 20000);
  assert.strictEqual(sum(out), 20000);
  assert.strictEqual(out.length, 3, "over $5,000 is 40/40/20");
});
t("an empty schedule gets the standard split", () => {
  assert.strictEqual(sum(rescaleSchedule([], 12000)), 12000);
});
t("junk does not throw", () => {
  assert.ok(Array.isArray(rescaleSchedule(null, 1000)));
  assert.ok(Array.isArray(rescaleSchedule([{ label: "x" }], 0)));
  assert.ok(Array.isArray(rescaleSchedule("nope", 500)));
});

console.log("\nthe standard split matches the one the generator uses\n");
t("under $1,000 is a single payment on completion", () => {
  const s = defaultSchedule(800);
  assert.strictEqual(s.length, 1);
  assert.strictEqual(sum(s), 800);
});
t("$1,000 to $5,000 is half and half", () => {
  const s = defaultSchedule(4000);
  assert.deepStrictEqual(s.map((p) => p.amount), [2000, 2000]);
});
t("over $5,000 is 40 / 40 / 20", () => {
  const s = defaultSchedule(20000);
  assert.deepStrictEqual(s.map((p) => p.amount), [8000, 8000, 4000]);
});
t("every split sums to its total exactly, across a sweep", () => {
  const bad = [];
  for (let v = 100; v <= 60000; v += 137) {
    if (Math.abs(sum(defaultSchedule(v)) - v) > 0.001) bad.push(v);
  }
  assert.deepStrictEqual(bad, []);
});

/* ══ THE WHOLE MOVE ════════════════════════════════════════════════════════ */
console.log("\nbringing the contract up to date\n");
{
  const next = retotalContract(kqnq());
  t("the total moves", () => assert.strictEqual(next.total, 20000.03));
  t("the schedule moves with it", () => assert.strictEqual(sum(next.sections.paymentSchedule), 20000.03));
  t("EVERY WORD OF SCOPE IS UNTOUCHED — that is the point of not regenerating", () => {
    assert.deepStrictEqual(next.sections.scopeOfWork, ["Install protection", "Re-secure treads"]);
    assert.strictEqual(next.sections.projectType, "3-Story Staircase Squeak Elimination");
  });
  t("...and it records what it moved from", () => {
    assert.strictEqual(next.retotaledFrom, 10000.01);
    assert.ok(next.retotaledAt);
  });
  t("the original object is not mutated", () => {
    const r = kqnq();
    retotalContract(r);
    assert.strictEqual(r.contract.total, 10000.01);
  });
}
t("nothing to do returns null rather than a pointless write", () => {
  const r = kqnq(); r.contract.total = 20000.03;
  assert.strictEqual(retotalContract(r), null);
  assert.strictEqual(retotalContract(kqnq({ contract: null })), null);
});

/* ══ FAULT 2: save-contract COULD NOT CHANGE THE TOTAL ═════════════════════ */
console.log("\nsave-contract can now change the price — and only it may\n");
const SAVE = fs.readFileSync(path.join(__dirname, "..", "save-contract.js"), "utf8");
t("the unconditional `total: prev.total` is gone — it was why no edit could fix the price",
  () => assert.ok(!/^\s*total: prev\.total,\s*$/m.test(SAVE), "still pinned to the previous total"));
t("a retotal is a deliberate flag, not a side effect of saving",
  () => assert.ok(/body\.retotal === true/.test(SAVE)));
t("THE NEW FIGURE IS COMPUTED ON THE SERVER, never read from the request",
  () => {
    assert.ok(/contractDrift\(record\)/.test(SAVE), "must derive it from the record");
    assert.ok(!/nextTotal = Number\(body\./.test(SAVE), "must not take a price from the client");
    assert.ok(!/body\.total/.test(SAVE), "must not read a total off the request at all");
  });
t("the schedule is rescaled server-side too, so the two cannot disagree",
  () => assert.ok(/rescaleSchedule\(rows, nextTotal\)/.test(SAVE)));
t("a signed contract is still refused outright",
  () => assert.ok(/record\.contract\.signed[\s\S]{0,200}already signed/.test(SAVE)));

/* ══ FAULT 3: THE POLLER ACCEPTED THE OLD CONTRACT ════════════════════════ */
console.log("\nthe dashboard no longer mistakes the old contract for the new one\n");
const DASH = fs.readFileSync(path.join(__dirname, "..", "..", "..", "dashboard.html"), "utf8");
t("the poll only accepts a contract generated AFTER the one it started with",
  () => assert.ok(/gen > startedWith/.test(DASH)));
t("...and Regenerate hands it that timestamp, having cleared its local copy",
  () => assert.ok(/sbcGenContract\(true, since\)/.test(DASH)));
t("the drift warning is rendered in the contract panel",
  () => assert.ok(/contractDriftHtml\(currentRecord\)/.test(DASH)));
t("...and the update button is wired",
  () => assert.ok(/onclick="sbcRetotalContract\(\)"/.test(DASH)));
t("the client asks for a retotal rather than naming a price",
  () => assert.ok(/retotal: true/.test(DASH) && !/body: JSON\.stringify\(\{ ref: currentRecord\.ref, contract: ct \}\)/.test(DASH)));
t("it uses the CUSTOMER view total, not the internal grand total",
  () => assert.ok(/calcCustomerView === 'function'/.test(DASH)));

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
