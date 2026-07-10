// netlify/functions/analyze-bid-background.js
// BID ANALYZER — Phase 1 MVP (background function, 15-min limit, trigger-and-poll)
//
// TRUST DESIGN (the rules that make numbers verifiable):
//   1. AI does TAKEOFF ONLY — extracts scope items, quantities, units, source pages,
//      confidence bands, assumptions, compliance requirements from the PDF.
//   2. AI NEVER prices anything. It may only map items to price_book item_codes
//      that this function passes in. Anything unmatched → "NOT IN PRICE BOOK" flag.
//   3. ALL MATH IS DONE IN THIS CODE from the Supabase price_book table:
//        material = qty × unit_material_cost × (1 + waste_pct/100)
//        labor    = qty × labor_hours_per_unit × labor_rate
//   4. Contingency is DATA-DRIVEN: base % + extra % scaled by share of Low/Medium
//      confidence items, so uncertainty raises the price instead of hiding in it.
//
// Flow: browser uploads PDF to Supabase (signed URL) → POSTs {jobId, fileUrl, fileName, notes}
// here → we insert bid_jobs row (processing) → Claude reads the PDF by URL → we validate
// JSON, price it, save result → dashboard polls get-bid-analysis.js.

const MODEL = "claude-sonnet-4-5-20250929";

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };

  let jobId = null;
  try {
    const body = JSON.parse(event.body || "{}");
    jobId = body.jobId;
    const fileUrl = body.fileUrl;
    const fileName = body.fileName || "bid-package.pdf";
    const notes = (body.notes || "").trim();

    if (!jobId || !fileUrl) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing jobId or fileUrl" }) };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

    // 1) Mark job as processing
    await sb("POST", "/rest/v1/bid_jobs", {
      id: jobId, status: "processing", file_url: fileUrl, file_name: fileName
    }, { Prefer: "resolution=merge-duplicates" });

    // 2) Load price book + settings
    const priceBook = await sb("GET", "/rest/v1/price_book?select=*&order=csi_code.asc") || [];
    const settingsRows = await sb("GET", "/rest/v1/bid_settings?select=*") || [];
    const settings = {};
    settingsRows.forEach(r => { settings[r.key] = parseFloat(r.value); });
    const overheadPct = isFinite(settings.overhead_pct) ? settings.overhead_pct : 10;
    const profitPct = isFinite(settings.profit_pct) ? settings.profit_pct : 10;
    const contingencyBasePct = isFinite(settings.contingency_base_pct) ? settings.contingency_base_pct : 3;

    const priceBookText = priceBook.map(p =>
      `- item_code: ${p.item_code} | CSI ${p.csi_code} | ${p.description} | unit: ${p.unit}`
    ).join("\n") || "(price book is empty)";

    // 3) Ask Claude to read the bid package (PDF by URL — supports drawings natively)
    const prompt = `You are a professional construction estimator's TAKEOFF assistant for Sani Building Corp, a fully insured NYC general contractor. Read the attached bid package (RFQ / SOW / drawings / schedules) carefully, including any drawing sheets and tables.

${notes ? "CONTRACTOR NOTES (authoritative context):\n" + notes + "\n" : ""}
YOUR JOB IS TAKEOFF AND COMPLIANCE EXTRACTION ONLY. YOU MUST NEVER INVENT, ESTIMATE, OR SUGGEST ANY PRICE, RATE, OR DOLLAR AMOUNT. Pricing is computed separately from the company price book.

COMPANY PRICE BOOK (map scope items to these item_codes when the work matches; if nothing matches, set price_book_item_code to null):
${priceBookText}

CONFIDENCE BANDS (assign one per line item):
- "high": quantity read directly from a dimensioned drawing element or an explicit schedule/table entry; no interpretation needed.
- "medium": quantity derived from written SOW text requiring calculation, or from a drawing with ambiguous/unconfirmed scale.
- "low": quantity inferred from indirect language, missing dimensions, or conflict between drawing and spec text. Every "low" item MUST get an rfi_draft.

RESPOND WITH ONLY VALID JSON (no markdown fences, no commentary) in exactly this schema:
{
  "project_summary": "2-3 sentence plain-language summary of the project and location",
  "is_federal": true/false,
  "agency_signals": ["keywords found, e.g. Federal Bureau of Prisons, FAR clause numbers"],
  "line_items": [
    {
      "description": "Remove existing shower partition with attached changing room",
      "csi_code": "10 21 13",
      "qty": 7,
      "unit": "EA",
      "takeoff_type": "count|linear|area",
      "source": "SOW.pdf p.2, Schedule of Supplies line 1",
      "confidence": "high|medium|low",
      "price_book_item_code": "matching item_code or null",
      "assumptions": ["assumption applied to get this quantity, if any"],
      "rfi_draft": "only for low confidence: a one-sentence question to send the contracting officer"
    }
  ],
  "compliance_checklist": [
    { "requirement": "e.g. Submittals due 15 days after Notice to Proceed", "source": "page ref", "category": "deadline|security|wage|bonding|site-rules|payment|other" }
  ],
  "davis_bacon": { "applies": true/false, "note": "if federal construction over $2,000, prevailing wages apply — contractor must pull the wage determination from sam.gov for this location/trades before finalizing labor rates" },
  "missing_information": ["things the package does not specify that affect price"],
  "assumptions_log": ["every interpretation you made anywhere in this takeoff"],
  "work_constraints": ["access/hours/site rules that affect labor productivity, e.g. 7AM-3PM only, escorts, no phones"],
  "quote_due": "deadline if stated, else null",
  "payment_terms": "if stated, else null"
}

Quantity accuracy rules: roll up repeated conditions with visible multipliers in the description (e.g. "5 floors × 6 stalls = 30 EA"). If the drawing scale is unconfirmed, cap confidence at medium. If a quantity conflicts between drawing and text, use the text, mark low, and write the rfi_draft.`;

    const aiResp = await callClaude(apiKey, [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "url", url: fileUrl } },
          { type: "text", text: prompt }
        ]
      }
    ]);

    // 4) Parse + validate (raw model output is untrusted until it parses)
    let parsed;
    try {
      parsed = JSON.parse(aiResp.replace(/```json/gi, "").replace(/```/g, "").trim());
    } catch (e) {
      throw new Error("AI returned invalid JSON — re-run the analysis. Raw start: " + aiResp.slice(0, 200));
    }
    if (!Array.isArray(parsed.line_items)) throw new Error("AI response missing line_items array");

    // 5) PRICE IT — code does the math from the price book. AI numbers never touch pricing.
    const bookByCode = {};
    priceBook.forEach(p => { bookByCode[p.item_code] = p; });

    let directSubtotal = 0;
    let counts = { high: 0, medium: 0, low: 0 };
    let needsPricing = [];

    const pricedItems = parsed.line_items.map(li => {
      const conf = ["high", "medium", "low"].includes(li.confidence) ? li.confidence : "low";
      counts[conf]++;
      const qty = Number(li.qty) || 0;
      const book = li.price_book_item_code ? bookByCode[li.price_book_item_code] : null;

      let material = null, laborHours = null, labor = null, total = null, unitPriced = false;
      if (book && qty > 0) {
        const waste = 1 + (Number(book.waste_pct) || 0) / 100;
        material = round2(qty * (Number(book.unit_material_cost) || 0) * waste);
        laborHours = round2(qty * (Number(book.labor_hours_per_unit) || 0));
        labor = round2(laborHours * (Number(book.labor_rate) || 0));
        total = round2(material + labor);
        directSubtotal += total;
        unitPriced = true;
      } else {
        needsPricing.push({
          description: li.description,
          suggested_csi: li.csi_code || "",
          qty, unit: li.unit || ""
        });
      }

      return {
        ...li,
        qty,
        confidence: conf,
        priced: unitPriced,
        material_cost: material,
        labor_hours: laborHours,
        labor_cost: labor,
        line_total: total,
        price_source: book ? `price_book:${book.item_code}` : "NOT IN PRICE BOOK"
      };
    });

    // 6) Data-driven contingency: base + 1.5% per 10% of items that are Medium, +3% per 10% Low, capped at 15%
    const totalItems = Math.max(1, pricedItems.length);
    const medShare = counts.medium / totalItems;
    const lowShare = counts.low / totalItems;
    const contingencyPct = round2(Math.min(15, contingencyBasePct + medShare * 15 + lowShare * 30));

    const overhead = round2(directSubtotal * overheadPct / 100);
    const profit = round2(directSubtotal * profitPct / 100);
    const contingency = round2(directSubtotal * contingencyPct / 100);
    const bidTotal = round2(directSubtotal + overhead + profit + contingency);

    const result = {
      generated_at: new Date().toISOString(),
      model: MODEL,
      file_name: fileName,
      project_summary: parsed.project_summary || "",
      is_federal: !!parsed.is_federal,
      agency_signals: parsed.agency_signals || [],
      line_items: pricedItems,
      needs_pricing: needsPricing,
      compliance_checklist: parsed.compliance_checklist || [],
      davis_bacon: parsed.davis_bacon || null,
      missing_information: parsed.missing_information || [],
      assumptions_log: parsed.assumptions_log || [],
      work_constraints: parsed.work_constraints || [],
      quote_due: parsed.quote_due || null,
      payment_terms: parsed.payment_terms || null,
      confidence_rollup: counts,
      pricing: {
        direct_subtotal: round2(directSubtotal),
        overhead_pct: overheadPct, overhead,
        profit_pct: profitPct, profit,
        contingency_pct: contingencyPct, contingency,
        contingency_reason: `Base ${contingencyBasePct}% + risk from ${counts.medium} medium / ${counts.low} low confidence items of ${totalItems}`,
        bid_total: bidTotal,
        incomplete: needsPricing.length > 0,
        incomplete_note: needsPricing.length > 0
          ? `${needsPricing.length} scope item(s) have NO price book entry and are NOT included in this total. Add rates in Supabase → price_book, then re-run.`
          : null
      }
    };

    // 7) Save
    await sb("PATCH", `/rest/v1/bid_jobs?id=eq.${encodeURIComponent(jobId)}`, {
      status: "done", result: result, error: null
    });

    return { statusCode: 200, headers: cors(), body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error("analyze-bid error:", err.message);
    if (jobId) {
      try {
        await sb("PATCH", `/rest/v1/bid_jobs?id=eq.${encodeURIComponent(jobId)}`, {
          status: "error", error: err.message
        });
      } catch (e2) { console.error("failed to save error state:", e2.message); }
    }
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

// ---- Claude API (long timeout — this is a background function) ----
async function callClaude(apiKey, messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Claude API ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
}

// ---- Supabase REST helper ----
async function sb(method, path, bodyObj, extraHeaders) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !KEY) throw new Error("Supabase env vars not set");
  const headers = {
    "apikey": KEY,
    "Authorization": `Bearer ${KEY}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
    ...(extraHeaders || {})
  };
  const res = await fetch(SUPABASE_URL + path, {
    method, headers,
    body: bodyObj ? JSON.stringify(bodyObj) : undefined
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Supabase ${method} ${path} ${res.status}: ${t.slice(0, 300)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };
}
