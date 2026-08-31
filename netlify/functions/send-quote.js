// netlify/functions/send-quote.js
// Sends the estimate email DIRECTLY to the customer.
// PERSONAL-STYLE EMAIL (v2): plain, conversational layout with no tracking
// pixel, no image grid, no big buttons — so Gmail files it under Primary
// instead of Promotions. "Opened" status is still tracked when the customer
// views the quote page itself.

const https = require("https");
const nodemailer = require("nodemailer");
const { getStore } = require("@netlify/blobs");
const { buildSentVersion } = require("./lib/sent-version");
const customerTotals = require("./lib/customer-total");

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
    const { ref, includeContract } = JSON.parse(event.body);
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
    const siteUrl = process.env.SITE_URL || "https://www.sanibuildingcorp.com";

    const customer = record.customer || {};
    const est = record.estimate || {};
    const reqData = record.request || {};

    const recipientEmail = (customer.email || "").trim();
    if (!isValidEmail(recipientEmail)) {
      return {
        statusCode: 400,
        headers: cors(),
        body: JSON.stringify({
          error: "Customer email is missing or invalid. Cannot send the estimate.",
          field: "customer.email",
        }),
      };
    }

    /* One definition, imported. This used to be a local calcAll() plus a separate
       customerFinalTotal override, which is how the email and the contract drifted
       apart from the quote page. */
    const T = customerTotals(est, record);
    const total = T.customerTotal;
    const quoteUrl = `${siteUrl}/quote.html?ref=${encodeURIComponent(ref)}`;
    const firstName = (customer.name || "there").split(" ")[0];
    const projectTitle = est.projectTitle || reqData.service || "your project";
    const photoCount = [...(reqData.photos || []), ...(est.quotePhotos || [])].filter((p) => p && p.data).length;
    const issuedDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

    // What kind of cost is this number? Same truth-labels as quote.html.
    let costTypeLabel = "";
    if (T.showMaterials && !T.showLabor)      costTypeLabel = "Materials cost only — labor quoted separately";
    else if (T.showLabor && !T.showMaterials && (est.materials || []).length > 0) costTypeLabel = "Labor cost only — materials not included";

    // ── PERSONAL-STYLE EMAIL ─────────────────────────────────────────────────
    // Reads like a note Zurabi typed himself. Minimal HTML = Primary tab.
    const textBody =
      `Hi ${firstName},\n\n` +
      `Thank you for reaching out about your ${projectTitle}. I've finished your estimate — here it is:\n\n` +
      `Estimate #${ref}\n` +
      `Total: ${fmt(total)}\n` +
      (costTypeLabel ? `${costTypeLabel}\n` : "") +
      (est.timelineText ? `Timeline: ${est.timelineText}\n` : "") +
      (photoCount > 0 ? `(${photoCount} project photo${photoCount > 1 ? "s" : ""} included on the page)\n` : "") +
      `\nView the full estimate here:\n${quoteUrl}\n\n` +
      `On that page you can see the complete breakdown, approve online, or request any changes. ` +
      `If anything looks off or you have questions, just reply to this email or call/text me at (332) 277-0990.\n\n` +
      `Best,\nZurabi\nSani Building Corp\nBrooklyn, NY · Fully insured · 4.9 stars on Google\nwww.sanibuildingcorp.com`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2efe9;font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.6">
