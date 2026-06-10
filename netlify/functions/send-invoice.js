// netlify/functions/send-invoice.js
// Sends a professional invoice email DIRECTLY to the customer
// from the verified domain (estimates@sanibuildingcorp.com).
// Contractor gets a BCC copy instead of a [FORWARD TO] email.
// Includes: itemized work table, work-completed date, issued date+time.

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
      paymentDetails,     // string with details (e.g. "Zelle: ...")
      paymentLink,        // optional URL
      includePaymentLink, // true if customer should see "Pay Now" button
      workDate,           // YYYY-MM-DD — date the work was completed
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
    const siteUrl = process.env.SITE_URL || "https://www.sanibuildingcorp.com";

    const customer = record.customer || {};
    const est = record.estimate || {};
    const reqData = record.request || {};

    // Generate invoice number (one-up per estimate)
    const invoiceCount = (record.invoices || []).length + 1;
    const invoiceNumber = `INV-${ref.replace("SBC-", "")}-${String(invoiceCount).padStart(2, "0")}`;

    // URL to online invoice page
    const invoiceUrl = `${siteUrl}/invoice.html?ref=${encodeURIComponent(ref)}&inv=${encodeURIComponent(invoiceNumber)}`;

    // ── Dates ──
    const nowIso = new Date().toISOString();
    const issuedFormatted =
      new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric" }) +
      " · " +
      new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) +
      " ET";
    const dueDateFormatted = dueDate ? fmtDateOnly(dueDate) : "Upon receipt";
    const finalWorkDate = workDate || est.invoiceWorkDate || null;
    const workDateFormatted = finalWorkDate ? fmtDateOnly(finalWorkDate) : "";

    // Invoice type label
    const typeLabel = {
      deposit: "Deposit Invoice",
      final: "Final Invoice",
      full: "Invoice",
      custom: "Invoice",
    }[invoiceType] || "Invoice";

    const hasCustomerEmail = !!(customer.email && customer.email.trim());
    const recipientEmail = hasCustomerEmail ? customer.email.trim() : contractorEmail;
    const sendingToCustomer = hasCustomerEmail && recipientEmail.toLowerCase() !== contractorEmail.toLowerCase();
    const firstName = (customer.name || "there").split(" ")[0];
    const amountFormatted = fmt(amount);

    // ── Itemized work table (same display rules as the quote) ──
    const mk = 1 + (Number(est.markupPct) || 0) / 100;
    const showLabor = est.showLaborCost !== false;
    const showMat = est.showMaterialsCost === true;
    const labor = Array.isArray(est.labor) ? est.labor : [];
    const materials = Array.isArray(est.materials) ? est.materials : [];

    const cellL = 'padding:10px 14px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#1a1a1a';
    const cellR = 'padding:10px 14px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#1a1a1a;text-align:right;white-space:nowrap';
    const groupCell = 'padding:8px 14px;background:#f7f0e3;color:#96770a;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700;border-bottom:1px solid #e8e2d9';

    function rowsWithPrices(arr, groupName) {
      const valid = arr.filter(function (it) { return it && String(it.item || "").trim(); });
      if (!valid.length) return "";
      let h = `<tr><td colspan="4" style="${groupCell}">${escapeHtml(groupName)}</td></tr>`;
      valid.forEach(function (it) {
        const qty = (it.qty != null ? it.qty : "") + (it.unit ? " " + it.unit : "");
        const rate = (Number(it.rate) || 0) * mk;
        const total = (Number(it.qty) || 0) * (Number(it.rate) || 0) * mk;
        h += `<tr>
          <td style="${cellL}">${escapeHtml(it.item)}</td>
          <td style="${cellR}">${escapeHtml(qty)}</td>
          <td style="${cellR}">${fmt(rate)}</td>
          <td style="${cellR};font-weight:600">${fmt(total)}</td>
        </tr>`;
      });
      return h;
    }
    function rowsNoPrices(arr, groupName) {
      const valid = arr.filter(function (it) { return it && String(it.item || "").trim(); });
      if (!valid.length) return "";
      let h = `<tr><td colspan="2" style="${groupCell}">${escapeHtml(groupName)}</td></tr>`;
      valid.forEach(function (it) {
        h += `<tr>
          <td style="${cellL}">${escapeHtml(it.item)}</td>
          <td style="${cellR};color:#8a8a8a">Included</td>
        </tr>`;
      });
      return h;
    }
    function bucketSum(arr) {
      return arr.reduce(function (s, it) { return s + (Number(it.qty) || 0) * (Number(it.rate) || 0) * mk; }, 0);
    }

    let itemizedHtml = "";
    if (labor.length || materials.length) {
      const head = `<tr>
        <th style="text-align:left;background:#faf8f4;color:#8a8a8a;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;padding:10px 14px;border-bottom:1px solid #e8e2d9">Item</th>
        <th style="text-align:right;background:#faf8f4;color:#8a8a8a;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;padding:10px 14px;border-bottom:1px solid #e8e2d9">Qty</th>
        <th style="text-align:right;background:#faf8f4;color:#8a8a8a;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;padding:10px 14px;border-bottom:1px solid #e8e2d9">Rate</th>
        <th style="text-align:right;background:#faf8f4;color:#8a8a8a;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;padding:10px 14px;border-bottom:1px solid #e8e2d9">Total</th>
      </tr>`;

      if (!showLabor && !showMat) {
        // Total-only mode: list the work, no per-line prices
        let rows = rowsNoPrices(labor, "Labor") + rowsNoPrices(materials, "Materials");
        if (rows) {
          itemizedHtml = `
            <div style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:2px;color:#888;text-transform:uppercase;margin:26px 0 10px">Work Performed</div>
            <div style="border:1px solid #e8e2d9;border-radius:10px;overflow:hidden">
              <table style="width:100%;border-collapse:collapse">${rows}</table>
            </div>`;
        }
      } else {
        let rows = "";
        let grand = 0;
        if (showLabor) { rows += rowsWithPrices(labor, "Labor"); grand += bucketSum(labor); }
        if (showMat) { rows += rowsWithPrices(materials, "Materials"); grand += bucketSum(materials); }
        if (rows) {
          rows += `<tr>
            <td colspan="3" style="padding:12px 14px;background:#f7f0e3;border-top:2px solid #c9a84c;font-size:13px;font-weight:700;color:#0d1b2a;letter-spacing:1px">PROJECT TOTAL</td>
            <td style="padding:12px 14px;background:#f7f0e3;border-top:2px solid #c9a84c;font-size:15px;font-weight:700;color:#0d1b2a;text-align:right">${fmt(grand)}</td>
          </tr>`;
          let note = "";
          if (grand > 0 && Math.abs(grand - Number(amount)) > 0.01) {
            const pct = Math.round((Number(amount) / grand) * 100);
            note = `<div style="padding:9px 14px;background:#faf8f4;border-top:1px solid #e8e2d9;font-size:12px;color:#8a8a8a">This ${invoiceType === "deposit" ? "deposit " : ""}invoice covers ${amountFormatted} of the ${fmt(grand)} project total${invoiceType === "deposit" ? " (" + pct + "%)" : ""}.</div>`;
          }
          itemizedHtml = `
            <div style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:2px;color:#888;text-transform:uppercase;margin:26px 0 10px">Work Performed — Itemized</div>
            <div style="border:1px solid #e8e2d9;border-radius:10px;overflow:hidden">
              <table style="width:100%;border-collapse:collapse">${head}${rows}</table>${note}
            </div>`;
        }
      }
    }

    // ── Optional blocks ──
    let paymentInstructionsHtml = "";
    if (paymentDetails && paymentDetails.trim()) {
      paymentInstructionsHtml = `
        <div style="margin:24px 0">
          <div style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:2px;color:#888;text-transform:uppercase;margin-bottom:10px">How to Pay</div>
          <div style="background:#faf8f4;border:1px solid #e8e2d9;border-radius:10px;padding:18px 22px;font-size:14.5px;color:#444;line-height:1.7;white-space:pre-wrap">${escapeHtml(paymentDetails)}</div>
        </div>
      `;
    }

    let payButtonHtml = "";
    if (includePaymentLink && paymentLink && paymentLink.trim()) {
      payButtonHtml = `
        <div style="text-align:center;margin:24px 0">
          <a href="${escapeHtml(paymentLink)}" style="display:inline-block;background:#c9a84c;color:#0d1b2a;padding:16px 40px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:1px">💳 Pay Now</a>
        </div>
      `;
    }

    const memoHtml = memo && memo.trim()
      ? `<div style="background:#f7f0e3;border-left:4px solid #c9a84c;padding:14px 18px;font-size:14px;color:#444;border-radius:0 8px 8px 0;margin:22px 0;line-height:1.6">${escapeHtml(memo)}</div>`
      : "";

    const workDateRow = workDateFormatted
      ? `<tr>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#555">Work Completed</td>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#1a1a1a;font-weight:600">${escapeHtml(workDateFormatted)}</td>
        </tr>`
      : "";

    // ── Email ──
    const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f5f0e8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<div style="max-width:640px;margin:0 auto;padding:24px 16px">

  <!-- HEADER -->
  <div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);border-radius:14px 14px 0 0;padding:32px 28px;text-align:center">
    <div style="font-family:Arial,sans-serif;font-size:24px;letter-spacing:5px;color:#c9a84c;font-weight:700">SANI BUILDING CORP</div>
    <div style="font-size:11px;letter-spacing:3px;color:#aaa;margin-top:6px;text-transform:uppercase">${escapeHtml(typeLabel)}</div>
  </div>

  <div style="background:#ffffff;border:1px solid #e8e2d9;border-top:none;border-radius:0 0 14px 14px;padding:30px 28px">

    <p style="font-size:15px;color:#1a1a1a;margin:0 0 6px">Hi ${escapeHtml(firstName)},</p>
    <p style="font-size:14px;color:#555;margin:0 0 22px;line-height:1.6">Please find your ${escapeHtml(typeLabel.toLowerCase())} for <strong>${escapeHtml(est.projectTitle || reqData.service || "your project")}</strong> below.</p>

    <!-- INVOICE INFO -->
    <div style="border:1px solid #e8e2d9;border-radius:10px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#fff;padding:13px 18px;font-family:Arial,sans-serif;font-size:15px;letter-spacing:2px;font-weight:700">
        ${escapeHtml(typeLabel.toUpperCase())} <span style="color:#c9a84c">#${escapeHtml(invoiceNumber)}</span>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#555;width:140px">Project</td>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#1a1a1a;font-weight:600">${escapeHtml(est.projectTitle || reqData.service || "Your Project")}</td>
        </tr>
        <tr>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#555">Billed To</td>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#1a1a1a;font-weight:600">${escapeHtml(customer.name || "—")}${customer.address ? "<br><span style='font-weight:400;color:#555'>" + escapeHtml(customer.address) + "</span>" : ""}</td>
        </tr>
        <tr>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#555">Estimate Ref</td>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#1a1a1a;font-weight:600">${escapeHtml(ref)}</td>
        </tr>
        <tr>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#555">Issued</td>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#1a1a1a;font-weight:600">${escapeHtml(issuedFormatted)}</td>
        </tr>
        ${workDateRow}
        <tr>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#555">Due</td>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#1a1a1a;font-weight:600">${escapeHtml(dueDateFormatted)}</td>
        </tr>
        <tr>
          <td style="padding:14px 18px;font-size:13px;color:#555;background:#f7f0e3">Amount Due</td>
          <td style="padding:14px 18px;font-family:Arial,sans-serif;font-size:24px;color:#0d1b2a;font-weight:700;letter-spacing:1px;background:#f7f0e3">${escapeHtml(amountFormatted)}</td>
        </tr>
      </table>
    </div>

    ${itemizedHtml}
    ${memoHtml}
    ${payButtonHtml}
    ${paymentInstructionsHtml}

    <!-- VIEW ONLINE & DOWNLOAD CTA -->
    <div style="text-align:center;margin:28px 0;padding:22px;background:#faf8f4;border:1px solid #e8e2d9;border-radius:10px">
      <div style="font-family:Arial,sans-serif;font-size:13px;color:#666;margin-bottom:14px;letter-spacing:0.5px">View this invoice online or download as a PDF</div>
      <a href="${invoiceUrl}" style="display:inline-block;background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#c9a84c;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:1px">📄 VIEW ONLINE &amp; DOWNLOAD →</a>
    </div>

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

    const emailPayload = {
      from: "Zurabi at Sani Building Corp <estimates@sanibuildingcorp.com>",
      to: [recipientEmail],
      reply_to: contractorEmail,
      subject: `${typeLabel} ${invoiceNumber} from Sani Building Corp — ${amountFormatted}`,
      html,
    };
    // Always keep a copy in the contractor inbox without ugly FORWARD prefixes
    if (sendingToCustomer) {
      emailPayload.bcc = [contractorEmail];
    }

    await sendResend(resendKey, emailPayload);

    // Update record with invoice history
    const invoice = {
      number: invoiceNumber,
      type: invoiceType,
      amount: Number(amount),
      dueDate: dueDate || null,
      workDate: finalWorkDate,
      memo: memo || "",
      paymentMethod: paymentMethod || "none",
      paymentDetails: paymentDetails || "",
      paymentLink: paymentLink || "",
      includePaymentLink: !!includePaymentLink,
      sentAt: nowIso,
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
        invoiceUrl,
        sentTo: recipientEmail,
        forwardedToContractor: !sendingToCustomer,
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

// Date-only strings like "2026-06-10" formatted without timezone day-shift
function fmtDateOnly(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }
  try { return new Date(s).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); }
  catch (e) { return String(s || ""); }
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
