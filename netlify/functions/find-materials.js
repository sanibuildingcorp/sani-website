// netlify/functions/find-materials.js
// Reads estimate scope + materials → returns structured shopping list
// with product specs, quantities, and search links to Home Depot / Lowe's / Amazon

const https = require("https");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  try {
    const { scopeOfWork, materials, serviceLabel, serviceAnswers, projectTitle } = JSON.parse(event.body || "{}");
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!openaiKey) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "OPENAI_API_KEY not set" }) };
    }

    // Build context from available data
    const answersText = serviceAnswers
      ? Object.entries(serviceAnswers)
          .filter(([, v]) => v && String(v).trim())
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n")
      : "";

    const materialsText = (materials || [])
      .filter(m => m.item && m.item.trim())
      .map(m => `- ${m.item} (qty: ${m.qty || 1} ${m.unit || "ea"})`)
      .join("\n");

    const prompt = `You are a NYC renovation contractor's materials assistant. Based on the project details below, generate a precise shopping list of materials needed.

PROJECT: ${projectTitle || serviceLabel || "Renovation"}
SERVICE: ${serviceLabel || ""}
${answersText ? "CUSTOMER ANSWERS:\n" + answersText : ""}
${scopeOfWork ? "SCOPE OF WORK:\n" + scopeOfWork.slice(0, 600) : ""}
${materialsText ? "ESTIMATED MATERIALS LIST:\n" + materialsText : ""}

Return a JSON array of materials. Each item must have:
- "name": exact product name a contractor would search for (e.g. "Schluter Kerdi Waterproofing Membrane 54sqft" not just "membrane")
- "qty": number
- "unit": unit of measure (sqft, bags, pieces, gallons, linear ft, etc.)
- "spec": key specs to look for (size, grade, type — 1 line, be specific)
- "category": one of: tile & stone, waterproofing, adhesive & grout, plumbing, electrical, lumber & drywall, paint & primer, hardware & fasteners, tools, fixtures, flooring, insulation, other
- "searchQuery": best search query string for Home Depot (3-6 words, specific)
- "estimatedUnitCost": rough USD cost per unit as a number (NYC prices, realistic)
- "priority": "required" or "optional"

Return ONLY a valid JSON array, no other text, no markdown.`;

    const raw = await openaiPost(openaiKey, JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 1500,
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }]
    }));

    const data = JSON.parse(raw);
    let content = data.choices?.[0]?.message?.content || "[]";

    // Strip markdown fences if present
    content = content.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

    let items;
    try {
      items = JSON.parse(content);
      if (!Array.isArray(items)) throw new Error("Not an array");
    } catch (e) {
      console.error("Parse failed:", content.slice(0, 300));
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "Failed to parse materials list" }) };
    }

    // Add shop URLs to each item
    items = items.map(function(item) {
      const q = encodeURIComponent(item.searchQuery || item.name || "");
      return Object.assign({}, item, {
        homedepotUrl: "https://www.homedepot.com/s/" + q,
        lowesUrl: "https://www.lowes.com/search?searchTerm=" + q,
        amazonUrl: "https://www.amazon.com/s?k=" + q + "&i=tools",
        totalEstimate: item.estimatedUnitCost
          ? Math.round(item.estimatedUnitCost * (parseFloat(item.qty) || 1) * 100) / 100
          : null
      });
    });

    // Sort: required first, then by category
    items.sort(function(a, b) {
      if (a.priority === "required" && b.priority !== "required") return -1;
      if (b.priority === "required" && a.priority !== "required") return 1;
      return (a.category || "").localeCompare(b.category || "");
    });

    const totalEstimate = items.reduce(function(sum, i) {
      return sum + (i.totalEstimate || 0);
    }, 0);

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({ success: true, items, totalEstimate: Math.round(totalEstimate * 100) / 100 })
    };

  } catch (err) {
    console.error("find-materials error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

function openaiPost(apiKey, bodyStr) {
  return new Promise(function(resolve, reject) {
    const opts = {
      hostname: "api.openai.com",
      port: 443,
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyStr)
      }
    };
    const req = https.request(opts, function(res) {
      let d = "";
      res.on("data", function(c) { d += c; });
      res.on("end", function() { resolve(d); });
    });
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

function cors() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}
