// netlify/functions/generate-estimate-background.js
// Same estimator as generate-estimate.js, run as a Netlify BACKGROUND function so it
// is not killed at 10 seconds. Writes aiStatus onto the record for the dashboard poller.
// Smart Renovation Estimator v6 — Aug 6, 2026
//
// Pipeline:
// 1) Read and structure the full customer request.
// 2) Detect missing/contradictory information and pricing readiness.
// 3) Generate a complete trade-by-trade estimate from the structured scope.
// 4) Validate trade coverage, installation labor and rough materials. NOT price -
//    a small job is meant to produce a small number (see validateEstimate).
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

    const storage = await loadEstimateRecord(ref, event, body);
    const store = storage.store;
    const record = storage.record;
    if (!record) return jsonResponse(404, { error: "Estimate not found", stage: "load_estimate" });

    record.aiStatus = "running";
    record.aiJobId = String(body.jobId || "").trim();
    record.aiError = "";
    record.aiStartedAt = new Date().toISOString();
    if (store) { try { await store.setJSON(ref, record); } catch (_) {} }

    const input = buildEstimatorInput(record, body);
    const timing = { startedAt: Date.now(), analysisMs: 0, estimateMs: 0, repairMs: 0, deterministicMs: 0, repairUsed: false };

    const analysisStarted = Date.now();
    const analysisPrompt = buildProjectAnalysisPrompt(input);
    const rawAnalysis = openaiKey
      ? await callOpenAI(openaiKey, analysisPrompt)
      : await callClaude(anthropicKey, analysisPrompt, 6000);
    const projectAnalysis = normalizeProjectAnalysis(parseAiJson(rawAnalysis, "project analysis"), input);
    timing.analysisMs = Date.now() - analysisStarted;

    const estimateStarted = Date.now();
    const estimatePrompt = buildEstimatePrompt(input, projectAnalysis);
    const rawEstimate = anthropicKey
      ? await callClaude(anthropicKey, estimatePrompt, 8000)
      : await callOpenAI(openaiKey, estimatePrompt);
    let estimate = normalizeEstimate(parseAiJson(rawEstimate, "estimate"), input, projectAnalysis);
    timing.estimateMs = Date.now() - estimateStarted;

    let deterministicStarted = Date.now();
    estimate = applyDeterministicPricing(estimate, projectAnalysis, input);
    timing.deterministicMs += Date.now() - deterministicStarted;
    let validation = validateEstimate(estimate, projectAnalysis, input);

    if (!validation.passed) {
      /* THE REPAIR PASS IS AN IMPROVEMENT, NEVER A REQUIREMENT.
         By the time we get here a complete, deterministically priced estimate already
         exists. Letting anything in this block reach the outer catch throws that away
         and hands the contractor a red error after ~160 seconds of waiting - for a job
         the system had already priced correctly.
         validateEstimate still fails an estimate that is genuinely incomplete - a trade
         with no labor, a customer-supplied item with no installation labor, missing
         protection, cleanup, demolition or debris handling - so this block still runs
         often. An unguarded failure here is the difference between a usable estimate
         and none at all.
         Keep the pre-repair estimate. Record what went wrong so it is visible in the
         dashboard rather than silent. */
      timing.repairUsed = true;
      const repairStarted = Date.now();
      const preRepairEstimate = estimate;
      const preRepairValidation = validation;
      try {
        const repairPrompt = buildRepairPrompt(input, projectAnalysis, estimate, validation);
        const rawRepair = anthropicKey
          ? await callClaude(anthropicKey, repairPrompt, 8000)
          : await callOpenAI(openaiKey, repairPrompt);
        let repaired = normalizeEstimate(parseAiJson(rawRepair, "repaired estimate"), input, projectAnalysis);
        deterministicStarted = Date.now();
        repaired = applyDeterministicPricing(repaired, projectAnalysis, input);
        timing.deterministicMs += Date.now() - deterministicStarted;
        const repairedValidation = validateEstimate(repaired, projectAnalysis, input);
        /* Only accept the repair if it produced something usable. A repair that comes
           back empty of priced work is worse than the draft it replaced. */
        if (repaired && (repaired.labor || []).length) {
          estimate = repaired;
          validation = repairedValidation;
        } else {
          timing.repairSkipped = "repair returned no labor lines";
        }
      } catch (repairError) {
        console.error("repair pass failed, keeping pre-repair estimate:",
          repairError && repairError.stack ? repairError.stack : repairError);
        estimate = preRepairEstimate;
        validation = preRepairValidation;
        timing.repairSkipped = String((repairError && repairError.message) || repairError).slice(0, 200);
      }
      timing.repairMs = Date.now() - repairStarted;
    }

    estimate = finalizeCustomerPresentation(estimate, projectAnalysis, input);
    estimate = consolidateCustomerPresentation(estimate, projectAnalysis, input);
    timing.totalMs = Date.now() - timing.startedAt;
    estimate.generationTiming = { ...timing };
    estimate.validation = validation;
    estimate.pricingReadiness = projectAnalysis.pricing_readiness;
    estimate.clarificationQuestions = projectAnalysis.clarification_questions;

    record.projectAnalysis = projectAnalysis;
    record.estimate = estimate;
    record.status = record.status === "new" ? "drafted" : record.status;
    record.updatedAt = new Date().toISOString();
    record.aiStatus = "done";
    record.aiJobId = String(body.jobId || record.aiJobId || "").trim();
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
    try {
      const failRef = String(safeJsonParse(event.body, {}).ref || "").trim();
      if (failRef) {
        const s2 = await loadEstimateRecord(failRef, event, safeJsonParse(event.body, {}));
        if (s2 && s2.store && s2.record) {
          s2.record.aiStatus = "error";
          s2.record.aiJobId = String(safeJsonParse(event.body, {}).jobId || s2.record.aiJobId || "").trim();
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
  try {
    const automaticStore = getStore("estimates");
    const automaticRecord = await automaticStore.get(ref, { type: "json" });
    if (automaticRecord) return { store: automaticStore, record: automaticRecord, source: "blobs_auto" };
  } catch (error) {
    blobError = error;
    console.error("Blob automatic-context read failed:", error && error.stack ? error.stack : error);
  }

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
    groupedAnswers[trade].push({ question: key.replace(/-/g, " "), answer: Array.isArray(value) ? value.join(", ") : String(value) });
  });
  const customerSupplies = Array.isArray(request.customerSupplies) ? request.customerSupplies.map(cleanText).filter(Boolean) : [];
  const photoAnalysis = Array.isArray(request.photoAnalysis) ? request.photoAnalysis : [];
  return {
    ref: cleanText(body.ref),
    customer: { name: cleanText(customer.name), phone: cleanText(customer.phone), email: cleanText(customer.email), address: cleanText(customer.address) },
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
    contractor: { extraRequest: cleanText(body.extraRequest), houseRules: cleanText(body.houseRules) },
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
  return `You are the Senior Project Intake Manager and Renovation Scope Analyst for Sani Building Corp, an experienced, fully insured NYC-metro renovation and repair contractor.\n\nYou DO NOT generate prices in this stage. Your job is to understand what the customer is trying to accomplish, even when the customer uses imperfect homeowner language, mixes technical terms, omits details, or appears to contradict themselves.\n\nSTRICT WORDING RULE: Never use the word "licensed" or make any licensing claim.\n\nFULL CUSTOMER INPUT:\n${JSON.stringify(input, null, 2)}\n\nCORE ANALYSIS RULES:\n1. Read every source together: selected services, description, answers, customer-supplied items, photos, address, and contractor corrections.\n2. Contractor notes are authoritative and override customer statements only where they directly conflict.\n3. Separate confirmed scope, reasonably implied scope, assumptions, exclusions, missing information and conflicts.\n4. Translate homeowner language into contractor-level scope without changing intent.\n5. Never silently invent major work. Normal enabling work may be listed as implied, with a reason.\n6. Distinguish keeping, repairing, refinishing, replacing in the same location, relocating, supplying and installing.\n7. "Fixtures remain in current locations" normally means no relocation; it does NOT mean the fixtures remain existing when replacement is requested elsewhere.\n8. Customer-supplied finish materials eliminate only the purchase price of those finish items. They do NOT eliminate installation labor, handling, rough materials, adhesives, fasteners, waterproofing, plumbing connections, electrical connections, protection, disposal or consumables.\n9. Every selected trade must be represented. Never let one dominant trade erase another selected trade.\n10. Extract all quantities: square feet, linear feet, dimensions, fixture counts, window counts, room counts and floor level.\n11. Identify site conditions: occupied/vacant, walk-up/elevator, floor, debris route, parking/loading, work hours, building rules and protection.\n12. Ask only questions that materially change scope, labor, materials, schedule, risk or price.\n13. Do not ask low-impact cosmetic questions merely to fill a form.\n14. Use one status:\n   READY_TO_ESTIMATE — major scope, quantities, supply responsibility and site conditions are sufficiently clear.\n   PRELIMINARY_ESTIMATE_WITH_ASSUMPTIONS — a useful estimate is possible but defined assumptions are required.\n   NEEDS_CUSTOMER_QUESTIONS — critical information is missing and would materially change the estimate.\n   SITE_VISIT_REQUIRED — online information cannot responsibly establish scope/price.\n15. Never choose the smallest possible interpretation just to lower price. Use the most reasonable professional interpretation supported by the full record.\n16. If the customer requested alternatives (for example replace all windows vs replace some and repair others), preserve EACH option separately.\n17. Identify customer exclusions EXACTLY, and record each one against the trade it belongs to in confirmed_scope[].customer_exclusions - NOT in the top-level exclusions array. "Kitchen is excluded from painting" belongs to Painting. "Bathroom is excluded from flooring" belongs to Flooring. "No underlayment", "no transition strips" and "no baseboards" are THREE separate exclusions on Flooring, not one. Every sentence in which the customer says something is not wanted, not included, or is excluded becomes one entry, phrased close to his own words. Never merge several into one, and never drop one because it seems obvious from the scope. He wrote these limits down; he must be able to read every one of them back against the service it applies to.\n17b. The top-level exclusions array is ONLY for project-wide risks the customer did not raise himself: permits, concealed conditions, asbestos or mold, structural work, work outside normal hours. A generic risk exclusion must never take the place of something the customer actually asked to leave out.\n18. Keep questions homeowner-friendly and include "Not sure" where appropriate.\n\nReturn JSON only with EXACT top-level structure:\n{\n  "project_summary": "",\n  "project_type": "repair | partial renovation | full renovation | installation | replacement | restoration | mixed",\n  "selected_trades": [],\n  "confirmed_scope": [\n    { "trade": "", "scope_items": [], "quantities": {}, "customer_exclusions": [] }\n  ],\n  "inferred_scope": [\n    { "trade": "", "item": "", "reason": "", "requires_confirmation": true }\n  ],\n  "customer_supplied_finish_materials": [],\n  "contractor_supplied_finish_materials": [],\n  "contractor_supplied_rough_materials": [],\n  "site_conditions": {\n    "occupied_status": "",\n    "floor_number": "",\n    "elevator_access": "",\n    "walk_up": "",\n    "work_hours": "",\n    "debris_access": "",\n    "parking_loading": "",\n    "building_requirements": "",\n    "protection_requirements": ""\n  },\n  "quantities": {},\n  "assumptions": [],\n  "exclusions": [],\n  "conflicts": [\n    { "issue": "", "likely_interpretation": "", "needs_confirmation": true }\n  ],\n  "missing_information": [\n    { "question": "", "reason_needed": "", "priority": "critical | pricing | site_condition | optional", "affected_trade": "" }\n  ],\n  "clarification_questions": [\n    {\n      "id": "",\n      "question": "",\n      "helper_text": "",\n      "type": "single_select | multi_select | number | short_text | photo_request",\n      "options": [],\n      "affected_trade": "",\n      "pricing_importance": "critical | high | medium"\n    }\n  ],\n  "pricing_readiness": {\n    "status": "READY_TO_ESTIMATE | PRELIMINARY_ESTIMATE_WITH_ASSUMPTIONS | NEEDS_CUSTOMER_QUESTIONS | SITE_VISIT_REQUIRED",\n    "confidence_score": 0,\n    "reason": ""\n  }\n}`;
}

/* The contractor's own pricing rules, rendered as an instruction rather than left
   buried inside the JSON input dump where the model treated them as background.
   These are HIS numbers - bands, unit prices, production rates, minimum charges -
   and they outrank the model's general market knowledge, which is what produced
   185 labor hours on a small bathroom. Empty string when he has not written any,
   so nothing changes for a contractor who never fills the panel in. */
function buildHouseRulesBlock(input) {
  const rules = cleanText(((input || {}).contractor || {}).houseRules);
  if (!rules) return "";
  return `\n\n========================================\nCONTRACTOR HOUSE RULES - THESE OVERRIDE YOUR GENERAL MARKET KNOWLEDGE\n========================================\n${rules}\n\nHOW TO APPLY THEM:\n- Where a rule gives a unit price ($/SF, $/LF, per fixture), USE IT. Do not derive your own from hours.\n- Where a rule gives a production rate (SF per hour, hours per task), USE IT to set quantities.\n- Where a rule gives a price BAND for a job type, the finished total must land inside that band. If the documented scope genuinely cannot fit, price it honestly and say why in estimateNotes.\n- Where a rule gives a MINIMUM charge, never price that scope below it.\n- A rule only applies to work it actually describes. For anything not covered, use your own judgement as normal.\n- These are the contractor's real numbers from his own completed jobs and market research. When they disagree with your instinct, the rule wins.\n========================================`;
}

function buildEstimatePrompt(input, analysis) {
  return `You are the Senior Construction Estimator for Sani Building Corp in the NYC metro area.${buildHouseRulesBlock(input)}\n\nYou receive a STRUCTURED project understanding prepared by another AI. Price the WHOLE documented project accurately and conservatively enough to protect the contractor while remaining market-realistic. Do not manufacture work that is unsupported.\n\nSTRICT WORDING RULE: Never use the word "licensed" or make any licensing claim.\n\nCUSTOMER / REQUEST INPUT:\n${JSON.stringify(input, null, 2)}\n\nSTRUCTURED PROJECT UNDERSTANDING:\n${JSON.stringify(analysis, null, 2)}\n\nESTIMATING METHOD:\n1. Build the estimate TRADE BY TRADE. Every selected trade must receive appropriate labor and necessary contractor-supplied rough/installation materials.\n2. For substantial renovations, use production/crew logic instead of compressing the job into a few generic hourly lines.\n3. Separate meaningful operations: protection/setup, demo/removal, disposal/handling, preparation, rough work, installation, finish work, cleanup, project coordination.\n4. Every labor and material line MUST contain "section" equal to ONE OF THE CUSTOMER'S SELECTED SERVICES. "General" is NOT a permitted section, and neither is any service he did not select. He asked for a price per service; anything parked in a shared bucket makes every one of those prices wrong - if he then asks "what if I only do the bathroom?", the Bathroom card is not the answer.\n4a. Protection, cleanup, debris handling and disposal belong to the service that creates them. If three services each need cleanup, emit three cleanup lines, one per service. Never emit one shared cleanup line.\n4b. Project coordination and supervision genuinely span services. Emit ONE coordination line PER SERVICE, each carrying that service's share of the effort, sized in proportion to how large that service is. Never emit a single combined coordination line.\n5. Customer-supplied finish materials: DO NOT charge purchase price for the finish product itself. DO include installation labor, handling if contractor responsibility, rough/connection materials, waterproofing/backer board/thinset/grout/sealant, plumbing fittings/connectors, wiring/boxes/fasteners as applicable, floor prep/adhesive/consumables, protection and disposal.\n6. Bathroom renovation generally requires protection, demolition/removal, debris handling/disposal, plumbing disconnect/rough/connection work where applicable, shower base/pan and drain preparation, waterproofing, substrate prep, tile installation, grout/sealant, fixture installation, shower glass, paint/finish work if requested, and cleanup.\n7. Flooring generally requires existing-floor removal if requested, debris disposal, subfloor evaluation/preparation, installation, cuts/fitting/transitions and cleanup. Do not add underlayment when customer explicitly says none.\n8. Painting must account for measured/estimated paintable area, prep, patching, protection, coats and included trim/doors/ceilings. Honor excluded rooms.\n9. Window replacement must include removal, disposal, opening prep, installation, insulation/sealant/flashing/weatherproofing and finish work appropriate to the request.\n10. Walk-up/access conditions require realistic carrying, debris movement and loading labor when documented.\n11. Multi-trade projects require project coordination/supervision when warranted.\n12. Do not use a "smallest reasonable interpretation" rule. Detailed customer information should produce a detailed estimate.\n13. Do not inflate by adding arbitrary contingency inside labor quantities. Use reasonable NYC production rates and the provided markup field.\n14. Do not double-mark up individual line rates. Return base contractor cost/rate and markupPct separately.\n15. If required information is unknown but analysis permits a preliminary estimate, state the assumption instead of silently choosing the cheapest interpretation.\n16. Preserve customer-requested alternate options OUTSIDE the base estimate. Option prices must include complete incremental labor/material effect for that option.\n17. Do not put customer-supplied finish purchases in materials. Record them under customerSupplied.\n18. Do not omit low-visibility but real work such as setup, protection, hauling, cleanup or sealants.\n19. The project understanding already records the customer's own exclusions per trade in confirmed_scope[].customer_exclusions, and those are shown to him against that service. Do NOT repeat them in your "exclusions" array. Use your exclusions array ONLY for project-wide risks he did not raise (permits, concealed conditions, asbestos/mold, structural, out-of-hours work). Returning generic boilerplate risks while his stated exclusions go missing is the worst failure this estimate can have: he asked for this breakdown precisely so he could see what each service does not include.\n\nNYC-METRO LABOR GUIDANCE (use professional judgment, not blindly):\n- General labor / demolition / helper: often $60-$90/hr contractor cost basis\n- Painter / finisher: often $65-$90/hr\n- Skilled carpenter / tile installer / flooring installer: often $90-$135/hr\n- Plumber / electrician / specialist: often $120-$175/hr\n- Project coordination / supervisor: often $95-$150/hr\nThese are guidelines only; complexity, access and skill level matter.\n\nOUTPUT JSON ONLY:\n{\n  "projectTitle": "",\n  "summary": "2-4 customer-friendly sentences",\n  "estimateStatus": "READY | PRELIMINARY | NEEDS_CLARIFICATION | SITE_VISIT_REQUIRED",\n  "labor": [\n    { "section": "Bathroom", "item": "Bathroom demolition and debris loading", "qty": 24, "unit": "hrs", "rate": 75 }\n  ],\n  "materials": [\n    { "section": "Bathroom", "item": "Waterproofing membrane and accessories", "qty": 1, "unit": "allowance", "rate": 650 }\n  ],\n  "customerSupplied": [\n    { "section": "Bathroom", "item": "Vanity", "note": "Purchase price excluded; installation and required connections included" }\n  ],\n  "exclusions": [],\n  "options": [\n    { "section": "Windows", "label": "Option A — Replace all windows", "description": "", "price": 0 }\n  ],\n  "timelineText": "",\n  "markupPct": 25,\n  "assumptions": [],\n  "internalScopeChecklist": [\n    { "trade": "Bathroom", "covered": true, "notes": "" }\n  ],\n  "notes": "Internal estimator notes only"\n}`;
}

function buildRepairPrompt(input, analysis, estimate, validation) {
  return `You are performing a mandatory estimate QA repair for Sani Building Corp.${buildHouseRulesBlock(input)}\n\nSTRICT WORDING RULE: Never use the word "licensed" or make any licensing claim.\n\nThe previous estimate failed deterministic validation. Repair omissions; do not simply raise prices arbitrarily.\n\nCUSTOMER INPUT:\n${JSON.stringify(input, null, 2)}\n\nPROJECT UNDERSTANDING:\n${JSON.stringify(analysis, null, 2)}\n\nFAILED DRAFT:\n${JSON.stringify(estimate, null, 2)}\n\nVALIDATION RESULTS:\n${JSON.stringify(validation, null, 2)}\n\nREPAIR RULES:\n- Correct every failure specifically.\n- Ensure every selected trade has labor and appropriate rough/installation materials.\n- Preserve all customer exclusions and customer-supplied finish materials.\n- Customer-supplied finish materials still need installation labor and supporting materials.\n- Add missing protection, demolition, disposal, handling, preparation, cleanup and coordination only where the documented scope requires them.\n- Recalculate quantities/durations using realistic crew/production logic.\n- Preserve alternate options outside the base total.\n- Never pad the estimate. Do not add a lump sum, a "contingency" line, or extra hours to make a total look bigger. A small job is meant to produce a small number.\n- Every line keeps a "section" equal to one of the customer's selected services. "General" is not a permitted section. Cleanup, protection and debris belong to the service that creates them; coordination is one line per service.\n- Do not move the customer's own exclusions into your exclusions array. They belong to their trade in confirmed_scope[].customer_exclusions and are already shown there.\n- Return the COMPLETE replacement estimate, not a patch.\n\nUse exactly the same JSON schema as the original estimate request and return JSON only.`;
}

function normalizeProjectAnalysis(raw, input) {
  const selectedTrades = unique([...toStringArray(raw.selected_trades), ...input.request.selectedServices].map(titleCase).filter(Boolean));
  const missing = Array.isArray(raw.missing_information) ? raw.missing_information : [];
  const questions = (Array.isArray(raw.clarification_questions) ? raw.clarification_questions : [])
    .filter((q) => q && cleanText(q.question))
    .filter((q) => cleanText(q.pricing_importance).toLowerCase() !== "low")
    .slice(0, 5);
  const readiness = raw.pricing_readiness || {};
  const allowedStatus = ["READY_TO_ESTIMATE", "PRELIMINARY_ESTIMATE_WITH_ASSUMPTIONS", "NEEDS_CUSTOMER_QUESTIONS", "SITE_VISIT_REQUIRED"];
  return {
    project_summary: cleanText(raw.project_summary || input.request.description || input.request.service),
    project_type: cleanText(raw.project_type || "mixed"),
    selected_trades: selectedTrades.length ? selectedTrades : [titleCase(input.request.service || "General")],
    confirmed_scope: Array.isArray(raw.confirmed_scope) ? raw.confirmed_scope : [],
    inferred_scope: Array.isArray(raw.inferred_scope) ? raw.inferred_scope : [],
    customer_supplied_finish_materials: unique([...(Array.isArray(raw.customer_supplied_finish_materials) ? raw.customer_supplied_finish_materials : []), ...input.request.customerSupplies].map(cleanText).filter(Boolean)),
    contractor_supplied_finish_materials: Array.isArray(raw.contractor_supplied_finish_materials) ? raw.contractor_supplied_finish_materials : [],
    contractor_supplied_rough_materials: Array.isArray(raw.contractor_supplied_rough_materials) ? raw.contractor_supplied_rough_materials : [],
    site_conditions: raw.site_conditions && typeof raw.site_conditions === "object" ? raw.site_conditions : {},
    quantities: raw.quantities && typeof raw.quantities === "object" ? raw.quantities : {},
    assumptions: toStringArray(raw.assumptions),
    exclusions: toStringArray(raw.exclusions),
    conflicts: Array.isArray(raw.conflicts) ? raw.conflicts : [],
    missing_information: missing,
    clarification_questions: questions.slice(0, 5),
    pricing_readiness: {
      status: allowedStatus.includes(readiness.status) ? readiness.status : questions.length ? "PRELIMINARY_ESTIMATE_WITH_ASSUMPTIONS" : "READY_TO_ESTIMATE",
      confidence_score: clamp(Number(readiness.confidence_score) || 70, 0, 100),
      reason: cleanText(readiness.reason),
    },
  };
}

function normalizeEstimate(raw, input, analysis) {
  const cleanLines = (arr) => (Array.isArray(arr) ? arr : []).map((line) => ({ item: cleanText(line.item), qty: positiveNumber(line.qty), unit: cleanText(line.unit || "ea"), rate: positiveNumber(line.rate), section: titleCase(line.section || "General") || "General" })).filter((line) => line.item && line.qty > 0);
  const supplied = (Array.isArray(raw.customerSupplied) ? raw.customerSupplied : []).map((item) => typeof item === "string" ? { item: cleanText(item), section: "General", note: "Installation labor and required rough materials remain included" } : { item: cleanText(item.item), section: titleCase(item.section || "General"), note: cleanText(item.note || "Installation labor and required rough materials remain included") }).filter((item) => item.item);
  analysis.customer_supplied_finish_materials.forEach((item) => {
    if (!supplied.some((s) => normalizedIncludes(s.item, item))) supplied.push({ item, section: inferTradeForItem(item, analysis.selected_trades), note: "Installation labor and required rough materials remain included" });
  });
  const normalized = {
    projectTitle: cleanText(raw.projectTitle || `${input.request.service} - ${input.customer.name}`),
    summary: cleanText(raw.summary),
    scopeOfWork: cleanText(raw.scopeOfWork),
    estimateStatus: ["READY", "PRELIMINARY", "NEEDS_CLARIFICATION", "SITE_VISIT_REQUIRED"].includes(raw.estimateStatus) ? raw.estimateStatus : mapReadinessToEstimateStatus(analysis.pricing_readiness.status),
    labor: cleanLines(raw.labor),
    materials: cleanLines(raw.materials),
    customerSupplied: supplied,
    exclusions: unique([...toStringArray(raw.exclusions), ...analysis.exclusions]).slice(0, 20),
    options: (Array.isArray(raw.options) ? raw.options : []).map((o) => ({ label: cleanText(o.label), description: cleanText(o.description), price: positiveNumber(o.price), section: titleCase(o.section || "General") })).filter((o) => o.label),
    timelineText: cleanText(raw.timelineText),
    markupPct: clamp(Number(raw.markupPct) || DEFAULT_MARKUP, 0, 100),
    assumptions: unique([...toStringArray(raw.assumptions), ...analysis.assumptions]),
    internalScopeChecklist: Array.isArray(raw.internalScopeChecklist) ? raw.internalScopeChecklist : [],
    notes: cleanText(raw.notes),
  };
  /* Runs on the main AND repair paths, because it lives inside normalizeEstimate
     rather than beside one call of it. */
  return attributeSharedLines(normalized, analysis);
}

/* ============================================================================
   NO "GENERAL" SERVICE CARD - CODE BACKSTOP.
   ----------------------------------------------------------------------------
   The customer picked four services and asked for four prices. A "General" card
   holding protection, cleanup and coordination means none of those four numbers is
   the real number for that service: asked "what if I only do the bathroom?", the
   answer is not the Bathroom card.

   The estimate prompt now forbids "General" as a section. LAW 3 APPLIES - prompt
   rules do not hold on their own. The question ban lists were written into a prompt,
   ignored, and only stuck once they were enforced in code. This is that enforcement.

   Two passes:
     1. KEYWORD. inferTradeForItem already knows tile->Bathroom, hardwood->Flooring.
        A stray line whose own text names its trade is simply relabelled. Shared work
        is skipped here on purpose: "bathroom protection" names a trade, but the
        protection still serves whichever services are running behind it.
     2. SPLIT. Work that genuinely spans services - project coordination above all -
        has no single correct home. Forcing 24 hours of coordination onto one card
        overcharges that service and undercharges the other three. It is divided
        across the real services in proportion to what each one costs, emitted as one
        line per service so the contractor can still see and edit his own numbers.

   Money is conserved exactly. Shares are rounded to the cent, the last share is the
   remainder rather than its own rounding, and the qty rounding residue is absorbed on
   the largest part - so the split lines sum to the value of the line they replaced.

   Safe to run before applyDeterministicPricing: removeOverlappingLabor only fires on
   specific bath-demo and tile-grout pairs, and capGeneralConditions works on the TOTAL
   cost of general/supervision work, which splitting does not change.
   ============================================================================ */
var SHARED_ACROSS_SERVICES = /(coordinat|supervis|project manage|protect|clean|debris|disposal|haul|dump|punch ?list|mobiliz)/i;

function attributeSharedLines(estimate, analysis) {
  var services = unique((((analysis || {}).selected_trades) || [])
    .map(function (t) { return titleCase(t); })
    .filter(function (t) { return t && !isGeneralTrade(t); }));
  if (!services.length) return estimate;

  var value = function (l) { return positiveNumber(l.qty) * positiveNumber(l.rate); };
  var homeless = function (l) {
    return isGeneralTrade(l.section) || !services.some(function (s) { return sameTrade(s, l.section); });
  };

  /* 1. Keyword, for non-shared work only. */
  ["labor", "materials"].forEach(function (kind) {
    (estimate[kind] || []).forEach(function (line) {
      if (!homeless(line) || SHARED_ACROSS_SERVICES.test(line.item)) return;
      var guess = titleCase(inferTradeForItem(line.item, services));
      if (guess && !isGeneralTrade(guess) && services.some(function (s) { return sameTrade(s, guess); })) {
        line.section = guess;
      }
    });
  });

  /* Weights come from LABOUR, not total cost. Coordination and cleanup are effort,
     and a service can carry a huge supplied-material line while carrying almost no
     effort: Windows on this job is $11,880 of customer-selected windows and barely any
     work. Weighting by total cost handed Windows 62% of the shared coordination and
     inflated a per-service subtotal the customer actually reads.
     A service with no labour at all still needs coordinating - a delivery has to be
     scheduled and received - so it takes the AVERAGE of the services that do have
     labour. That is a typical share, never a dominant one, and it self-corrects the
     moment that service gets real labour lines of its own. */
  var labourWeight = {}, totalWeight = {};
  services.forEach(function (s) { labourWeight[s] = 0; totalWeight[s] = 0; });
  ["labor", "materials"].forEach(function (kind) {
    (estimate[kind] || []).forEach(function (line) {
      if (homeless(line)) return;
      var key = services.filter(function (s) { return sameTrade(s, line.section); })[0];
      if (!key) return;
      if (kind === "labor") labourWeight[key] += value(line);
      totalWeight[key] += value(line);
    });
  });
  var withLabour = services.filter(function (s) { return labourWeight[s] > 0; });
  var weight = {};
  if (withLabour.length) {
    var meanLabour = withLabour.reduce(function (a, s) { return a + labourWeight[s]; }, 0) / withLabour.length;
    services.forEach(function (s) { weight[s] = labourWeight[s] > 0 ? labourWeight[s] : meanLabour; });
  } else {
    services.forEach(function (s) { weight[s] = totalWeight[s]; });
  }
  var base = services.reduce(function (a, s) { return a + weight[s]; }, 0);
  if (base <= 0) { services.forEach(function (s) { weight[s] = 1; }); base = services.length; }

  /* 1b. Merge shared lines of the same kind and rate BEFORE splitting, or three
     cleanup lines become twelve. The longest wording survives, which also stops the
     customer's Included list reading "final cleanup" three times in three slightly
     different phrasings. */
  var SHARED_KIND = [
    [/coordinat|supervis|project manage/i, "coordination"],
    [/debris|disposal|haul|dump/i, "debris"],
    [/clean/i, "cleanup"],
    [/protect/i, "protection"],
    [/punch ?list|mobiliz/i, "site"]
  ];
  var sharedKind = function (item) {
    for (var i = 0; i < SHARED_KIND.length; i++) if (SHARED_KIND[i][0].test(item)) return SHARED_KIND[i][1];
    return "";
  };
  ["labor", "materials"].forEach(function (kind) {
    var groups = {}, out = [];
    (estimate[kind] || []).forEach(function (line) {
      var k = homeless(line) ? sharedKind(line.item) : "";
      if (!k) { out.push(line); return; }
      var key = k + "|" + positiveNumber(line.rate);
      if (!groups[key]) { groups[key] = line; out.push(line); return; }
      var g = groups[key];
      g.qty = positiveNumber(g.qty) + positiveNumber(line.qty);
      if (String(line.item).length > String(g.item).length) g.item = line.item;
    });
    estimate[kind] = out;
  });

  /* 2. Split whatever is still homeless across every service. */
  ["labor", "materials"].forEach(function (kind) {
    var out = [];
    (estimate[kind] || []).forEach(function (line) {
      if (!homeless(line)) { out.push(line); return; }
      var total = value(line);
      if (total <= 0 || services.length === 1) {
        line.section = services[0];
        out.push(line);
        return;
      }
      var rate = positiveNumber(line.rate) || 1;
      var parts = [];
      var spent = 0;
      services.forEach(function (s, i) {
        var share = (i === services.length - 1)
          ? roundCurrency(total - spent)
          : roundCurrency(total * (weight[s] / base));
        spent = roundCurrency(spent + share);
        if (share > 0) parts.push({ section: s, share: share, qty: 0 });
      });
      if (!parts.length) { line.section = services[0]; out.push(line); return; }
      parts.forEach(function (p) { p.qty = Math.round((p.share / rate) * 100) / 100; });
      var built = parts.reduce(function (a, p) { return a + p.qty * rate; }, 0);
      if (Math.abs(built - total) >= 0.005) {
        var biggest = parts.reduce(function (a, b) { return b.share > a.share ? b : a; }, parts[0]);
        biggest.qty = Math.round(((biggest.qty * rate + (total - built)) / rate) * 10000) / 10000;
      }
      parts.forEach(function (p) {
        var copy = {};
        Object.keys(line).forEach(function (k) { copy[k] = line[k]; });
        copy.section = p.section;
        copy.qty = p.qty;
        copy.rate = rate;
        /* Stamp what THIS function created. validateEstimate discounts these when it
           asks whether a trade has labor of its own - matching on wording instead
           failed a one-line handyman job whose only labor line happened to read
           "Protect area, patch drywall, clean up and remove debris". */
        copy.sbcSharedSplit = true;
        out.push(copy);
      });
    });
    estimate[kind] = out;
  });
  return estimate;
}

function validateEstimate(estimate, analysis, input) {
  const failures = [];
  const warnings = [];
  const laborText = estimate.labor.map((l) => `${l.section} ${l.item}`).join(" ").toLowerCase();
  const materialText = estimate.materials.map((m) => `${m.section} ${m.item}`).join(" ").toLowerCase();
  const allText = `${laborText} ${materialText}`;
  analysis.selected_trades.forEach((trade) => {
    if (isGeneralTrade(trade)) return;
    const token = trade.toLowerCase();
    const hasLabor = estimate.labor.some((l) => !l.sbcSharedSplit && (l.section.toLowerCase().includes(token) || token.includes(l.section.toLowerCase())));
    if (!hasLabor) failures.push(`Selected trade "${trade}" has no labor line.`);
  });
  analysis.customer_supplied_finish_materials.forEach((item) => {
    const keywords = importantWords(item);
    const hasInstallLabor = estimate.labor.some((l) => { const t = l.item.toLowerCase(); return keywords.some((k) => t.includes(k)) && /(install|set|mount|connect|hang|fit|place)/i.test(l.item); });
    if (!hasInstallLabor) failures.push(`Customer-supplied item "${item}" has no matching installation labor.`);
  });
  const renovationLike = /(renovation|remodel|replace|installation|bathroom|kitchen)/i.test(`${analysis.project_type} ${analysis.project_summary} ${input.request.service}`);
  if (renovationLike && !/(protect|protection|cover|containment)/i.test(allText)) failures.push("No site/floor protection labor or material is included.");
  if (renovationLike && !/(clean|cleanup|final clean)/i.test(laborText)) failures.push("No cleanup labor is included.");
  const removalRequested = /(demo|demolition|remove|disposal|replace existing|tear out)/i.test(`${analysis.project_summary} ${JSON.stringify(analysis.confirmed_scope)} ${input.request.description}`);
  if (removalRequested && !/(demo|demolition|remove|tear out)/i.test(laborText)) failures.push("Removal/demolition was requested but no removal labor is included.");
  if (removalRequested && !/(disposal|debris|haul|dump)/i.test(allText)) failures.push("Removal was requested but debris handling/disposal is missing.");
  const multiTrade = analysis.selected_trades.filter((t) => !isGeneralTrade(t)).length >= 3;
  if (multiTrade && !/(supervision|coordination|project management|project setup)/i.test(laborText)) failures.push("Multi-trade project has no supervision or project coordination line.");
  const walkUp = /yes|true|walk.?up/i.test(String(analysis.site_conditions.walk_up || "")) || /walk.?up|third floor|3rd floor|fourth floor|4th floor/i.test(input.request.description);
  if (walkUp && !/(walk.?up|carry|handling|stairs|material handling|debris handling)/i.test(allText)) failures.push("Walk-up/access condition is present but handling labor is missing.");
  if (analysis.customer_supplied_finish_materials.length && estimate.materials.length === 0) failures.push("All materials were removed even though rough/installation materials are still required.");
  const subtotal = calculateSubtotal(estimate);
  const grandTotal = subtotal * (1 + estimate.markupPct / 100);
  if (!estimate.labor.length) failures.push("Estimate contains no labor lines.");
  if (subtotal <= 0) failures.push("Estimate subtotal is zero.");
  const scopeWeight = estimateScopeWeight(analysis, input);

  /* ============================================================================
     NO PRICE FLOORS. REMOVED Aug 8 2026.
     ----------------------------------------------------------------------------
     This block used to reject an estimate for being too CHEAP:

       scopeWeight >= 8 && grandTotal < 20000  -> failure "suspiciously low"
       scopeWeight >= 5 && grandTotal < 10000  -> failure "suspiciously low"
       multiTrade && labor.length < 10         -> failure "too few labor lines"

     A failure triggers the repair pass, and buildRepairPrompt hands the model the
     failure text. So the system read a correct estimate, decided it was too cheap,
     and asked the AI to redo it. There was never a matching check for a total being
     too HIGH, so the pressure only ever ran one way.

     estimateScopeWeight scores a single bathroom gut at 9+ (one trade 2, "gut" 3,
     "bathroom" 2, waterproofing/plumbing 2), so EVERY bathroom job was structurally
     incapable of passing under $20,000 - against a real quoted range of $12-18k. A
     small job is supposed to produce a small number.

     scopeWeight is still calculated and still returned, because it is genuinely
     useful context on the record. It just no longer decides anything about price.

     The real guards remain below: an estimate with no labor, or a subtotal of zero,
     is still a hard failure. Those catch a broken estimate without having an opinion
     about what a job ought to cost.

     DO NOT REINTRODUCE A PRICE FLOOR. If pricing needs steering, it belongs in the
     House Rules the contractor writes - his own bands and unit prices - never in a
     hardcoded threshold that assumes every job is a big one.
     ============================================================================ */

  /* Line count is a shape observation, not a defect: a small job legitimately has
     few lines. Recorded as a warning so it is visible on the record, but it must
     never trigger the repair pass and pad the estimate. */
  if (multiTrade && estimate.labor.length < 10) warnings.push("Multi-trade project is described in few labor lines - check nothing is missing.");
  /* The 160-hour warning is gone too. estimateScopeWeight scores any bathroom gut at
     9+, so it fired on every single one - including a perfectly normal $9,000 job. A
     warning that always fires carries no information and trains the eye to skip it. */
  analysis.selected_trades.forEach((trade) => {
    const tradeLabor = estimate.labor.filter((l) => sameTrade(l.section, trade));
    const tradeMaterials = estimate.materials.filter((m) => sameTrade(m.section, trade));
    if (tradeLabor.length && !tradeMaterials.length && !tradeCanBeLaborOnly(trade)) warnings.push(`${trade} has labor but no contractor-supplied rough/installation materials.`);
  });
  return { passed: failures.length === 0, failures, warnings, scopeWeight, calculatedSubtotal: roundCurrency(subtotal), calculatedGrandTotal: roundCurrency(grandTotal), checkedAt: new Date().toISOString() };
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
  const scopeText = sections.map((section) => `${section.title.toUpperCase()}:\n${section.items.map((item) => `• ${item}`).join("\n")}`).join("\n\n");
  const tradeNames = sections.map((s) => s.title).filter(Boolean);
  const address = cleanText(input.customer.address);
  const location = address ? ` at ${address}` : "";
  const statusText = estimate.estimateStatus === "PRELIMINARY" ? "This is a preliminary estimate based on the information provided and listed assumptions." : estimate.estimateStatus === "SITE_VISIT_REQUIRED" ? "A site visit is required before final pricing can be confirmed." : "The estimate is based on the confirmed scope and quantities provided.";
  const conciseSummary = `${tradeNames.length ? tradeNames.join(", ") : "Renovation"} work${location}. ${statusText}`;
  const serviceBreakdown = buildServiceBreakdown(estimate, analysis, sections);
  return { ...estimate, summary: cleanText(estimate.summary).length > 420 ? conciseSummary : (cleanText(estimate.summary) || conciseSummary), scopeSections: sections, serviceBreakdown, scopeOfWork: scopeText, showLaborCost: false, showMaterialsCost: false, showSectionSubtotals: true, showLaborLines: false, showMaterialLines: false, customerViewMode: "service_summary", customerPresentationVersion: "v7-service-proposal" };
}

function buildServiceBreakdown(estimate, analysis, sections) {
  const markupMultiplier = 1 + (positiveNumber(estimate.markupPct) / 100);
  const knownTitles = sections.map((s) => titleCase(s.title || "General"));
  const serviceMap = new Map();
  const order = [];
  const ensure = (name) => {
    const title = titleCase(name || "General") || "General";
    if (!serviceMap.has(title)) { serviceMap.set(title, { title, included: [], customerSupplies: [], notIncluded: [], subtotal: 0, options: [] }); order.push(title); }
    return serviceMap.get(title);
  };
  sections.forEach((section) => { ensure(section.title).included.push(...(section.items || [])); });
  const addLine = (line) => { const section = titleCase(line.section || inferTradeForItem(line.item, knownTitles) || "General") || "General"; ensure(section).subtotal += positiveNumber(line.qty) * positiveNumber(line.rate) * markupMultiplier; };
  (estimate.labor || []).forEach(addLine);
  (estimate.materials || []).forEach(addLine);
  (estimate.customerSupplied || []).forEach((entry) => {
    const item = typeof entry === "string" ? entry : entry.item;
    if (!cleanText(item)) return;
    const section = typeof entry === "object" && entry.section ? entry.section : inferTradeForItem(item, knownTitles);
    ensure(section || "General").customerSupplies.push(cleanText(item));
  });
  const assignExclusion = (text) => { const item = cleanText(text); if (!item) return; const section = inferProposalSection(item, knownTitles); ensure(section || "General").notIncluded.push(item); };
  (estimate.exclusions || []).forEach(assignExclusion);
  (analysis.confirmed_scope || []).forEach((block) => { (block.customer_exclusions || []).forEach((item) => { const target = block.trade || inferTradeForItem(item, knownTitles); ensure(target || "General").notIncluded.push(cleanText(item)); }); });
  (estimate.options || []).forEach((option) => { const section = option.section || inferProposalSection(`${option.label} ${option.description || ""}`, knownTitles); ensure(section || "General").options.push(option); });
  return order.map((name) => { const service = serviceMap.get(name); return { ...service, included: unique(service.included.map(cleanText).filter(Boolean)), customerSupplies: unique(service.customerSupplies.map(cleanText).filter(Boolean)), notIncluded: unique(service.notIncluded.map(cleanText).filter(Boolean)), subtotal: roundCurrency(service.subtotal) }; }).filter((service) => service.included.length || service.customerSupplies.length || service.notIncluded.length || service.subtotal > 0 || service.options.length);
}

function inferProposalSection(item, trades) {
  const text = String(item || "").toLowerCase();
  const mappings = [["window", "Windows"], ["paint", "Painting"], ["primer", "Painting"], ["ceiling", "Painting"], ["hardwood", "Flooring"], ["flooring", "Flooring"], ["subfloor", "Flooring"], ["baseboard", "Flooring"], ["bath", "Bathroom"], ["tile", "Bathroom"], ["vanity", "Bathroom"], ["toilet", "Bathroom"], ["faucet", "Bathroom"], ["shower", "Bathroom"], ["mirror", "Bathroom"], ["plumb", "Bathroom"], ["waterproof", "Bathroom"], ["glass enclosure", "Bathroom"], ["cabinet", "Kitchen"], ["countertop", "Kitchen"]];
  for (const [token, trade] of mappings) if (text.includes(token)) return trades.find((t) => sameTrade(t, trade)) || trade;
  return "General";
}

function buildScopeSections(estimate, analysis) {
  const sectionOrder = [];
  const grouped = new Map();
  const ensure = (name) => { const title = titleCase(name || "General") || "General"; if (!grouped.has(title)) { grouped.set(title, []); sectionOrder.push(title); } return grouped.get(title); };
  estimate.labor.forEach((line) => { const item = customerFriendlyScopeItem(line.item); if (item) ensure(line.section).push(item); });
  (analysis.confirmed_scope || []).forEach((block) => { const section = titleCase(block.trade || "General") || "General"; (block.scope_items || []).forEach((raw) => { const item = customerFriendlyScopeItem(raw); if (item) ensure(section).push(item); }); });
  estimate.materials.forEach((line) => { if (!/(waterproof|membrane|backer|thinset|grout|primer|paint|sealant|insulation|flashing|underlayment|leveling|fastener|protection)/i.test(line.item)) return; const item = `Provide and use ${sentenceCase(line.item)}`; ensure(line.section).push(item); });
  return sectionOrder.map((title) => { const items = unique(grouped.get(title).map(normalizeScopeSentence)).filter(Boolean).filter((item, index, arr) => arr.findIndex((other) => scopeSentencesEquivalent(item, other)) === index).slice(0, 12); return { title, items }; }).filter((section) => section.items.length);
}

function customerFriendlyScopeItem(value) {
  let text = cleanText(value).replace(/^labor\s*[-:]\s*/i, "").replace(/\s*\([^)]*hours?[^)]*\)\s*/ig, " ").replace(/\s*@\s*\$?[\d,.]+.*$/i, "").replace(/\bqty\.?\s*\d+(?:\.\d+)?\b/ig, "").replace(/\s{2,}/g, " ").trim();
  if (!text) return "";
  if (/^(project management|supervision|coordination)$/i.test(text)) return "Coordinate trades, scheduling, deliveries, and quality control";
  if (/^(cleanup|final cleanup)$/i.test(text)) return "Complete final cleanup and remove construction debris";
  return normalizeScopeSentence(text);
}

