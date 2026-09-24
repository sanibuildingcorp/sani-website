// netlify/functions/quote-seen.js
//
// The same open-tracking as track-quote-open.js, at an address without
// "track" in it.
//
//   "I received this email notification if estimate opens outside the email
//    but if estimate opens inside the email then i don't have a open
//    notification."
//
// The page loads inside the Gmail app, so the page's own requests work; only
// the open ping went missing, and it was the one request with "track" in its
// address - the word content blockers and in-app browsers filter on. The page
// now reports the open here, as a POST with the ref in the body. The old
// address stays: every page already open in a customer's browser still calls
// it, and it is the fallback.

"use strict";

module.exports = require("./track-quote-open");
