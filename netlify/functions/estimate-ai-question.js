// netlify/functions/estimate-ai-question.js  (v2 - Jul 27 2026)
// AI reads the customer's own description FIRST, then asks only the follow-ups
// that are actually still missing for an accurate estimate.
// Returns JSON describing the question to display (label, type, options).

const https = require("https");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);
    const { service, serviceLabel, answers, questionCount, serviceCount, description, photoCount } = body;
    const askedLabels = Array.isArray(body.askedLabels) ? body.askedLabels.filter(Boolean).map(String) : [];
    const svcN = Math.max(1, Math.min(parseInt(serviceCount) || 1, 5));

    if (!service) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "Missing service" }),
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

    // Decide if we should keep asking or stop
    // Min 2 questions, max 5 questions per service
    // The customer has already written a description, so keep follow-ups short.
    // A detailed description should end the flow almost immediately.
    const desc = String(description || "").trim();
    const minQs = 0;                                 // a complete description can need nothing
    // The form ends with a dedicated "what are you supplying?" step, so the AI
    // follow-ups are deliberately short. Typing and tapping is what makes people quit.
    const maxQs = Math.min(1 + svcN, 3);             // 1 svc: 2 · 2 svc: 3 · cap 3
    const askedCount = questionCount || 0;

    // HARD STOP. The prompt used to be the only thing holding the limit and the model
    // simply asked more anyway. Enforce it here, before spending an API call.
    if (askedCount >= maxQs) {
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ done: true }) };
    }

    // One question per trade, per session. The model kept rewording the same question
    // ("what flooring is installed" then "what's on the floors being replaced") and
    // burning slots on a topic it had already covered.
    const coveredTopics = topicsIn(askedLabels.join(" "));

    const answersStr = Object.entries(answers || {})
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");

    const prompt = `You are a contractor's intake assistant for Sani Building Corp in NYC. The customer has ALREADY described their project in their own words. Read it carefully, then ask ONE short follow-up question - but only about something genuinely missing that is needed to price the job.

BEFORE YOU WRITE ANYTHING, CHECK YOUR QUESTION AGAINST THIS LIST. If it falls into any of these, you MUST return {"done": true} instead. These are not preferences, they are hard bans:
1. WHO SUPPLIES THE MATERIALS. Never ask it. Not "who is supplying the tile", not "are you providing the fixtures", not "which fixtures are you supplying", not any wording of it. The form has a dedicated final step that collects this properly. Asking here duplicates it and wastes the customer's patience.
2. QUALITY LEVEL, GRADE OR TIER. Never ask budget vs mid-range vs high-end vs luxury, or "what quality fixtures". Everyone says high-end and it tells us nothing. Assume mid-range; the contractor adjusts.
3. BRAND, COLOUR OR PAINT FINISH. Never ask which sheen (matte, eggshell, satin, semi-gloss) or which colour or brand. They all cost the same to buy and the same to apply. That is a conversation after they become a lead.
4. ANYTHING THE CUSTOMER ALREADY ANSWERED, in their description or in earlier answers.
5. WHETHER INSTALLATION OR LABOUR IS NEEDED. Never ask it. Installation is always included — that is the whole job. A customer supplying their own vanity, tile or flooring still needs it installed; supplying an item removes the MATERIAL cost, never the LABOUR. Asking invites them to decline work they actually want.
Asking a banned question loses the customer. Returning done:true never does.

SERVICE SELECTED: ${serviceLabel || service}

THE CUSTOMER'S OWN DESCRIPTION:
"""
${desc || "(they did not write one)"}
"""

PHOTOS/FILES ATTACHED: ${photoCount || 0}

FOLLOW-UP ANSWERS SO FAR:
${answersStr || "(none yet)"}

QUESTIONS ALREADY ASKED: ${askedCount}
EXACT QUESTIONS YOU HAVE ALREADY ASKED (never ask about any of these subjects again, however you reword it):
${askedLabels.length ? askedLabels.map((l) => "- " + l).join("\n") : "(none yet)"}
TRADES ALREADY COVERED: ${coveredTopics.join(", ") || "(none yet)"}
MAXIMUM ALLOWED: ${maxQs}

READ THE DESCRIPTION FIRST. If it already tells you the scope, size, location and condition, return {"done": true} immediately - do not ask filler questions. Never ask for something the customer already wrote. The customer selected ${svcN} service(s): ${serviceLabel}.

Return ONLY valid JSON, no markdown, no backticks, no explanation. Use this exact structure:

If the description already covers what you need, OR you have asked ${maxQs} questions, return:
{"done": true}

Otherwise return next question:
{
  "done": false,
  "questionId": "shortName",
  "label": "Short question text (max 60 chars)",
  "type": "options-stack" | "options-grid" | "text",
  "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
  "placeholder": "Only for type=text — hint text"
}

RULES:
- "options-stack" = 3-5 options, full width buttons (use for descriptive options)
- "options-grid" = 2-4 short options, 2-column grid (use for short choices)
- "text" = free-text input (use only when truly necessary, like "approximate area" or "describe other")
- Options array empty/omitted if type=text
- NO "replace fixtures" question for bathroom
- NO "tools" question for handyman
- NEVER ask about quality level, grade, tier or finish level (e.g. "budget vs mid-range vs high-end", "what quality fixtures", "standard or premium"). Everyone answers "high-end" and it tells us nothing. Price mid-range by default and let the contractor adjust.
- NEVER ask which brand, colour, style or finish they want. That is a conversation for after they are a lead, not a reason to lose them on a form.
- NEVER ask who is supplying the materials, or whether they are providing anything themselves. A dedicated final step already collects that. Asking it here duplicates that step.
- If the customer has already said they are supplying an item, do NOT ask any question about that item (its grade, brand, size or type). They are buying it — it is not ours to specify.
- For Stair service: include noise fix as a sub-option, not separate service
- Prioritise the gaps that most affect price: approximate size/area, how many rooms or units, current condition, building type and access, whether the space is occupied or in use, and any deadline
- THE TEST for every question: does the answer change the PRICE by real money, and is there no other way to get it? If not, do not ask it — return done:true instead. A shorter form wins more work than a perfectly specified one.
- For commercial jobs also consider: after-hours or overnight access, and whether a certificate of insurance is required
- NEVER ask anything the description already answers
- If photos were attached, do not ask them to describe what a photo would obviously show
- Prefer tappable options over free text - typing is what makes people quit
- ALWAYS done:true after ${maxQs} questions

Now respond with the single most useful missing question, or done:true.`;

    const requestData = JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 500,
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
          timeout: 15000,
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
        reject(new Error("Timeout"));
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
    if (!jsonMatch) throw new Error("No JSON in response");

    const question = JSON.parse(jsonMatch[0]);

    // The prompt asks the model not to raise banned topics. It sometimes does anyway,
    // so this is the backstop: anything matching gets dropped and the flow moves on.
    // Ending the questions early is always safer than asking a question that loses a lead.
    if (!question.done && isBannedQuestion(question)) {
      console.log("Blocked banned intake question:", question.label);
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ done: true }) };
    }

    // Same trade twice = a reworded duplicate. Two answers about one thing is worse
    // than no answer, because the contractor cannot tell which one is true.
    if (!question.done) {
      const newTopics = topicsIn(String(question.label || "") + " " + (Array.isArray(question.options) ? question.options.join(" ") : ""));
      if (newTopics.some((t) => coveredTopics.indexOf(t) !== -1)) {
        console.log("Blocked duplicate-topic question:", question.label);
        return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ done: true }) };
      }
    }

    // Tag the question with its trade so the form can show "BATHROOM" / "PAINTING"
    // above it, and so the answer is filed under the right trade later.
    if (!question.done) {
      const mine = topicsIn(
        String(question.label || "") + " " +
        (Array.isArray(question.options) ? question.options.join(" ") : "")
      );
      // A generic question (size, access, occupancy) has no trade. On a single-service
      // request fall back to that service so the header is never blank.
      const single = svcN === 1 ? String(serviceLabel || "").trim() : "";
      question.topic = mine[0] || "";
      question.topicLabel = (mine[0] && TOPIC_LABELS[mine[0]]) || single || "Project Details";
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify(question),
    };
  } catch (err) {
    console.error("AI question error:", err.message);
    // Fallback: skip AI questions, continue to next step
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ done: true, fallback: true, error: err.message }),
    };
  }
};

