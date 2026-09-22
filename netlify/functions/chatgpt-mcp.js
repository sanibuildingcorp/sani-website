// netlify/functions/chatgpt-mcp.js
//
// THE DASHBOARD, FROM THE CHATGPT APP ON HIS PHONE.
//
//   "i want AI which can add texts in estimate, i want AI which can learn
//    each request from the customers ... i need you to help me connect
//    ChatGPT, i want talk to my dashboard from my phone in ChatGPT"
//
// An MCP server (Model Context Protocol, Streamable HTTP, JSON-RPC 2.0) that
// ChatGPT's "custom connector" talks to. One URL, pasted once into the
// ChatGPT app. Every tool reads or writes the same records the dashboard
// does, through the same libraries, with the same guards: prices never move
// through a reword (lib/reword.js fingerprints them), "licensed" never
// appears, every write leaves a history line the estimate's own Ask AI reads
// as SINCE YOUR LAST ANSWER.
//
// WHO MAY CALL. ChatGPT's connectors send no custom header, so the secret
// travels in the URL: a token DERIVED from DASHBOARD_KEY (HMAC, never the key
// itself). The dashboard shows him that URL after he has logged in (GET with
// x-sbc-key). A caller with the dashboard key header is accepted too, and a
// Bearer token equal to the connector token. No key in the environment: 500,
// never open. Every tool call costs money or writes a record, so nothing
// answers without one of the three.
//
// WHAT IT IS NOT. Not a second brain. ChatGPT does the thinking; these tools
// are its hands and eyes on the dashboard. The in-dashboard Ask AI is still
// there, reachable from here as a tool, and both share the standing memory.

"use strict";

const crypto = require("crypto");
const https = require("https");
const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const history = require("./lib/history");
const { applyEdits, WHERE } = require("./lib/reword");
const { dedupeScope } = require("./lib/scope-dedupe");
const customerTotals = require("./lib/customer-total");
const insights = require("./lib/insights");
const { customerCards } = require("./lib/customer-cards");

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "Sani Building Corp dashboard", version: "1.0.0" };
const LIST_LIMIT = 40;
const READ_CONCURRENCY = 12;
const KICK_MS = 8000;

const INSTRUCTIONS = [
  "You are connected to the estimate dashboard of Sani Building Corp, a Brooklyn, NYC renovation and repair contractor. The person talking to you is Zura, the owner.",
  "Every estimate has a ref like SBC-260921-WNGN. search finds one by customer name, address, service, status or ref; fetch / get_estimate reads it whole: the customer's request, emails, the summary, the scope of work as the customer reads it, the service cards with their prices, the contract, the history of changes.",
  "WRITING: add_scope_line, reword, set_text and remove_duplicates change WORDS only; prices never move here. regenerate re-prices a job; add_service prices an extra piece of work. add_note keeps a fact on the estimate; remember keeps a standing rule for every estimate. Read the estimate before you change it, and after a write say in one line what changed.",
  "VOICE for anything the customer reads: short, calm, plain. Never the word 'licensed' (say 'fully insured'). Never mention TV mounting. Building approval takes under a week, never longer. No warnings, no difficulty, no long explanations.",
  "Zura wants short answers. Do what he asks, then say what you did in a line or two.",
].join("\n");

/* ── AUTH ──────────────────────────────────────────────────────────────── */

function connectorToken() {
  const secret = process.env.DASHBOARD_KEY;
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update("chatgpt-connector-v1").digest("hex").slice(0, 48);
}

function siteBase() {
  return String(process.env.URL || "https://sanibuildingcorp.com").replace(/\/+$/, "");
}

function connectorUrl() {
  return siteBase() + "/.netlify/functions/chatgpt-mcp/" + connectorToken();
}

function same(a, b) {
  try {
    const x = Buffer.from(String(a), "utf8"), y = Buffer.from(String(b), "utf8");
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  } catch (e) { return false; }
}

function tokenOf(event) {
  const h = (event && event.headers) || {};
  const auth = String(h.authorization || h.Authorization || "");
  const bearer = /^Bearer\s+(\S+)/i.exec(auth);
  if (bearer) return bearer[1];
  const q = (event && event.queryStringParameters) || {};
  if (q.token) return String(q.token);
  const m = /chatgpt-mcp\/([A-Za-z0-9]+)/.exec(String((event && event.path) || ""));
  return m ? m[1] : "";
}

