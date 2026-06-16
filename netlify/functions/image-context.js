// netlify/functions/image-context.js
// Image Studio brain. Two actions:
//   "list"    -> fetch a live page, return EVERY image it uses: local <img>, local CSS
//                backgrounds, AND external (e.g. Unsplash) images. Each item carries the
//                exact reference string (for safe HTML patching), current alt, a suggested
//                local target path, and whether it's external.
//   "suggest" -> gpt-4o-mini drafts a photorealistic prompt + orientation for a chosen slot.
//
// POST { action:"list", page:"painting" }
// POST { action:"suggest", page, src, alt, context, pageTitle }
// Requires OPENAI_API_KEY (only for "suggest").

const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://www.sanibuildingcorp.com";

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return json(400, { error: "Invalid request body" }); }

  try {
    if (body.action === "list") return await listImages(body);
    if (body.action === "suggest") return await suggestPrompt(body);
    if (body.action === "research") return await researchKeywords(body);
    return json(400, { error: "Unknown action" });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
async function listImages(body) {
  const slug = String(body.page || "").trim();
  const url = pageUrl(slug);
  const dir = (slug && slug !== "index" && slug !== "home") ? slug : "home";

  let html = "";
  let res = await fetch(url, { headers: { "User-Agent": "SaniImageStudio/1.0" } });
  if (!res.ok && url.indexOf(".html") === -1) {
    res = await fetch(url.replace(/\/$/, "") + ".html", { headers: { "User-Agent": "SaniImageStudio/1.0" } });
  }
  if (res.ok) html = await res.text();
  if (!html) return json(200, { pageTitle: slug, images: [], note: "Could not load that page." });

  const pageTitle = strip((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || slug);

  const out = [];
  const seenRef = {};
  const usedPaths = {};
  let counter = 0;

  // ── Find images that are only a HIDDEN FALLBACK LAYER ──
  // A CSS background can stack several images (e.g. background: photoA, photoB). Only the
  // FIRST image layer paints; the rest sit underneath and never show. We list only the
  // visible top layer so the studio mirrors what's actually on the live page — no phantom
  // "photos" that a visitor (or you) never see. <img> tags and single backgrounds are
  // always visible; empty/missing slots are kept so you still know where to upload.
  const varMap = {};
  (function () {
    const vre = /(--[a-z0-9\-]+)\s*:\s*url\(\s*['"]?([^'")]+?)['"]?\s*\)/gi;
    let v;
    while ((v = vre.exec(html)) !== null) varMap[v[1]] = v[2].trim();
  })();
  function splitLayers(value) {
    const layers = []; let depth = 0, cur = "";
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (ch === "(") { depth++; cur += ch; }
      else if (ch === ")") { depth--; cur += ch; }
      else if (ch === "," && depth === 0) { layers.push(cur); cur = ""; }
      else cur += ch;
    }
    if (cur.trim()) layers.push(cur);
    return layers;
  }
  function layerImagePath(layer) {
    const um = layer.match(/url\(\s*['"]?([^'")]+?)['"]?\s*\)/i);
    if (um) return normalizePath(um[1].trim());
    const vr = layer.match(/var\(\s*(--[a-z0-9\-]+)\s*\)/i);
    if (vr && varMap[vr[1]]) return normalizePath(varMap[vr[1]]);
    return "";
  }
  const visiblePaths = {};
  const fallbackPaths = {};
  (function () {
    // <img> srcs are always a real visible spot
    const ire = /<img\b[^>]*>/gi; let im;
    while ((im = ire.exec(html)) !== null) {
      const s = (im[0].match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
      const p = normalizePath(s);
      if (/^images\//.test(p)) visiblePaths[p] = true;
    }
    // background / background-image declarations (inline styles use single-quoted url(),
    // so the value safely ends at ; } or the attribute's closing ")
    const bre = /background(?:-image)?\s*:\s*([^;}"]+)/gi; let bm;
    while ((bm = bre.exec(html)) !== null) {
      let firstImg = true;
      const layers = splitLayers(bm[1]);
      for (let i = 0; i < layers.length; i++) {
        const p = layerImagePath(layers[i]);
        if (!p || !/^images\//.test(p)) continue; // gradients / external aren't image layers
        if (firstImg) { visiblePaths[p] = true; firstImg = false; }
        else fallbackPaths[p] = true;
      }
    }
  })();

  function uniqueLocalPath(base) {
    let p = "images/" + dir + "/" + base + ".jpg";
    let n = 2;
    while (usedPaths[p]) { p = "images/" + dir + "/" + base + "-" + n + ".jpg"; n++; }
    usedPaths[p] = true;
    return p;
  }

  function pushItem(rawRef, alt, context, kind) {
    if (!rawRef) return;
    if (rawRef.indexOf("data:") === 0 || rawRef.charAt(0) === "#") return;  // skip data/svg-ref
    if (/\.svg(\?|$)/i.test(rawRef)) return;                                 // skip svg icons
    if (seenRef[rawRef]) return;
    if (!/\.(jpg|jpeg|png|webp)(\?|$)/i.test(rawRef) && !/images\//i.test(rawRef) && !/unsplash|cloudinary|imgix|githubusercontent/i.test(rawRef)) return;
    seenRef[rawRef] = true;
    counter++;

    const normalized = normalizePath(rawRef);
    const isLocal = /^images\//.test(normalized);

    // Only list LOCAL images you can actually edit. External / hotlinked images
    // (Unsplash, and absolute self-URLs used as CSS fallbacks in the hero) are NOT
    // shown as cards — otherwise every fallback url() becomes a junk "bg N" card that
    // points at no real file. This is what flooded the Home page with wrong photos.
    if (!isLocal) return;

    const path = normalized;
    // Same file can be referenced two ways — a relative path AND a full
    // https://www.sanibuildingcorp.com/images/... URL (a CSS fallback). Both normalize
    // to the same local file, so list it once (this is why the hero showed twice).
    if (usedPaths[path]) return;

    // Skip images that ONLY ever sit as a hidden fallback layer under another photo —
    // they never render, so they're not a real spot. (Kept if they're also used visibly.)
    if (fallbackPaths[path] && !visiblePaths[path]) return;

    const displaySrc = SITE_ORIGIN + "/" + normalized;
    const isExternal = false;
    usedPaths[path] = true;

    out.push({
      ref: rawRef,                 // exact string in the page HTML (for patching)
      path: path,                  // local target path to publish to
      displaySrc: displaySrc,      // thumbnail
      alt: alt || "",
      context: context || prettyFromPath(path),
      kind: kind,                  // "img" | "background"
      isExternal: isExternal,
    });
  }

  // PASS 1 — <img> tags
  const imgRe = /<img\b[^>]*>/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[0];
    const src = (tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1]
             || (tag.match(/\bdata-src\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
    const alt = strip((tag.match(/\balt\s*=\s*["']([^"']*)["']/i) || [])[1] || "");
    const before = html.slice(0, m.index);
    const hMatch = before.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>(?![\s\S]*<h[1-3])/i);
    const heading = hMatch ? strip(hMatch[1]) : "";
    // Label each photo by its own file path (e.g. "Projects: project 1") so every
    // card is unique. Reusing the nearest <h2> made 8 different photos all read the
    // same. The alt text is still captured below and shown under the card.
    pushItem(src, alt, null, "img");
  }

  // PASS 2 — CSS background url(...) (inline style + <style> blocks)
  const urlRe = /url\(\s*['"]?([^'")]+?)['"]?\s*\)/gi;
  let u;
  while ((u = urlRe.exec(html)) !== null) {
    pushItem(u[1].trim(), "", null, "background");
  }

  return json(200, { pageTitle: pageTitle, images: out });
}

// ─────────────────────────────────────────────────────────────
async function suggestPrompt(body) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return json(500, { error: "OPENAI_API_KEY not set" });

  // Pull keywords. Prefer keywords for THIS page; fall back to site-wide.
  const kwData = await pageQueries(body.page || "");
  const kwList = kwData.list.map(function (k) { return k.query; }).slice(0, 40);
  const scope = kwData.scope; // "page" | "site" | "none"
  const kwText = kwList.length ? kwList.join(", ") : "(none available)";
  const kwNote = scope === "page"
    ? "These are the REAL Google keywords THIS page already shows for — prefer the most relevant."
    : (scope === "site"
        ? "These are SITE-WIDE keywords and may be OFF-TOPIC for this page. Use one ONLY if it genuinely fits this page's service; otherwise return an empty keywords array and write a plain descriptive alt."
        : "No keyword data — write a plain descriptive alt.");

  const sys = "You write an AI-image prompt AND SEO alt text for a New York City renovation and handyman "
    + "contractor (Sani Building Corp). RULES:\n"
    + "- The image MUST depict work that matches THIS page's own service/topic. Never change the subject to chase a "
    + "keyword (e.g., if the page is Handyman, do NOT generate a bathroom renovation just because bathroom keywords rank).\n"
    + "1) Write ONE concise photorealistic image prompt (1-2 sentences) for the ideal photo for this slot — real, "
    + "finished, professional work that matches the page topic. No people, no text, no watermark.\n"
    + "2) Write SEO alt text under 14 words describing the photo; include the single most relevant keyword ONLY if it "
    + "fits naturally and matches the page topic. Never keyword-stuff.\n"
    + "3) Pick orientation: \"hero\", \"wide\", \"square\", or \"tall\".\n"
    + "4) Return up to 5 keywords from the list that are genuinely relevant to THIS page (may be empty).\n"
    + "Return ONLY JSON: {\"prompt\":\"...\",\"alt\":\"...\",\"orientation\":\"wide\",\"keywords\":[\"...\"]}";

  const user = "PAGE: " + (body.pageTitle || body.page || "") + "\n"
    + "IMAGE SLOT FILE: " + (body.src || "") + "\n"
    + "CURRENT ALT TEXT: " + (body.alt || "(none)") + "\n"
    + "NEARBY SECTION: " + (body.context || "(none)") + "\n"
    + "KEYWORDS (" + scope + "): " + kwText + "\n"
    + "KEYWORD GUIDANCE: " + kwNote;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.6,
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    }),
  });
  const data = await res.json();
  if (data.error) return json(500, { error: "OpenAI: " + (data.error.message || "error") });

  let txt = ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "").trim();
  txt = txt.replace(/```json|```/g, "").trim();
  let outp;
  try { outp = JSON.parse(txt); }
  catch (e) { outp = { prompt: txt, alt: "", orientation: "wide", keywords: [] }; }
  if (!outp.orientation) outp.orientation = "wide";
  if (!outp.alt) outp.alt = "";
  if (!Array.isArray(outp.keywords)) outp.keywords = [];
  // Only auto-fill when keywords are page-specific — never force off-topic site keywords.
  if (!outp.keywords.length && scope === "page") outp.keywords = kwList.slice(0, 5);
  outp.keywordScope = scope;
  outp.keywordsFromGSC = kwList.length > 0;
  return json(200, outp);
}

