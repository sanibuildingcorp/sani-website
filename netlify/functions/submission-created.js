// netlify/functions/submission-created.js
// CUSTOMER CONFIRMATION FOR NETLIFY FORMS — v3 (Aug 2 2026)
//
// v3 changes vs v2:
//   • EVERY invocation now writes a breadcrumb row to Supabase lead_messages
//     BEFORE attempting the email (subject "DEBUG: ...") — so an empty table now
//     proves Netlify never triggered the function, while a breadcrumb without a
//     confirmation email isolates the failure to the Resend send.
//   • ALL Supabase writes now use https.request instead of global fetch — v2's
//     logging used fetch, which would fail silently on an older Node runtime.
//
// v2 changes vs v1:
//   • Resend send switched from global fetch() to https.request() — the exact pattern
//     used by handyman-submit.js and handyman-agreement.js, which are proven to deliver.
//   • Added TWO browser-openable diagnostic endpoints (see below) so a silent failure
//     can never happen again — same trick that debugged form-alert.js.
//   • Errors now surface in the response body instead of only in the function log.
//
// HOW IT FIRES NORMALLY: Netlify automatically invokes a function named exactly
// "submission-created" after every verified Netlify Forms submission. Covers both
// contact.html (form "estimate") and index.html (form "free-estimate").
// The handyman AI wizard sends its own confirmation and is untouched by this.
//
// DIAGNOSTICS (open in any browser, no form needed):
//   1) /.netlify/functions/submission-created?ping=1
//      -> JSON: is the function deployed, is RESEND_API_KEY visible, what Node version,
//         is CONTRACTOR_EMAIL set. If this 404s, the function is not deployed.
//   2) /.netlify/functions/submission-created?test=1&email=YOUR@EMAIL.COM
//      -> Sends a real sample confirmation to that address and returns Resend's
//         actual response. If this delivers but real submissions do not, the problem
//         is the Netlify Forms trigger, not this code or Resend.

const https = require("https");

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};

  // ── DIAGNOSTIC 1: is this thing even deployed? ──
  if (q.ping === "1") {
    return json(200, {
      ok: true,
      function: "submission-created",
      version: "v2 Aug 2 2026",
      node: process.version,
      hasResendKey: !!process.env.RESEND_API_KEY,
      contractorEmail: process.env.CONTRACTOR_EMAIL || "(not set — will fall back)",
      hasSupabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY),
    });
  }

  // ── DIAGNOSTIC 2: send a real sample confirmation, bypassing the form trigger ──
  if (q.test === "1") {
    const to = String(q.email || "").trim();
    if (!validEmail(to)) return json(400, { error: "Add &email=you@example.com to the URL" });
    const r = await sendConfirmation({
      email: to,
      fullName: "Test Customer",
      service: "Bathroom Renovation",
      area: "Brooklyn",
      address: "2954 Brighton 12th Street, Brooklyn NY",
      phone: "(332) 277-0990",
      details: "This is a test of the automatic customer confirmation email.",
      formName: "manual-test",
    });
    return json(r.ok ? 200 : 502, {
      sentTo: to,
      resendStatus: r.status,
      resendResponse: String(r.body || "").slice(0, 500),
      note: r.ok
        ? "Accepted by Resend. If it does not arrive, check spam and the Resend dashboard."
        : "Resend rejected it — the message above is the reason.",
    });
  }

  // ── NORMAL PATH: fired by Netlify after a form submission ──
  let payload;
  try {
    payload = (JSON.parse(event.body || "{}") || {}).payload || {};
  } catch {
    return json(200, { skipped: "unparseable body" });
  }

  const data = payload.data || {};
  const formName = payload.form_name || data["form-name"] || "form";

  // v3 BREADCRUMB: prove the trigger fired, before anything can fail.
  await supabasePost("lead_messages", {
    lead_email: String(data.email || "unknown@unknown").trim().toLowerCase() || "unknown@unknown",
    lead_name: "DEBUG",
    direction: "out",
    subject: "DEBUG: submission-created invoked",
    body: "form=" + formName + " at " + new Date().toISOString(),
  });

  if (String(data["bot-field"] || "").trim()) {
    return json(200, { skipped: "honeypot filled", form: formName });
  }

  const email = String(data.email || payload.email || "").trim().toLowerCase();
  if (!validEmail(email)) {
    return json(200, { skipped: "no valid customer email", form: formName });
  }

  // contact.html uses "name"; index.html uses first_name + last_name.
  const fullName =
    String(data.name || payload.name || "").trim() ||
    [data.first_name, data.last_name].filter(Boolean).join(" ").trim();

  // contact.html: service / message / borough. index.html: scope[] / details / home_type.
  const scope = data["scope[]"];
  const service =
    String(data.service || "").trim() ||
    (Array.isArray(scope) ? scope.join(", ") : String(scope || "").trim());

  const r = await sendConfirmation({
    email: email,
    fullName: fullName,
    service: service,
    area: String(data.borough || data.home_type || "").trim(),
    address: String(data.address || "").trim(),
    phone: String(data.phone || "").trim(),
    details: String(data.message || data.details || "").trim(),
    formName: formName,
  });

  if (!r.ok) {
    console.log("submission-created: Resend failed", r.status, String(r.body).slice(0, 300));
    return json(200, { sent: false, resendStatus: r.status, reason: String(r.body).slice(0, 300) });
  }

  // Log to the dashboard timeline — never fatal, the email is already out.
  const logRes = await supabasePost("lead_messages", {
    lead_email: email,
    lead_name: fullName || null,
    direction: "out",
    subject: "Request Received - Sani Building Corp",
    body: "Auto-confirmation sent for " + formName + " submission.",
  });

  return json(200, { sent: true, to: email, form: formName, logged: logRes.ok });
};

