// netlify/functions/generate-estimate-background.js
// Same estimator as generate-estimate.js, run as a Netlify BACKGROUND function so it
// is not killed at 10 seconds. Writes aiStatus onto the record for the dashboard poller.
// Smart Renovation Estimator v6 — Aug 6, 2026
//
// Pipeline:
// 1) Read and structure the full customer request.
// 2) Detect missing/contradictory information and pricing readiness.
// 3) Generate a complete trade-by-trade estimate from the structured scope.
// 4) Validate trade coverage, installation labor, rough materials and total realism.
// 5) Save both the internal project analysis and the estimate draft to Netlify Blobs.
//
// V6 uses OpenAI for structured project understanding, Claude for estimating,
// and deterministic JavaScript for the customer-facing scope.
// Backwards compatible with the existing dashboard response shape.

const https = require("https");
const { getStore } = require("@netlify/blobs");
const { applyDeterministicPricing, consolidateCustomerPresentation } = require("./lib/deterministic-pricing");

const CLAUDE_MODEL = process.env.ESTIMATOR_MODEL || "claude-sonnet-4-5-20250929";
const OPENAI_ANALYSIS_MODEL = process.env.ESTIMATOR_ANALYSIS_MODEL || "gpt-5-mini";
const DEFAULT_MARKUP = 25;

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  try {
    const body = safeJsonParse(event.body, {});
    const ref = String(body.ref || "").trim();
    if (!ref) return jsonResponse(400, { error: "Missing ref" });

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!anthropicKey && !openaiKey) {
      return jsonResponse(500, { error: "No AI provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY." });
    }

    // Load the request through a resilient storage adapter. It first uses
    // Netlify Blobs and, if the legacy Blob context rejects its credentials,
    // falls back to the site's already-deployed get-estimate function.
    const storage = await loadEstimateRecord(ref, event, body);
    const store = storage.store;
    const record = storage.record;
    if (!record) return jsonResponse(404, { error: "Estimate not found", stage: "load_estimate" });

    // BACKGROUND MODE: mark the record so the dashboard's poller knows work started.
    // Netlify kills a normal function at 10s; a *-background function runs up to 15 min
    // but cannot return a body to the browser, so progress is written onto the record.
    record.aiStatus = "running";
    record.aiError = "";
    record.aiStartedAt = new Date().toISOString();
    if (store) { try { await store.setJSON(ref, record); } catch (_) {} }

    const input = buildEstimatorInput(record, body);

    // PASS 1: Understand the project before pricing it.
    const analysisPrompt = buildProjectAnalysisPrompt(input);
    const rawAnalysis = openaiKey
      ? await callOpenAI(openaiKey, analysisPrompt)
      : await callClaude(anthropicKey, analysisPrompt, 6000);
    const projectAnalysis = normalizeProjectAnalysis(parseAiJson(rawAnalysis, "project analysis"), input);

    // PASS 2: Price the structured scope, not the raw paragraph alone.
    const estimatePrompt = buildEstimatePrompt(input, projectAnalysis);
    const rawEstimate = anthropicKey
      ? await callClaude(anthropicKey, estimatePrompt, 8000)
      : await callOpenAI(openaiKey, estimatePrompt);
    let estimate = normalizeEstimate(parseAiJson(rawEstimate, "estimate"), input, projectAnalysis);

    // Deterministic validation catches omissions even when the model misses them.
    let validation = validateEstimate(estimate, projectAnalysis, input);

    // One automatic repair pass when the draft is incomplete or suspiciously low.
    if (!validation.passed) {
      const repairPrompt = buildRepairPrompt(input, projectAnalysis, estimate, validation);
      const rawRepair = anthropicKey
        ? await callClaude(anthropicKey, repairPrompt, 8000)
        : await callOpenAI(openaiKey, repairPrompt);
      estimate = normalizeEstimate(parseAiJson(rawRepair, "repaired estimate"), input, projectAnalysis);
      validation = validateEstimate(estimate, projectAnalysis, input);
    }

    // DETERMINISTIC PRICING GATE: AI interprets scope; Sani rules control production hours,
    // mutually-exclusive alternatives, service ownership, and estimate health.
    estimate = applyDeterministicPricing(estimate, projectAnalysis, input);
    validation = validateEstimate(estimate, projectAnalysis, input);

    estimate = finalizeCustomerPresentation(estimate, projectAnalysis, input);
    estimate = consolidateCustomerPresentation(estimate, projectAnalysis, input);
    estimate.validation = validation;
    estimate.pricingReadiness = projectAnalysis.pricing_readiness;
    estimate.clarificationQuestions = projectAnalysis.clarification_questions;

    record.projectAnalysis = projectAnalysis;
    record.estimate = estimate;
    record.status = record.status === "new" ? "drafted" : record.status;
    record.updatedAt = new Date().toISOString();
    record.aiStatus = "done";
    record.aiError = "";
    record.aiFinishedAt = new Date().toISOString();
    let persistenceWarning = null;
    if (store) {
      try {
        await store.setJSON(ref, record);
      } catch (saveError) {
        console.error("generate-estimate v5.1 save warning:", saveError && saveError.stack ? saveError.stack : saveError);
        persistenceWarning = "The AI draft was generated, but the function could not automatically save it to storage. Review the draft and use the dashboard Save action.";
      }
    } else {
      persistenceWarning = "The AI draft was generated through the storage fallback. Review the draft and use the dashboard Save action.";
    }

    return jsonResponse(200, {
      success: true,
      estimate: record.estimate,
      projectAnalysis: record.projectAnalysis,
      status: record.status,
      warning: persistenceWarning,
      aiProviders: {
        understanding: openaiKey ? `OpenAI ${OPENAI_ANALYSIS_MODEL}` : `Anthropic ${CLAUDE_MODEL}`,
        estimating: anthropicKey ? `Anthropic ${CLAUDE_MODEL}` : `OpenAI ${OPENAI_ANALYSIS_MODEL}`,
        customerPresentation: "Deterministic Sani Building Corp template",
      },
      requiresClarification:
        ["NEEDS_CUSTOMER_QUESTIONS", "SITE_VISIT_REQUIRED"].includes(
          projectAnalysis.pricing_readiness.status
        ),
    });
  } catch (err) {
    console.error("generate-estimate v5 error:", err && err.stack ? err.stack : err);
    // Record the failure so the dashboard's poller stops waiting and shows the real reason.
    try {
      const failRef = String(safeJsonParse(event.body, {}).ref || "").trim();
      if (failRef) {
        const s2 = await loadEstimateRecord(failRef, event, safeJsonParse(event.body, {}));
        if (s2 && s2.store && s2.record) {
          s2.record.aiStatus = "error";
          s2.record.aiError = String((err && err.message) || err).slice(0, 300);
          await s2.store.setJSON(failRef, s2.record);
        }
      }
    } catch (_) {}
    const message = err && err.message ? err.message : "Estimate generation failed";
    const stage = (err && err.stage) || inferFailureStage(message);
    return jsonResponse(500, {
      error: message,
      stage,
      help: stage === "load_estimate"
        ? "The request could not be loaded from storage. The function tried both Netlify Blobs and the existing get-estimate endpoint."
        : stage === "claude_api"
          ? "Claude could not complete the request. Check the model name, API key, account credit, or request size."
          : stage === "ai_json"
            ? "Claude responded, but the returned JSON was incomplete or malformed. Retry once; the raw response is logged in Netlify."
            : "Review the Netlify function log for the exact stage and message.",
    });
  }
};

