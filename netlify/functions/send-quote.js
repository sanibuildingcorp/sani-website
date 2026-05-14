// netlify/functions/send-quote.js
// Sends the customer an email with a link to their quote page.
// Updates status to "sent" in Blobs.

const https = require("https");
const { getStore } = require("@netlify/blobs");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  try {
    const { ref } = JSON.parse(event.body);
    if (!ref) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing ref" }) };
    }

    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const record = await store.get(ref, { type: "json" });
    if (!record) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "Not found" }) };
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "RESEND_API_KEY not set" }) };
    }

    const contractorEmail = process.env.CONTRACTOR_EMAIL || "sanibuildingcorp@gmail.com";
    const siteUrl = process.env.SITE_URL || "https://velvety-horse-2aa6e3.netlify.app";

    const customer = record.customer || {};
    const est = record.estimate || {};
    const total = calculateTotal(est);
    const quoteUrl = `${siteUrl}/quote.html?ref=${encodeURIComponent(ref)}`;

    // Check if Resend domain is verified (if not, only sends to contractor's own email)
    const canSendToCustomer = customer.email && customer.email.toLowerCase() === contractorEmail.toLowerCase();
    const useTestSender = !canSendToCustomer; // use onboarding@resend.dev sender always until domain is verified

    // While domain is not verified at Resend, we can't email arbitrary customers.
    // In that case, send the quote email to the contractor with instructions to forward.
    const recipientEmail = canSendToCustomer ? customer.email : contractorEmail;

    const firstName = (customer.name || "there").split(" ")[0];
    const subjectPrefix = canSendToCustomer ? "" : `[FORWARD TO ${customer.email}] `;

    const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif;color:#333;line-height:1.6">
<div style="max-width:560px;margin:0 auto;padding:20px">
  <div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#fff;padding:30px;border-radius:10px 10px 0 0;text-align:center">
    <div style="font-family:Arial,sans-serif;font-size:22px;letter-spacing:4px;color:#c9a84c;font-weight:700">SANI BUILDING CORP</div>
    <div style="font-size:11px;letter-spacing:2px;color:#aaa;margin-top:6px">YOUR ESTIMATE IS READY</div>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #e8e2d9;border-top:none;border-radius:0 0 10px 10px">
    <h1 style="color:#0d1b2a;font-size:24px;margin:0 0 12px">Hi ${escapeHtml(firstName)},</h1>
    <p style="font-size:15px;color:#555">Thanks for reaching out about your <strong>${escapeHtml(est.projectTitle || record.request?.service || "project")}</strong>. We've put together a detailed estimate for you.</p>

    ${est.summary ? `<div style="background:#faf8f4;border-left:4px solid #c9a84c;padding:14px 18px;margin:18px 0;font-size:14px;color:#444">${escapeHtml(est.summary)}</div>` : ""}

    <div style="background:#0d1b2a;color:#fff;padding:24px;border-radius:10px;margin:24px 0;text-align:center">
      <div style="font-size:12px;letter-spacing:2px;color:#c9a84c;text-transform:uppercase">Total Estimate</div>
      <div style="font-size:38px;font-weight:700;color:#fff;margin:8px 0">$${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      ${est.timelineText ? `<div style="font-size:13px;color:#aaa">Estimated timeline: ${escapeHtml(est.timelineText)}</div>` : ""}
    </div>

    <div style="text-align:center;margin:28px 0">
      <a href="${quoteUrl}" style="display:inline-block;background:#c9a84c;color:#0d1b2a;padding:16px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:1px">View Full Estimate →</a>
    </div>

    <p style="font-size:14px;color:#555;margin:24px 0 0">Full scope of work, line-item breakdown, and the option to accept are all on the estimate page. Any questions? Just reply to this email or call <a href="tel:+13322770990" style="color:#b8720a;text-decoration:none;font-weight:600">(332) 277-0990</a>.</p>

    <div style="margin-top:32px;padding-top:24px;border-top:1px solid #eee;text-align:center">
      <div style="color:#888;font-size:11px;letter-spacing:2px;text-transform:uppercase">Sani Building Corp</div>
      <div style="font-size:12px;color:#888;margin-top:4px">Ref: ${escapeHtml(ref)} · Fully Insured · 4.9 ★</div>
    </div>
  </div>
</div>
</body></html>`;

    await sendResend(resendKey, {
      from: "Sani Building Corp <onboarding@resend.dev>",
      to: [recipientEmail],
      reply_to: contractorEmail,
      subject: `${subjectPrefix}Your Estimate from Sani Building Corp — ${est.projectTitle || record.request?.service || "Project"} (${ref})`,
      html,
    });

    // Update status
    record.status = "sent";
    record.sentAt = new Date().toISOString();
    record.updatedAt = record.sentAt;
    record.openedAt = null;
    await store.setJSON(ref, record);

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({ success: true, quoteUrl, sentTo: recipientEmail, forwardedToContractor: !canSendToCustomer }),
    };
  } catch (err) {
    console.error("send-quote error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

function calculateTotal(est) {
  if (!est) return 0;
  const labor = (est.labor || []).reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0);
  const materials = (est.materials || []).reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0);
  const subtotal = labor + materials;
  const markup = subtotal * ((Number(est.markupPct) || 0) / 100);
  return Math.round((subtotal + markup) * 100) / 100;
}

function escapeHtml(t) {
  if (t == null) return "";
  return String(t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sendResend(apiKey, payload) {
  const data = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.resend.com",
        port: 443,
        path: "/emails",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          Authorization: `Bearer ${apiKey}`,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
          else reject(new Error(`Resend ${res.statusCode}: ${body}`));
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
