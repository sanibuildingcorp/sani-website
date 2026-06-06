// netlify/functions/image-context.js
// Two jobs for the Image Studio:
//   action "list"    -> fetch a live page, return its replaceable images (those under
//                       images/) with the nearby heading/section as context.
//   action "suggest" -> read the page topic + chosen image slot, ask gpt-4o-mini for a
//                       photorealistic prompt + best orientation for that slot.
//
// POST { action:"list", page:"bathroom-renovation" }
// POST { action:"suggest", page, src, alt, context, pageTitle }
// Requires Netlify env var: OPENAI_API_KEY  (only for "suggest")

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

  let html = "";
  let res = await fetch(url, { headers: { "User-Agent": "SaniImageStudio/1.0" } });
  if (!res.ok && url.indexOf(".html") === -1) {
    res = await fetch(url.replace(/\/$/, "") + ".html", { headers: { "User-Agent": "SaniImageStudio/1.0" } });
  }
  if (res.ok) html = await res.text();
  if (!html) return json(200, { pageTitle: slug, images: [], note: "Could not load that page." });

  const pageTitle = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || slug;
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "";

  const images = [];
  const seen = {};
  const imgRe = /<img\b[^>]*>/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[0];
    const srcRaw = (tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
    const alt = strip((tag.match(/\balt\s*=\s*["']([^"']*)["']/i) || [])[1] || "");
    const path = normalizePath(srcRaw);
    if (!path || !/^images\//.test(path)) continue;          // only replaceable local images
    if (/\.svg$/i.test(path)) continue;                       // skip icons/logos
    if (seen[path]) continue;
    seen[path] = true;

    // nearest preceding heading for context
    const before = html.slice(0, m.index);
    const hMatch = before.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>(?![\s\S]*<h[1-3])/i);
    const heading = hMatch ? strip(hMatch[1]) : "";

    images.push({
      path: path,                                  // repo path to write to
      displaySrc: SITE_ORIGIN + "/" + path,        // absolute, for thumbnail
      alt: alt,
      context: heading || alt || "",
    });
  }

  return json(200, { pageTitle: strip(pageTitle), h1: strip(h1), images: images });
}

// ─────────────────────────────────────────────────────────────
async function suggestPrompt(body) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return json(500, { error: "OPENAI_API_KEY not set" });

  const sys = "You write prompts for an AI image generator, for a New York City renovation "
    + "and handyman contractor's website (Sani Building Corp). Given the page topic and one "
    + "image slot on that page, write ONE concise photorealistic prompt (1-2 sentences) for the "
    + "ideal photo for that slot. It must show real, finished, professional contractor work that "
    + "fits the page. No people, no text, no watermark. Also pick the best orientation: "
    + "\"hero\" (wide banner with space for text), \"wide\" (section/card), \"square\", or \"tall\". "
    + "Return ONLY JSON: {\"prompt\":\"...\",\"orientation\":\"wide\"}";

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
  let out;
  try { out = JSON.parse(txt); }
  catch (e) { out = { prompt: txt, orientation: "wide" }; }
  if (!out.orientation) out.orientation = "wide";
  return json(200, out);
}

// ─────────────────────────────────────────────────────────────
function pageUrl(slug) {
  if (!slug || slug === "index" || slug === "home" || slug === "/") return SITE_ORIGIN + "/";
  return SITE_ORIGIN + "/" + slug.replace(/^\//, "");
}
function normalizePath(src) {
  let s = String(src || "").trim();
  if (!s || s.indexOf("data:") === 0) return "";
  s = s.split("#")[0].split("?")[0];
  s = s.replace(/^https?:\/\/[^/]+\//i, "");   // drop origin
  s = s.replace(/^\/+/, "");                    // drop leading slash
  return s;
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