async function loadEstimateRecord(ref, event, body) {
  let blobError = null;

  // Attempt 1: automatic Netlify runtime context. This is the preferred path
  // whenever the deployed function receives NETLIFY_BLOBS_CONTEXT.
  try {
    const automaticStore = getStore("estimates");
    const automaticRecord = await automaticStore.get(ref, { type: "json" });
    if (automaticRecord) return { store: automaticStore, record: automaticRecord, source: "blobs_auto" };
  } catch (error) {
    blobError = error;
    console.error("Blob automatic-context read failed:", error && error.stack ? error.stack : error);
  }

  // Attempt 2: explicit legacy-function credentials. Only attempt this when
  // both values are present and the site ID has a valid UUID shape.
  const siteID = firstEnv(["MY_SITE_ID", "NETLIFY_SITE_ID", "SITE_ID", "BLOBS_SITE_ID"]);
  const token = firstEnv(["MY_BLOBS_TOKEN", "NETLIFY_BLOBS_TOKEN", "BLOBS_TOKEN", "NETLIFY_AUTH_TOKEN"]);
  if (siteID && token && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(siteID)) {
    try {
      const explicitStore = getStore({ name: "estimates", siteID, token });
      const explicitRecord = await explicitStore.get(ref, { type: "json" });
      if (explicitRecord) return { store: explicitStore, record: explicitRecord, source: "blobs_explicit" };
    } catch (error) {
      blobError = error;
      console.error("Blob explicit-credential read failed:", error && error.stack ? error.stack : error);
    }
  }

  // Attempt 3: call the existing get-estimate function, which already knows
  // how this project reads estimate records. This avoids making the AI
  // generator dependent on a second copy of the storage configuration.
  try {
    const record = await fetchExistingEstimateFunction(ref, event, body);
    if (record) return { store: null, record, source: "get_estimate_function" };
  } catch (error) {
    console.error("get-estimate fallback failed:", error && error.stack ? error.stack : error);
    const original = blobError && blobError.message ? blobError.message : "unknown Blob configuration error";
    throw stageError("load_estimate", `Could not load estimate ${ref}. Blob error: ${original}. Fallback error: ${error.message}`);
  }

  if (blobError) throw stageError("load_estimate", blobError.message || "Estimate storage read failed");
  return { store: null, record: null, source: "none" };
}

function fetchExistingEstimateFunction(ref, event, body) {
  const host = cleanText((event.headers || {}).host || process.env.URL || "www.sanibuildingcorp.com")
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");
  const query = `/\.netlify/functions/get-estimate?ref=${encodeURIComponent(ref)}`.replace('/\\.netlify','/.netlify');
  const incomingHeaders = event.headers || {};
  const dashboardKey = incomingHeaders["x-dashboard-key"] || incomingHeaders["X-Dashboard-Key"] || body.dashboardKey || body.key || "";

  return new Promise((resolve, reject) => {
    const headers = { Accept: "application/json" };
    if (dashboardKey) headers["x-dashboard-key"] = dashboardKey;
    const req = https.request({ hostname: host, port: 443, path: query, method: "GET", headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed;
        try { parsed = text ? JSON.parse(text) : {}; }
        catch (_) { return reject(new Error(`get-estimate returned non-JSON (${res.statusCode}): ${text.slice(0, 250)}`)); }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(parsed.error || `get-estimate returned HTTP ${res.statusCode}`));
        }
        resolve(parsed.record || parsed.estimateRecord || parsed.data || parsed);
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error("get-estimate fallback timed out")));
    req.on("error", reject);
    req.end();
  });
}

function stageError(stage, message) {
  const error = new Error(message);
  error.stage = stage;
  return error;
}

function inferFailureStage(message) {
  const text = String(message || "").toLowerCase();
  if (/load estimate|blob|siteid|expected pattern|storage/.test(text)) return "load_estimate";
  if (/openai/.test(text)) return "openai_api";
  if (/claude|anthropic|timed out|api key/.test(text)) return "claude_api";
  if (/invalid json|returned invalid json|parse/.test(text)) return "ai_json";
  if (/save|persist/.test(text)) return "save_estimate";
  return "estimate_generation";
}

function firstEnv(names) {
  for (const name of names) {
    const value = cleanText(process.env[name]);
    if (value) return value;
  }
  return "";
}

