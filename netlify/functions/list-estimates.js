// netlify/functions/list-estimates.js
// Returns all estimates from Blobs storage. Dashboard calls this on load.
//
// CONTRACTOR ONLY. GET with header  x-sbc-key: <DASHBOARD_KEY>.
//
// THIS WAS THE WORST OF THE OPEN ENDPOINTS. A plain GET, no key, no password,
// returned EVERY estimate in the business: customer names, home addresses,
// phone numbers, email addresses and prices, for every job ever quoted. One URL,
// no credentials, the whole customer list.
//
// Callers, all contractor-side: dashboard.html on load, and inbox-list.js /
// inbox-sync.js server-to-server. The server-side callers now send the key from
// their own environment; nothing a customer's browser does reaches this.

const { getStore } = require("@netlify/blobs");
const customerTotals = require("./lib/customer-total");
const { requireDashboardKey } = require("./lib/require-dashboard-key");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;

  try {
    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const { blobs } = await store.list();

    const estimates = [];
    for (const blob of blobs) {
      try {
        const data = await store.get(blob.key, { type: "json" });
        if (data) estimates.push(data);
      } catch (e) {
        console.error("Failed to load", blob.key, e.message);
      }
    }

    // Sort newest first
    estimates.sort((a, b) => {
      return new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0);
    });

    // Strip photos from list view to keep payload small
    const lightweight = estimates.map((e) => ({
      ref: e.ref,
      status: e.status,
      customer: e.customer,
      request: {
        service: e.request?.service,
        propertyType: e.request?.propertyType,
        timeline: e.request?.timeline,
        photoCount: e.request?.photoCount || 0,
      },
      estimate: {
        projectTitle: e.estimate?.projectTitle || "",
        /* grandTotal stays the INTERNAL figure - this list is the contractor's.
           customerTotal is what that job's quote page actually shows, so the two
           can be told apart at a glance instead of assumed equal. */
        grandTotal: customerTotals(e.estimate, e).grandTotal,
        customerTotal: customerTotals(e.estimate, e).customerTotal,
      },
      submittedAt: e.submittedAt,
      updatedAt: e.updatedAt,
      sentAt: e.sentAt,
      acceptedAt: e.acceptedAt,
      unpaidTotal: (e.invoices || [])
        .filter((inv) => inv.status !== "paid")
        .reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0),
      unpaidCount: (e.invoices || []).filter((inv) => inv.status !== "paid").length,
      invoiceCount: (e.invoices || []).length,
    }));

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({ estimates: lightweight }),
    };
  } catch (err) {
    console.error("list-estimates error:", err.message);
    return {
      statusCode: 500,
      headers: cors(),
      body: JSON.stringify({ error: err.message }),
    };
  }
};


function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-sbc-key",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}
