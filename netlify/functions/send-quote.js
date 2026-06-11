// netlify/functions/send-quote.js
// Sends the estimate email DIRECTLY to the customer.
// PERSONAL-STYLE EMAIL (v2): plain, conversational layout with no tracking
// pixel, no image grid, no big buttons — so Gmail files it under Primary
// instead of Promotions. "Opened" status is still tracked when the customer
// views the quote page itself.

const https = require("https");
const { getStore } = require("@netlify/blobs");

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

    const calc = calcAll(est);
    const total = record.customerFinalTotal != null ? Number(record.customerFinalTotal) : calc.customerTotal;
    const quoteUrl = `${siteUrl}/quote.html?ref=${encodeURIComponent(ref)}`;
    const firstName = (customer.name || "there").split(" ")[0];
    const projectTitle = est.projectTitle || reqData.service || "your project";
    const photoCount = [...(reqData.photos || []), ...(est.quotePhotos || [])].filter((p) => p && p.data).length;
    const issuedDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

    // ── PERSONAL-STYLE EMAIL ─────────────────────────────────────────────────
    // Reads like a note Zurabi typed himself. Minimal HTML = Primary tab.
    const textBody =
      `Hi ${firstName},\n\n` +
      `Thank you for reaching out about your ${projectTitle}. I've finished your estimate — here it is:\n\n` +
      `Estimate #${ref}\n` +
      `Total: ${fmt(total)}\n` +
      (est.timelineText ? `Timeline: ${est.timelineText}\n` : "") +
      (photoCount > 0 ? `(${photoCount} project photo${photoCount > 1 ? "s" : ""} included on the page)\n` : "") +
      `\nView the full estimate here:\n${quoteUrl}\n\n` +
      `On that page you can see the complete breakdown, approve online, or request any changes. ` +
      `If anything looks off or you have questions, just reply to this email or call/text me at (332) 277-0990.\n\n` +
      `Best,\nZurabi\nSani Building Corp\nBrooklyn, NY · Fully insured · 4.9 stars on Google\nwww.sanibuildingcorp.com`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.65">
<div style="max-width:560px;margin:0 auto;padding:28px 20px">

  <p style="font-size:15px;margin:0 0 16px">Hi ${escapeHtml(firstName)},</p>

  <p style="font-size:15px;margin:0 0 16px">Thank you for reaching out about your <strong>${escapeHtml(projectTitle)}</strong>. I've finished your estimate — here it is:</p>

  <p style="font-size:15px;margin:0 0 6px"><strong>Estimate #${escapeHtml(ref)}</strong> &nbsp;·&nbsp; ${issuedDate}</p>
  <p style="font-size:18px;margin:0 0 16px"><strong>Total: ${fmt(total)}</strong></p>
  ${est.timelineText ? `<p style="font-size:14px;margin:0 0 16px;color:#444">Timeline: ${escapeHtml(est.timelineText)}</p>` : ""}

  <p style="font-size:15px;margin:0 0 20px">
    <a href="${quoteUrl}" style="color:#1a56b0">View your full estimate here</a>${photoCount > 0 ? ` — the page also includes ${photoCount} project photo${photoCount > 1 ? "s" : ""}` : ""}.
  </p>

  <p style="font-size:15px;margin:0 0 16px">On that page you can see the complete breakdown, approve online, or request any changes. If anything looks off or you have questions, just reply to this email or call/text me at <a href="tel:+13322770990" style="color:#1a56b0">(332) 277-0990</a>.</p>

  <p style="font-size:15px;margin:24px 0 4px">Best,<br><strong>Zurabi</strong></p>
  <p style="font-size:13px;color:#777;margin:0;line-height:1.6">
    Sani Building Corp · Brooklyn, NY<br>
    Fully insured · 4.9&nbsp;stars on Google<br>
    <a href="https://www.sanibuildingcorp.com" style="color:#777">www.sanibuildingcorp.com</a>
  </p>

</div>
</body></html>`;

    // ── SEND ──────────────────────────────────────────────────────────────────
    await sendResend(resendKey, {
      from: "Zurabi at Sani Building Corp <estimates@sanibuildingcorp.com>",
      to: [recipientEmail],
      reply_to: contractorEmail,
      subject: `Your estimate for ${escapePlain(projectTitle)} — ${fmt(total)} (#${ref})`,
      html,
      text: textBody,
      headers: {
        "X-Entity-Ref-ID": ref,
      },
    });

    record.status = "sent";
    record.sentAt = new Date().toISOString();
    record.updatedAt = record.sentAt;
    record.openedAt = null;
    await store.setJSON(ref, record);

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({ success: true, quoteUrl, sentTo: recipientEmail }),
    };
  } catch (err) {
    console.error("send-quote error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

function calcAll(est) {
  if (!est) return { customerTotal: 0, shownLabor: 0, shownMaterials: 0, hasLabor: false, hasMaterials: false, showLabor: false, showMaterials: false, bothHidden: true };
  const labor = (est.labor || []).reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0);
  const mat = (est.materials || []).reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0);
  const markupPct = Number(est.markupPct) || 0;
  const laborWithMarkup = labor * (1 + markupPct / 100);
  const matWithMarkup = mat * (1 + markupPct / 100);

  let showLabor, showMaterials;
  if (typeof est.showLaborCost === "boolean" || typeof est.showMaterialsCost === "boolean") {
    showLabor = est.showLaborCost !== false;
    showMaterials = est.showMaterialsCost === true;
  } else if (est.displayMode === "total") {
    showLabor = false; showMaterials = false;
  } else if (est.displayMode === "full") {
    showLabor = true; showMaterials = true;
  } else {
    showLabor = true; showMaterials = false;
  }

  const bothHidden = !showLabor && !showMaterials;
  const fallbackGrand = (labor + mat) * (1 + markupPct / 100);
  const shownLabor = showLabor ? laborWithMarkup : 0;
  const shownMaterials = showMaterials ? matWithMarkup : 0;
  const customerTotal = bothHidden ? Math.round(fallbackGrand * 100) / 100 : Math.round((shownLabor + shownMaterials) * 100) / 100;

  return {
    customerTotal,
    shownLabor: Math.round(shownLabor * 100) / 100,
    shownMaterials: Math.round(shownMaterials * 100) / 100,
    hasLabor: labor > 0,
    hasMaterials: mat > 0,
    showLabor,
    showMaterials,
    bothHidden,
  };
}

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

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
