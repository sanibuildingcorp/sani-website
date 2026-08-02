// netlify/functions/send-reply.js
// SEND A REPLY FROM THE DASHBOARD (v2 — Aug 2 2026)
// POST { email, name?, subject, body }  with header  x-sbc-key: <DASHBOARD_KEY>
//  1. Auth: header must match process.env.DASHBOARD_KEY (set in Netlify env) — blocks open-relay abuse.
//  2. Sends via Resend from contact@sanibuildingcorp.com (customer-facing address; Workspace alias of
//     info@, so replies land in the one inbox), BCC to CONTRACTOR_EMAIL (Gmail receipt).
//  3. Logs the message to Supabase lead_messages so it appears in the customer's dashboard history forever.

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers: cors(), body: JSON.stringify({ error: "Method Not Allowed" }) };

  const secret = process.env.DASHBOARD_KEY;
  if (!secret) return err(500, "DASHBOARD_KEY env var not set in Netlify");
  const given = event.headers["x-sbc-key"] || event.headers["X-Sbc-Key"] || "";
  if (given !== secret) return err(401, "Bad or missing dashboard key");

  let p;
  try { p = JSON.parse(event.body || "{}"); } catch { return err(400, "Bad JSON"); }
  const email = String(p.email || "").trim().toLowerCase();
  const name = String(p.name || "").trim().slice(0, 120);
  const subject = String(p.subject || "Sani Building Corp").trim().slice(0, 200);
  const body = String(p.body || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err(400, "Invalid recipient email");
  if (!body) return err(400, "Empty message");
  if (body.length > 8000) return err(400, "Message too long");

  // ── 1. Send via Resend ──
  const bcc = process.env.CONTRACTOR_EMAIL ? [process.env.CONTRACTOR_EMAIL] : undefined;
  const html =
    '<div style="font-family:Georgia,serif;max-width:640px;margin:0 auto;color:#1c2733">' +
    '<div style="background:#0d1b2a;padding:22px 28px;border-top:3px solid #b8930a">' +
    '<span style="color:#b8930a;font-size:18px;letter-spacing:4px;font-family:Arial,sans-serif;font-weight:bold">SANI BUILDING CORP</span></div>' +
    '<div style="padding:26px 28px;background:#fdfcf9;border:1px solid #eee;border-top:none">' +
    (name ? "<p style=\"margin:0 0 14px\">Hi " + escapeHtml(name.split(" ")[0]) + ",</p>" : "") +
    '<div style="white-space:pre-wrap;line-height:1.65;font-size:15px">' + escapeHtml(body) + "</div>" +
    '<p style="margin:22px 0 0;line-height:1.5;font-size:14px">— Sani Building Corp<br>' +
    '<a href="tel:+13322770990" style="color:#96770a;text-decoration:none">(332) 277-0990</a> · ' +
    '<a href="https://www.sanibuildingcorp.com" style="color:#96770a;text-decoration:none">sanibuildingcorp.com</a></p>' +
    "</div></div>";

  const sendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Sani Building Corp <contact@sanibuildingcorp.com>",
      to: [email],
      bcc: bcc,
      reply_to: "contact@sanibuildingcorp.com",
      subject: subject,
      html: html,
      text: (name ? "Hi " + name.split(" ")[0] + ",\n\n" : "") + body + "\n\n— Sani Building Corp\n(332) 277-0990 · sanibuildingcorp.com",
    }),
  });
  if (!sendRes.ok) {
    const t = await sendRes.text().catch(() => "");
    return err(502, "Resend failed: " + t.slice(0, 200));
  }

  // ── 2. Log to history (non-fatal if it fails — the email already went) ──
  let logged = true;
  try {
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
    const r = await fetch(url + "/rest/v1/lead_messages", {
      method: "POST",
      headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ lead_email: email, lead_name: name || null, direction: "out", subject: subject, body: body }),
    });
    if (!r.ok) logged = false;
  } catch { logged = false; }

  return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true, logged: logged }) };
};

function err(code, msg) { return { statusCode: code, headers: cors(), body: JSON.stringify({ error: msg }) }; }
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-sbc-key",
    "Content-Type": "application/json",
  };
}
