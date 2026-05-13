// netlify/functions/get-estimate.js
// Returns one full estimate (including photos & all answers) by ref.

const { getStore } = require("@netlify/blobs");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }

  try {
    const ref = event.queryStringParameters?.ref;
    if (!ref) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing ref" }) };
    }

    const store = getStore("estimates");
    const data = await store.get(ref, { type: "json" });

    if (!data) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "Not found" }) };
    }

    return { statusCode: 200, headers: cors(), body: JSON.stringify(data) };
  } catch (err) {
    console.error("get-estimate error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };
}
