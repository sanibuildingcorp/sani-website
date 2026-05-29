// netlify/functions/seo-content-engine.js
// READS your actual website page + combines with Google Search Console keyword data,
// then asks OpenAI to find the best-value keywords and write fully optimized page content.
//
// POST { slug: "bathroom-renovation", url: "https://www.sanibuildingcorp.com/bathroom-renovation.html", service: "Bathroom Renovation" }
//   -> fetches the live page, pulls that page's GSC keywords from Supabase,
//      asks OpenAI to produce optimized title/meta/H1/body/FAQ + target keywords,
//      saves the draft to seo_content_drafts, returns it.
//
// GET  ?slug=bathroom-renovation        -> returns the latest saved draft for that slug
// GET  (no slug)                         -> returns the list of service pages + whether a draft exists

const SERVICE_PAGES = [
  { slug: "bathroom-renovation", service: "Bathroom Renovation", path: "/bathroom-renovation.html" },
  { slug: "kitchen-renovation",  service: "Kitchen Renovation",  path: "/kitchen-renovation.html" },
  { slug: "painting",            service: "Painting",            path: "/painting.html" },
  { slug: "flooring",            service: "Flooring",            path: "/flooring.html" },
  { slug: "carpentry",           service: "Carpentry",           path: "/carpentry.html" },
  { slug: "handyman",            service: "Handyman Services",   path: "/handyman.html" },
];

