// node netlify/functions/lib/sent-version.test.js
//
//   "whatever i will do any taste updates in my dashboard i don't have to worry
//    in them side will not change anything till i sent them update estimate"
//
// The quote link rendered LIVE from the record. Every edit in the dashboard — a
// rate tried out, a line half-typed, a total being experimented with, an AI
// regeneration mid-flight — appeared on the customer's page the instant it was
// saved, with no send and no warning.
//
// On SBC-260821 that cost an afternoon: a price was changed while the customer
// already held the link, and nobody could say which of several numbers they were
// actually looking at.
//
// ── THE SEAM THIS FILE DEFENDS ──────────────────────────────────────────────
// Getting the line wrong in either direction breaks the quote:
//
//   FREEZE TOO LITTLE and the contractor's half-finished edits keep leaking.
//   FREEZE TOO MUCH and the customer ticks an option, sends a message, signs —
//   and watches their own actions vanish from their own page.
//
// So every test here is about which side of that line something falls on.

const assert = require("assert");
const { buildSentVersion, applySentVersion, hasUnsentChanges, SNAPSHOT_VERSION } = require("./sent-version");

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
};

function record(over) {
  return Object.assign({
    ref: "SBC-260821-XQNQ",
    status: "sent",
    customer: { name: "Kono Designs LLC", email: "y@example.com", address: "121 East 27th street, 514" },
    customerFinalTotal: 20000.03,
    includeContractForCustomer: true,
    contract: { total: 20000.03, sections: { projectType: "Staircase squeak elimination", scopeOfWork: ["Re-secure treads"] } },
    estimate: {
      markupPct: 25,
      summary: "Five-storey staircase squeak elimination",
      labor: [{ item: "Squeak elimination", qty: 1, rate: 13115.85 }],
      materials: [{ item: "Fasteners", qty: 1, rate: 2884.38 }],
      serviceBreakdown: [{ title: "Carpentry", subtotal: 20000.03 }],
    },
    thread: [{ from: "customer", text: "when can you start?" }],
  }, over || {});
}

console.log("\nfreezing what was sent\n");

t("a version records the estimate as it stood", () => {
  const v = buildSentVersion(record(), 1);
  assert.strictEqual(v.n, 1);
  assert.strictEqual(v.estimate.labor[0].rate, 13115.85);
  assert.ok(v.at);
  assert.strictEqual(v.snapshotVersion, SNAPSHOT_VERSION);
});
t("THE COPY IS DEEP — the live record goes on being edited immediately after", () => {
  const r = record();
  const v = buildSentVersion(r, 1);
  r.estimate.labor[0].rate = 99999;
  r.estimate.summary = "changed after sending";
  assert.strictEqual(v.estimate.labor[0].rate, 13115.85, "a reference would have tracked the edit");
  assert.strictEqual(v.estimate.summary, "Five-storey staircase squeak elimination");
});
t("the quoted price is frozen with it, because it overrides the lines everywhere", () => {
  assert.strictEqual(buildSentVersion(record(), 1).customerFinalTotal, 20000.03);
});
t("the contract decision actually sent is recorded", () => {
  const v = buildSentVersion(record(), 2);
  assert.strictEqual(v.includeContractForCustomer, true);
  assert.strictEqual(v.contract.total, 20000.03);
});
t("...and a send with no contract records that too", () => {
  const v = buildSentVersion(record({ includeContractForCustomer: false, contract: null }), 1);
  assert.strictEqual(v.includeContractForCustomer, false);
  assert.strictEqual(v.contract, null);
});
t("junk does not throw", () => {
  assert.ok(buildSentVersion(null, 1));
  assert.ok(buildSentVersion({}, 0));
  assert.deepStrictEqual(buildSentVersion({ estimate: "nonsense" }, 1).estimate, {});
});

/* ══ WHAT THE CUSTOMER RECEIVES ═══════════════════════════════════════════════ */
console.log("\nthe contractor's edits stop leaking\n");

