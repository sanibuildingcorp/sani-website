// netlify/functions/update-customer.js
// Updates customer contact info (name / email / phone / address) on an estimate record.
// Also accepts an optional `description` to correct/expand the customer's job
// description (saved to record.request.description).
// Used by the dashboard's "Edit Customer Info" panel, and by the assistant's
// "describe" action (a fact from an email added to the description).
//
// CONTRACTOR ONLY. POST with header  x-sbc-key: <DASHBOARD_KEY>.
// It rewrites a customer's name, address, phone and email on any estimate;
// it had no gate.

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const history = require("./lib/history");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;

  try {
    const { ref, customer, description, serviceAnswers, service, propertyType, timeline } = JSON.parse(event.body || "{}");
    if (!ref || !customer || typeof customer !== "object") {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing ref or customer" }) };
    }

    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const record = await store.get(ref, { type: "json" });
    if (!record) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "Estimate not found" }) };
    }

    const clean = function (v) { return String(v == null ? "" : v).trim().slice(0, 300); };
    const wasCustomer = JSON.parse(JSON.stringify(record.customer || {})), wasDescription = String((record.request || {}).description || "").trim(), wasService = String((record.request || {}).service || "");
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
    /* ── THE SERVICES THE GENERATOR PRICES ────────────────────────────────
         "in the form May maybe accidentally add water damage too but in her
          description and request no water damage work required, generator
          also use this words and then it's generating with its services"
       request.service ("Bathroom, Water Damage") and the selected-services
       lists are what the estimator reads as the trades to price. Every copy
       is rewritten together, or the one he did not see keeps the old trade
       alive. Comma-separated; an empty string is refused (a job with no
       service cannot be priced), so the field is only ever corrected. */
    if (service !== undefined) {
      const names = String(service == null ? "" : service).split(/[,/&]+/).map(function (s) { return s.trim().slice(0, 60); }).filter(Boolean).slice(0, 8);
      if (!names.length) return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Name at least one service" }) };
      record.request = record.request || {};
      record.request.service = names.join(", ");
      record.request.services = names.slice();
      record.request.selectedServices = names.slice();
    }
    if (propertyType !== undefined) { record.request = record.request || {}; record.request.propertyType = clean(propertyType).slice(0, 80); }
    if (timeline !== undefined) { record.request = record.request || {}; record.request.timeline = clean(timeline).slice(0, 120); }
    if (serviceAnswers && typeof serviceAnswers === "object" && !Array.isArray(serviceAnswers)) {
      record.request = record.request || {};
      const merged = Object.assign({}, record.request.serviceAnswers || {});
      Object.keys(serviceAnswers).slice(0, 40).forEach(function (k) {
        const key = String(k).slice(0, 80);
        merged[key] = String(serviceAnswers[k] == null ? "" : serviceAnswers[k]).trim().slice(0, 500);
      });
      record.request.serviceAnswers = merged;
    }
    const changed = [];
    if (JSON.stringify(record.customer) !== JSON.stringify(wasCustomer)) changed.push("customer details");
    if (description !== undefined && String(description == null ? "" : description).trim() !== wasDescription) changed.push("description");
    if (service !== undefined && record.request.service !== wasService) changed.push("services set to " + record.request.service + (wasService ? " (was " + wasService + ")" : ""));
    if (serviceAnswers && typeof serviceAnswers === "object" && !Array.isArray(serviceAnswers) && Object.keys(serviceAnswers).length) changed.push("answers");
    if (changed.length) history.note(record, "customer", "Edited: " + changed.join(", "));
    record.updatedAt = new Date().toISOString();
    await store.setJSON(ref, record);

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({ success: true, customer: record.customer, description: (record.request || {}).description, serviceAnswers: (record.request || {}).serviceAnswers, service: (record.request || {}).service, propertyType: (record.request || {}).propertyType, timeline: (record.request || {}).timeline }),
    };
  } catch (err) {
    console.error("update-customer error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-sbc-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
