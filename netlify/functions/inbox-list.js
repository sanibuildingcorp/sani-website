// netlify/functions/inbox-list.js
// UNIFIED CUSTOMER INBOX (Jul 30 2026)
// Merges every request source into one customer list with a per-customer timeline:
//   • Renovation estimates  (Netlify Blobs, via sibling list-estimates)
//   • Handyman bookings     (Supabase,      via sibling handyman-get)
//   • Website contact leads (Netlify Forms, via sibling contact-leads)
//   • Outbound messages     (Supabase lead_messages, direction=out — send-reply & confirmations)
//   • Inbound customer email (Supabase lead_messages, direction=in  — written by inbox-sync)
// GET → { customers: [ { email, name, phone, sources[], lastActivity, timeline[] } ] }
// Read-only. Sources that fail are skipped, never fatal.

// Call our own functions on the NETLIFY-DIRECT host, not the public domain:
// the public domain sits behind Cloudflare, which can block server-to-server
// fetches from datacenter IPs (symptom: every source empty -> "No customers yet").
/* ══ OWN ORIGIN FIRST, NOW THAT THE SIBLING IS GATED. ═══════════════════════
   DASHBOARD_KEY holds a DIFFERENT VALUE IN EACH DEPLOY CONTEXT (5 values in 5
   contexts on this site). A function sends the key from the context IT is
   running in, so a preview-context function calling the hardcoded PRODUCTION
   URL presents the preview key to production's gate and gets a 401.

   Production was always fine - same context both ends. Previews were not, and
   this list only survived them by accident: production 401s, `!r.ok` throws,
   and the loop falls through to its own origin where the key does match.
   Relying on that is relying on the order of an array. Own origin goes first;
   the fixed production URL stays as the fallback it was always meant to be. */
