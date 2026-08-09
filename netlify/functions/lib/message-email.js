// netlify/functions/lib/message-email.js
//
// ONE EMAIL SHAPE FOR BOTH DIRECTIONS.
//
// The complaint that started this: a reply arrived reading, in full, "Test 3
// answer", from "Sani Building", subject "Re: your question about quote
// SBC-260809-VUUI". Nothing said which project, what it cost, or where to look.
// The customer had to go find the original email to make sense of the answer.
//
// So every message email - his to the customer, and the customer's to him -
// carries the same project header: ref, project title, address, and the price.
// Read on a phone, standing on a job site, it should be obvious in one glance
// which job this is about.
//
// THE PRICE COMES FROM lib/customer-total.js AND NOWHERE ELSE. A consumer that
// computes its own total is the single most repeated defect in this codebase -
// it is how the emailed price and the contract drifted away from the quote page.
// On a labor-only quote the customer-facing number is not the internal grand
// total, and this email must never be the place that forgets that.

"use strict";

const customerTotals = require("./customer-total");

function esc(t) {
  if (t == null) return "";
  return String(t)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function money(n) {
  return "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function when(iso) {
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  });
}

/**
 * @param {object}  o
 * @param {string}  o.ref
 * @param {object}  o.record        the whole estimate record
 * @param {object}  o.message       { from, text, at }
 * @param {object} [o.previous]     the message being answered, for context
 * @param {"customer"|"contractor"} o.audience  who is receiving this
 * @param {string} [o.siteUrl]
 * @returns {{subject:string, html:string, text:string, quoteUrl:string, total:number}}
 */
