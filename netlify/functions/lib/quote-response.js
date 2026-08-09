// netlify/functions/quote-response.js
// Customer clicks Accept or Decline on quote.html.
// Updates status in Blobs, emails contractor with the news.

const https = require("https");
const { getStore } = require("@netlify/blobs");
const customerTotals = require("./lib/customer-total");
const thread = require("./lib/thread");
const buildMessageEmail = require("./lib/message-email");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  try {
    const { ref, action, signature, declineReason, questionText, finishSelections, materialsSelections, finalTotal } = JSON.parse(event.body);
    if (!ref || !action) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing ref or action" }) };
    }
    if (action !== "accept" && action !== "decline" && action !== "review" && action !== "question") {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Invalid action" }) };
    }

    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const record = await store.get(ref, { type: "json" });
    if (!record) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "Not found" }) };
    }

    let threadOut = thread.normalizeThread(record);
    let newMessage = null;
    let previousMessage = null;

    if (action === "accept") {
      record.status = "accepted";
      record.acceptedAt = new Date().toISOString();
      record.signature = signature || "";
      if (finishSelections) record.customerSelections = finishSelections;
      if (materialsSelections) record.customerMaterialSelections = materialsSelections;
      if (finalTotal != null) record.customerFinalTotal = finalTotal;
    } else if (action === "review") {
      record.status = "review_requested";
      record.reviewRequestedAt = new Date().toISOString();
      if (finishSelections) record.customerSelections = finishSelections;
      if (materialsSelections) record.customerMaterialSelections = materialsSelections;
      if (finalTotal != null) record.customerFinalTotal = finalTotal;
    } else if (action === "question") {
      /* THE THREAD IS APPEND-ONLY.
         record.customerQuestion was one string, rewritten on every question, so
         asking a second thing destroyed the first - and the customer saw no trace
         of either. It is still written below because the old read path has not
         been removed yet; lib/thread.js migrates it into message zero for any
         record that predates the thread. Do not drop it until nothing reads it. */
      const text = String(questionText || "").trim();
      if (!text) {
        return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Write a message first." }) };
      }
      if (text.length > thread.MAX_MESSAGE_CHARS) {
        return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Message is too long — keep it under " + thread.MAX_MESSAGE_CHARS + " characters." }) };
      }
      /* Public endpoint, guessable ref. A burst limit counted on the record needs
         no shared store and cannot be bypassed by rotating IPs. It is a floor,
         not the missing auth - that is still outstanding. */
      const rate = thread.checkRate(record, Date.now());
      if (!rate.allowed) {
        record.threadRate = rate.state;
        try { await store.setJSON(ref, record); } catch (_) {}
        return { statusCode: 429, headers: cors(), body: JSON.stringify({ error: "Too many messages just now. Please call (332) 277-0990." }) };
      }
      record.threadRate = rate.state;

      previousMessage = lastThreadMessage(record);
      const appended = thread.appendMessage(record, { from: "customer", text: text, via: "quote" });
      if (appended.added) {
        record.thread = appended.thread;
        record.threadUpdatedAt = appended.message.at;
        record.lastCustomerMessageAt = appended.message.at;
        newMessage = appended.message;
      }
      threadOut = appended.thread;

      /* The quote stays OPEN when a customer asks something - a question is not a
         rejection - so the status only moves if nothing more final has happened. */
      if (record.status !== "accepted" && record.status !== "declined") record.status = "question";
      record.questionAskedAt = new Date().toISOString();
      record.customerQuestion = text;
    } else {
      record.status = "declined";
      record.declinedAt = new Date().toISOString();
      record.declineReason = declineReason || "";
    }
    record.updatedAt = new Date().toISOString();
    await store.setJSON(ref, record);

    // Notify contractor
    const resendKey = process.env.RESEND_API_KEY;
    const contractorEmail = process.env.CONTRACTOR_EMAIL || "sanibuildingcorp@gmail.com";

    let notified = false;
    let notifyError = "";
    if (!resendKey) {
      notifyError = "RESEND_API_KEY is not set — your message was saved but we were not notified by email.";
    } else {
      try {
        if (action === "question" && newMessage) {
          /* A bare "Test 3 answer" with no project on it is what started this.
             Every message email, both directions, carries the same project header
             and the same customer-facing total - from lib/customer-total.js, never
             re-derived here. */
          const mail = buildMessageEmail({
            ref: ref, record: record, message: newMessage, previous: previousMessage, audience: "contractor",
          });
          await sendResend(resendKey, {
            from: "Sani Building Corp <estimates@sanibuildingcorp.com>",
            to: [contractorEmail],
            reply_to: (record.customer && record.customer.email) || undefined,
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
            headers: { "X-Entity-Ref-ID": ref },
          });
        } else {
          await notifyContractor(resendKey, contractorEmail, record, action, signature, declineReason, questionText);
        }
        notified = true;
      } catch (e) {
        console.error("Notification failed:", e.message);
        notifyError = "Saved, but the notification email did not go out.";
      }
    }

    /* Saved and notified are reported separately. A saved message must never
       claim success when the other side was never told - the page tells the
       customer to call instead. */
    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({
        success: true,
        status: record.status,
        notified: notified,
        error: notified ? undefined : notifyError,
        message: newMessage,
        thread: threadOut,
      }),
    };
  } catch (err) {
    console.error("quote-response error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

async function notifyContractor(resendKey, contractorEmail, record, action, signature, declineReason, questionText) {
  const customer = record.customer || {};
  const est = record.estimate || {};
  /* The number in your inbox is the number the customer just agreed to, so it
     matches the page he clicked Approve on. It used to be the internal grand
     total, which on a labor-only job read $47,117.50 against a $24,835.00 quote. */
  const total = customerTotals(est, record).customerTotal;

  const isAccept = action === "accept";
  const isReview = action === "review";
  const isQuestion = action === "question";
  const color = isAccept ? "#2ecc71" : ((isReview || isQuestion) ? "#c9a84c" : "#e74c3c");
  const emoji = isAccept ? "\u2705" : (isReview ? "\ud83d\udee0" : (isQuestion ? "\ud83d\udcac" : "\u274c"));
  const title = isAccept ? "QUOTE ACCEPTED" : (isReview ? "FINISH SELECTIONS \u2014 REVIEW NEEDED" : (isQuestion ? "CUSTOMER QUESTION \u2014 QUOTE STILL OPEN" : "QUOTE DECLINED"));
  const headline = isAccept
    ? (escapeHtml(customer.name || "Customer") + " accepted the quote")
    : (isReview
      ? (escapeHtml(customer.name || "Customer") + " chose finishes \u2014 review & resend")
      : (isQuestion
        ? (escapeHtml(customer.name || "Customer") + " replied with a question before accepting")
        : (escapeHtml(customer.name || "Customer") + " declined the quote")));

  // Chosen finishes list (review + accept)
  let finishRows = "";
  const sels = record.customerSelections || [];
  if ((isReview || isAccept) && sels.length) {
    finishRows = '<div style="background:#faf8f4;border:1px solid #e8e2d9;border-radius:8px;padding:14px 16px;margin:18px 0">' +
      '<div style="font-size:12px;letter-spacing:1px;color:#888;margin-bottom:8px">CUSTOMER\'S CHOICES</div>' +
      sels.map(function (s) {
        const up = Number(s.upgrade) || 0;
        const upTxt = up === 0 ? '<span style="color:#2ecc71">included</span>' : ('<span style="color:#b8720a;font-weight:700">' + (up > 0 ? "+" : "-") + "$" + Math.abs(up).toLocaleString("en-US") + '</span>');
        return '<div style="display:flex;justify-content:space-between;font-size:14px;padding:5px 0;border-bottom:1px solid #efe9df"><span><strong>' + escapeHtml(s.group || "Finish") + ':</strong> ' + escapeHtml(s.option || "") + '</span>' + upTxt + '</div>';
      }).join("") + '</div>';
  }

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
<div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#fff;padding:24px;border-radius:10px 10px 0 0;text-align:center">
  <div style="font-size:14px;letter-spacing:3px;color:#c9a84c">SANI BUILDING CORP</div>
  <div style="font-size:11px;letter-spacing:2px;color:#aaa;margin-top:4px">${title}</div>
</div>
<div style="background:#fff;border:1px solid #e8e2d9;border-top:none;padding:28px;border-radius:0 0 10px 10px">
  <div style="text-align:center;margin-bottom:20px">
    <div style="display:inline-block;background:${color};color:#fff;width:64px;height:64px;border-radius:50%;line-height:64px;font-size:32px">${emoji}</div>
  </div>
  <h1 style="text-align:center;color:#0d1b2a;font-size:22px;margin:0 0 8px">${headline}</h1>
  <p style="text-align:center;color:#888;font-size:13px;margin:0 0 24px">${escapeHtml(est.projectTitle || record.request?.service || "Project")} · ${escapeHtml(record.ref)}</p>

  ${finishRows}

  <table style="width:100%;font-size:14px;margin-bottom:18px;border-collapse:collapse">
    <tr><td style="padding:8px 12px;background:#faf8f4;color:#888;width:140px"><strong>Customer</strong></td><td style="padding:8px 12px">${escapeHtml(customer.name)}</td></tr>
    <tr><td style="padding:8px 12px;background:#faf8f4;color:#888"><strong>Phone</strong></td><td style="padding:8px 12px"><a href="tel:${escapeHtml(customer.phone)}" style="color:#b8720a">${escapeHtml(customer.phone)}</a></td></tr>
    <tr><td style="padding:8px 12px;background:#faf8f4;color:#888"><strong>Email</strong></td><td style="padding:8px 12px"><a href="mailto:${escapeHtml(customer.email)}" style="color:#b8720a">${escapeHtml(customer.email)}</a></td></tr>
    <tr><td style="padding:8px 12px;background:#faf8f4;color:#888"><strong>Address</strong></td><td style="padding:8px 12px">${escapeHtml(customer.address || "—")}</td></tr>
    <tr><td style="padding:8px 12px;background:#faf8f4;color:#888"><strong>${isReview ? "New total (their picks)" : "Total"}</strong></td><td style="padding:8px 12px;color:${color};font-weight:700;font-size:16px">$${total.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td></tr>
    ${isAccept && signature ? `<tr><td style="padding:8px 12px;background:#faf8f4;color:#888"><strong>Signature</strong></td><td style="padding:8px 12px;font-style:italic">${escapeHtml(signature)}</td></tr>` : ""}
    ${isQuestion && questionText ? `<tr><td style="padding:8px 12px;background:#faf8f4;color:#888"><strong>Their question</strong></td><td style="padding:8px 12px;font-size:15px;line-height:1.5">${escapeHtml(questionText)}</td></tr>` : ""}
    ${!isAccept && !isReview && !isQuestion && declineReason ? `<tr><td style="padding:8px 12px;background:#faf8f4;color:#888"><strong>Reason</strong></td><td style="padding:8px 12px">${escapeHtml(declineReason)}</td></tr>` : ""}
  </table>

  ${isAccept ? `<div style="background:#e8f4ed;border-left:4px solid #2ecc71;padding:14px 18px;margin:20px 0;font-size:14px">
    <strong>Next steps:</strong> Send the customer an invoice with deposit details and schedule the project start.
  </div>` : ""}
  ${isReview ? `<div style="background:#fbf6e8;border-left:4px solid #c9a84c;padding:14px 18px;margin:20px 0;font-size:14px">
    <strong>Action needed:</strong> Open the dashboard, apply the customer's choices, adjust labor if needed, then re-send the quote for their final approval.
  </div>` : ""}
  ${isQuestion ? `<div style="background:#fbf6e8;border-left:4px solid #c9a84c;padding:14px 18px;margin:20px 0;font-size:14px">
    <strong>This is NOT a decline.</strong> The customer has a question before accepting &mdash; reply or call them, then update &amp; re-send the quote if needed. Their quote link is still active.
  </div>` : ""}

  <div style="text-align:center;margin-top:24px">
    ${isQuestion ? `<a href="mailto:${escapeHtml(customer.email)}?subject=Re: your question about quote ${escapeHtml(record.ref)}" style="display:inline-block;background:#0d1b2a;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:4px">&#9993;&#65039; Reply to ${escapeHtml((customer.name || "").split(" ")[0])}</a>` : ""}
    <a href="tel:${escapeHtml(customer.phone)}" style="display:inline-block;background:#c9a84c;color:#0d1b2a;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:4px">📞 Call ${escapeHtml((customer.name || "").split(" ")[0])}</a>
  </div>
</div>
</body></html>`;

  return sendResend(resendKey, {
    from: "Sani Building Corp <onboarding@resend.dev>",
    to: [contractorEmail],
    reply_to: customer.email,
    subject: `${emoji} ${isAccept ? "ACCEPTED" : (isReview ? "REVIEW NEEDED" : (isQuestion ? "QUESTION (still open)" : "DECLINED"))}: ${customer.name} — ${est.projectTitle || record.request?.service} (${record.ref})`,
    html,
  });
}


function escapeHtml(t) {
  if (t == null) return "";
  return String(t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
          else reject(new Error(`Resend ${res.statusCode}: ${body}`));
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function lastThreadMessage(record) {
  const t = thread.normalizeThread(record);
  return t.length ? t[t.length - 1] : null;
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
