/* endpoint-auth.test.js — the gates on the contractor-only endpoints, executed.
 * Run:  node netlify/functions/lib/endpoint-auth.test.js
 *
 * Four endpoints were reachable by anyone who knew the URL. This file proves
 * they are not any more, and — just as important — that the flows which must
 * stay open are still open:
 *
 *   get-estimate    MUST stay public. Every quote link ever sent calls it.
 *   quote-response  MUST stay reachable. The customer presses Accept.
 *
 * @netlify/blobs is a Netlify runtime dependency and is stubbed at the loader.
 */

const Module = require("module");
const path = require("path");

let STORE = {};
let writes = [];
const realLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === "@netlify/blobs") {
    return {
      getStore: () => ({
        get: async (k) => (STORE[k] ? JSON.parse(JSON.stringify(STORE[k])) : null),
        setJSON: async (k, v) => { writes.push(k); STORE[k] = JSON.parse(JSON.stringify(v)); },
        list: async () => ({ blobs: Object.keys(STORE).map((key) => ({ key })) }),
      }),
    };
  }
  return realLoad(req, parent, isMain);
};

const FN = (n) => path.resolve(__dirname, "..", n + ".js");

let pass = 0, fail = 0;
const t = (n, c, d) => { c ? pass++ : fail++; console.log((c ? "PASS  " : "FAIL  ") + n + (d ? "\n        " + d : "")); };

const KEY = "the-real-dashboard-key";

function estimateRecord() {
  return {
    ref: "SBC-260805-XQNQ",
    status: "sent",
    customer: { name: "A Customer", email: "c@example.com", phone: "718-555-0100", address: "123 Somewhere St, Brooklyn" },
    request: { service: "Stairs", selectedServices: ["Stairs"], description: "Rebuild the staircase." },
    estimate: {
      markupPct: 45, showLaborCost: true, showMaterialsCost: true,
      labor: [{ section: "Stairs", item: "Rebuild stair", qty: 1, unit: "ls", rate: 10000 }],
      materials: [{ section: "Stairs", item: "Oak", qty: 1, unit: "ls", rate: 4000 }],
      serviceBreakdown: [{ title: "Stairs", subtotal: 20300, included: [], customerSupplies: [], notIncluded: [], options: [] }],
    },
  };
}
const reset = () => { STORE = { "SBC-260805-XQNQ": estimateRecord() }; writes = []; };