function buildEstimatorInput(record, body) {
  const customer = record.customer || {};
  const request = record.request || {};
  const answers = request.serviceAnswers || {};
  const answerTopics = request.answerTopics || {};

  const groupedAnswers = {};
  Object.entries(answers).forEach(([key, value]) => {
    if (value === null || value === undefined || String(value).trim() === "") return;
    const trade = cleanText(answerTopics[key] || "General") || "General";
    if (!groupedAnswers[trade]) groupedAnswers[trade] = [];
    groupedAnswers[trade].push({
      question: key.replace(/-/g, " "),
      answer: Array.isArray(value) ? value.join(", ") : String(value),
    });
  });

  const customerSupplies = Array.isArray(request.customerSupplies)
    ? request.customerSupplies.map(cleanText).filter(Boolean)
    : [];

  const photoAnalysis = Array.isArray(request.photoAnalysis) ? request.photoAnalysis : [];

  return {
    ref: cleanText(body.ref),
    customer: {
      name: cleanText(customer.name),
      phone: cleanText(customer.phone),
      email: cleanText(customer.email),
      address: cleanText(customer.address),
    },
    request: {
      service: cleanText(request.service || "General"),
      selectedServices: normalizeSelectedServices(request),
      propertyType: cleanText(request.propertyType || "Not specified"),
      timeline: cleanText(request.timeline || "Not specified"),
      sqft: cleanText(request.sqft),
      description: body.useDescription === false ? "" : cleanText(request.description),
      groupedAnswers: body.useAnswers === false ? {} : groupedAnswers,
      customerSupplies,
      photoAnalysis: body.usePhotoAnalysis === false ? [] : photoAnalysis,
    },
    contractor: {
      extraRequest: cleanText(body.extraRequest),
      houseRules: cleanText(body.houseRules),
    },
  };
}

function normalizeSelectedServices(request) {
  const candidates = [];
  if (Array.isArray(request.services)) candidates.push(...request.services);
  if (Array.isArray(request.selectedServices)) candidates.push(...request.selectedServices);
  if (typeof request.service === "string") candidates.push(...request.service.split(/[,/&]+/));
  return unique(candidates.map(cleanText).filter(Boolean));
}

function buildProjectAnalysisPrompt(input) {
  return `You are the Senior Project Intake Manager and Renovation Scope Analyst for Sani Building Corp, an experienced, fully insured NYC-metro renovation and repair contractor.

You DO NOT generate prices in this stage. Your job is to understand what the customer is trying to accomplish, even when the customer uses imperfect homeowner language, mixes technical terms, omits details, or appears to contradict themselves.

STRICT WORDING RULE: Never use the word "licensed" or make any licensing claim.

FULL CUSTOMER INPUT:
${JSON.stringify(input, null, 2)}

CORE ANALYSIS RULES:
1. Read every source together: selected services, description, answers, customer-supplied items, photos, address, and contractor corrections.
2. Contractor notes are authoritative and override customer statements only where they directly conflict.
3. Separate confirmed scope, reasonably implied scope, assumptions, exclusions, missing information and conflicts.
4. Translate homeowner language into contractor-level scope without changing intent.
5. Never silently invent major work. Normal enabling work may be listed as implied, with a reason.
6. Distinguish keeping, repairing, refinishing, replacing in the same location, relocating, supplying and installing.
7. "Fixtures remain in current locations" normally means no relocation; it does NOT mean the fixtures remain existing when replacement is requested elsewhere.
8. Customer-supplied finish materials eliminate only the purchase price of those finish items. They do NOT eliminate installation labor, handling, rough materials, adhesives, fasteners, waterproofing, plumbing connections, electrical connections, protection, disposal or consumables.
9. Every selected trade must be represented. Never let one dominant trade erase another selected trade.
10. Extract all quantities: square feet, linear feet, dimensions, fixture counts, window counts, room counts and floor level.
11. Identify site conditions: occupied/vacant, walk-up/elevator, floor, debris route, parking/loading, work hours, building rules and protection.
12. Ask only questions that materially change scope, labor, materials, schedule, risk or price.
13. Do not ask low-impact cosmetic questions merely to fill a form.
14. Use one status:
   READY_TO_ESTIMATE — major scope, quantities, supply responsibility and site conditions are sufficiently clear.
   PRELIMINARY_ESTIMATE_WITH_ASSUMPTIONS — a useful estimate is possible but defined assumptions are required.
   NEEDS_CUSTOMER_QUESTIONS — critical information is missing and would materially change the estimate.
   SITE_VISIT_REQUIRED — online information cannot responsibly establish scope/price.
15. Never choose the smallest possible interpretation just to lower price. Use the most reasonable professional interpretation supported by the full record.
16. If the customer requested alternatives (for example replace all windows vs replace some and repair others), preserve EACH option separately.
17. Identify customer exclusions exactly. If the customer says kitchen is excluded, do not include kitchen painting/flooring/etc.
18. Keep questions homeowner-friendly and include "Not sure" where appropriate.

Return JSON only with EXACT top-level structure:
{
  "project_summary": "",
  "project_type": "repair | partial renovation | full renovation | installation | replacement | restoration | mixed",
  "selected_trades": [],
  "confirmed_scope": [
    { "trade": "", "scope_items": [], "quantities": {}, "customer_exclusions": [] }
  ],
  "inferred_scope": [
    { "trade": "", "item": "", "reason": "", "requires_confirmation": true }
  ],
  "customer_supplied_finish_materials": [],
  "contractor_supplied_finish_materials": [],
  "contractor_supplied_rough_materials": [],
  "site_conditions": {
    "occupied_status": "",
    "floor_number": "",
    "elevator_access": "",
    "walk_up": "",
    "work_hours": "",
    "debris_access": "",
    "parking_loading": "",
    "building_requirements": "",
    "protection_requirements": ""
  },
  "quantities": {},
  "assumptions": [],
  "exclusions": [],
  "conflicts": [
    { "issue": "", "likely_interpretation": "", "needs_confirmation": true }
  ],
  "missing_information": [
    { "question": "", "reason_needed": "", "priority": "critical | pricing | site_condition | optional", "affected_trade": "" }
  ],
  "clarification_questions": [
    {
      "id": "",
      "question": "",
      "helper_text": "",
      "type": "single_select | multi_select | number | short_text | photo_request",
      "options": [],
      "affected_trade": "",
      "pricing_importance": "critical | high | medium"
    }
  ],
  "pricing_readiness": {
    "status": "READY_TO_ESTIMATE | PRELIMINARY_ESTIMATE_WITH_ASSUMPTIONS | NEEDS_CUSTOMER_QUESTIONS | SITE_VISIT_REQUIRED",
    "confidence_score": 0,
    "reason": ""
  }
}`;
}

