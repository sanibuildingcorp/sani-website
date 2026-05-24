// netlify/functions/handyman-send-confirmation.js
// Creates a signable agreement and emails the customer a magic link to view + sign it.
//
// POST body: {
//   bookingRef: "SBC-H-260524-AD2R",
//   pricingMode: "range" | "fixed" | "capped",
//   fixedPrice: 400,                    // when mode='fixed'
//   priceMin: 300, priceMax: 500,       // when mode='range'
//   priceCap: 450,                      // when mode='capped'
//   appointmentDate: "2026-05-27",
//   appointmentTime: "10:00 AM",
//   durationText: "2-3 hours",
//   scopeSummary: "Adjust door alignment...",
//   specialNotes: "",
//   payNowEnabled: false,
//   payNowAmount: 0,
//   payNowLabel: "Deposit"
// }

const https = require("https");
const crypto = require("crypto");

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
      bookingRef,
      pricingMode,
      fixedPrice,
      priceMin,
      priceMax,
      priceCap,
      appointmentDate,
      appointmentTime,
      durationText,
      scopeSummary,
      specialNotes,
      payNowEnabled,
      payNowAmount,
      payNowLabel
    } = body;

    if (!bookingRef) {
      return resp(400, { error: "Missing bookingRef" });
    }
    if (!scopeSummary || scopeSummary.trim().length < 5) {
      return resp(400, { error: "Scope summary is required" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return resp(500, { error: "Supabase env vars not set" });
    }

    // 1. Fetch the booking to get customer info
    const bookings = await supabaseRequest(
      supabaseUrl, supabaseKey,
      "GET",
      `/rest/v1/bookings?ref=eq.${encodeURIComponent(bookingRef)}&select=*&limit=1`
    );
    if (!bookings || bookings.length === 0) {
      return resp(404, { error: "Booking not found" });
    }
    const booking = bookings[0];

    // 2. Generate secure random token (32 chars)
    const token = crypto.randomBytes(24).toString("base64url");

    // 3. Compute display price
    let displayPrice = "";
    let priceForDb = { fixed_price: null, price_min: null, price_max: null };
    if (pricingMode === "fixed") {
      displayPrice = `$${fixedPrice}`;
      priceForDb.fixed_price = fixedPrice;
    } else if (pricingMode === "capped") {
      displayPrice = `Up to $${priceCap}`;
      priceForDb.price_max = priceCap;
    } else {
      // range
      displayPrice = `$${priceMin} – $${priceMax}`;
      priceForDb.price_min = priceMin;
      priceForDb.price_max = priceMax;
    }

    // 4. Build appointment display
    let appointmentDisplay = "To be confirmed";
    if (appointmentDate) {
      const d = new Date(appointmentDate + "T12:00:00");
      const dateStr = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
      appointmentDisplay = appointmentTime ? `${dateStr} · ${appointmentTime}` : dateStr;
    }

    // 5. Save the agreement row
    const agreementRow = {
      booking_ref: bookingRef,
      token: token,
      pricing_mode: pricingMode || "range",
      fixed_price: priceForDb.fixed_price,
      price_min: priceForDb.price_min,
      price_max: priceForDb.price_max,
      appointment_date: appointmentDate || null,
      appointment_time: appointmentTime || null,
      duration_text: durationText || "",
      scope_summary: scopeSummary,
      special_notes: specialNotes || "",
      pay_now_enabled: !!payNowEnabled,
      pay_now_amount: payNowAmount || 0,
      pay_now_label: payNowLabel || "Deposit",
      customer_name: booking.customer_name,
      customer_email: booking.customer_email,
      customer_phone: booking.customer_phone,
      customer_address: booking.customer_address,
      service_name: booking.service_name,
      status: "sent"
    };

    const saved = await supabaseRequest(
      supabaseUrl, supabaseKey,
      "POST",
      "/rest/v1/agreements",
      agreementRow
    );

    const savedRow = Array.isArray(saved) ? saved[0] : saved;

    // 6. Update booking to reference this agreement
    await supabaseRequest(
      supabaseUrl, supabaseKey,
      "PATCH",
      `/rest/v1/bookings?ref=eq.${encodeURIComponent(bookingRef)}`,
      { agreement_id: savedRow.id, agreement_status: "sent" }
    );

    // 7. Send the customer email
    const siteUrl = process.env.PUBLIC_SITE_URL || "https://velvety-horse-2aa6e3.netlify.app";
    const agreementUrl = `${siteUrl}/agreement.html?token=${token}`;

    await sendCustomerConfirmationEmail({
      booking: booking,
      agreement: agreementRow,
      displayPrice: displayPrice,
      appointmentDisplay: appointmentDisplay,
      agreementUrl: agreementUrl
    });

    return resp(200, {
      success: true,
      agreementId: savedRow.id,
      token: token,
      url: agreementUrl
    });
  } catch (err) {
    console.error("handyman-send-confirmation error:", err.message);
    return resp(500, { error: err.message });
  }
};

