// netlify/functions/inbox-sync.js
// GMAIL → DASHBOARD SYNC (v3, Aug 2 2026 — proper MIME parsing via mailparser: human-readable bodies) — the missing half of the two-way CRM.
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
const { simpleParser } = require("mailparser");

const OWN_PATTERNS = [
  "@sanibuildingcorp.com", "sanibuildingcorp@gmail.com",
  "no-reply", "noreply", "mailer-daemon", "postmaster",
  "@google.com", "@resend.", "@netlify.", "@cloudflare.",
];

const { getStore } = require("@netlify/blobs");
const thread = require("./lib/thread");

/* THE GMAIL BRIDGE.
   Zura answers from his phone's Gmail app between jobs and always will. A design
   that needs him to open the dashboard every time fails in a week. Outbound
   message emails carry the ref in the SUBJECT - "Re: SBC-260809-VUUI — Three
   Interior Staircases" - and Gmail keeps the subject on reply, so his reply names
   the job even though he never thought about it. If the subject has been
   rewritten, the quoted original underneath usually still carries the ref.

   Keyed on the RFC Message-ID, never on matching text, so re-reading the same
   mail on the next sync is a no-op rather than a duplicate.

   Honest limit: a brand-new email with no ref anywhere cannot be matched. It
   still lands in lead_messages and the dashboard inbox - it just will not appear
   on the customer's portal. That is why the dashboard reply box is the primary
   path and this is the fallback. */
