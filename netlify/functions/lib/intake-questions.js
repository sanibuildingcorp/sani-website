// netlify/functions/lib/intake-questions.js
//
// The rules for the questions the customer is asked WHILE FILLING IN THE FORM.
//
// Why this file exists: a customer describes their job in plain words — "my
// bathroom is falling apart", "there's water coming through the ceiling". That
// is never enough to price. The missing facts have to be collected before the
// request lands in the dashboard, because after that the only way to get them is
// a phone call, and most people never pick up.
//
// Two things live here, and they live here TOGETHER on purpose:
//   1. the prompt that plans the questions, and
//   2. the code that enforces the rules the prompt asks for.
// The prompt is a request. The code is the rule. Everything that must always be
// true — no banned topics, no two questions about one trade, never more than the
// cap, always an escape hatch — is enforced below in code, after the model has
// answered, so a model that ignores an instruction cannot break the form.

/* Topics the intake form must never raise. Checked against the question text,
   its id, its stated reason AND its options — a label can look innocent while
   every option is a price tier. */
const BANNED_PATTERNS = [
  /\bsuppl(y|ies|ying|ied|ier)\b/i,                                  // who supplies / are you supplying
  /\bwho\s+(is|will|are|would)\b[\s\S]{0,40}\b(provid|bring|buy|purchas)/i,
  /\bare you (providing|purchasing|buying)\b/i,
  /\b(quality|grade|tier)\b/i,                                       // everyone answers "high-end"
  /\b(budget[\s-]?friendly|mid[\s-]?range|high[\s-]?end|premium|luxury|designer)\b/i,
  /\bbrand\b/i,
  /\bcolou?r\b/i,
  /\bpaint\s+(finish|sheen)\b/i,
  /\b(matte|eggshell|satin|semi[\s-]?gloss|sheen)\b/i,
  // Installation is ALWAYS included. A customer supplying their own vanity still
  // needs it fitted; offering them the choice can only delete real money.
  /\binstall(ation)?\s+(labor|labour)\b/i,
  /\bpre-?installed\b/i,
  /\bneeds?\s+(installation|installing|to be installed)\b/i,
  /\bneed us to install\b/i,
  /\b(labor|labour)\s+(needed|required)\b/i,
  // Never ask a customer what their budget is. It anchors the estimate to their
  // number instead of to the work, and it is the fastest way to lose trust.
  /\byour\s+budget\b/i,
  /\bhow much (are you|do you want to|would you like to)\s+(spend|invest)\b/i,
  /\bprice\s+range\b/i,
];

/* Trade topics. Generic subjects (size, access, occupancy, deadline) are
   deliberately absent — those are fine to ask alongside a trade question. */
const TOPIC_PATTERNS = [
  { key: "flooring",   re: /\b(floor|flooring|floors|hardwood|laminate|subfloor|carpet|underlayment|vinyl plank)\b/i },
  { key: "windows",    re: /\b(window|windows|sash|glazing)\b/i },
  { key: "painting",   re: /\b(paint|painting|primer|priming|skim ?coat)\b/i },
  { key: "tile",       re: /\b(tile|tiles|grout|backsplash)\b/i },
  { key: "bathroom",   re: /\b(bathroom|shower|bathtub|tub|vanity|toilet)\b/i },
  { key: "kitchen",    re: /\b(kitchen|cabinet|cabinets|countertop)\b/i },
  { key: "doors",      re: /\b(door|doors)\b/i },
  { key: "electrical", re: /\b(electric|electrical|outlet|wiring|panel)\b/i },
  { key: "plumbing",   re: /\b(plumb|plumbing|pipe|drain|radiator)\b/i },
  { key: "deck",       re: /\b(deck|decking|railing)\b/i },
  { key: "stairs",     re: /\b(stair|stairs|tread|riser)\b/i },
  { key: "water",      re: /\b(leak|leaking|water damage|flood|mold|mould|damp)\b/i },
  { key: "demolition", re: /\b(demo|demolition|tear ?out|gut)\b/i },
];

