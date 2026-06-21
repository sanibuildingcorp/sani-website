// netlify/functions/seo-content-engine.js
// READS your actual website page + combines with Google Search Console keyword data,
// then asks OpenAI to find the best-value keywords and write fully optimized page content.
//
// POST { slug: "bathroom-renovation", url: "https://www.sanibuildingcorp.com/bathroom-renovation.html", service: "Bathroom Renovation" }
//   -> reads the page (GitHub first, live fetch as fallback), pulls that page's GSC keywords from Supabase,
//      asks OpenAI to produce optimized title/meta/H1/body/FAQ + target keywords,
//      saves the draft to seo_content_drafts, returns it.
//   Optional body.selectedKeywords: [{ keyword, volume, competition }] — hand-picked live
//   Keyword Planner keywords the AI is REQUIRED to use in title/H1/headings/body.
//
// GET  ?slug=bathroom-renovation        -> returns the latest saved draft for that slug
// GET  (no slug)                         -> returns the list of service pages + whether a draft exists

const SERVICE_PAGES = [
  // ── Main service pages ──
  { slug: "bathroom-renovation", service: "Bathroom Renovation", path: "/bathroom-renovation.html" },
  { slug: "kitchen-renovation",  service: "Kitchen Renovation",  path: "/kitchen-renovation.html" },
  { slug: "painting",            service: "Painting",            path: "/painting.html" },
  { slug: "flooring",            service: "Flooring",            path: "/flooring.html" },
  { slug: "carpentry",           service: "Carpentry",           path: "/carpentry.html" },
  { slug: "handyman",            service: "Handyman Services",   path: "/handyman.html" },
  { slug: "water-damage",        service: "Water Damage",        path: "/water-damage.html" },

  // ── Bathroom subpages ──
  { slug: "bathroom-renovation-brooklyn",     service: "Bathroom Renovation — Brooklyn",  path: "/bathroom-renovation-brooklyn.html" },
  { slug: "bathroom-renovation-manhattan",    service: "Bathroom Renovation — Manhattan", path: "/bathroom-renovation-manhattan.html" },
  { slug: "bathroom-renovation-queens",       service: "Bathroom Renovation — Queens",    path: "/bathroom-renovation-queens.html" },
  { slug: "bathroom-wall-panels",             service: "Bathroom Wall Panels",            path: "/bathroom-wall-panels.html" },
  { slug: "bathroom-floor-tile-installation", service: "Bathroom Floor Tile",             path: "/bathroom-floor-tile-installation.html" },

  // ── Kitchen subpages ──
  { slug: "kitchen-renovation-brooklyn",  service: "Kitchen Renovation — Brooklyn",  path: "/kitchen-renovation-brooklyn.html" },
  { slug: "kitchen-renovation-manhattan", service: "Kitchen Renovation — Manhattan", path: "/kitchen-renovation-manhattan.html" },
  { slug: "kitchen-renovation-queens",    service: "Kitchen Renovation — Queens",    path: "/kitchen-renovation-queens.html" },

  // ── Painting subpages ──
  { slug: "painting-brooklyn",  service: "Painting — Brooklyn",  path: "/painting-brooklyn.html" },
  { slug: "painting-manhattan", service: "Painting — Manhattan", path: "/painting-manhattan.html" },

  // ── Carpentry subpages ──
  { slug: "exterior-carpentry", service: "Exterior Carpentry", path: "/exterior-carpentry.html" },
  { slug: "deck-building",      service: "Deck Building",      path: "/deck-building.html" },
  { slug: "deck-renovation",    service: "Deck Renovation",    path: "/deck-renovation.html" },
  { slug: "stair-building",     service: "Stair Building",     path: "/stair-building.html" },
  { slug: "stair-renovation",   service: "Stair Renovation",   path: "/stair-renovation.html" },
  { slug: "stair-restoration",  service: "Stair Restoration",  path: "/stair-restoration.html" },
  { slug: "stair-upgrade",      service: "Stair Upgrade",      path: "/stair-upgrade.html" },

  // ── Service-area pages (renovation contractor by location) ──
  { slug: "renovation-contractor-brooklyn",       service: "Renovation Contractor — Brooklyn",       path: "/renovation-contractor-brooklyn.html" },
  { slug: "renovation-contractor-manhattan",      service: "Renovation Contractor — Manhattan",      path: "/renovation-contractor-manhattan.html" },
  { slug: "renovation-contractor-queens",         service: "Renovation Contractor — Queens",         path: "/renovation-contractor-queens.html" },
  { slug: "renovation-contractor-bronx",          service: "Renovation Contractor — Bronx",          path: "/renovation-contractor-bronx.html" },
  { slug: "renovation-contractor-staten-island",  service: "Renovation Contractor — Staten Island",  path: "/renovation-contractor-staten-island.html" },
  { slug: "renovation-contractor-long-island",    service: "Renovation Contractor — Long Island",    path: "/renovation-contractor-long-island.html" },
  { slug: "renovation-contractor-nassau-county",  service: "Renovation Contractor — Nassau County",  path: "/renovation-contractor-nassau-county.html" },
  { slug: "renovation-contractor-suffolk-county", service: "Renovation Contractor — Suffolk County", path: "/renovation-contractor-suffolk-county.html" },
];

