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
      ref,
      name,
      phone,
      email,
      address,
      type,
      size,
      description,
      budget,
      timeline,
      contactTime,
      source,
      photoCount,
      submittedAt,
    } = body;

    if (!name || !email || !description) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "Missing required fields" }),
      };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error("ANTHROPIC_API_KEY not set");
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "Server configuration error" }),
      };
    }

    // Generate AI estimate
    let aiEstimate = null;
    let aiError = null;

    try {
      aiEstimate = await generateAIEstimate(apiKey, {
        type,
        size,
        description,
        address,
        budget,
        timeline,
      });
    } catch (e) {
      aiError = e.message;
      console.error("AI estimate generation failed:", e.message);
    }

    // Send notification email to contractor (via Resend if configured)
    const resendKey = process.env.RESEND_API_KEY;
    const contractorEmail = process.env.CONTRACTOR_EMAIL || "contact@sanibuildingcorp.com";

    if (resendKey) {
      try {
        await sendContractorEmail(resendKey, contractorEmail, {
          ref, name, phone, email, address, type, size,
          description, budget, timeline, contactTime, source,
          photoCount, submittedAt, aiEstimate, aiError,
        });
      } catch (e) {
        console.error("Email send failed:", e.message);
      }
    } else {
      console.log("RESEND_API_KEY not set - skipping email notification");
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        ref,
        aiEstimate: aiEstimate || null,
      }),
    };
  } catch (err) {
    console.error("Handler error:", err.message);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: err.message }),
    };
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };
}

async function generateAIEstimate(apiKey, project) {
  const prompt = `You are a professional construction cost estimator for Sani Building Corp in NYC. Generate a detailed cost estimate in JSON format. Return ONLY valid JSON with no markdown, no explanation, no backticks. Use exactly this structure:

{
  "projectTitle": "string",
  "summary": "string (2-3 sentences describing the work)",
  "laborItems": [{"name": "string", "qty": 1, "unit": "HRS", "rate": 1.00, "total": 1.00}],
  "materialItems": [{"name": "string", "qty": 1, "unit": "PC", "rate": 1.00, "total": 1.00}],
  "subtotal": 1.00,
  "markupPct": 25,
  "markup": 1.00,
  "taxPct": 0,
  "tax": 0.00,
  "grandTotal": 1.00,
  "timeline": "string (e.g. 3-5 days)",
  "notes": "string (additional notes for contractor)"
}

Project details:
- Type: ${project.type || "General construction"}
- Size: ${project.size || "Not specified"}
- Address: ${project.address || "Brooklyn NY"}
- Description: ${project.description}
- Customer Budget: ${project.budget || "Not specified"}
- Timeline: ${project.timeline || "Flexible"}

Use realistic NYC market prices (Brooklyn/Manhattan). Apply exactly 25% markup on subtotal. grandTotal = subtotal + markup + tax. Be detailed with line items - separate skilled labor (carpenter, plumber, electrician at $75-95/hr) from helpers ($45-55/hr). For materials, list specific items with realistic costs.`;

  const requestData = JSON.stringify({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
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
          "Content-Length": Buffer.byteLength(requestData),
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        timeout: 25000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.write(requestData);
    req.end();
  });

  const apiResponse = JSON.parse(responseBody);
  if (apiResponse.error) {
    throw new Error(apiResponse.error.message || "API error");
  }

  const rawText = (apiResponse.content || []).map((b) => b.text || "").join("");
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in response");

  return JSON.parse(jsonMatch[0]);
}

