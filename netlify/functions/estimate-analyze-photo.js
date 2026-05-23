// netlify/functions/estimate-analyze-photo.js
// AI Vision photo analysis for handyman/renovation estimates.
// Sends customer photo to Claude Sonnet 4.5 Vision and returns structured diagnosis.
//
// SAFETY: AI does NOT diagnose gas, electrical (beyond fixtures), structural,
// or in-wall plumbing issues. Those trigger safetyFlag and require in-person inspection.

const https = require("https");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders(), body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);
    const { photoBase64, service, serviceLabel, photoIndex, photoCount } = body;

    if (!photoBase64) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "Missing photoBase64" }),
      };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }),
      };
    }

    // Strip data URL prefix if present (e.g. "data:image/jpeg;base64,...")
    let cleanBase64 = photoBase64;
    let mediaType = "image/jpeg";
    if (photoBase64.startsWith("data:")) {
      const match = photoBase64.match(/^data:(image\/[a-z]+);base64,(.+)$/);
      if (match) {
        mediaType = match[1];
        cleanBase64 = match[2];
      }
    }

    // Size guard — Claude Vision limit ~5MB per image
    const sizeBytes = (cleanBase64.length * 3) / 4;
    if (sizeBytes > 5 * 1024 * 1024) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({
          error: "Photo too large. Max 5MB per image.",
          actualSize: Math.round(sizeBytes / 1024 / 1024 * 10) / 10 + "MB",
        }),
      };
    }

    const prompt = `You are an AI inspection assistant for Sani Building Corp, an NYC contractor. A customer uploaded this photo as part of an estimate request.

SERVICE THEY SELECTED: ${serviceLabel || service || "General handyman work"}
PHOTO ${photoIndex || 1} of ${photoCount || 1}

YOUR TASK: Analyze the photo and identify what handyman/renovation issue you see.

CRITICAL SAFETY RULES — Set safetyFlag:true and recommend in-person inspection if you see:
- Gas lines, gas appliances, or anything that smells like a gas issue
- Electrical panels, exposed wiring, scorch marks, or anything beyond basic fixture replacement
- Structural damage (cracked beams, sagging ceilings, foundation issues)
- In-wall plumbing leaks behind tile/drywall
- Mold suggesting hidden water damage
- Asbestos-era materials (popcorn ceilings pre-1980, certain tiles)
- Anything that could harm someone if mishandled

SAFE TO ANALYZE (provide detailed diagnosis):
- Faucet replacement (visible fixtures)
- Toilet replacement
- Vanity / cabinet installation
- Light fixture replacement (visible fixtures, not panel work)
- Door / lock replacement
- Drywall holes / patches (small to medium)
- Cosmetic painting needs
- Visible tile damage / grout issues
- Visible flooring damage
- Cabinet hardware
- Towel bars, mirrors, shelving
- Visible carpentry (trim, baseboards)

OUTPUT: Return ONLY valid JSON, no markdown, no backticks, no preamble. Use this exact structure:

{
  "detected": "Short clear name of the issue you see (e.g. 'Leaking bathroom faucet', 'Cracked floor tile', 'Drywall hole approx 6 inches')",
  "category": "faucet|toilet|fixture|drywall|tile|paint|flooring|door|lock|cabinet|carpentry|other",
  "confidence": "high|medium|low",
  "description": "1-2 sentence plain-English description of what you observe in the photo. Be specific about visible details (finish, style, condition).",
  "recommendedAction": "What handyman work would fix this. 1 sentence. Plain English.",
  "estimatedComplexity": "simple|moderate|complex",
  "safetyFlag": false,
  "needsInspection": false,
  "suggestedQuestions": [
    "Up to 3 short questions that would help give an accurate estimate, only if essential"
  ],
  "disclaimerNote": "Brief honest note about limitations of photo analysis"
}

RULES:
- If safetyFlag:true, set needsInspection:true and recommendedAction should say "In-person inspection required by licensed pro"
- confidence:"high" only when you can clearly see the issue and the fix is standard
- confidence:"low" when photo is blurry, lighting is bad, or angle hides important details
- needsInspection:true when complexity is high OR you can't see enough OR it's beyond DIY scope
- If photo doesn't show a fixable issue (random photo, blurry, just a wall), set detected:"Unable to identify issue from this photo" and confidence:"low"
- estimatedComplexity:"simple" = 1-2 hours, "moderate" = half day, "complex" = 1+ day
- Keep all strings concise. This is for a UI card, not an essay.

Analyze the photo now.`;

    const requestPayload = JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 800,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: cleanBase64,
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
    });

    const responseBody = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "api.anthropic.com",
          port: 443,
          path: "/v1/messages",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(requestPayload),
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          timeout: 30000, // Vision is slower than text
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
          res.on("error", reject);
        }
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Vision API timeout (30s)"));
      });
      req.write(requestPayload);
      req.end();
    });

    const apiResponse = JSON.parse(responseBody);
    if (apiResponse.error) {
      throw new Error(apiResponse.error.message || "Claude API error");
    }

    const rawText = (apiResponse.content || []).map((b) => b.text || "").join("");
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON in Claude response");
    }

    const analysis = JSON.parse(jsonMatch[0]);

    // Defensive: ensure required fields exist
    const result = {
      detected: analysis.detected || "Unable to analyze",
      category: analysis.category || "other",
      confidence: ["high", "medium", "low"].includes(analysis.confidence) ? analysis.confidence : "low",
      description: analysis.description || "",
      recommendedAction: analysis.recommendedAction || "On-site inspection recommended",
      estimatedComplexity: ["simple", "moderate", "complex"].includes(analysis.estimatedComplexity) ? analysis.estimatedComplexity : "moderate",
      safetyFlag: analysis.safetyFlag === true,
      needsInspection: analysis.needsInspection === true || analysis.safetyFlag === true,
      suggestedQuestions: Array.isArray(analysis.suggestedQuestions) ? analysis.suggestedQuestions.slice(0, 3) : [],
      disclaimerNote: analysis.disclaimerNote || "AI photo analysis is preliminary. Final pricing requires on-site inspection.",
      photoIndex: photoIndex || 1,
      analyzedAt: new Date().toISOString(),
    };

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error("Photo analysis error:", err.message);
    // Graceful fallback — return a "low confidence, manual review" result
    // so the form flow doesn't break
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        detected: "Photo received — manual review",
        category: "other",
        confidence: "low",
        description: "AI analysis was unavailable. Our team will review your photo personally.",
        recommendedAction: "Our contractor will review your photo and follow up with details.",
        estimatedComplexity: "moderate",
        safetyFlag: false,
        needsInspection: true,
        suggestedQuestions: [],
        disclaimerNote: "AI analysis was unavailable. Your photo has been received and will be reviewed by our team.",
        fallback: true,
        error: err.message,
        analyzedAt: new Date().toISOString(),
      }),
    };
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
