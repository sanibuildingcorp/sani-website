// netlify/functions/handyman-ai.js
// Secure backend for AI scope + photo analysis on handyman-estimate.html
// API key stays server-side via process.env.ANTHROPIC_API_KEY

const https = require("https");

exports.handler = async function (event) {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);
    const {
      mode, // "scope" or "photoAnalysis"
      businessName,
      propType,
      address,
      firstName,
      lastName,
      role,
      services,
      sqft,
      areas,
      timeline,
      schedule,
      description,
      notes,
      photoCount,
      total,
    } = body;

    // ─────────────────────────────────────────
    // BUILD THE PROMPT BASED ON MODE
    // ─────────────────────────────────────────
    let prompt;
    let maxTokens = 1000;

    if (mode === "scope") {
      prompt = `You are Sani Building Corp, a professional NYC commercial handyman company. Write a professional scope of work and project assessment for this commercial job.

Business: ${businessName || "Not specified"} (${propType || "Commercial"})
Address: ${address || "NYC"}
Contact: ${firstName || ""} ${lastName || ""}, ${role || "Owner/Manager"}
Services requested: ${services || "General handyman services"}
Square footage: ${sqft || "Not specified"}
Areas: ${areas || "Not specified"}
Timeline: ${timeline || "Flexible"}
Schedule preference: ${schedule || "Business hours"}
Job description: ${description || "Not specified"}
Special notes: ${notes || "None"}
Photos uploaded: ${photoCount || 0} photo(s)
Total estimate: $${(total || 0).toLocaleString()}

Write a professional 3-paragraph scope of work as the contractor. Include:
1. Project overview and assessment
2. Specific work to be performed (reference their description)
3. Timeline, scheduling, and what to expect

Be professional, specific, and reassuring. Mention commercial/industrial expertise, NYC professional work, minimal business disruption, and our satisfaction guarantee. Write in flowing prose — no bullet points.`;
    } else if (mode === "photoAnalysis") {
      maxTokens = 800;
      prompt = `You are a commercial property assessment expert at Sani Building Corp NYC.

A commercial client at ${businessName || "a business"} (${propType || "commercial property"}) at ${address || "NYC"} uploaded ${photoCount || 0} photo(s) of their space needing handyman work.

Services requested: ${services || "general handyman services"}
Their description: ${description || "Not specified"}

Write a professional 2-paragraph written photo assessment (since we'll analyze images upon arrival). Include:
1. What you'd expect to see in a ${propType || "commercial property"} needing these repairs — typical conditions, common issues found
2. What the space will look like after Sani Building Corp completes the work — professional finish, minimal disruption to business operations

Be specific to commercial/industrial context. Professional tone. This helps the client visualize the transformation.`;
    } else {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Invalid mode. Use 'scope' or 'photoAnalysis'." }),
      };
    }

    // ─────────────────────────────────────────
    // CALL ANTHROPIC API SECURELY
    // ─────────────────────────────────────────
    const requestData = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });

    const result = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "api.anthropic.com",
          path: "/v1/messages",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(requestData),
            "x-api-key": process.env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => { data += chunk; });
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error("Invalid JSON response from Anthropic: " + data.slice(0, 200)));
            }
          });
        }
      );
      req.on("error", reject);
      req.write(requestData);
      req.end();
    });

    // Extract text from response
    const text = result.content?.map((b) => b.text || "").join("") || "";

    if (!text) {
      throw new Error("Empty response from AI: " + JSON.stringify(result).slice(0, 300));
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ text }),
    };
  } catch (err) {
    console.error("handyman-ai error:", err);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
