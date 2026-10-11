// netlify/functions/lib/handyman-brain.js
//
// THE HANDYMAN BRAIN. One strong model reads the booking (the customer's own
// words, every form answer, the photos) plus the owner's chat, and writes ONE
// plan: the tasks with hours, a firm price, the brief for the visit, what the
// customer must have ready, and a customer-ready scope in "we" language.
//
// The model judges the work (what, how long, which materials). The money is
// then worked out here from HIS rates, so the price is always his hourly rate
// x hours + materials with his markup, never less than his minimum visit,
// unless he tells the brain a flat price himself ("$350 flat").
//
// Pure functions only (no network), so it is tested in handyman-brain.test.js.

"use strict";

const C = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n || 400);
const A = (v) => (Array.isArray(v) ? v : []);
const N = (v) => { const n = Number(String(v == null ? "" : v).replace(/[$,]/g, "")); return Number.isFinite(n) && n >= 0 ? n : 0; };
const list = (v, max, len) => A(v).map((x) => C(typeof x === "string" ? x : x && (x.text || x.item || x.name), len || 200)).filter(Boolean).slice(0, max || 12);
const clean = (t) => C(t, 2000).replace(/\blicen[cs]ed?\b/gi, "fully insured");

/* His rates. DRAFT defaults from the old handyman price list (General Repairs
   $150-200/hr, 2-hour minimum) until he sets his own in the dashboard. */
const DEFAULT_RATES = { hourly: 150, minimumCharge: 300, materialMarkupPct: 20, draft: true };

function cleanRates(r) {
  const o = r && typeof r === "object" ? r : {};
  return {
    hourly: N(o.hourly) || DEFAULT_RATES.hourly,
    minimumCharge: o.minimumCharge != null && o.minimumCharge !== "" ? N(o.minimumCharge) : DEFAULT_RATES.minimumCharge,
    materialMarkupPct: o.materialMarkupPct != null && o.materialMarkupPct !== "" ? Math.min(100, N(o.materialMarkupPct)) : DEFAULT_RATES.materialMarkupPct,
    draft: o.draft === undefined ? true : !!o.draft,
  };
}

/* What the brain is told about the booking: everything the customer gave us. */
function jobOf(b) {
  const x = b || {};
  return {
    service: C(x.service_name || x.service_id, 120),
    customerSaid: C(x.customer_description, 3000),
    answers: x.answers && typeof x.answers === "object" ? x.answers : {},
    address: C(x.customer_address, 200),
    urgency: C(x.urgency, 40),
    preferredDate: C(x.preferred_date, 40),
    preferredTime: C(x.preferred_time, 40),
    photos: A(x.photo_urls).length,
    ownerNotes: C(x.contractor_notes, 1500),
  };
}

