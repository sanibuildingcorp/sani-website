// netlify/functions/inbox-list.js
// UNIFIED CUSTOMER INBOX (Jul 30 2026)
// Merges every request source into one customer list with a per-customer timeline:
//   • Renovation estimates  (Netlify Blobs, via sibling list-estimates)
//   • Handyman bookings     (Supabase,      via sibling handyman-get)
//   • Website contact leads (Netlify Forms, via sibling contact-leads)
//   • Outbound messages     (Supabase table lead_messages — written by send-reply)
// GET → { customers: [ { email, name, phone, sources[], lastActivity, timeline[] } ] }
// Read-only. Sources that fail are skipped, never fatal.

const BASE = process.env.URL || "https://www.sanibuildingcorp.com";

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "GET")     return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };

  const [est, hm, leads, outMsgs] = await Promise.all([
    getJson(BASE + "/.netlify/functions/list-estimates").catch(() => null),
    getJson(BASE + "/.netlify/functions/handyman-get").catch(() => null),
    getJson(BASE + "/.netlify/functions/contact-leads").catch(() => null),
    supabaseGet("/rest/v1/lead_messages?order=created_at.desc&limit=500").catch(() => null),
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

  // ── Renovation estimates ──
  for (const e of (est && est.estimates) || []) {
    const email = pick(e, ["email", "customerEmail", "clientEmail"]) || pick(e.customer || {}, ["email"]);
    const c = touch(email, pick(e, ["name", "customerName", "clientName"]) || pick(e.customer || {}, ["name"]),
                    pick(e, ["phone", "customerPhone"]) || pick(e.customer || {}, ["phone"]));
    add(c, "estimate", {
      kind: "estimate",
      title: "📐 Estimate request" + (e.status ? " · " + e.status : ""),
      detail: [pick(e, ["projectType", "service", "scope"]), pick(e, ["borough", "location"])].filter(Boolean).join(" · "),
      ref: e.ref || "",
      at: e.submittedAt || e.createdAt || e.created_at || "",
    });
  }

  // ── Handyman bookings ──
  for (const b of (hm && (hm.bookings || hm.data)) || []) {
    const c = touch(pick(b, ["email", "customer_email"]), pick(b, ["name", "customer_name"]), pick(b, ["phone", "customer_phone"]));
    add(c, "handyman", {
      kind: "handyman",
      title: "🔧 Handyman booking · " + (pick(b, ["service_name", "service"]) || "request") + (b.status ? " · " + b.status : ""),
      detail: pick(b, ["description", "details", "notes", "message"]),
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

  // ── Outbound messages (dashboard replies) ──
  for (const m of (Array.isArray(outMsgs) ? outMsgs : []) ) {
    const c = touch(m.lead_email, m.lead_name, "");
    add(c, "replied", {
      kind: "out",
      title: "📧 You: " + (m.subject || "message"),
      detail: m.body || "",
      ref: "",
      at: m.created_at || "",
    });
  }

  const list = Object.values(customers).map((c) => {
    c.timeline.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
    c.lastActivity = (c.timeline[0] && c.timeline[0].at) || "";
    return c;
  });
  list.sort((a, b) => new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0));

  return { statusCode: 200, headers: cors(), body: JSON.stringify({ customers: list }) };
};

async function getJson(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
  return r.json();
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