/* Shown to the customer above the question, and stored against their answer so
   the estimator knows which trade each answer belongs to. */
const TOPIC_LABELS = {
  flooring: "Flooring",
  windows: "Windows",
  painting: "Painting",
  tile: "Tile",
  bathroom: "Bathroom",
  kitchen: "Kitchen",
  doors: "Doors",
  electrical: "Electrical",
  plumbing: "Plumbing",
  deck: "Deck",
  stairs: "Stairs",
  water: "Water Damage",
  demolition: "Demolition",
};

/* The escape hatch. Appended in code to every multiple-choice question, always,
   so nobody is ever forced to invent an answer. A guessed number is worse than
   no number: it looks like a fact and it prices like one. */
const NOT_SURE = "I'm not sure";

/* Questions that belong to no trade at all. These have to be recognised FIRST,
   because their wording collides with real trades: "which floor is the unit on"
   is about carrying material up four flights, not about flooring, and letting it
   claim the flooring slot means the actual flooring question gets dropped as a
   duplicate. Access, occupancy and scheduling are project-wide - two of them in
   one form is fine. */
const GENERIC_PATTERNS = [
  /\bwhich floor\b|\bwhat floor\b|\bfloor is (the|it|your)\b/i,
  /\bwalk[- ]?up\b|\belevator\b|\bflight of stairs\b|\bhow many flights\b/i,
  /\blive|living|occupied|vacant|empty\b.{0,30}\b(during|while|there)\b/i,
  /\bpark(ing)?\b|\bstreet access\b|\bloading\b/i,
  /\bdeadline\b|\bwhen do you\b|\btimeline\b|\bhow soon\b/i,
  /\bcertificate of insurance\b|\bboard approval\b|\bbuilding (rules|management)\b/i,
];

function isGenericSubject(text) {
  const t = String(text || "");
  return GENERIC_PATTERNS.some((re) => re.test(t));
}

function topicsIn(text) {
  const t = String(text || "");
  if (isGenericSubject(t)) return [];
  return TOPIC_PATTERNS.filter((p) => p.re.test(t)).map((p) => p.key);
}

function questionHaystack(q) {
  return [
    String((q && q.label) || ""),
    String((q && q.questionId) || ""),
    String((q && q.why) || ""),
    String((q && q.placeholder) || ""),
    Array.isArray(q && q.options) ? q.options.join(" ") : "",
  ].join(" ");
}

function isBannedQuestion(q) {
  const hay = questionHaystack(q);
  return BANNED_PATTERNS.some((re) => re.test(hay));
}

/* How many questions this request is allowed to ask. More services means more
   genuinely unknown facts, but a form nobody finishes prices nothing at all. */
function maxQuestions(serviceCount) {
  const n = Math.max(1, Math.min(parseInt(serviceCount, 10) || 1, 5));
  return Math.min(2 + n, 4);
}

/* Everything the pricing engine actually needs, by trade. This is the list the
   planner is graded against — it is the difference between "tell me more about
   your bathroom" and "how many square feet of floor tile". */
const PRICE_DRIVERS = [
  "AREA OR COUNT — square feet, number of rooms, number of doors/windows/fixtures. Nothing prices without a quantity.",
  "CONDITION AND PREP — is the surface sound, cracked, peeling, water-stained, previously repaired. Prep is often more hours than the finish work.",
  "DEMOLITION AND DISPOSAL — is there an existing finish to remove, and how many layers. Removal and debris haul-away are separate real costs.",
  "ACCESS — which floor, is there an elevator, is it a walk-up, can a van park. Carrying material up four flights is a whole extra day.",
  "OCCUPIED OR EMPTY — furniture to move and protect, work in stages, evenings or weekends only.",
  "CEILING HEIGHT for painting or wall work — anything over 9 feet needs staging.",
  "BUILDING RULES for apartments and co-ops — board approval, certificate of insurance, restricted work hours.",
  "FOR WATER DAMAGE — is the leak stopped or still active, how large is the stained/soft area, is there mold visible, has anything gone soft or spongy.",
  "FOR BATHROOMS AND KITCHENS — is the layout staying put or are fixtures moving. Moving a drain or a stack is the single biggest cost swing in the trade.",
  "FOR FLOORING — what is on the floor now and what is under it, and does it come out or stay.",
  "STRUCTURAL OR SYSTEM WORK — walls removed, electrical panel, gas, or plumbing stack. These need a permit and a licensed sub, and change the price by thousands.",
];

