// netlify/functions/quote-response.js
// Customer clicks Accept or Decline on quote.html.
// Updates status in Blobs, emails contractor with the news.

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
    const { ref, action, signature, declineReason } = JSON.parse(event.body);
    if (!ref || !action) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing ref or action" }) };
    }
    if (action !== "accept" && action !== "decline") {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Invalid action" }) };
    }

    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const record = await store.get(ref, { type: "json" });
    if (!record) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "Not found" }) };
    }

    if (action === "accept") {
      record.status = "accepted";
      record.acceptedAt = new Date().toISOString();
      record.signature = signature || "";
    } else {
      record.status = "declined";
      record.declinedAt = new Date().toISOString();
      record.declineReason = declineReason || "";
    }
    record.updatedAt = new Date().toISOString();
    await store.setJSON(ref, record);

    // Notify contractor
    const resendKey = process.env.RESEND_API_KEY;
    const contractorEmail = process.env.CONTRACTOR_EMAIL || "sanibuildingcorp@gmail.com";

    if (resendKey) {
      try {
        await notifyContractor(resendKey, contractorEmail, record, action, signature, declineReason);
      } catch (e) {
        console.error("Notification failed:", e.message);
      }
    }

    return { statusCode: 200, headers: cors(), body: JSON.stringify({ success: true, status: record.status }) };
  } catch (err) {
    console.error("quote-response error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

async function notifyContractor(resendKey, contractorEmail, record, action, signature, declineReason) {
  const customer = record.customer || {};
  const est = record.estimate || {};
  const total = calculateTotal(est);

  const isAccept = action === "accept";
  const color = isAccept ? "#2ecc71" : "#e74c3c";
  const emoji = isAccept ? "✅" : "❌";
  const title = isAccept ? "QUOTE ACCEPTED" : "QUOTE DECLINED";

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
<div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#fff;padding:24px;border-radius:10px 10px 0 0;text-align:center">
  <div style="font-size:14px;letter-spacing:3px;color:#c9a84c">SANI BUILDING CORP</div>
  <div style="font-size:11px;letter-spacing:2px;color:#aaa;margin-top:4px">${title}</div>
</div>
<div style="background:#fff;border:1px solid #e8e2d9;border-top:none;padding:28px;border-radius:0 0 10px 10px">
  <div style="text-align:center;margin-bottom:20px">
    <div style="display:inline-block;background:${color};color:#fff;width:64px;height:64px;border-radius:50%;line-height:64px;font-size:32px">${emoji}</div>
  </div>
  <h1 style="text-align:center;color:#0d1b2a;font-size:22px;margin:0 0 8px">${escapeHtml(customer.name || "Customer")} ${isAccept ? "accepted" : "declined"} the quote</h1>
  <p style="text-align:center;color:#888;font-size:13px;margin:0 0 24px">${escapeHtml(est.projectTitle || record.request?.service || "Project")} · ${escapeHtml(record.ref)}</p>

  <table style="width:100%;font-size:14px;margin-bottom:18px;border-collapse:collapse">
    <tr><td style="padding:8px 12px;background:#faf8f4;color:#888;width:140px"><strong>Customer</strong></td><td style="padding:8px 12px">${escapeHtml(customer.name)}</td></tr>
    <tr><td style="padding:8px 12px;background:#faf8f4;color:#888"><strong>Phone</strong></td><td style="padding:8px 12px"><a href="tel:${escapeHtml(customer.phone)}" style="color:#b8720a">${escapeHtml(customer.phone)}</a></td></tr>
    <tr><td style="padding:8px 12px;background:#faf8f4;color:#888"><strong>Email</strong></td><td style="padding:8px 12px"><a href="mailto:${escapeHtml(customer.email)}" style="color:#b8720a">${escapeHtml(customer.email)}</a></td></tr>
    <tr><td style="padding:8px 12px;background:#faf8f4;color:#888"><strong>Address</strong></td><td style="padding:8px 12px">${escapeHtml(customer.address || "—")}</td></tr>
    <tr><td style="padding:8px 12px;background:#faf8f4;color:#888"><strong>Total</strong></td><td style="padding:8px 12px;color:${color};font-weight:700;font-size:16px">$${total.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td></tr>
    ${isAccept && signature ? `<tr><td style="padding:8px 12px;background:#faf8f4;color:#888"><strong>Signature</strong></td><td style="padding:8px 12px;font-style:italic">${escapeHtml(signature)}</td></tr>` : ""}
    ${!isAccept && declineReason ? `<tr><td style="padding:8px 12px;background:#faf8f4;color:#888"><strong>Reason</strong></td><td style="padding:8px 12px">${escapeHtml(declineReason)}</td></tr>` : ""}
  </table>

  ${isAccept ? `<div style="background:#e8f4ed;border-left:4px solid #2ecc71;padding:14px 18px;margin:20px 0;font-size:14px">
    <strong>Next steps:</strong> Send the customer an invoice with deposit details and schedule the project start.
  </div>` : ""}

  <div style="text-align:center;margin-top:24px">
    <a href="tel:${escapeHtml(customer.phone)}" style="display:inline-block;background:#c9a84c;color:#0d1b2a;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:4px">📞 Call ${escapeHtml((customer.name || "").split(" ")[0])}</a>
  </div>
</div>
</body></html>`;

  return sendResend(resendKey, {
    from: "Sani Building Corp <onboarding@resend.dev>",
    to: [contractorEmail],
    reply_to: customer.email,
    subject: `${emoji} ${isAccept ? "ACCEPTED" : "DECLINED"}: ${customer.name} — ${est.projectTitle || record.request?.service} (${record.ref})`,
    html,
  });
}

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
