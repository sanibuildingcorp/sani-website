// netlify/functions/lib/claude.js
//
// One non-streamed call to Claude, for the background jobs that write a
// whole answer and store it (the inbox digest, the follow-up alert). The
// streamed call with a deadline lives in assistant.js, where the clock is.

"use strict";

const https = require("https");

/**
 * @param {string} apiKey
 * @param {object} payload   the /v1/messages body (model, max_tokens, system, messages, ...)
 * @param {number} [timeoutMs]
 * @returns {Promise<object>} the message object
 */
function messages(apiKey, payload, timeoutMs) {
  /* No hidden reasoning unless the caller asks for it: the budget is for
     the answer (see assistant.js for why). */
  const body = Object.assign({ thinking: { type: "disabled" } }, payload);
  const data = JSON.stringify(body);
  return new Promise(function (resolve, reject) {
    const req = https.request(
      { hostname: "api.anthropic.com", port: 443, path: "/v1/messages", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), "x-api-key": apiKey, "anthropic-version": "2023-06-01" } },
      function (res) {
        const chunks = [];
        res.on("data", function (c) { chunks.push(c); });
        res.on("end", function () {
          const raw = Buffer.concat(chunks).toString("utf8");
          let j = null;
          try { j = JSON.parse(raw); } catch (e) { j = null; }
          if (!j) return reject(new Error("Claude answered with something that is not JSON (HTTP " + res.statusCode + ")"));
          if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error((j.error && j.error.message) || ("Claude returned " + res.statusCode)));
          resolve(j);
        });
      }
    );
    req.setTimeout(timeoutMs || 120000, function () { req.destroy(new Error("Claude took too long")); });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

/* The text blocks of a message, joined. */
function textOf(msg) {
  return (Array.isArray(msg && msg.content) ? msg.content : [])
    .filter(function (b) { return b && b.type === "text" && typeof b.text === "string"; })
    .map(function (b) { return b.text; }).join("").trim();
}

/* JSON the model was asked for, even when it wrapped it in prose or fences. */
function jsonOf(text) {
  const t = String(text || "");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  const candidates = [fenced ? fenced[1] : "", t, t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)];
  for (let i = 0; i < candidates.length; i++) {
    const c = String(candidates[i] || "").trim();
    if (!c) continue;
    try { const v = JSON.parse(c); if (v && typeof v === "object") return v; } catch (e) { /* next */ }
  }
  return null;
}

module.exports = { messages, textOf, jsonOf };
