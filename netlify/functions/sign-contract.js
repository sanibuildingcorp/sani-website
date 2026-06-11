// netlify/functions/sign-contract.js
// Saves the customer's e-signature on the AI-generated contract,
// marks the estimate ACCEPTED, and emails both parties.
// POST { ref, name, signatureData?, finishSelections?, materialsSelections?, finalTotal? }

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
    const { ref, name, signatureData, finishSelections, materialsSelections, finalTotal } = body;

    if (!ref) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing ref" }) };
    }
    if (!name || !String(name).trim()) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Please type your full name to sign" }) };
    }

    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const record = await store.get(ref, { type: "json" });
    if (!record) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "Estimate not found" }) };
    }
    if (!record.contract || !record.contract.sections) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Contract not generated yet" }) };
    }
    if (record.contract.signed) {
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ success: true, alreadySigned: true }) };
    }

    const nowIso = new Date().toISOString();

    // Keep customer's finish/material choices (carried over from the quote page)
    if (Array.isArray(finishSelections) && finishSelections.length) record.customerSelections = finishSelections;
    if (Array.isArray(materialsSelections) && materialsSelections.length) record.customerMaterialsSelections = materialsSelections;
    if (finalTotal != null && Number(finalTotal) > 0) {
      record.customerFinalTotal = Number(finalTotal);
      record.contract.total = Number(finalTotal);
    }

    // Signature image (drawn) — keep size sane for Blobs
    let sigImage = "";
    if (signatureData && typeof signatureData === "string" && signatureData.indexOf("data:image/") === 0 && signatureData.length < 300000) {
      sigImage = signatureData;
    }

    record.contract.signed = {
      name: String(name).trim().slice(0, 120),
      image: sigImage,
      at: nowIso,
      userAgent: (event.headers && (event.headers["user-agent"] || event.headers["User-Agent"])) || "",
    };
    record.status = "accepted";
    record.acceptedAt = nowIso;
    record.updatedAt = nowIso;
    await store.setJSON(ref, record);

    // ---- Emails ----
    const resendKey = process.env.RESEND_API_KEY;
    const contractorEmail = process.env.CONTRACTOR_EMAIL || "sanibuildingcorp@gmail.com";
    const siteUrl = process.env.SITE_URL || "https://www.sanibuildingcorp.com";
    const contractUrl = siteUrl + "/contract.html?ref=" + encodeURIComponent(ref);
    const customer = record.customer || {};
    const total = Number(record.contract.total) || 0;
    const totalFmt = "$" + total.toLocaleString("en-US", { minimumFractionDigits: 2 });
    const schedule = (record.contract.sections.paymentSchedule || []);
    const deposit = schedule.length ? schedule[0] : null;

    if (resendKey) {
      // Contractor alert
      try {
        await sendResend(resendKey, {
          from: "Zurabi at Sani Building Corp <estimates@sanibuildingcorp.com>",
          to: [contractorEmail],
          reply_to: customer.email || undefined,
          subject: "✍️ CONTRACT SIGNED — " + (customer.name || "Customer") + " — " + totalFmt,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
            <div style="background:#e8f4ed;border-left:4px solid #2ecc71;padding:16px 20px;border-radius:0 8px 8px 0">
              <div style="font-size:18px;font-weight:700;color:#1a1a1a">✍️ ${escapeHtml(customer.name || "Customer")} signed the contract</div>
              <div style="font-size:14px;color:#555;margin-top:6px">${escapeHtml(record.contract.sections.projectType || "")} · ${escapeHtml(record.contract.projectAddress || "")}</div>
            </div>
            <table style="width:100%;border-collapse:collapse;margin:18px 0;border:1px solid #e8e2d9;border-radius:8px">
              <tr><td style="padding:9px 12px;background:#faf8f4;color:#888;width:130px">Ref</td><td style="padding:9px 12px;font-weight:600">${escapeHtml(ref)}</td></tr>
              <tr><td style="padding:9px 12px;background:#faf8f4;color:#888">Contract Total</td><td style="padding:9px 12px;font-weight:700;color:#2ecc71;font-size:16px">${totalFmt}</td></tr>
              <tr><td style="padding:9px 12px;background:#faf8f4;color:#888">Signed By</td><td style="padding:9px 12px;font-style:italic">${escapeHtml(record.contract.signed.name)}</td></tr>
              ${deposit ? `<tr><td style="padding:9px 12px;background:#faf8f4;color:#888">Deposit Due</td><td style="padding:9px 12px;font-weight:600">$${Number(deposit.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td></tr>` : ""}
            </table>
            <div style="background:#fbf6e8;border-left:4px solid #c9a84c;padding:12px 16px;font-size:14px;margin:16px 0">
              <strong>Next step:</strong> collect the deposit, then schedule the start date.
            </div>
            <div style="text-align:center;margin-top:20px">
              <a href="${contractUrl}" style="display:inline-block;background:#0d1b2a;color:#c9a84c;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:4px">📄 View Signed Contract</a>
              ${customer.phone ? `<a href="tel:${escapeHtml(customer.phone)}" style="display:inline-block;background:#c9a84c;color:#0d1b2a;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:4px">📞 Call ${escapeHtml((customer.name || "").split(" ")[0])}</a>` : ""}
            </div>
          </div>`,
        });
      } catch (e) { console.error("Contractor email failed:", e.message); }

      // Customer confirmation
      if (customer.email) {
        try {
          await sendResend(resendKey, {
            from: "Zurabi at Sani Building Corp <estimates@sanibuildingcorp.com>",
            to: [customer.email.trim()],
            bcc: [contractorEmail],
            reply_to: contractorEmail,
            subject: "Your signed agreement with Sani Building Corp — " + escapePlain(record.contract.sections.projectType || "Project"),
            html: `<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px 16px;background:#f5f0e8">
              <div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);border-radius:14px 14px 0 0;padding:30px 28px;text-align:center">
                <div style="font-size:22px;letter-spacing:4px;color:#c9a84c;font-weight:700">SANI BUILDING CORP</div>
                <div style="font-size:11px;letter-spacing:3px;color:#aaa;margin-top:6px">AGREEMENT SIGNED ✓</div>
              </div>
              <div style="background:#fff;border:1px solid #e8e2d9;border-top:none;border-radius:0 0 14px 14px;padding:28px">
                <p style="font-size:15px;color:#1a1a1a">Hi ${escapeHtml((customer.name || "there").split(" ")[0])},</p>
                <p style="font-size:14px;color:#555;line-height:1.6">Thank you — your agreement for <strong>${escapeHtml(record.contract.sections.projectType || "your project")}</strong> is signed. Total: <strong>${totalFmt}</strong>.</p>
                ${deposit ? `<div style="background:#f7f0e3;border-left:4px solid #c9a84c;padding:14px 18px;border-radius:0 8px 8px 0;font-size:14px;color:#444;line-height:1.7">
                  <strong>Next step — ${escapeHtml(deposit.label)}:</strong> $${Number(deposit.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}<br>
                  Zelle: (332) 277-0990 · Account name: Sani Building Corp
                </div>` : ""}
                <div style="text-align:center;margin:26px 0">
                  <a href="${contractUrl}" style="display:inline-block;background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#c9a84c;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700">📄 View Your Signed Agreement</a>
                </div>
                <p style="font-size:13px;color:#888;text-align:center">Questions? Call <a href="tel:+13322770990" style="color:#b8930a;font-weight:600;text-decoration:none">(332) 277-0990</a></p>
              </div>
            </div>`,
          });
        } catch (e) { console.error("Customer email failed:", e.message); }
      }
    }

    return { statusCode: 200, headers: cors(), body: JSON.stringify({ success: true, signedAt: nowIso }) };
  } catch (err) {
    console.error("sign-contract error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

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