/* null when allowed; a response when not */
function gate(event) {
  if (!process.env.DASHBOARD_KEY) return requireDashboardKey(event, cors());
  const h = (event && event.headers) || {};
  if (h["x-sbc-key"] || h["X-Sbc-Key"] || h["X-SBC-Key"]) return requireDashboardKey(event, cors());
  const t = tokenOf(event);
  if (t && same(t, connectorToken())) return null;
  return { statusCode: 401, headers: cors(), body: JSON.stringify({ error: "Bad or missing connector token" }) };
}

/* ── HANDLER ───────────────────────────────────────────────────────────── */

exports.handler = async function (event) {
  const method = String((event && event.httpMethod) || "GET").toUpperCase();
  if (method === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };

  const denied = gate(event);
  if (denied) return denied;

  /* The dashboard, logged in: "what is my connector link?" */
  if (method === "GET") {
    const h = (event && event.headers) || {};
    if (h["x-sbc-key"] || h["X-Sbc-Key"] || h["X-SBC-Key"]) {
      return json(200, { ok: true, url: connectorUrl(), tools: TOOLS.map(function (t) { return t.name; }) });
    }
    /* MCP: no server-to-client stream is offered */
    return { statusCode: 405, headers: cors(), body: JSON.stringify({ error: "POST JSON-RPC to this URL" }) };
  }
  if (method === "DELETE") return json(200, { ok: true });
  if (method !== "POST") return json(405, { error: "Method Not Allowed" });

  let body;
  try { body = JSON.parse(event.body || ""); }
  catch (e) { return rpc(200, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }

  const messages = Array.isArray(body) ? body : [body];
  const out = [];
  for (const m of messages) {
    if (!m || typeof m !== "object" || !m.method) continue;           /* a response or junk: ignored */
    const isNotification = m.id === undefined;
    let res;
    try { res = await dispatch(m); }
    catch (err) { res = { error: { code: -32603, message: String((err && err.message) || err).slice(0, 300) } }; }
    if (isNotification) continue;
    out.push(Object.assign({ jsonrpc: "2.0", id: m.id }, res));
  }
  if (!out.length) return { statusCode: 202, headers: cors(), body: "" };
  return rpc(200, Array.isArray(body) ? out : out[0]);
};

async function dispatch(m) {
  const p = m.params && typeof m.params === "object" ? m.params : {};
  switch (String(m.method)) {
    case "initialize": {
      const asked = String(p.protocolVersion || "");
      return { result: { protocolVersion: PROTOCOLS.indexOf(asked) !== -1 ? asked : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS } };
    }
    case "ping": return { result: {} };
    case "tools/list": return { result: { tools: TOOLS.map(function (t) { return { name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations }; }) } };
    case "tools/call": {
      const tool = TOOLS.find(function (t) { return t.name === String(p.name || ""); });
      if (!tool) return { error: { code: -32602, message: "Unknown tool: " + String(p.name || "") } };
      const args = p.arguments && typeof p.arguments === "object" ? p.arguments : {};
      try {
        const r = await tool.run(args);
        return { result: typeof r === "string" ? { content: [{ type: "text", text: r }] } : r };
      } catch (err) {
        return { result: { content: [{ type: "text", text: "Could not do that: " + String((err && err.message) || err).slice(0, 300) }], isError: true } };
      }
    }
    default:
      return { error: { code: -32601, message: "Method not found: " + String(m.method) } };
  }
}

/* ── RECORDS ───────────────────────────────────────────────────────────── */

function store() { return getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN }); }
function memoryStore() { return getStore({ name: "assistant-memory", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN }); }

async function loadRecord(ref) {
  const r = str(ref).toUpperCase();
  if (!r) throw new Error("Which estimate? Give its ref, like SBC-260921-WNGN.");
  const rec = await store().get(r, { type: "json" });
  if (!rec || typeof rec !== "object") throw new Error("Estimate " + r + " not found");
  return rec;
}

async function saveRecord(rec) {
  rec.updatedAt = new Date().toISOString();
  await store().setJSON(rec.ref, rec);
}

