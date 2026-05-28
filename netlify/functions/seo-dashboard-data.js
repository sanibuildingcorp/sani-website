// netlify/functions/seo-dashboard-data.js
// Returns all SEO data needed for the dashboard tab:
// latest snapshot, history (for trend), top queries, top pages, AI insights

exports.handler = async function (event) {
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
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
  };

  try {
    // Optional: mark an insight done/dismissed (POST)
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      if (body.action === "updateInsight" && body.insightId && body.status) {
        const upd = await fetch(
          `${supabaseUrl}/rest/v1/seo_ai_insights?id=eq.${body.insightId}`,
          {
            method: "PATCH",
            headers: { ...headers, Prefer: "return=representation" },
            body: JSON.stringify({
              status: body.status,
              reviewed_at: new Date().toISOString(),
            }),
          }
        );
        const updated = await upd.json();
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ success: true, updated }),
        };
      }
    }

    // --- GET: load all dashboard data ---

    // 1. Snapshots (last 12 for trend chart)
    const snapsRes = await fetch(
      `${supabaseUrl}/rest/v1/seo_snapshots?select=*&order=fetched_at.desc&limit=12`,
      { headers }
    );
    const snapshots = await snapsRes.json();

    if (!snapshots || snapshots.length === 0) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          success: true,
          hasData: false,
          message: "No SEO data yet. Run the weekly fetch to collect data.",
        }),
      };
    }

    const latest = snapshots[0];
    const previous = snapshots[1] || null;

    // 2. Top queries for latest snapshot
    const queriesRes = await fetch(
      `${supabaseUrl}/rest/v1/seo_queries?snapshot_id=eq.${latest.id}&select=*&order=impressions.desc&limit=50`,
      { headers }
    );
    const queries = await queriesRes.json();

    // 3. Top pages for latest snapshot
    const pagesRes = await fetch(
      `${supabaseUrl}/rest/v1/seo_pages?snapshot_id=eq.${latest.id}&select=*&order=clicks.desc&limit=25`,
      { headers }
    );
    const pages = await pagesRes.json();

    // 4. AI insights for latest snapshot (newest first)
    const insightsRes = await fetch(
      `${supabaseUrl}/rest/v1/seo_ai_insights?snapshot_id=eq.${latest.id}&select=*&order=id.asc`,
      { headers }
    );
    const insights = await insightsRes.json();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        success: true,
        hasData: true,
        latest,
        previous,
        history: snapshots.slice().reverse(), // oldest → newest for chart
        queries,
        pages,
        insights,
      }),
    };
  } catch (err) {
    console.error("seo-dashboard-data error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
