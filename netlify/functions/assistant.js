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
const customerTotals = require("./lib/customer-total");
const { insightsText } = require("./lib/insights");
const chat = require("./lib/assistant-chat");

/* ── EVERYWHERE, NOT ONLY BESIDE ONE REQUEST ─────────────────────────────
   "i need personal AI assistant which can do everything, read everything in
    my dashboard, analyze, plan's strategy ... whatever page i will open,
    always personal AI assistant needs to read and if i ask questions then
    answers, if i command do that then let's him do it"

   Three additions, each a small thing on top of the panel above:

   SCREEN.  The dashboard sends a compact snapshot of what he is looking at -
   the open tab, every estimate as one line (ref, customer, service, status,
   total, dates, unpaid, reply needed), the site visits, the handyman
   bookings, the open record if there is one. It travels in the request
   because the browser already holds it; reading it again from Blobs would
   spend the ten seconds. Capped, so a big list cannot run the clock out.

   MEMORY.  "Remember that ..." is kept in a Blobs store and read on every
   call, so what he tells it on Monday it still knows on Friday. Nothing else
   is stored: the chat itself lives in the browser.

   ACTIONS.  When he tells it to do something the dashboard can do, it ends
   its reply with a line  ACTION: {json}.  The line is stripped from the text
   and returned as data; the DASHBOARD executes it with its own existing
   functions (open a record, switch tab, change a status, add a visit, put a
   draft in the reply box). "remember" is executed here. The list of actions
   is closed: anything not on it is ignored. And still: NOTHING IS SENT TO A
   CUSTOMER. A draft goes into the box; he presses Send. */

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 800;
/* The screen snapshot as text is capped here. 87 estimates come to ~10k. */
const SCREEN_CHARS = 14000;
const MEMORY_MS = 1500;
const MEMORY_MAX = 150;
/* How much of the chat the model re-reads on every question. */
const TURNS_SENT = 30;
/* ── CHATS THAT STAY ─────────────────────────────────────────────────────
     "let's each estimate has own AI assistant with own history, and use
      main brain and keep save in main memory"
   Every exchange is appended to an assistant-chats store under the chat's
   key: the estimate ref for the panel inside a record, "global" for the
   drawer. The dashboard loads the history back when the record or the
   drawer opens, so a conversation from last week is still there. The write
   happens after the answer and is given a short clock of its own; a slow
   store loses one turn, never the answer. */
const CHAT_WRITE_MS = 700;
/* ── THE INTERNET, IN THE BACKGROUND ─────────────────────────────────────
     "Add internet search to the assistant like you said"
   One web search takes 3-5 seconds; the sync clock has 9. So a search is
   an ACTION: {"type":"search","query":...} - the dashboard starts
   assistant-search-background (15 minutes, not 10 seconds) with a job id,
   polls {action:"job"} here, and the answer with its sources lands in the
   same chat when it is ready. The model is told when a question needs it. */
const JOB_MS = 1500;
/* Netlify's synchronous limit is 10,000ms. Everything - reading the record,
   the round trip to Claude, building the response - has to fit under this. */
const BUDGET_MS = 8800;
/* The record read is normally ~200ms. If Blobs is slow, answer without it
   rather than spend the budget waiting. */
const RECORD_MS = 2500;
/* The inbox emails with the open record's customer, from the CRM log
   (Supabase lead_messages). Its own short clock inside the record read. */