// Topics the intake form must never ask about. Checked against the question text AND
// its options, because the label can look innocent while the options are all grade tiers.
// Deliberately NOT banned: material type (vinyl vs fibreglass vs wood), size, quantity,
// condition and access — those move the price by real money.
const BANNED_PATTERNS = [
  /\bsuppl(y|ies|ying|ied|ier)\b/i,                                  // who supplies / are you supplying
  /\bwho\s+(is|will|are|would)\b[\s\S]{0,40}\b(provid|bring|buy|purchas)/i,
  /\bare you (providing|purchasing|buying)\b/i,
  /\b(quality|grade|tier)\b/i,                                       // quality level questions
  /\b(budget[\s-]?friendly|mid[\s-]?range|high[\s-]?end|premium|luxury|designer)\b/i,
  /\bbrand\b/i,
  /\bcolou?r\b/i,
  /\bpaint\s+(finish|sheen)\b/i,                                    // matte vs eggshell: same price
  /\b(matte|eggshell|satin|semi[\s-]?gloss|sheen)\b/i,
  // "Does the vanity need installation labor?" — installation is ALWAYS included.
  // A customer supplying an item never removes our labor, and offering them the choice
  // can only delete real money from the quote.
  /\binstall(ation)?\s+(labor|labour)\b/i,
  /\bpre-?installed\b/i,
  /\bneeds?\s+(installation|installing|to be installed)\b/i,
  /\bneed us to install\b/i,
  /\b(labor|labour)\s+(needed|required)\b/i,
];

