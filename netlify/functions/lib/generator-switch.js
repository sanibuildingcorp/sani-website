// netlify/functions/lib/generator-switch.js
//
// THE AI ESTIMATE GENERATOR IS SWITCHED OFF.
//
//   "Look what he did after i clicked regenerate from customer conversation!
//    It's stupid! Remove whole generation"
//
// A one-toilet job came back as twenty lines and $1,268 after "Update
// estimate from chat". He prices by hand now (his lines, his price book).
// Nothing is deleted: the generator, auto-draft and every caller stay in the
// code, and all of them ask this switch first. Off unless AI_GENERATOR=on is
// set in Netlify (and SBC_AI_GENERATOR = true in dashboard.html).

"use strict";

function on() { return String(process.env.AI_GENERATOR || "").trim().toLowerCase() === "on"; }

const OFF_MESSAGE = "The AI estimate generator is switched off. Price the job with your own lines and price book.";

module.exports = { on, OFF_MESSAGE };