function buildEstimatePrompt(input, analysis) {
  return `You are the Senior Construction Estimator for Sani Building Corp in the NYC metro area.

You receive a STRUCTURED project understanding prepared by another AI. Price the WHOLE documented project accurately and conservatively enough to protect the contractor while remaining market-realistic. Do not manufacture work that is unsupported.

STRICT WORDING RULE: Never use the word "licensed" or make a licensing claim.

CUSTOMER / REQUEST INPUT:
${JSON.stringify(input, null, 2)}

STRUCTURED PROJECT UNDERSTANDING:
${JSON.stringify(analysis, null, 2)}

ESTIMATING METHOD:
1. Build the estimate TRADE BY TRADE. Every selected trade must receive appropriate labor and necessary contractor-supplied rough/installation materials.
2. For substantial renovations, use production/crew logic instead of compressing the job into a few generic hourly lines.
3. Separate meaningful operations: protection/setup, demo/removal, disposal/handling, preparation, rough work, installation, finish work, cleanup, project coordination.
4. Every labor and material line MUST contain "section" equal to the appropriate trade (Bathroom, Flooring, Painting, Windows, Carpentry, etc.).
5. Customer-supplied finish materials: DO NOT charge purchase price for the finish product itself. DO include:
   - installation labor
   - delivery/handling if contractor responsibility
   - rough and connection materials
   - waterproofing/backer board/thinset/grout/sealant as applicable
   - plumbing fittings/connectors
   - wiring/boxes/fasteners as applicable
   - floor prep/adhesive/consumables
   - protection and disposal
6. Bathroom renovation generally requires separate consideration of:
   - protection
   - demolition/removal
   - debris handling/disposal
   - plumbing disconnect/rough/connection work where applicable
   - shower base/pan and drain preparation
   - waterproofing
   - wall/floor substrate prep
   - tile installation
   - grout/sealant
   - vanity/toilet/fixture installation
   - shower glass installation/fabrication if contractor supplied
   - electrical/light work if requested
   - paint/finish work if requested
   - cleanup
7. Flooring generally requires existing-floor removal if requested, debris disposal, subfloor evaluation/preparation, installation, cuts/fitting/transitions and cleanup. Do not add underlayment when customer explicitly says none.
8. Painting must account for measured/estimated paintable area, prep, patching, protection, coats and included trim/doors/ceilings. Honor excluded rooms.
9. Window replacement must include removal, disposal, opening prep, installation, insulation/sealant/flashing/weatherproofing and finish work appropriate to the request.
10. Walk-up/access conditions require realistic carrying, debris movement and loading labor when documented.
11. Multi-trade projects require project coordination/supervision when warranted.
12. Do not use a "smallest reasonable interpretation" rule. Detailed customer information should produce a detailed estimate.
13. Do not inflate by adding arbitrary contingency inside labor quantities. Use reasonable NYC production rates and the provided markup field.
14. Do not double-mark up individual line rates. Return base contractor cost/rate and markupPct separately.
15. If required information is unknown but analysis permits a preliminary estimate, state the assumption instead of silently choosing the cheapest interpretation.
16. Preserve customer-requested alternate options OUTSIDE the base estimate. Option prices must include complete incremental labor/material effect for that option.
17. Do not put customer-supplied finish purchases in materials. Record them under customerSupplied.
18. Do not omit low-visibility but real work such as setup, protection, hauling, cleanup or sealants.

NYC-METRO LABOR GUIDANCE (use professional judgment, not blindly):
- General labor / demolition / helper: often $60-$90/hr contractor cost basis
- Painter / finisher: often $65-$90/hr
- Skilled carpenter / tile installer / flooring installer: often $90-$135/hr
- Plumber / electrician / specialist: often $120-$175/hr
- Project coordination / supervisor: often $95-$150/hr
These are guidelines only; complexity, access and skill level matter.

OUTPUT JSON ONLY:
{
  "projectTitle": "",
  "summary": "2-4 customer-friendly sentences",
  "estimateStatus": "READY | PRELIMINARY | NEEDS_CLARIFICATION | SITE_VISIT_REQUIRED",
  "labor": [
    { "section": "Bathroom", "item": "Bathroom demolition and debris loading", "qty": 24, "unit": "hrs", "rate": 75 }
  ],
  "materials": [
    { "section": "Bathroom", "item": "Waterproofing membrane and accessories", "qty": 1, "unit": "allowance", "rate": 650 }
  ],
  "customerSupplied": [
    { "section": "Bathroom", "item": "Vanity", "note": "Purchase price excluded; installation and required connections included" }
  ],
  "exclusions": [],
  "options": [
    { "section": "Windows", "label": "Option A — Replace all windows", "description": "", "price": 0 }
  ],
  "timelineText": "",
  "markupPct": 25,
  "assumptions": [],
  "internalScopeChecklist": [
    { "trade": "Bathroom", "covered": true, "notes": "" }
  ],
  "notes": "Internal estimator notes only"
}`;
}

function buildRepairPrompt(input, analysis, estimate, validation) {
  return `You are performing a mandatory estimate QA repair for Sani Building Corp.

STRICT WORDING RULE: Never use the word "licensed" or make a licensing claim.

The previous estimate failed deterministic validation. Repair omissions; do not simply raise prices arbitrarily.

CUSTOMER INPUT:
${JSON.stringify(input, null, 2)}

PROJECT UNDERSTANDING:
${JSON.stringify(analysis, null, 2)}

FAILED DRAFT:
${JSON.stringify(estimate, null, 2)}

VALIDATION RESULTS:
${JSON.stringify(validation, null, 2)}

REPAIR RULES:
- Correct every failure specifically.
- Ensure every selected trade has labor and appropriate rough/installation materials.
- Preserve all customer exclusions and customer-supplied finish materials.
- Customer-supplied finish materials still need installation labor and supporting materials.
- Add missing protection, demolition, disposal, handling, preparation, cleanup and coordination only where the documented scope requires them.
- Recalculate quantities/durations using realistic crew/production logic.
- Preserve alternate options outside the base total.
- Do not solve a low-total warning by adding a fake lump sum or arbitrary "contingency" line.
- Return the COMPLETE replacement estimate, not a patch.

Use exactly the same JSON schema as the original estimate request and return JSON only.`;
}

