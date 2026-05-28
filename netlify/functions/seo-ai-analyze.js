// netlify/functions/seo-ai-analyze.js
// The AI Brain — analyzes latest SEO snapshot, generates insights, emails summary
// Run manually: /.netlify/functions/seo-ai-analyze
// Run via cron: schedule weekly (Mondays 8am) via Netlify scheduled functions

exports.handler = async function (event) {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      },
      body: "",
    };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;

  const supabaseHeaders = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
  };

  try {
    // ============================================
    // STEP 1: Get the 2 most recent snapshots
    // ============================================
    const snapshotsRes = await fetch(
      `${supabaseUrl}/rest/v1/seo_snapshots?select=*&order=fetched_at.desc&limit=2`,
      { headers: supabaseHeaders }
    );

    const snapshots = await snapshotsRes.json();

    if (!snapshots || snapshots.length === 0) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          success: false,
          error: "No snapshots found. Run /fetch-search-console first to collect data.",
        }),
      };
    }

    const currentSnapshot = snapshots[0];
    const previousSnapshot = snapshots[1] || null;

    // ============================================
    // STEP 2: Get top queries + pages for current snapshot
    // ============================================
    const [queriesRes, pagesRes, comboRes] = await Promise.all([
      fetch(
        `${supabaseUrl}/rest/v1/seo_queries?snapshot_id=eq.${currentSnapshot.id}&order=impressions.desc&limit=50`,
        { headers: supabaseHeaders }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/seo_pages?snapshot_id=eq.${currentSnapshot.id}&order=clicks.desc&limit=25`,
        { headers: supabaseHeaders }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/seo_query_pages?snapshot_id=eq.${currentSnapshot.id}&order=impressions.desc&limit=100`,
        { headers: supabaseHeaders }
      ),
    ]);

    const queries = await queriesRes.json();
    const pages = await pagesRes.json();
    const combos = await comboRes.json();

    // ============================================
    // STEP 3: Get previous queries for comparison (if available)
    // ============================================
    let previousQueries = [];
    if (previousSnapshot) {
      const prevRes = await fetch(
        `${supabaseUrl}/rest/v1/seo_queries?snapshot_id=eq.${previousSnapshot.id}&order=impressions.desc&limit=50`,
        { headers: supabaseHeaders }
      );
      previousQueries = await prevRes.json();
    }

    // ============================================
    // STEP 4: Identify quick wins (page 2 keywords with high impressions)
    // ============================================
    const page2Opportunities = queries
      .filter((q) => q.position >= 11 && q.position <= 20 && q.impressions >= 10)
      .slice(0, 10);

    const lowCtrPage1 = queries
      .filter((q) => q.position <= 10 && q.ctr < 0.03 && q.impressions >= 20)
      .slice(0, 5);

    const risingKeywords = previousQueries.length > 0
      ? queries
          .map((q) => {
            const prev = previousQueries.find((p) => p.query === q.query);
            if (!prev) return null;
            const positionChange = prev.position - q.position; // positive = improved
            const clickChange = q.clicks - prev.clicks;
            return { ...q, positionChange, clickChange };
          })
          .filter((q) => q && (q.positionChange >= 1 || q.clickChange >= 2))
          .sort((a, b) => b.positionChange - a.positionChange)
          .slice(0, 5)
      : [];

    // ============================================
    // STEP 5: Build the AI prompt
    // ============================================
    const wowComparison = previousSnapshot
      ? `\nWEEK-OVER-WEEK COMPARISON:
- Clicks: ${previousSnapshot.total_clicks} → ${currentSnapshot.total_clicks} (${currentSnapshot.total_clicks - previousSnapshot.total_clicks >= 0 ? "+" : ""}${currentSnapshot.total_clicks - previousSnapshot.total_clicks})
- Impressions: ${previousSnapshot.total_impressions} → ${currentSnapshot.total_impressions} (${currentSnapshot.total_impressions - previousSnapshot.total_impressions >= 0 ? "+" : ""}${currentSnapshot.total_impressions - previousSnapshot.total_impressions})
- Avg position: ${Number(previousSnapshot.avg_position).toFixed(1)} → ${Number(currentSnapshot.avg_position).toFixed(1)}`
      : "\nNo previous snapshot available (first run).";

    const prompt = `You are an expert SEO consultant analyzing Search Console data for Sani Building Corp, a NYC renovation contractor (Brooklyn, NY 11235). Their target customers are NYC homeowners looking for handyman, bathroom renovation, kitchen renovation, painting, flooring, and carpentry services.

CURRENT SNAPSHOT (${currentSnapshot.date_range_start} to ${currentSnapshot.date_range_end}):
- Total clicks: ${currentSnapshot.total_clicks}
- Total impressions: ${currentSnapshot.total_impressions}
- Avg CTR: ${(currentSnapshot.avg_ctr * 100).toFixed(2)}%
- Avg position: ${Number(currentSnapshot.avg_position).toFixed(2)}
${wowComparison}

TOP 15 QUERIES BY IMPRESSIONS:
${queries.slice(0, 15).map((q, i) => `${i + 1}. "${q.query}" — ${q.clicks} clicks, ${q.impressions} impressions, position ${Number(q.position).toFixed(1)}, CTR ${(q.ctr * 100).toFixed(2)}%`).join("\n")}

PAGE 2 OPPORTUNITIES (position 11-20, high impressions — easy wins):
${page2Opportunities.map((q) => `- "${q.query}" — position ${Number(q.position).toFixed(1)}, ${q.impressions} impressions, ${q.clicks} clicks`).join("\n") || "None identified"}

LOW CTR ON PAGE 1 (position ≤ 10 but CTR < 3% — title/meta issues):
${lowCtrPage1.map((q) => `- "${q.query}" — position ${Number(q.position).toFixed(1)}, ${q.impressions} impressions, CTR ${(q.ctr * 100).toFixed(2)}%`).join("\n") || "None identified"}

RISING KEYWORDS (improved since last snapshot):
${risingKeywords.length > 0 ? risingKeywords.map((q) => `- "${q.query}" — position ${Number(q.position).toFixed(1)} (improved ${q.positionChange.toFixed(1)} spots), ${q.clicks} clicks (${q.clickChange >= 0 ? "+" : ""}${q.clickChange})`).join("\n") : "No comparison available"}

TOP PAGES:
${pages.slice(0, 10).map((p) => `- ${p.page_url} — ${p.clicks} clicks, ${p.impressions} impressions, position ${Number(p.position).toFixed(1)}`).join("\n")}

YOUR TASK:
Generate 3-7 highly specific, actionable SEO insights. Focus on:
1. Quick wins (easy ranking pushes)
2. Title/meta optimization for low-CTR pages
3. Content opportunities (keywords ranking but no dedicated page)
4. Local SEO opportunities (NYC/Brooklyn-specific keywords)
5. Warnings about declining metrics

Return ONLY valid JSON in this exact structure (no markdown, no explanation):
{
  "summary": "2-3 sentence overall summary of SEO health this week",
  "insights": [
    {
      "insight_type": "opportunity",
      "priority": "high",
      "title": "Short specific title (under 60 chars)",
      "description": "What's happening and why it matters (2-3 sentences)",
      "suggested_action": "Specific concrete action to take (1-2 sentences)",
      "related_query": "exact keyword from data",
      "related_page": "exact URL from data or null",
      "estimated_impact": "e.g. '+15-25 clicks/month' or 'Could push from page 2 to page 1'"
    }
  ]
}

RULES:
- insight_type must be one of: "opportunity", "win", "warning", "recommendation"
- priority must be one of: "high", "medium", "low"
- Be SPECIFIC. Reference exact keywords and pages from the data above.
- For each opportunity, give a concrete action (rewrite title to X, add content about Y, etc.)
- Mark page 2 keywords with 10+ impressions as HIGH priority opportunities
- Mark declining metrics as warnings`;

    // ============================================
    // STEP 6: Call OpenAI
    // ============================================
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are an expert SEO consultant. Return only valid JSON, no markdown, no code blocks, no explanation.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 3000,
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      throw new Error(`OpenAI error: ${errText}`);
    }

    const openaiData = await openaiRes.json();
    const aiContent = openaiData.choices?.[0]?.message?.content || "";
    const cleanContent = aiContent.replace(/```json|```/g, "").trim();

    let aiAnalysis;
    try {
      aiAnalysis = JSON.parse(cleanContent);
    } catch (parseErr) {
      console.error("AI returned invalid JSON:", cleanContent);
      throw new Error("AI returned invalid JSON. Raw: " + cleanContent.substring(0, 500));
    }

    // ============================================
    // STEP 7: Save insights to Supabase
    // ============================================
    const insightsToSave = (aiAnalysis.insights || []).map((ins) => ({
      snapshot_id: currentSnapshot.id,
      insight_type: ins.insight_type || "recommendation",
      priority: ins.priority || "medium",
      title: ins.title || "Untitled insight",
      description: ins.description || "",
      suggested_action: ins.suggested_action || "",
      related_query: ins.related_query || null,
      related_page: ins.related_page || null,
      estimated_impact: ins.estimated_impact || "",
      status: "new",
    }));

    let savedInsightsCount = 0;
    if (insightsToSave.length > 0) {
      const insertRes = await fetch(`${supabaseUrl}/rest/v1/seo_ai_insights`, {
        method: "POST",
        headers: { ...supabaseHeaders, Prefer: "return=representation" },
        body: JSON.stringify(insightsToSave),
      });

      if (insertRes.ok) {
        const inserted = await insertRes.json();
        savedInsightsCount = inserted.length;
      } else {
        const errText = await insertRes.text();
        console.error("Failed to save insights:", errText);
      }
    }

    // ============================================
    // STEP 8: Email the report via Resend
    // ============================================
    const priorityEmoji = { high: "🔴", medium: "🟡", low: "🟢" };
    const typeEmoji = {
      opportunity: "💎",
      win: "🏆",
      warning: "⚠️",
      recommendation: "💡",
    };

    const emailHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#f5f5f5; margin:0; padding:24px; color:#0a1628; }
  .container { max-width:680px; margin:0 auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08); }
  .header { background:linear-gradient(135deg,#0a1628 0%,#050d1a 100%); padding:32px; color:#fff; text-align:center; }
  .header .brand { font-size:14px; letter-spacing:3px; color:#c8860a; font-weight:600; }
  .header h1 { font-family:'Playfair Display',Georgia,serif; font-size:28px; margin:8px 0 0; font-style:italic; color:#f0a500; }
  .summary { padding:24px 32px; background:#fafafa; border-bottom:1px solid #eee; }
  .summary p { margin:0; line-height:1.6; color:#333; }
  .stats { display:flex; gap:16px; padding:24px 32px; border-bottom:1px solid #eee; flex-wrap:wrap; }
  .stat { flex:1; min-width:120px; }
  .stat-label { font-size:11px; text-transform:uppercase; letter-spacing:1.5px; color:#888; }
  .stat-val { font-size:22px; font-weight:700; color:#0a1628; margin-top:4px; }
  .stat-change { font-size:12px; color:#666; margin-top:2px; }
  .stat-change.up { color:#16a34a; }
  .stat-change.down { color:#dc2626; }
  .insights { padding:24px 32px; }
  .insights h2 { font-family:Georgia,serif; font-size:20px; margin:0 0 16px; color:#0a1628; }
  .insight { background:#fff; border-left:4px solid #c8860a; padding:16px 20px; margin-bottom:16px; border-radius:0 8px 8px 0; box-shadow:0 1px 3px rgba(0,0,0,0.06); }
  .insight.high { border-left-color:#dc2626; }
  .insight.medium { border-left-color:#f0a500; }
  .insight.low { border-left-color:#16a34a; }
  .insight-meta { font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#888; margin-bottom:6px; }
  .insight-title { font-size:16px; font-weight:600; margin:0 0 8px; color:#0a1628; }
  .insight-desc { font-size:14px; line-height:1.5; color:#444; margin:0 0 10px; }
  .insight-action { font-size:13px; background:#fff8e7; border:1px solid #f0d77a; padding:10px 12px; border-radius:6px; margin-top:10px; }
  .insight-action strong { color:#8a5d00; }
  .insight-impact { font-size:12px; color:#16a34a; margin-top:6px; font-weight:600; }
  .footer { background:#f5f5f5; padding:20px 32px; text-align:center; font-size:12px; color:#666; }
  .footer a { color:#c8860a; text-decoration:none; }
</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">SANI SEO BRAIN</div>
      <h1>Weekly SEO Report</h1>
      <div style="font-size:13px; color:#aaa; margin-top:8px;">${currentSnapshot.date_range_start} to ${currentSnapshot.date_range_end}</div>
    </div>

    <div class="summary">
      <p>${aiAnalysis.summary || "Weekly SEO analysis complete."}</p>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-label">Clicks</div>
        <div class="stat-val">${currentSnapshot.total_clicks}</div>
        ${previousSnapshot ? `<div class="stat-change ${currentSnapshot.total_clicks >= previousSnapshot.total_clicks ? "up" : "down"}">${currentSnapshot.total_clicks - previousSnapshot.total_clicks >= 0 ? "▲" : "▼"} ${Math.abs(currentSnapshot.total_clicks - previousSnapshot.total_clicks)} vs last</div>` : ""}
      </div>
      <div class="stat">
        <div class="stat-label">Impressions</div>
        <div class="stat-val">${currentSnapshot.total_impressions.toLocaleString()}</div>
        ${previousSnapshot ? `<div class="stat-change ${currentSnapshot.total_impressions >= previousSnapshot.total_impressions ? "up" : "down"}">${currentSnapshot.total_impressions - previousSnapshot.total_impressions >= 0 ? "▲" : "▼"} ${Math.abs(currentSnapshot.total_impressions - previousSnapshot.total_impressions).toLocaleString()} vs last</div>` : ""}
      </div>
      <div class="stat">
        <div class="stat-label">Avg CTR</div>
        <div class="stat-val">${(currentSnapshot.avg_ctr * 100).toFixed(2)}%</div>
      </div>
      <div class="stat">
        <div class="stat-label">Avg Position</div>
        <div class="stat-val">${Number(currentSnapshot.avg_position).toFixed(1)}</div>
        ${previousSnapshot ? `<div class="stat-change ${currentSnapshot.avg_position <= previousSnapshot.avg_position ? "up" : "down"}">${currentSnapshot.avg_position <= previousSnapshot.avg_position ? "▲ improving" : "▼ declining"}</div>` : ""}
      </div>
    </div>

    <div class="insights">
      <h2>This Week's Insights (${aiAnalysis.insights?.length || 0})</h2>
      ${(aiAnalysis.insights || [])
        .map(
          (ins) => `
        <div class="insight ${ins.priority || "medium"}">
          <div class="insight-meta">${typeEmoji[ins.insight_type] || "💡"} ${(ins.insight_type || "recommendation").toUpperCase()} · ${priorityEmoji[ins.priority] || "🟡"} ${(ins.priority || "medium").toUpperCase()} PRIORITY</div>
          <div class="insight-title">${ins.title || ""}</div>
          <div class="insight-desc">${ins.description || ""}</div>
          ${ins.suggested_action ? `<div class="insight-action"><strong>Action:</strong> ${ins.suggested_action}</div>` : ""}
          ${ins.estimated_impact ? `<div class="insight-impact">📈 ${ins.estimated_impact}</div>` : ""}
          ${ins.related_query ? `<div style="font-size:11px; color:#888; margin-top:6px;">Related: "${ins.related_query}"${ins.related_page ? ` → ${ins.related_page}` : ""}</div>` : ""}
        </div>
      `
        )
        .join("")}
    </div>

    <div class="footer">
      <p>Generated by Sani SEO Brain · ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
      <p style="margin-top:8px;"><a href="https://www.sanibuildingcorp.com">sanibuildingcorp.com</a></p>
    </div>
  </div>
</body>
</html>`;

    let emailSent = false;
    let emailError = null;

    if (resendKey) {
      try {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Sani SEO Brain <onboarding@resend.dev>",
            to: ["sanibuildingcorp@gmail.com"],
            subject: `🧠 Weekly SEO Report — ${currentSnapshot.total_clicks} clicks, ${aiAnalysis.insights?.length || 0} insights`,
            html: emailHtml,
          }),
        });

        if (emailRes.ok) {
          emailSent = true;
        } else {
          emailError = await emailRes.text();
        }
      } catch (err) {
        emailError = err.message;
      }
    }

    // ============================================
    // STEP 9: Return final response
    // ============================================
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(
        {
          success: true,
          snapshotId: currentSnapshot.id,
          snapshotDate: currentSnapshot.fetched_at,
          summary: aiAnalysis.summary,
          insightsGenerated: aiAnalysis.insights?.length || 0,
          insightsSaved: savedInsightsCount,
          emailSent: emailSent,
          emailError: emailError,
          insights: aiAnalysis.insights || [],
          metadata: {
            page2Opportunities: page2Opportunities.length,
            lowCtrOnPage1: lowCtrPage1.length,
            risingKeywords: risingKeywords.length,
            hasComparison: !!previousSnapshot,
          },
        },
        null,
        2
      ),
    };
  } catch (err) {
    console.error("seo-ai-analyze error:", err);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        success: false,
        error: err.message || "Unknown error",
      }),
    };
  }
};
