// netlify/functions/get-render-status.js
// Polling endpoint — checks Netlify Blobs for render job result

const { getStore } = require("@netlify/blobs");

exports.handler = async function (event) {
  const cors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "" };
  }

  const jobId = (event.queryStringParameters || {}).jobId;
  if (!jobId) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Missing jobId" }) };
  }

  try {
    const store = getStore({
      name: "render-jobs",
      siteID: process.env.MY_SITE_ID,
      token: process.env.MY_BLOBS_TOKEN
    });

    const result = await store.get(jobId, { type: "json" });

    if (!result) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ status: "pending" }) };
    }

    // Clean up the blob once retrieved as "done" or "error"
    if (result.status === "done" || result.status === "error") {
      try { await store.delete(jobId); } catch (e) { /* ignore cleanup errors */ }
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify(result) };

  } catch (e) {
    // Blob not found yet = still pending
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "pending" }) };
  }
};
