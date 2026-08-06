// netlify/functions/estimate-request.js
// Receives final V3 estimate submission.
// SAVES to Netlify Blobs (so dashboard can load it).
// Sends: contractor email, customer confirmation email, contractor SMS (if Twilio set).

const https = require("https");
const { getStore } = require("@netlify/blobs");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);
    const {
      ref, name, phone, email, address,
      service, serviceId, serviceAnswers, customerSupplies, answerTopics,
      propertyType, description, timeline,
      photoCount, photos, photoAnalysis, submittedAt,
    } = body;

    if (!name || !email || !service) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "Missing required fields" }),
      };
    }

    // ============ SAVE TO BLOBS ============
    // This is the new piece — dashboard reads from here
    try {
      const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
      const record = {
        ref,
        status: "new", // new | drafted | sent | accepted | declined | invoiced | paid
        customer: { name, phone, email, address },
        request: {
          service, serviceId, serviceAnswers,
          // Main materials the customer said they are buying themselves (final form step).
          // The estimator prices these at $0 and keeps the labor to install them.
          customerSupplies: Array.isArray(customerSupplies)
            ? customerSupplies.filter((x) => x && String(x).trim()).map((x) => String(x).trim())
            : [],
          // questionId -> trade ("Bathroom", "Painting"...). Lets the estimator file each
          // answer under the right service instead of guessing from the wording.
          answerTopics: answerTopics && typeof answerTopics === "object" ? answerTopics : {},
          propertyType, description, timeline,
          photoCount: photoCount || 0,
          photos: photos || [],
          // AI photo-analysis findings (contractor's eyes only — shown in the dashboard,
          // not used for pricing unless the contractor opts in). Saved so the dashboard
          // can display "what the analyzer read & wrote."
          photoAnalysis: Array.isArray(photoAnalysis) ? photoAnalysis : [],
        },
        // Estimate fields (filled in later by contractor + AI)
        estimate: {
          projectTitle: "",
          summary: "",
          scopeOfWork: "",
          labor: [],
          materials: [],
          customerSupplied: [],
          exclusions: [],
          options: [],
          timelineText: "",
          markupPct: 25,
          notes: "",
        },
        submittedAt: submittedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sentAt: null,
        acceptedAt: null,
      };
      await store.setJSON(ref, record);
      console.log("Saved to Blobs:", ref);
    } catch (blobErr) {
      console.error("Blobs save failed:", blobErr.message);
      // Don't fail the whole request if Blobs fails — emails still go
    }

    // ============ SEND NOTIFICATIONS ============
    const resendKey = process.env.RESEND_API_KEY;
    const contractorEmail = process.env.CONTRACTOR_EMAIL || "sanibuildingcorp@gmail.com";

    const tasks = [];

    if (resendKey) {
      tasks.push(
        sendContractorEmail(resendKey, contractorEmail, body).catch((e) =>
          console.error("Contractor email failed:", e.message)
        )
      );
      tasks.push(
        sendCustomerConfirmation(resendKey, contractorEmail, body).catch((e) =>
          console.error("Customer email failed:", e.message)
        )
      );
    }

    const twilioSid = process.env.TWILIO_SID;
    const twilioToken = process.env.TWILIO_TOKEN;
    const twilioFrom = process.env.TWILIO_FROM;
    const contractorPhone = process.env.CONTRACTOR_PHONE;
    if (twilioSid && twilioToken && twilioFrom && contractorPhone) {
      tasks.push(
        sendSMS(twilioSid, twilioToken, twilioFrom, contractorPhone, body).catch((e) =>
          console.error("SMS failed:", e.message)
        )
      );
    }

    await Promise.all(tasks);

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ success: true, ref }),
    };
  } catch (err) {
    console.error("Handler error:", err.message);
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

function escapeHtml(t) {
  if (t == null) return "";
  return String(t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function sendContractorEmail(resendKey, contractorEmail, data) {
  const photoHtml = (data.photos || [])
    .slice(0, 8)
    .map(
      (p, i) =>
        `<img src="${p.data}" alt="Photo ${i + 1}" style="width:120px;height:120px;object-fit:cover;border-radius:8px;margin:4px;border:1px solid #e8e4dc">`
    )
    .join("");

  const answerRows = Object.entries(data.serviceAnswers || {})
    .filter(([_, v]) => v && String(v).trim())
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 10px;color:#888;text-transform:capitalize;width:160px;background:#faf8f4"><strong>${escapeHtml(k.replace(/-/g, " "))}</strong></td><td style="padding:6px 10px">${escapeHtml(v)}</td></tr>`
    )
    .join("");

  const suppliesList = Array.isArray(data.customerSupplies)
    ? data.customerSupplies.filter((x) => x && String(x).trim())
    : [];
  const suppliesRow = suppliesList.length
    ? `<tr><td style="padding:6px 10px;color:#888;width:160px;background:#fff6e0"><strong>Customer supplies</strong></td><td style="padding:6px 10px;background:#fff6e0"><strong>${escapeHtml(
        suppliesList.join(" \u00b7 ")
      )}</strong></td></tr>`
    : "";

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:20px;color:#333;line-height:1.6">
<div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#fff;padding:24px;border-radius:10px 10px 0 0;text-align:center">
  <div style="font-family:'Bebas Neue',Arial,sans-serif;font-size:22px;letter-spacing:3px;color:#c9a84c">SANI BUILDING CORP</div>
  <div style="font-size:11px;letter-spacing:2px;color:#aaa;margin-top:4px">NEW ESTIMATE REQUEST</div>
</div>
<div style="background:#fff;border:1px solid #e8e2d9;border-top:none;padding:24px;border-radius:0 0 10px 10px">
  <h1 style="font-family:'Bebas Neue',Arial,sans-serif;color:#0d1b2a;letter-spacing:2px;font-size:26px;margin:0 0 8px">🆕 ${escapeHtml(data.service)}</h1>
  <div style="background:#fffbe6;border-left:4px solid #c9a84c;padding:10px 14px;margin-bottom:18px;font-size:13px">
    <strong>Ref:</strong> ${escapeHtml(data.ref)} ·
    <strong>Submitted:</strong> ${new Date(data.submittedAt).toLocaleString("en-US", { timeZone: "America/New_York" })} ET
  </div>

  <h2 style="color:#b8720a;font-family:'Bebas Neue',Arial,sans-serif;letter-spacing:2px;font-size:18px;margin-top:18px">👤 Customer</h2>
  <table style="width:100%;font-size:14px;margin-bottom:14px;border-collapse:collapse">
    <tr><td style="padding:6px 10px;width:160px;color:#888;background:#faf8f4"><strong>Name</strong></td><td style="padding:6px 10px">${escapeHtml(data.name)}</td></tr>
    <tr><td style="padding:6px 10px;color:#888;background:#faf8f4"><strong>Phone</strong></td><td style="padding:6px 10px"><a href="tel:${escapeHtml(data.phone)}" style="color:#b8720a">${escapeHtml(data.phone)}</a></td></tr>
    <tr><td style="padding:6px 10px;color:#888;background:#faf8f4"><strong>Email</strong></td><td style="padding:6px 10px"><a href="mailto:${escapeHtml(data.email)}" style="color:#b8720a">${escapeHtml(data.email)}</a></td></tr>
    <tr><td style="padding:6px 10px;color:#888;background:#faf8f4"><strong>Address</strong></td><td style="padding:6px 10px">${escapeHtml(data.address || "—")}</td></tr>
  </table>

  <h2 style="color:#b8720a;font-family:'Bebas Neue',Arial,sans-serif;letter-spacing:2px;font-size:18px;margin-top:18px">🏗️ Project</h2>
  <table style="width:100%;font-size:14px;margin-bottom:14px;border-collapse:collapse">
    <tr><td style="padding:6px 10px;width:160px;color:#888;background:#faf8f4"><strong>Service</strong></td><td style="padding:6px 10px;font-weight:600">${escapeHtml(data.service)}</td></tr>
    <tr><td style="padding:6px 10px;color:#888;background:#faf8f4"><strong>Property</strong></td><td style="padding:6px 10px">${escapeHtml(data.propertyType || "—")}</td></tr>
    <tr><td style="padding:6px 10px;color:#888;background:#faf8f4"><strong>Timeline</strong></td><td style="padding:6px 10px;color:#b8720a;font-weight:600">${escapeHtml(data.timeline || "—")}</td></tr>
    ${suppliesRow}${answerRows}
  </table>

  ${data.description ? `<div style="background:#f8f8f8;border-radius:8px;padding:14px;margin-bottom:14px"><strong style="color:#888;font-size:11px;letter-spacing:1px;text-transform:uppercase">Customer Notes</strong><div style="margin-top:8px;font-size:14px;white-space:pre-wrap">${escapeHtml(data.description)}</div></div>` : ""}

  ${data.photoCount > 0 ? `<div style="margin-bottom:18px"><strong style="color:#888;font-size:11px;letter-spacing:1px;text-transform:uppercase">📷 Photos (${data.photoCount})</strong><div style="margin-top:10px">${photoHtml}</div></div>` : ""}

  <div style="margin-top:24px;padding:16px;background:#fffbe6;border-left:4px solid #c9a84c;border-radius:6px;text-align:center">
    <strong style="color:#b8720a;font-size:14px">📋 Next:</strong> Open your dashboard to build the scope and send the customer a priced quote.<br>
    <a href="https://velvety-horse-2aa6e3.netlify.app/dashboard.html" style="display:inline-block;margin-top:10px;background:#c9a84c;color:#0d1b2a;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:700">Open Dashboard →</a>
  </div>

  <div style="margin-top:18px;text-align:center;color:#999;font-size:12px">
    📞 <a href="tel:${escapeHtml(data.phone)}" style="color:#b8720a;text-decoration:none">Call ${escapeHtml((data.name || "").split(" ")[0])}</a> ·
    ✉ <a href="mailto:${escapeHtml(data.email)}" style="color:#b8720a;text-decoration:none">Email</a>
  </div>
</div>
</body></html>`;

  return sendResend(resendKey, {
    from: "Sani Building Corp <estimates@sanibuildingcorp.com>",
    to: [contractorEmail],
    reply_to: data.email,
    subject: `🆕 ${data.service} — ${data.name} (${data.ref})`,
    html,
  });
}

async function sendCustomerConfirmation(resendKey, contractorEmail, data) {
  // Domain is verified at Resend — confirmation goes to every customer.

  const firstName = (data.name || "there").split(" ")[0];
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif;color:#333;line-height:1.6">
<div style="max-width:560px;margin:0 auto;padding:20px">
  <div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#fff;padding:30px;border-radius:10px 10px 0 0;text-align:center">
    <div style="font-family:'Bebas Neue',Arial,sans-serif;font-size:22px;letter-spacing:4px;color:#c9a84c;font-weight:700">SANI BUILDING CORP</div>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #e8e2d9;border-top:none;border-radius:0 0 10px 10px">
    <div style="text-align:center;margin-bottom:20px">
      <div style="display:inline-block;background:#2ecc71;color:#fff;width:60px;height:60px;border-radius:50%;line-height:60px;font-size:28px">✓</div>
    </div>
    <h1 style="text-align:center;color:#0d1b2a;font-size:24px;margin:0 0 12px">Thanks, ${escapeHtml(firstName)}!</h1>
    <p style="font-size:15px;color:#555;text-align:center;margin-bottom:24px">We received your ${escapeHtml((data.service || "").toLowerCase())} request and we're reviewing it now. You'll hear from us personally within one business day with your detailed estimate.</p>

    <div style="background:#f5f0e8;border-radius:8px;padding:18px;margin:18px 0">
      <table style="width:100%">
        <tr><td style="padding:6px 0;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px">Reference</td><td style="padding:6px 0;font-size:14px;font-weight:600;color:#0d1b2a;text-align:right">${escapeHtml(data.ref)}</td></tr>
        <tr><td style="padding:6px 0;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px">Project</td><td style="padding:6px 0;font-size:14px;color:#0d1b2a;text-align:right">${escapeHtml(data.service)}</td></tr>
        <tr><td style="padding:6px 0;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px">Timeline</td><td style="padding:6px 0;font-size:14px;color:#0d1b2a;text-align:right">${escapeHtml(data.timeline || "—")}</td></tr>
      </table>
    </div>

    <p style="font-size:14px;color:#555;margin:24px 0 0">If anything urgent comes up, you can reach us directly at <a href="tel:+13322770990" style="color:#b8720a;text-decoration:none;font-weight:600">(332) 277-0990</a> or just reply to this email.</p>

    <div style="margin-top:32px;padding-top:24px;border-top:1px solid #eee;text-align:center">
      <div style="color:#888;font-size:11px;letter-spacing:2px;text-transform:uppercase">Sani Building Corp</div>
      <div style="font-size:12px;color:#888;margin-top:4px">Serving NYC Metro · Fully Insured · 4.9 ★</div>
    </div>
  </div>
</div>
</body></html>`;

  return sendResend(resendKey, {
    from: "Sani Building Corp <estimates@sanibuildingcorp.com>",
    to: [data.email],
    reply_to: contractorEmail,
    subject: `We got your request — Sani Building Corp (${data.ref})`,
    html,
  });
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

function sendSMS(sid, token, from, to, d) {
  const body = `🛠 NEW ESTIMATE\n${d.service}\n${d.name} · ${d.phone}\n${d.propertyType || ""}\nTimeline: ${d.timeline || "—"}\nRef: ${d.ref}`;
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const params = new URLSearchParams({ From: from, To: to, Body: body }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.twilio.com",
        port: 443,
        path: `/2010-04-01/Accounts/${sid}/Messages.json`,
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(params),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
          else reject(new Error(`Twilio ${res.statusCode}: ${body}`));
        });
      }
    );
    req.on("error", reject);
    req.write(params);
    req.end();
  });
}