function normalizeProjectAnalysis(raw, input) {
  const selectedTrades = unique([
    ...toStringArray(raw.selected_trades),
    ...input.request.selectedServices,
  ].map(titleCase).filter(Boolean));

  const missing = Array.isArray(raw.missing_information) ? raw.missing_information : [];
  const questions = (Array.isArray(raw.clarification_questions) ? raw.clarification_questions : [])
    .filter((q) => q && cleanText(q.question))
    .filter((q) => cleanText(q.pricing_importance).toLowerCase() !== "low")
    .slice(0, 5);

  const readiness = raw.pricing_readiness || {};
  const allowedStatus = [
    "READY_TO_ESTIMATE",
    "PRELIMINARY_ESTIMATE_WITH_ASSUMPTIONS",
    "NEEDS_CUSTOMER_QUESTIONS",
    "SITE_VISIT_REQUIRED",
  ];

  return {
    project_summary: cleanText(raw.project_summary || input.request.description || input.request.service),
    project_type: cleanText(raw.project_type || "mixed"),
    selected_trades: selectedTrades.length ? selectedTrades : [titleCase(input.request.service || "General")],
    confirmed_scope: Array.isArray(raw.confirmed_scope) ? raw.confirmed_scope : [],
    inferred_scope: Array.isArray(raw.inferred_scope) ? raw.inferred_scope : [],
    customer_supplied_finish_materials: unique([
      ...(Array.isArray(raw.customer_supplied_finish_materials) ? raw.customer_supplied_finish_materials : []),
      ...input.request.customerSupplies,
    ].map(cleanText).filter(Boolean)),
    contractor_supplied_finish_materials: Array.isArray(raw.contractor_supplied_finish_materials)
      ? raw.contractor_supplied_finish_materials
      : [],
    contractor_supplied_rough_materials: Array.isArray(raw.contractor_supplied_rough_materials)
      ? raw.contractor_supplied_rough_materials
      : [],
    site_conditions: raw.site_conditions && typeof raw.site_conditions === "object" ? raw.site_conditions : {},
    quantities: raw.quantities && typeof raw.quantities === "object" ? raw.quantities : {},
    assumptions: toStringArray(raw.assumptions),
    exclusions: toStringArray(raw.exclusions),
    conflicts: Array.isArray(raw.conflicts) ? raw.conflicts : [],
    missing_information: missing,
    clarification_questions: questions.slice(0, 5),
    pricing_readiness: {
      status: allowedStatus.includes(readiness.status)
        ? readiness.status
        : questions.length
          ? "PRELIMINARY_ESTIMATE_WITH_ASSUMPTIONS"
          : "READY_TO_ESTIMATE",
      confidence_score: clamp(Number(readiness.confidence_score) || 70, 0, 100),
      reason: cleanText(readiness.reason),
    },
  };
}

function normalizeEstimate(raw, input, analysis) {
  const cleanLines = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((line) => ({
        item: cleanText(line.item),
        qty: positiveNumber(line.qty),
        unit: cleanText(line.unit || "ea"),
        rate: positiveNumber(line.rate),
        section: titleCase(line.section || "General") || "General",
      }))
      .filter((line) => line.item && line.qty > 0);

  const supplied = (Array.isArray(raw.customerSupplied) ? raw.customerSupplied : [])
    .map((item) =>
      typeof item === "string"
        ? { item: cleanText(item), section: "General", note: "Installation labor and required rough materials remain included" }
        : {
            item: cleanText(item.item),
            section: titleCase(item.section || "General"),
            note: cleanText(item.note || "Installation labor and required rough materials remain included"),
          }
    )
    .filter((item) => item.item);

  // Ensure every authoritative customer-supplied item is acknowledged.
  analysis.customer_supplied_finish_materials.forEach((item) => {
    if (!supplied.some((s) => normalizedIncludes(s.item, item))) {
      supplied.push({
        item,
        section: inferTradeForItem(item, analysis.selected_trades),
        note: "Installation labor and required rough materials remain included",
      });
    }
  });

  return {
    projectTitle: cleanText(raw.projectTitle || `${input.request.service} - ${input.customer.name}`),
    summary: cleanText(raw.summary),
    scopeOfWork: cleanText(raw.scopeOfWork),
    estimateStatus: ["READY", "PRELIMINARY", "NEEDS_CLARIFICATION", "SITE_VISIT_REQUIRED"].includes(raw.estimateStatus)
      ? raw.estimateStatus
      : mapReadinessToEstimateStatus(analysis.pricing_readiness.status),
    labor: cleanLines(raw.labor),
    materials: cleanLines(raw.materials),
    customerSupplied: supplied,
    exclusions: unique([...toStringArray(raw.exclusions), ...analysis.exclusions]).slice(0, 20),
    options: (Array.isArray(raw.options) ? raw.options : [])
      .map((o) => ({
        label: cleanText(o.label),
        description: cleanText(o.description),
        price: positiveNumber(o.price),
        section: titleCase(o.section || "General"),
      }))
      .filter((o) => o.label),
    timelineText: cleanText(raw.timelineText),
    markupPct: clamp(Number(raw.markupPct) || DEFAULT_MARKUP, 0, 100),
    assumptions: unique([...toStringArray(raw.assumptions), ...analysis.assumptions]),
    internalScopeChecklist: Array.isArray(raw.internalScopeChecklist) ? raw.internalScopeChecklist : [],
    notes: cleanText(raw.notes),
  };
}