const SITE_ORIGIN = "https://www.sanibuildingcorp.com";

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: cors(),
      body: "",
    };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  const supabaseHeaders = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
  };

  try {
    // ─────────────────────────────────────────────
    // GET — list service pages, or fetch a saved draft
    // ─────────────────────────────────────────────
    if (event.httpMethod === "GET") {
      const slug = (event.queryStringParameters || {}).slug;

      if (slug) {
        // Return latest saved draft for this slug
        const r = await fetch(
          `${supabaseUrl}/rest/v1/seo_content_drafts?slug=eq.${encodeURIComponent(slug)}&order=created_at.desc&limit=1`,
          { headers: supabaseHeaders }
        );
        const rows = r.ok ? await r.json() : [];
        return json(200, { draft: rows[0] || null });
      }

      // No slug: list service pages + which ones already have a draft
      let drafts = [];
      try {
        const r = await fetch(
          `${supabaseUrl}/rest/v1/seo_content_drafts?select=slug,created_at,status&order=created_at.desc`,
          { headers: supabaseHeaders }
        );
        if (r.ok) drafts = await r.json();
      } catch (e) { /* table may not exist yet */ }

      const pages = SERVICE_PAGES.map((p) => {
        const d = drafts.find((x) => x.slug === p.slug);
        return {
          ...p,
          url: SITE_ORIGIN + p.path,
          hasDraft: !!d,
          lastGenerated: d ? d.created_at : null,
          draftStatus: d ? d.status : null,
        };
      });
      return json(200, { pages });
    }

    // ─────────────────────────────────────────────
    // POST — generate optimized content for one page
    // ─────────────────────────────────────────────
    const body = JSON.parse(event.body || "{}");
    const slug = body.slug;
    const known = SERVICE_PAGES.find((p) => p.slug === slug);
    const service = body.service || (known && known.service) || slug;
    const url = body.url || (known ? SITE_ORIGIN + known.path : null);

    if (!slug || !url) {
      return json(400, { error: "slug and url are required" });
    }

    // STEP 1 — read the live page
    let pageText = "";
    let currentTitle = "";
    let currentMeta = "";
    try {
      const pageRes = await fetch(url, {
        headers: { "User-Agent": "SaniSEOBot/1.0" },
      });
      if (pageRes.ok) {
        const rawHtml = await pageRes.text();
        currentTitle = (rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
        currentMeta = (rawHtml.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i) || [])[1] || "";
        pageText = extractText(rawHtml).slice(0, 6000);
      }
    } catch (e) {
      // page fetch failed — continue with keyword data only
    }

    // STEP 2 — pull this site's GSC keyword data from Supabase
    let queries = [];
    let pageRow = null;
    try {
      const latestSnap = await fetch(
        `${supabaseUrl}/rest/v1/seo_snapshots?order=snapshot_date.desc&limit=1`,
        { headers: supabaseHeaders }
      );
      const snaps = latestSnap.ok ? await latestSnap.json() : [];
      const snapId = snaps[0] && snaps[0].id;

      if (snapId) {
        const qRes = await fetch(
          `${supabaseUrl}/rest/v1/seo_queries?snapshot_id=eq.${snapId}&order=impressions.desc&limit=60`,
          { headers: supabaseHeaders }
        );
        queries = qRes.ok ? await qRes.json() : [];

        const pRes = await fetch(
          `${supabaseUrl}/rest/v1/seo_pages?snapshot_id=eq.${snapId}&order=impressions.desc&limit=60`,
          { headers: supabaseHeaders }
        );
        const pages = pRes.ok ? await pRes.json() : [];
        pageRow = pages.find((p) => (p.page || "").includes(slug)) || null;
      }
    } catch (e) { /* keyword data optional */ }

    // Build a compact keyword table for the prompt
    const keywordLines = queries
      .map((q) => `- "${q.query}" | impressions: ${q.impressions} | clicks: ${q.clicks} | avg position: ${Number(q.position).toFixed(1)} | CTR: ${(Number(q.ctr) * 100 || 0).toFixed(1)}%`)
      .join("\n");

    // STEP 3 — ask OpenAI to find best keywords + write optimized content
    const systemPrompt =
      "You are an elite local-SEO copywriter for a New York City renovation contractor. " +
      "You write content that ranks on Google AND converts visitors into phone calls. " +
      "You write in a confident, premium, trustworthy voice. Never keyword-stuff. " +
      "Always weave keywords naturally into helpful, specific content. " +
      "Return ONLY valid JSON, no markdown, no backticks, no preamble.";

    const userPrompt = `
BUSINESS: Sani Building Corp — licensed NYC renovation contractor.
Phone: 332-277-0990. Areas: Brooklyn, Manhattan, Queens, Bronx, Long Island. 10+ years, 4.9★ (62 reviews).

SERVICE PAGE TO OPTIMIZE: ${service}
URL: ${url}

CURRENT TITLE: ${currentTitle || "(none found)"}
CURRENT META DESCRIPTION: ${currentMeta || "(none found)"}

CURRENT PAGE CONTENT (extracted text, may be truncated):
"""
${pageText || "(could not read live page — base your work on the keyword data and service type)"}
"""

GOOGLE SEARCH CONSOLE KEYWORD DATA (real searches this whole site already appears for — use this to pick the BEST-VALUE keywords for THIS service page; prioritize queries with high impressions but weak position or low CTR, and queries clearly relevant to "${service}"):
${keywordLines || "(no keyword data available yet)"}
${pageRow ? `\nThis page's own totals: impressions ${pageRow.impressions}, clicks ${pageRow.clicks}, avg position ${Number(pageRow.position).toFixed(1)}.` : ""}

TASK:
1. Choose the 6-10 best-value target keywords for THIS page (relevant to ${service} + local NYC intent). For each, say WHY in a few words (e.g. "92 impressions, position 36 — big upside").
2. Write fully optimized, ready-to-publish page content that naturally targets those keywords and drives calls.

Return ONLY this JSON shape:
{
  "targetKeywords": [ { "keyword": "", "reason": "" } ],
  "title": "SEO title tag, <= 60 chars, includes top keyword + brand",
  "metaDescription": "meta description, 150-160 chars, includes a keyword + a call to action + phone",
  "h1": "main headline for the page",
  "intro": "2-3 sentence opening paragraph",
  "sections": [ { "heading": "H2 heading", "body": "1-2 paragraphs of helpful, keyword-aware content" } ],
  "faq": [ { "question": "", "answer": "" } ],
  "internalLinks": [ "suggested anchor text -> /target-page" ],
  "imageAltSuggestions": [ "" ],
  "notes": "1-2 sentences on the strategy and the single biggest opportunity"
}
Provide 4-6 sections and 4-6 FAQ items. Keep it specific to NYC and to ${service}.`;

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.6,
        max_tokens: 2600,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      return json(502, { error: "OpenAI request failed", detail: errText.slice(0, 400) });
    }

    const openaiData = await openaiRes.json();
    let raw = (openaiData.choices && openaiData.choices[0] && openaiData.choices[0].message.content) || "";
    raw = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

    let content;
    try {
      content = JSON.parse(raw);
    } catch (e) {
      return json(502, { error: "Could not parse AI response", raw: raw.slice(0, 600) });
    }

    // STEP 4 — save the draft (best-effort; don't fail the request if the table is missing)
    let saved = null;
    try {
      const insertRes = await fetch(`${supabaseUrl}/rest/v1/seo_content_drafts`, {
        method: "POST",
        headers: { ...supabaseHeaders, Prefer: "return=representation" },
        body: JSON.stringify({
          slug: slug,
          service: service,
          url: url,
          current_title: currentTitle,
          current_meta: currentMeta,
          content: content,
          status: "draft",
        }),
      });
      if (insertRes.ok) {
        const rows = await insertRes.json();
        saved = rows[0] || null;
      }
    } catch (e) { /* ignore save errors */ }

    return json(200, {
      slug,
      service,
      url,
      currentTitle,
      currentMeta,
      keywordsAnalyzed: queries.length,
      content,
      savedId: saved ? saved.id : null,
    });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

// ── helpers ──
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}
function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...cors() },
    body: JSON.stringify(obj),
  };
}
function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