function normalizeScopeSentence(value) { let text = cleanText(value).replace(/[.;,:\-–—]+$/g, "").trim(); if (!text) return ""; text = text.charAt(0).toUpperCase() + text.slice(1); return text; }
function sentenceCase(value) { const text = cleanText(value).replace(/[.;,:]+$/g, ""); if (!text) return ""; return text.charAt(0).toLowerCase() + text.slice(1); }
function scopeSentencesEquivalent(a, b) { const normalize = (v) => importantWords(v).sort().join(" "); const aa = normalize(a); const bb = normalize(b); return aa === bb || (aa.length > 12 && bb.length > 12 && (aa.includes(bb) || bb.includes(aa))); }

function callOpenAI(apiKey, prompt) {
  const payload = JSON.stringify({
    model: OPENAI_ANALYSIS_MODEL,
    store: false,
    input: [
      { role: "system", content: [{ type: "input_text", text: "Return one valid JSON object only. Do not use markdown or commentary." }] },
      { role: "user", content: [{ type: "input_text", text: prompt }] },
    ],
    text: /^gpt-5/i.test(OPENAI_ANALYSIS_MODEL)
      ? { format: { type: "json_object" }, verbosity: "low" }
      : { format: { type: "json_object" } },
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.openai.com",
        port: 443,
        path: "/v1/responses",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), Authorization: `Bearer ${apiKey}` },
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
          } else reject(new Error(`OpenAI ${res.statusCode}: ${body.slice(0, 500)}`));
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
  (json.output || []).forEach((item) => { (item.content || []).forEach((part) => { if (typeof part.text === "string") chunks.push(part.text); }); });
  return chunks.join("\n");
}