function validateEstimate(estimate, analysis, input) {
  const failures = [];
  const warnings = [];
  const laborText = estimate.labor.map((l) => `${l.section} ${l.item}`).join(" ").toLowerCase();
  const materialText = estimate.materials.map((m) => `${m.section} ${m.item}`).join(" ").toLowerCase();
  const allText = `${laborText} ${materialText}`;

  // Trade coverage.
  analysis.selected_trades.forEach((trade) => {
    if (isGeneralTrade(trade)) return;
    const token = trade.toLowerCase();
    const hasLabor = estimate.labor.some((l) => l.section.toLowerCase().includes(token) || token.includes(l.section.toLowerCase()));
    if (!hasLabor) failures.push(`Selected trade "${trade}" has no labor line.`);
  });

  // Customer-supplied items still need installation labor.
  analysis.customer_supplied_finish_materials.forEach((item) => {
    const keywords = importantWords(item);
    const hasInstallLabor = estimate.labor.some((l) => {
      const t = l.item.toLowerCase();
      return keywords.some((k) => t.includes(k)) && /(install|set|mount|connect|hang|fit|place)/i.test(l.item);
    });
    if (!hasInstallLabor) failures.push(`Customer-supplied item "${item}" has no matching installation labor.`);
  });

  const renovationLike = /(renovation|remodel|replace|installation|bathroom|kitchen)/i.test(
    `${analysis.project_type} ${analysis.project_summary} ${input.request.service}`
  );
  if (renovationLike && !/(protect|protection|cover|containment)/i.test(allText)) {
    failures.push("No site/floor protection labor or material is included.");
  }
  if (renovationLike && !/(clean|cleanup|final clean)/i.test(laborText)) {
    failures.push("No cleanup labor is included.");
  }

  const removalRequested = /(demo|demolition|remove|disposal|replace existing|tear out)/i.test(
    `${analysis.project_summary} ${JSON.stringify(analysis.confirmed_scope)} ${input.request.description}`
  );
  if (removalRequested && !/(demo|demolition|remove|tear out)/i.test(laborText)) {
    failures.push("Removal/demolition was requested but no removal labor is included.");
  }
  if (removalRequested && !/(disposal|debris|haul|dump)/i.test(allText)) {
    failures.push("Removal was requested but debris handling/disposal is missing.");
  }

  const multiTrade = analysis.selected_trades.filter((t) => !isGeneralTrade(t)).length >= 3;
  if (multiTrade && !/(supervision|coordination|project management|project setup)/i.test(laborText)) {
    failures.push("Multi-trade project has no supervision or project coordination line.");
  }

  const walkUp = /yes|true|walk.?up/i.test(String(analysis.site_conditions.walk_up || "")) ||
    /walk.?up|third floor|3rd floor|fourth floor|4th floor/i.test(input.request.description);
  if (walkUp && !/(walk.?up|carry|handling|stairs|material handling|debris handling)/i.test(allText)) {
    failures.push("Walk-up/access condition is present but handling labor is missing.");
  }

  // Verify rough materials remain when finish materials are supplied.
  if (analysis.customer_supplied_finish_materials.length && estimate.materials.length === 0) {
    failures.push("All materials were removed even though rough/installation materials are still required.");
  }

  // Basic arithmetic / realism checks.
  const subtotal = calculateSubtotal(estimate);
  const grandTotal = subtotal * (1 + estimate.markupPct / 100);
  const laborHoursEquivalent = estimate.labor.reduce((sum, l) => {
    if (l.unit === "days") return sum + l.qty * 8;
    if (l.unit === "crew-days") return sum + l.qty * 8;
    if (l.unit === "hrs") return sum + l.qty;
    return sum;
  }, 0);

  if (!estimate.labor.length) failures.push("Estimate contains no labor lines.");
  if (subtotal <= 0) failures.push("Estimate subtotal is zero.");

  // A low-total check based on scope signals, not a hard universal price floor.
  const scopeWeight = estimateScopeWeight(analysis, input);
  if (scopeWeight >= 8 && grandTotal < 20000) {
    failures.push(`Total $${Math.round(grandTotal).toLocaleString()} is suspiciously low for the documented multi-trade scope.`);
  } else if (scopeWeight >= 5 && grandTotal < 10000) {
    failures.push(`Total $${Math.round(grandTotal).toLocaleString()} is suspiciously low for the documented renovation scope.`);
  }

  if (multiTrade && estimate.labor.length < 10) {
    failures.push("Multi-trade renovation is compressed into too few labor lines.");
  }
  if (scopeWeight >= 8 && laborHoursEquivalent > 0 && laborHoursEquivalent < 160) {
    warnings.push("Recorded labor duration appears low for a major multi-trade renovation.");
  }

  analysis.selected_trades.forEach((trade) => {
    const tradeLabor = estimate.labor.filter((l) => sameTrade(l.section, trade));
    const tradeMaterials = estimate.materials.filter((m) => sameTrade(m.section, trade));
    if (tradeLabor.length && !tradeMaterials.length && !tradeCanBeLaborOnly(trade)) {
      warnings.push(`${trade} has labor but no contractor-supplied rough/installation materials.`);
    }
  });

  return {
    passed: failures.length === 0,
    failures,
    warnings,
    scopeWeight,
    calculatedSubtotal: roundCurrency(subtotal),
    calculatedGrandTotal: roundCurrency(grandTotal),
    checkedAt: new Date().toISOString(),
  };
}

function estimateScopeWeight(analysis, input) {
  let score = analysis.selected_trades.filter((t) => !isGeneralTrade(t)).length * 2;
  const text = `${analysis.project_summary} ${input.request.description}`.toLowerCase();
  if (/full renovation|complete renovation|gut renovation/.test(text)) score += 3;
  if (/bathroom/.test(text)) score += 2;
  if (/window/.test(text)) score += 1;
  if (/painting/.test(text)) score += 1;
  if (/flooring|hardwood/.test(text)) score += 1;
  if (/walk.?up|third floor|3rd floor/.test(text)) score += 1;
  if (/\b([6-9]\d\d|[1-9]\d{3,})\s*(sf|sq\.?\s*ft|square feet)/.test(text)) score += 2;
  if (/plumb|electric|waterproof|glass enclosure/.test(text)) score += 2;
  return score;
}

function calculateSubtotal(estimate) {
  const lineTotal = (line) => positiveNumber(line.qty) * positiveNumber(line.rate);
  const labor = estimate.labor.reduce((sum, line) => sum + lineTotal(line), 0);
  const materials = estimate.materials.reduce((sum, line) => sum + lineTotal(line), 0);
  return labor + materials;
}