// Google Search Console keywords from the SEO Brain. Prefers keywords for THIS page
// (seo_query_pages, matched by the page slug in the URL); falls back to site-wide queries.
async function pageQueries(slug) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return { list: [], scope: "none" };
  const h = { apikey: key, Authorization: "Bearer " + key };
  try {
    const snapRes = await fetch(url + "/rest/v1/seo_snapshots?select=id&order=fetched_at.desc&limit=1", { headers: h });
    const snaps = snapRes.ok ? await snapRes.json() : [];
    const id = snaps[0] && snaps[0].id;
    if (!id) return { list: [], scope: "none" };

    const s = String(slug || "").trim();
    if (s && s !== "index" && s !== "home") {
      const token = s.split("/").pop();
      const qpRes = await fetch(url + "/rest/v1/seo_query_pages?snapshot_id=eq." + id
        + "&page_url=ilike.*" + encodeURIComponent(token) + "*"
        + "&select=query,impressions,clicks,position&order=impressions.desc&limit=40", { headers: h });
      const qp = qpRes.ok ? await qpRes.json() : [];
      if (qp.length) return { list: qp, scope: "page" };
    }
    const qRes = await fetch(url + "/rest/v1/seo_queries?snapshot_id=eq." + id
      + "&select=query,impressions,clicks,position&order=impressions.desc&limit=40", { headers: h });
    const q = qRes.ok ? await qRes.json() : [];
    return { list: q, scope: "site" };
  } catch (e) {
    return { list: [], scope: "none" };
  }
}