function callClaude(apiKey, prompt, maxTokens) {
  const payload = JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, temperature: 0.1, messages: [{ role: "user", content: prompt }] });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        port: 443,
        path: "/v1/messages",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
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
              /* A response cut off at max_tokens is valid HTTP and invalid JSON, and
                 parseAiJson's brace-slice fallback cannot rescue it - it finds a nested
                 closing brace and produces another invalid slice. Without this check the
                 message is identical to genuinely malformed output, so the one fix that
                 would help (a larger cap, or a smaller prompt) is invisible. */
              if (json.stop_reason === "max_tokens") {
                return reject(new Error(
                  `Claude response hit the ${maxTokens}-token limit and was cut off. ` +
                  `Raise max_tokens for this call or shorten the prompt.`));
              }
              resolve(text);
            }
            catch (error) { reject(new Error(`Bad Claude response: ${body.slice(0, 300)}`)); }
          } else reject(new Error(`Claude ${res.statusCode}: ${body.slice(0, 500)}`));
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
  const cleaned = String(text || "").replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); }
  catch (error) {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) { try { return JSON.parse(cleaned.slice(first, last + 1)); } catch (_) {} }
    console.error(`AI ${label} raw response:`, cleaned.slice(0, 2500));
    throw new Error(`AI returned invalid JSON for ${label}`);
  }
}