function prompt(booking, plan, rates, history, msg) {
  const r = cleanRates(rates);
  return `You are the handyman estimating brain inside Sani Building Corp's private dashboard (fully insured NYC handyman and renovation company). You work for the owner, an experienced contractor, usually on his phone. The customer never sees this chat; the customer only sees the "customer" part of your plan, after the owner sends it.

READ EVERYTHING: the customer's own words, every form answer and the photos. The customer's words win over generic assumptions. Never invent problems that are not in the request (no "hidden damage", "pick a replacement fixture" or "walk-up" unless the request or answers say so). If the answers say elevator building, do not say walk-up.

THE BOOKING
${JSON.stringify(jobOf(booking)).slice(0, 9000)}

HIS RATES (the server prices with these; you give hours and material COST)
- Labor: $${r.hourly}/hour per worker. Minimum visit: $${r.minimumCharge}. Materials: his cost + ${r.materialMarkupPct}%.

${plan ? "YOUR CURRENT PLAN (change only what the owner asks; keep the rest)\n" + JSON.stringify(plan).slice(0, 6000) + "\n" : ""}${history ? "CHAT SO FAR\n" + history + "\n" : ""}
${msg ? "OWNER NOW SAYS: " + msg : "No owner message yet: read the booking and write your first plan."}

HOW TO THINK
- Break the job into the real tasks. For each: realistic hours on site for ONE worker in NYC (include setup, protection, cleanup), the workers needed, and material COST in dollars.
- Big or heavy items, work over 8 ft, two-person lifts: say so and count the second worker in the hours.
- Building requirements the customer mentioned (COI, elevator booking, super, parking) go in "customerReady" and "warnings". A COI request is always flagged.
- Add travel/parking inside the hours only once, not per task.
- If the owner gives a flat price ("$350 flat", "make it 400"), put it in "flatPrice". If he gives hours or a rate, use them. Owner's words always win.
- If something is missing to price it well, ask max 2 short questions in "askCustomer" (under 12 words each) and still give your best plan. Ask only what changes the price.
- KEEP IT SHORT. The owner reads this on his phone between jobs. Task names under 8 words. Task notes under 15 words. Max 3 warnings, under 15 words each, only real risks that change price or time. Reply 2-3 short sentences. No long explanations.
- Tools and materials: only what THIS job needs (no generic 14-item lists). Max 10 tools, 8 materials.
- Crew text (\"crew\"): for the worker who goes to the job. Plain short words a non-native English speaker understands, no prices, every step says HOW. Include the setup and the cleanup steps.
- Customer text: "we" language, warm and short, no prices in the scope text, never say "licensed".

ANSWER WITH ONLY THIS JSON
{
  "reply": "<2-3 short sentences to the owner: what you priced and why, what to check>",
  "chips": ["<up to 3 short follow-up commands he might tap>"],
  "plan": {
    "title": "<short job title, e.g. Remove 2 window shutters + touch-ups>",
    "tasks": [{ "task": "<what>", "hours": <number>, "workers": <1|2>, "materialCost": <number>, "note": "<why / how, private>" }],
    "flatPrice": <number or null>,
    "visitHours": "<e.g. 2-3 hours>",
    "deposit": <number, 0 unless we must buy parts first>,
    "tools": ["..."],
    "materials": ["..."],
    "warnings": ["<real risks for this job only>"],
    "askCustomer": ["<question>"],
    "customer": {
      "scope": "<2-4 sentences: what we will do, we-language>",
      "steps": ["<short step>"],
      "ready": ["<what the customer should have ready, e.g. COI request sent to building>"],
      "notIncluded": ["<clear exclusions>"]
    },
    "crew": {
      "jobType": "<what kind of job in 3-6 words, e.g. Drywall patch + tile chip repair>",
      "explain": "<2-3 simple sentences for the worker: what the customer wants and what a good result looks like>",
      "steps": [{ "step": "<short action>", "how": "<how to do it right, simple words, the trade tips that matter>" }],
      "checks": ["<check before leaving, e.g. patch is flat under a light, plate fits, area vacuumed>"]
    },
    "confidence": "<high|medium|low>",
    "confidenceWhy": "<one sentence>"
  }
}`;
}

/* Money from his rates. Hours x workers x hourly + materials with markup,
   rounded up to $5, never below his minimum. A flat price he gave wins. */
function priceOf(plan, rates) {
  const r = cleanRates(rates);
  const tasks = A(plan && plan.tasks);
  let labor = 0, matCost = 0, hours = 0;
  tasks.forEach((t) => { const h = N(t.hours) * Math.max(1, N(t.workers) || 1); hours += h; labor += h * r.hourly; matCost += N(t.materialCost); });
  const materials = matCost * (1 + r.materialMarkupPct / 100);
  const computed = Math.max(r.minimumCharge, Math.ceil((labor + materials) / 5) * 5);
  const flat = N(plan && plan.flatPrice);
  return {
    laborHours: Math.round(hours * 10) / 10,
    labor: Math.round(labor),
    materialCost: Math.round(matCost),
    materials: Math.round(materials),
    computed,
    total: flat > 0 ? flat : computed,
    flat: flat > 0,
    minimumApplied: !(flat > 0) && computed === r.minimumCharge && labor + materials < r.minimumCharge,
    profit: Math.round((flat > 0 ? flat : computed) - matCost),
  };
}

