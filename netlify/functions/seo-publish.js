// netlify/functions/seo-publish.js
// Publishes an approved, optimized page straight to GitHub — no manual download/upload.
// POST { slug: "bathroom-renovation", html: "<!DOCTYPE html>..." }
//   -> commits the HTML to the matching service-page file in the repo.
//   -> Netlify auto-deploys on the new commit, so the live page updates in ~1 minute.
//
// CONTRACTOR ONLY: POST with header  x-sbc-key: <DASHBOARD_KEY>.
//
// Requires Netlify env var: GITHUB_TOKEN  (a GitHub Personal Access Token with
// Contents: Read & Write permission on the sani-website repo).

const { requireDashboardKey } = require("./lib/require-dashboard-key");

const GH_OWNER = process.env.GITHUB_OWNER || "sanibuildingcorp";
const GH_REPO = process.env.GITHUB_REPO || "sani-website";
const GH_BRANCH = process.env.GITHUB_BRANCH || "main";

// Whitelist — the ONLY files this function is allowed to write.
// (Keeps the token from ever touching anything else in the repo.)
const ALLOWED = {
  "bathroom-renovation": "bathroom-renovation.html",
  "kitchen-renovation": "kitchen-renovation.html",
  "painting": "painting.html",
  "flooring": "flooring.html",
  "carpentry": "carpentry.html",
  "handyman": "handyman.html",
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { error: "POST only" });
  }

  /* CONTRACTOR ONLY. This commits straight to the GitHub repo with GITHUB_TOKEN
     and had no inbound gate: anyone who knew the URL could overwrite any service
     page on the live site, using Sani's own write token. Called from
     seo-content.html, which sends the key via sbcFetch(). */
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;

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

  const slug = body.slug;
  const html = body.html;
  const path = ALLOWED[slug];

  if (!path) {
    return json(400, { error: "Unknown or not-allowed page: " + slug });
  }
  if (!html || typeof html !== "string" || html.length < 200) {
    return json(400, { error: "Missing or too-short HTML content" });
  }
  // Basic sanity: must look like a full HTML doc
  if (!/<html[\s\S]*<\/html>/i.test(html)) {
    return json(400, { error: "Content does not look like a complete HTML page — not published." });
  }

  const ghHeaders = {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "User-Agent": "Sani-SEO-Publisher",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const apiBase = "https://api.github.com/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" + encodeURIComponent(path);

  try {
    // STEP 1 — get the current file SHA (required to update an existing file)
    let sha = null;
    const getRes = await fetch(apiBase + "?ref=" + encodeURIComponent(GH_BRANCH), { headers: ghHeaders });
    if (getRes.ok) {
      const existing = await getRes.json();
      sha = existing.sha || null;
    } else if (getRes.status === 401 || getRes.status === 403) {
      return json(getRes.status, { error: "GitHub rejected the token. Check that GITHUB_TOKEN is valid and has Contents: Read & Write permission on the repo." });
    } else if (getRes.status === 404) {
      // File not found — we'll create it fresh (no sha)
      sha = null;
    }

    // STEP 2 — commit the new content
    const contentB64 = Buffer.from(html, "utf8").toString("base64");
    const commitBody = {
      message: "SEO update: " + slug + " via Content Studio",
      content: contentB64,
      branch: GH_BRANCH,
    };
    if (sha) commitBody.sha = sha;

    const putRes = await fetch(apiBase, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
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
      committed: !!putData.content,
      commitSha: commit.sha || null,
      commitUrl: commit.html_url || ("https://github.com/" + GH_OWNER + "/" + GH_REPO + "/commits/" + GH_BRANCH),
      message: "Published to GitHub. Netlify will deploy the update in about a minute.",
    });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-sbc-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...cors() },
    body: JSON.stringify(obj),
  };
}
