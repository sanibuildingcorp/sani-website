// netlify/functions/thread-reply.js
//
// CONTRACTOR -> CUSTOMER, on the estimate's own thread.
//
// POST { ref, text }   header  x-sbc-key: <DASHBOARD_KEY>
//
// The dashboard reply box posts here. This is the PRIMARY path: it is the only
// one that is synchronous, that is guaranteed to land in the thread, and that
// the customer can see the moment they reload their link. The Gmail bridge in
// inbox-sync.js is the fallback for when he answers from his phone's mail app
// instead - which he will, and which is fine, it just arrives on the next sync.
//
// ORDER OF OPERATIONS MATTERS.
// Save the message first, email second, and report the two outcomes separately.
// A failed send must never lose a message that was already written down, and a
// saved message must never be reported as delivered when nothing went out. The
// dashboard shows "saved, but the email did not go" rather than a green tick.

"use strict";

const https = require("https");
const { getStore } = require("@netlify/blobs");
const thread = require("./lib/thread");
const buildMessageEmail = require("./lib/message-email");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

  const secret = process.env.DASHBOARD_KEY;
  if (!secret) return json(500, { error: "DASHBOARD_KEY is not set in Netlify. Set it, then redeploy." });
  const given = event.headers["x-sbc-key"] || event.headers["X-Sbc-Key"] || "";
  if (given !== secret) return json(401, { error: "Bad or missing dashboard key" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (_) { return json(400, { error: "Bad JSON" }); }

  const ref = String(body.ref || "").trim();
  const text = String(body.text || "").trim();
  if (!ref) return json(400, { error: "Missing ref" });
  if (!text) return json(400, { error: "Write a message first." });
  if (text.length > thread.MAX_MESSAGE_CHARS) {
    return json(400, { error: "Message is too long — keep it under " + thread.MAX_MESSAGE_CHARS + " characters." });
  }

  const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
  const record = await store.get(ref, { type: "json" });
  if (!record) return json(404, { error: "Estimate " + ref + " not found" });

  const previous = lastMessage(record);
  const result = thread.appendMessage(record, { from: "contractor", text: text, via: "dashboard" });
  if (!result.added) {
    return json(409, { error: "Message not added (" + result.reason + ")", thread: result.thread });
  }

  // ---- 1. WRITE IT DOWN ----
  record.thread = result.thread;
  record.threadUpdatedAt = result.message.at;
  record.lastContractorMessageAt = result.message.at;
  record.updatedAt = result.message.at;
  await store.setJSON(ref, record);

  // ---- 2. TELL THE CUSTOMER ----
  const customer = record.customer || {};
  const to = String(customer.email || "").trim();
  let notified = false;
  let notifyError = "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    notifyError = "No valid email on this customer — the message is saved on their quote page but nothing was sent.";
  } else if (!process.env.RESEND_API_KEY) {
    notifyError = "RESEND_API_KEY is not set — the message is saved but no email went out.";
  } else {
    const mail = buildMessageEmail({
      ref: ref, record: record, message: result.message, previous: previous, audience: "customer",
    });
    try {
      await sendResend(process.env.RESEND_API_KEY, {
        from: "Zurabi at Sani Building Corp <estimates@sanibuildingcorp.com>",
        to: [to],
        /* His own inbox gets a copy, so the Gmail thread he actually lives in
           stays complete even when he replied from the dashboard. */
        bcc: process.env.CONTRACTOR_EMAIL ? [process.env.CONTRACTOR_EMAIL] : undefined,
        reply_to: process.env.CONTRACTOR_EMAIL || undefined,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        headers: { "X-Entity-Ref-ID": ref },
      });
      notified = true;
      record.lastCustomerNotifiedAt = new Date().toISOString();
      try { await store.setJSON(ref, record); } catch (_) {}
    } catch (e) {
      notifyError = "Email failed: " + String((e && e.message) || e).slice(0, 200);
    }
  }

  return json(200, {
    ok: true,
    saved: true,
    notified: notified,
    error: notified ? undefined : notifyError,
    message: result.message,
    thread: result.thread,
  });
};

function lastMessage(record) {
  const t = thread.normalizeThread(record);
  return t.length ? t[t.length - 1] : null;
}

function sendResend(apiKey, payload) {
  const data = JSON.stringify(payload);
  return new Promise(function (resolve, reject) {
    const req = https.request(
      {
        hostname: "api.resend.com", port: 443, path: "/emails", method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          Authorization: "Bearer " + apiKey,
        },
      },
      function (res) {
        const chunks = [];
        res.on("data", function (c) { chunks.push(c); });
        res.on("end", function () {
          const b = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(b);
          else reject(new Error("Resend " + res.statusCode + ": " + b.slice(0, 300)));
        });
      }
    );
    req.setTimeout(8000, function () { req.destroy(new Error("Resend timed out")); });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-sbc-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
function json(code, obj) {
  return { statusCode: code, headers: cors(), body: JSON.stringify(obj) };
}