const EMAILS_MS = 1500;
const EMAILS_MAX = 10;

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

  /* The conversation so far, oldest first. Trimmed to the last TURNS_SENT
     turns. It was 12; he asked for more ("make the assistant read more
     messages"), and 30 turns of chat is a few thousand input tokens, which
     costs almost no time - the clock is spent on OUTPUT. */
  const turns = arr(body.messages)
    .map(function (m) {
      return { role: m && m.role === "assistant" ? "assistant" : "user", text: str(m && m.text) };
    })
    .filter(function (m) { return m.text; })
    .slice(-TURNS_SENT);

  /* The saved conversation for one chat, so the page can show it again. */
  if (str(body.action) === "history") {
    const key = chatKeyOf(body.chat);
    if (!key) return json(400, { error: "Which chat?" });
    const messages = await withTimeout(loadChat(key), RECORD_MS).catch(function () { return []; });
    return json(200, { chat: key, messages: messages });
  }

  /* Where a background search got to. Missing means not written yet:
     the dashboard keeps polling until its own clock runs out. */
  if (str(body.action) === "job") {
    const id = jobIdOf(body.id);
    if (!id) return json(400, { error: "Which job?" });
    const job = await withTimeout(jobStore().get(id, { type: "json" }), JOB_MS).catch(function () { return null; });
    return json(200, job && typeof job === "object" ? job : { status: "running" });
  }

  if (!turns.length) return json(400, { error: "Nothing to answer" });

  /* The record, the memory and the history insights are read side by side,
     each on its own short clock; any of them missing still leaves a working
     assistant. */
  const reads = await Promise.all([
    str(body.ref) ? withTimeout(recordContext(str(body.ref)), RECORD_MS).catch(function () { return ""; }) : Promise.resolve(""),
    withTimeout(loadMemory(), MEMORY_MS).catch(function () { return []; }),
    withTimeout(loadInsights(), MEMORY_MS).catch(function () { return ""; }),
  ]);
  const context = reads[0];
  const memory = reads[1];
  const insights = reads[2];
  const screen = screenContext(body.screen);

  try {
    const deadline = started + budgetMs;
    const out = await callClaude(apiKey, systemPrompt(context, screen, memory, insights), turns, deadline);
    const parsed = extractActions(out.text, out.truncated === true);
    if (!parsed.text && !parsed.actions.length) return json(502, { error: "The assistant returned nothing. Try again." });

    /* "remember" is the one action that lives here. Everything else is the
       dashboard's to do, with its own functions and its own confirm. */
    const toClient = [];
    for (const a of parsed.actions) {
      if (a.type === "remember") { try { await remember(memory, a.text); } catch (e) { /* memory is best effort */ } }
      else toClient.push(a);
    }
    const replyText = parsed.text || "Done.";
    const chatKey = chatKeyOf(body.chat);
    if (chatKey) {
      const last = turns[turns.length - 1];
      await withTimeout(appendChat(chatKey, last.role === "user" ? last.text : "", replyText), CHAT_WRITE_MS).catch(function () { /* one turn lost, answer kept */ });
    }
    return json(200, { reply: replyText, truncated: out.truncated === true, actions: toClient });
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

  /* "understand conversations": twenty messages, not eight, and the inbox
     emails with this customer that never made it onto the thread. */
  const thread = arr(rec.thread).slice(-20).map(function (m) {
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
    await emailContext(rec),
    str(est.scopeOfWork) ? "\nSCOPE DRAFTED SO FAR:\n" + str(est.scopeOfWork).slice(0, 1200) : "",
    estimateContext(rec),
  ].filter(Boolean).join("\n");
}

/* ── EMAILS WITH THIS CUSTOMER, FROM THE INBOX ───────────────────────────
     "letting AI read my email, identity same emails by customer names and
      email address and from request form and analyze and understand
      conversations"
   inbox-sync files every mail from a known customer into lead_messages,
   and bridges it onto the estimate when it can. This reads the last few
   for the open record's customer straight from that log, so even a mail
   that reached no thread is in front of the assistant. Ones already on
   the thread (same message id) are left out. Missing Supabase settings or
   a slow read simply give nothing. */
async function emailContext(rec) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  const email = str(rec && rec.customer && rec.customer.email).toLowerCase();
  if (!url || !key || !email || typeof fetch !== "function") return "";
  let rows;
  try {
    rows = await withTimeout(fetch(url + "/rest/v1/lead_messages?lead_email=eq." + encodeURIComponent(email) + "&select=direction,subject,body,created_at,message_id&order=created_at.desc&limit=" + EMAILS_MAX,
      { headers: { apikey: key, Authorization: "Bearer " + key } }).then(function (r) { return r.ok ? r.json() : []; }), EMAILS_MS);
  } catch (e) { rows = []; }
  const onThread = {};
  arr(rec.thread).forEach(function (m) { if (m && m.id) onThread[str(m.id)] = true; });
  const lines = arr(rows).filter(function (r) { return r && !(r.message_id && onThread[str(r.message_id)]); }).reverse().map(function (r) {
    return "  " + str(r.created_at).slice(0, 10) + " " + (r.direction === "out" ? "Sani" : "Customer") + (str(r.subject) ? " [" + str(r.subject).slice(0, 80) + "]" : "") + ": " + str(r.body).replace(/\s+/g, " ").slice(0, 400);
  });
  return lines.length ? "\nEMAILS WITH THIS CUSTOMER (from the inbox, oldest first):\n" + lines.join("\n") : "";
}

