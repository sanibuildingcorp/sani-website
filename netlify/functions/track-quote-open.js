// ============================================================
// track-quote-open.js
// ------------------------------------------------------------
// Fires ONCE when the customer opens quote.html.
// - Looks up the estimate in Netlify Blobs by ?ref=ESTxxxxx
// - If openedAt is NOT set: marks it, sends email + SMS to you
// - If openedAt IS set: does nothing (refresh = silent)
// ============================================================

const { getStore } = require("@netlify/blobs");

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

    // ---- THE "ONCE PER QUOTE" GATE ----
    if (record.openedAt) {
      console.log("track-quote-open: already opened, skipping:", ref);
      return pixelResponse(cors);
    }

    record.openedAt = new Date().toISOString();
    record.status = record.status === "sent" ? "opened" : record.status;
    await store.setJSON(ref, record);

    await Promise.allSettled([sendEmail(record), sendSMS(record)]);

    console.log("track-quote-open: notified for", ref);
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

async function sendEmail(record) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.CONTRACTOR_EMAIL;
  if (!key || !to) {
    console.log("Email skipped — RESEND_API_KEY or CONTRACTOR_EMAIL missing");
    return;
  }

  const name = record.fullName || record.name || "Customer";
  const service = record.service || "renovation";
  const total = record.total || record.estimatedTotal || "—";
  const when = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#0a1628;color:#f5f5f5;border-radius:8px">
      <h2 style="color:#d4af37;margin:0 0 12px">👀 Customer Opened Quote</h2>
      <p style="font-size:16px;margin:0 0 16px">${escape(name)} just viewed their quote.</p>
      <table style="width:100%;font-size:14px;color:#cfd8dc">
        <tr><td style="padding:4px 0;color:#90a4ae">Reference:</td><td><b>${escape(record.ref || "")}</b></td></tr>
        <tr><td style="padding:4px 0;color:#90a4ae">Service:</td><td>${escape(service)}</td></tr>
        <tr><td style="padding:4px 0;color:#90a4ae">Total:</td><td>$${escape(String(total))}</td></tr>
        <tr><td style="padding:4px 0;color:#90a4ae">Email:</td><td>${escape(record.email || "")}</td></tr>
        <tr><td style="padding:4px 0;color:#90a4ae">Phone:</td><td>${escape(record.phone || "")}</td></tr>
        <tr><td style="padding:4px 0;color:#90a4ae">Opened at:</td><td>${when} ET</td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:13px;color:#90a4ae">
        This fires only the FIRST time the quote is opened. Refreshes are silent.
      </p>
    </div>
  `;

  const from =
    process.env.RESEND_FROM || "Sani Building Corp <onboarding@resend.dev>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `👀 ${name} opened their quote — ${record.ref || ""}`,
      html,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error("Resend failed:", res.status, txt);
  }
}

async function sendSMS(record) {
  const sid = process.env.TWILIO_SID;
  const token = process.env.TWILIO_TOKEN;
  const from = process.env.TWILIO_FROM;
  const to = process.env.CONTRACTOR_PHONE;
  if (!sid || !token || !from || !to) {
    console.log("SMS skipped — Twilio vars missing");
    return;
  }

  const name = record.fullName || record.name || "Customer";
  const ref = record.ref || "";
  const body = `Sani Building: ${name} just opened quote ${ref}. Check your email.`;

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const params = new URLSearchParams({ To: to, From: from, Body: body });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  );

  if (!res.ok) {
    const txt = await res.text();
    console.error("Twilio failed:", res.status, txt);
  }
}

function escape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
