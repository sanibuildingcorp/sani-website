// netlify/functions/update-customer.js
// Updates customer contact info (name / email / phone / address) on an estimate record.
// Also accepts an optional `description` to correct/expand the customer's job
// description (saved to record.request.description).
// Used by the dashboard's "Edit Customer Info" panel.

const { getStore } = require("@netlify/blobs");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  try {
    const { ref, customer, description } = JSON.parse(event.body || "{}");
    if (!ref || !customer || typeof customer !== "object") {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing ref or customer" }) };
    }

    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const record = await store.get(ref, { type: "json" });
    if (!record) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "Estimate not found" }) };
    }

    const clean = function (v) { return String(v == null ? "" : v).trim().slice(0, 300); };
    record.customer = Object.assign({}, record.customer || {}, {
      name: clean(customer.name),
      email: clean(customer.email),
      phone: clean(customer.phone),
      address: clean(customer.address),
    });
    if (description !== undefined) {
      record.request = record.request || {};
      record.request.description = String(description == null ? "" : description).trim().slice(0, 3000);
    }
    record.updatedAt = new Date().toISOString();
    await store.setJSON(ref, record);

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({ success: true, customer: record.customer, description: (record.request || {}).description }),
    };
  } catch (err) {
    console.error("update-customer error:", err.message);
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
