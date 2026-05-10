const https = require("https");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);
    const { ref, action, customer, estimate, message, respondedAt } = body;

    if (!ref || !customer?.email || !action) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "Missing required fields" }),
      };
    }

    const resendKey = process.env.RESEND_API_KEY;
    const contractorEmail = process.env.CONTRACTOR_EMAIL || "contact@sanibuildingcorp.com";

    if (!resendKey) {
      console.warn("RESEND_API_KEY not set - skipping email");
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ success: true, ref, action }),
      };
    }

    if (action === "accepted") {
      // Email contractor: customer accepted!
      await sendEmail(resendKey, {
        from: "Sani Building Corp <noreply@sanibuildingcorp.com>",
        to: [contractorEmail],
        reply_to: customer.email,
        subject: `🎉 QUOTE ACCEPTED: ${customer.name} - ${ref}`,
        html: buildAcceptedContractorEmail({ ref, customer, estimate, respondedAt }),
      });

      // Email customer: confirmation
      await sendEmail(resendKey, {
        from: "Sani Building Corp <noreply@sanibuildingcorp.com>",
        to: [customer.email],
        reply_to: contractorEmail,
        subject: `✓ Quote Accepted - Sani Building Corp`,
        html: buildAcceptedCustomerEmail({ ref, customer, estimate }),
      });
    } else if (action === "discuss") {
      // Email contractor: customer wants to discuss
      await sendEmail(resendKey, {
        from: "Sani Building Corp <noreply@sanibuildingcorp.com>",
        to: [contractorEmail],
        reply_to: customer.email,
        subject: `💬 Customer wants to discuss: ${customer.name} - ${ref}`,
        html: buildDiscussEmail({ ref, customer, message, respondedAt }),
      });
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ success: true, ref, action }),
    };
  } catch (err) {
    console.error("quote-response error:", err.message);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: err.message }),
    };
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

