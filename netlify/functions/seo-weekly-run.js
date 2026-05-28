// netlify/functions/seo-weekly-run.js
// Orchestrator — runs the full SEO Brain pipeline weekly
// 1. Fetches fresh Search Console data + saves to Supabase
// 2. Triggers AI analysis + emails report
// Triggered by Netlify scheduled function (every Monday 8am UTC)
// Can also be triggered manually for testing

exports.handler = async function (event) {
  console.log("🧠 Sani SEO Brain — Weekly Run Started");
  const startTime = Date.now();

  // Auto-detect base URL (works in production + branch deploys)
  const baseUrl = process.env.URL || "https://www.sanibuildingcorp.com";

  const results = {
    success: false,
    started_at: new Date().toISOString(),
    steps: [],
  };

  try {
    // ============================================
    // STEP 1: Fetch fresh Search Console data
    // ============================================
    console.log("Step 1: Fetching Search Console data...");
    const fetchStart = Date.now();

    const fetchRes = await fetch(`${baseUrl}/.netlify/functions/fetch-search-console`);
    const fetchData = await fetchRes.json();

    const fetchTime = Date.now() - fetchStart;

    if (!fetchData.success) {
      throw new Error(`Fetch step failed: ${fetchData.error || "Unknown error"}`);
    }

    results.steps.push({
      step: "fetch-search-console",
      success: true,
      duration_ms: fetchTime,
      snapshotId: fetchData.snapshotId,
      clicks: fetchData.totals?.clicks,
      impressions: fetchData.totals?.impressions,
      saved: fetchData.saved,
    });

    console.log(`✅ Fetch complete in ${fetchTime}ms. Snapshot ID: ${fetchData.snapshotId}`);

    // Small delay to ensure Supabase has committed the writes
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // ============================================
    // STEP 2: Run AI analysis + send email
    // ============================================
    console.log("Step 2: Running AI analysis...");
    const analyzeStart = Date.now();

    const analyzeRes = await fetch(`${baseUrl}/.netlify/functions/seo-ai-analyze`);
    const analyzeData = await analyzeRes.json();

    const analyzeTime = Date.now() - analyzeStart;

    if (!analyzeData.success) {
      throw new Error(`Analyze step failed: ${analyzeData.error || "Unknown error"}`);
    }

    results.steps.push({
      step: "seo-ai-analyze",
      success: true,
      duration_ms: analyzeTime,
      insightsGenerated: analyzeData.insightsGenerated,
      insightsSaved: analyzeData.insightsSaved,
      emailSent: analyzeData.emailSent,
      emailError: analyzeData.emailError,
    });

    console.log(`✅ Analysis complete in ${analyzeTime}ms. ${analyzeData.insightsGenerated} insights generated.`);

    // ============================================
    // SUCCESS
    // ============================================
    results.success = true;
    results.total_duration_ms = Date.now() - startTime;
    results.completed_at = new Date().toISOString();
    results.summary = `Weekly run complete: ${fetchData.totals?.clicks} clicks tracked, ${analyzeData.insightsGenerated} insights generated, email ${analyzeData.emailSent ? "sent ✅" : "FAILED ❌"}`;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(results, null, 2),
    };
  } catch (err) {
    console.error("❌ Weekly run failed:", err);

    results.success = false;
    results.error = err.message || "Unknown error";
    results.total_duration_ms = Date.now() - startTime;

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(results, null, 2),
    };
  }
};

// ============================================
// Netlify Scheduled Function configuration
// Cron syntax: "minute hour day month weekday"
// "0 8 * * 1" = Every Monday at 8:00 UTC (3am EST)
// ============================================
exports.config = {
  schedule: "0 8 * * 1",
};
