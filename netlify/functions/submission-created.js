// netlify/functions/submission-created.js
// v4 (Aug 2 2026) — LOG-ONLY BREADCRUMB. DOES NOT SEND EMAIL.
//
// HISTORY: v1–v3 tried to send the customer confirmation from here, but
// Netlify's submission-created trigger silently never fired on this site
// (known Netlify platform bug; see SEO-LOG.md Aug 2 entry — DB breadcrumbs
// proved zero invocations across multiple verified submissions).
//
// The confirmation email is now sent by netlify/functions/send-confirmation.js,
// which contact.html and index.html call directly after a successful form POST.
//
// THIS file stays deployed only as a detector: if Netlify's trigger ever starts
// working again, a "DEBUG: submission-created invoked" row will appear in
// Supabase lead_messages — and because this file sends nothing, customers can
// never receive duplicate confirmations.

exports.handler = async function (event) {
  let payload;
  try {
    payload = (JSON.parse(event.body || "{}") || {}).payload || {};
  } catch {
    return { statusCode: 200, body: "unparseable body" };
  }
  const data = payload.data || {};
  const formName = payload.form_name || data["form-name"] || "form";
  const email = String(data.email || "unknown@unknown").trim().toLowerCase() || "unknown@unknown";

  await supabasePost("lead_messages", {
    lead_email: email,
    lead_name: "DEBUG",
    direction: "out",
    subject: "DEBUG: submission-created invoked",
    body: "Netlify trigger fired for form=" + formName + " at " + new Date().toISOString() +
      " (log-only; confirmation is sent by send-confirmation.js)",
  });

  return { statusCode: 200, body: "logged" };
};

async function supabasePost(path, row) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!base || !key) return { ok: false };
  try {
    const res = await fetch(String(base).replace(/\/+$/, "") + "/rest/v1/" + path, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}