t("THE WHOLE POINT: an edit made after sending is NOT shown to the customer", () => {
  const r = record();
  r.sentVersion = buildSentVersion(r, 1);
  /* Now he edits. This is the afternoon that was lost. */
  r.estimate.labor[0].rate = 40000;
  r.customerFinalTotal = 41000;
  const view = applySentVersion(r, JSON.parse(JSON.stringify(r)));
  assert.strictEqual(view.estimate.labor[0].rate, 13115.85, "the customer must still see what was sent");
  assert.strictEqual(view.customerFinalTotal, 20000.03);
});
t("...including a whole AI regeneration", () => {
  const r = record();
  r.sentVersion = buildSentVersion(r, 1);
  r.estimate = { markupPct: 45, summary: "A COMPLETELY DIFFERENT JOB", labor: [{ item: "Gut renovation", qty: 1, rate: 90000 }], materials: [] };
  const view = applySentVersion(r, JSON.parse(JSON.stringify(r)));
  assert.strictEqual(view.estimate.summary, "Five-storey staircase squeak elimination");
  assert.strictEqual(view.estimate.labor[0].item, "Squeak elimination");
});
t("...and a contract edited after the fact", () => {
  const r = record();
  r.sentVersion = buildSentVersion(r, 1);
  r.contract.total = 55555;
  const view = applySentVersion(r, JSON.parse(JSON.stringify(r)));
  assert.strictEqual(view.contract.total, 20000.03);
});
t("the version is named, so the page can say which one it is", () => {
  const r = record();
  r.sentVersion = buildSentVersion(r, 3);
  const view = applySentVersion(r, JSON.parse(JSON.stringify(r)));
  assert.strictEqual(view.sentVersionInfo.n, 3);
  assert.ok(view.sentVersionInfo.at);
});
t("a record that was never sent is served live, exactly as before", () => {
  const r = record({ sentVersion: null });
  const view = applySentVersion(r, JSON.parse(JSON.stringify(r)));
  assert.strictEqual(view.estimate.labor[0].rate, 13115.85);
  assert.strictEqual(view.sentVersionInfo, undefined, "nothing to announce");
});
t("a malformed version is ignored rather than blanking the quote", () => {
  [{ sentVersion: {} }, { sentVersion: "x" }, { sentVersion: { n: 1 } }].forEach((over) => {
    const r = record(over);
    const view = applySentVersion(r, JSON.parse(JSON.stringify(r)));
    assert.ok(view.estimate && view.estimate.labor, "must fall back to the live estimate");
  });
});
t("junk does not throw", () => {
  assert.ok(applySentVersion(null, { a: 1 }));
  assert.ok(applySentVersion({}, {}));
});

/* ══ THE OTHER FAILURE: FREEZING THE CUSTOMER'S OWN ACTIONS ═══════════════════ */
console.log("\nthe customer's own side stays live\n");

t("THEIR MESSAGES ARE NOT ROLLED BACK — the thread is theirs, not a snapshot", () => {
  const r = record();
  r.sentVersion = buildSentVersion(r, 1);
  r.thread = [{ from: "customer", text: "when can you start?" }, { from: "customer", text: "and can you do the landing too?" }];
  const view = applySentVersion(r, JSON.parse(JSON.stringify(r)));
  assert.strictEqual(view.thread.length, 2, "a customer whose own message vanished would stop trusting the page");
});
t("their option selections are not rolled back", () => {
  const r = record();
  r.sentVersion = buildSentVersion(r, 1);
  r.customerOptionSelections = [{ id: "opt-a", label: "Option A", price: 3850 }];
  const view = applySentVersion(r, JSON.parse(JSON.stringify(r)));
  assert.strictEqual(view.customerOptionSelections.length, 1);
});
t("THEIR ACCEPTED PRICE WINS over the version's copy — they agreed to that figure", () => {
  const r = record();
  r.sentVersion = buildSentVersion(r, 1);
  /* They accepted, adding a paid option; quote-response stamped the new total. */
  r.acceptedAt = "2026-08-31T12:00:00.000Z";
  r.customerFinalTotal = 23850.03;
  const view = applySentVersion(r, JSON.parse(JSON.stringify(r)));
  assert.strictEqual(view.customerFinalTotal, 23850.03, "their own acceptance must not be overwritten by the snapshot");
});
t("...but a contractor's edit to that same field, with no acceptance, does NOT win", () => {
  const r = record();
  r.sentVersion = buildSentVersion(r, 1);
  r.customerFinalTotal = 41000;          /* he changed it; they have not accepted */
  const view = applySentVersion(r, JSON.parse(JSON.stringify(r)));
  assert.strictEqual(view.customerFinalTotal, 20000.03);
});
t("their acceptance and signature are not rolled back", () => {
  const r = record();
  r.sentVersion = buildSentVersion(r, 1);
  r.acceptedAt = "2026-08-31T12:00:00.000Z";
  r.status = "accepted";
  const view = applySentVersion(r, JSON.parse(JSON.stringify(r)));
  assert.strictEqual(view.acceptedAt, "2026-08-31T12:00:00.000Z");
  assert.strictEqual(view.status, "accepted");
});