<div style="max-width:600px;margin:0 auto;padding:24px 16px">

  <div style="background:#0a1628;border-radius:14px 14px 0 0;padding:34px 28px;text-align:center">
    <div style="font-size:26px;font-weight:bold;letter-spacing:4px;color:#e0b84e">SANI BUILDING CORP</div>
    <div style="font-size:12px;letter-spacing:3px;color:#9aa6b4;margin-top:8px;text-transform:uppercase">Your Estimate Is Ready</div>
  </div>

  <div style="background:#ffffff;border-radius:0 0 14px 14px;padding:30px 28px">

    <p style="font-size:17px;margin:0 0 16px;color:#0a1628"><strong>Hi ${escapeHtml(firstName)},</strong></p>

    <p style="font-size:15px;margin:0 0 22px;color:#333">Thank you for reaching out about your <strong>${escapeHtml(projectTitle)}</strong>. I've put together your estimate — here are the details:</p>

    <div style="border:1px solid #e6e0d6;border-radius:12px;overflow:hidden;margin:0 0 24px">
      <div style="background:#0a1628;padding:12px 18px;color:#fff;font-size:13px;letter-spacing:1px">ESTIMATE <span style="color:#e0b84e;font-weight:bold">#${escapeHtml(ref)}</span></div>
      <div style="padding:18px">
        <div style="font-size:13px;color:#777;margin-bottom:4px">Issued ${issuedDate}</div>
        <div style="font-size:30px;font-weight:bold;color:#0a1628">${fmt(total)}</div>
        ${costTypeLabel ? `<div style="font-size:13px;color:#8a6d1a;background:#fdf6e3;border:1px solid #ecd9a0;border-radius:7px;padding:7px 12px;margin-top:10px;display:inline-block"><strong>${escapeHtml(costTypeLabel.split(" — ")[0])}</strong> — ${escapeHtml(costTypeLabel.split(" — ")[1])}</div>` : ""}
        ${est.timelineText ? `<div style="font-size:13px;color:#555;margin-top:8px">Timeline: ${escapeHtml(est.timelineText)}</div>` : ""}
      </div>
    </div>

    <div style="text-align:center;margin:0 0 24px">
      <a href="${quoteUrl}" style="display:inline-block;background:#c8860a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 34px;border-radius:9px">View Your Full Estimate &rarr;</a>
    </div>

    ${photoCount > 0 ? `<p style="font-size:13px;color:#777;text-align:center;margin:0 0 22px">The page includes ${photoCount} project photo${photoCount > 1 ? "s" : ""}.</p>` : ""}

    <p style="font-size:14.5px;margin:0 0 18px;color:#333">On that page you can see the full breakdown, approve online, or request changes. If anything looks off or you have questions, just reply to this email or call/text me at <a href="tel:+13322770990" style="color:#0a1628;font-weight:bold">(332) 277-0990</a>.</p>

    <p style="font-size:15px;margin:22px 0 2px;color:#0a1628">Best,<br><strong>Zurabi</strong></p>
  </div>

  <div style="text-align:center;padding:20px 16px;font-size:12px;color:#8a8a8a;line-height:1.7">
    <strong style="color:#555">Sani Building Corp</strong> &middot; Brooklyn, NY<br>
    Fully insured &middot; 4.9 stars on Google<br>
    <a href="https://www.sanibuildingcorp.com" style="color:#8a8a8a">www.sanibuildingcorp.com</a>
  </div>

</div>
</body></html>`;

    // ── SEND ──────────────────────────────────────────────────────────────────
    const mailPayload = {
      from: "Zurabi at Sani Building Corp <estimates@sanibuildingcorp.com>",
      to: [recipientEmail],
      reply_to: contractorEmail,
      subject: `Your estimate for ${escapePlain(projectTitle)} — ${fmt(total)} (#${ref})`,
      html,
      text: textBody,
      headers: {
        "X-Entity-Ref-ID": ref,
      },
    };

    let deliveryProvider = "resend";
    try {
      await sendResend(resendKey, mailPayload);
    } catch (mailErr) {
      const canFallback = /^Resend 429:/.test(String(mailErr && mailErr.message || mailErr)) && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD;
      if (!canFallback) throw mailErr;
      console.warn("Resend quota/rate limit reached; falling back to Gmail SMTP");
      await sendGmail(mailPayload);
      deliveryProvider = "gmail";
    }

    record.includeContractForCustomer = includeContract === true;
    record.status = "sent";
    record.sentAt = new Date().toISOString();

    /* ══ FREEZE WHAT IS BEING SENT ═════════════════════════════════════════════
       The quote link renders live from this record, so every later edit — a rate
       tried out, a total being experimented with, an AI regeneration mid-flight —
       used to appear on the customer's page the moment it was saved.

       From here the customer sees THIS, and only this, until the next send. The
       snapshot is taken after includeContractForCustomer is set above, so it
       records the contract decision actually being sent.
       See lib/sent-version.js for which fields freeze and which stay live. */
    record.sentVersionN = (Number(record.sentVersionN) || 0) + 1;
    record.sentVersion = buildSentVersion(record, record.sentVersionN);
    record.updatedAt = record.sentAt;
    record.openedAt = null;
    await store.setJSON(ref, record);

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({ success: true, quoteUrl, sentTo: recipientEmail, deliveryProvider }),
    };
  } catch (err) {
    console.error("send-quote error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};


function fmt(n) {
  return "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escapeHtml(t) {
  if (t == null) return "";
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function escapePlain(t) { return String(t == null ? "" : t).replace(/[<>]/g, ""); }

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

function sendGmail(payload) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("Gmail fallback credentials are not configured");
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
  return transporter.sendMail({
    from: `Sani Building Corp <${user}>`,
    to: payload.to,
    replyTo: payload.reply_to || user,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    headers: payload.headers || {},
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
