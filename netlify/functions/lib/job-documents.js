// netlify/functions/lib/job-documents.js
//
// THE JOB'S PDF PLANS, AS DOCUMENTS FOR CLAUDE.
//
//   "Page 6 says ... 'no drawings' and quantities came from a typical 5 x 8
//    bathroom. Those notes do not match this estimate or the plans."
//
// Every PDF on the request (a customer upload, or one he added in the Edit
// panel) and every PDF sent in a message, as a labelled document block -
// at most MAX_DOCS_TO_READ. The generator (generate-estimate-background)
// and the estimator chat (assistant.js) read the same files the same way.

"use strict";

const thread = require("./thread");

function str(v) { return String(v == null ? "" : v).trim(); }

const MAX_DOCS_TO_READ = 3;
function documentBlocks(request, record) {
  const files = [];
  /* The customer form stores its uploads as {name, data: link} with no kind,
     so a PDF is known by its link or its name, not only by kind "file". */
  const isPdf = function (name, data) { return /^data:application\/pdf;/i.test(data) || /\.pdf(?:[?#]|$)/i.test(data) || /\.pdf$/i.test(String(name || "")); };
  (Array.isArray(request && request.photos) ? request.photos : []).forEach(function (p) {
    const data = String((p && (typeof p === "string" ? p : p.data)) || "").trim();
    if (p && (p.kind === "file" || isPdf(p.name, data))) files.push({ name: p.name, data: data, from: p.slot === "contractor" ? "the contractor" : "the customer's request" });
  });
  let msgs = [];
  try { msgs = thread.normalizeThread(record || {}); } catch (e) { msgs = []; }
  msgs.forEach(function (m) {
    (Array.isArray(m && m.attachments) ? m.attachments : []).forEach(function (a) {
      if (a && a.kind !== "image" && a.url) files.push({ name: a.name, data: String(a.url).trim(), from: "a message from the " + (m.from === "contractor" ? "contractor" : "customer") });
    });
  });
  const blocks = [];
  let n = 0;
  files.forEach(function (f) {
    if (n >= MAX_DOCS_TO_READ || !f.data) return;
    let source = null;
    const m = /^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/.exec(f.data);
    if (m) source = { type: "base64", media_type: "application/pdf", data: m[1] };
    else if (/^https:\/\/\S+\.pdf(?:[?#]\S*)?$/i.test(f.data)) source = { type: "url", url: f.data };
    if (!source) return;
    n += 1;
    blocks.push({ type: "text", text: "Drawing / document " + n + " \u2014 " + (str(f.name) || "file").slice(0, 80) + ", from " + f.from });
    blocks.push({ type: "document", source: source });
  });
  return blocks;
}

module.exports = { documentBlocks, MAX_DOCS_TO_READ };