// ─────────────────────────────────────────────────────────────
// LIVE keyword discovery via Serper: Google autocomplete + related searches + PAA.
// This surfaces what people ACTUALLY search (incl. terms you don't rank for yet),
// unlike Search Console which only shows queries you already appear for.
async function researchKeywords(body) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return json(400, { error: "SERPER_API_KEY not set — add it in Netlify env vars to use live keyword research." });

  const seed = String(body.seed || "").trim();
  if (!seed) return json(400, { error: "Provide a seed search term." });

  let auto = [], related = [], paa = [];
  try {
    const a = await serper("/autocomplete", { q: seed, gl: "us" });
    auto = ((a && a.suggestions) || []).map(function (x) { return (x && (x.value || x.query)) || x; });
  } catch (e) { /* ignore */ }
  try {
    const s = await serper("/search", { q: seed, gl: "us", location: "New York, New York, United States", num: 10 });
    related = ((s && s.relatedSearches) || []).map(function (x) { return x && x.query; });
    paa = ((s && s.peopleAlsoAsk) || []).map(function (x) { return x && x.question; });
  } catch (e) { /* ignore */ }

  const keywords = [];
  const seen = {};
  [].concat(auto, related).forEach(function (k) {
    k = String(k || "").trim();
    const key = k.toLowerCase();
    if (k && k.length <= 70 && !seen[key]) { seen[key] = 1; keywords.push(k); }
  });

  return json(200, {
    seed: seed,
    keywords: keywords.slice(0, 24),
    questions: paa.filter(Boolean).slice(0, 8),
  });
}

