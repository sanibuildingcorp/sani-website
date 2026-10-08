// netlify/functions/product-search-background.js
//
// "In this brand/model/color empty box, can you add automatically product
//  link? ... when i will send estimate to the customer it's shows in
//  customer side and if customer tap finger then opens product"
// Finds ~6 real products for a finish (Claude + web search), then reads each
// product page for its photo (og:image / JSON-LD). Result lands in the
// "product-search" store under the job id; product-search.js reads it.
//
// POST { job, query, context? }   (dashboard key required)

const https = require("https");
const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");

const MODEL = process.env.PRODUCT_SEARCH_MODEL || "claude-sonnet-5";
const store = () => getStore({ name: "product-search", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
const str = (v) => String(v == null ? "" : v).trim();
const arr = (v) => (Array.isArray(v) ? v : []);

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors(), body: "{}" };
  const denied = requireDashboardKey(event, cors()); if (denied) return denied;
  let b = {}; try { b = JSON.parse(event.body || "{}"); } catch (_) {}
  const id = /^[A-Za-z0-9_-]{6,60}$/.test(str(b.job)) ? str(b.job) : "";
  const query = str(b.query).slice(0, 200);
  if (!id || !query) return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "job and query are required" }) };
  const jobs = store();
  await jobs.setJSON(id, { status: "running", query, at: new Date().toISOString() });
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
    let items = await findProducts(query, str(b.context).slice(0, 300));
    items = await Promise.all(items.map(async (p) => Object.assign(p, { photo: p.photo || (await pagePhoto(p.url)) })));
    await jobs.setJSON(id, { status: "done", query, items, at: new Date().toISOString() });
  } catch (e) {
    await jobs.setJSON(id, { status: "error", query, error: str(e && e.message) || "search failed", at: new Date().toISOString() });
  }
  return { statusCode: 202, headers: cors(), body: JSON.stringify({ ok: true }) };
};

async function findProducts(query, context) {
  const prompt = `Find real products a renovation contractor in New York could buy for: "${query}"${context ? " (job: " + context + ")" : ""}.
Use web search. Prefer product pages (not category or search pages) from Home Depot, Lowe's, Floor & Decor, Wayfair, Build.com, Ferguson, TileBar, Amazon, or the manufacturer.
Return up to 6 different products that match the size/material asked for. Return JSON only, no other text:
{"items":[{"name":"short product name with brand and size","brand":"","store":"Home Depot","price":"$29.98 or empty","url":"https://exact product page","image":"https://direct image URL if you saw one, else empty"}]}`;
  const payload = JSON.stringify({ model: MODEL, max_tokens: 3000,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
    messages: [{ role: "user", content: prompt }] });
  const j = await post("api.anthropic.com", "/v1/messages", payload, { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" });
  if (j.error) throw new Error(j.error.message || "AI error");
  const text = arr(j.content).filter((c) => c && c.type === "text").map((c) => c.text).join("");
  const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error("No products found - try other words");
  let o; try { o = JSON.parse(m[0]); } catch (_) { throw new Error("No products found - try other words"); }
  const seen = new Set();
  return arr(o.items).map((p) => ({ name: str(p.name).slice(0, 120), brand: str(p.brand).slice(0, 60), store: str(p.store).slice(0, 40),
      price: str(p.price).slice(0, 20), url: str(p.url), photo: /^https:\/\/\S+$/i.test(str(p.image)) ? str(p.image) : "" }))
    .filter((p) => p.name && /^https:\/\/[^\s"'<>]+$/i.test(p.url) && !seen.has(p.url) && seen.add(p.url)).slice(0, 6);
}

/* The product page's own photo: og:image, twitter:image or JSON-LD "image". */
function pagePhoto(url) {
  return new Promise((resolve) => {
    let done = false; const fin = (v) => { if (!done) { done = true; resolve(v || ""); } };
    setTimeout(() => fin(""), 7000);
    try {
      const u = new URL(url);
      const req = https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept": "text/html", "Accept-Language": "en-US" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return pagePhoto(new URL(res.headers.location, url).href).then(fin); }
        let html = ""; res.setEncoding("utf8");
        res.on("data", (c) => { html += c; if (html.length > 600000) { res.destroy(); look(); } });
        res.on("end", look); res.on("error", () => fin(""));
        function look() {
          const meta = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*>/i);
          let src = meta && (meta[0].match(/content=["']([^"']+)["']/i) || [])[1];
          if (!src) { const ld = html.match(/"image"\s*:\s*(?:\[\s*)?"(https:[^"]+)"/i); src = ld && ld[1]; }
          src = str(src).replace(/&amp;/g, "&");
          if (src.startsWith("//")) src = "https:" + src;
          fin(/^https:\/\/[^\s"'<>]+$/i.test(src) ? src : "");
        }
      });
      req.on("error", () => fin(""));
    } catch (_) { fin(""); }
  });
}

function post(host, path, payload, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: host, path, method: "POST", headers: Object.assign({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }, headers) }, (res) => {
      const ch = []; res.on("data", (c) => ch.push(c));
      res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(ch).toString("utf8"))); } catch (e) { reject(new Error("AI answered HTTP " + res.statusCode)); } });
    });
    req.setTimeout(300000, () => req.destroy(new Error("The search took too long")));
    req.on("error", reject); req.write(payload); req.end();
  });
}
function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" }; }