async function sendContractorEmail(resendKey, contractorEmail, data) {
  const fmt = (n) => "$" + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  let estimateHtml = "";
  if (data.aiEstimate) {
    const e = data.aiEstimate;
    let labor = "";
    (e.laborItems || []).forEach((i) => {
      labor += `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${escapeHtml(i.name)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${i.qty} ${escapeHtml(i.unit)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${fmt(i.rate)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${fmt(i.total)}</td></tr>`;
    });
    let materials = "";
    (e.materialItems || []).forEach((i) => {
      materials += `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${escapeHtml(i.name)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${i.qty} ${escapeHtml(i.unit)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${fmt(i.rate)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${fmt(i.total)}</td></tr>`;
    });

    estimateHtml = `
      <h2 style="color:#b8720a;font-family:'Bebas Neue',Arial,sans-serif;letter-spacing:2px;border-top:2px solid #b8720a;padding-top:18px;margin-top:24px">🤖 AI-Generated Estimate</h2>
      <div style="background:#0d1b2a;color:#fff;padding:18px;border-radius:8px;margin-bottom:18px">
        <div style="font-size:11px;letter-spacing:2px;color:#c9a84c;text-transform:uppercase">Estimated Total</div>
        <div style="font-size:36px;font-weight:700;color:#e8c97a">${fmt(e.grandTotal || 0)}</div>
        <div style="font-size:13px;color:#aaa;margin-top:6px">${escapeHtml(e.summary || "")}</div>
      </div>
      ${labor ? `<h3 style="color:#b8720a;margin:16px 0 8px">Labor</h3><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f5f0e8"><th style="padding:8px;text-align:left">Item</th><th style="padding:8px;text-align:center">Qty</th><th style="padding:8px;text-align:right">Rate</th><th style="padding:8px;text-align:right">Total</th></tr></thead><tbody>${labor}</tbody></table>` : ""}
      ${materials ? `<h3 style="color:#b8720a;margin:16px 0 8px">Materials</h3><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f5f0e8"><th style="padding:8px;text-align:left">Item</th><th style="padding:8px;text-align:center">Qty</th><th style="padding:8px;text-align:right">Rate</th><th style="padding:8px;text-align:right">Total</th></tr></thead><tbody>${materials}</tbody></table>` : ""}
      <table style="width:100%;margin-top:14px;font-size:13px">
        <tr><td style="padding:4px 8px">Subtotal</td><td style="padding:4px 8px;text-align:right">${fmt(e.subtotal || 0)}</td></tr>
        <tr><td style="padding:4px 8px">Markup (${e.markupPct || 25}%)</td><td style="padding:4px 8px;text-align:right">${fmt(e.markup || 0)}</td></tr>
        <tr><td style="padding:4px 8px">Tax</td><td style="padding:4px 8px;text-align:right">${fmt(e.tax || 0)}</td></tr>
        <tr style="background:#f5f0e8;font-weight:700"><td style="padding:8px">GRAND TOTAL</td><td style="padding:8px;text-align:right;color:#b8720a;font-size:18px">${fmt(e.grandTotal || 0)}</td></tr>
      </table>
      <div style="background:#fffbe6;border-left:4px solid #c9a84c;padding:12px;margin-top:14px;font-size:12px;color:#666"><strong>AI Notes:</strong> ${escapeHtml(e.notes || "—")}</div>
      <div style="background:#e8f4fd;border-left:4px solid #3498db;padding:12px;margin-top:10px;font-size:13px"><strong>📝 Edit this estimate:</strong> <a href="https://www.sanibuildingcorp.com/dashboard?ref=${data.ref}" style="color:#3498db">Open in Dashboard</a></div>
    `;
  } else if (data.aiError) {
    estimateHtml = `<div style="background:#fee;border-left:4px solid #e74c3c;padding:14px;margin-top:18px;color:#c0392b"><strong>⚠️ AI estimate failed:</strong> ${escapeHtml(data.aiError)}<br>Please review the customer details and prepare a manual estimate.</div>`;
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>body{font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:20px;color:#333;line-height:1.6}</style></head>
<body>
<div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#fff;padding:24px;border-radius:10px 10px 0 0;text-align:center">
  <div style="font-family:'Bebas Neue',Arial,sans-serif;font-size:22px;letter-spacing:3px;color:#c9a84c">SANI BUILDING CORP</div>
  <div style="font-size:11px;letter-spacing:2px;color:#aaa;margin-top:4px">NEW ESTIMATE REQUEST</div>
</div>
<div style="background:#fff;border:1px solid #e8e2d9;border-top:none;padding:24px;border-radius:0 0 10px 10px">
  <h1 style="font-family:'Bebas Neue',Arial,sans-serif;color:#0d1b2a;letter-spacing:2px;font-size:26px;margin:0 0 8px">📋 New Estimate Request</h1>
  <div style="background:#fffbe6;border-left:4px solid #c9a84c;padding:10px 14px;margin-bottom:18px;font-size:13px"><strong>Reference:</strong> ${escapeHtml(data.ref)} · <strong>Submitted:</strong> ${new Date(data.submittedAt).toLocaleString("en-US", { timeZone: "America/New_York" })} ET</div>

  <h2 style="color:#b8720a;font-family:'Bebas Neue',Arial,sans-serif;letter-spacing:2px;font-size:18px">👤 Customer</h2>
  <table style="width:100%;font-size:14px;margin-bottom:14px">
    <tr><td style="padding:5px 8px;width:130px;color:#888"><strong>Name</strong></td><td style="padding:5px 8px">${escapeHtml(data.name)}</td></tr>
    <tr><td style="padding:5px 8px;color:#888"><strong>Phone</strong></td><td style="padding:5px 8px"><a href="tel:${escapeHtml(data.phone)}" style="color:#b8720a">${escapeHtml(data.phone)}</a></td></tr>
    <tr><td style="padding:5px 8px;color:#888"><strong>Email</strong></td><td style="padding:5px 8px"><a href="mailto:${escapeHtml(data.email)}" style="color:#b8720a">${escapeHtml(data.email)}</a></td></tr>
    <tr><td style="padding:5px 8px;color:#888"><strong>Address</strong></td><td style="padding:5px 8px">${escapeHtml(data.address)}</td></tr>
    <tr><td style="padding:5px 8px;color:#888"><strong>Best Time</strong></td><td style="padding:5px 8px">${escapeHtml(data.contactTime || "Anytime")}</td></tr>
    <tr><td style="padding:5px 8px;color:#888"><strong>Source</strong></td><td style="padding:5px 8px">${escapeHtml(data.source || "—")}</td></tr>
  </table>

  <h2 style="color:#b8720a;font-family:'Bebas Neue',Arial,sans-serif;letter-spacing:2px;font-size:18px">🏗️ Project</h2>
  <table style="width:100%;font-size:14px;margin-bottom:14px">
    <tr><td style="padding:5px 8px;width:130px;color:#888"><strong>Type</strong></td><td style="padding:5px 8px"><strong>${escapeHtml(data.type)}</strong></td></tr>
    <tr><td style="padding:5px 8px;color:#888"><strong>Size</strong></td><td style="padding:5px 8px">${escapeHtml(data.size || "Not specified")}</td></tr>
    <tr><td style="padding:5px 8px;color:#888"><strong>Budget</strong></td><td style="padding:5px 8px">${escapeHtml(data.budget || "Not specified")}</td></tr>
    <tr><td style="padding:5px 8px;color:#888"><strong>Timeline</strong></td><td style="padding:5px 8px">${escapeHtml(data.timeline || "Flexible")}</td></tr>
    <tr><td style="padding:5px 8px;color:#888"><strong>Photos</strong></td><td style="padding:5px 8px">${data.photoCount || 0} attached (see Netlify Forms)</td></tr>
  </table>
  <div style="background:#f8f8f8;border-radius:8px;padding:14px;margin-bottom:14px"><strong style="color:#888;font-size:12px;letter-spacing:1px;text-transform:uppercase">Description</strong><div style="margin-top:8px;font-size:14px">${escapeHtml(data.description).replace(/\n/g, "<br>")}</div></div>

  ${estimateHtml}

  <div style="margin-top:24px;padding-top:18px;border-top:1px solid #eee;text-align:center;color:#999;font-size:12px">
    📞 <a href="tel:${escapeHtml(data.phone)}" style="color:#b8720a;text-decoration:none">Call ${escapeHtml(data.name.split(" ")[0])}</a> &nbsp;·&nbsp; ✉ <a href="mailto:${escapeHtml(data.email)}" style="color:#b8720a;text-decoration:none">Email</a> &nbsp;·&nbsp; 📋 <a href="https://www.sanibuildingcorp.com/dashboard" style="color:#b8720a;text-decoration:none">Dashboard</a>
  </div>
</div>
</body></html>`;

  const emailData = JSON.stringify({
    from: "Sani Building Corp <noreply@sanibuildingcorp.com>",
    to: [contractorEmail],
    reply_to: data.email,
    subject: `🆕 Estimate Request: ${data.type} - ${data.name} (${data.ref})`,
    html,
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.resend.com",
        port: 443,
        path: "/emails",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(emailData),
          Authorization: `Bearer ${resendKey}`,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const response = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(response);
          } else {
            reject(new Error(`Resend error: ${response}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(emailData);
    req.end();
  });
}

function escapeHtml(text) {
  if (text == null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
