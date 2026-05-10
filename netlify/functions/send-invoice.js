const https = require("https");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const body = JSON.parse(event.body);
    const { ref, customer, estimate, deposit } = body;
    if (!customer?.email || !deposit?.amount) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Missing required fields" }) };
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: "RESEND_API_KEY not configured" }) };
    }

    const contractorEmail = process.env.CONTRACTOR_EMAIL || "contact@sanibuildingcorp.com";
    const siteUrl = process.env.SITE_URL || "https://www.sanibuildingcorp.com";

    // Build invoice URL
    const invoicePayload = { ref, customer, estimate: { projectTitle: estimate?.projectTitle, grandTotal: estimate?.grandTotal }, deposit };
    const json = JSON.stringify(invoicePayload);
    const encoded = Buffer.from(json, 'utf8').toString("base64");
    const invoiceUrl = `${siteUrl}/invoice.html?i=${encodeURIComponent(encoded)}`;

    // Send to customer
    await sendEmail(resendKey, {
      from: "Sani Building Corp <noreply@sanibuildingcorp.com>",
      to: [customer.email],
      reply_to: contractorEmail,
      subject: `💰 Deposit Invoice · ${ref} · Sani Building Corp`,
      html: buildCustomerInvoice({ ref, customer, estimate, deposit, invoiceUrl }),
    });

    // Copy to contractor
    await sendEmail(resendKey, {
      from: "Sani Building Corp <noreply@sanibuildingcorp.com>",
      to: [contractorEmail],
      subject: `💰 Invoice Sent: ${customer.name} - ${fmt(deposit.amount)}`,
      html: buildContractorCopy({ ref, customer, deposit, invoiceUrl }),
    });

    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ success: true, ref, invoiceUrl }) };
  } catch (err) {
    console.error("send-invoice error:", err.message);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};