function planPrompt(input) {
  const svcN = Math.max(1, Math.min(parseInt(input.serviceCount, 10) || 1, 5));
  const cap = maxQuestions(svcN);
  const desc = String(input.description || "").trim();
  const photoNotes = Array.isArray(input.photoNotes)
    ? input.photoNotes.filter(Boolean).map(String).slice(0, 8)
    : [];

  return `You are the intake estimator for Sani Building Corp, a general contractor in Brooklyn, New York. A customer is filling in the estimate form right now and is waiting on this screen.

They have just written what they need in their own words. They are not a builder. They describe problems ("the ceiling is stained", "the bathroom is old"), not scopes of work. Your job is to work out what an estimator would still have to know to put a real number on this job, and to ask for exactly that — nothing else.

WHAT THEY SELECTED: ${input.serviceLabel || input.service || "(not stated)"}
PROPERTY TYPE: ${input.propertyType || "(not stated)"}
PHOTOS ATTACHED: ${input.photoCount || 0}${input.photoCount ? "\nThe photos are above this message. LOOK AT THEM FIRST. Anything you can see - the size of the room, what is on the floor, how bad the damage is, whether the tile is cracked - is already answered. Do not spend a question on it." : ""}
${photoNotes.length ? "WHAT THE PHOTOS SHOW:\n" + photoNotes.map((n) => "- " + n).join("\n") + "\n" : ""}
WHAT THEY WROTE:
"""
${desc || "(they did not write anything)"}
"""

WHAT MOVES THE PRICE — go through this list and find what is still missing for THIS job:
${PRICE_DRIVERS.map((d, i) => `${i + 1}. ${d}`).join("\n")}

HOW TO CHOOSE THE QUESTIONS
- Rank every gap by how much money the answer moves. Ask the biggest first.
- A gap the description already fills is not a gap. Read it properly before you ask.
- If they wrote a full, specific description, return an empty list. That is a good outcome, not a failure.
- Never ask two questions about the same trade. One question per trade, at most.
- Ask at most ${cap} questions in total.
- Every question must be answerable in one tap by someone standing in their kitchen. Offer choices. Use free text only when a number is the answer and no set of ranges would do.
- Write like a person, not a form. "How big is the bathroom, roughly?" not "Please specify approximate square footage."

HARD BANS. A question that breaks one of these is deleted before the customer sees it, so writing one just wastes a slot:
1. WHO SUPPLIES THE MATERIALS. Never, in any wording. The form has a dedicated final step for it.
2. QUALITY, GRADE, TIER, BUDGET vs HIGH-END. Everyone says high-end. It tells us nothing.
3. BRAND, COLOUR, STYLE, PAINT SHEEN. Same cost to buy, same cost to apply. That is a conversation after they are a customer.
4. THE CUSTOMER'S BUDGET or what they want to spend. We price the work, not their wallet.
5. WHETHER THEY NEED IT INSTALLED. Installation is always included — it is the job.
6. ANYTHING THEY ALREADY ANSWERED in their description.

Return ONLY valid JSON. No markdown, no backticks, no explanation before or after.

{
  "readAs": "one sentence, plain English, saying what you understand they want done",
  "questions": [
    {
      "questionId": "shortLowerCamelName",
      "label": "The question, max 70 characters",
      "why": "max 70 characters, plain English, why this changes the price",
      "topic": "flooring|windows|painting|tile|bathroom|kitchen|doors|electrical|plumbing|deck|stairs|water|demolition|general",
      "type": "options-stack" | "options-grid" | "text",
      "options": ["...", "...", "..."],
      "placeholder": "only when type is text"
    }
  ]
}

- "options-stack": 3-5 choices, full-width buttons. Use for descriptive choices.
- "options-grid": 2-4 short choices, two columns. Use for short choices.
- "text": free text. Use only when a number or a name is the only possible answer.
- Ranges beat exact numbers. "Under 50 sq ft / 50-100 / 100-200 / bigger" gets answered; "how many square feet" gets abandoned.
- Do not add an "I'm not sure" option. One is added for you.

Return the questions now, hardest-hitting first, or an empty list if the description already says enough.`;
}

