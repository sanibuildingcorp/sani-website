// netlify/functions/save-contract.js
// Saves the contractor's edits to the AI-generated contract.
// Blocked once the customer has signed.
// POST { ref, sections:{projectType, scopeOfWork[], materialsList[], timeline, paymentSchedule[{label,amount}], clauses{}}, retotal? }
//
// `retotal: true` brings the contract's PRICE up to the estimate's. The figure is
// computed here, never taken from the request. See lib/contract-total.js.

const { getStore } = require("@netlify/blobs");
const { contractDrift, rescaleSchedule } = require("./lib/contract-total");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { ref, sections } = body;
    if (!ref || !sections || typeof sections !== "object") {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing ref or sections" }) };
    }

    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const record = await store.get(ref, { type: "json" });
    if (!record) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "Estimate not found" }) };
    }
    if (record.contract && record.contract.signed) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Contract is already signed and can no longer be edited" }) };
    }

    const clean = function (v, n) { return String(v == null ? "" : v).trim().slice(0, n || 600); };
    const cleanArr = function (a, n) {
      return (Array.isArray(a) ? a : []).map(function (x) { return clean(x, 400); }).filter(Boolean).slice(0, n || 30);
    };

    const prev = record.contract || { generatedAt: new Date().toISOString(), total: 0 };
    const c = sections.clauses || {};

    /* ── THE TOTAL ─────────────────────────────────────────────────────────────
       This was `total: prev.total`, full stop — so the contract's price could not
       be changed by any edit at all. Update the estimate because the customer
       asked for more work, come here to bring the contract along, and the number
       simply stayed where it was. That is how a contract came to say $10,000.01
       against a $20,000.03 estimate.

       Changing it is a deliberate act (`retotal: true`), and the new figure is
       computed HERE from the record rather than read from the request. The price
       on a contract is not the browser's to assert — a client that could name it
       could name any number. */
    let nextTotal = prev.total;
    if (body.retotal === true) {
      const drift = contractDrift(record);
      if (drift.estimateTotal > 0) nextTotal = drift.estimateTotal;
    }

    record.contract = {
      generatedAt: prev.generatedAt || new Date().toISOString(),
      editedAt: new Date().toISOString(),
      total: nextTotal,
      /* Kept so the panel can say what it moved from, and so a rescale is
         distinguishable from an ordinary edit in the record. */
      retotaledAt: body.retotal === true && nextTotal !== prev.total ? new Date().toISOString() : prev.retotaledAt,
      retotaledFrom: body.retotal === true && nextTotal !== prev.total ? prev.total : prev.retotaledFrom,
      customerName: prev.customerName || (record.customer && record.customer.name) || "",
      projectAddress: clean(sections.projectAddress, 300) || prev.projectAddress || "",
      sections: {
        projectType: clean(sections.projectType, 200) || "Renovation Project",
        scopeOfWork: cleanArr(sections.scopeOfWork, 30),
        materialsList: cleanArr(sections.materialsList, 40),
        timeline: clean(sections.timeline, 400),
        /* On a retotal the LABELS are the contractor's and the AMOUNTS are the
           server's: each row keeps its share of the job, scaled to the new total,
           with the rounding remainder on the last row so the schedule sums to the
           price exactly. Doing it here rather than trusting the browser's
           arithmetic means the two can never disagree on a signature page. */
        paymentSchedule: (function () {
          const rows = (Array.isArray(sections.paymentSchedule) ? sections.paymentSchedule : [])
            .map(function (p) { return { label: clean(p.label, 200), amount: Math.round((Number(p.amount) || 0) * 100) / 100 }; })
            .filter(function (p) { return p.label; })
            .slice(0, 8);
          return body.retotal === true ? rescaleSchedule(rows, nextTotal) : rows;
        })(),
        clauses: {
          hiddenConditions: clean(c.hiddenConditions, 1200),
          changeOrder: clean(c.changeOrder, 1200),
          warranty: clean(c.warranty, 1200),
          cancellation: clean(c.cancellation, 1200),
          permitsAndInsurance: clean(c.permitsAndInsurance, 1200),
        },
      },
    };
    record.updatedAt = new Date().toISOString();
    await store.setJSON(ref, record);

    return { statusCode: 200, headers: cors(), body: JSON.stringify({ success: true, contract: record.contract }) };
  } catch (err) {
    console.error("save-contract error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