// ════════════════════════════════════════════════════════════════════
// HELPER: Send customer confirmation email
// ════════════════════════════════════════════════════════════════════
async function sendCustomerConfirmationEmail({ booking, agreement, displayPrice, appointmentDisplay, agreementUrl }) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) throw new Error("RESEND_API_KEY not set");

  const contractorEmail = process.env.CONTRACTOR_EMAIL || "sanibuildingcorp@gmail.com";

  const canSendToCustomer = booking.customer_email && booking.customer_email.toLowerCase() === contractorEmail.toLowerCase();
  const recipient = canSendToCustomer ? booking.customer_email : contractorEmail;
  const prefix = canSendToCustomer ? "" : `[FORWARD TO ${booking.customer_email}] `;

  const firstName = (booking.customer_name || "there").split(" ")[0];

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f0e8;font-family:-apple-system,Arial,sans-serif;color:#333">
<div style="max-width:600px;margin:0 auto">

  <!-- HEADER -->
  <div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#fff;padding:34px 28px;border-radius:14px 14px 0 0;text-align:center;border-top:3px solid #c9a84c">
    <div style="font-family:'Playfair Display',Georgia,serif;font-size:22px;letter-spacing:4px;color:#c9a84c;font-weight:700">SANI BUILDING CORP</div>
    <div style="font-size:10px;letter-spacing:3px;color:#aaa;margin-top:6px;text-transform:uppercase">Service Agreement Ready for Your Approval</div>
  </div>

  <!-- BODY -->
  <div style="background:#fff;padding:32px 28px;border:1px solid #e8e2d9;border-top:none">
    <h1 style="color:#0d1b2a;font-family:'Playfair Display',Georgia,serif;font-size:24px;margin:0 0 16px;font-weight:700">Hi ${esc(firstName)},</h1>

    <p style="font-size:15px;color:#555;line-height:1.7;margin:0 0 24px">Thank you for choosing Sani Building Corp! We've prepared your service agreement based on the details you provided. Please review and sign to confirm your appointment.</p>

    <!-- APPOINTMENT CARD -->
    <div style="background:linear-gradient(135deg,#faf8f4,#f7f0e3);border:1px solid #e8e2d9;border-radius:12px;padding:24px;margin:0 0 22px">
      <div style="font-size:10px;letter-spacing:3px;color:#b8930a;text-transform:uppercase;margin-bottom:14px;font-weight:700">📋 Your Appointment</div>
      
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;color:#333">
        <tr>
          <td style="padding:8px 0;color:#888;width:90px">Service</td>
          <td style="padding:8px 0;font-weight:600;color:#0d1b2a">${esc(booking.service_name)}</td>
        </tr>
        <tr style="border-top:1px solid #e8e2d9">
          <td style="padding:8px 0;color:#888">When</td>
          <td style="padding:8px 0;font-weight:600;color:#0d1b2a">${esc(appointmentDisplay)}</td>
        </tr>
        ${agreement.duration_text ? `
        <tr style="border-top:1px solid #e8e2d9">
          <td style="padding:8px 0;color:#888">Duration</td>
          <td style="padding:8px 0;color:#333">${esc(agreement.duration_text)}</td>
        </tr>
        ` : ""}
        <tr style="border-top:1px solid #e8e2d9">
          <td style="padding:8px 0;color:#888">Price</td>
          <td style="padding:8px 0;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:700;color:#b8930a">${esc(displayPrice)}</td>
        </tr>
        <tr style="border-top:1px solid #e8e2d9">
          <td style="padding:8px 0;color:#888">Location</td>
          <td style="padding:8px 0;color:#333">${esc(booking.customer_address)}</td>
        </tr>
      </table>
    </div>

    <!-- SCOPE OF WORK -->
    <div style="background:#fff8e8;border-left:4px solid #c9a84c;border-radius:0 8px 8px 0;padding:18px 20px;margin:0 0 22px">
      <div style="font-size:10px;letter-spacing:2px;color:#b8930a;text-transform:uppercase;margin-bottom:10px;font-weight:700">🔧 Scope of Work</div>
      <div style="font-size:14px;color:#444;line-height:1.7;white-space:pre-wrap">${esc(agreement.scope_summary)}</div>
      ${agreement.special_notes ? `
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid #e8d8a8">
          <div style="font-size:11px;color:#b8930a;font-weight:700;margin-bottom:4px">Special Notes:</div>
          <div style="font-size:13px;color:#555;line-height:1.6">${esc(agreement.special_notes)}</div>
        </div>
      ` : ""}
    </div>

    ${agreement.pay_now_enabled && agreement.pay_now_amount > 0 ? `
      <!-- DEPOSIT -->
      <div style="background:#e8f5e8;border:1px solid #2ecc71;border-radius:10px;padding:16px;margin:0 0 22px;text-align:center">
        <div style="font-size:11px;letter-spacing:2px;color:#27ae60;text-transform:uppercase;margin-bottom:6px;font-weight:700">💳 ${esc(agreement.pay_now_label)} Required</div>
        <div style="font-family:'Playfair Display',Georgia,serif;font-size:24px;font-weight:700;color:#27ae60">$${agreement.pay_now_amount}</div>
        <div style="font-size:12px;color:#666;margin-top:4px">You can pay this on the agreement page after signing</div>
      </div>
    ` : ""}

    <!-- CTA BUTTON -->
    <div style="text-align:center;margin:30px 0">
      <a href="${esc(agreementUrl)}" style="display:inline-block;background:linear-gradient(135deg,#c9a84c,#b8930a);color:#0d1b2a;padding:18px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:2px;text-transform:uppercase;box-shadow:0 4px 14px rgba(201,168,76,0.4)">
        ✍️ Review &amp; Sign Agreement
      </a>
    </div>

    <p style="font-size:13px;color:#888;text-align:center;margin:14px 0 0">
      Or copy this link:<br>
      <a href="${esc(agreementUrl)}" style="color:#b8930a;word-break:break-all;font-size:12px">${esc(agreementUrl)}</a>
    </p>

    <!-- WHAT NEXT -->
    <div style="margin-top:32px;padding:20px;background:#fafafa;border-radius:10px">
      <div style="font-size:11px;letter-spacing:2px;color:#888;text-transform:uppercase;margin-bottom:12px;font-weight:700">What happens next</div>
      <ol style="margin:0;padding-left:20px;font-size:13px;color:#555;line-height:1.9">
        <li>Click the button above to view your full agreement</li>
        <li>Review terms, pricing, and schedule</li>
        <li>Sign with your finger or type your name</li>
        <li>We'll arrive on time with the right tools and materials</li>
        <li>Pay only after work is approved</li>
      </ol>
    </div>

    <!-- ALTERNATIVE: REQUEST CHANGES -->
    <div style="margin-top:18px;text-align:center;font-size:13px;color:#888">
      Need to change something? You can also <a href="${esc(agreementUrl)}" style="color:#b8930a;font-weight:600">request changes</a> from the agreement page.
    </div>

    <!-- FOOTER -->
    <div style="margin-top:32px;padding-top:22px;border-top:1px solid #eee;text-align:center">
      <div style="color:#888;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-weight:700">Sani Building Corp</div>
      <div style="font-size:12px;color:#888;margin-top:6px">Fully Insured · 4.9 ★ · NYC Metro · 10+ Years</div>
      <div style="font-size:12px;color:#888;margin-top:8px">
        <a href="tel:+13322770990" style="color:#b8930a;text-decoration:none;font-weight:600">(332) 277-0990</a> · 
        <a href="mailto:contact@sanibuildingcorp.com" style="color:#b8930a;text-decoration:none;font-weight:600">contact@sanibuildingcorp.com</a>
      </div>
    </div>
  </div>
</div>
</body></html>`;

  return await sendResend(resendKey, {
    from: "Sani Building Corp <onboarding@resend.dev>",
    to: [recipient],
    reply_to: contractorEmail,
    subject: `${prefix}✍️ Sign Your Service Agreement · ${booking.ref}`,
    html: html
  });
}

// ════════════════════════════════════════════════════════════════════
// HELPER: Supabase REST API call
// ════════════════════════════════════════════════════════════════════
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

function esc(t) {
  if (t == null) return "";
  return String(t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
