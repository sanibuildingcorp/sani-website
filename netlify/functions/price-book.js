// netlify/functions/price-book.js
//
// HIS PRICE BOOK: the service packages and products he saves himself.
//
//   The Perplexity estimate screen: "Save as my template" on a service saves
//   its lines (his own rates and hours), what is included and not included,
//   and its steps; the package buttons above the services add it back to any
//   estimate. "+ Add from my product library" does the same for one product.
//   Nothing in here is invented: it holds only what he saved.
//
// GET                              -> { templates: [...], products: [...] }
// POST { template: {...} }         -> saves (replaces one with the same name)
// POST { product: {...} }          -> saves (replaces one with the same name)
// POST { remove: "template"|"product", name } -> removes one
//
// CONTRACTOR ONLY (x-sbc-key), every method: these are his prices.

"use strict";

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");

const KEY = "price-book";
const MAX_TEMPLATES = 60, MAX_PRODUCTS = 300, MAX_LINES = 60;

const C = (v, n) => String(v == null ? "" : v).trim().slice(0, n || 300);
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 10000) / 10000 : 0; };
const list = (a, n) => (Array.isArray(a) ? a : []).map((x) => C(typeof x === "string" ? x : x && (x.text || x.item), 400)).filter(Boolean).slice(0, n || 40);

function cleanTemplate(t) {
  const name = C(t && t.name, 80);
  if (!name) return null;
  const lines = (Array.isArray(t.lines) ? t.lines : []).map((l) => ({
    kind: l && l.kind === "materials" ? "materials" : "labor",
    item: C(l && l.item, 200),
    qty: num(l && l.qty),
    unit: C(l && l.unit, 20),
    rate: num(l && l.rate),
  })).filter((l) => l.item).slice(0, MAX_LINES);
  const steps = (Array.isArray(t.steps) ? t.steps : []).map((s) => ({ title: C(s && s.title, 120), text: C(s && s.text, 400) })).filter((s) => s.title).slice(0, 12);
  return { name, lines, included: list(t.included), excluded: list(t.excluded), steps, savedAt: new Date().toISOString() };
}

function cleanProduct(p) {
  const name = C(p && (p.name || p.item), 200);
  if (!name) return null;
  const photo = C(p && p.photo, 400000);
  return {
    name,
    spec: C(p && p.spec, 200),
    unit: C(p && p.unit, 20) || "ea",
    rate: num(p && p.rate),
    link: /^https?:\/\/[^\s"'<>]+$/i.test(C(p && p.link, 600)) ? C(p.link, 600) : "",
    photo: /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo) ? photo : "",
    savedAt: new Date().toISOString(),
  };
}

function upsert(arr, item, max) {
  const out = arr.filter((x) => x && String(x.name).toLowerCase() !== item.name.toLowerCase());
  out.unshift(item);
  return out.slice(0, max);
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;
  try {
    const store = getStore({ name: "settings", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const book = (await store.get(KEY, { type: "json" })) || {};
    const templates = Array.isArray(book.templates) ? book.templates : [];
    const products = Array.isArray(book.products) ? book.products : [];
    if (event.httpMethod === "GET") return json(200, { templates, products });
    if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Unreadable request" }); }
    let next = { templates, products };
    if (body.template) {
      const t = cleanTemplate(body.template);
      if (!t) return json(400, { error: "A template needs a name" });
      next.templates = upsert(templates, t, MAX_TEMPLATES);
    } else if (body.product) {
      const p = cleanProduct(body.product);
      if (!p) return json(400, { error: "A product needs a name" });
      next.products = upsert(products, p, MAX_PRODUCTS);
    } else if (body.remove === "template" || body.remove === "product") {
      const nm = C(body.name, 200).toLowerCase();
      const k = body.remove === "template" ? "templates" : "products";
      next[k] = next[k].filter((x) => String(x && x.name).toLowerCase() !== nm);
    } else {
      return json(400, { error: "Nothing to save" });
    }
    next.updatedAt = new Date().toISOString();
    await store.setJSON(KEY, next);
    return json(200, { templates: next.templates, products: next.products });
  } catch (err) {
    console.error("price-book error:", err && err.message);
    return json(500, { error: "Price book request failed" });
  }
};

function cors() {
  return {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-sbc-key",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
}
function json(code, obj) { return { statusCode: code, headers: cors(), body: JSON.stringify(obj) }; }

module.exports.cleanTemplate = cleanTemplate;
module.exports.cleanProduct = cleanProduct;
