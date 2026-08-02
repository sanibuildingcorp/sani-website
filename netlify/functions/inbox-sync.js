// netlify/functions/inbox-sync.js
// GMAIL → DASHBOARD SYNC (v1, Aug 2 2026) — the missing half of the two-way CRM.
//
// WHAT IT DOES: connects to the info@sanibuildingcorp.com mailbox over IMAP
// (Google App Password — no OAuth dance), reads recent inbox mail, and files
// every message FROM A KNOWN CUSTOMER into Supabase lead_messages with
// direction "in". inbox-list.js then surfaces them in that customer's
// dashboard timeline as "📩 Customer: …".
//
// KNOWN CUSTOMER = any email address already present in lead_messages
// (every form submitter gets a logged confirmation, every dashboard reply is
// logged) or in handyman bookings. This filter is what keeps Verizon bills and
// Google invoices out of your CRM.
//
// DEDUPE: each mail's Message-ID is stored in lead_messages.message_id
// (unique index); re-syncing can never create duplicates.
//
// TRIGGER: the dashboard calls this (POST, x-sbc-key = DASHBOARD_KEY) when the
// Customers tab opens and via the "Sync inbox" button. Hard time budget keeps
// it inside Netlify's 10s limit — a partial sync is fine, the next call
// continues where this one stopped.
//
// SETUP (one-time, Netlify env, functions scope):
//   GMAIL_USER         = info@sanibuildingcorp.com
//   GMAIL_APP_PASSWORD = 16-character Google App Password
// Diagnostics: GET ?ping=1 → env/deploy status (no mailbox touch).

const { ImapFlow } = require("imapflow");

const OWN_PATTERNS = [
  "@sanibuildingcorp.com", "sanibuildingcorp@gmail.com",
  "no-reply", "noreply", "mailer-daemon", "postmaster",
  "@google.com", "@resend.", "@netlify.", "@cloudflare.",
];

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.ping === "1") {
    return json(200, {
      ok: true, function: "inbox-sync", version: "v1 Aug 2 2026", node: process.version,
      hasGmailUser: !!process.env.GMAIL_USER,
      hasGmailAppPassword: !!process.env.GMAIL_APP_PASSWORD,
      hasSupabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY),
    });
  }
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "POST only (or ?ping=1)" });
  if ((event.headers["x-sbc-key"] || event.headers["X-Sbc-Key"] || "") !== (process.env.DASHBOARD_KEY || "")) {
    return json(401, { error: "Bad or missing x-sbc-key" });
  }
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return json(200, { synced: 0, skipped: "GMAIL_USER / GMAIL_APP_PASSWORD not set in Netlify env yet" });

  const deadline = Date.now() + 8000; // stay under the 10s function limit

  // 1) Known-customer set (this is the spam wall)
  let known;
  try {
    const [msgs, bookings] = await Promise.all([
      sbGet("/rest/v1/lead_messages?select=lead_email&limit=1000"),
      sbGet("/rest/v1/bookings?select=customer_email&limit=1000"),
    ]);
    known = new Set([]
      .concat((msgs || []).map((r) => norm(r.lead_email)))
      .concat((bookings || []).map((r) => norm(r.customer_email)))
      .filter(Boolean));
  } catch (e) {
    return json(502, { error: "Supabase read failed: " + String(e.message || e).slice(0, 200) });
  }

  // 2) IMAP: recent inbox mail
  const client = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: user, pass: pass },
    logger: false,
  });
  let seen = 0, inserted = 0, matchedButDupe = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);
      let uids = await client.search({ since: since });
      if (!Array.isArray(uids)) uids = [];
      uids = uids.slice(-60); // newest 60 max per run
      for (let i = uids.length - 1; i >= 0; i--) {
        if (Date.now() > deadline) break;
        const msg = await client.fetchOne(uids[i], { envelope: true, bodyStructure: false, source: false, bodyParts: ["text"] });
        if (!msg || !msg.envelope) continue;
        seen++;
        const fromObj = (msg.envelope.from && msg.envelope.from[0]) || {};
        const fromAddr = norm((fromObj.address || ""));
        if (!fromAddr) continue;
        if (OWN_PATTERNS.some((p) => fromAddr.indexOf(p) > -1)) continue;
        if (!known.has(fromAddr)) continue;

        const mid = String(msg.envelope.messageId || "").slice(0, 250) || ("uid-" + uids[i] + "-" + fromAddr);
        let bodyText = "";
        try {
          const part = msg.bodyParts && msg.bodyParts.get && msg.bodyParts.get("text");
          if (part) bodyText = part.toString("utf-8");
        } catch (_) {}
        bodyText = cleanBody(bodyText).slice(0, 4000);

        const row = {
          lead_email: fromAddr,
          lead_name: String(fromObj.name || "").slice(0, 120) || null,
          direction: "in",
          subject: String(msg.envelope.subject || "(no subject)").slice(0, 300),
          body: bodyText || "(no readable text — open in Gmail)",
          message_id: mid,
          created_at: msg.envelope.date ? new Date(msg.envelope.date).toISOString() : new Date().toISOString(),
        };
        const res = await sbInsertIgnoreDupes("lead_messages", row);
        if (res.inserted) inserted++; else matchedButDupe++;
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (e) {
    try { await client.logout(); } catch (_) {}
    return json(502, { error: "IMAP: " + String(e.message || e).slice(0, 250), hint: "Check GMAIL_APP_PASSWORD (needs 2-Step Verification on the Google account) and that IMAP is enabled in Gmail settings." });
  }

  return json(200, { ok: true, scanned: seen, newMessages: inserted, alreadySynced: matchedButDupe, knownCustomers: known.size });
};

function norm(s) { return String(s || "").trim().toLowerCase(); }

function cleanBody(t) {
  // strip quoted history & signatures so the timeline shows just the reply
  const lines = String(t || "").replace(/\r/g, "").split("\n");
  const out = [];
  for (const ln of lines) {
    if (/^\s*On .{6,80} wrote:\s*$/.test(ln)) break;
    if (/^\s*-{2,}\s*Original Message/i.test(ln)) break;
    if (/^\s*From:\s.+@/.test(ln) && out.length > 0) break;
    if (/^>/.test(ln)) continue;
    out.push(ln);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function sbGet(path) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  const r = await fetch(url + path, { headers: { apikey: key, Authorization: "Bearer " + key } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
async function sbInsertIgnoreDupes(table, row) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  const r = await fetch(url + "/rest/v1/" + table + "?on_conflict=message_id", {
    method: "POST",
    headers: {
      apikey: key, Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
  });
  return { inserted: r.status === 201, status: r.status };
}
function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Content-Type": "application/json" };
}
function json(code, obj) { return { statusCode: code, headers: cors(), body: JSON.stringify(obj, null, 2) }; }
