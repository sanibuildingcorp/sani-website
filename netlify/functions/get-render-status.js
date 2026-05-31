// netlify/functions/get-render-status.js
// Dashboard polls this every few seconds to check if the background render is done.
// Reads the job result from Supabase (render_jobs table).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

exports.handler = async function (event) {
  const jobId = (event.queryStringParameters || {}).jobId;

  if (!jobId) {
    return json(400, { status: "error", error: "Missing jobId" });
  }

  try {
    const res = await fetch(
      SUPABASE_URL + "/rest/v1/render_jobs?id=eq." + encodeURIComponent(jobId) + "&select=*",
      { headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY } }
    );
    const rows = await res.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      return json(200, { status: "processing" });
    }

    const job = rows[0];

    if (job.status === "done") {
      return json(200, {
        status: "done",
        imageBase64: job.image_base64,
        spaceDescription: job.space_description,
        revisedPrompt: job.revised_prompt
      });
    }
    if (job.status === "error") {
      return json(200, { status: "error", error: job.error || "Render failed" });
    }
    return json(200, { status: "processing" });

  } catch (err) {
    // Treat a transient read error as "still processing" so polling retries
    return json(200, { status: "processing" });
  }
};

function json(statusCode, obj) {
  return {
    statusCode: statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj)
  };
}
