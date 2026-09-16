// netlify/functions/assistant.js
//
// THE CONTRACTOR'S OWN ASSISTANT, SITTING ON THE REQUEST HE IS LOOKING AT.
//
//   "sometimes the customers description is very low and need ask questions for
//    clarification and collect more information ... a personal AI assistance
//    where i can chat with him and where he can help me with anything"
//
// A contact-form lead arrives with whatever the customer felt like typing.
// "something for test" is a real example. The estimate form at least asks its
// follow-up questions; the contact form asks nothing. Pressing Generate on a
// two-word description produces an estimate built almost entirely of
// assumptions, and the contractor finds that out after it is written.
//
// This answers the question he actually has at that moment - what do I still
// need to know before I can price this - and then anything else he wants to ask.
//
// IT NEVER SENDS ANYTHING TO THE CUSTOMER. It returns text. The dashboard drops
// that text into the conversation box that already exists, and he presses Send
// himself after reading it. Every word that reaches a customer still passes
// under his eye first, which is the whole point of the panel he asked for.
//
// CONTRACTOR ONLY. POST with header  x-sbc-key: <DASHBOARD_KEY>.
// This spends money on every call. An open endpoint that bills the owner per
// request is worse than an open endpoint that merely leaks - it can be run in a
// loop by anyone who finds the URL.
//
// TEN SECONDS. Netlify kills a synchronous function at 10s with no useful error.
// A chat turn has to come back well inside that, so: Sonnet rather than Opus, a
// hard cap on output, a trimmed context, and an explicit 8.5s abort that returns
// a readable message instead of letting the platform kill it silently.

const https = require("https");
const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 1100;
const ABORT_MS = 8500;

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: "ANTHROPIC_API_KEY is not set in Netlify." });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Unreadable request" }); }

  /* The conversation so far, oldest first. Trimmed to the last 12 turns: this is
     a working assistant beside one job, not an archive, and every extra turn is
     time against a 10s ceiling. */
  const turns = arr(body.messages)
    .map(function (m) {
      return { role: m && m.role === "assistant" ? "assistant" : "user", text: str(m && m.text) };
    })
    .filter(function (m) { return m.text; })
    .slice(-12);

  if (!turns.length) return json(400, { error: "Nothing to answer" });

  let context = "";
  if (str(body.ref)) {
    try { context = await recordContext(str(body.ref)); }
    catch (e) { context = ""; }   /* a chat without the record still works */
  }

  try {
    const reply = await callClaude(apiKey, systemPrompt(context), turns);
    if (!reply) return json(502, { error: "The assistant returned nothing. Try again." });
    return json(200, { reply: reply });
  } catch (err) {
    console.error("assistant error:", err && err.message);
    return json(502, { error: str(err && err.message) || "The assistant could not be reached" });
  }
};

/* ── WHAT THE ASSISTANT IS TOLD ABOUT THE JOB ─────────────────────────────
   Deliberately not the whole record. The internal notes, the markup and the
   contractor's cost lines are not sent: this is for working out what to ask a
   customer, and a model that has been handed the internal price band tends to
   start reasoning about it in answers meant to be read aloud to that customer. */
async function recordContext(ref) {
  const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
  const rec = await store.get(ref, { type: "json" });
  if (!rec) return "";

  const req = rec.request || {}, cust = rec.customer || {}, est = rec.estimate || {};
  const answers = req.serviceAnswers || {};
  const answerLines = Object.keys(answers)
    .filter(function (k) { return str(answers[k]); })
    .map(function (k) { return "  - " + k.replace(/-/g, " ") + ": " + str(answers[k]); });

  const thread = arr(rec.thread).slice(-8).map(function (m) {
    return "  " + (m && m.from === "contractor" ? "Sani" : "Customer") + ": " + str(m && m.text);
  });

  return [
    "THE JOB ON SCREEN",
    "Reference: " + str(rec.ref),
    "Status: " + str(rec.status),
    "Came from: " + (str(rec.source) === "contact-form" ? "the contact form (no follow-up questions were asked)" : "the estimate form"),
    "Customer: " + str(cust.name),
    "Address: " + (str(cust.address) || "not given"),
    "Service asked for: " + (str(req.service) || "not given"),
    "Photos attached: " + (arr(req.photos).length || 0),
    "",
    "WHAT THE CUSTOMER WROTE:",
    str(req.description) || "(nothing)",
    answerLines.length ? "\nANSWERS THEY ALREADY GAVE:\n" + answerLines.join("\n") : "",
    thread.length ? "\nMESSAGES SO FAR:\n" + thread.join("\n") : "",
    str(est.scopeOfWork) ? "\nSCOPE DRAFTED SO FAR:\n" + str(est.scopeOfWork).slice(0, 1200) : "",
  ].filter(Boolean).join("\n");
}

