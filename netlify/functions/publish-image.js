// netlify/functions/publish-image.js
// Commits an optimized image into the sani-website repo's images/ folder via the
// GitHub Contents API. Because pages already reference standard image paths
// (e.g. images/services-strip/kitchen.jpg), writing to that exact path makes the
// page pick up the new image on the next Netlify deploy (~1 min) — no HTML edits.
//
// POST { path: "images/services-strip/kitchen.jpg",
//        imageBase64: "data:image/jpeg;base64,....",
//        message?: "Image Studio: kitchen strip" }
//
// Requires Netlify env var: GITHUB_TOKEN (Contents: Read & Write on the repo).
// Safety: this function will ONLY write image files inside images/.

const GH_OWNER = process.env.GITHUB_OWNER || "sanibuildingcorp";
const GH_REPO = process.env.GITHUB_REPO || "sani-website";
const GH_BRANCH = process.env.GITHUB_BRANCH || "main";

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { error: "POST only" });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return json(500, { error: "GITHUB_TOKEN is not set. Add it in Netlify → Site settings → Environment variables." });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return json(400, { error: "Invalid request body" });
  }

  let path = String(body.path || "").trim().replace(/^\/+/, "");
  const imageBase64 = body.imageBase64 || "";

  // Safety: only image files inside images/, and no path traversal.
  if (path.indexOf("..") !== -1 || !/^images\/[A-Za-z0-9_\-\/]+\.(jpg|jpeg|png|webp)$/.test(path)) {
    return json(400, { error: "Destination must be an image inside images/ (.jpg .jpeg .png .webp). Got: " + path });
  }

  // Pull the raw base64 (strip any data: prefix and whitespace).
  let contentB64 = String(imageBase64);
  const ci = contentB64.indexOf("base64,");
  if (ci !== -1) contentB64 = contentB64.slice(ci + 7);
  contentB64 = contentB64.replace(/\s+/g, "");
  if (contentB64.length < 100) {
    return json(400, { error: "Image data missing or too small" });
  }

  const ghHeaders = {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "User-Agent": "Sani-Image-Studio",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  // Encode each path segment but keep the slashes.
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const apiBase = "https://api.github.com/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" + encodedPath;

  try {
    // STEP 1 — get the current file SHA (needed to overwrite an existing image)
    let sha = null;
    const getRes = await fetch(apiBase + "?ref=" + encodeURIComponent(GH_BRANCH), { headers: ghHeaders });
    if (getRes.ok) {
      const existing = await getRes.json();
      sha = existing.sha || null;
    } else if (getRes.status === 401 || getRes.status === 403) {
      return json(getRes.status, { error: "GitHub rejected the token. Check GITHUB_TOKEN has Contents: Read & Write on the repo." });
    } // 404 -> brand new file, no sha

    // STEP 2 — commit
    const commitBody = {
      message: body.message || ("Image Studio: update " + path),
      content: contentB64,
      branch: GH_BRANCH,
    };
    if (sha) commitBody.sha = sha;

    const putRes = await fetch(apiBase, {
      method: "PUT",
      headers: Object.assign({}, ghHeaders, { "Content-Type": "application/json" }),
      body: JSON.stringify(commitBody),
    });

    const putData = await putRes.json().catch(function () { return {}; });

    if (!putRes.ok) {
      let msg = (putData && putData.message) || ("GitHub returned " + putRes.status);
      if (putRes.status === 409) msg = "The file changed on GitHub since we read it. Please try Publish again.";
      if (putRes.status === 401 || putRes.status === 403) msg = "GitHub rejected the token (check permissions).";
      return json(putRes.status, { error: msg });
    }

    const commit = putData.commit || {};
    return json(200, {
      success: true,
      path: path,
      replaced: !!sha,
      commitUrl: commit.html_url || ("https://github.com/" + GH_OWNER + "/" + GH_REPO + "/commits/" + GH_BRANCH),
      message: "Committed to GitHub. Netlify will deploy the update in about a minute.",
    });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(statusCode, obj) {
  return {
    statusCode,
    headers: Object.assign({ "Content-Type": "application/json" }, cors()),
    body: JSON.stringify(obj),
  };
}
