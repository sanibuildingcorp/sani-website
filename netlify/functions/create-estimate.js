// netlify/functions/create-estimate.js
// Creates a NEW estimate record manually from the dashboard
// (for invoices/quotes that didn't come through the customer form).
// v2 (Aug 3 2026): accepts optional booking context — description, scopeOfWork,
// summary, and prefilled labor/materials lines — so an invoice created from a
// completed handyman booking arrives with the whole job already in it.
//
// v3: ADDITIONAL WORK ON AN AGREED ESTIMATE.
//
//   "she already agreed with this current service estimate but then she add
//    additional service for painting, i need keep current estimate untouched"
//
// With `parentRef`, the new record is an ADD-ON: a separate estimate for the
// new work only, linked to the agreed one. The customer, the address and the
// property come from the parent; his words on the new work become the
// request the AI prices; the title says what it is. The parent gets ONE
// thing written on it - the add-on's ref in `addonRefs` - and nothing else:
// not its estimate, not its sent version, not its status, not updatedAt.
// The customer's original link, price, scope and PDF stay exactly as agreed.
//
// CONTRACTOR ONLY (x-sbc-key): open, anyone could fill the dashboard with
// records - or attach an add-on to any customer's job.

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");

const ADDON_MAX = 12;

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
    const body = JSON.parse(event.body || "{}");
    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });

    /* The agreed estimate this is additional work to, when it is one. */
    const parentRef = String(body.parentRef || "").trim().toUpperCase();
    let parent = null;
    if (parentRef) {
      parent = await store.get(parentRef, { type: "json" });
      if (!parent) return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "The estimate " + parentRef + " was not found" }) };
      if (parent.parentRef) return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: parentRef + " is itself additional work; add to the original estimate " + parent.parentRef }) };
      if ((Array.isArray(parent.addonRefs) ? parent.addonRefs.length : 0) >= ADDON_MAX) return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "That estimate already has " + ADDON_MAX + " add-ons" }) };
    }
    const given = body.customer && typeof body.customer === "object" ? body.customer : {};
    const customer = given.name && given.email ? given : (parent ? (parent.customer || {}) : given);
    if (!customer.name || !customer.email) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Customer name and email are required" }) };
    }
    const parentReq = (parent && parent.request) || {};
    const parentEst = (parent && parent.estimate) || {};
    const parentTitle = String(parentEst.projectTitle || parentReq.service || parentRef).trim();
    const words = String(body.description || "").trim();
    if (parent && !words) return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Say what the additional work is" }) };

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
      status: parent ? "new" : "drafted",
      source: parent ? "addon" : "manual",
      customer: {
        name: String(customer.name).trim(),
        email: String(customer.email).trim(),
        phone: String(customer.phone || "").trim(),
        address: String(customer.address || "").trim(),
      },
      request: {
        service: String(body.service || (parent ? parentReq.service : "") || "Manual Invoice").trim(),
        description: parent
          ? (words.slice(0, 2000) + "\n\n[Additional work to estimate " + parentRef + " - " + parentTitle + " - which the customer already agreed to and which is priced separately. Price ONLY the additional work described above.]")
          : String(body.description || "Created manually from dashboard").slice(0, 2000),
        photoCount: 0,
        photos: [],
      },
      estimate: {
        projectTitle: String(body.projectTitle || (parent ? "Additional work: " + words.slice(0, 60) : "")).trim(),
        summary: String(body.summary || "").slice(0, 1000),
        scopeOfWork: String(body.scopeOfWork || "").slice(0, 4000),
        timelineText: String(body.timelineText || "").slice(0, 300),
        notes: "",
        markupPct: parent && Number.isFinite(Number(parentEst.markupPct)) ? Number(parentEst.markupPct) : 0,
        showLaborCost: true,
        showMaterialsCost: false,
        labor: sanitizeLines(body.labor),
        materials: sanitizeLines(body.materials),
        quotePhotos: [],
      },
    };
    if (parent) {
      record.parentRef = parentRef;
      record.addon = true;
      if (parentReq.propertyType) record.request.propertyType = parentReq.propertyType;
    }

    // Extremely unlikely, but never overwrite an existing ref
    const existing = await store.get(ref, { type: "json" });
    if (existing) {
      return { statusCode: 409, headers: cors(), body: JSON.stringify({ error: "Ref collision, please try again" }) };
    }

    await store.setJSON(ref, record);

    /* The one write on the parent: the link. Nothing else on it moves. */
    if (parent) {
      const refs = Array.isArray(parent.addonRefs) ? parent.addonRefs.filter(function (r) { return r && r !== ref; }) : [];
      refs.push(ref);
      parent.addonRefs = refs;
      await store.setJSON(parentRef, parent);
    }

    return { statusCode: 200, headers: cors(), body: JSON.stringify({ success: true, ref: ref, parentRef: parentRef || undefined }) };
  } catch (err) {
    console.error("create-estimate error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

function sanitizeLines(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 20).map(function (l) {
    return {
      item: String((l && l.item) || "").slice(0, 300),
      qty: Number((l && l.qty)) || 1,
      unit: String((l && l.unit) || "ea").slice(0, 12),
      rate: Number((l && l.rate)) || 0,
    };
  }).filter(function (l) { return l.item; });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-sbc-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
