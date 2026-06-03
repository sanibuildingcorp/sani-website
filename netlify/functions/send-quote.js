// netlify/functions/send-quote.js
// Sends the estimate email DIRECTLY to the customer.
// Fixed: base64 photos filtered out, tracking pixel added.

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
    const quoteUrl = `${siteUrl}/quote.html?ref=${encodeURIComponent(ref)}`;
    const firstName = (customer.name || "there").split(" ")[0];
    const projectTitle = est.projectTitle || reqData.service || "Project";

    // ── PHOTOS: filter out base64 data URIs — Gmail blocks them ──────────────
    // Only include photos that are real HTTP URLs (uploaded to Supabase/CDN)
    const isRealUrl = (p) => p && p.data && (p.data.startsWith("http://") || p.data.startsWith("https://"));
    const customerPhotos = (reqData.photos || []).filter(isRealUrl).slice(0, 4);
    const quotePhotos = (est.quotePhotos || []).filter(isRealUrl).slice(0, 6);
    const allPhotos = [...customerPhotos, ...quotePhotos].slice(0, 8);
    // Count ALL photos (base64 + real URLs) — base64 can't render in email
    // but the customer can still view them on the quote page via the button.
    const photoCount = [...(reqData.photos || []), ...(est.quotePhotos || [])]
      .filter(p => p && p.data).length;
    const photosHtml = allPhotos.length > 0 ? `
    <div style="margin:24px 0">
      <div style="font-size:11px;letter-spacing:2px;color:#888;text-transform:uppercase;margin-bottom:12px;font-family:Arial,sans-serif">Project Photos</div>
      <div style="display:grid;grid-template-columns:repeat(${Math.min(allPhotos.length, 4)},1fr);gap:8px">
        ${allPhotos.map(p => `<img src="${p.data}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;border:1px solid #e8e2d9" alt="project photo">`).join("")}
      </div>
    </div>` : "";

    // ── SCOPE BREAKDOWN ───────────────────────────────────────────────────────
    const categories = parseScope(est.scopeOfWork || "");
    const breakdownHtml = categories.length > 0
      ? categories.map(cat => `
          <div style="margin-bottom:18px">
            <div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#c9a84c;padding:11px 18px;font-family:Arial,sans-serif;font-size:13px;letter-spacing:2px;font-weight:700;text-transform:uppercase;border-radius:6px 6px 0 0;border-left:4px solid #c9a84c">
              ${escapeHtml(cat.name)}
            </div>
            <div style="background:#faf8f4;padding:14px 18px;border:1px solid #e8e2d9;border-top:none;border-radius:0 0 6px 6px">
              <ul style="list-style:none;padding:0;margin:0">
                ${cat.items.map(item => `
                  <li style="padding:6px 0 6px 18px;position:relative;font-size:14px;color:#555;line-height:1.55">
                    <span style="position:absolute;left:0;color:#c9a84c;font-weight:700">•</span>
                    ${escapeHtml(item)}
                  </li>
                `).join("")}
              </ul>
            </div>
          </div>
        `).join("")
      : "";

    // ── LINE ITEMS ────────────────────────────────────────────────────────────
    let lineItemsHtml = "";
    let includedNoteHtml = "";

    if (calc.bothHidden) {
      lineItemsHtml = `
        <div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#fff;padding:42px 24px;border-radius:14px;margin:24px 0;text-align:center">
          <div style="font-size:12px;letter-spacing:3px;color:#c9a84c;text-transform:uppercase;margin-bottom:10px">Your Estimate</div>
          <div style="font-size:56px;font-weight:700;color:#fff;line-height:1;letter-spacing:2px">${fmt(calc.customerTotal)}</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.6);margin-top:10px">All-inclusive · No hidden fees</div>
        </div>
      `;
    } else {
      let rowsHtml = "";
      if (calc.showLabor) {
        const laborLabel = (calc.showLabor && !calc.showMaterials) ? 'Labor only' : 'Labor';
        rowsHtml += `
          <tr>
            <td style="padding:9px 0;font-size:14.5px;color:#555">${laborLabel}</td>
            <td style="padding:9px 0;font-size:14.5px;color:#1a1a1a;font-weight:600;text-align:right">${fmt(calc.shownLabor)}</td>
          </tr>`;
      }
      if (calc.showMaterials) {
        rowsHtml += `
          <tr>
            <td style="padding:9px 0;font-size:14.5px;color:#555">Materials</td>
            <td style="padding:9px 0;font-size:14.5px;color:#1a1a1a;font-weight:600;text-align:right">${fmt(calc.shownMaterials)}</td>
          </tr>`;
      }
      lineItemsHtml = `
        <div style="margin:24px 0">
          <div style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:2px;color:#888;text-transform:uppercase;margin-bottom:10px">Line Items</div>
          <div style="background:#faf8f4;border:1px solid #e8e2d9;border-radius:10px;padding:16px 22px">
            <table style="width:100%;border-collapse:collapse">
              ${rowsHtml}
              <tr>
                <td style="padding-top:12px;border-top:2px solid #0d1b2a;font-family:Arial,sans-serif;font-size:20px;font-weight:700;letter-spacing:1.5px;color:#0d1b2a">TOTAL</td>
                <td style="padding-top:12px;border-top:2px solid #0d1b2a;font-family:Arial,sans-serif;font-size:20px;font-weight:700;letter-spacing:1.5px;color:#0d1b2a;text-align:right">${fmt(calc.customerTotal)}</td>
              </tr>
            </table>
          </div>
        </div>
      `;
      if (calc.showLabor && calc.showMaterials) {
        includedNoteHtml = `
          <div style="background:#f7f9f5;border-left:3px solid #2ecc71;padding:11px 16px;font-size:13px;color:#555;border-radius:0 6px 6px 0;margin:-12px 0 24px">
            <strong style="color:#2ecc71">✓ All materials included</strong> — paint, fixtures, hardware, and supplies are covered in the price above.
          </div>
        `;
      } else if (!calc.showLabor && calc.showMaterials && calc.hasLabor) {
        includedNoteHtml = `
          <div style="background:#f7f9f5;border-left:3px solid #2ecc71;padding:11px 16px;font-size:13px;color:#555;border-radius:0 6px 6px 0;margin:-12px 0 24px">
            <strong style="color:#2ecc71">✓ Labor included</strong> — all work is covered in the price above.
          </div>
        `;
      }
      // Only labor checked: no note shown
    }

    const issuedDate = new Date(record.sentAt || record.submittedAt || Date.now()).toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric"
    });

    // ── TRACKING PIXEL ────────────────────────────────────────────────────────
    // Fires every time the email is opened — track-open.js handles deduplication
    const trackingPixelUrl = `${siteUrl}/.netlify/functions/track-open?ref=${encodeURIComponent(ref)}&name=${encodeURIComponent(customer.name || "")}&email=${encodeURIComponent(recipientEmail)}&title=${encodeURIComponent(projectTitle)}`;
    const trackingPixel = `<img src="${trackingPixelUrl}" width="1" height="1" style="display:none;border:0;outline:none" alt="">`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif;color:#333;line-height:1.6">