function safeJsonParse(value, fallback) { try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; } }
function mapReadinessToEstimateStatus(status) { if (status === "SITE_VISIT_REQUIRED") return "SITE_VISIT_REQUIRED"; if (status === "NEEDS_CUSTOMER_QUESTIONS") return "NEEDS_CLARIFICATION"; if (status === "PRELIMINARY_ESTIMATE_WITH_ASSUMPTIONS") return "PRELIMINARY"; return "READY"; }
function inferTradeForItem(item, trades) { const text = String(item).toLowerCase(); const mappings = [["tile", "Bathroom"], ["vanity", "Bathroom"], ["toilet", "Bathroom"], ["faucet", "Bathroom"], ["shower", "Bathroom"], ["mirror", "Bathroom"], ["floor", "Flooring"], ["hardwood", "Flooring"], ["baseboard", "Flooring"], ["paint", "Painting"], ["window", "Windows"], ["cabinet", "Kitchen"]]; for (const [token, trade] of mappings) if (text.includes(token)) return trades.find((t) => sameTrade(t, trade)) || trade; return trades[0] || "General"; }
function importantWords(text) { const stop = new Set(["and", "the", "with", "material", "materials", "floor", "wall"]); return String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !stop.has(w)); }
function sameTrade(a, b) { const x = String(a || "").toLowerCase(); const y = String(b || "").toLowerCase(); return x === y || x.includes(y) || y.includes(x); }
function tradeCanBeLaborOnly(trade) { return /handyman|consult|inspection|general/i.test(trade); }
function isGeneralTrade(trade) { return /general|other|not listed|mixed/i.test(String(trade)); }
function normalizedIncludes(a, b) { const x = String(a || "").toLowerCase(); const y = String(b || "").toLowerCase(); return x.includes(y) || y.includes(x); }
function cleanText(value) { return value === null || value === undefined ? "" : String(value).trim(); }
function titleCase(value) { return cleanText(value).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); }
function toStringArray(value) { return (Array.isArray(value) ? value : []).map((v) => cleanText(v)).filter(Boolean); }
function unique(values) { const seen = new Set(); return values.filter((v) => { const key = String(v).toLowerCase().trim(); if (!key || seen.has(key)) return false; seen.add(key); return true; }); }
function positiveNumber(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : 0; }
function roundCurrency(value) { return Math.round((Number(value) || 0) * 100) / 100; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function jsonResponse(statusCode, body) { return { statusCode, headers: cors(), body: JSON.stringify(body) }; }
function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" }; }
