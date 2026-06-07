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
    let path, displaySrc, isExternal;

    if (isLocal) {
      path = normalized;
      displaySrc = SITE_ORIGIN + "/" + normalized;
      isExternal = false;
      usedPaths[path] = true;
    } else {
      isExternal = true;
      displaySrc = /^https?:\/\//i.test(rawRef) ? rawRef : (SITE_ORIGIN + "/" + normalized);
      const base = slugify(context || alt || (kind === "background" ? "bg" : "photo")) || ("photo-" + counter);
      path = uniqueLocalPath((kind === "background" && /hero/i.test(context || "")) ? "hero" : base);
    }

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
    pushItem(src, alt, heading || alt, "img");
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

  const sys = "You write prompts for an AI image generator, for a New York City renovation "
    + "and handyman contractor's website (Sani Building Corp). Given the page topic and one "
    + "image slot, write ONE concise photorealistic prompt (1-2 sentences) for the ideal photo "
    + "for that slot — real, finished, professional contractor work that fits the page. No people, "
    + "no text, no watermark. Also write a short SEO alt text (under 12 words) describing the photo, "
    + "and pick orientation: \"hero\", \"wide\", \"square\", or \"tall\". "
    + "Return ONLY JSON: {\"prompt\":\"...\",\"alt\":\"...\",\"orientation\":\"wide\"}";

  const user = "PAGE: " + (body.pageTitle || body.page || "") + "\n"
    + "IMAGE SLOT FILE: " + (body.src || "") + "\n"
    + "CURRENT ALT TEXT: " + (body.alt || "(none)") + "\n"
    + "NEARBY SECTION: " + (body.context || "(none)");

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
  catch (e) { outp = { prompt: txt, alt: "", orientation: "wide" }; }
  if (!outp.orientation) outp.orientation = "wide";
  if (!outp.alt) outp.alt = "";
  return json(200, outp);
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
