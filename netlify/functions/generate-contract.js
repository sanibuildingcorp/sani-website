// netlify/functions/generate-contract.js
// AI Contract Generator — builds a PROJECT-SPECIFIC service agreement
// from the estimate data (customer, address, price, scope, materials,
// timeline). Cached on the record so it's generated once per estimate.
// POST { ref, force? }  →  { success, contract }

const https = require("https");
const { getStore } = require("@netlify/blobs");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const ref = body.ref;
    const force = body.force === true;
    if (!ref) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing ref" }) };
    }

    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const record = await store.get(ref, { type: "json" });
    if (!record) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "Estimate not found" }) };
    }

    // Return cached contract (never regenerate after signing)
    if (record.contract && record.contract.sections && (record.contract.signed || !force)) {
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ success: true, contract: record.contract, cached: true }) };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }) };
    }

    const customer = record.customer || {};
    const est = record.estimate || {};
    const reqData = record.request || {};

    // ---- Total (honor customer's final total if they changed finishes) ----
    const mk = 1 + (Number(est.markupPct) || 0) / 100;
    const laborSum = (est.labor || []).reduce(function (s, i) { return s + (Number(i.qty) || 0) * (Number(i.rate) || 0); }, 0);
    const matSum = (est.materials || []).reduce(function (s, i) { return s + (Number(i.qty) || 0) * (Number(i.rate) || 0); }, 0);
    const baseTotal = Math.round((laborSum + matSum) * mk * 100) / 100;
    const total = record.customerFinalTotal != null ? Number(record.customerFinalTotal) : baseTotal;

    // ---- Materials & selected finishes ----
    const materialNames = (est.materials || [])
      .map(function (i) { return String(i.item || "").trim(); })
      .filter(Boolean);
    const finishDefaults = [];
    (est.finishGroups || []).forEach(function (g) {
      (g.options || []).forEach(function (o) {
        if (o && o.isDefault) finishDefaults.push(g.name + ": " + o.name + (o.spec ? " (" + o.spec + ")" : ""));
      });
    });
    // Customer-chosen finishes override defaults
    const chosen = (record.customerSelections || []).map(function (s) {
      return (s.groupName || s.group || "") + ": " + (s.optionName || s.option || "");
    }).filter(function (t) { return t !== ": "; });

    const projectAddress = record.projectAddress || customer.address || "";

    const prompt = `You are a contracts specialist for Sani Building Corp, a licensed and insured NYC renovation contractor (2954 Brighton 12th Street, Brooklyn, NY 11235 · 332-277-0990 · contact@sanibuildingcorp.com).

Generate a PROJECT-SPECIFIC construction service agreement using ONLY the real project data below. Do not use generic placeholders — every section must reference this actual project.

PROJECT DATA:
- Customer name: ${customer.name || "Customer"}
- Project address: ${projectAddress || "(same as customer address)"}
- Project type/title: ${est.projectTitle || reqData.service || "Renovation project"}
- Contract total: $${total.toFixed(2)}
- Timeline: ${est.timelineText || "To be scheduled"}
- Summary: ${est.summary || "(none)"}
- Scope of work (from estimate):
${String(est.scopeOfWork || "(see labor items)").slice(0, 1200)}
- Labor items: ${(est.labor || []).map(function (i) { return i.item; }).filter(Boolean).join("; ").slice(0, 600) || "(none)"}
- Materials: ${materialNames.join("; ").slice(0, 600) || "(none listed)"}
- Selected finishes: ${(chosen.length ? chosen : finishDefaults).join("; ") || "(standard finishes)"}
- Special customer notes: ${String(reqData.description || "(none)").slice(0, 400)}

OUTPUT: Return ONLY a JSON object (no markdown, no commentary) with this exact shape:
{
  "projectType": "Short project type label (e.g. 'Full Composite Deck Replacement')",
  "scopeOfWork": ["Specific work item 1", "Specific work item 2", "..."],
  "materialsList": ["Material/finish 1 with spec", "..."],
  "timeline": "Project duration in plain words, including permit/material-delivery conditions if relevant",
  "paymentSchedule": [
    {"label": "Deposit — due upon signing", "amount": 0.00},
    {"label": "Final payment — due upon completion", "amount": 0.00}
  ],
  "clauses": {
    "hiddenConditions": "Hidden/concealed conditions clause specific to this project type...",
    "changeOrder": "Change order clause...",
    "warranty": "Workmanship warranty clause (1 year workmanship; manufacturer warranties pass through on materials)...",
    "cancellation": "Cancellation clause (3-business-day right to cancel per NY law; deposit handling)...",
    "permitsAndInsurance": "Permits, NYC code compliance, and insurance clause..."
  }
}

RULES:
1. scopeOfWork: 5-9 items, rewritten in professional contract language from the estimate scope — specific to THIS project.
2. materialsList: use the actual materials/finishes above.
3. paymentSchedule amounts MUST sum to exactly $${total.toFixed(2)}. Use: under $1,000 → single payment on completion; $1,000–$5,000 → 50% deposit / 50% completion; over $5,000 → 40% deposit / 40% mid-project milestone (name the actual milestone for this project) / 20% completion.
4. Clauses: professional NY contractor language, exactly 2 sentences each, tailored to this project type (e.g. deck → mention structural framing discoveries; bathroom → mention plumbing/subfloor).
5. No placeholders like {{name}} — write the real values in.
6. Return ONLY the JSON.`;

    const aiResponse = await callClaude(apiKey, prompt);

    let parsed;
    try {
      const cleaned = aiResponse.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);
    } catch (e) {
      console.error("Contract JSON parse failed:", aiResponse.slice(0, 400));
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "AI returned invalid contract JSON" }) };
    }

    // Normalize + safety: payment schedule must sum to total
    let schedule = Array.isArray(parsed.paymentSchedule) ? parsed.paymentSchedule : [];
    const schedSum = schedule.reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0);
    if (!schedule.length || Math.abs(schedSum - total) > 1) {
      schedule = total >= 1000
        ? [
            { label: "Deposit — due upon signing", amount: Math.round(total * 0.5 * 100) / 100 },
            { label: "Final payment — due upon completion", amount: Math.round(total * 0.5 * 100) / 100 },
          ]
        : [{ label: "Payment in full — due upon completion", amount: total }];
      // fix rounding so it sums exactly
      const fixSum = schedule.reduce(function (s, p) { return s + p.amount; }, 0);
      schedule[schedule.length - 1].amount = Math.round((schedule[schedule.length - 1].amount + (total - fixSum)) * 100) / 100;
    }

    const contract = {
      generatedAt: new Date().toISOString(),
      total: total,
      customerName: customer.name || "",
      projectAddress: projectAddress,
      sections: {
        projectType: parsed.projectType || est.projectTitle || "Renovation Project",
        scopeOfWork: Array.isArray(parsed.scopeOfWork) ? parsed.scopeOfWork : [],
        materialsList: Array.isArray(parsed.materialsList) ? parsed.materialsList : materialNames,
        timeline: parsed.timeline || est.timelineText || "To be scheduled",
        paymentSchedule: schedule,
        clauses: parsed.clauses || {},
      },
    };

    record.contract = contract;
    record.updatedAt = new Date().toISOString();
    await store.setJSON(ref, record);

    return { statusCode: 200, headers: cors(), body: JSON.stringify({ success: true, contract: contract }) };
  } catch (err) {
    console.error("generate-contract error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

function callClaude(apiKey, prompt) {
  const payload = JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1800,
    messages: [{ role: "user", content: prompt }],
  });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        port: 443,
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        timeout: 8500,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const json = JSON.parse(body);
              resolve((json.content || []).map((c) => c.text || "").join(""));
            } catch (e) {
              reject(new Error("Bad Claude response"));
            }
          } else {
            reject(new Error(`Claude ${res.statusCode}: ${body.slice(0, 300)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Contract generation timeout — tap Try Again")); });
    req.write(payload);
    req.end();
  });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