function finalizeCustomerPresentation(estimate, analysis, input) {
  const sections = buildScopeSections(estimate, analysis);
  const scopeText = sections
    .map((section) => `${section.title.toUpperCase()}:\n${section.items.map((item) => `• ${item}`).join("\n")}`)
    .join("\n\n");

  const tradeNames = sections.map((s) => s.title).filter(Boolean);
  const address = cleanText(input.customer.address);
  const location = address ? ` at ${address}` : "";
  const statusText = estimate.estimateStatus === "PRELIMINARY"
    ? "This is a preliminary estimate based on the information provided and listed assumptions."
    : estimate.estimateStatus === "SITE_VISIT_REQUIRED"
      ? "A site visit is required before final pricing can be confirmed."
      : "The estimate is based on the confirmed scope and quantities provided.";

  const conciseSummary = `${tradeNames.length ? tradeNames.join(", ") : "Renovation"} work${location}. ${statusText}`;

  const serviceBreakdown = buildServiceBreakdown(estimate, analysis, sections);

  return {
    ...estimate,
    summary: cleanText(estimate.summary).length > 420 ? conciseSummary : (cleanText(estimate.summary) || conciseSummary),
    scopeSections: sections,
    serviceBreakdown,
    scopeOfWork: scopeText,

    // Customer-view defaults: show the complete project price and separate
    // service subtotals, while keeping internal labor/material economics hidden.
    // The dashboard can still turn any of these on for a specific customer.
    showLaborCost: false,
    showMaterialsCost: false,
    showSectionSubtotals: true,
    showLaborLines: false,
    showMaterialLines: false,
    customerViewMode: "service_summary",
    customerPresentationVersion: "v7-service-proposal",
  };
}

function buildServiceBreakdown(estimate, analysis, sections) {
  const markupMultiplier = 1 + (positiveNumber(estimate.markupPct) / 100);
  const knownTitles = sections.map((s) => titleCase(s.title || "General"));

  const serviceMap = new Map();
  const order = [];
  const ensure = (name) => {
    const title = titleCase(name || "General") || "General";
    if (!serviceMap.has(title)) {
      serviceMap.set(title, {
        title,
        included: [],
        customerSupplies: [],
        notIncluded: [],
        subtotal: 0,
        options: [],
      });
      order.push(title);
    }
    return serviceMap.get(title);
  };

  sections.forEach((section) => {
    ensure(section.title).included.push(...(section.items || []));
  });

  const addLine = (line) => {
    const section = titleCase(line.section || inferTradeForItem(line.item, knownTitles) || "General") || "General";
    ensure(section).subtotal += positiveNumber(line.qty) * positiveNumber(line.rate) * markupMultiplier;
  };
  (estimate.labor || []).forEach(addLine);
  (estimate.materials || []).forEach(addLine);

  (estimate.customerSupplied || []).forEach((entry) => {
    const item = typeof entry === "string" ? entry : entry.item;
    if (!cleanText(item)) return;
    const section = typeof entry === "object" && entry.section
      ? entry.section
      : inferTradeForItem(item, knownTitles);
    ensure(section || "General").customerSupplies.push(cleanText(item));
  });

  const assignExclusion = (text) => {
    const item = cleanText(text);
    if (!item) return;
    const section = inferProposalSection(item, knownTitles);
    ensure(section || "General").notIncluded.push(item);
  };
  (estimate.exclusions || []).forEach(assignExclusion);
  (analysis.confirmed_scope || []).forEach((block) => {
    (block.customer_exclusions || []).forEach((item) => {
      const target = block.trade || inferTradeForItem(item, knownTitles);
      ensure(target || "General").notIncluded.push(cleanText(item));
    });
  });

  (estimate.options || []).forEach((option) => {
    const section = option.section || inferProposalSection(`${option.label} ${option.description || ""}`, knownTitles);
    ensure(section || "General").options.push(option);
  });

  return order.map((name) => {
    const service = serviceMap.get(name);
    return {
      ...service,
      included: unique(service.included.map(cleanText).filter(Boolean)),
      customerSupplies: unique(service.customerSupplies.map(cleanText).filter(Boolean)),
      notIncluded: unique(service.notIncluded.map(cleanText).filter(Boolean)),
      subtotal: roundCurrency(service.subtotal),
    };
  }).filter((service) =>
    service.included.length ||
    service.customerSupplies.length ||
    service.notIncluded.length ||
    service.subtotal > 0 ||
    service.options.length
  );
}


function inferProposalSection(item, trades) {
  const text = String(item || "").toLowerCase();
  const mappings = [
    ["window", "Windows"],
    ["paint", "Painting"], ["primer", "Painting"], ["ceiling", "Painting"],
    ["hardwood", "Flooring"], ["flooring", "Flooring"], ["subfloor", "Flooring"], ["baseboard", "Flooring"],
    ["bath", "Bathroom"], ["tile", "Bathroom"], ["vanity", "Bathroom"], ["toilet", "Bathroom"],
    ["faucet", "Bathroom"], ["shower", "Bathroom"], ["mirror", "Bathroom"], ["plumb", "Bathroom"],
    ["waterproof", "Bathroom"], ["glass enclosure", "Bathroom"],
    ["cabinet", "Kitchen"], ["countertop", "Kitchen"],
  ];
  for (const [token, trade] of mappings) {
    if (text.includes(token)) return trades.find((t) => sameTrade(t, trade)) || trade;
  }
  return "General";
}

function buildScopeSections(estimate, analysis) {
  const sectionOrder = [];
  const grouped = new Map();

  const ensure = (name) => {
    const title = titleCase(name || "General") || "General";
    if (!grouped.has(title)) {
      grouped.set(title, []);
      sectionOrder.push(title);
    }
    return grouped.get(title);
  };

  // Labor descriptions are the most useful customer-facing scope source.
  estimate.labor.forEach((line) => {
    const item = customerFriendlyScopeItem(line.item);
    if (item) ensure(line.section).push(item);
  });

  // Add confirmed scope facts only when not already represented.
  (analysis.confirmed_scope || []).forEach((block) => {
    const section = titleCase(block.trade || "General") || "General";
    (block.scope_items || []).forEach((raw) => {
      const item = customerFriendlyScopeItem(raw);
      if (item) ensure(section).push(item);
    });
  });

  // Add material-system details that matter to the customer, but never prices/quantities here.
  estimate.materials.forEach((line) => {
    if (!/(waterproof|membrane|backer|thinset|grout|primer|paint|sealant|insulation|flashing|underlayment|leveling|fastener|protection)/i.test(line.item)) return;
    const item = `Provide and use ${sentenceCase(line.item)}`;
    ensure(line.section).push(item);
  });

  return sectionOrder.map((title) => {
    const items = unique(grouped.get(title).map(normalizeScopeSentence))
      .filter(Boolean)
      .filter((item, index, arr) => arr.findIndex((other) => scopeSentencesEquivalent(item, other)) === index)
      .slice(0, 12);
    return { title, items };
  }).filter((section) => section.items.length);
}

