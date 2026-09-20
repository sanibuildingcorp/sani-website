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
const thread = require("./lib/thread");

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

    /* READ IN PARALLEL, A FEW AT A TIME. This used to await each record in
       turn: one round trip per estimate, in series. At ~60ms each that is
       harmless for thirty records and past Netlify's 10-second kill for a
       couple of hundred - and the dashboard then showed "No estimates here
       yet", as if the business had none. Reads are independent, so they run
       concurrently, capped so a big store does not open hundreds of sockets. */
    const estimates = await readAll(store, blobs.map((b) => b.key), READ_CONCURRENCY);

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
      /* Additional work: the agreed estimate this one belongs to, and the
         add-ons made for this one (create-estimate parentRef). */
      parentRef: e.parentRef || null,
      addonRefs: Array.isArray(e.addonRefs) ? e.addonRefs : [],
      submittedAt: e.submittedAt,
      updatedAt: e.updatedAt,
      sentAt: e.sentAt,
      acceptedAt: e.acceptedAt,
      /* When the job was finished - the list badge and the assistant read it. */
      completedAt: e.estimate?.completedAt || null,
      completedOn: e.estimate?.completedOn || null,
      /* Who spoke last - the morning action list and the alerts read it. */
      needsReply: thread.needsReply(e),
      lastCustomerMessageAt: e.lastCustomerMessageAt || null,
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


const READ_CONCURRENCY = 12;

async function readAll(store, keys, limit) {
  const out = new Array(keys.length);
  let next = 0;
  async function worker() {
    while (next < keys.length) {
      const i = next++;
      try {
        out[i] = await store.get(keys[i], { type: "json" });
      } catch (e) {
        console.error("Failed to load", keys[i], e.message);
        out[i] = null;
      }
    }
  }
  const workers = [];
  for (let w = 0; w < Math.max(1, Math.min(limit, keys.length)); w++) workers.push(worker());
  await Promise.all(workers);
  return out.filter(Boolean);
}
exports._readAll = readAll;

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-sbc-key",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}
