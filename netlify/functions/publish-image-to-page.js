// netlify/functions/publish-image-to-page.js
// Commits a generated image to a local images/ path AND safely rewrites the ONE matching
// reference in the page's HTML to that path, setting alt text for <img> slots.
// Used when localizing an external photo, changing a path, or editing alt.
//
// POST {
//   page:        "painting"            // slug ("" or "index" = home)
//   repoFile?:   "painting.html"       // optional explicit file
//   imageBase64: "data:image/jpeg..."  // the optimized image
//   newPath:     "images/hero/painting.jpg"
//   currentRef:  "https://images.unsplash.com/photo-...."  // exact string in the HTML
//   kind:        "img" | "background"
//   alt?:        "Freshly painted modern living room"      // only for img
// }
// Requires GITHUB_TOKEN (Contents: Read & Write).

const GH_OWNER = process.env.GITHUB_OWNER || "sanibuildingcorp";
const GH_REPO = process.env.GITHUB_REPO || "sani-website";
const GH_BRANCH = process.env.GITHUB_BRANCH || "main";

const { requireDashboardKey } = require("./lib/require-dashboard-key");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  /* CONTRACTOR ONLY. This commits to the GitHub repo with GITHUB_TOKEN and had
     no inbound gate: anyone who knew the URL could commit arbitrary image bytes
     and rewrite page HTML on the live site, using Sani's own write token.
     Called from image-studio.html and page-editor.html via sbcFetch(). */
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;

  const token = process.env.GITHUB_TOKEN;
  if (!token) return json(500, { error: "GITHUB_TOKEN is not set." });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return json(400, { error: "Invalid request body" }); }

  // ── BATCH MODE: { files: [{ path, imageBase64 }, ...] } → ONE commit, ONE deploy ──
  if (Array.isArray(body.files)) {
    const gh = {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "User-Agent": "Sani-Image-Studio",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const files = body.files;
    if (files.length === 0) return json(400, { error: "Queue is empty" });
    if (files.length > 15) return json(400, { error: "Max 15 photos per batch — publish in two batches." });
    const clean = [];
    for (let i = 0; i < files.length; i++) {
      const p = String(files[i].path || "").trim().replace(/^\/+/, "").split("?")[0].split("#")[0];
      if (p.indexOf("..") !== -1 || !/^images\/[A-Za-z0-9_\-\/]+\.(jpg|jpeg|png|webp)$/i.test(p)) {
        return json(400, { error: "Bad path in queue item " + (i + 1) + ": " + p });
      }
      let b64 = String(files[i].imageBase64 || "");
      const bi = b64.indexOf("base64,");
      if (bi !== -1) b64 = b64.slice(bi + 7);
      b64 = b64.replace(/\s+/g, "");
      if (b64.length < 100) return json(400, { error: "Image data missing for " + p });
      clean.push({ path: p, b64: b64 });
    }
    try {
      const base = "https://api.github.com/repos/" + GH_OWNER + "/" + GH_REPO;
      const hdr = Object.assign({}, gh, { "Content-Type": "application/json" });
      const refRes = await fetch(base + "/git/ref/heads/" + GH_BRANCH, { headers: gh });
      if (!refRes.ok) return json(refRes.status, { error: "Couldn't read branch ref (" + refRes.status + ")" });
      const headSha = (await refRes.json()).object.sha;
      const comRes = await fetch(base + "/git/commits/" + headSha, { headers: gh });
      if (!comRes.ok) return json(comRes.status, { error: "Couldn't read head commit" });
      const baseTree = (await comRes.json()).tree.sha;
      const treeItems = [];
      for (const f of clean) {
        const bRes = await fetch(base + "/git/blobs", { method: "POST", headers: hdr, body: JSON.stringify({ content: f.b64, encoding: "base64" }) });
        if (!bRes.ok) return json(bRes.status, { error: "Blob upload failed for " + f.path });
        treeItems.push({ path: f.path, mode: "100644", type: "blob", sha: (await bRes.json()).sha });
      }
      const tRes = await fetch(base + "/git/trees", { method: "POST", headers: hdr, body: JSON.stringify({ base_tree: baseTree, tree: treeItems }) });
      if (!tRes.ok) return json(tRes.status, { error: "Tree creation failed" });
      const treeSha = (await tRes.json()).sha;
      const msg = "Image Studio batch: " + clean.length + " photo" + (clean.length > 1 ? "s" : "");
      const cRes = await fetch(base + "/git/commits", { method: "POST", headers: hdr, body: JSON.stringify({ message: msg, tree: treeSha, parents: [headSha] }) });
      if (!cRes.ok) return json(cRes.status, { error: "Commit creation failed" });
      const newSha = (await cRes.json()).sha;
      const uRes = await fetch(base + "/git/refs/heads/" + GH_BRANCH, { method: "PATCH", headers: hdr, body: JSON.stringify({ sha: newSha }) });
      if (!uRes.ok) return json(uRes.status, { error: "Branch update failed — nothing was published, try again." });
      return json(200, {
        success: true,
        batch: clean.length,
        paths: clean.map(function (f) { return f.path; }),
        message: clean.length + " photos published in ONE commit — one deploy, live in ~1 minute.",
      });
    } catch (err) {
      return json(500, { error: err.message });
    }
  }

  const rawNewPath = String(body.newPath || "").trim().replace(/^\/+/, "");
  const filePath = rawNewPath.split("?")[0].split("#")[0];
  if (filePath.indexOf("..") !== -1 || !/^images\/[A-Za-z0-9_\-\/]+\.(jpg|jpeg|png|webp)$/i.test(filePath)) {
    return json(400, { error: "Path must be an image inside images/ (.jpg .jpeg .png .webp). Got: " + filePath });
  }

  // raw base64
  let contentB64 = String(body.imageBase64 || "");
  const ci = contentB64.indexOf("base64,");
  if (ci !== -1) contentB64 = contentB64.slice(ci + 7);
  contentB64 = contentB64.replace(/\s+/g, "");
  if (contentB64.length < 100) return json(400, { error: "Image data missing or too small" });

  const gh = {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "User-Agent": "Sani-Image-Studio",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  try {
    // ── STEP 1: commit the image file ──────────────────────────────
    const imgCommit = await putFile(gh, filePath, contentB64, "Image Studio: " + filePath, true);
    if (imgCommit.error) return json(imgCommit.status || 500, { error: imgCommit.error });

    // ── STEP 2: patch the page HTML (only if asked + currentRef given) ──
    const currentRef = body.currentRef || "";
    const repoFile = resolveFile(body.repoFile, body.page);
    let pagePatched = false;
    let warning = "";

    if (currentRef && repoFile) {
      const fileApi = "https://api.github.com/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" + encPath(repoFile);
      const getRes = await fetch(fileApi + "?ref=" + encodeURIComponent(GH_BRANCH), { headers: gh });
      if (!getRes.ok) {
        warning = "Couldn't open " + repoFile + " to update its link — image saved, set the path on the page manually.";
      } else {
        const meta = await getRes.json();
        let pageHtml = Buffer.from(meta.content || "", "base64").toString("utf8");

        const occurrences = pageHtml.split(currentRef).length - 1;
        if (occurrences === 0) {
          warning = "Couldn't find the original photo reference on " + repoFile + " — image saved, but the page link wasn't changed.";
        } else if (occurrences > 1) {
          warning = "That photo appears " + occurrences + " times on " + repoFile + " — image saved, but the page link wasn't changed (to avoid touching the wrong one).";
        } else {
          // unique — safe to patch. Add a version stamp so browsers/CDN reload it.
          const htmlVal = filePath + "?v=" + Date.now();
          pageHtml = pageHtml.split(currentRef).join(htmlVal);

          // For <img>, also set alt within the now-updated tag (match by clean file path)
          if (body.kind === "img" && typeof body.alt === "string") {
            const tagRe = new RegExp("<img\\b[^>]*?" + escapeRe(filePath) + "[^>]*?>", "i");
            pageHtml = pageHtml.replace(tagRe, function (tag) {
              const altVal = escAttr(body.alt);
              if (/\balt\s*=\s*["'][^"']*["']/i.test(tag)) {
                return tag.replace(/\balt\s*=\s*["'][^"']*["']/i, 'alt="' + altVal + '"');
              }
              return tag.replace(/<img\b/i, '<img alt="' + altVal + '"');
            });
          }

          const putPage = await putFileRaw(gh, repoFile, Buffer.from(pageHtml, "utf8").toString("base64"),
            "Image Studio: point " + repoFile + " to " + filePath, meta.sha);
          if (putPage.error) warning = "Image saved, but updating " + repoFile + " failed: " + putPage.error;
          else pagePatched = true;
        }
      }
    }

    return json(200, {
      success: true,
      path: filePath,
      pagePatched: pagePatched,
      warning: warning,
      commitUrl: imgCommit.commitUrl,
      message: pagePatched
        ? "Image saved and " + (repoFile || "page") + " updated. Live in ~1 minute."
        : "Image saved. Live in ~1 minute." + (warning ? " Note: " + warning : ""),
    });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

// commit a file; if getShaFirst, fetch existing sha to overwrite
async function putFile(gh, path, contentB64, message, getShaFirst) {
  const api = "https://api.github.com/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" + encPath(path);
  let sha = null;
  if (getShaFirst) {
    const r = await fetch(api + "?ref=" + encodeURIComponent(GH_BRANCH), { headers: gh });
    if (r.ok) { const e = await r.json(); sha = e.sha || null; }
    else if (r.status === 401 || r.status === 403) return { error: "GitHub rejected the token (permissions).", status: r.status };
  }
  return putFileRaw(gh, path, contentB64, message, sha);
}

async function putFileRaw(gh, path, contentB64, message, sha) {
  const api = "https://api.github.com/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" + encPath(path);
  const commitBody = { message: message, content: contentB64, branch: GH_BRANCH };
  if (sha) commitBody.sha = sha;
  const r = await fetch(api, { method: "PUT", headers: Object.assign({}, gh, { "Content-Type": "application/json" }), body: JSON.stringify(commitBody) });
  const d = await r.json().catch(function () { return {}; });
  if (!r.ok) {
    let msg = (d && d.message) || ("GitHub " + r.status);
    if (r.status === 409) msg = "File changed on GitHub since read — try again.";
    return { error: msg, status: r.status };
  }
  return { commitUrl: (d.commit && d.commit.html_url) || null };
}

function resolveFile(repoFile, slug) {
  if (repoFile) return String(repoFile).replace(/^\/+/, "");
  const s = String(slug || "").trim();
  if (!s || s === "index" || s === "home") return "index.html";
  if (s === "bathroom-floor-tile" || s === "bathroom-floor-tile-installation") return "bathroom-floor-tile-installation.html";
  return s.replace(/^\//, "") + ".html";
}
function encPath(p) { return p.split("/").map(encodeURIComponent).join("/"); }
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function escAttr(s) { return String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
}
function json(statusCode, obj) {
  return { statusCode, headers: Object.assign({ "Content-Type": "application/json" }, cors()), body: JSON.stringify(obj) };
}
