// netlify/functions/handyman-agreement.js
// Two-in-one endpoint:
//   GET  /handyman-agreement?token=XXX           → Returns agreement data for the public page
//   POST /handyman-agreement                     → Receives signature OR change request
//
// POST body for signing:
//   { token, action: "sign", signatureType: "drawn"|"typed", signatureData: "<base64 or name>" }
// POST body for changes:
//   { token, action: "request_changes", changesText: "..." }

const https = require("https");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return resp(500, { error: "Supabase env vars not set" });
  }

  try {
    // ════════ GET: load agreement data ════════
    if (event.httpMethod === "GET") {
      const token = (event.queryStringParameters || {}).token;
      if (!token) return resp(400, { error: "Missing token" });

      const rows = await supabaseRequest(
        supabaseUrl, supabaseKey,
        "GET",
        `/rest/v1/agreements?token=eq.${encodeURIComponent(token)}&select=*&limit=1`
      );
      if (!rows || rows.length === 0) {
        return resp(404, { error: "Agreement not found" });
      }
      const agreement = rows[0];
      // Don't leak signature_data or signed_ip back to public
      delete agreement.signed_ip;
      delete agreement.signed_user_agent;
      return resp(200, { agreement: agreement });
    }

    // ════════ POST: sign or request changes ════════
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { token, action } = body;

      if (!token) return resp(400, { error: "Missing token" });
      if (!action) return resp(400, { error: "Missing action" });

      // Load the agreement
      const rows = await supabaseRequest(
        supabaseUrl, supabaseKey,
        "GET",
        `/rest/v1/agreements?token=eq.${encodeURIComponent(token)}&select=*&limit=1`
      );
      if (!rows || rows.length === 0) {
        return resp(404, { error: "Agreement not found" });
      }
      const agreement = rows[0];

      // Already signed?
      if (agreement.status === "signed") {
        return resp(409, { error: "This agreement has already been signed" });
      }

      const ip = event.headers["x-forwarded-for"] || event.headers["client-ip"] || "";
      const userAgent = event.headers["user-agent"] || "";

      // ════════ SIGN ════════
      if (action === "sign") {
        const { signatureType, signatureData, depositPaidClaimed } = body;
        if (!signatureType || !signatureData) {
          return resp(400, { error: "Missing signature data" });
        }

        let storedSignature = signatureData;

        // If drawn signature, upload to storage and store URL
        if (signatureType === "drawn") {
          try {
            const path = `${agreement.booking_ref}/signature-${Date.now()}.png`;
            const url = await uploadSignature(supabaseUrl, supabaseKey, path, signatureData);
            storedSignature = url;
          } catch (e) {
            console.error("Signature upload failed:", e.message);
            // Fallback: store raw base64 in the column
            storedSignature = signatureData;
          }
        }

        // Update agreement
        await supabaseRequest(
          supabaseUrl, supabaseKey,
          "PATCH",
          `/rest/v1/agreements?token=eq.${encodeURIComponent(token)}`,
          {
            status: "signed",
            signature_type: signatureType,
            signature_data: storedSignature,
            signed_at: new Date().toISOString(),
            signed_ip: ip.slice(0, 100),
            signed_user_agent: userAgent.slice(0, 250),
            deposit_paid_claimed: depositPaidClaimed === true
          }
        );

        // Update booking status
        await supabaseRequest(
          supabaseUrl, supabaseKey,
          "PATCH",
          `/rest/v1/bookings?ref=eq.${encodeURIComponent(agreement.booking_ref)}`,
          { agreement_status: "signed", status: "confirmed" }
        );

        // Notify contractor
        try {
          await notifyContractor({
            type: "signed",
            agreement: agreement,
            signatureType: signatureType,
            signatureData: storedSignature,
            ip: ip,
            depositPaidClaimed: depositPaidClaimed === true
          });

          // ── Customer copy: the page promises "A copy has been sent to your email" — honor it ──
          try {
            await sendResend(process.env.RESEND_API_KEY, {
              from: "Sani Building Corp <contact@sanibuildingcorp.com>",
              to: [agreement.customer_email],
              bcc: process.env.CONTRACTOR_EMAIL ? [process.env.CONTRACTOR_EMAIL] : undefined,
              reply_to: "contact@sanibuildingcorp.com",
              subject: `✅ Signed: ${agreement.service_name || "Service Agreement"} · ${agreement.booking_ref || ""}`,
              html: customerCopyHtml(agreement),
              text: "Your signed Sani Building Corp service agreement is confirmed."
                + (agreement.appointment_date ? " Appointment: " + agreement.appointment_date + (agreement.appointment_time ? " " + agreement.appointment_time : "") + "." : "")
                + " Questions? (332) 277-0990 · contact@sanibuildingcorp.com"
            });
          } catch (e) { console.error("customer copy failed", e); }
        } catch (e) {
          console.error("Contractor notification failed:", e.message);
        }

        return resp(200, { success: true, status: "signed" });
      }

      // ════════ REQUEST CHANGES ════════
      if (action === "request_changes") {
        const { changesText } = body;
        if (!changesText || changesText.trim().length < 3) {
          return resp(400, { error: "Please describe what you'd like to change" });
        }

        await supabaseRequest(
          supabaseUrl, supabaseKey,
          "PATCH",
          `/rest/v1/agreements?token=eq.${encodeURIComponent(token)}`,
          {
            status: "changes_requested",
            changes_text: changesText,
            changes_at: new Date().toISOString()
          }
        );

        await supabaseRequest(
          supabaseUrl, supabaseKey,
          "PATCH",
          `/rest/v1/bookings?ref=eq.${encodeURIComponent(agreement.booking_ref)}`,
          { agreement_status: "changes_requested" }
        );

        try {
          await notifyContractor({
            type: "changes_requested",
            agreement: agreement,
            changesText: changesText
          });
        } catch (e) {
          console.error("Contractor notification failed:", e.message);
        }

        return resp(200, { success: true, status: "changes_requested" });
      }

      return resp(400, { error: "Unknown action" });
    }

    return resp(405, { error: "Method Not Allowed" });
  } catch (err) {
    console.error("handyman-agreement error:", err.message);
    return resp(500, { error: err.message });
  }
};