function serper(path, payload) {
  return fetch("https://google.serper.dev" + path, {
    method: "POST",
    headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(function (r) { return r.ok ? r.json() : {}; });
}

// ─────────────────────────────────────────────────────────────
function pageUrl(slug) {
  if (!slug || slug === "index" || slug === "home" || slug === "/") return SITE_ORIGIN + "/";
  return SITE_ORIGIN + "/" + slug.replace(/^\//, "");
}
function normalizePath(src) {
  let s = String(src || "").trim();
  if (!s || s.indexOf("data:") === 0) return "";
  if (s.charAt(0) === "#") return "";
  s = s.split("#")[0].split("?")[0];
  s = s.replace(/^https?:\/\/[^/]+\//i, "");
  s = s.replace(/^\.?\//, "");
  return s;
}
function prettyFromPath(path) {
  const parts = path.replace(/^images\//, "").split("/");
  const file = (parts.pop() || "").replace(/\.(jpg|jpeg|png|webp)$/i, "").replace(/[-_]/g, " ");
  const folder = parts.length ? parts[0].replace(/[-_]/g, " ") : "";
  const cap = function (s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; };
  return folder ? (cap(folder) + ": " + file) : cap(file);
}
function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
function strip(s) {
  return String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(statusCode, obj) {
  return { statusCode, headers: Object.assign({ "Content-Type": "application/json" }, cors()), body: JSON.stringify(obj) };
}