const SITE_ORIGIN = "https://www.sanibuildingcorp.com";
const GITHUB_REPO = process.env.GITHUB_REPO || "sanibuildingcorp/sani-website";

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

    // Optional: hand-picked live keywords from the Keyword Volumes picker
    const selectedKeywords = Array.isArray(body.selectedKeywords)
      ? body.selectedKeywords
          .map(function (k) {
            return {
              keyword: String((k && k.keyword) || "").trim(),
              volume: Number((k && (k.volume || k.avgMonthlySearches)) || 0),
              competition: String((k && k.competition) || "").toUpperCase(),
            };
          })
          .filter(function (k) { return k.keyword; })
          .slice(0, 12)
      : [];

    // STEP 1 — read the page.
    // GitHub FIRST: Cloudflare Bot Fight Mode blocks server-side fetches of the live
    // site, which used to leave "live page not read" and no Publish button. Reading
    // the file from GitHub also means we rewrite the exact file Approve & Publish
    // commits back. Live fetch (browser-like UA) stays as a fallback.
    let pageText = "";
    let currentTitle = "";
    let currentMeta = "";
    let rawHtml = "";
    let pageSource = "none";

    try {
      const ghToken = process.env.GITHUB_TOKEN;
      if (ghToken) {
        const ghRes = await fetch(
          "https://api.github.com/repos/" + GITHUB_REPO + "/contents/" + encodeURIComponent(slug) + ".html",
          {
            headers: {
              Authorization: "Bearer " + ghToken,
              Accept: "application/vnd.github.raw+json",
              "User-Agent": "SaniSEOStudio",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          }
        );
        if (ghRes.ok) {
          rawHtml = await ghRes.text();
          if (rawHtml && /<html[\s>]/i.test(rawHtml)) {
            pageSource = "github";
          } else {
            rawHtml = "";
          }
        }
      }
    } catch (e) { /* fall through to live fetch */ }

    if (!rawHtml) {
      try {
        const pageRes = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        });
        if (pageRes.ok) {
          rawHtml = await pageRes.text();
          pageSource = "live";
        }
      } catch (e) {
        // page fetch failed — continue with keyword data only
      }
    }

    if (rawHtml) {
      currentTitle = (rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
      currentMeta = (rawHtml.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i) || [])[1] || "";
      pageText = extractText(rawHtml).slice(0, 6000);
    }

    // STEP 2 — pull this site's GSC keyword data from Supabase
    let queries = [];
    let pageRow = null;
    try {
      const latestSnap = await fetch(
        `${supabaseUrl}/rest/v1/seo_snapshots?order=fetched_at.desc&limit=1`,
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

    // Compact table of the owner's hand-picked live keywords (if any)
    const selectedLines = selectedKeywords
      .map(function (k) {
        return '- "' + k.keyword + '"'
          + (k.volume ? " | " + k.volume.toLocaleString("en-US") + " searches/mo" : "")
          + (k.competition ? " | competition: " + k.competition : "");
      })
      .join("\n");

    // STEP 3 — ask OpenAI to find best keywords + write optimized content
    const systemPrompt =
      "You are an elite local-SEO copywriter for a New York City renovation contractor. " +
      "You write content that ranks on Google AND converts visitors into phone calls. " +
      "You write in a confident, premium, trustworthy voice. Never keyword-stuff. " +
      "Always weave keywords naturally into helpful, specific content. " +
      "IMPORTANT: Do NOT use the word 'luxury' or 'luxurious' anywhere. Instead use phrasing like 'high-quality', 'premium', 'high-end', 'top-quality', or 'professional'. " +
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
${selectedLines ? `
MANDATORY TARGET KEYWORDS (hand-picked by the owner from live Google Keyword Planner volumes — you MUST use every single one):
${selectedLines}

MANDATORY KEYWORD RULES:
- Put the highest-volume mandatory keyword in the title tag AND the H1.
- Use each mandatory keyword naturally at least once in a section heading (H2) or its body text.
- Include EVERY mandatory keyword in targetKeywords, with its volume/competition as the reason.
- Weave them naturally — never keyword-stuff or write awkward sentences.
` : ""}
GOOGLE SEARCH CONSOLE KEYWORD DATA (real searches this whole site already appears for — use this to pick the BEST-VALUE keywords for THIS service page; prioritize queries with high impressions but weak position or low CTR, and queries clearly relevant to "${service}"):
${keywordLines || "(no keyword data available yet)"}
${pageRow ? `\nThis page's own totals: impressions ${pageRow.impressions}, clicks ${pageRow.clicks}, avg position ${Number(pageRow.position).toFixed(1)}.` : ""}

TASK:
1. ${selectedLines ? "Start from the MANDATORY keywords above, then add" : "Choose"} the 6-10 best-value target keywords for THIS page (relevant to ${service} + local NYC intent). For each, say WHY in a few words (e.g. "92 impressions, position 36 — big upside").
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
Provide exactly 4 sections and 4 FAQ items. Keep each section body to 2-3 sentences. Be specific to NYC and to ${service}.`;

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.5,
        max_tokens: 1700,
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

    // Guaranteed safety net: strip the word "luxury" from all generated text
    content = stripLuxury(content);

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

    // STEP 5 — optionally build the full ready-to-upload HTML page
    let fullHtml = null;
    let fullHtmlChanges = null;
    if (body.buildFullHtml && rawHtml) {
      try {
        const rewritten = rewritePage(rawHtml, content, { mode: body.mode === "full" ? "full" : "meta" });
        fullHtml = rewritten.html;
        fullHtmlChanges = rewritten.changes;
      } catch (e) {
        fullHtmlChanges = ["error: " + e.message];
      }
    }

    return json(200, {
      slug,
      service,
      url,
      currentTitle,
      currentMeta,
      pageSource: pageSource,
      keywordsAnalyzed: queries.length,
      selectedKeywordsUsed: selectedKeywords.length,
      content,
      savedId: saved ? saved.id : null,
      fullHtml: fullHtml,
      fullHtmlChanges: fullHtmlChanges,
      fullHtmlAvailable: !!fullHtml,
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

// Strip HTML tags/entities from a small fragment to plain text (for schema)
function plain(frag) {
  return String(frag == null ? "" : frag)
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Parse the page's OWN visible FAQ (the <details class="faq-item"> blocks) so the
// schema we generate always matches what visitors actually see — Google's rule.
function extractVisibleFaq(html) {
  const items = [];
  const itemRe = /<details[^>]*class=["'][^"']*faq-item[^"']*["'][\s\S]*?<\/details>/gi;
  let m;
  while ((m = itemRe.exec(html)) !== null) {
    const block = m[0];
    const qMatch = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
    const aMatch = block.match(/<div[^>]*class=["'][^"']*faq-a[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (qMatch && aMatch) {
      const q = plain(qMatch[1].replace(/<span[^>]*class=["'][^"']*faq-toggle[\s\S]*?<\/span>/i, ""));
      const a = plain(aMatch[1]);
      if (q && a) items.push({ question: q, answer: a });
    }
  }
  return items;
}

// Remove EVERY existing FAQPage JSON-LD schema (and our old marked wrappers),
// leaving non-FAQ schemas like Service untouched.
function stripAllFaqSchemas(html) {
  let out = html;
  out = out.replace(/<!--\s*SEO-OPTIMIZED SCHEMA\s*-->/gi, "").replace(/<!--\s*END SEO-OPTIMIZED SCHEMA\s*-->/gi, "");
  out = out.replace(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>\s*/gi, function (full, inner) {
    return /"@type"\s*:\s*"FAQPage"/i.test(inner) ? "" : full;
  });
  return out;
}

function buildFaqSchemaFromItems(items) {
  if (!items || !items.length) return "";
  const schema = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: items.map(function (f) {
      return { "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } };
    }),
  };
  return '\n<!-- SEO-OPTIMIZED SCHEMA -->\n<script type="application/ld+json">' + JSON.stringify(schema) + "</scr" + "ipt>\n<!-- END SEO-OPTIMIZED SCHEMA -->\n";
}

// ════════════════════════════════════════════════════════════
// FULL-PAGE REWRITE — preserves design, swaps in optimized content
// ════════════════════════════════════════════════════════════
function escHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function attrHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function buildInjectedSection(content) {
  const sections = (content.sections || []).map(function (s) {
    return '<div style="margin-bottom:28px">' +
      '<h3 style="font-family:\'Playfair Display\',serif;font-size:clamp(20px,2.4vw,26px);font-weight:700;color:var(--black);margin-bottom:10px">' + escHtml(s.heading) + '</h3>' +
      '<p style="font-size:15px;color:var(--gray);line-height:1.85">' + escHtml(s.body) + '</p>' +
      '</div>';
  }).join("\n");
  const faqItems = (content.faq || []).map(function (f) {
    return '<div class="check-item" style="border-left:3px solid var(--gold)">' +
      '<strong style="font-size:15px">' + escHtml(f.question) + '</strong>' +
      '<span style="font-size:14px;line-height:1.7">' + escHtml(f.answer) + '</span>' +
      '</div>';
  }).join("\n");
  const faqBlock = (content.faq && content.faq.length)
    ? ('<div class="section-eyebrow" style="margin-top:56px"><div class="line"></div><span>Frequently Asked Questions</span></div>' +
       '<div style="font-family:\'Playfair Display\',serif;font-size:clamp(24px,3vw,34px);font-weight:700;margin-bottom:24px">Common Questions, <em style="font-style:italic;color:var(--gold)">Answered</em></div>' +
       '<div class="check-grid">' + faqItems + '</div>')
    : "";
  return '\n<!-- SEO-OPTIMIZED CONTENT (AI-generated) -->\n' +
    '<section style="padding:80px 28px;background:var(--light)">\n' +
    '  <div style="max-width:1100px;margin:0 auto">\n' +
    '    <div class="section-eyebrow"><div class="line"></div><span>' + escHtml(content.eyebrow || "Expert NYC Service") + '</span></div>\n' +
    '    <div style="font-family:\'Playfair Display\',serif;font-size:clamp(24px,3vw,36px);font-weight:700;margin-bottom:28px;max-width:760px">' + escHtml(content.sectionLead || content.h1 || "") + '</div>\n' +
    sections + "\n" + faqBlock + "\n  </div>\n</section>\n<!-- END SEO-OPTIMIZED CONTENT -->\n";
}
function buildFaqSchema(content) {
  if (!content.faq || !content.faq.length) return "";
  const schema = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: content.faq.map(function (f) {
      return { "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } };
    }),
  };
  return '\n<!-- SEO-OPTIMIZED SCHEMA -->\n<script type="application/ld+json">' + JSON.stringify(schema) + "</scr" + "ipt>\n<!-- END SEO-OPTIMIZED SCHEMA -->\n";
}
function rewritePage(html, content, opts) {
  opts = opts || {};
  // mode "meta" (default): optimize title + meta + H1 and ensure ONE FAQ schema that
  //   matches the page's visible FAQ. No visible content block is injected — right for
  //   pages that are already fully built. Self-heals any old injected junk.
  // mode "full": additionally inject the AI content section (for thin pages).
  const mode = opts.mode === "full" ? "full" : "meta";
  let out = html;
  const changes = [];
  if (content.title) {
    const re = /<title[^>]*>[\s\S]*?<\/title>/i;
    if (re.test(out)) { out = out.replace(re, "<title>" + attrHtml(content.title) + "</title>"); changes.push("title"); }
  }
  if (content.metaDescription) {
    const re1 = /<meta\s+name=["']description["']\s+content=["'][\s\S]*?["']\s*\/?>/i;
    const re2 = /<meta\s+content=["'][\s\S]*?["']\s+name=["']description["']\s*\/?>/i;
    const nm = '<meta name="description" content="' + attrHtml(content.metaDescription) + '">';
    if (re1.test(out)) { out = out.replace(re1, nm); changes.push("meta"); }
    else if (re2.test(out)) { out = out.replace(re2, nm); changes.push("meta"); }
  }
  if (content.h1) {
    const re = /<h1([^>]*)>[\s\S]*?<\/h1>/i;
    if (re.test(out)) {
      const words = String(content.h1).trim().split(/\s+/);
      let inner;
      if (words.length > 1) { const last = words.pop(); inner = escHtml(words.join(" ")) + " <em>" + escHtml(last) + "</em>"; }
      else { inner = escHtml(content.h1); }
      out = out.replace(re, "<h1$1>" + inner + "</h1>"); changes.push("h1");
    }
  }
  if (content.intro) {
    const re = /<p style="max-width:600px">[\s\S]*?<\/p>/i;
    if (re.test(out)) { out = out.replace(re, '<p style="max-width:600px">' + escHtml(content.intro) + "</p>"); changes.push("intro"); }
  }
  // --- SELF-HEALING: always remove any visible block this studio injected before ---
  const priorBlocks = out.match(/<!-- SEO-OPTIMIZED CONTENT \(AI-generated\) -->[\s\S]*?<!-- END SEO-OPTIMIZED CONTENT -->/gi);
  if (priorBlocks && priorBlocks.length) {
    out = out.replace(/<!-- SEO-OPTIMIZED CONTENT \(AI-generated\) -->[\s\S]*?<!-- END SEO-OPTIMIZED CONTENT -->\s*/gi, "");
    changes.push("removed-" + priorBlocks.length + "-old-section" + (priorBlocks.length > 1 ? "s" : ""));
  }

  // --- FAQ SCHEMA: collapse to exactly ONE, matching the visible FAQ ---
  // Count + remove every existing FAQPage schema (dedupes old leftovers), then add one.
  const existingFaq = (out.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [])
    .filter(function (s) { return /"@type"\s*:\s*"FAQPage"/i.test(s); }).length;
  out = stripAllFaqSchemas(out);
  if (existingFaq) changes.push("removed-" + existingFaq + "-faq-schema" + (existingFaq > 1 ? "s" : ""));
  // Prefer the page's own visible FAQ; fall back to the AI-generated FAQ.
  const visFaq = extractVisibleFaq(out);
  const faqSource = (visFaq && visFaq.length) ? visFaq : (content.faq || []);
  const schema = buildFaqSchemaFromItems(faqSource);
  if (schema && /<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, schema + "</head>");
    changes.push("faq-schema(" + faqSource.length + (visFaq.length ? ",from-page" : ",from-ai") + ")");
  }

  // --- VISIBLE CONTENT: only in "full" mode (thin pages) ---
  if (mode === "full") {
    const injected = buildInjectedSection(content);
    const footerPatterns = [
      /<footer[\s>]/i,
      /<(?:div|section|aside)[^>]*(?:class|id)\s*=\s*["'][^"']*\bfooter/i
    ];
    let placed = false;
    for (const fp of footerPatterns) {
      const m = out.match(fp);
      if (m) { out = out.slice(0, m.index) + injected + out.slice(m.index); changes.push("section"); placed = true; break; }
    }
    if (!placed) { out = out.replace(/<\/body>/i, injected + "</body>"); changes.push("section-fallback"); }
  }
  return { html: out, changes: changes };
}

// Replace "luxury"/"luxurious" anywhere in the content object with high-quality wording
function stripLuxury(obj) {
  function fix(str) {
    return String(str)
      .replace(/\bLuxurious\b/g, "High-End")
      .replace(/\bluxurious\b/g, "high-end")
      .replace(/\bLuxury\b/g, "High-Quality")
      .replace(/\bluxury\b/g, "high-quality");
  }
  function walk(v) {
    if (typeof v === "string") return fix(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out = {};
      for (const k in v) out[k] = walk(v[k]);
      return out;
    }
    return v;
  }
  return walk(obj);
}
