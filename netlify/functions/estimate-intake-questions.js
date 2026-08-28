// netlify/functions/estimate-intake-questions.js
//
// Plans the WHOLE set of follow-up questions in one call, the moment the customer
// finishes writing their description — before the request ever reaches the
// dashboard.
//
// This replaces asking one question, waiting for the model, asking the next. That
// old loop was worse in both directions: the model chose each question blind to
// the ones it would ask later (so it spent its first slot on something small and
// never got to the square footage), and the customer sat through a network round
// trip between every tap. Planning the set in one pass lets it rank the gaps by
// how much money they move, and lets the form render every question instantly.
//
// Fails open. If anything here breaks, the form falls back to the older
// one-at-a-time endpoint, and if that breaks too the customer goes straight on.
// A form that stalls collects nothing at all.

const https = require("https");
const { planPrompt, normalizeQuestions, maxQuestions } = require("./lib/intake-questions");

/* The customer is watching a spinner. Sonnet is the right trade here: this is a
   reading-comprehension job over one paragraph, not the estimate itself. Effort
   is low for the same reason - every extra second on this screen is a lead
   thinking about closing the tab. */
const MODEL = process.env.INTAKE_QUESTION_MODEL || "claude-sonnet-5";
const EFFORT = process.env.INTAKE_QUESTION_EFFORT || "low";
/* Netlify kills a synchronous function at 10 seconds. Give up before it does, so
   the browser gets a clean fallback instead of a dead socket. */
const API_TIMEOUT_MS = Number(process.env.INTAKE_QUESTION_TIMEOUT_MS || 8500);

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  const started = Date.now();
  try {
    const body = JSON.parse(event.body || "{}");
    const input = {
      service: String(body.service || ""),
      serviceLabel: String(body.serviceLabel || ""),
      serviceCount: Math.max(1, Math.min(parseInt(body.serviceCount, 10) || 1, 5)),
      description: String(body.description || "").trim().slice(0, 4000),
      propertyType: String(body.propertyType || "").trim().slice(0, 60),
      photoCount: Math.max(0, Math.min(parseInt(body.photoCount, 10) || 0, 20)),
      photoNotes: Array.isArray(body.photoNotes) ? body.photoNotes.slice(0, 8) : [],
    };
    /* The photos themselves, not just how many there are. A picture of the
       bathroom settles its size and condition in one look, which both kills the
       questions that would have asked what the photo already shows and frees the
       remaining slots for what a photo cannot tell us. */
    const images = imageBlocks(body.photos);

    if (!input.service && !input.serviceLabel) {
      return json(400, { error: "Missing service" });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return json(200, { questions: [], fallback: true, error: "ANTHROPIC_API_KEY not set" });

    const raw = await callClaude(apiKey, planPrompt(input), images);
    const questions = normalizeQuestions(raw, input);

    return json(200, {
      questions: questions,
      readAs: String((raw && raw.readAs) || "").slice(0, 300),
      max: maxQuestions(input.serviceCount),
      ms: Date.now() - started,
    });
  } catch (err) {
    console.error("intake question planner failed:", err.message);
    /* 200, not 500. The browser treats this as "plan unavailable" and falls back
       to the per-question endpoint. A 500 here would look like a broken form. */
    return json(200, { questions: [], fallback: true, error: err.message, ms: Date.now() - started });
  }
};

/* How many photos to actually look at, and how big each may be. Three is enough
   to understand a room; more only adds seconds to a screen the customer is
   watching. Anything that is not a plain data-URL image (a PDF, a heic the
   browser could not convert, a file the reader failed on) is skipped rather than
   sent as something the API will reject. */
const MAX_IMAGES = Number(process.env.INTAKE_QUESTION_MAX_IMAGES || 3);
const MAX_IMAGE_BYTES = 900000;   // base64 characters, roughly 650 KB of image

function imageBlocks(photos) {
  if (!Array.isArray(photos)) return [];
  const out = [];
  for (const p of photos) {
    if (out.length >= MAX_IMAGES) break;
    const data = String((p && (p.data || p)) || "");
    const m = data.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) continue;
    if (m[2].length > MAX_IMAGE_BYTES) continue;
    out.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  }
  return out;
}

function callClaude(apiKey, prompt, images) {
  /* Images first, question last: the model reads the pictures, then is asked
     what is still missing. */
  const content = (images || []).concat([{ type: "text", text: prompt }]);
  const payload = JSON.stringify({
    model: MODEL,
    max_tokens: 2500,
    output_config: { effort: EFFORT },
    messages: [{ role: "user", content: content }],
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
        timeout: API_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("error", reject);
        res.on("end", () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (parsed.error) return reject(new Error(parsed.error.message || "API error"));
            /* With thinking on, content carries thinking blocks alongside the
               text. Only the text blocks hold the JSON. */
            const text = (parsed.content || [])
              .filter((b) => b && b.type === "text")
              .map((b) => b.text || "")
              .join("");
            const match = text.match(/\{[\s\S]*\}/);
            if (!match) return reject(new Error("No JSON in response"));
            resolve(JSON.parse(match[0]));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout after " + API_TIMEOUT_MS + "ms"));
    });
    req.write(payload);
    req.end();
  });
}

function json(statusCode, obj) {
  return { statusCode, headers: cors(), body: JSON.stringify(obj) };
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
