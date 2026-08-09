// ============================================================
// track-quote-open.js
// ------------------------------------------------------------
// Fires EVERY time the customer opens quote.html (forever).
// - Looks up the estimate in Netlify Blobs by ?ref=ESTxxxxx
// - Increments openCount, records lastOpenedAt
// - Keeps the first openedAt + flips status to "opened" once
// - Sends an email notification on every open
// ============================================================

const { getStore } = require("@netlify/blobs");
const customerTotals = require("./lib/customer-total");

const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "" };
  }

  const ref = (event.queryStringParameters || {}).ref;
  if (!ref) return pixelResponse(cors);

  try {
    const store = getStore({
      name: "estimates",
      siteID: process.env.MY_SITE_ID,
      token: process.env.MY_BLOBS_TOKEN,
    });

    const record = await store.get(ref, { type: "json" });
    if (!record) {
      console.log("track-quote-open: ref not found:", ref);
      return pixelResponse(cors);
    }

    // ---- TRACK EVERY OPEN (no gate) ----
    const nowIso = new Date().toISOString();
    record.openCount = (record.openCount || 0) + 1;
    record.lastOpenedAt = nowIso;
    if (!record.openedAt) record.openedAt = nowIso; // first open
    if (record.status === "sent") record.status = "opened";
    await store.setJSON(ref, record);

    // Notify on every open
    await sendEmail(record, ref);

    console.log("track-quote-open: open #" + record.openCount + " for", ref);
  } catch (err) {
    console.error("track-quote-open error:", err);
  }

  return pixelResponse(cors);
};

function pixelResponse(cors) {
  return {
    statusCode: 200,
    headers: {
      ...cors,
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0",
    },
    body: PIXEL.toString("base64"),
    isBase64Encoded: true,
  };
}

/* This alert tells you what the customer is looking at, so it reports the
   customer-facing total. An explicit total stored on the estimate still wins. */
function computeTotal(est, record) {
  if (!est) return null;
  for (const k of ["customerTotal", "grandTotal", "total"]) {
    if (est[k] != null && est[k] !== "") return Number(est[k]);
  }
  const sum = customerTotals(est, record).customerTotal;
  return sum > 0 ? sum : null;
}

async function sendEmail(record, ref) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.CONTRACTOR_EMAIL;
  if (!key || !to) {
    console.log("Email skipped — RESEND_API_KEY or CONTRACTOR_EMAIL missing");
    return;
  }

  // Read the REAL record shape: customer / estimate / request
  const customer = record.customer || {};
  const est = record.estimate || {};
  const reqData = record.request || {};

  const name = customer.name || record.fullName || record.name || "Customer";
  const email = customer.email || record.email || "";
  const phone = customer.phone || record.phone || "";
  const service = est.projectTitle || reqData.service || record.service || "renovation";
  const openCount = record.openCount || 1;
  const repeat = openCount > 1;

  const totalNum = computeTotal(est, record);
  const totalStr = totalNum != null
    ? "$" + Number(totalNum).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;

  const when = new Date(record.lastOpenedAt || Date.now()).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const heading = repeat
    ? `👀 Customer opened quote again (open #${openCount})`
    : `👀 Customer Opened Quote`;
  const lead = repeat
    ? `${escape(name)} just opened their quote again — that's ${openCount} times now.`
    : `${escape(name)} just viewed their quote.`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#0a1628;color:#f5f5f5;border-radius:8px">
      <h2 style="color:#d4af37;margin:0 0 12px">${heading}</h2>
      <p style="font-size:16px;margin:0 0 16px">${lead}</p>
      <table style="width:100%;font-size:14px;color:#cfd8dc">
        <tr><td style="padding:4px 0;color:#90a4ae">Reference:</td><td><b>${escape(ref || record.ref || "")}</b></td></tr>
        <tr><td style="padding:4px 0;color:#90a4ae">Service:</td><td>${escape(service)}</td></tr>
        ${totalStr ? `<tr><td style="padding:4px 0;color:#90a4ae">Total:</td><td>${escape(totalStr)}</td></tr>` : ""}
        <tr><td style="padding:4px 0;color:#90a4ae">Email:</td><td>${escape(email)}</td></tr>
        <tr><td style="padding:4px 0;color:#90a4ae">Phone:</td><td>${escape(phone)}</td></tr>
        <tr><td style="padding:4px 0;color:#90a4ae">Times opened:</td><td><b>${openCount}</b></td></tr>
        <tr><td style="padding:4px 0;color:#90a4ae">Opened at:</td><td>${when} ET</td></tr>
      </table>
      ${phone ? `<p style="margin:20px 0 0"><a href="tel:${escape(phone)}" style="display:inline-block;padding:12px 26px;background:#d4af37;color:#0a1628;text-decoration:none;font-weight:700;letter-spacing:1px;border-radius:8px;font-size:14px">📞 Call ${escape(name)}</a></p>` : ""}
      <p style="margin:20px 0 0;font-size:13px;color:#90a4ae">
        ⚡ They're reviewing your quote — a great moment to follow up. This alert fires every time the quote is opened.
      </p>
    </div>
  `;

  const from =
    process.env.RESEND_FROM || "Sani Building Corp <estimates@sanibuildingcorp.com>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `👀 ${name} opened their quote${repeat ? ` (×${openCount})` : ""} — ${ref || record.ref || ""}`,
      html,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error("Resend failed:", res.status, txt);
  }
}

function escape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
