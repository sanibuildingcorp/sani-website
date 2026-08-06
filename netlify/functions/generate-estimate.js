// netlify/functions/generate-estimate.js
// Smart Renovation Estimator v5 — Aug 6, 2026
//
// Pipeline:
// 1) Read and structure the full customer request.
// 2) Detect missing/contradictory information and pricing readiness.
// 3) Generate a complete trade-by-trade estimate from the structured scope.
// 4) Validate trade coverage, installation labor, rough materials and total realism.
// 5) Save both the internal project analysis and the estimate draft to Netlify Blobs.
//
// Backwards compatible with the existing dashboard response shape.

const https = require("https");
const { getStore } = require("@netlify/blobs");

const MODEL = process.env.ESTIMATOR_MODEL || "claude-sonnet-4-5-20250929";
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

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return jsonResponse(500, { error: "ANTHROPIC_API_KEY not set" });

    // Open the same Netlify Blobs store used by the existing dashboard.
    // Legacy Netlify Functions do not always receive automatic Blob context,
    // so v5 supports both automatic runtime credentials and explicit env vars.
    const store = openEstimateStore();

    const record = await store.get(ref, { type: "json" });
    if (!record) return jsonResponse(404, { error: "Estimate not found" });

    const input = buildEstimatorInput(record, body);

    // PASS 1: Understand the project before pricing it.
    const analysisPrompt = buildProjectAnalysisPrompt(input);
    const rawAnalysis = await callClaude(apiKey, analysisPrompt, 6000);
    const projectAnalysis = normalizeProjectAnalysis(parseAiJson(rawAnalysis, "project analysis"), input);

    // PASS 2: Price the structured scope, not the raw paragraph alone.
    const estimatePrompt = buildEstimatePrompt(input, projectAnalysis);
    const rawEstimate = await callClaude(apiKey, estimatePrompt, 8000);
    let estimate = normalizeEstimate(parseAiJson(rawEstimate, "estimate"), input, projectAnalysis);

    // Deterministic validation catches omissions even when the model misses them.
    let validation = validateEstimate(estimate, projectAnalysis, input);

    // One automatic repair pass when the draft is incomplete or suspiciously low.
    if (!validation.passed) {
      const repairPrompt = buildRepairPrompt(input, projectAnalysis, estimate, validation);
      const rawRepair = await callClaude(apiKey, repairPrompt, 8000);
      estimate = normalizeEstimate(parseAiJson(rawRepair, "repaired estimate"), input, projectAnalysis);
      validation = validateEstimate(estimate, projectAnalysis, input);
    }

    estimate.validation = validation;
    estimate.pricingReadiness = projectAnalysis.pricing_readiness;
    estimate.clarificationQuestions = projectAnalysis.clarification_questions;

    record.projectAnalysis = projectAnalysis;
    record.estimate = estimate;
    record.status = record.status === "new" ? "drafted" : record.status;
    record.updatedAt = new Date().toISOString();
    await store.setJSON(ref, record);

    return jsonResponse(200, {
      success: true,
      estimate: record.estimate,
      projectAnalysis: record.projectAnalysis,
      status: record.status,
      requiresClarification:
        ["NEEDS_CUSTOMER_QUESTIONS", "SITE_VISIT_REQUIRED"].includes(
          projectAnalysis.pricing_readiness.status
        ),
    });
  } catch (err) {
    console.error("generate-estimate v5 error:", err && err.stack ? err.stack : err);
    const message = err && err.message ? err.message : "Estimate generation failed";
    const blobConfigError = /environment has not been configured|siteID|site id|blobs|expected pattern/i.test(message);
    return jsonResponse(500, {
      error: blobConfigError
        ? "Estimate storage is not connected. In Netlify, add NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN (or NETLIFY_BLOBS_TOKEN) to Environment Variables with Functions scope, then redeploy."
        : message,
      stage: blobConfigError ? "estimate_storage" : "estimate_generation",
    });
  }
};

