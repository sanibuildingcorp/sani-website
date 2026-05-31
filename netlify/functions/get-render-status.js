// netlify/functions/get-render-status.js
// Dashboard polls this every few seconds to check if the background render is done.
// Reads the job result from Netlify Blobs (auto-configured — no env vars needed).

const { getStore } = require("@netlify/blobs");

exports.handler = async function (event) {
  const jobId = (event.queryStringParameters || {}).jobId;

  if (!jobId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "error", error: "Missing jobId" })
    };
  }

  try {
    const store = getStore("render-jobs");
    const job = await store.get(jobId, { type: "json" });

    // Not written yet → tell the dashboard to keep waiting
    if (!job) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "processing" })
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job)
    };
  } catch (err) {
    // Treat a transient read error as "still processing" so polling retries
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "processing" })
    };
  }
};
