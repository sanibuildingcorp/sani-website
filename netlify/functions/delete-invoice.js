// netlify/functions/delete-invoice.js
// Permanently removes ONE invoice from an estimate record (for accidental
// duplicates). Does NOT email anyone — if the customer already received the
// invoice email, tell them to disregard that invoice number.
//
// POST body: { ref, invoiceNumber }  — both required (destructive action).

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
    const invoiceNumber = body.invoiceNumber;

    if (!ref || !invoiceNumber) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing ref or invoiceNumber" }) };
    }

    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const record = await store.get(ref, { type: "json" });
    if (!record) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "Estimate not found" }) };
    }

    const invoices = record.invoices || [];
    const idx = invoices.findIndex(function (i) { return i.number === invoiceNumber; });
    if (idx === -1) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "Invoice not found on this record" }) };
    }

    const removed = invoices.splice(idx, 1)[0];
    record.invoices = invoices;

    // If that was the last invoice and the record's status was "invoiced",
    // step it back to "accepted". Completed/paid/other statuses are left alone.
    if (invoices.length === 0 && record.status === "invoiced") {
      record.status = "accepted";
    }
    record.updatedAt = new Date().toISOString();

    await store.setJSON(ref, record);

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({
        success: true,
        deleted: removed.number,
        remaining: invoices.length,
        recordStatus: record.status,
      }),
    };
  } catch (err) {
    console.error("delete-invoice error:", err.message);
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
