// netlify/functions/mark-invoice-paid.js
// Flips a single invoice (inside an estimate record) between paid / unpaid.
// Standalone — does not modify or depend on any other function.
//
// POST body: { ref, invoiceNumber?, paid?, paidDate? }
//   ref          (required) estimate ref, e.g. "SBC-260613-HG5U"
//   invoiceNumber(optional) e.g. "INV-260613-HG5U-01". If omitted, the
//                           most recent invoice on the record is used.
//   paid         (optional) true = mark paid (default), false = mark unpaid
//   paidDate     (optional) "YYYY-MM-DD" or ISO string. Defaults to now.

const { getStore } = require("@netlify/blobs");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const ref = body.ref;
    const invoiceNumber = body.invoiceNumber || null;
    const paid = body.paid !== false; // default true
    const paidDate = body.paidDate || null;

    if (!ref) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing ref" }) };
    }

    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const record = await store.get(ref, { type: "json" });
    if (!record) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "Estimate not found" }) };
    }

    const invoices = record.invoices || [];
    if (invoices.length === 0) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "No invoices on this record" }) };
    }

    // Find the target invoice (by number, else the most recent one)
    let target = null;
    if (invoiceNumber) {
      target = invoices.find(function (i) { return i.number === invoiceNumber; });
    }
    if (!target) {
      target = invoices[invoices.length - 1];
    }

    const nowIso = new Date().toISOString();

    if (paid) {
      target.status = "paid";
      target.paidAt = paidDate || nowIso;
    } else {
      // Revert: if it has a due date in the past it'll render "Overdue",
      // otherwise "Unpaid" — that logic lives in invoice.html.
      target.status = "sent";
      target.paidAt = null;
    }

    // Keep the top-level record status sensible:
    // - if ANY invoice is still unpaid -> "invoiced"
    // - if EVERY invoice is paid       -> "paid"
    const anyUnpaid = invoices.some(function (i) { return i.status !== "paid"; });
    record.status = anyUnpaid ? "invoiced" : "paid";
    record.updatedAt = nowIso;

    await store.setJSON(ref, record);

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({
        success: true,
        invoiceNumber: target.number,
        invoiceStatus: target.status,
        paidAt: target.paidAt,
        recordStatus: record.status,
      }),
    };
  } catch (err) {
    console.error("mark-invoice-paid error:", err.message);
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
