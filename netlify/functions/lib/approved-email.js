// netlify/functions/lib/approved-email.js
//
// THE CUSTOMER'S "YOU APPROVED IT" EMAIL.
//
//   "customer have to see confirmation email too for letting them feel one
//    step is done"
//
// A customer pressed Approve, the page said "approved", and then nothing
// arrived. The contractor was emailed (or was meant to be); the customer got
// silence. Approving a renovation is a decision worth a receipt: this is it.
//
// Same project header as every other email about the job, the approved figure
// in gold, what happens next, and the one link where the whole project lives.
// Nothing here is a contract, a schedule or a payment demand - it confirms the
// step and says who will be in touch.

const customerTotals = require("./customer-total");

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function money(n) {
  const v = Number(n) || 0;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function when(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  });
}

/**
 * @param {object} o
 * @param {string} o.ref
 * @param {object} o.record   the whole estimate record, AFTER acceptance is written
 * @param {string} [o.siteUrl]
 * @returns {{subject:string, html:string, text:string, quoteUrl:string, total:number}}
 */
function buildApprovedEmail(o) {
  const ref = String((o && o.ref) || "").trim();
  const record = (o && o.record) || {};
  const est = record.estimate || {};
  const req = record.request || {};
  const customer = record.customer || {};
  const siteUrl = String((o && o.siteUrl) || process.env.SITE_URL || "https://www.sanibuildingcorp.com").replace(/\/+$/, "");

  const projectTitle = String(est.projectTitle || req.service || "Your project").trim();
  const address = String(customer.address || req.address || "").trim();
  /* The figure the customer approved is the customer-facing total, from the one
     place that defines it. Not the internal grand total, never re-derived. */
  const total = customerTotals(est, record).customerTotal;
  const first = String(customer.name || "").trim().split(/\s+/)[0] || "";
  const quoteUrl = siteUrl + "/quote.html?ref=" + encodeURIComponent(ref);
  const approvedAt = when(record.acceptedAt);

  /* The ref stays in the subject: inbox-sync reads it back if they reply by
     email instead of on the page. */
  const subject = "Approved ✓ " + ref + " — " + projectTitle;

  const html = '<!DOCTYPE html>\n<html lang="en">\n' +
    '<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>\n' +
    '<body style="margin:0;padding:0;background:#f2efe9;font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.6">\n' +
    '<div style="max-width:600px;margin:0 auto;padding:24px 16px">' +

      '<div style="background:#0a1628;border-radius:14px 14px 0 0;padding:28px 28px 24px;text-align:center">' +
        '<div style="font-size:22px;font-weight:bold;letter-spacing:4px;color:#e0b84e">SANI BUILDING CORP</div>' +
      "</div>" +

      '<div style="background:#132433;padding:18px 28px;color:#dbe4ec">' +
        '<div style="font-size:11px;letter-spacing:2px;color:#8fa3b5;text-transform:uppercase">Estimate ' + esc(ref) + "</div>" +
        '<div style="font-size:18px;font-weight:bold;color:#ffffff;margin-top:5px">' + esc(projectTitle) + "</div>" +
        (address ? '<div style="font-size:13px;color:#a9bccc;margin-top:3px">' + esc(address) + "</div>" : "") +
        '<div style="font-size:20px;font-weight:bold;color:#e0b84e;margin-top:10px">' + money(total) + "</div>" +
      "</div>" +

      '<div style="background:#ffffff;border-radius:0 0 14px 14px;padding:26px 28px">' +
        '<div style="background:#eef8f1;border:1px solid #bfe3cb;border-radius:10px;padding:16px 18px;margin:0 0 20px">' +
          '<div style="font-size:18px;font-weight:bold;color:#1c6547">✓ Your estimate is approved</div>' +
          '<div style="font-size:13.5px;color:#2f6b4a;margin-top:4px">' +
            (approvedAt ? "Approved " + esc(approvedAt) + " · " : "") + "Estimate " + esc(ref) +
          "</div>" +
        "</div>" +

        '<p style="font-size:16px;margin:0 0 14px;color:#0a1628">' +
          (first ? "Thank you, " + esc(first) + ". " : "Thank you. ") +
          "That step is done — your approval of <strong>" + money(total) + "</strong> for <strong>" + esc(projectTitle) + "</strong> is on record." +
        "</p>" +

        '<div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8a8a8a;margin:18px 0 6px">What happens next</div>' +
        '<ol style="margin:0 0 18px;padding-left:20px;font-size:15px;color:#222">' +
          "<li>Zurabi will be in touch shortly to confirm the schedule and the next steps.</li>" +
          "<li>The approved scope and price stay on your project page — nothing changes without your say-so.</li>" +
          "<li>Questions any time: write to Zurabi from that same page and it reaches him directly.</li>" +
        "</ol>" +

        '<div style="text-align:center;margin:22px 0 4px">' +
          '<a href="' + quoteUrl + '" style="display:inline-block;background:#c8860a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 30px;border-radius:9px">Open my project &rarr;</a>' +
        "</div>" +
        '<p style="font-size:13px;color:#888;text-align:center;margin:6px 0 0">Everything about this job — the approved estimate, the photos and every message — stays at that one link.</p>' +

        '<p style="margin:22px 0 2px;font-size:15px;color:#0a1628">Best,<br><strong>Zurabi</strong><br>' +
          '<span style="font-size:13px;color:#777">Sani Building Corp · Brooklyn, NY · Fully insured</span></p>' +
      "</div>" +

      '<div style="text-align:center;padding:20px 16px;font-size:12px;color:#8a8a8a;line-height:1.7">' +
        '<strong style="color:#555">Sani Building Corp</strong> &middot; Brooklyn, NY<br>' +
        'Fully insured &middot; <a href="tel:+13322770990" style="color:#8a8a8a">(332) 277-0990</a><br>' +
        '<a href="https://www.sanibuildingcorp.com" style="color:#8a8a8a">www.sanibuildingcorp.com</a>' +
      "</div>" +

    "</div>\n</body></html>";

  const text =
    "SANI BUILDING CORP\n\n" +
    "YOUR ESTIMATE IS APPROVED\n" +
    "Estimate " + ref + "\n" +
    projectTitle + "\n" +
    (address ? address + "\n" : "") +
    money(total) + "\n\n" +
    (first ? "Thank you, " + first + ". " : "Thank you. ") +
    "That step is done - your approval of " + money(total) + " for " + projectTitle + " is on record.\n\n" +
    "What happens next:\n" +
    "1. Zurabi will be in touch shortly to confirm the schedule and the next steps.\n" +
    "2. The approved scope and price stay on your project page - nothing changes without your say-so.\n" +
    "3. Questions any time: write to Zurabi from that same page.\n\n" +
    "Your project: " + quoteUrl + "\n\n" +
    "Best,\nZurabi\nSani Building Corp · Brooklyn, NY · Fully insured\n(332) 277-0990\n";

  return { subject: subject, html: html, text: text, quoteUrl: quoteUrl, total: total };
}

module.exports = buildApprovedEmail;
module.exports.buildApprovedEmail = buildApprovedEmail;
