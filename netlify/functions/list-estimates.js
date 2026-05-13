// netlify/functions/list-estimates.js
// Returns all estimates from Blobs storage. Dashboard calls this on load.

const { getStore } = require("@netlify/blobs");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  try {
    const store = getStore("estimates");
    const { blobs } = await store.list();

    const estimates = [];
    for (const blob of blobs) {
      try {
        const data = await store.get(blob.key, { type: "json" });
        if (data) estimates.push(data);
      } catch (e) {
        console.error("Failed to load", blob.key, e.message);
      }
    }

    // Sort newest first
    estimates.sort((a, b) => {
      return new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0);
    });

    // Strip photos from list view to keep payload small
    const lightweight = estimates.map((e) => ({
      ref: e.ref,
      status: e.status,
      customer: e.customer,
      request: {
        service: e.request?.service,
        propertyType: e.request?.propertyType,
        timeline: e.request?.timeline,
        photoCount: e.request?.photoCount || 0,
      },
      estimate: {
        projectTitle: e.estimate?.projectTitle || "",
        grandTotal: calculateTotal(e.estimate),
      },
      submittedAt: e.submittedAt,
      updatedAt: e.updatedAt,
      sentAt: e.sentAt,
      acceptedAt: e.acceptedAt,
    }));

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({ estimates: lightweight }),
    };
  } catch (err) {
    console.error("list-estimates error:", err.message);
    return {
      statusCode: 500,
      headers: cors(),
      body: JSON.stringify({ error: err.message }),
    };
  }
};

function calculateTotal(est) {
  if (!est) return 0;
  const labor = (est.labor || []).reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0);
  const materials = (est.materials || []).reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0);
  const subtotal = labor + materials;
  const markup = subtotal * ((Number(est.markupPct) || 0) / 100);
  return Math.round((subtotal + markup) * 100) / 100;
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };
}