<div style="max-width:640px;margin:0 auto;padding:20px">

  <div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#fff;padding:32px 24px;border-radius:12px 12px 0 0;text-align:center">
    <a href="https://www.sanibuildingcorp.com" style="text-decoration:none;color:inherit">
      <div style="font-family:Arial,sans-serif;font-size:24px;letter-spacing:4px;color:#c9a84c;font-weight:700">SANI BUILDING CORP</div>
    </a>
    <div style="font-size:11px;letter-spacing:2.5px;color:#aaa;margin-top:8px;text-transform:uppercase">YOUR ESTIMATE IS READY</div>
  </div>

  <div style="background:#fff;padding:30px 28px;border:1px solid #e8e2d9;border-top:none;border-radius:0 0 12px 12px">

    <h1 style="color:#0d1b2a;font-size:23px;margin:0 0 14px">Hi ${escapeHtml(firstName)},</h1>
    <p style="font-size:14.5px;color:#555;margin-bottom:18px">Thanks for reaching out about your <strong>${escapeHtml(projectTitle)}</strong>. We have put together a detailed estimate for you.</p>
    <div style="background:#fff8e8;border:1px solid #e8c97a;border-radius:8px;padding:10px 14px;margin-bottom:18px;font-size:12px;color:#8a6a00">
      📬 <strong>Gmail users:</strong> This email may appear in your Promotions tab. To always receive it in your inbox, drag this email to the Primary tab and click "Yes" when prompted.
    </div>

    ${est.summary ? `<div style="background:#f7f0e3;border-left:4px solid #c9a84c;padding:14px 18px;margin:18px 0;font-size:14px;color:#444;border-radius:0 6px 6px 0">${escapeHtml(est.summary)}</div>` : ""}

    <div style="border:1px solid #e8e2d9;border-radius:10px;overflow:hidden;margin:20px 0">
      <div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#fff;padding:13px 18px;font-family:Arial,sans-serif;font-size:15px;letter-spacing:2px;font-weight:700">
        ESTIMATE <span style="color:#c9a84c">#${escapeHtml(ref)}</span>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#555;width:110px">Issued</td>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#1a1a1a;font-weight:600">${escapeHtml(issuedDate)}</td>
        </tr>
        <tr>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-size:13px;color:#555">Total</td>
          <td style="padding:12px 18px;border-bottom:1px solid #e8e2d9;font-family:Arial,sans-serif;font-size:20px;color:#0d1b2a;font-weight:700;letter-spacing:1px">${fmt(calc.customerTotal)}</td>
        </tr>
        ${est.timelineText ? `
        <tr>
          <td style="padding:12px 18px;font-size:13px;color:#555">Timeline</td>
          <td style="padding:12px 18px;font-size:13px;color:#1a1a1a;font-weight:600">${escapeHtml(est.timelineText)}</td>
        </tr>
        ` : ""}
      </table>
    </div>

    ${breakdownHtml ? `
    <div style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:2px;color:#888;text-transform:uppercase;margin:28px 0 14px">Project Breakdown</div>
    ${breakdownHtml}
    ` : ""}

    ${lineItemsHtml}
    ${includedNoteHtml}
    ${photosHtml}

    ${photoCount > 0 ? `
    <div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);border-radius:12px;padding:18px 20px;margin:0 0 16px;display:flex;align-items:center;gap:14px">
      <div style="font-size:32px;flex-shrink:0">📸</div>
      <div>
        <div style="color:#c9a84c;font-weight:700;font-size:14px;letter-spacing:0.5px">${photoCount} Project Photo${photoCount > 1 ? 's' : ''} Included</div>
        <div style="color:rgba(255,255,255,0.65);font-size:12px;margin-top:3px">Tap “View Full Estimate” below to see all photos for your project.</div>
      </div>
    </div>` : ""}

    <div style="text-align:center;margin:8px 0 28px">
      <a href="${quoteUrl}" style="display:inline-block;background:#c9a84c;color:#0d1b2a;padding:18px 40px;border-radius:12px;text-decoration:none;font-weight:800;font-size:16px;letter-spacing:0.5px;width:100%;box-sizing:border-box">
        View Full Estimate &amp; Approve →
      </a>
      <div style="margin-top:8px;font-size:11px;color:#aaa">
        ✓ Approve online &nbsp;·&nbsp; ✎ Request changes &nbsp;·&nbsp; ⬇ Download
      </div>
    </div>

    <p style="font-size:14px;color:#555;margin:24px 0 0">Click the button above to view your estimate, approve it online, or request changes. You can also reply directly to this email or call <a href="tel:+13322770990" style="color:#b8930a;text-decoration:none;font-weight:600">(332) 277-0990</a>.</p>

    <div style="margin-top:32px;padding-top:24px;border-top:1px solid #eee;text-align:center">
      <div style="color:#888;font-size:11px;letter-spacing:2px;text-transform:uppercase">Sani Building Corp</div>
      <div style="font-size:12px;color:#888;margin-top:4px">Fully Insured · 4.9 Stars · NYC Metro</div>
      <div style="margin-top:14px"><a href="https://www.sanibuildingcorp.com" style="color:#b8930a;text-decoration:none;font-size:12px;font-weight:600">Visit sanibuildingcorp.com</a></div>
    </div>
  </div>