function corsHeaders(){return{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"}}
function fmt(n){return"$"+Number(n||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,",")}
function escapeHtml(t){if(t==null)return"";return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}

function buildCustomerInvoice({ ref, customer, estimate, deposit, invoiceUrl }) {
  const firstName = (customer.name || "there").split(" ")[0];
  const methodLabels = { zelle: "💜 Zelle", venmo: "💙 Venmo", card: "💳 Credit Card", check: "📝 Check", ach: "🏦 ACH Transfer" };
  const methodsHtml = (deposit.methods || []).map(m => `<span style="display:inline-block;background:#fff;border:1px solid #c9a84c;color:#b8720a;padding:6px 14px;border-radius:6px;margin:3px;font-size:13px;font-weight:600">${methodLabels[m] || m}</span>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif;color:#333;line-height:1.6">
<div style="max-width:640px;margin:0 auto;padding:20px">
  <div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#fff;padding:30px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:24px;letter-spacing:4px;color:#c9a84c;font-weight:700">SANI BUILDING CORP</div>
    <div style="font-size:11px;letter-spacing:3px;color:#aaa;margin-top:4px;text-transform:uppercase">Deposit Invoice</div>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #e8e2d9;border-top:none">
    <h1 style="color:#0d1b2a;font-size:26px;margin:0 0 8px">Hi ${escapeHtml(firstName)},</h1>
    <p style="font-size:15px;color:#555;margin:0 0 20px">Thank you for accepting your quote! Below is your deposit invoice to secure your project schedule.</p>
    <div style="background:linear-gradient(135deg,#9b59b6,#8e44ad);color:#fff;padding:24px;border-radius:10px;margin:20px 0;text-align:center">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.8;margin-bottom:6px">Deposit Required</div>
      <div style="font-size:42px;font-weight:700;line-height:1.1">${fmt(deposit.amount)}</div>
      <div style="font-size:13px;opacity:.85;margin-top:8px">Due: ${escapeHtml(deposit.dueDate || "Within 7 days")}</div>
    </div>
    <table style="width:100%;font-size:14px;margin:14px 0;border-collapse:collapse">
      <tr style="background:#f5f0e8"><td style="padding:10px"><strong>Reference</strong></td><td style="padding:10px">${escapeHtml(ref)}</td></tr>
      <tr><td style="padding:10px"><strong>Project</strong></td><td style="padding:10px">${escapeHtml(estimate?.projectTitle || "Renovation")}</td></tr>
      <tr style="background:#f5f0e8"><td style="padding:10px"><strong>Total Project</strong></td><td style="padding:10px">${fmt(estimate?.grandTotal)}</td></tr>
      <tr><td style="padding:10px"><strong>Deposit Amount</strong></td><td style="padding:10px;color:#9b59b6;font-weight:700">${fmt(deposit.amount)}</td></tr>
      <tr style="background:#f5f0e8"><td style="padding:10px"><strong>Balance Due Later</strong></td><td style="padding:10px">${fmt((estimate?.grandTotal || 0) - deposit.amount)}</td></tr>
    </table>
    <h3 style="color:#b8720a;font-size:14px;letter-spacing:2px;text-transform:uppercase;margin:24px 0 10px">💳 How to Pay</h3>
    <div style="background:#f5f0e8;padding:16px;border-radius:8px;text-align:center">${methodsHtml}</div>
    <div style="text-align:center;margin:28px 0">
      <a href="${invoiceUrl}" style="display:inline-block;background:#9b59b6;color:#fff;padding:16px 40px;border-radius:10px;text-decoration:none;font-size:16px;font-weight:700;letter-spacing:2px;text-transform:uppercase">VIEW INVOICE &amp; PAY</a>
    </div>
    <div style="background:#fff8e1;border-left:4px solid #c9a84c;padding:14px 18px;margin:18px 0;font-size:13px;color:#555">
      <strong style="color:#b8720a">📅 Next Steps:</strong> Once we receive your deposit, we'll confirm your project start date and finalize all scheduling details.
    </div>
    <div style="border-top:1px solid #eee;padding-top:18px;margin-top:24px;text-align:center">
      <div style="color:#888;font-size:12px;margin-bottom:8px">Questions about your invoice?</div>
      <div style="font-size:14px"><a href="tel:3322770990" style="color:#b8720a;text-decoration:none;font-weight:600">📞 332-277-0990</a></div>
    </div>
  </div>
  <div style="background:#0d1b2a;color:#aaa;padding:20px;border-radius:0 0 12px 12px;text-align:center;font-size:11px">
    SANI BUILDING CORP · 2954 Brighton 12th St, Brooklyn, NY 11235<br>
    <span style="color:#666">© 2026 Sani Building Corp · All Rights Reserved</span>
  </div>
</div>
</body></html>`;
}

function buildContractorCopy({ ref, customer, deposit, invoiceUrl }) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
<h2 style="color:#9b59b6">💰 Deposit Invoice Sent</h2>
<p>You sent a deposit invoice to <strong>${escapeHtml(customer.name)}</strong>.</p>
<table style="width:100%;font-size:14px;margin:14px 0">
  <tr><td><strong>Ref:</strong></td><td>${escapeHtml(ref)}</td></tr>
  <tr><td><strong>Amount:</strong></td><td style="color:#9b59b6;font-weight:700">${fmt(deposit.amount)}</td></tr>
  <tr><td><strong>Due:</strong></td><td>${escapeHtml(deposit.dueDate || "Within 7 days")}</td></tr>
  <tr><td><strong>Methods:</strong></td><td>${(deposit.methods || []).join(", ")}</td></tr>
</table>
<p><a href="${invoiceUrl}" style="display:inline-block;background:#9b59b6;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:700">View Invoice Page</a></p>
<p style="color:#666;font-size:12px">When you receive payment, mark it as paid in your dashboard.</p>
</body></html>`;
}

function sendEmail(apiKey, payload) {
  const data = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: "api.resend.com", port: 443, path: "/emails", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), Authorization: `Bearer ${apiKey}` } },
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