function buildMessageEmail(o) {
  const ref = String((o && o.ref) || "").trim();
  const record = (o && o.record) || {};
  const est = record.estimate || {};
  const req = record.request || {};
  const customer = record.customer || {};
  const message = (o && o.message) || {};
  const previous = (o && o.previous) || null;
  const audience = (o && o.audience) === "contractor" ? "contractor" : "customer";
  const siteUrl = String((o && o.siteUrl) || process.env.SITE_URL || "https://www.sanibuildingcorp.com").replace(/\/+$/, "");

  const projectTitle = String(est.projectTitle || req.service || "Your project").trim();
  const address = String(customer.address || req.address || "").trim();
  const total = customerTotals(est, record).customerTotal;
  const quoteUrl = siteUrl + "/quote.html?ref=" + encodeURIComponent(ref);

  /* The ref lives in the SUBJECT on purpose. Gmail keeps the subject on reply,
     so when Zura answers from his phone instead of the dashboard, inbox-sync can
     read the ref back out and put his reply into the thread. Do not "tidy" it
     out - see refFromText() in lib/thread.js. */
  const subject = (audience === "contractor")
    ? ref + " — new message from " + (customer.name || "your customer")
    : "Re: " + ref + " — " + projectTitle;

  const heading = audience === "contractor"
    ? esc(customer.name || "Your customer") + " sent you a message"
    : "A message about your project";

  const signOff = audience === "contractor"
    ? '<p style="margin:22px 0 0;font-size:14px;color:#555">Reply from the dashboard, or just reply to this email — either way it lands in the same conversation.</p>'
    : '<p style="margin:22px 0 2px;font-size:15px;color:#0a1628">Best,<br><strong>Zurabi</strong><br>' +
      '<span style="font-size:13px;color:#777">Sani Building Corp · Brooklyn, NY · Fully insured</span></p>';

  const prevBlock = previous && previous.text
    ? '<div style="border-left:3px solid #e6e0d6;padding:2px 0 2px 14px;margin:0 0 18px;color:#7a7a7a;font-size:13.5px;line-height:1.6">' +
        '<div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-bottom:5px">' +
          (previous.from === "contractor" ? "Sani Building Corp" : esc(customer.name || "Customer")) +
          (when(previous.at) ? " · " + esc(when(previous.at)) : "") +
        "</div>" +
        '<div style="white-space:pre-wrap">' + esc(String(previous.text).slice(0, 600)) + "</div>" +
      "</div>"
    : "";

  const html = '<!DOCTYPE html>\n<html lang="en">\n' +
    '<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>\n' +
    '<body style="margin:0;padding:0;background:#f2efe9;font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.6">\n' +
    '<div style="max-width:600px;margin:0 auto;padding:24px 16px">' +

      '<div style="background:#0a1628;border-radius:14px 14px 0 0;padding:28px 28px 24px;text-align:center">' +
        '<div style="font-size:22px;font-weight:bold;letter-spacing:4px;color:#e0b84e">SANI BUILDING CORP</div>' +
      "</div>" +

      /* THE PROJECT HEADER. Identical to the one at the top of the portal, so a
         customer reading this on a phone recognises it instantly. */
      '<div style="background:#132433;padding:18px 28px;color:#dbe4ec">' +
        '<div style="font-size:11px;letter-spacing:2px;color:#8fa3b5;text-transform:uppercase">Estimate ' + esc(ref) + "</div>" +
        '<div style="font-size:18px;font-weight:bold;color:#ffffff;margin-top:5px">' + esc(projectTitle) + "</div>" +
        (address ? '<div style="font-size:13px;color:#a9bccc;margin-top:3px">' + esc(address) + "</div>" : "") +
        '<div style="font-size:20px;font-weight:bold;color:#e0b84e;margin-top:10px">' + money(total) + "</div>" +
      "</div>" +

      '<div style="background:#ffffff;border-radius:0 0 14px 14px;padding:26px 28px">' +
        '<p style="font-size:16px;margin:0 0 18px;color:#0a1628"><strong>' + heading + "</strong>" +
          (when(message.at) ? '<span style="font-weight:normal;font-size:13px;color:#888"> · ' + esc(when(message.at)) + "</span>" : "") +
        "</p>" +
        prevBlock +
        '<div style="background:#faf8f4;border:1px solid #e8e2d9;border-radius:10px;padding:16px 18px;white-space:pre-wrap;font-size:15px;line-height:1.65">' +
          esc(String(message.text || "")) +
        "</div>" +
        '<div style="text-align:center;margin:24px 0 4px">' +
          '<a href="' + quoteUrl + '" style="display:inline-block;background:#c8860a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 30px;border-radius:9px">' +
            (audience === "contractor" ? "Open the estimate &rarr;" : "View your project &amp; reply &rarr;") +
          "</a>" +
        "</div>" +
        '<p style="font-size:13px;color:#888;text-align:center;margin:6px 0 0">Everything about this job — the estimate, the photos and every message — stays at that one link.</p>' +
        signOff +
      "</div>" +

      '<div style="text-align:center;padding:20px 16px;font-size:12px;color:#8a8a8a;line-height:1.7">' +
        '<strong style="color:#555">Sani Building Corp</strong> &middot; Brooklyn, NY<br>' +
        'Fully insured &middot; <a href="tel:+13322770990" style="color:#8a8a8a">(332) 277-0990</a><br>' +
        '<a href="https://www.sanibuildingcorp.com" style="color:#8a8a8a">www.sanibuildingcorp.com</a>' +
      "</div>" +

    "</div>\n</body></html>";

  const text =
    "SANI BUILDING CORP\n\n" +
    "Estimate " + ref + "\n" +
    projectTitle + "\n" +
    (address ? address + "\n" : "") +
    money(total) + "\n\n" +
    (previous && previous.text
      ? "--- " + (previous.from === "contractor" ? "Sani Building Corp" : (customer.name || "Customer")) + " wrote ---\n" +
        String(previous.text).slice(0, 600) + "\n\n"
      : "") +
    (audience === "contractor" ? (customer.name || "Your customer") + " wrote:" : "A message about your project:") + "\n\n" +
    String(message.text || "") + "\n\n" +
    "Everything about this job stays at this one link:\n" + quoteUrl + "\n\n" +
    (audience === "contractor"
      ? "Reply from the dashboard, or just reply to this email.\n"
      : "Best,\nZurabi\nSani Building Corp · Brooklyn, NY · Fully insured\n(332) 277-0990\n");

  return { subject: subject, html: html, text: text, quoteUrl: quoteUrl, total: total };
}

module.exports = buildMessageEmail;
module.exports.buildMessageEmail = buildMessageEmail;