// Trade topics. Generic questions (size, access, occupancy, deadline) are intentionally
// absent — those are fine to ask alongside a trade question.
const TOPIC_PATTERNS = [
  { key: "flooring",  re: /\b(floor|flooring|floors|hardwood|laminate|subfloor|carpet|underlayment)\b/i },
  { key: "windows",   re: /\b(window|windows|sash|glazing)\b/i },
  { key: "painting",  re: /\b(paint|painting|primer|priming)\b/i },
  { key: "tile",      re: /\b(tile|tiles|grout|backsplash)\b/i },
  { key: "bathroom",  re: /\b(bathroom|shower|bathtub|tub|vanity|toilet)\b/i },
  { key: "kitchen",   re: /\b(kitchen|cabinet|cabinets|countertop)\b/i },
  { key: "doors",     re: /\b(door|doors)\b/i },
  { key: "electrical",re: /\b(electric|electrical|outlet|wiring)\b/i },
  { key: "plumbing",  re: /\b(plumb|plumbing|pipe|drain)\b/i },
  { key: "deck",      re: /\b(deck|decking|railing)\b/i },
  { key: "stairs",    re: /\b(stair|stairs|tread|riser)\b/i },
];

// Shown to the customer at the top of the question card, and stored against their
// answer so the estimator knows which trade each answer belongs to.
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
};

function topicsIn(text) {
  const t = String(text || "");
  return TOPIC_PATTERNS.filter((p) => p.re.test(t)).map((p) => p.key);
}

function isBannedQuestion(q) {
  const hay = [
    String((q && q.label) || ""),
    String((q && q.questionId) || ""),
    Array.isArray(q && q.options) ? q.options.join(" ") : "",
  ].join(" ");
  return BANNED_PATTERNS.some((re) => re.test(hay));
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