/* The model's plan, cleaned. Returns null when there is no usable plan, so a
   bad answer never wipes a good plan. */
function validate(o, prev, rates) {
  const p = o && o.plan && typeof o.plan === "object" ? o.plan : null;
  if (!p) return null;
  const tasks = A(p.tasks).map((t) => ({
    task: C(t && t.task, 200),
    hours: Math.min(80, N(t && t.hours)),
    workers: Math.min(4, Math.max(1, Math.round(N(t && t.workers)) || 1)),
    materialCost: Math.min(20000, N(t && t.materialCost)),
    note: C(t && t.note, 160),
  })).filter((t) => t.task && (t.hours > 0 || t.materialCost > 0)).slice(0, 15);
  if (!tasks.length) return null;
  const cu = p.customer && typeof p.customer === "object" ? p.customer : {};
  const flat = p.flatPrice === undefined && prev ? prev.flatPrice : (N(p.flatPrice) || null);
  const conf = /^(high|medium|low)$/i.test(C(p.confidence, 10)) ? C(p.confidence, 10).toLowerCase() : "medium";
  const plan = {
    title: C(p.title, 120) || (prev && prev.title) || "Handyman visit",
    tasks,
    flatPrice: flat,
    visitHours: C(p.visitHours, 40),
    deposit: Math.min(5000, N(p.deposit)),
    tools: list(p.tools, 10, 120),
    materials: list(p.materials, 8, 160),
    warnings: list(p.warnings, 3, 160),
    askCustomer: list(p.askCustomer, 2, 140),
    customer: {
      scope: clean(cu.scope),
      steps: list(cu.steps, 8, 200).map(clean),
      ready: list(cu.ready, 6, 200).map(clean),
      notIncluded: list(cu.notIncluded, 6, 200).map(clean),
    },
    crew: (function () { const cr = p.crew && typeof p.crew === "object" ? p.crew : (prev && prev.crew) || {};
      return { jobType: C(cr.jobType, 120), explain: C(cr.explain, 1200),
        steps: A(cr.steps).map((x) => ({ step: C(x && x.step, 160), how: C(x && x.how, 500) })).filter((x) => x.step).slice(0, 15),
        checks: list(cr.checks, 10, 200) }; })(),
    confidence: conf,
    confidenceWhy: C(p.confidenceWhy, 200),
  };
  plan.price = priceOf(plan, rates);
  return plan;
}

/* The JSON object in a model answer, even if wrapped in prose or fences. */
function parse(text) {
  const t = String(text || "");
  const f = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  for (const c of [f ? f[1] : "", t, t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)]) {
    try { const j = JSON.parse(String(c || "").trim()); if (j && typeof j === "object") return j; } catch (_) {}
  }
  return null;
}

/* What the Send screen is filled with: one firm price, the scope, and the
   "please have ready" list as the special notes. */
function sendFields(plan) {
  const p = plan || {};
  const cu = p.customer || {};
  const lines = [];
  if (A(cu.steps).length) lines.push("What we will do:\n" + cu.steps.map((s) => "- " + s).join("\n"));
  const scope = [C(cu.scope, 1500)].concat(lines).filter(Boolean).join("\n\n");
  const notes = []
    .concat(A(cu.ready).length ? ["Please have ready: " + cu.ready.join("; ") + "."] : [])
    .concat(A(cu.notIncluded).length ? ["Not included: " + cu.notIncluded.join("; ") + "."] : [])
    .join("\n");
  return { pricingMode: "fixed", fixedPrice: (p.price && p.price.total) || 0, durationText: C(p.visitHours, 40), scopeSummary: scope, specialNotes: notes, deposit: N(p.deposit) };
}

module.exports = { prompt, validate, priceOf, parse, sendFields, cleanRates, DEFAULT_RATES, jobOf };
