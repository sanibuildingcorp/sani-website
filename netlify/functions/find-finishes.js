// netlify/functions/find-finishes.js
// Design-to-Materials AI layer for Sani Building Corp.
// 1) OpenAI Vision reads the Gemini render OR an uploaded customer photo ->
//    detects each finishing material with STRUCTURED characteristics
//    (category, color, finish, size, material, style),
//    an estimated QUANTITY + unit, and a Google Shopping search query.
// 2) Serper.dev Google Shopping search -> REAL store products (Home Depot, Lowe's,
//    Floor & Decor, Wayfair, etc.) with image, name, store, price, link.
// 3) Returns finish GROUPS with cheaper / default / premium real options,
//    ready to drop into the dashboard's Finishing Options (finishGroups).
//
// Body params: { image, sourceType: "render" | "photo", scopeOfWork, serviceLabel, projectTitle }
// sourceType defaults to "render" so existing callers keep working unchanged.
//
// Env vars required in Netlify: OPENAI_API_KEY, SERPER_API_KEY
// If SERPER_API_KEY is missing or a search returns nothing, that finish falls back
// to an AI price estimate (clearly marked store: "Estimate").

const https = require("https");

const TARGET_STORES = ["home depot", "lowe", "floor & decor", "floor and decor", "wayfair", "build.com", "the tile shop", "ferguson"];

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };

  try {
    const { image, sourceType, scopeOfWork, serviceLabel, projectTitle } = JSON.parse(event.body || "{}");
    const openaiKey = process.env.OPENAI_API_KEY;
    const serperKey = process.env.SERPER_API_KEY;

    if (!openaiKey) return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "OPENAI_API_KEY not set" }) };
    if (!image || typeof image !== "string" || !image.trim()) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "No image provided. Select a photo or generate an AI render first." }) };
    }
    const imageUrl = buildImageUrl(image);
    const isPhoto = String(sourceType || "render").toLowerCase() === "photo";

    /* ---------- STEP 1: VISION -> structured finishes + quantities ---------- */
    const sourceLine = isPhoto
      ? "You are looking at a customer's PHOTO of the actual space (it may be the current/before condition or an inspiration photo). Identify the visible finishing materials in the photo; where a material is being replaced per the scope, describe a comparable replacement product of the same category."
      : "You are looking at an AI render of a FINISHED renovation.";

    const visionPrompt = `You are a NYC renovation estimator. ${sourceLine}

Identify ONLY the visible FINISHING materials the customer chooses by look:
wall tile, floor tile, countertop, backsplash, vanity, cabinets, faucet/fixtures, paint color, lighting, shower glass/hardware, tub. Ignore structural/hidden/labor items.

PROJECT: ${projectTitle || serviceLabel || "Renovation"}
${serviceLabel ? "SERVICE: " + serviceLabel : ""}
${scopeOfWork ? "SCOPE:\n" + String(scopeOfWork).slice(0, 800) : ""}

For each distinct finishing material visible (2 to 5 total), describe its real characteristics and ESTIMATE the quantity needed for this job using the image + scope (rough is fine).

Return ONLY a valid JSON array, no markdown. Each element:
{
  "category": "<e.g. Floor Tile, Wall Tile, Vanity, Faucet, Countertop, Lighting>",
  "color": "<e.g. Warm Beige>",
  "finish": "<e.g. Matte / Polished / Brushed Nickel>",
  "size": "<e.g. 24x48 / 60-inch / n/a>",
  "material": "<e.g. Porcelain / Acrylic / Quartz>",
  "style": "<e.g. Modern / Subway / Floating>",
  "quantity": <number>,
  "unit": "<sqft / linear ft / each / box>",
  "searchQuery": "<best Google Shopping query, 4-7 words, specific, e.g. 'beige matte porcelain tile 24x48'>"
}`;

    const visionRaw = await postJson("api.openai.com", "/v1/chat/completions", {
      "Authorization": "Bearer " + openaiKey, "Content-Type": "application/json"
    }, JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 1600,
      temperature: 0.3,
      messages: [{ role: "user", content: [
        { type: "text", text: visionPrompt },
        { type: "image_url", image_url: { url: imageUrl, detail: "low" } }
      ] }]
    }));

    const visionData = JSON.parse(visionRaw);
    if (visionData.error) return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: visionData.error.message || "Vision error" }) };
    let vc = (visionData.choices && visionData.choices[0] && visionData.choices[0].message && visionData.choices[0].message.content) || "[]";
    vc = vc.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

    let finishes;
    try { finishes = JSON.parse(vc); if (!Array.isArray(finishes)) throw 0; }
    catch (e) { return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "Failed to read finishes from image" }) }; }
    finishes = finishes.filter(function (f) { return f && (f.category || f.searchQuery); }).slice(0, 5);
    if (!finishes.length) return { statusCode: 200, headers: cors(), body: JSON.stringify({ success: true, groups: [] }) };

    /* ---------- STEP 2: SERPER Google Shopping per finish (parallel) ---------- */
    const groups = await Promise.all(finishes.map(async function (f) {
      const qty = Math.max(1, parseFloat(f.quantity) || 1);
      const unit = f.unit || "each";
      const chars = { category: f.category || "Finish", color: f.color || "", finish: f.finish || "", size: f.size || "", material: f.material || "", style: f.style || "" };
      const query = f.searchQuery || [chars.color, chars.finish, chars.material, chars.size, chars.category].filter(Boolean).join(" ");
      const specLine = [chars.size, chars.material, chars.finish, chars.color].filter(function (x) { return x && x !== "n/a"; }).join(", ");

      let products = [];
      if (serperKey) {
        try { products = await serperShopping(serperKey, query); } catch (e) { products = []; }
      }

      let options;
      if (products.length) {
        // Prefer target stores, keep ones with a price, sort by price
        const priced = products
          .map(function (p) { return Object.assign({}, p, { _v: parsePrice(p.price) }); })
          .filter(function (p) { return p._v > 0; });
        priced.sort(function (a, b) {
          const aT = isTarget(a.source) ? 0 : 1, bT = isTarget(b.source) ? 0 : 1;
          if (aT !== bT) return aT - bT;
          return a._v - b._v;
        });
        // Take up to 6 target-priority, then sort by price for tiers
        const pool = priced.slice(0, 8).sort(function (a, b) { return a._v - b._v; });
        const picks = tier3(pool);
        options = picks.map(function (p, i) {
          const unitPrice = p._v;
          return {
            name: cleanTitle(p.title),
            spec: specLine,
            store: p.source || "",
            link: p.link || "",
            photo: p.imageUrl || "",
            unitPrice: unitPrice,
            unit: unit,
            qty: qty,
            price: Math.round(unitPrice * qty * 100) / 100, // total material cost for this finish
            isDefault: i === picks.defaultIndex
          };
        });
      } else {
        // Fallback: single AI-estimated option (clearly marked)
        options = [{
          name: [chars.color, chars.material, chars.category].filter(Boolean).join(" ") || "Selected finish",
          spec: specLine, store: "Estimate", link: "", photo: "",
          unitPrice: 0, unit: unit, qty: qty, price: 0, isDefault: true
        }];
      }

      return { name: chars.category, characteristics: chars, qty: qty, unit: unit, searchQuery: query, options: options };
    }));

    return { statusCode: 200, headers: cors(), body: JSON.stringify({ success: true, groups: groups, serper: !!serperKey }) };

  } catch (err) {
    console.error("find-finishes error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

/* pick cheaper / default(mid) / premium from a price-sorted pool */
function tier3(pool) {
  if (!pool.length) { const a = []; a.defaultIndex = 0; return a; }
  if (pool.length === 1) { const a = [pool[0]]; a.defaultIndex = 0; return a; }
  if (pool.length === 2) { const a = [pool[0], pool[1]]; a.defaultIndex = 0; return a; }
  const mid = Math.floor(pool.length / 2);
  const a = [pool[0], pool[mid], pool[pool.length - 1]];
  a.defaultIndex = 1; // middle = default
  return a;
}

function isTarget(src) {
  const s = String(src || "").toLowerCase();
  return TARGET_STORES.some(function (t) { return s.indexOf(t) !== -1; });
}
function parsePrice(p) {
  if (p == null) return 0;
  const n = parseFloat(String(p).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}
function cleanTitle(t) { return String(t || "").replace(/\s+/g, " ").trim().slice(0, 90); }

// Accept the image in any form OpenAI can use:
//  - hosted URL (http/https)  -> pass through, OpenAI fetches it
//  - data: URL                -> strip whitespace from the base64 part
//  - raw base64               -> wrap as a png data URL
function buildImageUrl(image) {
  var s = String(image || "").trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (s.indexOf("data:") === 0) {
    var c = s.indexOf(",");
    if (c > -1) return s.slice(0, c + 1) + s.slice(c + 1).replace(/\s+/g, "");
    return s;
  }
  // strip an accidental data-prefix fragment, then treat as raw base64
  s = s.replace(/^data:[^,]*,/i, "").replace(/\s+/g, "");
  return "data:image/png;base64," + s;
}

function serperShopping(apiKey, query) {
  return new Promise(function (resolve, reject) {
    const body = JSON.stringify({ q: query, gl: "us", num: 10 });
    const opts = {
      hostname: "google.serper.dev", port: 443, path: "/shopping", method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    };
    const req = https.request(opts, function (res) {
      let d = ""; res.on("data", function (c) { d += c; });
      res.on("end", function () {
        try { const j = JSON.parse(d); resolve(Array.isArray(j.shopping) ? j.shopping : []); }
        catch (e) { resolve([]); }
      });
    });
    req.on("error", reject); req.write(body); req.end();
  });
}

function postJson(hostname, path, headers, bodyStr) {
  return new Promise(function (resolve, reject) {
    const h = Object.assign({}, headers, { "Content-Length": Buffer.byteLength(bodyStr) });
    const req = https.request({ hostname: hostname, port: 443, path: path, method: "POST", headers: h }, function (res) {
      let d = ""; res.on("data", function (c) { d += c; }); res.on("end", function () { resolve(d); });
    });
    req.on("error", reject); req.write(bodyStr); req.end();
  });
}

function cors() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}