// ════════════════════════════════════════════════════════════════════
// Build + send the confirmation. Uses https.request — same proven path
// as handyman-submit.js / handyman-agreement.js.
// ════════════════════════════════════════════════════════════════════
async function sendConfirmation(o) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, status: 0, body: "RESEND_API_KEY not set in Netlify env" };

  const firstName = (o.fullName || "there").split(" ")[0];
  const rows = [
    o.service && ["Service", o.service],
    o.area && ["Property / Area", o.area],
    o.address && ["Address", o.address],
    o.phone && ["Phone", o.phone],
  ].filter(Boolean);

  const summary = rows.length
    ? '<div style="background:#faf8f4;border-radius:10px;padding:18px;margin:20px 0">' +
      '<div style="font-size:11px;letter-spacing:2px;color:#888;text-transform:uppercase;margin-bottom:10px">Your Request</div>' +
      '<div style="font-size:14px;color:#333;line-height:1.9">' +
      rows.map(function (r) { return "<strong>" + esc(r[0]) + ":</strong> " + esc(r[1]); }).join("<br>") +
      "</div></div>"
    : "";

  const notes = o.details
    ? '<div style="background:#fff8e8;border:1px solid #c9a84c;border-radius:8px;padding:14px 16px;margin:20px 0">' +
      '<div style="font-size:11px;color:#b8930a;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">What You Told Us</div>' +
      '<div style="font-size:14px;color:#444;line-height:1.6;white-space:pre-wrap">' + esc(o.details) + "</div></div>"
    : "";

  const html =
    '<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#f5f0e8;font-family:Arial,sans-serif;color:#333">' +
    '<div style="max-width:600px;margin:0 auto">' +
    '<div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#fff;padding:32px 24px;border-radius:12px 12px 0 0;text-align:center">' +
    '<div style="font-size:22px;letter-spacing:3px;color:#c9a84c;font-weight:700">SANI BUILDING CORP</div>' +
    '<div style="font-size:11px;letter-spacing:2px;color:#aaa;margin-top:6px">REQUEST RECEIVED</div></div>' +
    '<div style="background:#fff;padding:30px 28px;border:1px solid #e8e2d9;border-top:none;border-radius:0 0 12px 12px">' +
    '<h1 style="color:#0d1b2a;font-size:22px;margin:0 0 14px">Hi ' + esc(firstName) + ",</h1>" +
    '<p style="font-size:15px;color:#555;line-height:1.6">Thanks for reaching out to Sani Building Corp. Your request has landed with us and a real person from our Brooklyn office will get back to you within a few hours &mdash; often much sooner.</p>' +
    summary +
    notes +
    '<div style="background:#e8f5e8;border-left:4px solid #2ecc71;padding:16px 18px;margin:20px 0;border-radius:0 8px 8px 0">' +
    '<div style="font-size:11px;letter-spacing:2px;color:#666;text-transform:uppercase;margin-bottom:8px">What happens next</div>' +
    '<div style="font-size:14px;color:#333;line-height:1.9">' +
    "1. We review what you sent<br>2. We call or email with honest guidance on scope and timeline<br>3. You get a clear written estimate &mdash; free, detailed, no pressure" +
    "</div></div>" +
    '<p style="font-size:14px;color:#555;line-height:1.6">Photos help a lot. If you have any, just reply to this email and attach them &mdash; it usually gets you a sharper number faster.</p>' +
    '<p style="font-size:13px;color:#777;margin-top:20px">Need us sooner? Call <a href="tel:+13322770990" style="color:#b8930a;text-decoration:none;font-weight:600">(332) 277-0990</a>.</p>' +
    '<div style="margin-top:32px;padding-top:20px;border-top:1px solid #eee;text-align:center">' +
    '<div style="color:#888;font-size:11px;letter-spacing:2px;text-transform:uppercase">Sani Building Corp</div>' +
    '<div style="font-size:12px;color:#888;margin-top:4px">Fully Insured &middot; 4.9 &#9733; &middot; NYC Metro &middot; Since 2015</div>' +
    "</div></div></div></body></html>";

  const text =
    "Hi " + firstName + ",\n\n" +
    "Thanks for reaching out to Sani Building Corp. Your request has landed with us and a real person from our Brooklyn office will get back to you within a few hours.\n\n" +
    (rows.length ? rows.map(function (r) { return r[0] + ": " + r[1]; }).join("\n") + "\n\n" : "") +
    (o.details ? "What you told us:\n" + o.details + "\n\n" : "") +
    "What happens next:\n1. We review what you sent\n2. We call or email with honest guidance on scope and timeline\n3. You get a clear written estimate - free, detailed, no pressure\n\n" +
    "Photos help - reply to this email and attach them.\n\n" +
    "Need us sooner? Call (332) 277-0990.\n\n" +
    "- Sani Building Corp\nFully Insured | 4.9 stars | NYC Metro | Since 2015\nsanibuildingcorp.com";

  const contractorEmail = process.env.CONTRACTOR_EMAIL || "info@sanibuildingcorp.com";

  return postResend(key, {
    from: "Sani Building Corp <contact@sanibuildingcorp.com>",
    to: [o.email],
    bcc: [contractorEmail],
    reply_to: "contact@sanibuildingcorp.com",
    subject: "Request Received - Sani Building Corp",
    html: html,
    text: text,
  });
}