function systemPrompt(context) {
  return [
    "You are the assistant to Zurab, who runs Sani Building Corp, a renovation and repair contractor in Brooklyn serving the five NYC boroughs and Long Island.",
    "You are open inside his own dashboard, beside a customer request he is deciding how to price.",
    "",
    "HOW TO ANSWER HIM:",
    "- Short. He is reading this on a phone between jobs. No preamble, no summary of what he just asked.",
    "- Plain English. He speaks English as a second language; keep sentences simple and never use jargon where a common word works.",
    "- Concrete. A number, a question to ask, a next step. Not a list of considerations.",
    "- If he asks for questions to send a customer, give them as a short numbered list, written the way a homeowner would be asked, not the way a contractor talks to another contractor. Ask only what changes the price, the scope, the schedule or the risk. Never more than six.",
    "- Include 'Not sure' as an acceptable answer wherever a customer plausibly would not know, and say so in the question. Many of his customers genuinely do not know their floor construction or what is behind a wall.",
    "- If he asks something unrelated to the job on screen, just answer it. He asked for an assistant, not an estimate tool.",
    "",
    "WHAT YOU MUST NOT DO:",
    "- Never use the word 'licensed' or make any claim about licensing. Say 'fully insured' if insurance comes up.",
    "- Never mention TV mounting as a service.",
    "- Never invent a price, a rate or a total. He has a pricing system and it is not you. If he asks what something costs, say what the price depends on and what to measure, or tell him to run the estimator.",
    "- Never write as if you are the customer or draft something that pretends to be from them.",
    "- Do not tell him to go and look at the dashboard. He is in it.",
    "",
    context ? context : "No job is open. Answer whatever he asks.",
  ].join("\n");
}

function callClaude(apiKey, system, turns) {
  const payload = JSON.stringify({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: system,
    messages: turns.map(function (t) { return { role: t.role, content: t.text }; }),
  });

  return new Promise(function (resolve, reject) {
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
      function (res) {
        const chunks = [];
        res.on("data", function (c) { chunks.push(c); });
        res.on("end", function () {
          const raw = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode < 200 || res.statusCode >= 300) {
            let msg = "Claude returned " + res.statusCode;
            try { const j = JSON.parse(raw); if (j && j.error && j.error.message) msg = j.error.message; } catch (e) {}
            return reject(new Error(msg));
          }
          try {
            const j = JSON.parse(raw);
            const text = arr(j.content)
              .filter(function (b) { return b && b.type === "text"; })
              .map(function (b) { return b.text; })
              .join("")
              .trim();
            resolve(text);
          } catch (e) {
            reject(new Error("Could not read the reply"));
          }
        });
      }
    );

    /* Netlify kills this at 10s without a usable error. Give up first, and say
       something he can act on. */
    req.setTimeout(ABORT_MS, function () {
      req.destroy(new Error("The assistant took too long. Ask again, or ask something shorter."));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function str(v) { return String(v == null ? "" : v).trim(); }
function arr(v) { return Array.isArray(v) ? v : []; }
function json(code, obj) { return { statusCode: code, headers: cors(), body: JSON.stringify(obj) }; }
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-sbc-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}