async function bridgeToEstimateThread(row, fromAddr) {
  const ref = thread.refFromText(row.subject, row.body);
  if (!ref) return { bridged: false, reason: "no-ref" };
  try {
    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const record = await store.get(ref, { type: "json" });
    if (!record) return { bridged: false, reason: "no-record" };

    /* Whose voice is this? Mail arriving FROM the customer on this record is
       theirs; anything else that quotes the ref is his. inbox-sync has already
       dropped our own sending addresses before this point. */
    const customerEmail = String((record.customer && record.customer.email) || "").trim().toLowerCase();
    const from = customerEmail && fromAddr === customerEmail ? "customer" : "contractor";

    const appended = thread.appendMessage(record, {
      id: row.message_id, from: from, text: row.body, at: row.created_at, via: "gmail", subject: row.subject,
    });
    if (!appended.added) return { bridged: false, reason: appended.reason };

    record.thread = appended.thread;
    record.threadUpdatedAt = appended.message.at;
    if (from === "customer") record.lastCustomerMessageAt = appended.message.at;
    else record.lastContractorMessageAt = appended.message.at;
    await store.setJSON(ref, record);
    return { bridged: true, ref: ref, from: from };
  } catch (e) {
    return { bridged: false, reason: String((e && e.message) || e).slice(0, 120) };
  }
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.ping === "1") {
    return json(200, {
      ok: true, function: "inbox-sync", version: "v3 Aug 2 2026", node: process.version,
      hasGmailUser: !!process.env.GMAIL_USER,
      hasGmailAppPassword: !!process.env.GMAIL_APP_PASSWORD,
      hasSupabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY),
    });
  }
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "POST only (or ?ping=1)" });
  // No key required: this endpoint only imports the business's own inbox into its own
  // CRM and returns counters — nothing sensitive is exposed and nothing is sent.
  // Sending email (send-reply.js) remains DASHBOARD_KEY-protected.
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return json(200, { synced: 0, skipped: "GMAIL_USER / GMAIL_APP_PASSWORD not set in Netlify env yet" });

  const deadline = Date.now() + 8000; // stay under the 10s function limit
  const bridgedToThreads = [];

  // 1) Known-customer set (this is the spam wall)
  let known;
  try {
    const [msgs, bookings, leads, ests] = await Promise.all([
      sbGet("/rest/v1/lead_messages?select=lead_email&limit=1000"),
      sbGet("/rest/v1/bookings?select=customer_email&limit=1000"),
      fetch("https://velvety-horse-2aa6e3.netlify.app/.netlify/functions/contact-leads")
        .then((r) => (r.ok ? r.json() : { leads: [] }))
        .catch(() => ({ leads: [] })),
      /* list-estimates is gated on DASHBOARD_KEY now. Server-to-server, so the
         key comes from this function's own environment. Without this header the
         call 401s and every estimate customer silently looks like a stranger,
         so their replies would stop being matched to their job - and the
         .catch() below swallows it, so nothing would say why.

         SELF, NOT THE HARDCODED PRODUCTION URL. DASHBOARD_KEY holds a different
         value in each deploy context, so a preview-context function presenting
         its key to production's gate is refused. Calling our own origin keeps
         both ends in the same context and therefore on the same key. */
      fetch((process.env.URL || "https://velvety-horse-2aa6e3.netlify.app") + "/.netlify/functions/list-estimates", {
        headers: process.env.DASHBOARD_KEY ? { "x-sbc-key": process.env.DASHBOARD_KEY } : {},
      })
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({})),
    ]);
    const estArr = (ests && (ests.records || ests.estimates || ests.list)) || (Array.isArray(ests) ? ests : []);
    known = new Set([]
      .concat((msgs || []).map((r) => norm(r.lead_email)))
      .concat((bookings || []).map((r) => norm(r.customer_email)))
      .concat(((leads && leads.leads) || []).map((l) => norm((l.data || l).email)))
      .concat(estArr.map((e) => norm(((e && e.customer) || {}).email || (e && e.email))))
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
  let seen = 0, inserted = 0, matchedButDupe = 0, skippedOwn = 0, skippedUnknown = 0, insertErrors = [];
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
        const msg = await client.fetchOne(uids[i], { envelope: true });
        if (!msg || !msg.envelope) continue;
        seen++;
        const fromObj = (msg.envelope.from && msg.envelope.from[0]) || {};
        const fromAddr = norm((fromObj.address || ""));
        if (!fromAddr) continue;
        if (OWN_PATTERNS.some((p) => fromAddr.indexOf(p) > -1)) { skippedOwn++; continue; }
        if (!known.has(fromAddr)) { skippedUnknown++; continue; }

        const mid = String(msg.envelope.messageId || "").slice(0, 250) || ("uid-" + uids[i] + "-" + fromAddr);
        // Download + parse the actual message only for matched customers (cheap: few per run)
        let bodyText = "";
        try {
          const dl = await client.download(uids[i]);
          if (dl && dl.content) {
            const chunks = []; let size = 0;
            for await (const ch of dl.content) {
              size += ch.length;
              if (size > 300 * 1024) break; // cap 300KB
              chunks.push(ch);
            }
            const parsed = await simpleParser(Buffer.concat(chunks));
            bodyText = parsed.text || String(parsed.html || "").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
          }
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
        /* lead_messages stays the CRM record of every mail. The bridge is
           additive: a mail that names an estimate ALSO joins that estimate's
           thread. A failure here must never stop the CRM write. */
        try {
          const b = await bridgeToEstimateThread(row, fromAddr);
          if (b.bridged) bridgedToThreads.push(b.ref + " (" + b.from + ")");
        } catch (_) {}
        if (res.inserted) inserted++;
        else if (res.status === 409 || res.status === 200 || res.status === 204) matchedButDupe++;
        else insertErrors.push("HTTP " + res.status + " " + String(res.detail || "").slice(0, 160));
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (e) {
    try { await client.logout(); } catch (_) {}
    return json(502, { error: "IMAP: " + String(e.message || e).slice(0, 250), hint: "Check GMAIL_APP_PASSWORD (needs 2-Step Verification on the Google account) and that IMAP is enabled in Gmail settings." });
  }

  return json(200, {
    ok: true, scanned: seen, newMessages: inserted, alreadySynced: matchedButDupe,
    skippedOwnOrSystem: skippedOwn, skippedNotACustomer: skippedUnknown,
    knownCustomers: known.size,
    bridgedToEstimateThreads: bridgedToThreads,
    insertErrors: insertErrors.slice(0, 3),
  });
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
  let detail = "";
  if (r.status >= 400) detail = await r.text().catch(function () { return ""; });
  return { inserted: r.status === 201, status: r.status, detail: detail };
}
function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Content-Type": "application/json" };
}
function json(code, obj) { return { statusCode: code, headers: cors(), body: JSON.stringify(obj, null, 2) }; }
