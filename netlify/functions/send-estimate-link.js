// netlify/functions/send-estimate-link.js
// Sends a BRANDED HTML "fill out the form" invite to the customer via Resend.
// Replaces the plain mailto: invite so the customer gets a designed email.
//
// POST body: { name, email, link? }
//   name  - customer name (optional, defaults to "there")
//   email - customer email (required)
//   link  - estimate form URL (optional, defaults to SITE_URL/estimate)

const https = require("https");

function isValidEmail(e) {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const name = (body.name || "").trim();
    const recipientEmail = (body.email || "").trim();

    if (!isValidEmail(recipientEmail)) {
      return {
        statusCode: 400,
        headers: cors(),
        body: JSON.stringify({ error: "A valid customer email is required." }),
      };
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "RESEND_API_KEY not set" }) };
    }

    const contractorEmail = process.env.CONTRACTOR_EMAIL || "sanibuildingcorp@gmail.com";
    const siteUrl = process.env.SITE_URL || "https://www.sanibuildingcorp.com";
    const link = (body.link || `${siteUrl}/estimate`).trim();
    const firstName = name ? name.split(" ")[0] : "there";

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif;color:#333;line-height:1.6">
<div style="max-width:600px;margin:0 auto;padding:20px">

  <div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#fff;padding:32px 24px;border-radius:12px 12px 0 0;text-align:center">
    <a href="${siteUrl}" style="text-decoration:none;color:inherit">
      <div style="font-family:Arial,sans-serif;font-size:24px;letter-spacing:4px;color:#c9a84c;font-weight:700">SANI BUILDING CORP</div>
    </a>
    <div style="font-size:11px;letter-spacing:2.5px;color:#aaa;margin-top:8px;text-transform:uppercase">YOUR FREE ESTIMATE</div>
  </div>

  <div style="background:#fff;padding:30px 28px;border:1px solid #e8e2d9;border-top:none;border-radius:0 0 12px 12px">

    <h1 style="color:#0d1b2a;font-size:23px;margin:0 0 14px">Hi ${escapeHtml(firstName)},</h1>
    <p style="font-size:15px;color:#555;margin-bottom:18px">Thanks for your interest in working with <strong>Sani Building Corp</strong>. To get your free, no-obligation estimate, just fill out our quick project form — it takes about <strong>2 minutes</strong>.</p>

    <div style="background:#faf8f4;border:1px solid #e8e2d9;border-radius:10px;padding:18px 22px;margin:22px 0">
      <div style="font-size:11px;letter-spacing:2px;color:#888;text-transform:uppercase;margin-bottom:12px">How it works</div>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;font-size:14px;color:#555"><span style="color:#c9a84c;font-weight:700;margin-right:8px">1.</span> Tell us about your project &amp; add a few photos</td></tr>
        <tr><td style="padding:6px 0;font-size:14px;color:#555"><span style="color:#c9a84c;font-weight:700;margin-right:8px">2.</span> We review it and prepare your detailed estimate</td></tr>
        <tr><td style="padding:6px 0;font-size:14px;color:#555"><span style="color:#c9a84c;font-weight:700;margin-right:8px">3.</span> You get your quote back within 24 hours</td></tr>
      </table>
    </div>

    <div style="text-align:center;margin:24px 0 22px">
      <a href="${escapeHtml(link)}" style="display:inline-block;background:#c9a84c;color:#0d1b2a;padding:18px 40px;border-radius:12px;text-decoration:none;font-weight:800;font-size:16px;letter-spacing:0.5px;width:100%;box-sizing:border-box">
        Start My Free Estimate →
      </a>
      <div style="margin-top:10px;font-size:12px;color:#aaa">No obligation · Free · Takes ~2 minutes</div>
    </div>

    <p style="font-size:14px;color:#555;margin:22px 0 0">If the button doesn't work, copy and paste this link:<br>
      <a href="${escapeHtml(link)}" style="color:#b8930a;text-decoration:none;font-size:13px;word-break:break-all">${escapeHtml(link)}</a>
    </p>

    <p style="font-size:14px;color:#555;margin:18px 0 0">Questions? Reply to this email or call <a href="tel:+13322770990" style="color:#b8930a;text-decoration:none;font-weight:600">(332) 277-0990</a>.</p>

    <div style="margin-top:32px;padding-top:24px;border-top:1px solid #eee;text-align:center">
      <div style="color:#888;font-size:11px;letter-spacing:2px;text-transform:uppercase">Sani Building Corp</div>
      <div style="font-size:12px;color:#888;margin-top:4px">Fully Insured · 4.9 Stars · NYC Metro</div>
      <div style="margin-top:14px"><a href="${siteUrl}" style="color:#b8930a;text-decoration:none;font-size:12px;font-weight:600">Visit sanibuildingcorp.com</a></div>
    </div>
  </div>
</div>
</body></html>`;

    const textBody =
      `Hi ${firstName},\n\n` +
      `Thanks for your interest in Sani Building Corp. To get your free, no-obligation estimate, just fill out our quick project form (about 2 minutes):\n\n` +
      `${link}\n\n` +
      `How it works:\n` +
      `1. Tell us about your project and add a few photos\n` +
      `2. We review it and prepare your detailed estimate\n` +
      `3. You get your quote back within 24 hours\n\n` +
      `Questions? Reply to this email or call (332) 277-0990.\n\n` +
      `— Sani Building Corp\nFully insured · 4.9 stars · NYC Metro\n${siteUrl}`;

    await sendResend(resendKey, {
      from: "Zurabi at Sani Building Corp <estimates@sanibuildingcorp.com>",
      to: [recipientEmail],
      reply_to: contractorEmail,
      subject: `Your free estimate from Sani Building Corp, ${firstName}`,
      html,
      text: textBody,
    });

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({ success: true, sentTo: recipientEmail }),
    };
  } catch (err) {
    console.error("send-estimate-link error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

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
          const b = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(b);
          else reject(new Error(`Resend ${res.statusCode}: ${b}`));
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
