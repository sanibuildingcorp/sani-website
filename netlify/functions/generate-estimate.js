// netlify/functions/generate-estimate.js
// AI scope + line-item generator.  (v3 — Aug 5 2026)
// Reads the customer's V3 request from Blobs, asks Claude to draft scope + pricing,
// saves the draft back to Blobs, returns it to the dashboard.
//
// v3 ADDS (all backwards compatible — older estimates still render unchanged):
//   section          on every labor/material line — explicit service grouping, so the
//                    quote page no longer has to guess sections from keywords.
//   customerSupplied[]  items the CUSTOMER buys. Priced at $0, labeled, still installed.
//   exclusions[]     plain-language "not included in this price" list.
//   options[]        priced alternates (e.g. "Option A: replace all windows" vs
//                    "Option B: acoustic masters + repair rest"). NOT in the grand total.
//   houseRules       optional standing contractor rules injected into the prompt
//                    (rates, standard exclusions, wording). Sent by the dashboard.
//
// The dashboard can include/exclude each input before generating:
//   usePhotoAnalysis (default FALSE) — AI photo-analysis findings. OFF for pricing by
//                                      default so photos never inflate the price. The
//                                      analysis is still saved with the request and shown
//                                      in the dashboard (for the contractor's eyes only).
//                                      Send usePhotoAnalysis:true to fold it into pricing.
//   useDescription   (default true)  — customer's free-text description
//   useAnswers       (default true)  — customer's answers to the intake questions
// Description and answers stay ON unless explicitly set to false (old behavior preserved).
// Price is built from the customer's answers + typed description only.

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
    if (!ref) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing ref" }) };
    }

    // Input toggles.
    // Photo analysis is OFF for pricing unless the dashboard explicitly opts in.
    const includeAnalysis = body.usePhotoAnalysis === true;
    // Description and answers stay on unless explicitly turned off (backwards compatible).
    const includeDescription = body.useDescription !== false;
    const includeAnswers = body.useAnswers !== false;
    const extraRequest = (body.extraRequest || "").trim();
    // Standing contractor rules (rates / standard exclusions / wording). Optional.
    const houseRules = (body.houseRules || "").trim();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }) };
    }

    // Load the customer's request
    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const record = await store.get(ref, { type: "json" });
    if (!record) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "Estimate not found" }) };
    }

    // Build the prompt
    const customer = record.customer || {};
    const request = record.request || {};

    // ---- Question answers (optional) ----
    const answers = request.serviceAnswers || {};
    // The intake form tags every answer with the trade it belongs to. Group by trade so
    // the estimator knows which service each answer sizes — and which "section" to use.
    const answerTopics = (request.answerTopics && typeof request.answerTopics === "object")
      ? request.answerTopics
      : {};
    const grouped = {};
    Object.entries(answers)
      .filter(([_, v]) => v && String(v).trim())
      .forEach(([k, v]) => {
        const trade = String(answerTopics[k] || "General").trim() || "General";
        if (!grouped[trade]) grouped[trade] = [];
        grouped[trade].push(`- ${k.replace(/-/g, " ")}: ${v}`);
      });
    const answersText = Object.keys(grouped).length
      ? Object.entries(grouped)
          .map(([trade, rows]) => `${trade.toUpperCase()}:\n${rows.join("\n")}`)
          .join("\n\n")
      : "";

    const answersBlock = includeAnswers
      ? `CUSTOMER ANSWERS TO QUESTIONS (grouped by trade — use these trade names as the "section" on the matching lines):\n${answersText || "(no specific answers)"}`
      : `CUSTOMER ANSWERS TO QUESTIONS:\n(excluded by contractor — do not use)`;

    // ---- Description (optional) ----
    const descLine = includeDescription
      ? `Description: ${request.description || "(none)"}`
      : `Description: (excluded by contractor — do not use)`;

    // ---- Square footage from the intake form, if the customer gave one ----
    const sqftLine = request.sqft && String(request.sqft).trim()
      ? `Approx. size given by customer: ${request.sqft}`
      : "";

    // ---- Materials the customer said they will supply themselves ----
    // Comes from the intake form's supplies step (array of item names) when present.
    // Falls back to nothing; the AI can still detect supplied items from the text.
    const suppliedList = Array.isArray(request.customerSupplies)
      ? request.customerSupplies.filter((s) => s && String(s).trim())
      : [];
    const suppliedBlock = suppliedList.length
      ? `\n\nMATERIALS THE CUSTOMER IS SUPPLYING THEMSELVES (confirmed on the intake form — these are AUTHORITATIVE):\n${suppliedList
          .map((s) => `- ${s}`)
          .join("\n")}\nDo NOT put a price on any of these. Put each one in "customerSupplied" instead. KEEP the labor to install them.`
      : "";

    // ---- AI photo analysis (optional, OFF by default) ----
    // The photo analysis is saved with the request and shown in the dashboard for the
    // contractor. It is NOT used for pricing unless the dashboard sends usePhotoAnalysis:true.
    const analysis = Array.isArray(request.photoAnalysis) ? request.photoAnalysis : [];
    let analysisBlock = "";
    if (includeAnalysis && analysis.length > 0) {
      const analysisText = analysis
        .map((a, i) => {
          const bits = [];
          if (a.detected) bits.push(`detected "${a.detected}"`);
          if (a.description) bits.push(`observed: ${a.description}`);
          if (a.recommendedAction) bits.push(`suggested fix: ${a.recommendedAction}`);
          if (a.estimatedComplexity) bits.push(`complexity: ${a.estimatedComplexity}`);
          if (a.confidence) bits.push(`confidence: ${a.confidence}`);
          if (a.safetyFlag) bits.push(`SAFETY FLAG — needs in-person inspection`);
          return `- Photo ${i + 1}: ${bits.join("; ")}`;
        })
        .join("\n");
      analysisBlock =
        `\n\nAI PHOTO ANALYSIS (preliminary, generated from the customer's photos — treat as a helpful hint, NOT confirmed fact; the contractor verifies on site):\n${analysisText}`;
    }

    // ---- Contractor notes / measurements / corrections (authoritative; sizes the job) ----
    const extraBlock = extraRequest
      ? `\n\nCONTRACTOR NOTES, MEASUREMENTS & CORRECTIONS (added by the contractor — CONFIRMED and AUTHORITATIVE; these OVERRIDE the customer's description wherever they conflict). They may add work, remove work, or correct the SIZE of the job (for example an exact area like "total ~50 sq ft", or the real number of walls / rooms / units). Size all labor and materials to match these:\n${extraRequest}`
      : "";

    // ---- Standing house rules (contractor's own rates / exclusions / wording) ----
    const houseBlock = houseRules
      ? `\n\nCONTRACTOR'S STANDING HOUSE RULES (this contractor's own rates, standard exclusions and wording — these OVERRIDE the generic NYC pricing guidelines below wherever they conflict):\n${houseRules}`
      : "";

    const prompt = `You are an estimator for Sani Building Corp, an NYC-metro general contractor (Manhattan, Brooklyn, Queens, Bronx, Staten Island, Long Island, Nassau). You build detailed estimates from customer requests.

STRICT WORDING RULE: NEVER use the word "licensed" or any licensing claim anywhere in your output (summary, scope, notes, line items, exclusions, options). When describing credentials or quality assurance, say "fully insured" and/or "experienced trades" instead — e.g. "All work performed to NYC building code standards by experienced, fully insured trades." This rule has no exceptions.

CUSTOMER REQUEST:
Service: ${request.service || "General"}
Property: ${request.propertyType || "Not specified"}
Timeline: ${request.timeline || "Not specified"}
Address: ${customer.address || "Not specified"}
${descLine}
${sqftLine}

${answersBlock}${suppliedBlock}${analysisBlock}${extraBlock}${houseBlock}

SIZING RULES (read first — this is the #1 cause of over-quoting, so follow it strictly):
- If ANY specific measurement or quantity is given (sq ft, linear ft, number of walls / rooms / units), price STRICTLY to that number. Labor hours and material quantities must scale to the measured size. A small measured area means a small estimate — e.g. a 50 sq ft drywall+paint patch is a few hundred dollars, not thousands.
- A contractor measurement ALWAYS beats a vague customer description. If the customer says "4-6 apartments" but the contractor notes say "total ~50 sq ft", price the 50 sq ft — NOT 4-6 full units.
- If the size is vague and NO measurement is given anywhere, assume the SMALLEST reasonable interpretation, price for that, and clearly state the assumption in "notes" (e.g. "Assumed ~X sq ft / 1 room — confirm on site"). Never price for the maximum just because the description sounds big.
- Do NOT pad hours or quantities for safety margin. Margin comes from the markup percentage, not from inflated line items.

NEGATIVE-INSTRUCTION SCAN (do this before you price anything — these are the instructions that cost money when missed):
Re-read every word the customer wrote and hunt specifically for what must be LEFT OUT. People bury these in the middle of a sentence. Look for:
- "I'm providing / I'll supply / owner supplies / I already bought" → goes in customerSupplied, priced at $0, labor KEPT.
- "no ___", "not needed", "excluded", "except", "skip", "leave the existing ___" → do NOT price it. Put it in exclusions so the customer sees you read them.
- Rooms or areas carved out ("kitchen excluded", "bathroom not included in the flooring") → subtract that area before you calculate quantities.
- Anything staying in place ("existing shower pan remains", "fixtures stay in current locations") → no demo, no replacement, no rough-in for that item.
Missing one of these is worse than a rough price: it tells the customer you did not read their message.

SECTIONS (required):
Give EVERY labor line and EVERY material line a "section" — the service it belongs to, in Title Case. Use the customer's own service names where possible (e.g. "Bathroom", "Flooring", "Painting", "Windows", "Kitchen", "Carpentry"). If the whole job is one service, use that one name on every line. Never invent a section that has no work in it. Consistency matters: the exact same section string must be reused on every line belonging to that service, because the customer's quote groups and subtotals by this field.

OPTIONS:
Only create "options" if the customer explicitly asked for alternates / "price both ways" / "Option A and Option B". Each option is priced on its own and is NOT part of the main total — the customer picks one. If they did not ask for alternates, return an empty array.

YOUR TASK:
Generate a realistic, professional estimate draft for this NYC-area project, sized per the rules above. Use current NYC labor and material rates. Be specific — itemize labor by trade/task and materials by what's actually needed. Do not add work nobody described.

PRICING GUIDELINES (NYC market 2026 — the contractor's house rules above override these):
- General handyman labor: $75-95/hr
- Skilled trades (plumber/electrician/tile setter): $110-150/hr
- Painter: $55-75/hr
- Demolition: $60-80/hr per laborer
- Mid-range tile: $5-12/sqft material
- Standard paint: $50-70/gallon
- Bathroom vanity (basic): $300-800
- Toilet (mid-range): $250-450

OUTPUT: Return ONLY a JSON object (no markdown, no commentary) with this exact shape:
{
  "projectTitle": "Short project title for the customer (e.g. 'Master Bathroom Renovation - Brooklyn')",
  "summary": "2-3 sentence summary the customer will see at the top of their quote. Confident, clear, no jargon.",
  "scopeOfWork": "Full scope of work as a single string with line breaks. Cover demolition (if any), prep, main work in trade order, finishing, cleanup. Customer reads this — be clear but professional.",
  "labor": [
    {"item": "Specific labor task description", "qty": 1, "unit": "hrs", "rate": 85, "section": "Bathroom"}
  ],
  "materials": [
    {"item": "Specific material with brief spec", "qty": 1, "unit": "ea", "rate": 50, "section": "Bathroom"}
  ],
  "customerSupplied": [
    {"item": "What the customer is buying themselves", "section": "Bathroom", "note": "Installation included in our price"}
  ],
  "exclusions": [
    "Short plain-language line describing something NOT included in this price"
  ],
  "options": [
    {"label": "Option A - Replace all windows", "description": "What this option covers, in plain words", "price": 12500, "section": "Windows"}
  ],
  "timelineText": "Estimated duration in plain words (e.g. '5-7 business days')",
  "markupPct": 25,
  "notes": "Internal notes to the contractor about assumptions made or things to verify with the customer. Customer will NOT see this."
}

IMPORTANT:
- Use realistic NYC rates, but price ONLY the work and size described/measured — do not pad the scope.
- 4-10 labor items, 4-12 material items is typical for a normal single-room job; fewer for small measured jobs.
- Unit options: hrs, days, ea, sqft, lf (linear foot), gal, box
- EVERY labor and material line MUST have a "section". No exceptions.
- customerSupplied items carry NO price and NO qty — they are a visible acknowledgement, not a charge. Never also list them under materials.
- exclusions: 3-8 short lines. Always include the things this customer specifically said to leave out, plus genuine standard ones for this job (e.g. permits and filings, asbestos or lead abatement, concealed conditions found behind walls or floors, appliance purchase). Keep each under 15 words. Do not use the word "licensed".
- options: empty array unless the customer asked for alternates.
- If size info is missing, make the smallest conservative assumption and note it in "notes".
- Return ONLY the JSON. No preamble. No code fences.`;

    // Call Claude API
    const aiResponse = await callClaude(apiKey, prompt);

    // Parse JSON from response
    let parsed;
    try {
      const cleaned = aiResponse.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("Failed to parse AI response:", aiResponse.slice(0, 500));
      return {
        statusCode: 500,
        headers: cors(),
        body: JSON.stringify({ error: "AI returned invalid JSON", raw: aiResponse.slice(0, 500) }),
      };
    }

    // ---- Normalise the new v3 fields so the dashboard never sees a surprise shape ----
    const cleanLines = (arr) =>
      (Array.isArray(arr) ? arr : []).map((l) => ({
        item: String(l.item || "").trim(),
        qty: Number(l.qty) || 0,
        unit: String(l.unit || "ea").trim(),
        rate: Number(l.rate) || 0,
        section: String(l.section || "General").trim() || "General",
      }));

    const cleanSupplied = (Array.isArray(parsed.customerSupplied) ? parsed.customerSupplied : [])
      .map((s) => {
        if (typeof s === "string") return { item: s.trim(), section: "General", note: "" };
        return {
          item: String(s.item || "").trim(),
          section: String(s.section || "General").trim() || "General",
          note: String(s.note || "").trim(),
        };
      })
      .filter((s) => s.item);

    const cleanExclusions = (Array.isArray(parsed.exclusions) ? parsed.exclusions : [])
      .map((x) => (typeof x === "string" ? x : String(x && x.item ? x.item : "")).trim())
      .filter(Boolean)
      .slice(0, 12);

    const cleanOptions = (Array.isArray(parsed.options) ? parsed.options : [])
      .map((o) => ({
        label: String(o.label || "").trim(),
        description: String(o.description || "").trim(),
        price: Number(o.price) || 0,
        section: String(o.section || "General").trim() || "General",
      }))
      .filter((o) => o.label);

    // Save to Blobs as a draft
    record.estimate = {
      projectTitle: parsed.projectTitle || `${request.service} - ${customer.name || ""}`,
      summary: parsed.summary || "",
      scopeOfWork: parsed.scopeOfWork || "",
      labor: cleanLines(parsed.labor),
      materials: cleanLines(parsed.materials),
      customerSupplied: cleanSupplied,
      exclusions: cleanExclusions,
      options: cleanOptions,
      timelineText: parsed.timelineText || "",
      markupPct: typeof parsed.markupPct === "number" ? parsed.markupPct : 25,
      notes: parsed.notes || "",
    };
    record.status = record.status === "new" ? "drafted" : record.status;
    record.updatedAt = new Date().toISOString();

    await store.setJSON(ref, record);

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({ success: true, estimate: record.estimate, status: record.status }),
    };
  } catch (err) {
    console.error("generate-estimate error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

function callClaude(apiKey, prompt) {
  const payload = JSON.stringify({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4000,
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
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const json = JSON.parse(body);
              const text = (json.content || []).map((c) => c.text || "").join("");
              resolve(text);
            } catch (e) {
              reject(new Error("Bad Claude response: " + body.slice(0, 200)));
            }
          } else {
            reject(new Error(`Claude ${res.statusCode}: ${body.slice(0, 300)}`));
          }
        });
      }
    );
    req.on("error", reject);
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
