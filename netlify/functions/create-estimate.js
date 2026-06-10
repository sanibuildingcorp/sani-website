// netlify/functions/create-estimate.js
// Creates a NEW estimate record manually from the dashboard
// (for invoices/quotes that didn't come through the customer form).
// Standalone — does not modify any existing function.

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
    const customer = body.customer || {};
    if (!customer.name || !customer.email) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Customer name and email are required" }) };
    }

    // Ref format matches existing records: SBC-YYMMDD-XXXX
    const d = new Date();
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let rand = "";
    for (let i = 0; i < 4; i++) rand += chars[Math.floor(Math.random() * chars.length)];
    const ref = "SBC-" + yy + mm + dd + "-" + rand;

    const record = {
      ref: ref,
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "drafted",
      source: "manual",
      customer: {
        name: String(customer.name).trim(),
        email: String(customer.email).trim(),
        phone: String(customer.phone || "").trim(),
        address: String(customer.address || "").trim(),
      },
      request: {
        service: String(body.service || "Manual Invoice").trim(),
        description: "Created manually from dashboard",
        photoCount: 0,
        photos: [],
      },
      estimate: {
        projectTitle: String(body.projectTitle || "").trim(),
        summary: "",
        scopeOfWork: "",
        timelineText: "",
        notes: "",
        markupPct: 0,
        showLaborCost: true,
        showMaterialsCost: false,
        labor: [],
        materials: [],
        quotePhotos: [],
      },
    };

    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });

    // Extremely unlikely, but never overwrite an existing ref
    const existing = await store.get(ref, { type: "json" });
    if (existing) {
      return { statusCode: 409, headers: cors(), body: JSON.stringify({ error: "Ref collision, please try again" }) };
    }

    await store.setJSON(ref, record);

    return { statusCode: 200, headers: cors(), body: JSON.stringify({ success: true, ref: ref }) };
  } catch (err) {
    console.error("create-estimate error:", err.message);
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