(async () => {
  /* ══════════════════════════════════════════════════════════════════════════
     1. THE GATED ENDPOINTS
     ══════════════════════════════════════════════════════════════════════════ */
  console.log("\n1. Contractor-only endpoints refuse an unkeyed caller");
  process.env.DASHBOARD_KEY = KEY;

  const GATED = [
    ["save-estimate", "POST", { ref: "SBC-260805-XQNQ", estimate: { labor: [], materials: [] } }],
    ["list-estimates", "GET", null],
    ["seo-publish", "POST", { slug: "painting", html: "<html>owned</html>" }],
    ["publish-image-to-page", "POST", { page: "painting", imageBase64: "AAAA" }],
  ];

  for (const [name, method, body] of GATED) {
    reset();
    const { handler } = require(FN(name));

    let r = await handler({ httpMethod: method, headers: {}, body: body ? JSON.stringify(body) : "" });
    t(name + ": no key -> 401", r.statusCode === 401, r.statusCode + " " + String(r.body).slice(0, 120));

    r = await handler({ httpMethod: method, headers: { "x-sbc-key": "guess" }, body: body ? JSON.stringify(body) : "" });
    t(name + ": wrong key -> 401", r.statusCode === 401, r.statusCode + " " + String(r.body).slice(0, 120));

    t(name + ": an unauthorised call wrote nothing", writes.length === 0, JSON.stringify(writes));

    /* A wrong key of a DIFFERENT LENGTH must be rejected the same way — the
       constant-time compare returns early on a length mismatch, and that path
       has to reach the same 401 rather than throwing. */
    r = await handler({ httpMethod: method, headers: { "x-sbc-key": "x" }, body: body ? JSON.stringify(body) : "" });
    t(name + ": short key -> 401, no throw", r.statusCode === 401, r.statusCode + " " + String(r.body).slice(0, 120));
  }

  console.log("\n2. A missing DASHBOARD_KEY refuses — it must never fall open");
  delete process.env.DASHBOARD_KEY;
  for (const [name, method, body] of GATED) {
    reset();
    const { handler } = require(FN(name));
    const r = await handler({ httpMethod: method, headers: { "x-sbc-key": "anything" }, body: body ? JSON.stringify(body) : "" });
    t(name + ": env unset -> 500, not 200", r.statusCode === 500, r.statusCode + " " + String(r.body).slice(0, 100));
    t(name + ": ...and wrote nothing", writes.length === 0, JSON.stringify(writes));
  }
  process.env.DASHBOARD_KEY = KEY;

  console.log("\n3. The right key still gets through");
  {
    reset();
    const { handler } = require(FN("save-estimate"));
    const r = await handler({
      httpMethod: "POST", headers: { "x-sbc-key": KEY },
      body: JSON.stringify({ ref: "SBC-260805-XQNQ", estimate: { labor: [], materials: [], summary: "edited" } }),
    });
    t("save-estimate: correct key -> not 401/500", r.statusCode !== 401 && r.statusCode !== 500,
      r.statusCode + " " + String(r.body).slice(0, 160));
    t("save-estimate: the write actually happened", writes.length === 1, JSON.stringify(writes));
  }
  {
    reset();
    const { handler } = require(FN("list-estimates"));
    const r = await handler({ httpMethod: "GET", headers: { "x-sbc-key": KEY } });
    t("list-estimates: correct key -> 200", r.statusCode === 200, r.statusCode + " " + String(r.body).slice(0, 120));
    t("list-estimates: and returns the data", /SBC-260805-XQNQ/.test(String(r.body)), String(r.body).slice(0, 160));
  }

  console.log("\n4. Header-name spellings");
  {
    reset();
    const { handler } = require(FN("list-estimates"));
    for (const h of ["x-sbc-key", "X-Sbc-Key", "X-SBC-Key"]) {
      const r = await handler({ httpMethod: "GET", headers: { [h]: KEY } });
      t("list-estimates accepts header spelled " + h, r.statusCode === 200, String(r.statusCode));
    }
  }

  console.log("\n5. CORS preflight must still answer without a key");
  for (const [name] of GATED) {
    const { handler } = require(FN(name));
    const r = await handler({ httpMethod: "OPTIONS", headers: {}, body: "" });
    t(name + ": OPTIONS -> 200 with no key", r.statusCode === 200, String(r.statusCode));
    t(name + ": ...and advertises x-sbc-key", /x-sbc-key/i.test(JSON.stringify(r.headers || {})),
      JSON.stringify(r.headers));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     6. WHAT MUST STAY OPEN
     ══════════════════════════════════════════════════════════════════════════ */
  console.log("\n6. Customer-facing endpoints are NOT gated");
  {
    reset();
    const { handler } = require(FN("get-estimate"));
    const r = await handler({ httpMethod: "GET", headers: {}, queryStringParameters: { ref: "SBC-260805-XQNQ" } });
    t("get-estimate with NO key still answers — every quote link depends on it",
      r.statusCode !== 401 && r.statusCode !== 500, r.statusCode + " " + String(r.body).slice(0, 120));
  }

  console.log("\n7. quote-response: open to the customer, but they cannot set the price");
  {
    const { handler } = require(FN("quote-response"));
    const accept = (finalTotal) => handler({
      httpMethod: "POST", headers: {},
      body: JSON.stringify({ ref: "SBC-260805-XQNQ", action: "accept", signature: "A Customer", finalTotal: finalTotal }),
    });

    reset();
    let r = await accept(undefined);
    t("a customer can still accept with no key at all", r.statusCode !== 401, String(r.statusCode));

    /* base = (10000 + 4000) * 1.45 = 20300 */
    reset();
    await accept(1);
    let rec = STORE["SBC-260805-XQNQ"];
    t("accepting at $1 does NOT stamp $1",
      Number(rec.customerFinalTotal) !== 1, "stamped " + rec.customerFinalTotal);
    t("...it stamps the real quoted total instead",
      Math.abs(Number(rec.customerFinalTotal) - 20300) < 0.005, "stamped " + rec.customerFinalTotal);
    t("...and the attempt is recorded for the contractor to see",
      rec.rejectedFinalTotal && rec.rejectedFinalTotal.value === 1, JSON.stringify(rec.rejectedFinalTotal));

    reset();
    await accept(20300);
    t("accepting at the exact quoted total is honoured",
      Math.abs(Number(STORE["SBC-260805-XQNQ"].customerFinalTotal) - 20300) < 0.005,
      "stamped " + STORE["SBC-260805-XQNQ"].customerFinalTotal);

    reset();
    await accept(23800);
    t("accepting HIGHER (paid finish options) is honoured",
      Math.abs(Number(STORE["SBC-260805-XQNQ"].customerFinalTotal) - 23800) < 0.005,
      "stamped " + STORE["SBC-260805-XQNQ"].customerFinalTotal);

    for (const junk of [0, -5000, "free", null, NaN, Infinity]) {
      reset();
      await accept(junk);
      const v = Number(STORE["SBC-260805-XQNQ"].customerFinalTotal);
      t("junk finalTotal " + JSON.stringify(String(junk)) + " never becomes the price",
        !Number.isFinite(v) ? true : v >= 20300 - 0.005, "stamped " + STORE["SBC-260805-XQNQ"].customerFinalTotal);
    }
  }

  console.log("\n──────────────────────────────");
  console.log("  " + pass + " passed, " + fail + " failed");
  console.log("──────────────────────────────");
  process.exit(fail ? 1 : 0);
})();
