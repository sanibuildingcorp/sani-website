// netlify/functions/send-invoice.js
// Sends an invoice email to the customer.
// Supports: deposit / final / full / custom amounts.
// Payment link is OPTIONAL — invoice can also be sent without one.

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
    const body = JSON.parse(event.body || "{}");
    const {
      ref,
      invoiceType,        // "deposit" | "final" | "full" | "custom"
      amount,             // dollar amount
      dueDate,            // ISO date string
      memo,               // optional note from contractor
      paymentMethod,      // "zelle" | "bank" | "cash" | "check" | "link" | "none"
      paymentDetails,     // string with details (e.g. "Zelle: (332) 277-0990")
      paymentLink,        // optional URL if paymentMethod === "link"
      includePaymentLink, // true if customer should see "Pay Now" button
    } = body;

    if (!ref) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing ref" }) };
    }
    if (!amount || Number(amount) <= 0) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Invalid amount" }) };
    }

    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const record = await store.get(ref, { type: "json" });
    if (!record) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "Estimate not found" }) };
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "RESEND_API_KEY not set" }) };
    }

    const contractorEmail = process.env.CONTRACTOR_EMAIL || "sanibuildingcorp@gmail.com";
    const siteUrl = process.env.SITE_URL || "https://velvety-horse-2aa6e3.netlify.app";

    const customer = record.customer || {};
    const est = record.estimate || {};
    const reqData = record.request || {};

    // Generate invoice number (one-up per estimate)
    const invoiceCount = (record.invoices || []).length + 1;
    const invoiceNumber = `INV-${ref.replace("SBC-", "")}-${String(invoiceCount).padStart(2, "0")}`;

    // Format due date
    const dueDateFormatted = dueDate
      ? new Date(dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : "Upon receipt";
    const issuedDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

    // Invoice type label
    const typeLabel = {
      deposit: "Deposit Invoice",
      final: "Final Invoice",
      full: "Invoice",
      custom: "Invoice",
    }[invoiceType] || "Invoice";

    const canSendToCustomer = customer.email && customer.email.toLowerCase() === contractorEmail.toLowerCase();
    const recipientEmail = canSendToCustomer ? customer.email : contractorEmail;
    const firstName = (customer.name || "there").split(" ")[0];
    const subjectPrefix = canSendToCustomer ? "" : `[FORWARD TO ${customer.email}] `;

    // Payment instructions section
    let paymentInstructionsHtml = "";
    if (paymentDetails && paymentDetails.trim()) {
      paymentInstructionsHtml = `
        <div style="margin:24px 0">
          <div style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:2px;color:#888;text-transform:uppercase;margin-bottom:10px">How to Pay</div>
          <div style="background:#faf8f4;border:1px solid #e8e2d9;border-radius:10px;padding:18px 22px;font-size:14.5px;color:#444;line-height:1.7;white-space:pre-wrap">${escapeHtml(paymentDetails)}</div>
        </div>
      `;
    }

    // Optional payment button
    let payButtonHtml = "";
    if (includePaymentLink && paymentLink && paymentLink.trim()) {
      payButtonHtml = `
        <div style="text-align:center;margin:28px 0">
          <a href="${escapeHtml(paymentLink)}" style="display:inline-block;background:#c9a84c;color:#0d1b2a;padding:16px 40px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:1px">💳 Pay Now</a>
        </div>
      `;
    }

    // Memo
    const memoHtml = memo && memo.trim()
      ? `<div style="background:#f7f0e3;border-left:4px solid #c9a84c;padding:14px 18px;margin:18px 0;font-size:14px;color:#444;border-radius:0 6px 6px 0">${escapeHtml(memo)}</div>`
      : "";

    const amountFormatted = fmt(amount);

    const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif;color:#333;line-height:1.6">
<div style="max-width:640px;margin:0 auto;padding:20px">

  <!-- HEADER -->
  <div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#fff;padding:32px 24px;border-radius:12px 12px 0 0;text-align:center">
    <a href="https://www.sanibuildingcorp.com" style="text-decoration:none;color:inherit">
      <div style="font-family:Arial,sans-serif;font-size:24px;letter-spacing:4px;color:#c9a84c;font-weight:700">SANI BUILDING CORP</div>
    </a>
    <div style="font-size:11px;letter-spacing:2.5px;color:#aaa;margin-top:8px;text-transform:uppercase">${escapeHtml(typeLabel.toUpperCase())}</div>
  </div>

  <!-- BODY -->
  <div style="background:#fff;padding:30px 28px;border:1px solid #e8e2d9;border-top:none;border-radius:0 0 12px 12px">

    <h1 style="color:#0d1b2a;font-size:23px;margin:0 0 14px">Hi ${escapeHtml(firstName)},</h1>
    <p style="font-size:14.5px;color:#555;margin-bottom:18px">
      ${invoiceType === "deposit"
        ? `Please find your deposit invoice for <strong>${escapeHtml(est.projectTitle || reqData.service || "your project")}</strong> below. This deposit secures your project on our schedule.`
        : invoiceType === "final"
        ? `Thank you for your business! Your final invoice for <strong>${escapeHtml(est.projectTitle || reqData.service || "your project")}</strong> is ready.`
        : `Please find your invoice for <strong>${escapeHtml(est.projectTitle || reqData.service || "your project")}</strong> below.`}
    </p>

    ${memoHtml}

    <!-- INVOICE INFO BOX -->
    <div style="border:1px solid #e8e2d9;border-radius:10px;overflow:hidden;margin:20px 0">
      <div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#fff;padding:13px 18px;font-family:Arial,sans-serif;font-size:15px;letter-spacing:2px;font-weight:700">
        ${escapeHtml(typeLabel.toUpperCase())} <span style="color:#c9a84c">#${escapeHtml(invoiceNumber)}</span>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#555;width:140px">Project</td>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#1a1a1a;font-weight:600">${escapeHtml(est.projectTitle || reqData.service || "Your Project")}</td>
        </tr>
        <tr>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#555">Estimate Ref</td>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#1a1a1a;font-weight:600">${escapeHtml(ref)}</td>
        </tr>
        <tr>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#555">Issued</td>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#1a1a1a;font-weight:600">${escapeHtml(issuedDate)}</td>
        </tr>
        <tr>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#555">Due</td>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#1a1a1a;font-weight:600">${escapeHtml(dueDateFormatted)}</td>
        </tr>
        <tr>
          <td style="padding:14px 18px;font-size:13px;color:#555;background:#faf8f4">Amount Due</td>
          <td style="padding:14px 18px;font-family:Arial,sans-serif;font-size:24px;color:#0d1b2a;font-weight:700;letter-spacing:1px;background:#faf8f4">${escapeHtml(amountFormatted)}</td>
        </tr>
      </table>
    </div>

    ${payButtonHtml}
    ${paymentInstructionsHtml}

    <p style="font-size:14px;color:#555;margin:24px 0 0">Questions about this invoice? Reply directly to this email or call <a href="tel:+13322770990" style="color:#b8930a;text-decoration:none;font-weight:600">(332) 277-0990</a>.</p>

    <!-- FOOTER -->
    <div style="margin-top:32px;padding-top:24px;border-top:1px solid #eee;text-align:center">
      <div style="color:#888;font-size:11px;letter-spacing:2px;text-transform:uppercase">Sani Building Corp</div>
      <div style="font-size:12px;color:#888;margin-top:4px">Fully Insured · 4.9 ★ · NYC Metro</div>
      <div style="font-size:12px;color:#888;margin-top:2px">2954 Brighton 12th Street · Brooklyn, NY 11235</div>
      <div style="margin-top:14px"><a href="https://www.sanibuildingcorp.com" style="color:#b8930a;text-decoration:none;font-size:12px;font-weight:600">← Visit sanibuildingcorp.com</a></div>
    </div>
  </div>
</div>
</body></html>`;

    await sendResend(resendKey, {
      from: "Sani Building Corp <onboarding@resend.dev>",
      to: [recipientEmail],
      reply_to: contractorEmail,
      subject: `${subjectPrefix}${typeLabel} ${invoiceNumber} from Sani Building Corp — ${amountFormatted}`,
      html,
    });

    // Update record with invoice history
    const invoice = {
      number: invoiceNumber,
      type: invoiceType,
      amount: Number(amount),
      dueDate: dueDate || null,
      memo: memo || "",
      paymentMethod: paymentMethod || "none",
      paymentDetails: paymentDetails || "",
      paymentLink: paymentLink || "",
      includePaymentLink: !!includePaymentLink,
      sentAt: new Date().toISOString(),
      sentTo: recipientEmail,
      status: "sent",
    };

    record.invoices = record.invoices || [];
    record.invoices.push(invoice);

    // Update top-level status to "invoiced" unless already at "paid"
    if (record.status !== "paid") {
      record.status = "invoiced";
    }
    record.lastInvoiceAt = invoice.sentAt;
    record.updatedAt = invoice.sentAt;
    await store.setJSON(ref, record);

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({
        success: true,
        invoiceNumber,
        sentTo: recipientEmail,
        forwardedToContractor: !canSendToCustomer,
      }),
    };
  } catch (err) {
    console.error("send-invoice error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

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