/* ══ THE CONTRACTOR HAS TO BE ABLE TO SEE THE FREEZE ══════════════════════════
   A freeze he cannot see is its own trap: he edits for an hour believing the
   customer has the new figures, and they are still holding the old ones. */
console.log("\nhas the draft moved since it was sent\n");

t("nothing changed reports nothing changed", () => {
  const r = record();
  r.sentVersion = buildSentVersion(r, 1);
  assert.strictEqual(hasUnsentChanges(r), false);
});
t("A CHANGED RATE IS REPORTED", () => {
  const r = record();
  r.sentVersion = buildSentVersion(r, 1);
  r.estimate.labor[0].rate = 14000;
  assert.strictEqual(hasUnsentChanges(r), true);
});
t("a changed quoted total is reported", () => {
  const r = record();
  r.sentVersion = buildSentVersion(r, 1);
  r.customerFinalTotal = 21000;
  assert.strictEqual(hasUnsentChanges(r), true);
});
t("A CUSTOMER REPLYING IS NOT A CHANGE TO THE QUOTE — that must not light it up", () => {
  const r = record();
  r.sentVersion = buildSentVersion(r, 1);
  r.thread.push({ from: "customer", text: "any update?" });
  r.openedAt = "2026-08-31T09:00:00.000Z";
  assert.strictEqual(hasUnsentChanges(r), false);
});
t("neither is them accepting", () => {
  const r = record();
  r.sentVersion = buildSentVersion(r, 1);
  r.acceptedAt = "2026-08-31T12:00:00.000Z";
  r.status = "accepted";
  assert.strictEqual(hasUnsentChanges(r), false);
});
t("a record never sent has nothing to compare", () => {
  assert.strictEqual(hasUnsentChanges(record()), false);
  assert.strictEqual(hasUnsentChanges(null), false);
  assert.strictEqual(hasUnsentChanges({}), false);
});

/* ══ THE WIRING ═══════════════════════════════════════════════════════════════ */
console.log("\nit is actually used\n");
const fs = require("fs");
const path = require("path");
const SENDQ = fs.readFileSync(path.join(__dirname, "..", "send-quote.js"), "utf8");
const GETEST = fs.readFileSync(path.join(__dirname, "..", "get-estimate.js"), "utf8");
const DASH = fs.readFileSync(path.join(__dirname, "..", "..", "..", "dashboard.html"), "utf8");

t("sending freezes a version", () => {
  assert.ok(/record\.sentVersion = buildSentVersion\(record, record\.sentVersionN\)/.test(SENDQ));
});
t("...numbered one-up, so the contractor can say 'version 3'", () => {
  assert.ok(/record\.sentVersionN = \(Number\(record\.sentVersionN\) \|\| 0\) \+ 1/.test(SENDQ));
});
t("...AFTER the contract decision is set, or it would record the previous one", () => {
  const inc = SENDQ.indexOf("record.includeContractForCustomer = includeContract === true");
  const snap = SENDQ.indexOf("buildSentVersion(record, record.sentVersionN)");
  assert.ok(inc > 0 && snap > inc, "the snapshot must come after");
});
t("THE CUSTOMER'S VIEW APPLIES IT", () => {
  assert.ok(/applySentVersion\(data, view\)/.test(GETEST));
});
t("...and the scope PREVIEW deliberately does not, or the preview would be useless",
  () => assert.ok(/if \(!isDraftPreview\) applySentVersion\(data, view\)/.test(GETEST)));
t("the dashboard says which version the customer holds", () => {
  assert.ok(/sentVersionHtml\(currentRecord\) \+/.test(DASH));
  assert.ok(/The customer is looking at version/.test(DASH));
});
t("...and warns when the draft has moved since", () => {
  assert.ok(/You have changed things since/.test(DASH));
  assert.ok(/Send it again when you are ready/.test(DASH));
});
t("...and says plainly when nothing has been sent at all", () => {
  assert.ok(/Not sent yet — nothing of this is visible to the customer/.test(DASH));
});

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
