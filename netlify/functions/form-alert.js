// ============================================================
//  form-alert.js  →  netlify/functions/form-alert.js
//  Sends Zura an instant email when someone STARTS or ABANDONS
//  the estimate form. Uses existing env vars:
//  RESEND_API_KEY, CONTRACTOR_EMAIL (fallback sanibuildingcorp@gmail.com)
// ============================================================
const https = require("https");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let data = {};
  try { data = JSON.parse(event.body || "{}"); } catch (e) { data = {}; }

  const type = data.type === "abandon" ? "abandon" : "start";
  const src = String(data.source || "direct").slice(0, 120);
  const step = parseInt(data.step, 10) || 1;
  const name = String(data.name || "").slice(0, 80);
  const phone = String(data.phone || "").slice(0, 40);
  const service = String(data.service || "").slice(0, 80);

  const resendKey = process.env.RESEND_API_KEY;
  const to = process.env.CONTRACTOR_EMAIL || "sanibuildingcorp@gmail.com";
  if (!resendKey) return { statusCode: 200, body: "no key" };

  const nyTime = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });

  const isStart = type === "start";
  const subject = isStart
    ? "\uD83D\uDFE2 Someone started the estimate form"
    : "\uD83D\uDFE1 Estimate form abandoned at step " + step;

  const rows = [];
  rows.push(row("Time", nyTime + " (NY)"));
  rows.push(row("Came from page", src));
  rows.push(row(isStart ? "Reached step" : "Quit at step", String(step) + " of 9"));
  if (service) rows.push(row("Service picked", service));
  if (name) rows.push(row("Name (partial lead!)", name));
  if (phone) rows.push(row("Phone (partial lead!)", phone));

  const html =
    '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">' +
    '<div style="background:#0a1628;padding:18px 22px;border-radius:10px 10px 0 0">' +
    '<span style="color:#f0a500;font-size:16px;font-weight:bold">Sani Building Corp — Live Form Alert</span></div>' +
    '<div style="border:1px solid #e5e5e5;border-top:0;border-radius:0 0 10px 10px;padding:20px 22px">' +
    '<p style="font-size:15px;margin:0 0 14px"><strong>' +
    (isStart ? "A visitor just started filling the free-estimate form." :
      "A visitor left the estimate form without finishing.") +
    "</strong></p><table style=\"font-size:14px;border-collapse:collapse;width:100%\">" +
    rows.join("") + "</table>" +
    (phone ? '<p style="margin:16px 0 0;font-size:14px;color:#2d8a2d"><strong>They left a phone number — call them back!</strong></p>' : "") +
    '<p style="margin:16px 0 0;font-size:12px;color:#999">Automatic alert from sanibuildingcorp.com/estimate</p>' +
    "</div></div>";

  function row(k, v) {
    return '<tr><td style="padding:5px 10px 5px 0;color:#777;white-space:nowrap">' + k +
      '</td><td style="padding:5px 0;color:#0a1628"><strong>' + esc(v) + "</strong></td></tr>";
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  try {
    await sendResend(resendKey, {
      from: "Sani Building Corp <estimates@sanibuildingcorp.com>",
      to: [to],
      subject: subject,
      html: html,
    });
  } catch (e) {
    console.error("form-alert email failed:", e.message);
  }
  return { statusCode: 200, body: "ok" };
};

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
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
          else reject(new Error("Resend " + res.statusCode + ": " + body));
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}