async function allRecords() {
  const s = store();
  const { blobs } = await s.list();
  const keys = blobs.map(function (b) { return b.key; }).filter(function (k) { return /^SBC-/i.test(k); });
  const out = new Array(keys.length);
  let next = 0;
  async function worker() {
    while (next < keys.length) { const i = next++; try { out[i] = await s.get(keys[i], { type: "json" }); } catch (e) { out[i] = null; } }
  }
  const workers = [];
  for (let w = 0; w < Math.max(1, Math.min(READ_CONCURRENCY, keys.length)); w++) workers.push(worker());
  await Promise.all(workers);
  return out.filter(function (r) { return r && typeof r === "object" && r.ref; })
    .sort(function (a, b) { return new Date(b.updatedAt || b.submittedAt || 0) - new Date(a.updatedAt || a.submittedAt || 0); });
}

function money(n) { const v = Number(n); return Number.isFinite(v) ? "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"; }

function rowOf(r) {
  const c = r.customer || {}, q = r.request || {}, e = r.estimate || {};
  let total = null;
  try { total = customerTotals(e, r).customerTotal; } catch (x) { total = null; }
  return {
    ref: r.ref, status: str(r.status) || "new", customer: str(c.name), address: str(c.address), service: str(q.service),
    title: str(e.projectTitle), total: total, updatedAt: str(r.updatedAt || r.submittedAt).slice(0, 10),
  };
}

function rowText(x) {
  return x.ref + " | " + x.status + " | " + (x.customer || "no name") + (x.address ? ", " + x.address : "") + " | " + (x.title || x.service || "no title") + " | " + (x.total != null ? money(x.total) : "no price") + " | " + x.updatedAt;
}

function matches(r, words) {
  const c = r.customer || {}, q = r.request || {}, e = r.estimate || {};
  const hay = [r.ref, r.status, c.name, c.address, c.email, c.phone, q.service, q.description, e.projectTitle].map(str).join(" ").toLowerCase();
  return words.every(function (w) { return hay.indexOf(w) !== -1; });
}

/* The estimate through Ask AI's eyes: request, emails, summary, scope,
   cards with prices, contract, history. Loaded lazily so a list or a
   reword does not pay for the assistant module. */
async function estimateText(ref) {
  const assistant = require("./assistant");
  const ctx = await assistant.recordContext(str(ref).toUpperCase(), 40000, 0, "");
  const text = ctx && typeof ctx === "object" ? str(ctx.text) : str(ctx);
  if (!text) throw new Error("Estimate " + str(ref).toUpperCase() + " not found");
  return text;
}

function cardsText(rec) {
  try {
    const cards = (customerCards(rec) || {}).cards || [];
    return cards.map(function (c) { return c.title + " " + money(c.subtotal) + ":\n" + (c.included || []).map(function (l) { return "  • " + l; }).join("\n"); }).join("\n");
  } catch (e) { return ""; }
}

/* ── THE ESTIMATOR, KICKED FROM HERE ───────────────────────────────────── */

async function houseRules() {
  try { const d = await store().get("house-rules", { type: "json" }); return str(d && d.rules); } catch (e) { return ""; }
}

function kickEstimator(body) {
  return new Promise(function (resolve, reject) {
    const u = new URL(siteBase() + "/.netlify/functions/generate-estimate-background");
    const data = JSON.stringify(body);
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, function (res) {
      res.resume();
      res.on("end", function () { resolve(res.statusCode); });
    });
    req.on("error", reject);
    req.setTimeout(KICK_MS, function () { req.destroy(new Error("The estimator did not answer in time")); });
    req.write(data);
    req.end();
  });
}

