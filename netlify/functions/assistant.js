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
// hard cap on output, a trimmed context, and a deadline measured from the moment
// the handler starts.
//
// WHAT THE DEADLINE USED TO BE, AND WHY IT WAS NOT ENOUGH. The first version
// gave the Claude call a fixed 8.5s and waited for the whole answer. On a
// two-word "test request" the answer was short and came back in time. On a real
// record - a five-part apartment renovation with a long description and saved
// answers - "What should I ask them?" is a longer answer, and the clock ran out
// while it was still being written. Netlify killed the function, sent back a
// page that is not JSON, and Safari reported that as "The string did not match
// the expected pattern" - its own wording for res.json() failing. Twice, on two
// questions, in his screenshot. Nothing about the old record was unreadable; the
// answer was simply longer than the time.
//
// So the answer is now STREAMED from Claude and accumulated here. When the
// budget is nearly spent, whatever has arrived is returned as the reply, marked
// truncated, and the panel says so. A cut-short answer he can read beats a
// platform error he cannot.

const https = require("https");
const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 800;
/* Netlify's synchronous limit is 10,000ms. Everything - reading the record,
   the round trip to Claude, building the response - has to fit under this. */
const BUDGET_MS = 8800;
/* The record read is normally ~200ms. If Blobs is slow, answer without it
   rather than spend the budget waiting. */
const RECORD_MS = 2000;

/* The test harness shortens the budget so a stalled stream can be exercised in
   milliseconds rather than nine seconds. Production never calls this. */
let budgetMs = BUDGET_MS;
exports._setBudgetForTests = function (ms) { budgetMs = ms; };

exports.handler = async function (event) {
  const started = Date.now();
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
    try { context = await withTimeout(recordContext(str(body.ref)), RECORD_MS); }
    catch (e) { context = ""; }   /* a chat without the record still works */
  }

  try {
    const deadline = started + budgetMs;
    const out = await callClaude(apiKey, systemPrompt(context), turns, deadline);
    if (!out.text) return json(502, { error: "The assistant returned nothing. Try again." });
    return json(200, { reply: out.text, truncated: out.truncated === true });
  } catch (err) {
    console.error("assistant error:", err && err.message);
    return json(502, { error: str(err && err.message) || "The assistant could not be reached" });
  }
};

function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    const t = setTimeout(function () { reject(new Error("timed out")); }, ms);
    promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
  });
}

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
    const files = Array.isArray(m && m.attachments) ? m.attachments.map(function (f) { return str(f && f.name); }).filter(Boolean) : [];
    return "  " + (m && m.from === "contractor" ? "Sani" : "Customer") + ": " + str(m && m.text) + (files.length ? " [attached: " + files.join(", ") + "]" : "");
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
    "- Short. He is reading this on a phone between jobs. No preamble, no summary of what he just asked. Stay under about 150 words unless he asks for more; if there is more to say, end with one line offering it.",
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

/* Streams the answer and resolves { text, truncated }.
   - text_delta events are appended as they arrive.
   - At the deadline the socket is dropped and whatever has arrived is returned
     with truncated:true. If nothing has arrived yet, that is a real timeout.
   - A non-2xx status means the body is a JSON error, not a stream. */
function callClaude(apiKey, system, turns, deadline) {
  const payload = JSON.stringify({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    stream: true,
    system: system,
    messages: turns.map(function (t) { return { role: t.role, content: t.text }; }),
  });

  return new Promise(function (resolve, reject) {
    let text = "", done = false, timer = null, pending = "";
    const finish = function (truncated) {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (!text.trim() && truncated) {
        return reject(new Error("The assistant took too long. Ask again, or ask something shorter."));
      }
      resolve({ text: text.trim(), truncated: truncated === true });
    };
    const fail = function (err) {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      reject(err);
    };

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
          "Accept": "text/event-stream",
        },
      },
      function (res) {
        const errorStatus = res.statusCode < 200 || res.statusCode >= 300;
        const chunks = [];
        res.on("data", function (c) {
          if (errorStatus) { chunks.push(c); return; }
          pending += c.toString("utf8");
          /* SSE: frames are separated by a blank line; each has "data: {json}". */
          let cut;
          while ((cut = pending.indexOf("\n\n")) !== -1) {
            const frame = pending.slice(0, cut);
            pending = pending.slice(cut + 2);
            const ev = parseFrame(frame);
            if (!ev) continue;
            if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") {
              /* Appended raw. A delta is often a single space or newline, and a
                 trim here glues words together. */
              if (typeof ev.delta.text === "string") text += ev.delta.text;
            } else if (ev.type === "error") {
              return fail(new Error((ev.error && ev.error.message) || "Claude returned an error"));
            } else if (ev.type === "message_stop") {
              finish(false);
              req.destroy();
              return;
            }
          }
        });
        res.on("end", function () {
          if (errorStatus) {
            const raw = Buffer.concat(chunks).toString("utf8");
            let msg = "Claude returned " + res.statusCode;
            try { const j = JSON.parse(raw); if (j && j.error && j.error.message) msg = j.error.message; } catch (e) {}
            return fail(new Error(msg));
          }
          finish(false);
        });
      }
    );

    /* The deadline is measured from when the HANDLER started, not from here,
       so time spent reading the record is already counted. */
    const left = Math.max(250, deadline - Date.now());
    timer = setTimeout(function () {
      finish(true);
      req.destroy();
    }, left);

    req.on("error", function (err) {
      /* destroy() after finish() fires an error we already handled. */
      if (!done) fail(err);
    });
    req.write(payload);
    req.end();
  });
}

function parseFrame(frame) {
  const line = frame.split("\n").find(function (l) { return l.indexOf("data:") === 0; });
  if (!line) return null;
  try { return JSON.parse(line.slice(5).trim()); } catch (e) { return null; }
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