/* ── THE GENERATED ESTIMATE, LINE BY LINE ────────────────────────────────
     "Do this AI reading full generated estimate?"

   It did not. It had the request, the answers, the messages and the scope
   text; not one price line. "Why is labor $9,247?" could not be answered.
   Now every labor and material line goes in as the dashboard shows it (item,
   qty, unit, rate, line total), each service card with its included / you
   supply / not included lists and priced options, the finish groups, what
   the customer chose, the totals the customer sees, the readiness verdict
   with its confidence and open questions, the assumptions, the invoices and
   the contract. Still NOT the internal notes and NOT the markup: an answer
   here is one tap from the customer's reply box. Capped, because the clock. */
const ESTIMATE_CHARS = 9000;
function money(n) { const v = Number(n) || 0; return "$" + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function estimateContext(rec) {
  const est = (rec && rec.estimate) || {};
  const labor = arr(est.labor), materials = arr(est.materials);
  if (!labor.length && !materials.length && !arr(est.serviceBreakdown).length) return "";
  const lines = ["", "THE GENERATED ESTIMATE, AS HE SEES IT IN THE DASHBOARD:"];
  if (str(est.projectTitle)) lines.push("Title: " + str(est.projectTitle));
  if (str(est.timelineText)) lines.push("Timeline: " + str(est.timelineText).slice(0, 300));

  const row = function (l) {
    const qty = Number(l && l.qty) || 0, rate = Number(l && l.rate) || 0;
    return "  " + [str(l && l.section) ? "[" + str(l.section) + "]" : "", str(l && l.item), qty + " " + str(l && l.unit), "@ " + money(rate), "= " + money(qty * rate)].filter(Boolean).join(" | ");
  };
  if (labor.length) { lines.push("", "LABOR LINES (" + labor.length + "):"); labor.forEach(function (l) { lines.push(row(l)); }); }
  if (materials.length) { lines.push("", "MATERIAL LINES (" + materials.length + "):"); materials.forEach(function (l) { lines.push(row(l)); }); }

  let totals = null;
  try { totals = customerTotals(est, rec); } catch (e) { totals = null; }
  if (totals) {
    lines.push("", "TOTALS THE CUSTOMER SEES:",
      "  labor " + (totals.showLabor ? money(totals.laborAmount) : "(hidden from customer)"),
      "  materials " + (totals.showMaterials ? money(totals.materialsAmount) : "(hidden from customer)"),
      "  customer total " + money(totals.customerTotal) + (totals.stampedTotal != null ? " (agreed by the customer)" : ""));
  }

  const list = function (label, items) {
    const a = arr(items).map(function (x) { return str(typeof x === "string" ? x : (x && (x.text || x.item || x.label || x.name))); }).filter(Boolean);
    return a.length ? "    " + label + ": " + a.join("; ") : "";
  };
  const opts = function (o) {
    return arr(o).map(function (x) { return str(x && (x.label || x.title || x.name)) + " " + money(x && x.price) + (str(x && x.description) ? " (" + str(x.description).slice(0, 120) + ")" : ""); }).filter(function (t) { return t.trim() !== money(0); });
  };
  const sb = arr(est.serviceBreakdown);
  if (sb.length) {
    lines.push("", "SERVICE CARDS THE CUSTOMER SEES:");
    sb.forEach(function (s) {
      if (!s) return;
      lines.push("  " + str(s.title) + (s.subtotal != null ? " - " + money(s.subtotal) : ""));
      [list("included", s.included), list("customer supplies", s.customerSupplies), list("NOT included", s.notIncluded)].filter(Boolean).forEach(function (l) { lines.push(l); });
      const o = opts(s.options);
      if (o.length) lines.push("    priced options: " + o.join("; "));
    });
  }
  const topOpts = opts(est.options);
  if (topOpts.length) lines.push("", "ALTERNATIVES OFFERED: " + topOpts.join("; "));

  const fg = arr(est.finishGroups);
  if (fg.length) {
    lines.push("", "FINISH CHOICES OFFERED:");
    fg.forEach(function (g) {
      if (!g) return;
      lines.push("  " + str(g.name) + ": " + arr(g.options).map(function (o) { return str(o && o.name) + (o && o.isDefault ? " (default)" : "") + " " + money(o && o.price); }).join("; "));
    });
  }
  const sel = arr(rec.customerSelections);
  if (sel.length) lines.push("", "WHAT THE CUSTOMER CHOSE: " + sel.map(function (x) { return str(x && x.group) + " = " + str(x && x.option) + (Number(x && x.upgrade) ? " (+" + money(x.upgrade) + ")" : ""); }).join("; "));

  const pr = est.pricingReadiness || {};
  if (str(pr.status) || arr(est.clarificationQuestions).length) {
    lines.push("", "HOW SURE IS THIS ESTIMATE:");
    if (str(pr.status)) lines.push("  " + str(pr.status) + (pr.confidence_score != null ? ", confidence " + Number(pr.confidence_score) + "%" : "") + (str(pr.reason) ? " - " + str(pr.reason).slice(0, 300) : ""));
    const qs = arr(est.clarificationQuestions).map(function (q) { return str(q && (q.question || q)); }).filter(Boolean);
    if (qs.length) lines.push("  open questions: " + qs.join(" | "));
    const tm = est.generationTiming || {};
    if (typeof tm.scopeReused === "boolean") lines.push("  " + (tm.scopeReused ? "scope held from the previous run, only the price was redone" : "the job was re-read this run: " + str(tm.scopeReason)));
    const rr = est.repairReport;
    if (rr && arr(rr.failures).length) lines.push("  checks the first draft failed: " + arr(rr.failures).map(function (f) { return str(typeof f === "string" ? f : (f && (f.message || f.check || f.text))); }).filter(Boolean).join(" | "));
  }
  const as = arr(est.assumptions).map(function (a) { return str(typeof a === "string" ? a : (a && (a.text || a.item))); }).filter(Boolean);
  if (as.length) lines.push("", "ASSUMPTIONS MADE: " + as.join("; "));

  const inv = arr(rec.invoices);
  if (inv.length) lines.push("", "INVOICES: " + inv.map(function (i) { return str(i && (i.number || i.invoiceNumber)) + " " + money(i && i.amount) + " " + str(i && i.status); }).join("; "));
  if (rec.contract) lines.push("CONTRACT: " + (rec.contract.signedAt ? "signed " + str(rec.contract.signedAt).slice(0, 10) : "drafted, not signed"));
  if (str(rec.sentAt)) lines.push("SENT TO CUSTOMER: " + str(rec.sentAt).slice(0, 10));
  if (str(rec.acceptedAt)) lines.push("ACCEPTED: " + str(rec.acceptedAt).slice(0, 10));

  const text = lines.join("\n");
  return text.length > ESTIMATE_CHARS ? text.slice(0, ESTIMATE_CHARS) + "\n  ... (estimate cut here)" : text;
}

/* ── MEMORY ──────────────────────────────────────────────────────────────
   One key in one store: a list of short notes he asked it to keep. */
function memoryStore() {
  return getStore({ name: "assistant-memory", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
}
async function loadMemory() {
  const v = await memoryStore().get("notes", { type: "json" });
  return Array.isArray(v) ? v : [];
}
async function remember(memory, text) {
  const t = str(text).slice(0, 400);
  if (!t) return;
  const next = memory.concat([{ text: t, at: new Date().toISOString() }]).slice(-MEMORY_MAX);
  memory.push({ text: t, at: next[next.length - 1].at });
  await memoryStore().set("notes", JSON.stringify(next));
}

/* ── HISTORY INSIGHTS, written nightly by assistant-learn ───────────────── */
async function loadInsights() {
  const v = await memoryStore().get("insights", { type: "json" });
  return insightsText(v);
}

/* ── SAVED CHATS - see lib/assistant-chat.js ───────────────────────────── */
const chatKeyOf = chat.chatKeyOf, loadChat = chat.loadChat, appendChat = chat.appendChat;

/* ── SEARCH JOBS, written by assistant-search-background ────────────────── */
function jobStore() {
  return getStore({ name: "assistant-jobs", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
}
function jobIdOf(v) {
  const k = str(v);
  return /^[A-Za-z0-9_-]{6,60}$/.test(k) ? k : "";
}

/* ── THE SCREEN, AS TEXT ─────────────────────────────────────────────────
   Built from the snapshot the dashboard sends. Nothing here is fetched. */
function screenContext(sc) {
  if (!sc || typeof sc !== "object") return "";
  const lines = [];
  if (str(sc.today)) lines.push("TODAY (New York): " + str(sc.today));
  lines.push("HE IS LOOKING AT: " + (str(sc.ref) ? "estimate " + str(sc.ref) + " (open)" : "the " + (str(sc.tab) || "all") + " tab"));
  const c = sc.counts && typeof sc.counts === "object" ? sc.counts : null;
  if (c) lines.push("COUNTS: " + Object.keys(c).map(function (k) { return k + " " + c[k]; }).join(", "));

  const ests = arr(sc.estimates);
  if (ests.length) {
    lines.push("", "ALL ESTIMATES (" + ests.length + "), newest first. ref | customer | service | status | customer total | submitted | sent | unpaid | notes:");
    ests.forEach(function (e) {
      if (!e) return;
      lines.push("  " + [str(e.ref), str(e.name), str(e.service), str(e.status), e.total != null ? "$" + Math.round(Number(e.total) || 0) : "-",
        str(e.submitted) || "-", str(e.sent) || "-", Number(e.unpaid) > 0 ? "unpaid $" + Math.round(Number(e.unpaid)) : "-",
        (e.needsReply ? "CUSTOMER WAITING FOR A REPLY" : "") + (e.invoices ? " " + e.invoices + " invoice(s)" : "")].join(" | ").trim());
    });
  }
  const vis = arr(sc.visits);
  if (vis.length) {
    lines.push("", "SITE VISITS (open):");
    vis.forEach(function (v) { if (v) lines.push("  " + [str(v.datetime), str(v.customer), str(v.address), str(v.reason), str(v.ref), v.inCalendar ? "in Google Calendar" : "not in calendar", "id " + str(v.id)].filter(Boolean).join(" | ")); });
  }
  const hm = arr(sc.handyman);
  if (hm.length) {
    lines.push("", "HANDYMAN BOOKINGS:");
    hm.forEach(function (b) { if (b) lines.push("  " + [str(b.ref), str(b.customer), str(b.service), str(b.status), str(b.date) ? "preferred " + str(b.date) : "", str(b.submitted)].filter(Boolean).join(" | ")); });
  }
  if (sc.customers != null) lines.push("", "CUSTOMER DIRECTORY: " + Number(sc.customers) + " people");
  const rec = sc.record && typeof sc.record === "object" ? sc.record : null;
  if (rec) {
    lines.push("", "THE OPEN ESTIMATE, AS THE DASHBOARD SHOWS IT:");
    ["ref", "name", "status", "title", "total", "submitted", "sent", "accepted", "invoices", "unpaid", "contract"].forEach(function (k) {
      if (rec[k] != null && str(rec[k])) lines.push("  " + k + ": " + str(rec[k]));
    });
  }
  const text = lines.join("\n");
  return text.length > SCREEN_CHARS ? text.slice(0, SCREEN_CHARS) + "\n  ... (list cut here)" : text;
}

/* ── ACTIONS ─────────────────────────────────────────────────────────────
   A closed list. The model writes  ACTION: {"type":...}  on its own line at
   the end; anything else on the line, or a type not here, is dropped. A
   truncated answer drops them all: half an action is worse than none. */
const ACTION_TYPES = { open: ["ref"], tab: ["tab"], status: ["ref", "status"], visit: ["customer", "datetime"], draft: ["text"], remember: ["text"], search: ["query"] };
const TABS = ["all", "new", "drafted", "sent", "accepted", "invoiced", "paid", "completed", "declined", "handyman", "visits", "customers"];
const STATUSES = ["new", "drafted", "sent", "accepted", "declined", "completed"];
function extractActions(text, truncated) {
  const actions = [];
  const kept = [];
  String(text || "").split("\n").forEach(function (line) {
    /* Any line that starts with ACTION: is taken off the text, well-formed or
       not - a broken action shown to him as prose is just confusing. */
    const m = /^\s*ACTION:\s*(.*)$/.exec(line);
    if (!m) { kept.push(line); return; }
    if (truncated) return;
    let a = null;
    try { a = JSON.parse(m[1]); } catch (e) { a = null; }
    if (!a || typeof a !== "object") return;
    const type = str(a.type);
    const need = ACTION_TYPES[type];
    if (!need) return;
    if (!need.every(function (k) { return str(a[k]); })) return;
    if (type === "tab" && TABS.indexOf(str(a.tab)) === -1) return;
    if (type === "status" && STATUSES.indexOf(str(a.status)) === -1) return;
    const clean = { type: type };
    Object.keys(a).forEach(function (k) { if (k !== "type") clean[k] = str(a[k]).slice(0, 2000); });
    actions.push(clean);
  });
  return { text: kept.join("\n").trim(), actions: actions };
}

function systemPrompt(context, screen, memory, insights) {
  const notes = arr(memory).map(function (n) { return "- " + str(n && n.text); }).filter(function (l) { return l !== "- "; });
  return [
    "You are the assistant to Zurab, who runs Sani Building Corp, a renovation and repair contractor in Brooklyn serving the five NYC boroughs and Long Island.",
    "You are open inside his own dashboard - on every page of it. You see what he sees, you answer what he asks, and when he tells you to do something the dashboard can do, you do it.",
    "",
    "THE DASHBOARD:",
    "- Tabs: All, New, Drafts, Sent, Accepted, Invoiced, Paid, Completed, Declined, Handyman, Visits, Customers.",
    "- An open estimate has five steps: 1 Customer details (description, photos, this assistant, the conversation with the customer), 2 Generate estimate (the AI estimator, house rules), 3 Review and edit the lines, 4 Send to customer (their quote page), 5 How sure is this estimate.",
    "- Customer replies arrive in the conversation of their estimate and by email to contact@. 'CUSTOMER WAITING FOR A REPLY' in the list means he has not answered yet.",
    "- Site visits live in the Visits tab, go into his Google Calendar, and he gets a reminder email every morning (today) and evening (tomorrow).",
    "- Invoices and contracts are made from an accepted estimate. Handyman bookings come from the small-jobs form.",
    "",
    "WHAT YOU CAN DO (actions). When he asks you to do one of these, do it: answer in one short line, then on its own last line write  ACTION: {json}  - one line per action, nothing after it.",
    "- open an estimate:            ACTION: {\"type\":\"open\",\"ref\":\"SBC-...\"}",
    "- switch tab:                  ACTION: {\"type\":\"tab\",\"tab\":\"sent\"}   (all, new, drafted, sent, accepted, invoiced, paid, completed, declined, handyman, visits, customers)",
    "- change an estimate's status: ACTION: {\"type\":\"status\",\"ref\":\"SBC-...\",\"status\":\"completed\"}   (new, drafted, sent, accepted, declined, completed) - the dashboard asks him to confirm",
    "- schedule a site visit:       ACTION: {\"type\":\"visit\",\"customer\":\"...\",\"address\":\"...\",\"datetime\":\"2026-09-20T10:00\",\"reason\":\"...\",\"ref\":\"SBC-...\"}   (New York time; the dashboard asks him to confirm)",
    "- draft a message to the customer of the OPEN estimate: ACTION: {\"type\":\"draft\",\"text\":\"...\"}   - it goes into the reply box only; HE presses Send after reading it",
    "- remember something for later: ACTION: {\"type\":\"remember\",\"text\":\"...\"}",
    "- SEARCH THE INTERNET:          ACTION: {\"type\":\"search\",\"query\":\"...\"}   - use it whenever the answer needs current information from outside this dashboard: today's price of a product or material, a supplier or store, a building code, permit or co-op rule, a company, an address, the weather, anything that changes over time or that you are not sure of. Also whenever he says 'search online', 'check online', 'google it' or 'look it up'. Write the query the way a good search is written (specific, with New York or the borough when it matters). Say in ONE short line that you are checking online - the answer with its sources arrives in this chat in under a minute - and do not guess the answer yourself in the same reply.",
    "Use the refs, names and ids from the screen below; never invent one. If what he asks is not on this list, say plainly that you cannot do that from here and what he can press instead.",
    "If he asks for a plan, a strategy or an analysis, use the whole list on the screen: who is waiting, what is unpaid, what was sent and never answered, what is due today. Be specific: names and refs.",
    "HIS HISTORY (below, when present) is real data from his own jobs, computed from every estimate. You may quote it - what was accepted at what price, how long jobs took to accept and to finish, who never answered - and use it to judge whether a new estimate is in his usual range, to plan follow-ups and to answer 'what do I usually charge for X'. It also says where his customers are by borough and how each borough answers, so 'is a $20k bathroom likely to be accepted in Queens' has an answer from his own jobs. Say the numbers with their refs. History is not a price for a new job; it is what happened before.",
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
    "- Never invent a price, a rate or a total. He has a pricing system and it is not you. If he asks what something costs, say what the price depends on and what to measure, or tell him to run the estimator. When the estimate's lines are on screen below, you MAY read them back, add them up, compare them and point out what looks off (a quantity, a missing trade, a line that contradicts the customer's words) - that is reading, not pricing.",
    "- Never write as if you are the customer or draft something that pretends to be from them.",
    "- Do not tell him to go and look at the dashboard. He is in it.",
    "",
    notes.length ? "THINGS HE ASKED YOU TO REMEMBER:\n" + notes.join("\n") + "\n" : "",
    context ? context : "No job is open." + (screen ? "" : " Answer whatever he asks."),
    screen ? "\nWHAT IS ON HIS SCREEN:\n" + screen : "",
    insights ? "\nWHAT HIS HISTORY SHOWS (from all his estimates, updated nightly):\n" + insights : "",
  ].filter(Boolean).join("\n");
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
