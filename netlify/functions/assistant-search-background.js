// netlify/functions/assistant-search-background.js — the assistant looks online.
//
//   "Add internet search to the assistant like you said"
//
// WHY A BACKGROUND FUNCTION. A synchronous function dies at 10 seconds and
// one web search alone takes 3-5. This one has 15 minutes. The dashboard
// starts it with a job id, gets a 202 at once, and polls assistant.js
// ({action:"job"}) until the job record says done. The answer is also
// appended to the chat it was asked from (lib/assistant-chat.js), so it is
// there when the record is opened again.
//
// WHAT IT ASKS. Claude with the web search tool, the house rules, the
// question, the last few turns of the chat for context, and one line of the
// job on screen if there is one. It answers short, with the sources it used
// listed at the end as plain URLs. Numbers found online are reported AS
// FOUND, with their source - never turned into a quote for a job.
//
// CONTRACTOR ONLY, like assistant.js: POST with x-sbc-key. A search costs
// money on every call.

const https = require("https");
const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const chat = require("./lib/assistant-chat");

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 1200;
const MAX_SEARCHES = 5;
const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function jobStore() {
  return getStore({ name: "assistant-jobs", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
}
function str(v) { return String(v == null ? "" : v).trim(); }
function arr(v) { return Array.isArray(v) ? v : []; }

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors(), body: JSON.stringify({ error: "Method Not Allowed" }) };
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Unreadable request" }) }; }
  const id = /^[A-Za-z0-9_-]{6,60}$/.test(str(body.job)) ? str(body.job) : "";
  const query = str(body.query).slice(0, 300);
  if (!id || !query) return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "job and query are required" }) };
  const chatKey = chat.chatKeyOf(body.chat);
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const jobs = jobStore();
  const startedAt = new Date().toISOString();
  await jobs.set(id, JSON.stringify({ status: "running", query: query, at: startedAt }));

  if (!apiKey) {
    await jobs.set(id, JSON.stringify({ status: "error", query: query, error: "ANTHROPIC_API_KEY is not set in Netlify.", at: new Date().toISOString() }));
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "ANTHROPIC_API_KEY is not set" }) };
  }

  try {
    const out = await searchClaude(apiKey, query, str(body.question), arr(body.history), str(body.context));
    const answer = out.text + (out.sources.length ? "\n\nSources:\n" + out.sources.map(function (s) { return "- " + s; }).join("\n") : "");
    await jobs.set(id, JSON.stringify({ status: "done", query: query, answer: answer, sources: out.sources, searches: out.searches, at: new Date().toISOString() }));
    if (chatKey) { try { await chat.appendChat(chatKey, "", "🔎 " + answer); } catch (e) { /* the job record still has it */ } }
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true, job: id }) };
  } catch (e) {
    await jobs.set(id, JSON.stringify({ status: "error", query: query, error: str(e && e.message) || "search failed", at: new Date().toISOString() }));
    return { statusCode: 502, headers: cors(), body: JSON.stringify({ error: str(e && e.message) }) };
  }
};

function systemPrompt(context) {
  return [
    "You are the assistant to Zurab, who runs Sani Building Corp, a renovation and repair contractor in Brooklyn serving the five NYC boroughs and Long Island. He asked you to look something up online.",
    "Use the web search tool. Search as many times as you need (up to " + MAX_SEARCHES + "), then answer.",
    "HOW TO ANSWER: short and plain, under about 200 words, on a phone. Lead with the answer. Give numbers as you found them, with where they came from. If sources disagree, say so in one line. If you could not find it, say that plainly.",
    "New York first: prices, stores, rules and codes for NYC and Long Island unless he says otherwise.",
    "RULES: Never use the word 'licensed' or make any licensing claim; say 'fully insured'. Never mention TV mounting. A price you find online is that seller's price, not his quote: never turn it into a price for a job.",
    "End with the list of sources you actually used, one URL per line, under the heading 'Sources:'.",
    context ? "\nWHAT IS ON HIS SCREEN:\n" + context : "",
  ].filter(Boolean).join("\n");
}

/* One non-streamed call with the web search tool. Returns the text blocks
   joined, and the unique source URLs from their citations. */
function searchClaude(apiKey, query, question, history, context) {
  const messages = arr(history).slice(-6).map(function (m) {
    return { role: m && m.role === "assistant" ? "assistant" : "user", content: str(m && m.text).slice(0, 1500) };
  }).filter(function (m) { return m.content; });
  const ask = (question && question !== query) ? question + "\n\nSearch for: " + query : "Search online: " + query;
  if (messages.length && messages[messages.length - 1].role === "user") messages[messages.length - 1].content += "\n\n" + ask;
  else messages.push({ role: "user", content: ask });

  const payload = JSON.stringify({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt(context),
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCHES }],
    messages: messages,
  });
  return new Promise(function (resolve, reject) {
    const req = https.request(
      { hostname: "api.anthropic.com", port: 443, path: "/v1/messages", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), "x-api-key": apiKey, "anthropic-version": "2023-06-01" } },
      function (res) {
        const chunks = [];
        res.on("data", function (c) { chunks.push(c); });
        res.on("end", function () {
          const raw = Buffer.concat(chunks).toString("utf8");
          let j = null;
          try { j = JSON.parse(raw); } catch (e) { j = null; }
          if (!j) return reject(new Error("Claude answered with something that is not JSON (HTTP " + res.statusCode + ")"));
          if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error((j.error && j.error.message) || ("Claude returned " + res.statusCode)));
          resolve(extract(j));
        });
      }
    );
    req.setTimeout(600000, function () { req.destroy(new Error("The search took too long")); });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function extract(msg) {
  const text = [], sources = [], seen = {};
  let searches = 0;
  arr(msg && msg.content).forEach(function (b) {
    if (!b) return;
    if (b.type === "text" && str(b.text)) {
      text.push(b.text);
      arr(b.citations).forEach(function (c) {
        const u = str(c && c.url);
        if (u && !seen[u]) { seen[u] = true; sources.push(u); }
      });
    } else if (b.type === "server_tool_use") searches++;
    /* web_search_tool_result blocks list everything the search returned;
       only what the answer actually CITES becomes a source. */
  });
  return { text: text.join("").trim(), sources: sources.slice(0, 8), searches: searches };
}

function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
}
exports._extract = extract;
