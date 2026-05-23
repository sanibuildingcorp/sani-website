// netlify/functions/send-quote.js
// Sends the customer an email with a link to their quote page.
// Updates status to "sent" in Blobs.
// Email format adapts to estimate.displayMode: "total" | "labor" | "full"

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

    // Determine display mode (default: "labor")
    const displayMode = ["total", "labor", "full"].includes(est.displayMode) ? est.displayMode : "labor";

    const canSendToCustomer = customer.email && customer.email.toLowerCase() === contractorEmail.toLowerCase();
    const recipientEmail = canSendToCustomer ? customer.email : contractorEmail;

    const firstName = (customer.name || "there").split(" ")[0];
    const subjectPrefix = canSendToCustomer ? "" : `[FORWARD TO ${customer.email}] `;

    // Build mode-specific HTML sections
    const laborItemsHtml = (est.labor || []).map(item => {
      const qtyDisplay = (Number(item.qty) > 0) ? `${escapeHtml(item.qty)} ${escapeHtml(item.unit || "")}` : "";
      return `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f0ebe0;color:#444">${escapeHtml(item.item)}</td>
        ${qtyDisplay ? `<td style="padding:10px 12px;border-bottom:1px solid #f0ebe0;color:#888;font-size:13px;text-align:right;white-space:nowrap">${qtyDisplay}</td>` : '<td style="padding:10px 12px;border-bottom:1px solid #f0ebe0"></td>'}
      </tr>`;
    }).join("");

    const laborFullHtml = (est.labor || []).map(item => `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #f0ebe0;color:#444">${escapeHtml(item.item)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f0ebe0;color:#888;text-align:right;font-size:13px">${escapeHtml(item.qty)} ${escapeHtml(item.unit || "")}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f0ebe0;color:#888;text-align:right;font-size:13px">${fmt(item.rate)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f0ebe0;color:#444;text-align:right;font-weight:600">${fmt((Number(item.qty) || 0) * (Number(item.rate) || 0))}</td>
    </tr>`).join("");

    const materialsFullHtml = (est.materials || []).map(item => `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #f0ebe0;color:#444">${escapeHtml(item.item)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f0ebe0;color:#888;text-align:right;font-size:13px">${escapeHtml(item.qty)} ${escapeHtml(item.unit || "")}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f0ebe0;color:#888;text-align:right;font-size:13px">${fmt(item.rate)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f0ebe0;color:#444;text-align:right;font-weight:600">${fmt((Number(item.qty) || 0) * (Number(item.rate) || 0))}</td>
    </tr>`).join("");

    // Mode-specific middle content
    let scopeAndItemsHtml = "";

    if (displayMode === "full") {
      // FULL: scope + labor table + materials table + breakdown totals
      scopeAndItemsHtml = `
        ${est.scopeOfWork ? `
        <h3 style="font-family:Arial,sans-serif;color:#0d1b2a;font-size:15px;letter-spacing:1px;margin:24px 0 8px;padding-bottom:8px;border-bottom:1px solid #e8e2d9;text-transform:uppercase">Scope of Work</h3>
        <div style="font-size:14px;color:#555;line-height:1.7;white-space:pre-wrap;margin-bottom:18px">${escapeHtml(est.scopeOfWork)}</div>
        ` : ""}
        ${laborFullHtml ? `
        <h3 style="font-family:Arial,sans-serif;color:#0d1b2a;font-size:15px;letter-spacing:1px;margin:24px 0 8px;padding-bottom:8px;border-bottom:1px solid #e8e2d9;text-transform:uppercase">Labor</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px">
          <thead><tr>
            <th style="text-align:left;padding:8px 10px;color:#888;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:600;border-bottom:1px solid #e8e2d9">Description</th>
            <th style="text-align:right;padding:8px 10px;color:#888;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:600;border-bottom:1px solid #e8e2d9">Qty</th>
            <th style="text-align:right;padding:8px 10px;color:#888;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:600;border-bottom:1px solid #e8e2d9">Rate</th>
            <th style="text-align:right;padding:8px 10px;color:#888;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:600;border-bottom:1px solid #e8e2d9">Total</th>
          </tr></thead>
          <tbody>${laborFullHtml}</tbody>
        </table>` : ""}
        ${materialsFullHtml ? `
        <h3 style="font-family:Arial,sans-serif;color:#0d1b2a;font-size:15px;letter-spacing:1px;margin:24px 0 8px;padding-bottom:8px;border-bottom:1px solid #e8e2d9;text-transform:uppercase">Materials</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px">
          <thead><tr>
            <th style="text-align:left;padding:8px 10px;color:#888;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:600;border-bottom:1px solid #e8e2d9">Description</th>
            <th style="text-align:right;padding:8px 10px;color:#888;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:600;border-bottom:1px solid #e8e2d9">Qty</th>
            <th style="text-align:right;padding:8px 10px;color:#888;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:600;border-bottom:1px solid #e8e2d9">Rate</th>
            <th style="text-align:right;padding:8px 10px;color:#888;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:600;border-bottom:1px solid #e8e2d9">Total</th>
          </tr></thead>
          <tbody>${materialsFullHtml}</tbody>
        </table>` : ""}
      `;
    } else if (displayMode === "labor") {
      // LABOR: scope + simple labor list (no rates) + "materials included" note
      scopeAndItemsHtml = `
        ${est.scopeOfWork ? `
        <h3 style="font-family:Arial,sans-serif;color:#0d1b2a;font-size:15px;letter-spacing:1px;margin:24px 0 8px;padding-bottom:8px;border-bottom:1px solid #e8e2d9;text-transform:uppercase">Scope of Work</h3>
        <div style="font-size:14px;color:#555;line-height:1.7;white-space:pre-wrap;margin-bottom:18px">${escapeHtml(est.scopeOfWork)}</div>
        ` : ""}
        ${laborItemsHtml ? `
        <h3 style="font-family:Arial,sans-serif;color:#0d1b2a;font-size:15px;letter-spacing:1px;margin:24px 0 8px;padding-bottom:8px;border-bottom:1px solid #e8e2d9;text-transform:uppercase">Labor &amp; Work Included</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:14px">
          <tbody>${laborItemsHtml}</tbody>
        </table>
        <div style="background:#f7f9f5;border-left:3px solid #2ecc71;padding:10px 14px;font-size:13px;color:#555;margin:14px 0 0;border-radius:0 6px 6px 0">
          <strong style="color:#2ecc71">✓ All materials included</strong> — paint, fixtures, hardware, and supplies are covered in the total price.
        </div>` : ""}
      `;
    }
    // Mode "total" = no scope, no items, just the dramatic total below

    const totalDisplay = displayMode === "total" ? `
      <div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#fff;padding:48px 24px;border-radius:14px;margin:32px 0;text-align:center">
        <div style="font-size:12px;letter-spacing:3px;color:#c9a84c;text-transform:uppercase;margin-bottom:12px">Your Estimate</div>
        <div style="font-size:54px;font-weight:700;color:#fff;line-height:1;letter-spacing:2px;margin-bottom:12px">$${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.6)">All-inclusive · No hidden fees</div>
        ${est.timelineText ? `<div style="font-size:13px;color:#aaa;margin-top:12px">Estimated timeline: ${escapeHtml(est.timelineText)}</div>` : ""}
      </div>
    ` : `
      <div style="background:#0d1b2a;color:#fff;padding:24px;border-radius:10px;margin:24px 0;text-align:center">
        <div style="font-size:12px;letter-spacing:2px;color:#c9a84c;text-transform:uppercase">Total Estimate</div>
        <div style="font-size:38px;font-weight:700;color:#fff;margin:8px 0">$${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        ${displayMode === "labor" ? '<div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:4px">All-inclusive · Materials &amp; labor</div>' : ""}
        ${est.timelineText ? `<div style="font-size:13px;color:#aaa;margin-top:8px">Estimated timeline: ${escapeHtml(est.timelineText)}</div>` : ""}
      </div>
    `;

    const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif;color:#333;line-height:1.6">
