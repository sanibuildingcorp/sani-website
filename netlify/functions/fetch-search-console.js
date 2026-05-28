// netlify/functions/fetch-search-console.js
// Fetches Google Search Console data + auto-saves to Supabase
// Returns: top queries, top pages, totals, by-date breakdown
// Saves: snapshot + queries + pages + query/page combos to Supabase

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

  try {
    // --- 1. Get params from query string ---
    const params = event.queryStringParameters || {};
    const siteUrl = params.site || "https://www.sanibuildingcorp.com/";
    const daysBack = parseInt(params.days || "30", 10);
    const skipSave = params.skipSave === "true"; // optional: skip saving to DB

    // --- 2. Date range ---
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - daysBack);
    const fmtDate = (d) => d.toISOString().split("T")[0];

    // --- 3. Exchange refresh_token for a fresh access_token ---
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("Token exchange failed:", errText);
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Failed to refresh access token", detail: errText }),
      };
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // --- 4. Helper: query Search Console API ---
    const querySearchConsole = async (dimensions, rowLimit = 25) => {
      const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: fmtDate(startDate),
          endDate: fmtDate(endDate),
          dimensions: dimensions,
          rowLimit: rowLimit,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Search Console API error (${res.status}): ${errText}`);
      }

      return res.json();
    };

    // --- 5. Run multiple queries in parallel ---
    const [totalsRes, queriesRes, pagesRes, dailyRes, queryPageRes] = await Promise.all([
      querySearchConsole([], 1),
      querySearchConsole(["query"], 50),
      querySearchConsole(["page"], 25),
      querySearchConsole(["date"], 90),
      querySearchConsole(["query", "page"], 100),
    ]);

    // --- 6. Format response data ---
    const totals = totalsRes.rows?.[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };

    const topQueries = (queriesRes.rows || []).map((r) => ({
      query: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    }));

    const topPages = (pagesRes.rows || []).map((r) => ({
      page: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    }));

    const byDate = (dailyRes.rows || []).map((r) => ({
      date: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    }));

    const queryPageCombos = (queryPageRes.rows || []).map((r) => ({
      query: r.keys[0],
      page: r.keys[1],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    }));

    const response = {
      success: true,
      site: siteUrl,
      dateRange: { start: fmtDate(startDate), end: fmtDate(endDate), days: daysBack },
      totals: {
        clicks: totals.clicks || 0,
        impressions: totals.impressions || 0,
        ctr: totals.ctr || 0,
        position: totals.position || 0,
      },
      topQueries,
      topPages,
      byDate,
      queryPageCombos,
      fetchedAt: new Date().toISOString(),
    };

    // --- 7. SAVE TO SUPABASE (unless skipSave=true) ---
    let savedSnapshotId = null;
    let saveError = null;

    if (!skipSave) {
      try {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SECRET_KEY;

        // Step 7a: Insert snapshot row
        const snapshotRes = await fetch(`${supabaseUrl}/rest/v1/seo_snapshots`, {
          method: "POST",
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify({
            site_url: siteUrl,
            date_range_start: fmtDate(startDate),
            date_range_end: fmtDate(endDate),
            days_back: daysBack,
            total_clicks: totals.clicks || 0,
            total_impressions: totals.impressions || 0,
            avg_ctr: totals.ctr || 0,
            avg_position: totals.position || 0,
            raw_data: { byDate: byDate },
          }),
        });

        if (!snapshotRes.ok) {
          const errText = await snapshotRes.text();
          throw new Error(`Snapshot insert failed: ${errText}`);
        }

        const snapshotData = await snapshotRes.json();
        savedSnapshotId = snapshotData[0]?.id;
        console.log("Saved snapshot ID:", savedSnapshotId);

        // Step 7b: Insert all queries (bulk)
        if (topQueries.length > 0 && savedSnapshotId) {
          const queriesPayload = topQueries.map((q) => ({
            snapshot_id: savedSnapshotId,
            query: q.query,
            clicks: q.clicks,
            impressions: q.impressions,
            ctr: q.ctr,
            position: q.position,
          }));

          await fetch(`${supabaseUrl}/rest/v1/seo_queries`, {
            method: "POST",
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(queriesPayload),
          });
        }

        // Step 7c: Insert all pages (bulk)
        if (topPages.length > 0 && savedSnapshotId) {
          const pagesPayload = topPages.map((p) => ({
            snapshot_id: savedSnapshotId,
            page_url: p.page,
            clicks: p.clicks,
            impressions: p.impressions,
            ctr: p.ctr,
            position: p.position,
          }));

          await fetch(`${supabaseUrl}/rest/v1/seo_pages`, {
            method: "POST",
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(pagesPayload),
          });
        }

        // Step 7d: Insert query/page combos (bulk)
        if (queryPageCombos.length > 0 && savedSnapshotId) {
          const combosPayload = queryPageCombos.map((c) => ({
            snapshot_id: savedSnapshotId,
            query: c.query,
            page_url: c.page,
            clicks: c.clicks,
            impressions: c.impressions,
            ctr: c.ctr,
            position: c.position,
          }));

          await fetch(`${supabaseUrl}/rest/v1/seo_query_pages`, {
            method: "POST",
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(combosPayload),
          });
        }

        console.log(`Saved snapshot ${savedSnapshotId} with ${topQueries.length} queries, ${topPages.length} pages, ${queryPageCombos.length} combos`);
      } catch (err) {
        console.error("Supabase save error:", err);
        saveError = err.message;
      }
    }

    // --- 8. Return response (with save info) ---
    response.saved = !saveError && savedSnapshotId !== null;
    response.snapshotId = savedSnapshotId;
    if (saveError) response.saveError = saveError;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(response, null, 2),
    };
  } catch (err) {
    console.error("fetch-search-console error:", err);
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