const BASES = [
  process.env.URL || "https://www.sanibuildingcorp.com",
  "https://velvety-horse-2aa6e3.netlify.app",
];

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "GET")     return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };

  const dbg = {};
  const src = (name, path) => getJsonAny(path).then(
    (v) => { dbg[name] = "ok"; return v; },
    (e) => { dbg[name] = String(e.message || e).slice(0, 120); return null; }
  );
  const [est, hm, leads, outMsgs] = await Promise.all([
    src("estimates", "/.netlify/functions/list-estimates"),
    src("handyman",  "/.netlify/functions/handyman-get"),
    src("leads",     "/.netlify/functions/contact-leads"),
    supabaseGet("/rest/v1/lead_messages?order=created_at.desc&limit=500").then(
      (v) => { dbg.messages = "ok"; return v; },
      (e) => { dbg.messages = String(e.message || e).slice(0, 120); return null; }
    ),
  ]);

  const customers = {}; // key: lower(email)

  function touch(email, name, phone) {
    const key = String(email || "").trim().toLowerCase();
    if (!key || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(key)) return null;
    if (!customers[key]) customers[key] = { email: key, name: "", phone: "", sources: [], timeline: [] };
    const c = customers[key];
    if (name  && !c.name)  c.name  = String(name).trim();
    if (phone && !c.phone) c.phone = String(phone).trim();
    return c;
  }
  function add(c, source, item) {
    if (!c) return;
    if (c.sources.indexOf(source) === -1) c.sources.push(source);
    c.timeline.push(item);
  }
  const pick = (o, keys) => { for (const k of keys) { if (o && o[k]) return o[k]; } return ""; };

  // ── Renovation estimates (lightweight shape: customer{}, request{}, estimate{}) ──
  for (const e of (est && est.estimates) || []) {
    const cust = e.customer || {};
    const c = touch(cust.email || e.email, cust.name || e.name, cust.phone || e.phone);
    const req = e.request || {}, est2 = e.estimate || {};
    const lines = [];
    if (est2.projectTitle) lines.push(est2.projectTitle);
    const spec = [req.service, req.propertyType, req.timeline].filter(Boolean).join(" · ");
    if (spec) lines.push(spec);
    if (Number(est2.grandTotal) > 0) lines.push("Estimate total: $" + Number(est2.grandTotal).toLocaleString());
    if (req.photoCount) lines.push(req.photoCount + " photo(s) attached");
    add(c, "estimate", {
      kind: "estimate",
      title: "📐 Estimate request" + (e.status ? " · " + e.status : ""),
      detail: lines.join("\n"),
      ref: e.ref || "",
      at: e.submittedAt || e.createdAt || "",
    });
  }

  // ── Handyman bookings (full Supabase rows — surface the project details) ──
  for (const b of (hm && (hm.bookings || hm.data)) || []) {
    const c = touch(pick(b, ["customer_email", "email"]), pick(b, ["customer_name", "name"]), pick(b, ["customer_phone", "phone"]));
    const lines = [];
    const desc = b.job_summary || b.customer_description || "";
    if (desc) lines.push(desc);
    if (b.customer_address) lines.push("📍 " + b.customer_address);
    const when = [b.urgency ? "Urgency: " + b.urgency : "", b.preferred_date || "", b.preferred_time || ""].filter(Boolean).join(" · ");
    if (when) lines.push("⏰ " + when);
    if (b.estimated_labor_min || b.estimated_labor_max)
      lines.push("💰 Labor est: $" + (b.estimated_labor_min || "?") + "–$" + (b.estimated_labor_max || "?") +
                 (b.estimated_time_min ? " · " + b.estimated_time_min + "–" + (b.estimated_time_max || b.estimated_time_min) + "h" : ""));
    if (b.agreement_status) lines.push("✍️ Agreement: " + b.agreement_status);
    if (b.contractor_notes) lines.push("📝 " + b.contractor_notes);
    add(c, "handyman", {
      kind: "handyman",
      title: "🔧 " + (pick(b, ["service_name", "service"]) || "Handyman") + (b.status ? " · " + b.status : ""),
      detail: lines.join("\n"),
      ref: b.ref || "",
      at: pick(b, ["submitted_at", "created_at", "createdAt"]),
    });
  }

  // ── Website contact-form leads ──
  for (const l of (leads && leads.leads) || []) {
    const data = l.data || l;
    const c = touch(pick(data, ["email"]), pick(data, ["name"]), pick(data, ["phone"]));
    add(c, "website", {
      kind: "lead",
      title: "📥 Contact form · " + (pick(data, ["service"]) || "message") + (pick(data, ["borough"]) ? " · " + data.borough : ""),
      detail: pick(data, ["message", "address"]),
      ref: "",
      at: l.created_at || l.createdAt || "",
    });
  }

  // ── Messages (dashboard replies OUT + synced customer emails IN) ──
  for (const m of (Array.isArray(outMsgs) ? outMsgs : []) ) {
    if (m.lead_name === "DEBUG") continue;                  // breadcrumb rows, not conversation
    const inbound = m.direction === "in";
    const c = touch(m.lead_email, inbound ? m.lead_name : "", "");
    if (!inbound && m.lead_name && c && !c.name) c.name = m.lead_name;
    add(c, inbound ? "emailed" : "replied", {
      kind: inbound ? "in" : "out",
      title: (inbound ? "📩 Customer: " : "📧 You: ") + (m.subject || "message"),
      detail: m.body || "",
      ref: "",
      at: m.created_at || "",
      mid: inbound ? (m.message_id || "") : "",
    });
  }

  const list = Object.values(customers).map((c) => {
    c.timeline.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
    c.lastActivity = (c.timeline[0] && c.timeline[0].at) || "";
    return c;
  });
  list.sort((a, b) => new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0));

  return { statusCode: 200, headers: cors(), body: JSON.stringify({ customers: list, sources: dbg }) };
};

/* list-estimates is now gated on DASHBOARD_KEY. This is a server-to-server call
   from one Netlify function to a sibling, so the key comes from the function's
   own environment - never from the caller's request. Sending it on every sibling
   fetch is harmless for the ungated ones and means a future gate on any of them
   does not silently break this inbox. */
async function getJsonAny(path) {
  let lastErr;
  const headers = { accept: "application/json" };
  if (process.env.DASHBOARD_KEY) headers["x-sbc-key"] = process.env.DASHBOARD_KEY;
  for (const base of BASES) {
    try {
      const r = await fetch(base + path, { headers: headers });
      if (!r.ok) throw new Error("HTTP " + r.status + " @ " + base);
      return await r.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("all bases failed");
}
async function supabaseGet(path) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase env missing");
  const r = await fetch(url + path, { headers: { apikey: key, Authorization: "Bearer " + key } });
  if (!r.ok) throw new Error("Supabase HTTP " + r.status);
  return r.json();
}
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}