<div style="max-width:600px;margin:0 auto;padding:20px">
  <div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#fff;padding:30px;border-radius:10px 10px 0 0;text-align:center">
    <a href="https://www.sanibuildingcorp.com" style="text-decoration:none;color:inherit"><div style="font-family:Arial,sans-serif;font-size:22px;letter-spacing:4px;color:#c9a84c;font-weight:700">SANI BUILDING CORP</div></a>
    <div style="font-size:11px;letter-spacing:2px;color:#aaa;margin-top:6px">YOUR ESTIMATE IS READY</div>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #e8e2d9;border-top:none;border-radius:0 0 10px 10px">
    <h1 style="color:#0d1b2a;font-size:24px;margin:0 0 12px">Hi ${escapeHtml(firstName)},</h1>
    <p style="font-size:15px;color:#555">Thanks for reaching out about your <strong>${escapeHtml(est.projectTitle || record.request?.service || "project")}</strong>. We've put together a detailed estimate for you.</p>

    ${est.summary ? `<div style="background:#faf8f4;border-left:4px solid #c9a84c;padding:14px 18px;margin:18px 0;font-size:14px;color:#444">${escapeHtml(est.summary)}</div>` : ""}

    ${scopeAndItemsHtml}

    ${totalDisplay}

    <div style="text-align:center;margin:28px 0">
      <a href="${quoteUrl}" style="display:inline-block;background:#c9a84c;color:#0d1b2a;padding:16px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:1px">View Full Estimate &amp; Accept →</a>
    </div>

    <p style="font-size:14px;color:#555;margin:24px 0 0">Click the button above to view your estimate, accept it online, or get in touch with any questions. You can also reply directly to this email or call <a href="tel:+13322770990" style="color:#b8720a;text-decoration:none;font-weight:600">(332) 277-0990</a>.</p>

    <div style="margin-top:32px;padding-top:24px;border-top:1px solid #eee;text-align:center">
      <div style="color:#888;font-size:11px;letter-spacing:2px;text-transform:uppercase">Sani Building Corp</div>
      <div style="font-size:12px;color:#888;margin-top:4px">Ref: ${escapeHtml(ref)} · Fully Insured · 4.9 ★</div>
      <div style="margin-top:14px"><a href="https://www.sanibuildingcorp.com" style="color:#b8720a;text-decoration:none;font-size:12px;font-weight:600">← Visit sanibuildingcorp.com</a></div>
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

function fmt(n) {
  return "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
