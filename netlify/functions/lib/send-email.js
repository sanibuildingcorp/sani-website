// netlify/functions/lib/send-email.js
//
// One email out through Resend. The functions that send to customers keep
// their own copies with the Gmail fallback; this is for the alerts to him.

"use strict";

const https = require("https");

/**
 * @param {object} payload  { from, to: [..], reply_to, subject, html, text, headers }
 * @returns {Promise<string>} Resend's response body
 */
function sendResend(payload) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return Promise.reject(new Error("RESEND_API_KEY not set"));
  const data = JSON.stringify(payload);
  return new Promise(function (resolve, reject) {
    const req = https.request(
      { hostname: "api.resend.com", port: 443, path: "/emails", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), Authorization: "Bearer " + apiKey } },
      function (res) {
        const chunks = [];
        res.on("data", function (c) { chunks.push(c); });
        res.on("end", function () {
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

function esc(t) {
  return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

module.exports = { sendResend, esc };
