// netlify/functions/send-scope-link.js
//
// EMAIL THE SCOPE OF WORK LINK - THE PAGE WITH NO PRICES ON IT.
//
//   "sometimes the building management need to see scope of work before they
//    approve permission ... i need it for send just scope of work"
//
// CONTRACTOR ONLY. POST { ref, to }   header  x-sbc-key: <DASHBOARD_KEY>
//
//   to   one or more addresses, comma separated (the customer, a building
//        manager, a board). Defaults to the customer's email.
//
// Sends quote.html?ref=…&sow=1 - see lib/scope-only.js for what that page is
// allowed to carry. The email itself names no price either. Nothing about the
// estimate changes: not the status, not the sent version, not the thread.
// The send is noted on the record so he can see who was given the scope.

"use strict";

const https = require("https");
const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const ADDR = require("./lib/addresses");

const MAX_TO = 5;

function isValidEmail(e) {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

/* "a@x.com, b@y.com; c@z.com" -> ["a@x.com","b@y.com","c@z.com"] */
function parseRecipients(raw) {
  return String(raw == null ? "" : raw).split(/[,;\s]+/).map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean)
    .filter(function (s, i, a) { return a.indexOf(s) === i; });
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (_) { return json(400, { error: "Bad JSON" }); }
  const ref = String(body.ref || "").trim();
  if (!ref) return json(400, { error: "Missing ref" });

  try {
    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const record = await store.get(ref, { type: "json" });
    if (!record) return json(404, { error: "Estimate " + ref + " not found" });

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return json(500, { error: "RESEND_API_KEY not set" });

    const customer = record.customer || {};
    const est = record.estimate || {};
    const reqData = record.request || {};

    const recipients = parseRecipients(body.to != null && String(body.to).trim() ? body.to : customer.email);
    if (!recipients.length) return json(400, { error: "Enter an email address to send the scope to.", field: "to" });
    if (recipients.length > MAX_TO) return json(400, { error: "Up to " + MAX_TO + " addresses at a time." });
    const bad = recipients.filter(function (r) { return !isValidEmail(r); });
    if (bad.length) return json(400, { error: "Not an email address: " + bad.join(", "), field: "to" });

    const siteUrl = process.env.SITE_URL || "https://www.sanibuildingcorp.com";
    const url = siteUrl + "/quote.html?ref=" + encodeURIComponent(ref) + "&sow=1";
    const projectTitle = String(est.projectTitle || reqData.service || "the project").trim();
    const address = String(record.projectAddress || customer.address || "").trim();
    /* The title usually carries the address already ("Apartment Renovation —
       3855 Shore Pkwy, 1K"); do not say it twice. */
    const where = address && projectTitle.toLowerCase().indexOf(address.toLowerCase()) === -1 ? " at " + address : "";

    /* NO PRICE, ANYWHERE IN THIS EMAIL. It goes to people who must not see one. */
    const text =
      "Hello,\n\n" +
      "Here is the scope of work for " + projectTitle + where + ", prepared by Sani Building Corp.\n\n" +
      "It lists the work to be performed, what is and is not included, and the timeline. It contains no pricing.\n\n" +
      "View the scope of work:\n" + url + "\n\n" +
      "The page can be printed or saved as a PDF. If you have any questions about the work, reply to this email or call/text me at (332) 277-0990.\n\n" +
      "Best,\nZurabi\nSani Building Corp\nBrooklyn, NY · Fully insured\nwww.sanibuildingcorp.com";

    const html = "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head>" +
      "<body style=\"margin:0;padding:0;background:#f2efe9;font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.6\">" +
      "<div style=\"max-width:600px;margin:0 auto;padding:24px 16px\">" +
      "<div style=\"background:#0a1628;border-radius:14px 14px 0 0;padding:30px 28px;text-align:center\">" +
      "<div style=\"font-size:24px;font-weight:bold;letter-spacing:4px;color:#e0b84e\">SANI BUILDING CORP</div>" +
      "<div style=\"font-size:12px;letter-spacing:3px;color:#9aa6b4;margin-top:8px;text-transform:uppercase\">Scope of Work</div></div>" +
      "<div style=\"background:#ffffff;border-radius:0 0 14px 14px;padding:28px\">" +
      "<p style=\"font-size:16px;margin:0 0 16px;color:#0a1628\"><strong>Hello,</strong></p>" +
      "<p style=\"font-size:15px;margin:0 0 18px;color:#333\">Here is the scope of work for <strong>" + esc(projectTitle) + "</strong>" + esc(where) + ", prepared by Sani Building Corp.</p>" +
      "<p style=\"font-size:14.5px;margin:0 0 22px;color:#333\">It lists the work to be performed, what is and is not included, and the timeline. <strong>It contains no pricing.</strong></p>" +
      "<div style=\"text-align:center;margin:0 0 22px\"><a href=\"" + esc(url) + "\" style=\"display:inline-block;background:#1f7a52;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 34px;border-radius:9px\">View the scope of work &rarr;</a></div>" +
      "<p style=\"font-size:13px;color:#777;text-align:center;margin:0 0 22px;word-break:break-all\">" + esc(url) + "</p>" +
      "<p style=\"font-size:14.5px;margin:0 0 18px;color:#333\">The page can be printed or saved as a PDF. If you have any questions about the work, reply to this email or call/text me at <a href=\"tel:+13322770990\" style=\"color:#0a1628;font-weight:bold\">(332) 277-0990</a>.</p>" +
      "<p style=\"font-size:15px;margin:22px 0 2px;color:#0a1628\">Best,<br><strong>Zurabi</strong></p></div>" +
      "<div style=\"text-align:center;padding:20px 16px;font-size:12px;color:#8a8a8a;line-height:1.7\"><strong style=\"color:#555\">Sani Building Corp</strong> &middot; Brooklyn, NY<br>Fully insured<br><a href=\"https://www.sanibuildingcorp.com\" style=\"color:#8a8a8a\">www.sanibuildingcorp.com</a></div>" +
      "</div></body></html>";

    const mail = {
      from: ADDR.FROM_ZURABI,
      to: recipients,
      reply_to: ADDR.replyTo(),
      subject: "Scope of work — " + projectTitle.replace(/[<>]/g, "") + where.replace(/[<>]/g, ""),
      html: html,
      text: text,
      /* Its own thread: this is not the estimate conversation. */
      headers: { "X-Entity-Ref-ID": ref + "-sow" },
    };

    let provider = "resend";
    try {
      await sendResend(resendKey, mail);
    } catch (mailErr) {
      const canFallback = /^Resend 429:/.test(String(mailErr && mailErr.message || mailErr)) && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD;
      if (!canFallback) throw mailErr;
      await sendGmail(mail);
      provider = "gmail";
    }

    /* Noted, never a status change. */
    const at = new Date().toISOString();
    record.scopeLinkSends = (Array.isArray(record.scopeLinkSends) ? record.scopeLinkSends : []).concat([{ to: recipients, at: at }]).slice(-20);
    record.scopeLinkSentAt = at;
    await store.setJSON(ref, record);

    return json(200, { success: true, sentTo: recipients, url: url, provider: provider, at: at });
  } catch (err) {
    console.error("send-scope-link error:", err.message);
    return json(500, { error: err.message });
  }
};

function esc(t) {
  return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function sendResend(apiKey, payload) {
  const data = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: "api.resend.com", port: 443, path: "/emails", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), Authorization: "Bearer " + apiKey } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
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

function sendGmail(payload) {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("Gmail fallback credentials are not configured");
  /* Loaded only on the fallback path: it is a runtime dependency on Netlify,
     and the test harness must be able to load this file without it. */
  const nodemailer = require("nodemailer");
  const transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  return transporter.sendMail({ from: "Sani Building Corp <" + user + ">", to: payload.to, replyTo: payload.reply_to || user, subject: payload.subject, html: payload.html, text: payload.text, headers: payload.headers || {} });
}

function json(status, obj) {
  return { statusCode: status, headers: cors(), body: JSON.stringify(obj) };
}
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-sbc-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

exports._parseRecipients = parseRecipients;