// ════════════════════════════════════════════════════════════════════
// HELPER: Upload signature PNG to Supabase Storage
// ════════════════════════════════════════════════════════════════════
async function uploadSignature(supabaseUrl, supabaseKey, path, base64Data) {
  const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(cleanBase64, "base64");
  if (buffer.length === 0) throw new Error("Empty signature buffer");

  const uploadUrl = `${supabaseUrl}/storage/v1/object/agreement-signatures/${path}`;

  return new Promise(function(resolve, reject) {
    const u = new URL(uploadUrl);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "image/png",
        "Content-Length": buffer.length,
        "x-upsert": "true"
      }
    }, function(res) {
      const chunks = [];
      res.on("data", function(c) { chunks.push(c); });
      res.on("end", function() {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(`${supabaseUrl}/storage/v1/object/public/agreement-signatures/${path}`);
        } else {
          reject(new Error(`Signature upload ${res.statusCode}: ${Buffer.concat(chunks).toString("utf8").slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, function() { req.destroy(new Error("Upload timeout")); });
    req.write(buffer);
    req.end();
  });
}

// ════════════════════════════════════════════════════════════════════
// HELPER: Notify contractor by email
// ════════════════════════════════════════════════════════════════════
async function notifyContractor({ type, agreement, signatureType, signatureData, changesText, ip, depositPaidClaimed }) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) throw new Error("RESEND_API_KEY not set");
  const contractorEmail = process.env.CONTRACTOR_EMAIL || "sanibuildingcorp@gmail.com";

  let subject, html;

  if (type === "signed") {
    subject = `✅ AGREEMENT SIGNED: ${agreement.customer_name} · ${agreement.booking_ref}`;

    const sigDisplay = signatureType === "drawn"
      ? `<img src="${esc(signatureData)}" style="max-width:300px;border:1px solid #ddd;border-radius:6px;background:#fff;padding:8px">`
      : `<div style="font-family:'Brush Script MT',cursive;font-size:36px;color:#0d1b2a;border-bottom:2px solid #c9a84c;padding:8px 16px;display:inline-block">${esc(signatureData)}</div>`;

    // Build deposit status banner
    const depositAmt = agreement.pay_now_amount || 0;
    const depositEnabled = agreement.pay_now_enabled && depositAmt > 0;
    let depositBanner = "";
    if (depositEnabled) {
      if (depositPaidClaimed) {
        depositBanner = `<div style="background:linear-gradient(135deg,#e8f5e8,#d4edda);border:2px solid #27ae60;border-radius:10px;padding:16px;margin:18px 0;text-align:center">
          <div style="font-size:11px;letter-spacing:2px;color:#27ae60;text-transform:uppercase;font-weight:700;margin-bottom:4px">💸 Deposit Status</div>
          <div style="font-family:Georgia,serif;font-size:18px;color:#27ae60;font-weight:700">Customer claims they sent $${depositAmt} via Zelle</div>
          <div style="font-size:12px;color:#555;margin-top:6px">⚠️ Verify the payment landed in your Zelle (sanibuildingcorp@gmail.com) before the appointment.</div>
        </div>`;
      } else {
        depositBanner = `<div style="background:#fef3e0;border:2px solid #d4a017;border-radius:10px;padding:16px;margin:18px 0;text-align:center">
          <div style="font-size:11px;letter-spacing:2px;color:#b8930a;text-transform:uppercase;font-weight:700;margin-bottom:4px">💸 Deposit Status</div>
          <div style="font-family:Georgia,serif;font-size:18px;color:#b8930a;font-weight:700">$${depositAmt} Deposit Not Yet Paid</div>
          <div style="font-size:12px;color:#555;margin-top:6px">Customer signed but didn't mark deposit as paid. Follow up before the appointment.</div>
        </div>`;
      }
    }

    html = `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f0e8;font-family:Arial,sans-serif;color:#333">
<div style="max-width:600px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#27ae60,#2ecc71);color:#fff;padding:30px 24px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:42px;margin-bottom:6px">✅</div>
    <div style="font-family:Georgia,serif;font-size:24px;font-weight:700">Agreement Signed!</div>
    <div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:6px">${esc(agreement.booking_ref)}</div>
  </div>
  <div style="background:#fff;padding:28px;border:1px solid #e8e2d9;border-top:none;border-radius:0 0 12px 12px">
    <p style="font-size:15px;color:#333;line-height:1.6;margin:0 0 18px"><strong>${esc(agreement.customer_name)}</strong> has signed the agreement for <strong>${esc(agreement.service_name)}</strong>.</p>

    ${depositBanner}

    <div style="background:#faf8f4;border-radius:10px;padding:18px;margin:18px 0">
      <div style="font-size:11px;letter-spacing:2px;color:#888;text-transform:uppercase;margin-bottom:10px">📋 Signed Details</div>
      <div style="font-size:13px;color:#444;line-height:1.8">
        <strong>Customer:</strong> ${esc(agreement.customer_name)}<br>
        <strong>Service:</strong> ${esc(agreement.service_name)}<br>
        <strong>Date:</strong> ${esc(agreement.appointment_date || "TBD")} ${esc(agreement.appointment_time || "")}<br>
        <strong>Price:</strong> ${esc(formatPrice(agreement))}<br>
        <strong>Signed at:</strong> ${new Date().toLocaleString("en-US")}<br>
        <strong>IP:</strong> ${esc(ip || "unknown")}
      </div>
    </div>

    <div style="text-align:center;margin:24px 0">
      <div style="font-size:11px;letter-spacing:2px;color:#888;text-transform:uppercase;margin-bottom:12px">Customer Signature</div>
      ${sigDisplay}
    </div>

    <div style="text-align:center;margin-top:24px">
      <a href="tel:${esc(agreement.customer_phone)}" style="display:inline-block;background:#c9a84c;color:#0d1b2a;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin:4px">📞 Call Customer</a>
    </div>
  </div>
</div>
</body></html>`;
  } else {
    subject = `💬 CHANGES REQUESTED: ${agreement.customer_name} · ${agreement.booking_ref}`;
    html = `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f0e8;font-family:Arial,sans-serif;color:#333">
<div style="max-width:600px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#d4a017,#b8930a);color:#fff;padding:30px 24px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:42px;margin-bottom:6px">💬</div>
    <div style="font-family:Georgia,serif;font-size:24px;font-weight:700">Customer Wants Changes</div>
    <div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:6px">${esc(agreement.booking_ref)}</div>
  </div>
  <div style="background:#fff;padding:28px;border:1px solid #e8e2d9;border-top:none;border-radius:0 0 12px 12px">
    <p style="font-size:15px;color:#333;line-height:1.6;margin:0 0 18px"><strong>${esc(agreement.customer_name)}</strong> would like to discuss changes to the agreement for <strong>${esc(agreement.service_name)}</strong> before signing.</p>

    <div style="background:#fff8e8;border:2px solid #c9a84c;border-radius:10px;padding:20px;margin:20px 0">
      <div style="font-size:11px;letter-spacing:2px;color:#b8930a;text-transform:uppercase;margin-bottom:10px;font-weight:700">📝 Their Message</div>
      <div style="font-size:14px;color:#444;line-height:1.7;white-space:pre-wrap">${esc(changesText)}</div>
    </div>

    <div style="background:#faf8f4;border-radius:10px;padding:16px;margin:18px 0">
      <div style="font-size:13px;color:#555;line-height:1.7">
        <strong>📞 Phone:</strong> ${esc(agreement.customer_phone || "")}<br>
        <strong>✉️ Email:</strong> ${esc(agreement.customer_email || "")}
      </div>
    </div>

    <div style="text-align:center;margin-top:20px">
      <a href="tel:${esc(agreement.customer_phone)}" style="display:inline-block;background:#c9a84c;color:#0d1b2a;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin:4px">📞 Call Customer</a>
      <a href="mailto:${esc(agreement.customer_email)}" style="display:inline-block;background:#0d1b2a;color:#c9a84c;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin:4px">✉️ Reply by Email</a>
    </div>
  </div>
</div>
</body></html>`;
  }

  await sendResend(resendKey, {
    from: "Sani Building Corp <contact@sanibuildingcorp.com>",
    to: [contractorEmail],
    reply_to: agreement.customer_email,
    subject: subject,
    html: html
  });
}

// ════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════
function formatPrice(a) {
  if (a.pricing_mode === "fixed") return `$${a.fixed_price}`;
  if (a.pricing_mode === "capped") return `Up to $${a.price_max}`;
  return `$${a.price_min} – $${a.price_max}`;
}

function supabaseRequest(supabaseUrl, supabaseKey, method, path, body) {
  const data = body ? JSON.stringify(body) : null;
  return new Promise(function(resolve, reject) {
    const u = new URL(supabaseUrl + path);
    const headers = {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    };
    if (data) headers["Content-Length"] = Buffer.byteLength(data);

    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: method,
      headers: headers
    }, function(res) {
      const chunks = [];
      res.on("data", function(c) { chunks.push(c); });
      res.on("end", function() {
        const respBody = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(respBody ? JSON.parse(respBody) : null); }
          catch (e) { resolve(respBody); }
        } else {
          reject(new Error(`Supabase ${res.statusCode}: ${respBody.slice(0, 300)}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, function() { req.destroy(new Error("Supabase timeout")); });
    if (data) req.write(data);
    req.end();
  });
}

function sendResend(apiKey, payload) {
  const data = JSON.stringify(payload);
  return new Promise(function(resolve, reject) {
    const req = https.request({
      hostname: "api.resend.com",
      port: 443,
      path: "/emails",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        "Authorization": `Bearer ${apiKey}`
      }
    }, function(res) {
      const chunks = [];
      res.on("data", function(c) { chunks.push(c); });
      res.on("end", function() {
        const body = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
        else reject(new Error(`Resend ${res.statusCode}: ${body.slice(0, 200)}`));
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function resp(statusCode, body) {
  return { statusCode: statusCode, headers: cors(), body: JSON.stringify(body) };
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

function esc(t) {
  if (t == null) return "";
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}


function customerCopyHtml(a) {
  var esc = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
  var when = [a.appointment_date, a.appointment_time].filter(Boolean).join(" · ");
  return '<div style="font-family:Georgia,serif;max-width:640px;margin:0 auto;color:#1c2733">'
    + '<div style="background:#0d1b2a;padding:22px 28px;border-top:3px solid #b8930a;text-align:center">'
    + '<span style="color:#b8930a;font-size:18px;letter-spacing:4px;font-family:Arial,sans-serif;font-weight:bold">SANI BUILDING CORP</span>'
    + '<div style="color:#9fb0c3;font-size:11px;letter-spacing:3px;margin-top:6px">AGREEMENT SIGNED ✓</div></div>'
    + '<div style="padding:26px 28px;background:#fdfcf9;border:1px solid #eee;border-top:none">'
    + '<p style="margin:0 0 14px">Hi ' + esc((a.customer_name || "").split(" ")[0] || "there") + ',</p>'
    + '<p style="margin:0 0 16px;line-height:1.6">Thank you — your service agreement is signed and your appointment is confirmed. This email is your copy for your records.</p>'
    + '<table style="width:100%;font-size:14px;line-height:1.8">'
    + '<tr><td style="color:#7a879b;width:130px">Reference</td><td><strong>' + esc(a.booking_ref) + '</strong></td></tr>'
    + '<tr><td style="color:#7a879b">Service</td><td>' + esc(a.service_name) + '</td></tr>'
    + (when ? '<tr><td style="color:#7a879b">Appointment</td><td>' + esc(when) + '</td></tr>' : "")
    + '</table>'
    + '<p style="margin:20px 0 0;line-height:1.5;font-size:14px">Need to reschedule or ask anything? Just reply to this email.<br>— Sani Building Corp<br>'
    + '<a href="tel:+13322770990" style="color:#96770a;text-decoration:none">(332) 277-0990</a> · '
    + '<a href="https://www.sanibuildingcorp.com" style="color:#96770a;text-decoration:none">sanibuildingcorp.com</a></p>'
    + '</div></div>';
}
