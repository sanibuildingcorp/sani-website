// netlify/functions/handyman-submit.js
// FIXED VERSION - May 24, 2026
// Bug fixed: Added missing "apikey" header to Supabase Storage uploads.
// Also added detailed console logging so future bugs are easier to debug.
//
// Usage: POST {
//   customer: { name, phone, email, address },
//   service: "painting-touchups",
//   serviceName: "Painting Touch-Ups",
//   urgency: "today",
//   answers: {...},
//   description: "...",
//   photos: [base64_1, base64_2, ...],
//   aiResult: { estimate, internalBrief, confidence }
// }

const https = require("https");
const ADDR = require("./lib/addresses");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { customer, service, serviceName, urgency, answers, description, photos, aiResult, preferredDate, preferredTime } = body;

    console.log("=== handyman-submit START ===");
    console.log("Customer:", customer && customer.name);
    console.log("Service:", service);
    console.log("Photos received from form:", Array.isArray(photos) ? photos.length : 0);

    if (!customer || !customer.name || !customer.phone || !customer.email) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing customer info" }) };
    }
    if (!service) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing service" }) };
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "Supabase env vars not set" }) };
    }
    console.log("Supabase URL:", supabaseUrl);
    console.log("Supabase key length:", supabaseKey.length, "starts with:", supabaseKey.slice(0, 10));

    // Generate booking ref
    const ref = generateRef();
    console.log("Generated ref:", ref);

    // 1. Upload photos to Supabase Storage
    const photoUrls = [];
    if (Array.isArray(photos) && photos.length > 0) {
      console.log(`Uploading ${photos.length} photos to Supabase Storage...`);
      for (let i = 0; i < photos.length; i++) {
        try {
          console.log(`  → Photo ${i + 1}/${photos.length} — base64 length: ${photos[i] ? photos[i].length : 0}`);
          const url = await uploadPhoto(supabaseUrl, supabaseKey, ref, i, photos[i]);
          if (url) {
            console.log(`  ✓ Photo ${i + 1} uploaded: ${url}`);
            photoUrls.push(url);
          } else {
            console.log(`  ✗ Photo ${i + 1} returned null URL`);
          }
        } catch (e) {
          console.error(`  ✗ Photo ${i + 1} upload FAILED:`, e.message);
        }
      }
      console.log(`Photo upload summary: ${photoUrls.length}/${photos.length} succeeded`);
    } else {
      console.log("No photos to upload (photos array empty or missing)");
    }

    // 2. Build the booking record
    const est = (aiResult && aiResult.estimate) || {};
    const brief = (aiResult && aiResult.internalBrief) || {};
    const conf = (aiResult && aiResult.confidence) || {};

    const booking = {
      ref: ref,
      customer_name: customer.name,
      customer_phone: customer.phone,
      customer_email: customer.email,
      customer_address: customer.address || "",
      service_id: service,
      service_name: serviceName || service,
      urgency: urgency || "flexible",
      preferred_date: preferredDate || null,
      preferred_time: preferredTime || null,
      answers: answers || {},
      customer_description: description || "",
      photo_urls: photoUrls,

      // Customer-facing AI estimate
      estimated_time_min: est.estimatedTimeMin || null,
      estimated_time_max: est.estimatedTimeMax || null,
      estimated_labor_min: est.estimatedLaborMin || null,
      estimated_labor_max: est.estimatedLaborMax || null,
      estimated_material_min: est.estimatedMaterialMin || null,
      estimated_material_max: est.estimatedMaterialMax || null,
      deposit_amount: est.depositAmount || 0,
      deposit_required: !!est.depositRequired,
      customer_notes: est.customerNotes || "",

      // Internal brief
      job_summary: brief.jobSummary || "",
      tools_checklist: brief.toolsChecklist || [],
      materials_checklist: brief.materialsChecklist || [],
      special_order_flag: !!brief.specialOrderFlag,
      special_order_items: brief.specialOrderItems || [],
      warnings: brief.warnings || [],

      // Confidence
      confidence_score: conf.score || 50,
      confidence_label: conf.label || "maybe",

      status: "new"
    };

    // 3. Save to Supabase
    console.log("Saving booking to Supabase with photo_urls.length =", photoUrls.length);
    const saved = await supabaseRequest(supabaseUrl, supabaseKey, "POST", "/rest/v1/bookings", booking);
    console.log("✓ Booking saved");

    // 4. Save raw AI response for debugging
    if (aiResult && aiResult.rawResponse) {
      try {
        await supabaseRequest(supabaseUrl, supabaseKey, "POST", "/rest/v1/ai_analyses", {
          booking_ref: ref,
          model: (aiResult.meta && aiResult.meta.model) || process.env.MINI_MODEL || "gpt-5-mini",
          prompt_version: "v1.0",
          raw_response: aiResult.rawResponse,
          prompt_tokens: (aiResult.meta && aiResult.meta.promptTokens) || null,
          completion_tokens: (aiResult.meta && aiResult.meta.completionTokens) || null,
          duration_ms: (aiResult.meta && aiResult.meta.durationMs) || null
        });
      } catch (e) {
        console.error("Failed to save ai_analysis:", e.message);
      }
    }

    // 5. Send emails (don't fail if email fails)
    const emailResults = { contractor: false, customer: false };
    try {
      await sendContractorEmail(booking, photoUrls);
      emailResults.contractor = true;
    } catch (e) {
      console.error("Contractor email failed:", e.message);
    }

    try {
      await sendCustomerEmail(booking);
      emailResults.customer = true;
    } catch (e) {
      console.error("Customer email failed:", e.message);
    }

    console.log("=== handyman-submit DONE ===");

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({
        success: true,
        ref: ref,
        photoCount: photoUrls.length,
        emails: emailResults
      })
    };
  } catch (err) {
    console.error("handyman-submit error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

// ════════════════════════════════════════════════════════════════════
// HELPER: Generate unique booking ref
// e.g. SBC-H-260524-7K9X
// ════════════════════════════════════════════════════════════════════
function generateRef() {
  const d = new Date();
  const datePart = String(d.getFullYear()).slice(2) +
                   String(d.getMonth() + 1).padStart(2, "0") +
                   String(d.getDate()).padStart(2, "0");
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return `SBC-H-${datePart}-${suffix}`;
}

// ════════════════════════════════════════════════════════════════════
// HELPER: Upload photo to Supabase Storage
// FIXED: Now sends BOTH "apikey" and "Authorization" headers.
// The Supabase Storage REST API requires both, even with the new
// sb_secret_ key format. Missing apikey caused silent 401 failures.
// ════════════════════════════════════════════════════════════════════
async function uploadPhoto(supabaseUrl, supabaseKey, ref, index, base64Data) {
  if (!base64Data) {
    throw new Error("No base64 data provided");
  }

  // Strip data URI prefix if present (e.g. "data:image/jpeg;base64,...")
  const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(cleanBase64, "base64");

  if (buffer.length === 0) {
    throw new Error("Buffer is empty after base64 decode");
  }

  const path = `${ref}/photo-${index + 1}.jpg`;
  const uploadUrl = `${supabaseUrl}/storage/v1/object/handyman-photos/${path}`;

  return new Promise(function(resolve, reject) {
    const u = new URL(uploadUrl);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: "POST",
      headers: {
        // THE FIX: BOTH headers are required by Supabase Storage REST API
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "image/jpeg",
        "Content-Length": buffer.length,
        "x-upsert": "true",
        "cache-control": "3600"
      }
    }, function(res) {
      const chunks = [];
      res.on("data", function(c) { chunks.push(c); });
      res.on("end", function() {
        const respBody = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // Public URL pattern
          const publicUrl = `${supabaseUrl}/storage/v1/object/public/handyman-photos/${path}`;
          resolve(publicUrl);
        } else {
          reject(new Error(`Upload ${res.statusCode}: ${respBody.slice(0, 300)}`));
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

// ════════════════════════════════════════════════════════════════════
// HELPER: Send contractor email
// ════════════════════════════════════════════════════════════════════
async function sendContractorEmail(booking, photoUrls) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) throw new Error("RESEND_API_KEY not set");

  const contractorEmail = ADDR.alertsTo();

  const confidenceColor = booking.confidence_score >= 80 ? "#2ecc71"
                        : booking.confidence_score >= 50 ? "#d4a017" : "#e74c3c";
  const confidenceText = booking.confidence_label === "ready" ? "READY TO BOOK"
                       : booking.confidence_label === "maybe" ? "REVIEW NEEDED" : "INSPECTION RECOMMENDED";

  const photosHtml = photoUrls.length > 0
    ? `<div style="margin:20px 0"><div style="font-size:12px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">📸 Customer Photos</div>` +
      photoUrls.map(function(url) { return `<img src="${url}" style="max-width:200px;margin:4px;border-radius:8px;border:1px solid #ddd">`; }).join("") +
      `</div>`
    : "";

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#f5f0e8;font-family:Arial,sans-serif;color:#333">
<div style="max-width:680px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:11px;letter-spacing:3px;color:#c9a84c;margin-bottom:6px">🔧 HANDYMAN BOOKING</div>
    <div style="font-size:20px;color:#fff">${esc(booking.service_name)}</div>
    <div style="font-size:13px;color:#aaa;margin-top:4px">${esc(booking.ref)}</div>
  </div>

  <div style="background:#fff;padding:28px;border:1px solid #e8e2d9;border-top:none;border-radius:0 0 12px 12px">

    <!-- CONFIDENCE BADGE -->
    <div style="text-align:center;margin-bottom:24px">
      <div style="display:inline-block;background:${confidenceColor};color:#fff;padding:8px 18px;border-radius:20px;font-weight:700;font-size:13px;letter-spacing:1px">
        ${booking.confidence_score}% · ${confidenceText}
      </div>
    </div>

    <!-- CUSTOMER -->
    <div style="background:#faf8f4;border-radius:10px;padding:18px;margin-bottom:20px">
      <div style="font-size:11px;letter-spacing:2px;color:#888;text-transform:uppercase;margin-bottom:10px">👤 Customer</div>
      <div style="font-size:15px;font-weight:600;color:#1a1a1a">${esc(booking.customer_name)}</div>
      <div style="font-size:13px;color:#555;margin-top:4px">📞 <a href="tel:${esc(booking.customer_phone)}" style="color:#b8930a;text-decoration:none">${esc(booking.customer_phone)}</a></div>
      <div style="font-size:13px;color:#555;margin-top:2px">✉️ <a href="mailto:${esc(booking.customer_email)}" style="color:#b8930a;text-decoration:none">${esc(booking.customer_email)}</a></div>
      <div style="font-size:13px;color:#555;margin-top:2px">📍 ${esc(booking.customer_address)}</div>
      <div style="font-size:13px;color:#555;margin-top:6px">⏰ How soon: <strong>${esc(urgencyWords(booking.urgency))}</strong></div>
    </div>

    ${jobBriefHtml(booking.answers)}

    <!-- CUSTOMER ESTIMATE -->
    <div style="background:#e8f5e8;border-left:4px solid #2ecc71;border-radius:0 8px 8px 0;padding:16px;margin-bottom:20px">
      <div style="font-size:11px;letter-spacing:2px;color:#666;text-transform:uppercase;margin-bottom:8px">💰 Customer Estimate</div>
      <div style="font-size:14px;color:#333;line-height:1.7">
        ⏱ Time: <strong>${booking.estimated_time_min}-${booking.estimated_time_max} hours</strong><br>
        💵 Labor: <strong>$${booking.estimated_labor_min}-$${booking.estimated_labor_max}</strong><br>
        🔧 Materials: <strong>$${booking.estimated_material_min}-$${booking.estimated_material_max}</strong>
        ${booking.deposit_required ? `<br>💳 Deposit: <strong>$${booking.deposit_amount}</strong>` : ""}
      </div>
    </div>

    <!-- INTERNAL BRIEF -->
    <div style="background:#fff8e8;border:2px solid #c9a84c;border-radius:10px;padding:18px;margin-bottom:20px">
      <div style="font-size:11px;letter-spacing:2px;color:#b8930a;text-transform:uppercase;margin-bottom:12px;font-weight:700">🧠 INTERNAL BRIEF — FOR YOU ONLY</div>

      <div style="font-size:13px;color:#444;line-height:1.6;margin-bottom:14px">
        <strong>Job Summary:</strong><br>${esc(booking.job_summary)}
      </div>

      <div style="font-size:12px;color:#666;margin-bottom:8px"><strong>🧰 TOOLS TO BRING:</strong></div>
      <div style="font-size:13px;color:#333;margin-bottom:14px">
        ${booking.tools_checklist.map(function(t) { return `☐ ${esc(t)}`; }).join("<br>")}
      </div>

      <div style="font-size:12px;color:#666;margin-bottom:8px"><strong>📦 MATERIALS TO BRING:</strong></div>
      <div style="font-size:13px;color:#333;margin-bottom:14px">
        ${booking.materials_checklist.map(function(m) { return `☐ ${esc(m)}`; }).join("<br>")}
      </div>

      ${booking.special_order_flag ? `
        <div style="background:#fee;border:1px solid #e74c3c;border-radius:6px;padding:10px;margin-bottom:14px">
          <div style="font-size:12px;color:#c0392b;font-weight:700;margin-bottom:4px">🚨 SPECIAL ORDER NEEDED:</div>
          <div style="font-size:13px;color:#444">${booking.special_order_items.map(esc).join("<br>")}</div>
        </div>
      ` : ""}

      ${booking.warnings.length > 0 ? `
        <div style="background:#fef3e0;border:1px solid #d4a017;border-radius:6px;padding:10px">
          <div style="font-size:12px;color:#a07a14;font-weight:700;margin-bottom:6px">⚠️ WARNINGS:</div>
          <div style="font-size:13px;color:#444;line-height:1.5">${booking.warnings.map(function(w) { return `• ${esc(w)}`; }).join("<br>")}</div>
        </div>
      ` : ""}
    </div>

    <!-- CUSTOMER DESCRIPTION -->
    ${booking.customer_description ? `
      <div style="background:#fafafa;border-left:3px solid #ccc;padding:14px 16px;margin-bottom:20px">
        <div style="font-size:11px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">📝 Customer Description</div>
        <div style="font-size:13px;color:#444;line-height:1.6;white-space:pre-wrap">${esc(booking.customer_description)}</div>
      </div>
    ` : ""}

    ${photosHtml}

    <!-- ACTION BUTTONS -->
    <div style="text-align:center;margin-top:24px;padding-top:20px;border-top:1px solid #eee">
      <a href="tel:${esc(booking.customer_phone)}" style="display:inline-block;background:#c9a84c;color:#0d1b2a;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin:4px">📞 Call Customer</a>
      <a href="https://${getDashboardDomain()}/dashboard.html" style="display:inline-block;background:#0d1b2a;color:#c9a84c;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin:4px">📊 Open Dashboard</a>
    </div>

  </div>
</div>
</body></html>`;

  await sendResend(resendKey, {
    from: ADDR.FROM_SYSTEM,
    to: [contractorEmail],
    reply_to: booking.customer_email,
    subject: `🔧 NEW HANDYMAN: ${booking.service_name} · ${booking.confidence_label.toUpperCase()} · ${booking.customer_name}`,
    html: html
  });
}

// ════════════════════════════════════════════════════════════════════
// HELPER: Send customer confirmation email
// ════════════════════════════════════════════════════════════════════
async function sendCustomerEmail(booking) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) throw new Error("RESEND_API_KEY not set");

  const contractorEmail = ADDR.alertsTo();

  // Send DIRECTLY to the customer from the verified domain (estimates@sanibuildingcorp.com);
  // contractor gets a BCC copy. Guard against a missing/mistyped customer email.
  const custEmail = (booking.customer_email || "").trim();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(custEmail);
  if (!validEmail) throw new Error("Customer email missing or invalid: " + (custEmail || "(empty)"));
  const recipient = custEmail;

  const firstName = (booking.customer_name || "there").split(" ")[0];

  /* THE CUSTOMER'S CONFIRMATION. "Yes go do all":
     1. the AI's own note is NOT sent - it promised "we can come today" and a
        "$100 deposit" the owner never approved; it is kept on the booking
        (customer_notes) and shown in the dashboard as a suggestion;
     2. urgency in plain words, not "emergency-today";
     3. the customer's job list, not only the first service;
     4. the calm natural look, no "analyzed by our AI" check marks. */
  const a = booking.answers || {};
  const list = Array.isArray(a.job_list) && a.job_list.length ? a.job_list : [booking.service_name];
  const rows = [["Reference", booking.ref], ["How soon", urgencyWords(booking.urgency)], ["Place", a.place],
    ["Preferred", [prettyDate(booking.preferred_date), booking.preferred_time].filter(Boolean).join(" · ")]]
    .filter(function (r) { return r[1]; });
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#faf8f4;font-family:'Source Sans 3',Helvetica,Arial,sans-serif;color:#1f1d1a">
<div style="max-width:600px;margin:0 auto">
  <div style="background:#f3eee5;border:1px solid #e4ddd0;border-radius:16px 16px 0 0;padding:26px 28px 22px">
    <div style="font-size:17px;font-weight:800;color:#1f1d1a">Sani Building Corp</div>
    <div style="font-size:12px;letter-spacing:2px;color:#a8762a;font-weight:700;text-transform:uppercase;margin-top:4px">Request received</div>
  </div>
  <div style="background:#ffffff;border:1px solid #e4ddd0;border-top:none;border-radius:0 0 16px 16px;padding:28px">
    <h1 style="font-size:24px;margin:0 0 10px;color:#1f1d1a">Hi ${esc(firstName)},</h1>
    <p style="font-size:16px;color:#57524b;line-height:1.6;margin:0">Thank you for your request. We have your job list, and we're preparing your flat-rate quote.</p>

    <div style="background:#faf8f4;border:1px solid #e4ddd0;border-radius:12px;padding:18px 20px;margin:22px 0">
      <div style="font-size:12px;letter-spacing:2px;color:#7a746b;text-transform:uppercase;margin-bottom:8px">Your job list</div>
      <ol style="margin:0 0 12px 20px;padding:0;font-size:16px;line-height:1.7;color:#1f1d1a">${list.map(function (l) { return `<li>${esc(l)}</li>`; }).join("")}</ol>
      ${rows.map(function (r) { return `<div style="font-size:15px;color:#57524b;line-height:1.8"><strong style="color:#1f1d1a">${r[0]}:</strong> ${esc(r[1])}</div>`; }).join("")}
    </div>

    <div style="font-size:12px;letter-spacing:2px;color:#7a746b;text-transform:uppercase;margin-bottom:8px">What happens next</div>
    <div style="font-size:16px;color:#57524b;line-height:1.7">
      <strong style="color:#1f1d1a">1.</strong> We review your list and photos.<br>
      <strong style="color:#1f1d1a">2.</strong> You get a flat-rate quote by email. You approve the price before we start.<br>
      <strong style="color:#1f1d1a">3.</strong> We call to schedule.
    </div>

    <p style="font-size:15px;color:#57524b;margin-top:24px">Questions? Reply to this email or call <a href="tel:+13322770990" style="color:#1f1d1a;text-decoration:none;font-weight:700">(332) 277-0990</a>.</p>

    <div style="margin-top:28px;padding-top:18px;border-top:1px solid #e4ddd0;text-align:center;font-size:13px;color:#7a746b">
      Sani Building Corp · Fully insured · 4.9 ★ on Google · NYC Metro
    </div>
  </div>
</div>
</body></html>`;

  await sendResend(resendKey, {
    from: "Sani Building Corp <estimates@sanibuildingcorp.com>",
    to: [recipient],
    bcc: [contractorEmail],
    reply_to: ADDR.replyTo(),
    subject: `Request received · ${booking.ref}`,
    html: html
  });
}

/* THE JOB AT A GLANCE. The form now asks the job list, how many things, the
   place, floor and access, the parts and how soon on one page; they arrive in
   answers and are shown here first, the same as in the dashboard. */
function jobBriefHtml(a) {
  a = a || {};
  const list = Array.isArray(a.job_list) ? a.job_list : [];
  const rows = [["Size", a.job_size], ["Place", a.place], ["Floor / access", a.access], ["Parts", a.parts], ["How soon", a.when]]
    .filter(function (r) { return r[1]; });
  if (!list.length && !rows.length) return "";
  return `<div style="background:#faf8f4;border:1px solid #e4ddd0;border-radius:10px;padding:18px;margin-bottom:20px">
      <div style="font-size:11px;letter-spacing:2px;color:#888;text-transform:uppercase;margin-bottom:10px">📋 Job at a glance</div>
      ${list.length ? `<ol style="margin:0 0 10px 18px;padding:0;font-size:14px;color:#1f1d1a;line-height:1.7">${list.map(function (l) { return `<li>${esc(l)}</li>`; }).join("")}</ol>` : ""}
      ${a.list_in_own_words ? `<div style="font-size:13px;color:#444;white-space:pre-wrap;margin-bottom:10px">"${esc(a.list_in_own_words)}"</div>` : ""}
      ${rows.map(function (r) { return `<div style="font-size:13px;color:#555;line-height:1.7"><strong>${r[0]}:</strong> ${esc(r[1])}</div>`; }).join("")}
    </div>`;
}

/* "emergency-today" -> "Emergency today" */
function urgencyWords(u) {
  const s = String(u || "").replace(/[-_]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

/* "2026-09-26" -> "Sat, Sep 26" */
function prettyDate(d) {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return d || "";
  const t = new Date(d + "T12:00:00Z");
  return t.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
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

function getDashboardDomain() {
  // This is approximate - just for the email link
  return "velvety-horse-2aa6e3.netlify.app";
}

function esc(t) {
  if (t == null) return "";
  return String(t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