</div>

${trackingPixel}
</body></html>`;

    // ── SEND ──────────────────────────────────────────────────────────────────
    await sendResend(resendKey, {
      from: "Sani Building Corp <estimates@sanibuildingcorp.com>",
      to: [recipientEmail],
      reply_to: contractorEmail,
      subject: `Your Estimate from Sani Building Corp - ${projectTitle} (${ref})`,
      html,
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
  const customerTotal = bothHidden ? fallbackGrand : (shownLabor + shownMaterials);

  return {
    customerTotal: Math.round(customerTotal * 100) / 100,
    shownLabor: Math.round(shownLabor * 100) / 100,
    shownMaterials: Math.round(shownMaterials * 100) / 100,
    hasLabor: labor > 0,
    hasMaterials: mat > 0,
    showLabor,
    showMaterials,
    bothHidden
  };
}

function parseScope(scopeText) {
  if (!scopeText || !scopeText.trim()) return [];
  const lines = scopeText.split(/\r?\n/);
  const categories = [];
  let current = null;
  const preCategoryItems = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    const isHeader = /^[^•\-*\d].*:$/.test(trimmed) && trimmed.length < 80 && !trimmed.startsWith("•") && !trimmed.startsWith("-") && !trimmed.startsWith("*");
    if (isHeader) {
      if (current && current.items.length) categories.push(current);
      current = { name: trimmed.replace(/:$/, "").trim(), items: [] };
    } else {
      const cleanedItem = trimmed.replace(/^[•\-*]\s*/, "").replace(/^\d+\.\s*/, "").trim();
      if (!cleanedItem) continue;
      if (current) current.items.push(cleanedItem);
      else preCategoryItems.push(cleanedItem);
    }
  }
  if (current && current.items.length) categories.push(current);
  if (preCategoryItems.length) {
    if (categories.length === 0) categories.push({ name: "Scope of Work", items: preCategoryItems });
    else categories.unshift({ name: "Scope of Work", items: preCategoryItems });
  }
  return categories;
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