function fmt(n) {
  return "$" + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function escapeHtml(text) {
  if (text == null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildAcceptedContractorEmail({ ref, customer, estimate, respondedAt }) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
<div style="background:linear-gradient(135deg,#2ecc71,#27ae60);color:#fff;padding:30px;border-radius:10px 10px 0 0;text-align:center">
  <div style="font-size:48px;margin-bottom:8px">🎉</div>
  <h1 style="margin:0;font-size:26px">QUOTE ACCEPTED!</h1>
</div>
<div style="background:#fff;border:1px solid #eee;border-top:none;padding:24px;border-radius:0 0 10px 10px">
  <p style="font-size:16px"><strong>${escapeHtml(customer.name)}</strong> just accepted your quote!</p>
  
  <table style="width:100%;font-size:14px;margin:14px 0;border-collapse:collapse">
    <tr style="background:#f5f0e8"><td style="padding:8px"><strong>Reference</strong></td><td style="padding:8px">${escapeHtml(ref)}</td></tr>
    <tr><td style="padding:8px"><strong>Customer</strong></td><td style="padding:8px">${escapeHtml(customer.name)}</td></tr>
    <tr style="background:#f5f0e8"><td style="padding:8px"><strong>Phone</strong></td><td style="padding:8px"><a href="tel:${escapeHtml(customer.phone || "")}" style="color:#b8720a">${escapeHtml(customer.phone || "—")}</a></td></tr>
    <tr><td style="padding:8px"><strong>Email</strong></td><td style="padding:8px"><a href="mailto:${escapeHtml(customer.email)}" style="color:#b8720a">${escapeHtml(customer.email)}</a></td></tr>
    <tr style="background:#f5f0e8"><td style="padding:8px"><strong>Address</strong></td><td style="padding:8px">${escapeHtml(customer.address || "—")}</td></tr>
    <tr><td style="padding:8px"><strong>Total</strong></td><td style="padding:8px;color:#b8720a;font-size:18px;font-weight:700">${fmt(estimate?.grandTotal)}</td></tr>
    <tr style="background:#f5f0e8"><td style="padding:8px"><strong>Accepted At</strong></td><td style="padding:8px">${new Date(respondedAt).toLocaleString("en-US", { timeZone: "America/New_York" })} ET</td></tr>
  </table>

  <div style="background:#fff8e1;border-left:4px solid #c9a84c;padding:14px 18px;margin:18px 0;font-size:14px">
    <strong style="color:#b8720a">📞 Next Steps:</strong> Contact ${escapeHtml(customer.name.split(" ")[0])} to schedule the work, collect any deposit, and finalize project details.
  </div>

  <div style="text-align:center;margin:20px 0">
    <a href="tel:${escapeHtml(customer.phone || "")}" style="display:inline-block;background:#c9a84c;color:#0d1b2a;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:4px">📞 CALL NOW</a>
    <a href="mailto:${escapeHtml(customer.email)}" style="display:inline-block;background:#fff;color:#b8720a;border:1px solid #c9a84c;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:4px">✉ REPLY VIA EMAIL</a>
  </div>
</div>
</body></html>`;
}

function buildAcceptedCustomerEmail({ ref, customer, estimate }) {
  const firstName = (customer.name || "there").split(" ")[0];
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif;color:#333;line-height:1.6">
<div style="max-width:580px;margin:0 auto;padding:20px">
  <div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#fff;padding:30px;border-radius:10px 10px 0 0;text-align:center">
    <div style="font-size:22px;letter-spacing:4px;color:#c9a84c;font-weight:700">SANI BUILDING CORP</div>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #e8e2d9;border-top:none;border-radius:0 0 10px 10px">
    <div style="text-align:center;margin-bottom:20px">
      <div style="display:inline-block;background:#2ecc71;color:#fff;width:64px;height:64px;border-radius:50%;line-height:64px;font-size:32px">✓</div>
    </div>
    <h1 style="text-align:center;color:#0d1b2a;font-size:24px;margin:0 0 10px">Quote Accepted!</h1>
    <p style="font-size:15px;color:#555;text-align:center;margin-bottom:24px">Thank you ${escapeHtml(firstName)}! We've received your acceptance and will be in touch shortly to schedule the work.</p>

    <div style="background:#f5f0e8;border-radius:8px;padding:18px;margin:18px 0">
      <div style="font-size:11px;letter-spacing:2px;color:#888;text-transform:uppercase">Confirmation</div>
      <div style="font-size:14px;margin-top:6px"><strong>Reference:</strong> ${escapeHtml(ref)}</div>
      <div style="font-size:14px"><strong>Total:</strong> ${fmt(estimate?.grandTotal)}</div>
    </div>

    <h3 style="color:#b8720a;font-size:13px;letter-spacing:2px;text-transform:uppercase;margin-top:20px">What Happens Next</h3>
    <div style="font-size:14px;color:#555;line-height:1.8">
      <div>✓ Our team will contact you within hours to schedule</div>
      <div>✓ We'll discuss start date, deposit, and timeline</div>
      <div>✓ A project manager will be assigned to you</div>
      <div>✓ Work begins on agreed start date</div>
    </div>

    <div style="border-top:1px solid #eee;padding-top:18px;margin-top:24px;text-align:center">
      <div style="color:#888;font-size:12px;margin-bottom:8px">Need to reach us right away?</div>
      <a href="tel:3322770990" style="color:#b8720a;text-decoration:none;font-weight:600">📞 332-277-0990</a>
    </div>
  </div>
  <div style="background:#0d1b2a;color:#aaa;padding:18px;border-radius:0 0 10px 10px;text-align:center;font-size:11px;margin-top:0">
    SANI BUILDING CORP · 2954 Brighton 12th St, Brooklyn, NY 11235
  </div>
</div>
</body></html>`;
}

function buildDiscussEmail({ ref, customer, message, respondedAt }) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
<div style="background:linear-gradient(135deg,#3498db,#2980b9);color:#fff;padding:24px;border-radius:10px 10px 0 0;text-align:center">
  <div style="font-size:36px;margin-bottom:6px">💬</div>
  <h1 style="margin:0;font-size:22px">Customer Wants to Discuss</h1>
</div>
<div style="background:#fff;border:1px solid #eee;border-top:none;padding:24px;border-radius:0 0 10px 10px">
  <p style="font-size:15px"><strong>${escapeHtml(customer.name)}</strong> has sent you a message regarding their quote.</p>

  <table style="width:100%;font-size:14px;margin:14px 0">
    <tr><td style="padding:5px;color:#888;width:130px"><strong>Reference</strong></td><td style="padding:5px">${escapeHtml(ref)}</td></tr>
    <tr><td style="padding:5px;color:#888"><strong>Phone</strong></td><td style="padding:5px"><a href="tel:${escapeHtml(customer.phone || "")}" style="color:#b8720a">${escapeHtml(customer.phone || "—")}</a></td></tr>
    <tr><td style="padding:5px;color:#888"><strong>Email</strong></td><td style="padding:5px"><a href="mailto:${escapeHtml(customer.email)}" style="color:#b8720a">${escapeHtml(customer.email)}</a></td></tr>
    <tr><td style="padding:5px;color:#888"><strong>Submitted</strong></td><td style="padding:5px">${new Date(respondedAt).toLocaleString("en-US", { timeZone: "America/New_York" })} ET</td></tr>
  </table>

  <h3 style="color:#3498db;margin-top:18px;font-size:14px;letter-spacing:1px;text-transform:uppercase">💬 Their Message</h3>
  <div style="background:#f0f8ff;border-left:4px solid #3498db;padding:16px;margin:10px 0;font-size:14px;color:#555;line-height:1.7;white-space:pre-wrap">${escapeHtml(message || "(no message)")}</div>

  <div style="text-align:center;margin:22px 0">
    <a href="tel:${escapeHtml(customer.phone || "")}" style="display:inline-block;background:#c9a84c;color:#0d1b2a;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin:4px">📞 CALL</a>
    <a href="mailto:${escapeHtml(customer.email)}" style="display:inline-block;background:#3498db;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin:4px">✉ REPLY</a>
  </div>
</div>
</body></html>`;
}

function sendEmail(apiKey, payload) {
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
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
          } else {
            reject(new Error(`Resend API error ${res.statusCode}: ${body}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}