function postResend(apiKey, payload) {
  const body = JSON.stringify(payload);
  return new Promise(function (resolve) {
    const req = https.request(
      {
        hostname: "api.resend.com",
        port: 443,
        path: "/emails",
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      function (res) {
        let chunks = "";
        res.on("data", function (c) { chunks += c; });
        res.on("end", function () {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: chunks });
        });
      }
    );
    req.on("error", function (e) { resolve({ ok: false, status: 0, body: String(e) }); });
    req.setTimeout(9000, function () { req.destroy(); resolve({ ok: false, status: 0, body: "Resend timeout" }); });
    req.write(body);
    req.end();
  });
}

function supabasePost(path, row) {
  return new Promise(function (resolve) {
    const base = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!base || !key) return resolve({ ok: false, status: 0 });
    let host;
    try { host = new URL(base).hostname; } catch { return resolve({ ok: false, status: 0 }); }
    const body = JSON.stringify(row);
    const req = https.request(
      {
        hostname: host,
        port: 443,
        path: "/rest/v1/" + path,
        method: "POST",
        headers: {
          apikey: key,
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      function (res) {
        res.resume();
        res.on("end", function () {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode });
        });
      }
    );
    req.on("error", function () { resolve({ ok: false, status: 0 }); });
    req.setTimeout(8000, function () { req.destroy(); resolve({ ok: false, status: 0 }); });
    req.write(body);
    req.end();
  });
}

function validEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}

function json(code, obj) {
  return {
    statusCode: code,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj, null, 2),
  };
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