function openEstimateStore() {
  const siteID = firstEnv([
    "NETLIFY_SITE_ID",
    "SITE_ID",
    "BLOBS_SITE_ID",
    "MY_SITE_ID",
  ]);
  const token = firstEnv([
    "NETLIFY_BLOBS_TOKEN",
    "BLOBS_TOKEN",
    "NETLIFY_AUTH_TOKEN",
    "MY_BLOBS_TOKEN",
  ]);

  // Explicit credentials are the most dependable option for a CommonJS
  // background/legacy function. Never pass undefined values to getStore.
  if (siteID && token) {
    return getStore({ name: "estimates", siteID, token });
  }

  // On newer Netlify runtimes, the SDK receives the site context automatically.
  // This keeps the function compatible without forcing duplicate credentials.
  return getStore("estimates");
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
   READY_TO_ESTIMATE
   PRELIMINARY_ESTIMATE_WITH_ASSUMPTIONS
   NEEDS_CUSTOMER_QUESTIONS
   SITE_VISIT_REQUIRED
15. A detailed multi-trade description with usable measurements may be priced preliminarily even if a few noncritical items remain unknown.
16. Do not use the smallest possible interpretation when the request clearly describes a larger project. Use the most reasonable professional interpretation supported by all evidence.
17. Identify work normally required to complete each requested result, including protection, demolition, preparation, installation, connections, finishing, debris removal and cleanup.
18. If a customer asks for alternatives, clearly identify the base scope and each alternate.

Return ONLY valid JSON with this exact structure:
{
  "project_summary": "",
  "project_type": "repair | partial renovation | full renovation | installation | replacement | restoration | mixed",
  "selected_trades": [],
  "confirmed_scope": [
    {"trade":"","scope_items":[],"quantities":{},"customer_exclusions":[]}
  ],
  "inferred_scope": [
    {"trade":"","item":"","reason":"","requires_confirmation":false}
  ],
  "customer_supplied_finish_materials": [],
  "contractor_supplied_finish_materials": [],
  "contractor_supplied_rough_materials": [],
  "site_conditions": {
    "occupied_status":"","floor_number":"","elevator_access":"","walk_up":"",
    "work_hours":"","debris_access":"","parking_loading":"",
    "building_requirements":"","protection_requirements":""
  },
  "quantities": {},
  "assumptions": [],
  "exclusions": [],
  "conflicts": [
    {"issue":"","likely_interpretation":"","needs_confirmation":false}
  ],
  "missing_information": [
    {"question":"","reason_needed":"","priority":"critical | pricing | site_condition | optional","affected_trade":""}
  ],
  "clarification_questions": [
    {"id":"","question":"","helper_text":"","type":"single_select | multi_select | number | short_text | photo_request","options":[],"affected_trade":"","pricing_importance":"critical | high | medium"}
  ],
  "pricing_readiness": {
    "status":"READY_TO_ESTIMATE | PRELIMINARY_ESTIMATE_WITH_ASSUMPTIONS | NEEDS_CUSTOMER_QUESTIONS | SITE_VISIT_REQUIRED",
    "confidence_score":0,
    "reason":""
  }
}`;
}

function buildEstimatePrompt(input, analysis) {
  return `You are the Senior Construction Estimator for Sani Building Corp, an experienced, fully insured NYC-metro renovation and repair contractor.

Create a realistic contractor estimate from the STRUCTURED PROJECT ANALYSIS below. Do not price directly from the customer's long paragraph without following the structured analysis.

STRICT WORDING RULE: Never use the word "licensed" or make any licensing claim.

RAW INPUT FOR REFERENCE:
${JSON.stringify(input, null, 2)}

STRUCTURED PROJECT ANALYSIS — SOURCE OF TRUTH:
${JSON.stringify(analysis, null, 2)}

ESTIMATING METHOD:
1. Create a complete trade package for EVERY selected trade.
2. For each trade include all applicable phases: protection, mobilization, demolition/removal, disposal, preparation, rough work, installation, finishing, testing, touch-ups and cleanup.
3. Do not add unrelated upgrades. Include normal enabling work required to complete the expressly requested result.
4. Separate finish materials from rough/installation materials.
5. Customer-supplied items receive no material charge, but installation labor and all needed rough/installation materials remain included.
6. Use crew-day/production logic for substantial projects. Do not compress a full bathroom or multi-room renovation into a few token hours.
7. Use quantities and dimensions from the analysis. Reconcile overlapping measurements; do not double count.
8. Include NYC access impacts supported by the input: walk-up handling, floor protection, debris movement, occupied-space protection, restricted access and coordination.
9. Include supervision/project coordination for multi-trade work.
10. Include delivery, material handling and final cleaning when applicable.
11. Keep explicit exclusions and customer carve-outs excluded.
12. Alternatives requested by the customer go in options and are not added to the base total unless the base scope expressly selects one.
13. For an alternate, provide a COMPLETE alternate price, including labor, materials, disposal and finishing required for that alternate.
14. Do not choose the cheapest interpretation merely to reduce the number. Use the reasonable professional interpretation documented in the analysis.
15. Do not inflate quantities. Accuracy means complete scope at realistic production rates, not padding.
16. Use current NYC-metro contractor selling rates. Rates must support overhead and field realities; markup is applied separately.
17. Apply markup to labor and materials through markupPct. Default to ${DEFAULT_MARKUP}% unless contractor house rules specify otherwise.
18. If pricing readiness is PRELIMINARY_ESTIMATE_WITH_ASSUMPTIONS, generate a preliminary estimate and clearly list assumptions internally.
19. If critical information is missing, still draft only the reliably priceable scope and set estimateStatus accordingly. Never pretend a precise final price is guaranteed.

BASE NYC SELLING-RATE GUIDANCE (house rules override):
- General labor / helper: $65-$90 per hour
- Carpenter / finish installer: $95-$135 per hour
- Tile installer: $105-$145 per hour
- Plumber: $125-$175 per hour
- Electrician: $125-$175 per hour
- Painter: $60-$90 per hour
- Demolition worker: $65-$90 per hour each
- Project supervision / coordination: $95-$140 per hour
Use crew days where clearer: qty is total crew-days and rate is total cost per crew-day.

COMPLETENESS REQUIREMENTS:
- Every selected trade must have at least one labor line unless explicitly excluded.
- Every installation of a customer-supplied item must have matching labor.
- Rough/installation materials must remain even when finish items are customer-supplied.
- Include protection and cleanup for renovation work.
- Include demolition/disposal where removal is requested.
- Include access/handling when supported by site conditions.
- Include plumbing, electrical, waterproofing and glass installation when requested.
- Large multi-trade projects may require dozens of lines. Never force them into a 4-10 line limit.

Return ONLY valid JSON with this shape:
{
  "projectTitle":"",
  "summary":"",
  "scopeOfWork":"",
  "estimateStatus":"READY | PRELIMINARY | NEEDS_CLARIFICATION | SITE_VISIT_REQUIRED",
  "labor":[
    {"item":"","qty":1,"unit":"hrs | days | crew-days | ea | sqft | lf","rate":0,"section":""}
  ],
  "materials":[
    {"item":"","qty":1,"unit":"ea | sqft | lf | gal | bag | box | allowance","rate":0,"section":""}
  ],
  "customerSupplied":[
    {"item":"","section":"","note":"Installation labor and required rough materials remain included"}
  ],
  "exclusions":[],
  "options":[
    {"label":"","description":"","price":0,"section":""}
  ],
  "timelineText":"",
  "markupPct":${DEFAULT_MARKUP},
  "assumptions":[],
  "internalScopeChecklist":[
    {"trade":"","required_items":[],"covered":true,"missing":[]}
  ],
  "notes":""
}`;
}

function buildRepairPrompt(input, analysis, estimate, validation) {
  return `You are repairing an incomplete or unrealistic renovation estimate for Sani Building Corp.

STRICT WORDING RULE: Never use the word "licensed" or make any licensing claim.

CUSTOMER INPUT:
${JSON.stringify(input, null, 2)}

PROJECT ANALYSIS:
${JSON.stringify(analysis, null, 2)}

FAILED ESTIMATE:
${JSON.stringify(estimate, null, 2)}

VALIDATION FAILURES:
${JSON.stringify(validation, null, 2)}

Rebuild the estimate completely. Correct every validation failure. Do not merely add a note. Add the missing labor, rough materials, access, disposal, supervision or trade lines. Preserve customer exclusions and do not charge for customer-supplied finish items. Use realistic NYC production and crew-day logic. Return ONLY JSON in exactly the same estimate shape as the failed estimate.`;
}

function normalizeProjectAnalysis(raw, input) {
  const selectedTrades = unique([
    ...(Array.isArray(raw.selected_trades) ? raw.selected_trades : []),
    ...input.request.selectedServices,
  ].map(titleCase).filter(Boolean));

  const missing = Array.isArray(raw.missing_information) ? raw.missing_information : [];
  let questions = Array.isArray(raw.clarification_questions) ? raw.clarification_questions : [];
  if (!questions.length) {
    questions = missing
      .filter((m) => ["critical", "pricing", "site_condition"].includes(String(m.priority || "").toLowerCase()))
      .slice(0, 5)
      .map((m, i) => ({
        id: `q${i + 1}`,
        question: cleanText(m.question),
        helper_text: cleanText(m.reason_needed),
        type: "short_text",
        options: [],
        affected_trade: titleCase(m.affected_trade || "General"),
        pricing_importance: String(m.priority || "medium").toLowerCase() === "critical" ? "critical" : "high",
      }));
  }

  const readiness = raw.pricing_readiness || {};
  const allowedStatus = [
    "READY_TO_ESTIMATE",
    "PRELIMINARY_ESTIMATE_WITH_ASSUMPTIONS",
    "NEEDS_CUSTOMER_QUESTIONS",
    "SITE_VISIT_REQUIRED",
  ];

  return {
    project_summary: cleanText(raw.project_summary),
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

function callClaude(apiKey, prompt, maxTokens) {
  const payload = JSON.stringify({
    model: MODEL,
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
    req.setTimeout(110000, () => req.destroy(new Error("Claude request timed out")));
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
  } catch (firstError) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch (_) {
        // fall through
      }
    }
    throw new Error(`AI returned invalid JSON for ${label}: ${cleaned.slice(0, 500)}`);
  }
}

function mapReadinessToEstimateStatus(status) {
  if (status === "READY_TO_ESTIMATE") return "READY";
  if (status === "SITE_VISIT_REQUIRED") return "SITE_VISIT_REQUIRED";
  if (status === "NEEDS_CUSTOMER_QUESTIONS") return "NEEDS_CLARIFICATION";
  return "PRELIMINARY";
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
  return (Array.isArray(value) ? value : [])
    .map((item) => cleanText(typeof item === "string" ? item : item && (item.item || item.text)))
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value || "{}");
  } catch (_) {
    return fallback;
  }
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