function jobId() { return "ai-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10); }

/* ── TOOLS ─────────────────────────────────────────────────────────────── */

const S = function (desc, extra) { return Object.assign({ type: "string", description: desc }, extra || {}); };
const obj = function (props, required) { return { type: "object", properties: props, required: required || [], additionalProperties: false }; };

const TOOLS = [
  {
    name: "search",
    annotations: { title: "Find estimates", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Find estimates by customer name, address, service, status or ref. Returns up to 40 matches, newest first, with the ref to use in the other tools.",
    inputSchema: obj({ query: S("Words to look for: a name, a street, a service, a status like sent or accepted, or a ref. Empty returns the newest estimates.") }, []),
    run: async function (a) {
      const words = str(a.query).toLowerCase().split(/\s+/).filter(Boolean);
      const rows = (await allRecords()).filter(function (r) { return !words.length || matches(r, words); }).slice(0, LIST_LIMIT).map(rowOf);
      const results = rows.map(function (x) { return { id: x.ref, title: (x.customer || "No name") + " - " + (x.title || x.service || "estimate") + " (" + x.status + ", " + (x.total != null ? money(x.total) : "no price") + ")", url: siteBase() + "/dashboard?ref=" + x.ref }; });
      return { content: [{ type: "text", text: JSON.stringify({ results: results }) }], structuredContent: { results: results } };
    },
  },
  {
    name: "fetch",
    annotations: { title: "Read an estimate", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Read one estimate whole by its ref: the customer's request and emails, summary, timeline, the scope of work as the customer reads it, every service card with its price, the contract, and the history of changes.",
    inputSchema: obj({ id: S("The estimate ref, e.g. SBC-260921-WNGN") }, ["id"]),
    run: async function (a) {
      const ref = str(a.id).toUpperCase();
      const text = await estimateText(ref);
      const doc = { id: ref, title: "Estimate " + ref, text: text, url: siteBase() + "/dashboard?ref=" + ref, metadata: { source: "sani-dashboard" } };
      return { content: [{ type: "text", text: JSON.stringify(doc) }], structuredContent: doc };
    },
  },
  {
    name: "list_estimates",
    annotations: { title: "List estimates", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "The estimates as a table, newest first: ref, status, customer, title, customer price, last change. Filter by status (new, drafted, sent, accepted, declined, completed, cancelled).",
    inputSchema: obj({ status: S("Only this status, or empty for all"), limit: { type: "integer", description: "How many, up to 40", minimum: 1, maximum: 40 } }, []),
    run: async function (a) {
      const want = str(a.status).toLowerCase();
      const n = Math.max(1, Math.min(LIST_LIMIT, Number(a.limit) || LIST_LIMIT));
      const rows = (await allRecords()).map(rowOf).filter(function (x) { return !want || x.status.toLowerCase().indexOf(want) === 0; }).slice(0, n);
      return rows.length ? "ref | status | customer | title | customer price | last change\n" + rows.map(rowText).join("\n") : "No estimates" + (want ? " with status " + want : "") + ".";
    },
  },
  {
    name: "get_estimate",
    annotations: { title: "Read an estimate", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Read one estimate whole by its ref. Same as fetch, as plain text.",
    inputSchema: obj({ ref: S("The estimate ref") }, ["ref"]),
    run: async function (a) { return await estimateText(a.ref); },
  },
  {
    name: "add_scope_line",
    annotations: { title: "Add a scope line", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: "Add one line of work to a service card of an estimate, as the customer will read it. The scope of work text follows the card. Prices do not change.",
    inputSchema: obj({ ref: S("The estimate ref"), service: S("The service card, e.g. Bathroom, Painting. Empty means the first card."), text: S("The line, one plain sentence") }, ["ref", "text"]),
    run: async function (a) {
      const rec = await loadRecord(a.ref);
      const service = str(a.service) || cardName(rec);
      const out = applyEdits(rec, [{ where: "included", service: service, from: "", to: str(a.text) }]);
      if (!out.applied.length) throw new Error("No card named " + service + ". Cards: " + cardNames(rec).join(", "));
      history.note(rec, "reworded", "ChatGPT added to " + service + ": \"" + str(a.text).slice(0, 80) + "\"");
      await saveRecord(rec);
      return "Added to " + service + " on " + rec.ref + ": " + str(a.text) + "\n\n" + cardsText(rec);
    },
  },
  {
    name: "reword",
    annotations: { title: "Reword an estimate", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Change the words of an estimate without touching a price: a card line (where=included, excluded or supplies, with the service name), a price line's name (labor, material), or a field (summary, scope, title, timeline, contractscope, contracttimeline, contractclause). Each edit: from = the current text or its gist (empty to add), to = the new text (empty to remove).",
    inputSchema: obj({
      ref: S("The estimate ref"),
      edits: { type: "array", minItems: 1, items: obj({ where: S("One of: " + WHERE.join(", ")), service: S("The service card, for included / excluded / supplies"), from: S("The current line or its gist; empty to add a new line"), to: S("The new text; empty to remove the line") }, ["where"]) },
    }, ["ref", "edits"]),
    run: async function (a) {
      const rec = await loadRecord(a.ref);
      const edits = Array.isArray(a.edits) ? a.edits : [];
      if (!edits.length) throw new Error("No edits given");
      const out = applyEdits(rec, edits);
      if (!out.applied.length) throw new Error("Nothing matched: " + out.skipped.map(function (s) { return s.reason + " (" + (s.from || s.to) + ")"; }).join("; "));
      history.note(rec, "reworded", "ChatGPT reworded (" + out.applied.length + "): " + out.applied.map(function (e) { return str(e.where) + (e.service ? " on " + e.service : "") + (e.to ? ": \"" + str(e.to).slice(0, 50) + "\"" : " removed"); }).join("; ").slice(0, 300));
      await saveRecord(rec);
      return "Applied " + out.applied.length + " edit" + (out.applied.length === 1 ? "" : "s") + " on " + rec.ref + (out.skipped.length ? "; not found: " + out.skipped.map(function (s) { return s.from || s.to; }).join("; ") : "") + "\n\n" + cardsText(rec);
    },
  },
  {
    name: "set_text",
    annotations: { title: "Set a field", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Replace a whole field of an estimate: summary, scope, title or timeline. Prices do not change.",
    inputSchema: obj({ ref: S("The estimate ref"), field: S("summary, scope, title or timeline", { enum: ["summary", "scope", "title", "timeline"] }), text: S("The new text") }, ["ref", "field", "text"]),
    run: async function (a) {
      const rec = await loadRecord(a.ref);
      const out = applyEdits(rec, [{ where: str(a.field), from: "", to: str(a.text) }]);
      if (!out.applied.length) throw new Error("Could not set " + str(a.field));
      history.note(rec, "reworded", "ChatGPT set the " + str(a.field) + ": \"" + str(a.text).slice(0, 80) + "\"");
      await saveRecord(rec);
      return "Set the " + str(a.field) + " on " + rec.ref + ".";
    },
  },
  {
    name: "remove_duplicates",
    annotations: { title: "Remove repeated lines", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Remove repeated lines from the scope of work and every service card of an estimate. Prices do not change.",
    inputSchema: obj({ ref: S("The estimate ref") }, ["ref"]),
    run: async function (a) {
      const rec = await loadRecord(a.ref);
      const r = dedupeScope(rec);
      if (!r.changed) return "No repeated lines on " + rec.ref + "." + (r.similar && r.similar.length ? " Lines that say nearly the same: " + r.similar.slice(0, 4).map(function (p) { return "\"" + str(p.a || p[0]).slice(0, 50) + "\" / \"" + str(p.b || p[1]).slice(0, 50) + "\""; }).join("; ") : "");
      history.note(rec, "removed", "ChatGPT removed repeated lines (" + r.count + ")");
      rec.rewordedAt = new Date().toISOString();
      await saveRecord(rec);
      return "Removed " + r.count + " repeated line" + (r.count === 1 ? "" : "s") + " on " + rec.ref + ".\n\n" + cardsText(rec);
    },
  },
  {
    name: "add_note",
    annotations: { title: "Add a note", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: "Keep a fact on one estimate, e.g. what the customer asked for on the phone. The estimate's own Ask AI reads it on its next answer.",
    inputSchema: obj({ ref: S("The estimate ref"), text: S("The note, one or two sentences") }, ["ref", "text"]),
    run: async function (a) {
      const rec = await loadRecord(a.ref);
      if (!str(a.text)) throw new Error("Empty note");
      history.note(rec, "note", "ChatGPT note: " + str(a.text));
      await saveRecord(rec);
      return "Noted on " + rec.ref + ".";
    },
  },
  {
    name: "remember",
    annotations: { title: "Remember a rule", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: "Keep a standing rule or fact for EVERY estimate, e.g. how Zura wants scopes written or what a kind of job always includes. Both this connector and the dashboard's Ask AI read it.",
    inputSchema: obj({ text: S("The rule, one sentence") }, ["text"]),
    run: async function (a) {
      const assistant = require("./assistant");
      const memory = await assistant.loadMemory();
      if (!str(a.text)) throw new Error("Empty rule");
      await assistant.remember(memory, str(a.text));
      return "Remembered: " + str(a.text);
    },
  },
  {
    name: "memory",
    annotations: { title: "What is remembered", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "What has been remembered so far: the standing rules, and what the history shows (acceptance rates, prices accepted by kind of job and borough, who never answered).",
    inputSchema: obj({}, []),
    run: async function () {
      const assistant = require("./assistant");
      const notes = await assistant.loadMemory();
      let ins = "";
      try { ins = await assistant.loadInsights(); } catch (e) { ins = ""; }
      if (!ins) { try { ins = insights.insightsText(insights.buildInsights(await allRecords(), new Date())); } catch (e) { ins = ""; } }
      return "STANDING RULES:\n" + (notes.length ? notes.map(function (n) { return "  - " + str(n.text); }).join("\n") : "  (none yet)") + "\n\nWHAT THE HISTORY SHOWS:\n" + (ins || "(nothing yet)");
    },
  },
  {
    name: "regenerate",
    annotations: { title: "Re-price a job", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    description: "Have the estimator price the job again from the customer's request and answers, in the background (a few minutes). reanalyze=true lets it decide again what the job is; false re-prices the pinned scope. Optional extra request text is read with the job.",
    inputSchema: obj({ ref: S("The estimate ref"), reanalyze: { type: "boolean", description: "Re-read the job from scratch" }, extraRequest: S("Extra instructions for this run, optional") }, ["ref"]),
    run: async function (a) {
      const rec = await loadRecord(a.ref);
      const id = jobId();
      const code = await kickEstimator({ ref: rec.ref, jobId: id, reanalyze: a.reanalyze === true, useDescription: true, useAnswers: true, extraRequest: str(a.extraRequest).slice(0, 2000), houseRules: await houseRules() });
      if (code !== 202 && !(code >= 200 && code < 300)) throw new Error("The estimator refused (" + code + ")");
      return "Started on " + rec.ref + (a.reanalyze === true ? " (re-reading the job from scratch)" : " (re-pricing)") + ". It takes a few minutes; read the estimate again after that.";
    },
  },
  {
    name: "add_service",
    annotations: { title: "Add a service", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: "Price an extra piece of work and add it to an estimate as its own service card, in the background (a few minutes). Describe the work in plain words.",
    inputSchema: obj({ ref: S("The estimate ref"), text: S("The extra work, e.g. 'paint the hallway ceiling, two coats'"), service: S("The service name for the new card, optional") }, ["ref", "text"]),
    run: async function (a) {
      const rec = await loadRecord(a.ref);
      if (!str(a.text)) throw new Error("Describe the work to add");
      const code = await kickEstimator({ ref: rec.ref, jobId: jobId(), addService: { text: str(a.text).slice(0, 2000), service: str(a.service) }, houseRules: await houseRules() });
      if (code !== 202 && !(code >= 200 && code < 300)) throw new Error("The estimator refused (" + code + ")");
      return "Started: pricing \"" + str(a.text).slice(0, 80) + "\" on " + rec.ref + ". It takes a few minutes; read the estimate again after that.";
    },
  },
  {
    name: "ask_estimate_ai",
    annotations: { title: "Ask the estimate AI", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: "Ask the estimate's own in-dashboard assistant a question about one estimate. It answers from the record, its emails and photos. Its reply is text; it does not change the estimate from here.",
    inputSchema: obj({ ref: S("The estimate ref"), question: S("The question") }, ["ref", "question"]),
    run: async function (a) {
      const assistant = require("./assistant");
      const rec = await loadRecord(a.ref);
      const out = await assistant.answer({ ref: rec.ref, chat: rec.ref, messages: [{ role: "user", text: "(from ChatGPT) " + str(a.question) }] }, { deadline: Date.now() + 8000, estimateChars: 40000 });
      return str(out && out.reply) + (out && out.actions && out.actions.length ? "\n\n(It proposed " + out.actions.length + " change" + (out.actions.length === 1 ? "" : "s") + " the dashboard would ask Zura to confirm; nothing was changed from here.)" : "");
    },
  },
];

function cardNames(rec) { return (((rec || {}).estimate || {}).serviceBreakdown || []).map(function (c) { return str(c && (c.title || c.name)); }).filter(Boolean); }
function cardName(rec) { return cardNames(rec)[0] || "General"; }

/* ── PLUMBING ──────────────────────────────────────────────────────────── */

function str(v) { return String(v == null ? "" : v).trim(); }
function json(code, o) { return { statusCode: code, headers: cors(), body: JSON.stringify(o) }; }
function rpc(code, o) { return { statusCode: code, headers: cors(), body: JSON.stringify(o) }; }
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-sbc-key, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

exports._connectorToken = connectorToken;
exports._connectorUrl = connectorUrl;
exports._tools = TOOLS;