function customerFriendlyScopeItem(value) {
  let text = cleanText(value)
    .replace(/^labor\s*[-:]\s*/i, "")
    .replace(/\s*\([^)]*hours?[^)]*\)\s*/ig, " ")
    .replace(/\s*@\s*\$?[\d,.]+.*$/i, "")
    .replace(/\bqty\.?\s*\d+(?:\.\d+)?\b/ig, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!text) return "";
  if (/^(project management|supervision|coordination)$/i.test(text)) return "Coordinate trades, scheduling, deliveries, and quality control";
  if (/^(cleanup|final cleanup)$/i.test(text)) return "Complete final cleanup and remove construction debris";
  return normalizeScopeSentence(text);
}

function normalizeScopeSentence(value) {
  let text = cleanText(value).replace(/[.;,:\-–—]+$/g, "").trim();
  if (!text) return "";
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return text;
}

function sentenceCase(value) {
  const text = cleanText(value).replace(/[.;,:]+$/g, "");
  if (!text) return "";
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function scopeSentencesEquivalent(a, b) {
  const normalize = (v) => importantWords(v).sort().join(" ");
  const aa = normalize(a);
  const bb = normalize(b);
  return aa === bb || (aa.length > 12 && bb.length > 12 && (aa.includes(bb) || bb.includes(aa)));
}

function callOpenAI(apiKey, prompt) {
  const payload = JSON.stringify({
    model: OPENAI_ANALYSIS_MODEL,
    store: false,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: "Return one valid JSON object only. Do not use markdown or commentary." }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      },
    ],
    text: { format: { type: "json_object" }, verbosity: "low" },
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.openai.com",
        port: 443,
        path: "/v1/responses",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Authorization: `Bearer ${apiKey}`,
        },
        // Background functions get 15 minutes. These limits were sized for a
        // synchronous 10s function and were killing long estimates at ~110s.
        timeout: 240000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const json = JSON.parse(body);
              const text = extractOpenAIText(json);
              if (!text) return reject(new Error(`OpenAI returned no text: ${body.slice(0, 400)}`));
              resolve(text);
            } catch (error) {
              reject(new Error(`Bad OpenAI response: ${body.slice(0, 400)}`));
            }
          } else {
            reject(new Error(`OpenAI ${res.statusCode}: ${body.slice(0, 500)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function extractOpenAIText(json) {
  if (typeof json.output_text === "string" && json.output_text.trim()) return json.output_text;
  const chunks = [];
  (json.output || []).forEach((item) => {
    (item.content || []).forEach((part) => {
      if (typeof part.text === "string") chunks.push(part.text);
    });
  });
  return chunks.join("\n");
}

function callClaude(apiKey, prompt, maxTokens) {
  const payload = JSON.stringify({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    temperature: 0.1,
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
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const json = JSON.parse(body);
              const text = (json.content || []).map((part) => part.text || "").join("");
              resolve(text);
            } catch (error) {
              reject(new Error(`Bad Claude response: ${body.slice(0, 300)}`));
            }
          } else {
            reject(new Error(`Claude ${res.statusCode}: ${body.slice(0, 500)}`));
          }
        });
      }
    );
    req.setTimeout(240000, () => req.destroy(new Error("Claude request timed out after 4 minutes")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function parseAiJson(text, label) {
  const cleaned = String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try { return JSON.parse(cleaned.slice(first, last + 1)); } catch (_) {}
    }
    console.error(`AI ${label} raw response:`, cleaned.slice(0, 2500));
    throw new Error(`AI returned invalid JSON for ${label}`);
  }
}

function safeJsonParse(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
}

function mapReadinessToEstimateStatus(status) {
  if (status === "SITE_VISIT_REQUIRED") return "SITE_VISIT_REQUIRED";
  if (status === "NEEDS_CUSTOMER_QUESTIONS") return "NEEDS_CLARIFICATION";
  if (status === "PRELIMINARY_ESTIMATE_WITH_ASSUMPTIONS") return "PRELIMINARY";
  return "READY";
}

function inferTradeForItem(item, trades) {
  const text = String(item).toLowerCase();
  const mappings = [
    ["tile", "Bathroom"], ["vanity", "Bathroom"], ["toilet", "Bathroom"],
    ["faucet", "Bathroom"], ["shower", "Bathroom"], ["mirror", "Bathroom"],
    ["floor", "Flooring"], ["hardwood", "Flooring"], ["baseboard", "Flooring"],
    ["paint", "Painting"], ["window", "Windows"], ["cabinet", "Kitchen"],
  ];
  for (const [token, trade] of mappings) {
    if (text.includes(token)) return trades.find((t) => sameTrade(t, trade)) || trade;
  }
  return trades[0] || "General";
}

function importantWords(text) {
  const stop = new Set(["and", "the", "with", "material", "materials", "floor", "wall"]);
  return String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !stop.has(w));
}

function sameTrade(a, b) {
  const x = String(a || "").toLowerCase();
  const y = String(b || "").toLowerCase();
  return x === y || x.includes(y) || y.includes(x);
}

function tradeCanBeLaborOnly(trade) {
  return /handyman|consult|inspection|general/i.test(trade);
}

function isGeneralTrade(trade) {
  return /general|other|not listed|mixed/i.test(String(trade));
}

function normalizedIncludes(a, b) {
  const x = String(a || "").toLowerCase();
  const y = String(b || "").toLowerCase();
  return x.includes(y) || y.includes(x);
}

function cleanText(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function titleCase(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function toStringArray(value) {
  return (Array.isArray(value) ? value : []).map((v) => cleanText(v)).filter(Boolean);
}

function unique(values) {
  const seen = new Set();
  return values.filter((v) => {
    const key = String(v).toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function jsonResponse(statusCode, body) {
  return { statusCode, headers: cors(), body: JSON.stringify(body) };
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