/* Turn whatever the model returned into questions the form can render, and drop
   anything that breaks a rule. Order is deliberate: shape first, then bans, then
   one-per-trade, then the cap. */
function normalizeQuestions(raw, input) {
  const cap = maxQuestions(input && input.serviceCount);
  const single = (parseInt((input && input.serviceCount) || 1, 10) || 1) === 1
    ? String((input && input.serviceLabel) || "").trim()
    : "";
  const list = Array.isArray(raw && raw.questions) ? raw.questions : [];
  const out = [];
  const usedTopics = [];
  const usedIds = {};

  for (const q of list) {
    if (!q || typeof q !== "object") continue;

    const label = String(q.label || "").trim();
    if (!label) continue;

    let type = String(q.type || "").trim();
    if (type !== "text" && type !== "options-grid" && type !== "options-stack") type = "options-stack";

    let options = Array.isArray(q.options)
      ? q.options.map((o) => String(o == null ? "" : o).trim()).filter(Boolean).slice(0, 5)
      : [];
    // A choice question with fewer than two choices is not a choice question.
    if (type !== "text" && options.length < 2) type = "text";
    if (type === "text") options = [];

    const item = {
      questionId: slugId(q.questionId, label, usedIds),
      label: label.slice(0, 90),
      why: String(q.why || "").trim().slice(0, 90),
      type: type,
      options: options,
      placeholder: String(q.placeholder || "").trim().slice(0, 60),
    };

    if (isBannedQuestion(item)) continue;

    // One question per trade. Two answers about one thing is worse than none,
    // because nobody can tell which one is true.
    const stated = String(q.topic || "").trim().toLowerCase();
    /* Read the label and the choices, never the reason. The reason names a trade
       in passing all the time - "area drives every tile line" is a size question,
       not a tile question - and filing on that wording puts the answer under the
       wrong service and burns that service's only slot. */
    const found = topicsIn(item.label + " " + item.options.join(" "));
    const topic = (TOPIC_LABELS[stated] ? stated : "") || found[0] || "";
    if (topic && usedTopics.indexOf(topic) !== -1) continue;
    if (topic) usedTopics.push(topic);

    item.topic = topic;
    item.topicLabel = (topic && TOPIC_LABELS[topic]) || single || "Project Details";

    // The escape hatch, added in code so it is on every choice question, always.
    if (item.type !== "text") item.options = item.options.concat([NOT_SURE]);

    out.push(item);
    if (out.length >= cap) break;
  }

  return out;
}

function slugId(raw, label, used) {
  let id = String(raw || "").trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!id) id = String(label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 4).join("-");
  if (!id) id = "q";
  id = id.slice(0, 40);
  let candidate = id, n = 2;
  while (used[candidate]) { candidate = id + "-" + n; n++; }
  used[candidate] = 1;
  return candidate;
}

module.exports = {
  BANNED_PATTERNS,
  TOPIC_PATTERNS,
  TOPIC_LABELS,
  PRICE_DRIVERS,
  NOT_SURE,
  topicsIn,
  isBannedQuestion,
  maxQuestions,
  planPrompt,
  normalizeQuestions,
};
