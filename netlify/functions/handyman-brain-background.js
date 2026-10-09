// netlify/functions/handyman-brain-background.js
//
// Runs the handyman brain for one booking (background: up to 15 minutes, so a
// strong model with photos never times out). The dashboard polls
// handyman-brain?ref=... for the result.
//
// POST { ref, message? }   contractor only (x-sbc-key)
//   no message -> read the booking and write the first plan
//   message    -> the owner's chat: the brain answers and updates the plan
//
// State lives in Netlify Blobs "handyman-brain", key = booking ref:
//   { status: running|done|error, plan, chat:[{from,text,at}], error, updatedAt }

"use strict";

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const brain = require("./lib/handyman-brain");

const MODEL = process.env.HANDYMAN_MODEL || process.env.ESTIMATOR_MODEL || "claude-opus-5";
const s = (v) => String(v == null ? "" : v).trim();
const now = () => new Date().toISOString();

function store() {
  try { return getStore({ name: "handyman-brain", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN }); }
  catch (_) { return getStore("handyman-brain"); }
}
module.exports.store = store;

async function loadBooking(ref) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  const r = await fetch(url + "/rest/v1/bookings?ref=eq." + encodeURIComponent(ref), { headers: { apikey: key, Authorization: "Bearer " + key } });
  const j = await r.json().catch(() => null);
  return Array.isArray(j) && j[0] ? j[0] : null;
}

async function ask(text, photos) {
  const content = photos.map((u) => ({ type: "image", source: { type: "url", url: u } })).concat([{ type: "text", text }]);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: "user", content }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || "AI " + r.status);
  return (j.content || []).map((b) => b.text || "").join("");
}

exports.handler = async function (event) {
  const denied = requireDashboardKey(event);
  if (denied) return denied;
  let b = {};
  try { b = JSON.parse(event.body || "{}"); } catch (_) {}
  const ref = s(b.ref);
  if (!/^SBC-H-[A-Z0-9-]+$/i.test(ref)) return { statusCode: 400, body: "bad ref" };
  const st = store();
  const prev = (await st.get(ref, { type: "json" }).catch(() => null)) || { chat: [] };
  const chat = Array.isArray(prev.chat) ? prev.chat.slice(-40) : [];
  const msg = s(b.message).slice(0, 2000);
  if (msg) chat.push({ from: "owner", text: msg, at: now() });
  await st.setJSON(ref, Object.assign({}, prev, { status: "running", chat, error: "", updatedAt: now() }));
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
    const booking = await loadBooking(ref);
    if (!booking) throw new Error("Booking not found");
    const rates = brain.cleanRates(await getStore({ name: "settings", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN }).get("handyman-rates", { type: "json" }).catch(() => null));
    const history = chat.slice(0, msg ? -1 : undefined).slice(-20).map((m) => (m.from === "owner" ? "OWNER: " : "YOU: ") + s(m.text).slice(0, 1200)).join("\n");
    const text = brain.prompt(booking, prev.plan || null, rates, history, msg);
    const photos = (Array.isArray(booking.photo_urls) ? booking.photo_urls : []).filter((u) => /^https:\/\//.test(u)).slice(0, 6);
    let out;
    try { out = await ask(text, photos); } catch (_) { out = await ask(text, []); }
    const o = brain.parse(out);
    const plan = brain.validate(o, prev.plan || null, rates) || prev.plan || null;
    const reply = s(o && o.reply).replace(/\blicen[cs]ed?\b/gi, "fully insured").slice(0, 2000) || (plan ? "Plan updated." : "I could not build a plan. Try again or tell me more.");
    chat.push({ from: "brain", text: reply, chips: (o && Array.isArray(o.chips) ? o.chips : []).map((c) => s(c).slice(0, 40)).filter(Boolean).slice(0, 3), at: now() });
    await st.setJSON(ref, { status: "done", plan, chat, error: "", rates, updatedAt: now() });
  } catch (e) {
    await st.setJSON(ref, Object.assign({}, prev, { status: "error", chat, error: s(e && e.message).slice(0, 300), updatedAt: now() }));
  }
  return { statusCode: 202, body: "" };
};
