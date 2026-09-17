// netlify/functions/lib/addresses.js
//
//   "i have confused and lost to understand which emails respond, in which
//    emails comes booking, from which emails send responses, in which email
//    receives response from customers and which emails use for tracking
//    notifications"
//
// ONE JOB PER ADDRESS. Before this file the system spoke to customers from
// three senders (contact@, estimates@, noreply@), pointed their replies at the
// alerts mailbox, and defaulted alerts to four different addresses across the
// functions. Every sender, reply-to and alert address now comes from here.
//
//   contact@    HUMANS.  The address on the website. The reply-to on every
//               email a customer receives. The only address he answers from.
//               A customer never needs to know another one.
//
//   estimates@  THE SYSTEM TALKS.  The From on everything automatic: estimates,
//               messages, invoices, contracts, confirmations, and the alerts to
//               him. It is the Resend-verified sender; nothing is delivered to
//               it, which is why reply-to always points at contact@.
//
//   info@       ALERTS TO HIM ONLY.  New request, customer replied, accepted,
//               opened, visitor, site-visit reminders, and the bcc copies of
//               what the system sent. Nothing a customer writes lands here.
//               Overridable with CONTRACTOR_EMAIL, as before.
//
// Not a rule to relax: a customer-facing email must never carry the alerts
// address as its reply-to. That is how conversations and alerts ended up in
// the same pile.

"use strict";

const DOMAIN = "sanibuildingcorp.com";
const CONTACT = "contact@" + DOMAIN;
const ESTIMATES = "estimates@" + DOMAIN;
const ALERTS_DEFAULT = "info@" + DOMAIN;

const FROM_SYSTEM = "Sani Building Corp <" + ESTIMATES + ">";
const FROM_ZURABI = "Zurabi at Sani Building Corp <" + ESTIMATES + ">";

/* Where alerts to him go. */
function alertsTo() {
  return process.env.CONTRACTOR_EMAIL || ALERTS_DEFAULT;
}

/* Where a customer's reply goes, on every email a customer receives. */
function replyTo() {
  return process.env.CUSTOMER_REPLY_TO || CONTACT;
}

module.exports = { DOMAIN, CONTACT, ESTIMATES, ALERTS_DEFAULT, FROM_SYSTEM, FROM_ZURABI, alertsTo, replyTo };
