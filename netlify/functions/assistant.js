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
const inbox = require("./lib/inbox-store");
const history = require("./lib/history");
const reword = require("./lib/reword");
const { customerCards } = require("./lib/customer-cards");
const { contractDrift } = require("./lib/contract-total");

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
/* ══ ONE AI, NOT TWO ═══════════════════════════════════════════════════════
     "why i can't talk to the same AI which doing generates? ... i can give
      direction from the dashboard chat what to update, where to update"
   Inside an open estimate, on the background path (no ten-second clock), the
   chat runs as THE ESTIMATOR: the generator's model (the same ESTIMATOR_MODEL
   setting generate-estimate-background reads), his house rules, room to
   think, and the lines action to change prices. The drawer and the quick
   synchronous path stay on the fast model. */
const ESTIMATOR_MODEL = process.env.ESTIMATOR_MODEL || "claude-opus-5";
const ESTIMATOR_TOKEN_CAP = 16000;
const { jobEmails, emailsText } = require("./lib/job-emails");
const jobDocuments = require("./lib/job-documents");
/* ══ CHECK BEFORE SENDING ══════════════════════════════════════════════════
     "A check before sending compares every line with the emails and plans.
      It flags work for other trades, missing allowances and contradictions."
   The dashboard's "Check before sending" asks this, in the estimate's chat:
   the estimator reads the customer's emails and the plans (both attached
   on this turn) against every line, card, assumption and exclusion. */
const CHECK_RE = /^\s*check before sending\b/i;
const CHECK_NOTE = "THIS IS THE CHECK BEFORE SENDING. Read the customer's emails (block below), the drawings attached to this message, the description and the chat, then every line, card, assumption, exclusion and note of the estimate. Report, numbered, most costly first, each with the line ids and the money: (1) work priced that the emails or plans give to another trade or never ask for; (2) work the emails or plans ask for that is not priced - including allowances they ask for (niches, shelves, glass, bases) and quantities the plans show (rooms, fixtures, tubs, showers) that the lines do not match; (3) contradictions between the lines, the cards, the assumptions, the exclusions and the notes; (4) a customer-supplied item priced as material, or anything priced twice; (5) every question the emails ask the contractor to answer (duration, earliest start, allowances, additional preparation, owner-supplied items) that the estimate does not answer yet. Start with one line: READY TO SEND, or NOT READY - N things to fix. Then send the fixes that are clear as actions in this same answer (lines for money, reword for words); anything that needs his decision or a price only he can set, say it as a question and send no action for it. Never invent a finding: if a list is clean, say it is clean.";
const PLAN_WORDS_RE = /\b(plan|plans|drawing|drawings|pdf|sheet|sheets|dimension|dimensions|takeoff|take-off|layout|measure|square f|sq\.? ?ft|sf)\b/i;
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
const PHOTOS_MS = 6000, PHOTOS_SUFFIX = ":photos";
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

  /* ── THE PHOTOS, PARKED FIRST ────────────────────────────────────────────
       "No answer came back (HTTP 413)". A background function takes only a
       small request body; a tall screenshot in five readable pieces is a
       megabyte or more. So the page sends the pictures HERE first (a
       synchronous function takes 6 MB), they are parked in the job store
       under the job id, and the background job collects them by id. */
  if (str(body.action) === "photos") {
    const id = jobIdOf(body.job);
    if (!id) return json(400, { error: "Which job?" });
    const images = imagesOf(body.images);
    if (!images.length) return json(400, { error: "No readable picture in that upload" });
    try { await withTimeout(jobStore().set(id + PHOTOS_SUFFIX, JSON.stringify(images)), PHOTOS_MS); }
    catch (e) { return json(502, { error: "Could not keep the photo for the assistant. Try again." }); }
    return json(200, { ok: true, job: id, images: images.length, photos: photoCount(images) });
  }

  if (!turns.length) return json(400, { error: "Nothing to answer" });

  try {
    const out = await answer(body, { deadline: started + budgetMs, recordMs: RECORD_MS, memoryMs: MEMORY_MS, chatWriteMs: CHAT_WRITE_MS });
    return json(200, out);
  } catch (err) {
    console.error("assistant error:", err && err.message);
    return json(502, { error: str(err && err.message) || "The assistant could not be reached" });
  }
};

/* ── ONE ANSWER, ON WHATEVER CLOCK THE CALLER HAS ────────────────────────
   The synchronous handler above runs this on the 8.8s budget and returns
   whatever arrived, marked truncated when the clock cut it. assistant-
   background.js runs the SAME function on a ninety-second clock and stores
   the whole answer in the job store for the dashboard to collect - so an
   answer is never cut short by the platform, only by MAX_TOKENS.

   The record, the memory and the history insights are read side by side,
   each on its own short clock; any of them missing still leaves a working
   assistant. Throws with a message meant for him. */
async function answer(body, clocks) {
  const c = clocks || {};
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set in Netlify.");
  const turns = arr(body.messages)
    .map(function (m) { return { role: m && m.role === "assistant" ? "assistant" : "user", text: str(m && m.text) }; })
    .filter(function (m) { return m.text; })
    .slice(-TURNS_SENT);
  if (!turns.length) throw new Error("Nothing to answer");

  /* ── A PHOTO OR SCREENSHOT WITH THE QUESTION ────────────────────────────
       "sometimes for updates i can upload screenshots for my AI for
        understanding what we need to update in estimate after customer
        requests"
     Up to three photos ride with the question and are shown to the model
     on its LAST user turn, as image blocks before the text. A tall
     screenshot arrives as several pieces (image.photo says which photo a
     piece belongs to), so the blocks can outnumber the photos. They are
     not kept: the saved chat gets a "[📷 photo attached]" mark counting
     photos, the job store gets the answer only. */
  let images = imagesOf(body.images);
  if (!images.length && jobIdOf(body.photos)) images = imagesOf(await withTimeout(takePhotos(jobIdOf(body.photos)), PHOTOS_MS).catch(function () { return []; }));
  const lastUser = turns.filter(function (t) { return t.role === "user"; }).slice(-1)[0];
  if (images.length && lastUser) lastUser.images = images;
  /* WHEN DID THIS CHAT LAST ANSWER? The saved chat carries a time on every
     turn. Everything recorded on the estimate after the last answer is
     listed on his message as SINCE YOUR LAST ANSWER, so the model starts
     from what changed instead of from what it said before. */
  const chatKeyEarly = chatKeyOf(body.chat);
  const lastAnswerAt = chatKeyEarly ? await withTimeout(loadChat(chatKeyEarly), c.memoryMs || MEMORY_MS).then(function (turns) {
    const a = turns.filter(function (t) { return t.role === "assistant" && t.at; }).slice(-1)[0];
    return a ? a.at : "";
  }).catch(function () { return ""; }) : "";
  const estimatorOn = c.estimator === true && !!str(body.ref);
  const reads = await Promise.all([
    str(body.ref) ? withTimeout(recordContext(str(body.ref), c.estimateChars, c.jobPhotos, lastAnswerAt), c.recordMs || RECORD_MS).catch(function () { return ""; }) : Promise.resolve(""),
    withTimeout(loadMemory(), c.memoryMs || MEMORY_MS).catch(function () { return []; }),
    withTimeout(loadInsights(), c.memoryMs || MEMORY_MS).catch(function () { return ""; }),
    withTimeout(inboxContext(str(body.ref), lastUser ? lastUser.text : ""), c.recordMs || RECORD_MS).catch(function () { return ""; }),
    estimatorOn ? withTimeout(loadHouseRules(), c.memoryMs || MEMORY_MS).catch(function () { return ""; }) : Promise.resolve(""),
    estimatorOn ? withTimeout(loadRecord(str(body.ref)), c.recordMs || RECORD_MS).catch(function () { return null; }) : Promise.resolve(null),
  ]);
  /* ── THE ESTIMATOR READS HER EMAILS AND THE PLANS ─────────────────────────
     Her emails about this job in full (lib/job-emails.js), every time. The
     PDF plans (lib/job-documents.js) on the turns that need them - the check
     before sending, or a message about the plans - because a plan set is
     tens of pages and every turn would pay for it. */
  const jobRec = reads[5];
  const jobMail = estimatorOn && jobRec ? await withTimeout(jobEmails(jobRec), c.recordMs || RECORD_MS).catch(function () { return []; }) : [];
  const isCheck = estimatorOn && !!lastUser && CHECK_RE.test(lastUser.text);
  const wantsPlans = estimatorOn && !!lastUser && (isCheck || PLAN_WORDS_RE.test(lastUser.text));
  const docBlocks = wantsPlans && jobRec ? jobDocuments.documentBlocks(jobRec.request, jobRec) : [];
  if (docBlocks.length && lastUser) lastUser.docs = docBlocks;
  const context = reads[0] && typeof reads[0] === "object" ? reads[0].text : reads[0];
  const glance = reads[0] && typeof reads[0] === "object" ? str(reads[0].glance) : "";
  const since = reads[0] && typeof reads[0] === "object" ? str(reads[0].since) : "";
  if (glance && lastUser) lastUser.note = "[" + glance + "]" + (since ? "\n[" + since + "]" : "");
  /* the job's own photos ride on his latest message too, before any picture
     he uploaded with the question; never written to the chat */
  const jobImages = reads[0] && typeof reads[0] === "object" ? arr(reads[0].photos) : [];
  /* ── "OKAY GO AND FIX IT" ────────────────────────────────────────────────
       He said yes to the assistant's own last answer, and the assistant
       re-read the floor-plan photos riding on that message and answered
       about them instead: "Now I see the actual layout clearly..." A short
       yes is about the last answer, nothing else: the job's photos stay off
       this turn (they were shown on the turn before) and the message
       carries a note saying what the yes means. */
  const confirm = !!lastUser && isConfirmation(lastUser.text) && turns.some(function (t, i) { return t.role === "assistant" && i < turns.length - 1; });
  if (jobImages.length && lastUser && !confirm) lastUser.jobImages = jobImages;
  if (confirm && lastUser) lastUser.note = (lastUser.note ? lastUser.note + "\n" : "") + "[" + CONFIRM_NOTE + "]";
  const memory = reads[1];
  const insights = reads[2];
  const inboxText = reads[3];
  const screen = screenContext(body.screen);

  /* after the ESTIMATE RIGHT NOW note, which is written above */
  if (isCheck) lastUser.note = (lastUser.note ? lastUser.note + "\n" : "") + "[" + CHECK_NOTE + "]";
  const deadline = c.deadline || (Date.now() + budgetMs);
  const system = systemPrompt(context, screen, memory, insights, inboxText, estimatorOn ? { on: true, houseRules: reads[4], emails: jobMail, drawings: docBlocks.length / 2 } : null);
  const how = estimatorOn ? { model: ESTIMATOR_MODEL, think: true } : null;
  const maxTokens = estimatorOn ? Math.max(c.maxTokens || 0, ESTIMATOR_TOKEN_CAP) : c.maxTokens;
  let out;
  try {
    out = await callClaude(apiKey, system, turns, deadline, maxTokens, how);
  } catch (e) {
    /* a plan file the API refuses (too many pages, unreachable) never costs
       the answer: once more without the drawings */
    if (!(lastUser && lastUser.docs)) throw e;
    delete lastUser.docs;
    lastUser.note = (lastUser.note ? lastUser.note + "\n" : "") + "[The drawings could not be attached this time (" + str(e && e.message).slice(0, 120) + "); say so, and check against the emails and the estimate.]";
    out = await callClaude(apiKey, system, turns, deadline, maxTokens, how);
  }
  let parsed = extractActions(out.text, out.truncated === true);
  /* ── "FIXING THE SUMMARY LINE NOW" - AND NOTHING WAS SENT ────────────────
       The answer said it was fixing; it carried no ACTION line, so nothing
       changed and no confirm bubble appeared. The rule is in the prompt and
       the model broke it anyway. When an answer claims to act and sends
       nothing, it is asked once more, in the same conversation, for the
       ACTION lines only; those actions ride with the first answer's words. */
  if (!parsed.actions.length && out.truncated !== true && claimsToAct(parsed.text) && deadline - Date.now() > NUDGE_MIN_MS) {
    try {
      const again = await callClaude(apiKey, system, turns.concat([{ role: "assistant", text: out.text }, { role: "user", text: NUDGE }]), deadline, maxTokens, how);
      const p2 = extractActions(again.text, again.truncated === true);
      if (p2.actions.length) parsed = { text: parsed.text, actions: p2.actions, nudged: true };
    } catch (e) { /* the first answer stands */ }
  }
  if (!parsed.text && !parsed.actions.length) throw new Error("The assistant's answer had no words in it (" + out.text.length + " chars, stop: " + (out.stopReason || "none") + "). Try again.");

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
    const mark = last.images ? " [📷 " + photoCount(last.images) + " photo" + (photoCount(last.images) > 1 ? "s" : "") + " attached]" : "";
    await withTimeout(appendChat(chatKey, last.role === "user" ? last.text + mark : "", replyText), c.chatWriteMs || CHAT_WRITE_MS).catch(function () { /* one turn lost, answer kept */ });
  }
  return { reply: replyText, truncated: out.truncated === true, actions: toClient, estimator: estimatorOn };
}
exports.answer = answer;

/* The estimate record, for the emails and the plans of the estimator. */
async function loadRecord(ref) {
  if (!ref) return null;
  return getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN }).get(ref, { type: "json" });
}

/* His house rules - the pricing notes the generator is given (house-rules.js
   keeps them in the estimates store) - for the chat in estimator mode. */
async function loadHouseRules() {
  const d = await getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN }).get("house-rules", { type: "json" });
  return str(d && d.rules);
}
/* The ChatGPT connector (chatgpt-mcp.js) reads an estimate through the same
   eyes as Ask AI, and writes to the same standing memory. */
exports.recordContext = function (ref, estimateChars, jobPhotos, sinceAt) { return recordContext(ref, estimateChars, jobPhotos, sinceAt); };
exports.loadMemory = function () { return loadMemory(); };
exports.remember = function (memory, text) { return remember(memory, text); };
exports.loadInsights = function () { return loadInsights(); };
exports._isConfirmation = function (t) { return isConfirmation(t); };
exports._claimsToAct = function (t) { return claimsToAct(t); };

const IMAGE_MAX = 15; /* three photos, each in up to five pieces */
const IMAGE_CHARS = 2600000; /* ~1.9 MB of image per picture, base64 */
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
/* { data, mediaType } - data as bare base64 or as a data: URL. Anything that
   is not a picture of a known type, or is too big, is left out. */
function imagesOf(list) {
  const out = [];
  arr(list).slice(0, 30).forEach(function (im) {
    if (out.length >= IMAGE_MAX || !im || typeof im !== "object") return;
    let data = str(im.data), type = str(im.mediaType || im.media_type).toLowerCase();
    const m = /^data:(image\/[a-z]+);base64,(.*)$/is.exec(data);
    if (m) { type = type || m[1].toLowerCase(); data = m[2]; }
    if (type === "image/jpg") type = "image/jpeg";
    if (IMAGE_TYPES.indexOf(type) === -1) return;
    data = data.replace(/\s+/g, "");
    if (!data || data.length > IMAGE_CHARS || !/^[A-Za-z0-9+/]+=*$/.test(data)) return;
    const photo = Number(im.photo);
    out.push({ data: data, mediaType: type, photo: photo > 0 ? Math.floor(photo) : out.length + 1 });
  });
  return out;
}
exports._imagesOf = imagesOf;
function photoCount(images) {
  const seen = {};
  arr(images).forEach(function (im) { seen[im.photo] = true; });
  return Object.keys(seen).length;
}
exports._photoCount = photoCount;

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
async function recordContext(ref, estimateChars, jobPhotos, sinceAt) {
  const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
  const rec = await store.get(ref, { type: "json" });
  if (!rec) return "";

  const req = rec.request || {}, cust = rec.customer || {}, est = rec.estimate || {};
  const pics = jobPictures(rec, Number(jobPhotos) > 0 ? Number(jobPhotos) : 0);
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

  const text = [
    "THE JOB ON SCREEN",
    "Reference: " + str(rec.ref),
    "Status: " + str(rec.status),
    rec.parentRef ? "THIS IS ADDITIONAL WORK to estimate " + str(rec.parentRef) + ", which the customer already agreed to and which stays as it is: price and describe only the new work here." : "",
    arr(rec.addonRefs).length ? "Additional work made for this estimate (separate estimates, priced on their own): " + arr(rec.addonRefs).map(str).join(", ") : "",
    "Came from: " + (str(rec.source) === "contact-form" ? "the contact form (no follow-up questions were asked)" : "the estimate form"),
    "Customer: " + str(cust.name),
    "Address: " + (str(cust.address) || "not given"),
    "Service asked for: " + (str(req.service) || "not given"),
    "Photos on this job: " + pics.total + (pics.total ? " (" + pics.parts.join(", ") + ")" + (pics.shown.length ? " - " + (pics.shown.length < pics.total ? "the first " + pics.shown.length + " are" : "they are") + " shown to you on his latest message, each labelled 'Job photo'" : " - not shown on this quick path; they are shown when he asks with Ask AI") : ""),
    "",
    "WHAT THE CUSTOMER WROTE:",
    str(req.description) || "(nothing)",
    answerLines.length ? "\nANSWERS THEY ALREADY GAVE:\n" + answerLines.join("\n") : "",
    thread.length ? "\nMESSAGES SO FAR:\n" + thread.join("\n") : "",
    historyBlock(rec),
    await emailContext(rec),
    /* The scope is the customer-facing text he asks to have reworded: the
       background answer gets it whole (it is rarely past 8,000 characters),
       the nine-second answer keeps the short cut. */
    str(est.scopeOfWork) ? "\nSCOPE OF WORK (the customer reads this text; quote it exactly in a reword):\n" + cutText(str(est.scopeOfWork), Number(estimateChars) > ESTIMATE_CHARS ? 8000 : 1200) : "",
    estimateContext(rec, estimateChars),
    contractContext(rec),
  ].filter(Boolean).join("\n");
  return { text: text, glance: estimateGlance(rec), photos: pics.shown, since: sinceLastAnswer(rec, sinceAt) };
}

/* ── WHAT CHANGED SINCE THIS CHAT LAST ANSWERED ──────────────────────────
     "He needs to see all new fresh and old informations!! He needs to
      track all updates specially in each estimate!!!"
   Every write to the record leaves a history line with a time. The lines
   after the chat's last answer are the tracker: a save, a reword, a card
   change, a message, an email, a signature, an invoice. Nothing recorded
   but a newer updatedAt means something was saved without a note - the
   block is fresh anyway, and the model is told to read it as such. */
function sinceLastAnswer(rec, sinceAt) {
  const at = str(sinceAt);
  if (!at) return "";
  const when = at.slice(0, 16).replace("T", " ");
  const lines = arr(rec && rec.history).filter(function (x) { return x && x.text && str(x.at) > at; });
  if (lines.length) {
    return "SINCE YOUR LAST ANSWER (" + when + "): " + lines.length + " change" + (lines.length === 1 ? "" : "s") + " on this estimate - " +
      lines.slice(-12).map(function (x) { return str(x.at).slice(11, 16) + " " + str(x.kind) + ": " + str(x.text); }).join(" | ") +
      ". Start from these; the estimate block is the state after them.";
  }
  if (str(rec && rec.updatedAt) > at) return "SINCE YOUR LAST ANSWER (" + when + "): the estimate was saved at " + str(rec.updatedAt).slice(0, 16).replace("T", " ") + " with no history line; read the estimate block below as the current state, not your earlier answer.";
  return "SINCE YOUR LAST ANSWER (" + when + "): nothing changed on this estimate.";
}

/* ── THE CONTRACT ─────────────────────────────────────────────────────────
     "can you read contract too?" - "I can't open or read the contract PDF
      itself from here."
   It was on the record all along: record.contract.sections is the
   agreement the customer signs, with its own scope lines, materials,
   timeline, payment schedule and clauses, built from the estimate and
   edited separately. Printed whole, with the total, whether it is signed,
   and whether the estimate has moved away from it (lib/contract-total). */
function contractContext(rec) {
  const ct = rec && rec.contract && typeof rec.contract === "object" ? rec.contract : null;
  if (!ct || !ct.sections) return "";
  const s = ct.sections;
  const lines = ["", "THE CONTRACT (the customer signs this to approve; built from the estimate, edited on its own; every line is printed word for word - a reword with where contractscope / contractmaterials / contracttimeline / contracttype / contractclause changes its words, never its amounts):"];
  lines.push("Contract total: " + money(ct.total) + (ct.signed ? " - SIGNED by " + str(ct.signed.name) + " on " + str(ct.signed.at).slice(0, 10) + "; a signed contract is never changed" : " - not signed yet") + (str(ct.updatedAt || ct.generatedAt) ? " (last edited " + str(ct.updatedAt || ct.generatedAt).slice(0, 10) + ")" : ""));
  try {
    const d = contractDrift(rec);
    if (d && d.drifted) lines.push("THE ESTIMATE HAS MOVED AWAY FROM THE CONTRACT: estimate total " + money(d.estimateTotal) + ", contract total " + money(d.contractTotal) + " - " + (d.signed ? "it is signed, so this is a new agreement and his decision; say it plainly" : "he can press Update contract total in the contract panel; say so"));
  } catch (e) { /* no drift line */ }
  if (str(s.projectType)) lines.push("Project type: " + str(s.projectType));
  const list = function (label, items) { const a = arr(items).map(function (x) { return str(typeof x === "string" ? x : (x && (x.text || x.item))); }).filter(Boolean); if (a.length) { lines.push(label + " (" + a.length + "):"); a.forEach(function (t) { lines.push("  - " + t); }); } };
  list("Contract scope of work", s.scopeOfWork);
  list("Contract materials & finishes", s.materialsList);
  if (str(s.timeline)) lines.push("Contract timeline: " + str(s.timeline));
  const pay = arr(s.paymentSchedule).filter(Boolean);
  if (pay.length) {
    const sum = pay.reduce(function (a, p) { return a + (Number(p.amount) || 0); }, 0);
    lines.push("Payment schedule (" + pay.length + " rows, " + money(sum) + (Math.abs(sum - (Number(ct.total) || 0)) > 0.5 ? " - DOES NOT MATCH the contract total" : " = the contract total") + "):");
    pay.forEach(function (p) { lines.push("  - " + str(p.label) + ": " + money(p.amount)); });
  }
  const cl = s.clauses && typeof s.clauses === "object" ? s.clauses : {};
  const names = { hiddenConditions: "Hidden & concealed conditions", changeOrder: "Change orders", warranty: "Warranty", cancellation: "Cancellation", permitsAndInsurance: "Permits & insurance" };
  Object.keys(names).forEach(function (k) { if (str(cl[k])) lines.push(names[k] + " clause: " + cutText(str(cl[k]), 700)); });
  return lines.join("\n");
}

/* ── THE JOB'S OWN PHOTOS ─────────────────────────────────────────────────
     "Can you read quote photos in this estimate?" - "No, this estimate has
      0 photos attached." It had photos on the quote; only the request's
      photos were counted, and none of them was ever shown to the model.
   Pictures live in three places: request.photos (the customer's form, with
   a shot label), estimate.quotePhotos (attached to the quote by Sani) and
   the images on thread messages. All are counted; the first max of them go
   on his latest message as image blocks, each after a one-line label, so
   "Job photo 2 - a close-up" and the picture are read together. Same
   accepted forms as the estimator: a data: URL of a known type, or an
   https URL that is not a PDF or HEIC. */
const JOB_PHOTO_SHOTS = { wide: "the whole room from the doorway", area: "the whole wall / floor / section to be worked on", close: "a close-up of the damage or detail", scale: "a shot with a tape measure for scale" };
function imageSourceOf(data) {
  const d = str(data);
  const m = /^data:(image\/(?:jpeg|jpg|png|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(d);
  if (m) {
    const b64 = m[2].replace(/\s+/g, "");
    if (!b64 || b64.length > IMAGE_CHARS) return null;
    return { type: "base64", media_type: m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase(), data: b64 };
  }
  if (/^https?:\/\//i.test(d) && !/\.(pdf|heic|heif)(?:[?#]|$)/i.test(d)) return { type: "url", url: d };
  return null;
}
function jobPictures(rec, max) {
  const req = (rec && rec.request) || {}, est = (rec && rec.estimate) || {};
  const list = [], counts = { request: 0, quote: 0, messages: 0 };
  arr(req.photos).forEach(function (p) {
    if (!p || p.kind === "file") return;
    const src = imageSourceOf(p.data); if (!src) return;
    counts.request++;
    list.push({ source: src, label: "sent by the customer with the request" + (JOB_PHOTO_SHOTS[str(p.slot)] ? ": " + JOB_PHOTO_SHOTS[str(p.slot)] : "") + (str(p.name) ? " (" + str(p.name).slice(0, 60) + ")" : "") });
  });
  arr(est.quotePhotos).forEach(function (p) {
    const q = typeof p === "string" ? { data: p } : p;
    const src = q && imageSourceOf(q.data); if (!src) return;
    counts.quote++;
    list.push({ source: src, label: "attached to the quote by Sani" + (str(q.name) ? " (" + str(q.name).slice(0, 60) + ")" : "") });
  });
  arr(rec && rec.thread).forEach(function (m) {
    arr(m && m.attachments).forEach(function (a) {
      if (!a || a.kind !== "image") return;
      const src = imageSourceOf(a.url || a.data); if (!src) return;
      counts.messages++;
      list.push({ source: src, label: "sent " + (m.from === "contractor" ? "by Sani" : "by the customer") + " in a message" + (str(a.name) ? " (" + str(a.name).slice(0, 60) + ")" : "") });
    });
  });
  const parts = [];
  if (counts.request) parts.push(counts.request + " sent by the customer with the request");
  if (counts.quote) parts.push(counts.quote + " attached to the quote by Sani");
  if (counts.messages) parts.push(counts.messages + " in messages");
  const shown = list.slice(0, Math.max(0, Number(max) || 0)).map(function (x, i) { return { source: x.source, label: "Job photo " + (i + 1) + " of " + list.length + " - " + x.label }; });
  return { total: list.length, parts: parts, shown: shown };
}
exports._jobPictures = jobPictures;

/* ── THE STORY OF THE ESTIMATE, AND WHAT MOVED SINCE THE LAST SEND ────────
     "let him check old history too for analyze situation and knows what's
      was change and whats need to change"
   Every write to a record leaves a line in record.history (lib/history.js):
   sent, accepted, regenerated, reworded, added, removed, edited. The last
   twenty-five go in, oldest first. And the frozen sent version is compared
   with the estimate now - lines added, lines gone, cards added, the total
   then and now - so "what changed since I sent it" is answered from data,
   not from memory. */
function historyBlock(rec) {
  const out = [];
  const h = history.lines(rec, 25);
  if (h.length) out.push("\nHISTORY OF THIS ESTIMATE (oldest first, what happened and when):\n" + h.join("\n"));
  const sv = rec && rec.sentVersion && typeof rec.sentVersion === "object" ? rec.sentVersion : null;
  if (sv && sv.estimate) {
    const est = rec.estimate || {}, was = sv.estimate || {};
    const names = function (list) { return arr(list).map(function (l) { return str(l && l.item); }).filter(Boolean); };
    const nowL = names(est.labor).concat(names(est.materials)), wasL = names(was.labor).concat(names(was.materials));
    const added = nowL.filter(function (x) { return wasL.indexOf(x) === -1; }), gone = wasL.filter(function (x) { return nowL.indexOf(x) === -1; });
    const cardsNow = arr(est.serviceBreakdown).map(function (c) { return str(c && c.title); }), cardsWas = arr(was.serviceBreakdown).map(function (c) { return str(c && c.title); });
    const newCards = cardsNow.filter(function (c) { return cardsWas.indexOf(c) === -1; }), goneCards = cardsWas.filter(function (c) { return cardsNow.indexOf(c) === -1; });
    let tNow = null, tWas = null;
    try { tNow = customerTotals(est, rec).customerTotal; tWas = customerTotals(was, { customerFinalTotal: sv.customerFinalTotal }).customerTotal; } catch (e) { tNow = tWas = null; }
    const parts = [];
    if (newCards.length) parts.push("cards added: " + newCards.join(", "));
    if (goneCards.length) parts.push("cards removed: " + goneCards.join(", "));
    parts.push(added.length + " lines added" + (added.length ? " (" + added.slice(0, 6).join("; ").slice(0, 300) + (added.length > 6 ? "; ..." : "") + ")" : ""));
    parts.push(gone.length + " lines removed" + (gone.length ? " (" + gone.slice(0, 6).join("; ").slice(0, 300) + (gone.length > 6 ? "; ..." : "") + ")" : ""));
    if (tWas != null && tNow != null) parts.push("customer total then " + money(tWas) + ", now " + money(tNow));
    out.push("\nSINCE THE LAST SEND (version " + (Number(sv.n) || 1) + ", " + str(sv.at).slice(0, 10) + "): " + parts.join("; ") + (!added.length && !gone.length && !newCards.length && !goneCards.length ? " - nothing on the estimate has changed since" : ""));
  }
  return out.join("\n");
}

/* ── THE ESTIMATE RIGHT NOW, IN ONE LINE, ON HIS LATEST MESSAGE ───────────
     "This my ai is crazy, doesn't read on opened estimate real estimate"
   It read it. It also re-read thirty earlier turns of this chat, every one
   describing the estimate as it was an hour ago - "34 lines, $23,582.94,
   three cards" - and a model trusts the conversation over a block in its
   system prompt. So the current figures ride on his LATEST message, the
   most recent thing it reads: line counts, the customer total, every card
   with its price, what was added after agreement, when the record was
   last saved. Not stored in the chat; built fresh on every question. */
function estimateGlance(rec) {
  const r = rec || {}, est = r.estimate || {};
  const labor = arr(est.labor), materials = arr(est.materials);
  if (!labor.length && !materials.length && !arr(est.serviceBreakdown).length) return "";
  let total = null;
  try { total = customerTotals(est, r).customerTotal; } catch (e) { total = null; }
  /* the same card prices the customer reads (lib/customer-cards.js) */
  let cards = [];
  try { cards = customerCards(r).cards.filter(function (c) { return !c.folded; }); } catch (e) { cards = []; }
  const adds = arr(est.addedServices).map(function (x) { return arr(x && x.titles).join(", "); }).filter(Boolean);
  return "ESTIMATE RIGHT NOW (" + str(r.ref) + ", as stored" + (str(r.updatedAt) ? ", last saved " + str(r.updatedAt).slice(0, 16).replace("T", " ") : "") + "): " +
    labor.length + " labor lines, " + materials.length + " material lines" + (total != null ? ", customer total " + money(total) : "") +
    "; " + cards.length + " card" + (cards.length === 1 ? "" : "s") + " as the customer sees them: " + (cards.map(function (c) { return str(c.title) + " " + money(c.subtotal); }).join("; ") || "none") +
    (adds.length ? "; added after the customer agreed: " + adds.join("; ") : "; nothing added after the customer agreed") +
    ". This is the current truth; earlier turns of this chat may describe an older state.";
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
  /* "Can you found emails he send me?" answered "I can only see what's
     loaded on this estimate". Say what is actually the case: the inbox log
     holds nothing from this address (yet), or the log could not be read. */
  if (!lines.length) {
    return "\nEMAILS WITH THIS CUSTOMER: " + (Array.isArray(rows) && rows.length
      ? "the only ones in the inbox log are already in MESSAGES SO FAR above."
      : "none in the inbox log from " + email + " (the inbox is synced every 15 minutes; a mail from a different address than the one on this request would not be matched).");
  }
  return "\nEMAILS WITH THIS CUSTOMER (from the inbox, oldest first):\n" + lines.join("\n");
}

/* ── THE WHOLE INBOX ─────────────────────────────────────────────────────
     "Let's my AI read all emails direct from gmail, then AI can pull out
      any necessary information need for better estimate or update in
      estimate after customer request by email"
   inbox-sync keeps the assistant's own copy of the info@ mailbox (lib/
   inbox-store.js): every inbound email, whoever sent it, matched to an
   estimate by ref, address or name. On every question the newest 25 go in
   as one line each, and the FULL TEXT of the ones that matter: the emails
   about the open job, and the emails whose sender, subject or words match
   what he asked ("what did Rafael write?"). Plus this morning's action
   list, when there is one. Capped, because the clock. */
const INBOX_LINES = 25;
const INBOX_FULL = 4;
const INBOX_FULL_CHARS = 1800;
async function inboxContext(ref, question) {
  const idx = await inbox.loadIndex();
  if (!idx.items.length) return "\nTHE INBOX (info@, read every 15 minutes): nothing stored yet.";
  const lines = inbox.indexLines(idx, INBOX_LINES);
  const about = ref ? idx.items.filter(function (x) { return x.ref === ref && x.kind !== "notification"; }).slice(0, 3) : [];
  const rel = inbox.pickRelevant(idx, question, ref, 3);
  const seen = {}, want = [];
  about.concat(rel).forEach(function (x) { if (x && !seen[x.key] && want.length < INBOX_FULL) { seen[x.key] = 1; want.push(x); } });
  const full = await Promise.all(want.map(function (x) { return inbox.loadMail(x.key).catch(function () { return null; }); }));
  const blocks = full.filter(Boolean).map(function (m) {
    return "--- " + str(m.at).slice(0, 16).replace("T", " ") + " | " + (m.name ? m.name + " <" + m.from + ">" : m.from) + " | " + (m.subject || "(no subject)") + (m.ref ? " | about " + m.ref : "") + "\n" + str(m.text).slice(0, INBOX_FULL_CHARS);
  });
  let digest = "";
  try { const d = await inbox.store().get("digest-latest", { type: "json" }); if (d && str(d.text)) digest = "\nTHIS MORNING'S ACTION LIST (" + str(d.at).slice(0, 10) + "):\n" + str(d.text).slice(0, 1500); } catch (e) { digest = ""; }
  return "\nTHE INBOX (info@ and every Gmail he connected on the dashboard, every inbound email, read every 15 minutes; newest " + lines.length + " shown, one per line: date | from | subject | estimate | mailbox | snippet; no mailbox named means info@):\n" + lines.join("\n") +
    (blocks.length ? "\n\nFULL TEXT OF THE EMAILS THAT MATTER HERE:\n" + blocks.join("\n") : "") + digest;
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
/* The synchronous answer has nine seconds and keeps the estimate short; the
   background answer has ninety and is handed the WHOLE estimate (clocks.
   estimateChars). "I can only read what's shown to me on screen ... the
   painting section isn't in the data I have": the section he added sat past
   the cut, and the model, seeing a cut estimate, described the part it had
   as the whole. */
const ESTIMATE_CHARS = 9000;
function money(n) { const v = Number(n) || 0; return "$" + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
/* A text cut that says it was cut, so the model never quotes a half phrase
   as the whole. */
function cutText(t, n) { const s = str(t); return s.length > n ? s.slice(0, n) + " ... (" + (s.length - n) + " more characters not shown)" : s; }
/* Published cards whose wording is not the same as the estimator's card of
   the same name (or that have no such card). Lines toggled off are hidden
   from the customer and are left out. */
function publishedDifferences(est, publishedIsBase) {
  const pub = est && est.customerScopePublished === true && est.publishedCustomerScope ? arr(est.publishedCustomerScope.services) : [];
  if (!pub.length) return [];
  const norm = function (v) { return str(v).toLowerCase().replace(/\s+/g, " "); };
  const texts = function (items) { return arr(items).map(function (x) { return norm(typeof x === "string" ? x : (x && (x.text || x.item || x.label || x.name))); }).filter(Boolean).join(" | "); };
  const row = function (s) { return { name: s.name || s.title, included: s.included || s.items, supplied: s.supplied || s.customerSupplies, excluded: s.excluded || s.notIncluded }; };
  /* the two copies, normalised to one shape; the "other" side is printed
     where it differs from the side the cards above were printed from */
  const pubRows = pub.filter(Boolean).map(row), sbRows = arr(est.serviceBreakdown).filter(Boolean).map(row);
  const base = publishedIsBase ? pubRows : sbRows, other = publishedIsBase ? sbRows : pubRows;
  const byName = {};
  base.forEach(function (s) { byName[norm(s.name)] = s; });
  return other.filter(function (o) {
    const b = byName[norm(o.name)];
    if (!b) return true;
    return texts(o.included) !== texts(b.included) || texts(o.supplied) !== texts(b.supplied) || texts(o.excluded) !== texts(b.excluded);
  });
}
function estimateContext(rec, chars) {
  const est = (rec && rec.estimate) || {};
  const labor = arr(est.labor), materials = arr(est.materials);
  if (!labor.length && !materials.length && !arr(est.serviceBreakdown).length) return "";
  const lines = ["", "THE GENERATED ESTIMATE, AS HE SEES IT IN THE DASHBOARD:"];
  /* The free-text fields the customer reads, word for word: a reword names
     the phrase to replace, so the model must have the text as stored. "I only
     have card names and lines, not the free-text summary field." */
  if (str(est.projectTitle)) lines.push("Title: " + str(est.projectTitle));
  if (str(est.summary)) lines.push("Summary (the customer sees this text; quote it exactly in a reword): " + cutText(str(est.summary), 1500));
  if (str(est.timelineText)) lines.push("Timeline (the customer sees this text): " + cutText(str(est.timelineText), 600));
  if (str(est.customerTimeline) && str(est.customerTimeline) !== str(est.timelineText)) lines.push("Customer timeline note: " + cutText(str(est.customerTimeline), 400));

  /* Each line carries its id - L1.. for labor, M1.. for materials - so a
     "lines" action can name exactly the one line to change. */
  const row = function (id) {
    return function (l, i) {
      const qty = Number(l && l.qty) || 0, rate = Number(l && l.rate) || 0;
      return "  " + id + (i + 1) + " | " + [str(l && l.section) ? "[" + str(l.section) + "]" : "", str(l && l.item), qty + " " + str(l && l.unit), "@ " + money(rate), "= " + money(qty * rate)].filter(Boolean).join(" | ");
    };
  };
  /* The ids are new; the header is as it was. The margin is still never in
     this prompt (the assistant drafts customer messages): the dashboard's
     Apply card shows him the customer price of every change. */
  if (labor.length) { lines.push("", "LABOR LINES (" + labor.length + "):"); labor.forEach(function (l, i) { lines.push(row("L")(l, i)); }); }
  if (materials.length) { lines.push("", "MATERIAL LINES (" + materials.length + "):"); materials.forEach(function (l, i) { lines.push(row("M")(l, i)); }); }

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
  /* THE CARD PRICES ARE THE ONES THE CUSTOMER READS. serviceBreakdown[].subtotal
     is written at publish time and never read back; the customer's page scales
     every card to the headline total (a hand-set total moves them all). The
     assistant once called that scaling "a $20k mismatch to fix before you
     send". lib/customer-cards.js does the page's arithmetic here. */
  let cc = null;
  try { cc = customerCards(rec); } catch (e) { cc = null; }
  const cards = cc ? cc.cards : [];
  if (cards.length) {
    const sharedWork = arr(est.projectIncluded).map(function (x) { return str(typeof x === "string" ? x : (x && (x.text || x.item))); }).filter(Boolean);
    if (sharedWork.length) lines.push("", "INCLUDED FOR THE WHOLE PROJECT (said once, above the services, on her page; reword where \"project\"):", sharedWork.map(function (t) { return "  - " + t; }).join("\n"));
    lines.push("", "SERVICE CARDS THE CUSTOMER SEES (prices exactly as her page shows them: the cards always add up to the customer total" + (totals && totals.stampedTotal != null ? ", which he set by hand, so every card is scaled to it" : "") + " - this is by construction, never a mismatch to report):");
    cards.forEach(function (s) {
      if (s.folded) { lines.push("  " + str(s.title) + " - no priced lines; on her page its wording is folded into " + str(s.folded)); return; }
      lines.push("  " + str(s.title) + " - " + money(s.subtotal));
      [list("included", s.included), list("customer supplies", s.supplied), list("NOT included", s.excluded)].filter(Boolean).forEach(function (l) { lines.push(l); });
    });
  }
  /* The published wording is what her page prints. Usually it is the cards
     above word for word; when he edited a card in the customer-scope editor
     it differs, and a reword's "from" must match THESE words. Only the cards
     that differ are printed, so the block does not double in size. */
  const pubDiff = publishedDifferences(est, cc && cc.published);
  if (pubDiff.length) {
    lines.push("", cc && cc.published
      ? "THE ESTIMATOR'S OWN CARD WORDING (the dashboard's Review step), where it differs from the customer's cards above (a reword changes whichever copy its from matches):"
      : "PUBLISHED WORDING ON THE CUSTOMER'S PAGE, where it differs from the cards above (a reword's from must match these words):");
    pubDiff.forEach(function (s) {
      lines.push("  " + str(s.name));
      [list("included", s.included), list("customer supplies", s.supplied), list("NOT included", s.excluded)].filter(Boolean).forEach(function (l) { lines.push(l); });
    });
  }

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
  /* Work added after the customer agreed (➕ Add a service): its lines and
     card carry its title; the earlier sections are as she accepted them. */
  const adds = arr(est.addedServices);
  if (adds.length) lines.push("ADDED AFTER THE CUSTOMER AGREED, as own sections (the earlier sections untouched): " + adds.map(function (x) { return arr(x && x.titles).join(", ") + (x && x.subtotal ? " " + money(x.subtotal) : "") + (x && x.at ? " on " + str(x.at).slice(0, 10) : ""); }).join("; ") + ". Their lines and cards are the ones tagged with those titles.");
  const sv = rec.sentVersion && typeof rec.sentVersion === "object" ? rec.sentVersion : null;
  if (sv && sv.at) {
    let svTotal = null;
    try { svTotal = customerTotals(sv.estimate || {}, { customerFinalTotal: rec.customerFinalTotal }).customerTotal; } catch (e) { svTotal = null; }
    lines.push("WHAT THE CUSTOMER SEES RIGHT NOW: version " + (Number(sv.n) || 1) + ", sent " + str(sv.at).slice(0, 10) + (svTotal != null ? ", total " + money(svTotal) : "") + (str(rec.updatedAt) > str(sv.at) ? " - the estimate above has changed since; she sees the new version only when he sends again" : " - unchanged since"));
  }
  if (str(est.completedOn) || str(est.completedAt)) lines.push("COMPLETED: " + (str(est.completedOn) || str(est.completedAt).slice(0, 10)));

  const text = lines.join("\n");
  const cap = Number(chars) > 0 ? Number(chars) : ESTIMATE_CHARS;
  return text.length > cap ? text.slice(0, cap) + "\n  ... (estimate cut here: " + (text.length - cap) + " more characters not shown. Say the estimate is too long to read whole; never describe as complete what you cannot see.)" : text;
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
/* The parked pictures for a job, read once and dropped: the answer keeps
   nothing of them but the "[📷 photo attached]" mark. */
async function takePhotos(id) {
  const store = jobStore();
  const list = await store.get(id + PHOTOS_SUFFIX, { type: "json" });
  if (list) { try { await store.delete(id + PHOTOS_SUFFIX); } catch (e) { /* a stale parcel is harmless */ } }
  return arr(list);
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
        (e.needsReply ? "CUSTOMER WAITING FOR A REPLY" : (e.waiting ? "WAITING FOR THE CUSTOMER'S ANSWER" : "")) + (e.invoices ? " " + e.invoices + " invoice(s)" : "") + (str(e.completed) ? " completed " + str(e.completed) : "")].join(" | ").trim());
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
const ACTION_TYPES = { open: ["ref"], tab: ["tab"], status: ["ref", "status"], visit: ["customer", "datetime"], draft: ["text"], remember: ["text"], search: ["query"], describe: ["ref", "text"], reword: ["ref"], lines: ["ref"], regenerate: ["ref"], addservice: ["ref", "text"], dedupe: ["ref"], waiting: ["ref"], lesson: ["text"] };
const TABS = ["all", "new", "drafted", "sent", "accepted", "invoiced", "paid", "completed", "declined", "cancelled", "handyman", "visits", "customers"];
const STATUSES = ["new", "drafted", "sent", "accepted", "declined", "completed", "cancelled"];
/* ══ "THE ASSISTANT RETURNED NOTHING. TRY AGAIN." ═════════════════════════
   Twice, on "analyze his requirements and current scope of work and find
   where need updates". The model answered - with a describe action holding
   the whole analysis - pretty-printed over several lines, or with a quote
   inside the text, so JSON.parse failed, the ACTION line was dropped as
   "broken", the lines after it were half a JSON object, and nothing usable
   was left. A reply that had words must never become "nothing":
     - an ACTION whose JSON runs over several lines is joined back up;
     - an ACTION whose JSON will not parse is read loosely (type, ref, text
       pulled out by pattern) before it is given up on;
     - if every line was an action and none survived, the words are shown
       as text rather than thrown away. */
/* A short yes: "ok", "yes", "go", "do it", "fix it", "go and fix it",
   "okay go ahead", "please do". Eight words at most, nothing that reads as a
   new question. */
const CONFIRM_RE = /^(?:ok(?:ay)?|yes|yeah|yep|sure|fine|go|do it|fix it|go ahead|go on|proceed|please|please do|do that|do this|apply|apply it|go and fix it|fix|yes please|ok go|okay go|ok do it|okay do it|yes do it|yes fix it|go fix it|do it now|fix it now|now|correct|right|agreed|confirm|confirmed)[\s.!,]*$|^(?:ok(?:ay)?|yes|sure|fine|please)[\s,]+(?:go|do|fix|apply|proceed)\b/i;
function isConfirmation(text) {
  const t = str(text).replace(/[’']/g, "").trim();
  if (!t || t.split(/\s+/).length > 8 || /\?/.test(t)) return false;
  return CONFIRM_RE.test(t) || /^(?:ok(?:ay)?|yes|sure|fine|please|now)?[\s,]*(?:go(?: ahead)?(?: and)?\s+)?(?:do|fix|apply|change|update|remove)\s+(?:it|that|this|them|these|those)(?:\s+now)?(?:\s+please)?[\s.!]*$/i.test(t);
}
const CONFIRM_NOTE = "HE IS SAYING YES TO YOUR LAST ANSWER. Do exactly what you said there, now, as ACTION lines - the reword with every edit, from copied word for word from the job below - after one line of words. Do not describe the photos, do not re-check, do not ask what he meant.";

/* An answer that says it is doing something: "Fixing the summary line now",
   "Removing the leftover", "I'll drop 'Painting'". Not "nothing to fix",
   not "you should fix", not a question. */
const CLAIMS_RE = /(^|\n)\s*(?:\*\*)?(?:fixing|updating|removing|dropping|changing|rewording|replacing|adding|applying|correcting|editing|sending)\b|\b(?:i(?:'ll| will| am|'m)|let me)\s+(?:now\s+)?(?:fix|update|remove|drop|change|reword|replace|add|apply|correct|edit|send)\b|\b(?:fixing|updating|removing|dropping|changing|rewording|replacing|correcting|editing)\b[^.\n]{0,80}\bnow\b/i;
function claimsToAct(text) {
  const t = str(text);
  if (!t) return false;
  return CLAIMS_RE.test(t);
}
const NUDGE = "You wrote that you are fixing it, but there is no ACTION line, so nothing changed. Send now the ACTION line(s) that do exactly what you said - one reword holding every edit, from copied word for word from the job - after one short line of words. Nothing else.";
const NUDGE_MIN_MS = 3500;

function extractActions(text, truncated) {
  const actions = [];
  const kept = [];
  const lines = String(text || "").split("\n");
  let rawActions = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^\s*ACTION:\s*(.*)$/.exec(line);
    if (!m) { kept.push(line); continue; }
    rawActions++;
    /* JSON that runs on: keep adding lines until it parses, or until the
       next ACTION, a blank line, or thirty lines. */
    let raw = m[1];
    let a = parseAction(raw);
    let j = i;
    while (!a && j + 1 < lines.length && j - i < 30) {
      const next = lines[j + 1];
      if (/^\s*ACTION:/.test(next) || !next.trim()) break;
      j++;
      raw += "\n" + next;
      a = parseAction(raw);
    }
    if (a) i = j; /* the continuation lines were the action, not prose */
    if (truncated) continue;
    if (!a) a = looseAction(raw);
    if (!a || typeof a !== "object") continue;
    const type = str(a.type);
    const need = ACTION_TYPES[type];
    if (!need) continue;
    if (!need.every(function (k) { return str(a[k]); })) continue;
    if (type === "tab" && TABS.indexOf(str(a.tab)) === -1) continue;
    if (type === "status" && STATUSES.indexOf(str(a.status)) === -1) continue;
    const clean = { type: type };
    Object.keys(a).forEach(function (k) {
      if (k === "type") return;
      /* reword carries a list of edits; everything else is a string. */
      /* lines carries a list of price-line operations (see cleanLineOps). */
      if (k === "ops" && Array.isArray(a[k])) { clean.ops = cleanLineOps(a[k]); return; }
      if (k === "edits" && Array.isArray(a[k])) {
        clean.edits = a[k].slice(0, 20).filter(function (e) { return e && typeof e === "object"; })
          .map(function (e) { const cap = reword.textCap(str(e.where).toLowerCase()); return { where: str(e.where).slice(0, 20), service: str(e.service).slice(0, 120), from: str(e.from).slice(0, cap), to: str(e.to).slice(0, cap) }; });
        return;
      }
      clean[k] = str(a[k]).slice(0, 2000);
    });
    /* A reword with one edit written flat (where/from/to) becomes a list. */
    if (type === "reword") {
      if (!Array.isArray(clean.edits) && (clean.where || clean.from || clean.to)) clean.edits = [{ where: str(clean.where), service: str(clean.service), from: str(clean.from), to: str(clean.to) }];
      ["where", "service", "from", "to"].forEach(function (k) { delete clean[k]; });
      if (!Array.isArray(clean.edits) || !clean.edits.length) continue;
    }
    if (type === "lines" && (!Array.isArray(clean.ops) || !clean.ops.length)) continue;
    actions.push(clean);
  }
  let out = kept.join("\n").trim();
  if (!out && !actions.length && rawActions) {
    /* Everything was an action and none survived: show the words. */
    out = lines.map(function (l) { return l.replace(/^\s*ACTION:\s*/, ""); }).join("\n").trim();
  }
  return { text: out, actions: actions };
}
/* ── PRICE LINES: CHANGE, ADD, REMOVE ──────────────────────────────────────
     "i will have a direct communication with he can update everything line
      by line if need change only one separate line in already generated
      estimate and everywhere"
   One op: { op: change|add|remove, line: "L3" | "M12" (the id in the
   estimate block), item (the line's words as they read now - a check that
   the id still points at the same line), and for change/add the new values:
   to (new words), qty, unit, rate, section; kind (labor|materials) for add.
   The DASHBOARD applies them, through the same functions as editing a line
   by hand, after he has seen every change and its price and pressed Apply. */
const LINE_OPS = ["change", "add", "remove"];
function cleanLineOps(list) {
  const num = function (v) { if (v === "" || v == null) return undefined; const n = Number(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(n) && n >= 0 ? Math.round(n * 10000) / 10000 : undefined; };
  return arr(list).slice(0, 40).filter(function (o) { return o && typeof o === "object" && LINE_OPS.indexOf(str(o.op).toLowerCase()) !== -1; }).map(function (o) {
    const op = str(o.op).toLowerCase();
    const kind = /^m/i.test(str(o.kind)) || /^M\d/i.test(str(o.line)) ? "materials" : "labor";
    const out = { op: op, kind: kind };
    const id = str(o.line).toUpperCase().replace(/\s+/g, "");
    if (/^[LM]\d{1,3}$/.test(id)) out.line = id;
    ["item", "to", "unit", "section", "reason"].forEach(function (k) { if (str(o[k])) out[k] = str(o[k]).slice(0, k === "reason" ? 200 : 300); });
    ["qty", "rate"].forEach(function (k) { const n = num(o[k]); if (n !== undefined) out[k] = n; });
    return out;
  }).filter(function (o) {
    if (o.op === "add") return !!(o.item || o.to) && o.qty !== undefined && o.rate !== undefined;
    return !!(o.line || o.item);
  });
}
exports._cleanLineOps = cleanLineOps;

function parseAction(raw) {
  try { const a = JSON.parse(raw); return a && typeof a === "object" ? a : null; } catch (e) { return null; }
}
/* The fields, by pattern, from JSON that is not quite JSON: an unescaped
   quote in the text, a trailing comma, a missing brace. */
function looseAction(raw) {
  const s = String(raw || "");
  const type = (/"type"\s*:\s*"([a-z_]+)"/i.exec(s) || [])[1];
  if (!type) return null;
  const a = { type: type };
  ["ref", "tab", "status", "customer", "address", "datetime", "reason", "query"].forEach(function (k) {
    const v = (new RegExp('"' + k + '"\\s*:\\s*"([^"\\n]*)"')).exec(s);
    if (v) a[k] = v[1];
  });
  /* text: from the opening quote after "text": to the last quote before the
     closing brace (or the end), so quotes inside it are kept as they were. */
  const t = /"text"\s*:\s*"([\s\S]*)$/.exec(s);
  if (t) a.text = t[1].replace(/"\s*\}?\s*$/, "").replace(/\\"/g, '"').replace(/\\n/g, "\n").trim();
  return a;
}

function systemPrompt(context, screen, memory, insights, inboxText, estimator) {
  const notes = arr(memory).map(function (n) { return "- " + str(n && n.text); }).filter(function (l) { return l !== "- "; });
  const est = estimator && estimator.on ? estimator : null;
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
    "- switch tab:                  ACTION: {\"type\":\"tab\",\"tab\":\"sent\"}   (all, new, drafted, sent, accepted, invoiced, paid, completed, declined, cancelled, handyman, visits, customers)",
    "- change an estimate's status: ACTION: {\"type\":\"status\",\"ref\":\"SBC-...\",\"status\":\"completed\"}   (new, drafted, sent, accepted, declined, completed, cancelled) - the dashboard asks him to confirm. declined = THE CUSTOMER declined it; cancelled = ZURA cancelled it himself ('cancel it', 'I'm cancelling this job', 'we are not doing this one'). When he says cancel or cancelled, send cancelled, never declined; when he says the customer said no, send declined.",
    "- schedule a site visit:       ACTION: {\"type\":\"visit\",\"customer\":\"...\",\"address\":\"...\",\"datetime\":\"2026-09-20T10:00\",\"reason\":\"...\",\"ref\":\"SBC-...\"}   (New York time; the dashboard asks him to confirm)",
    "- draft a message to the customer of the OPEN estimate: ACTION: {\"type\":\"draft\",\"text\":\"...\"}   - it goes into the reply box only; HE presses Send after reading it",
    "- remember something for later: ACTION: {\"type\":\"remember\",\"text\":\"...\"}",
    "- ADD A FACT FROM AN EMAIL TO AN ESTIMATE: ACTION: {\"type\":\"describe\",\"ref\":\"SBC-...\",\"text\":\"...\"}   - when a customer's email carries something the estimate needs (a measurement, a change of scope, a material, a date, a correction) and he asks you to put it in / update the estimate, write the fact in one or two plain sentences; the dashboard asks him to confirm, adds it to that estimate's customer description, and he presses Re-read the job to price it. Say in one line what you are adding. Never invent a fact; quote the email.",
    "- ADD A SERVICE TO AN ESTIMATE THE CUSTOMER ALREADY AGREED TO: ACTION: {\"type\":\"addservice\",\"ref\":\"SBC-...\",\"service\":\"Painting\",\"text\":\"...\"}   - when he asks to add new work (painting, a closet, an extra room, anything not in the estimate) to a job that is already priced or sent, and you know what the work is from this chat, his emails, a photo or the thread. text is the brief the estimator prices: what and where, quantities, colors, products, sheen, what the customer supplies - everything you know, in plain sentences, nothing invented. service is the trade name for the new section. The dashboard shows him the brief, he confirms, and the estimator prices ONLY that work and adds it as its own section; the agreed sections are not touched. Say in one line what you are adding. ONLY WHEN HE ASKS to add it, and only once per request: never offer to fire it yourself, and never add a service that is already on the estimate (the job lists the added sections). REDOING AN ADDED SECTION: when he asks to regenerate, redo, re-price or change an added section (the job lists them under ADDED AFTER THE CUSTOMER AGREED), send addservice with \"replace\" set to that section's exact title and text holding the COMPLETE new brief - everything from the first brief that still applies plus his corrections, never only the change. The dashboard takes the old section out (lines, card, price) and prices the new brief as its own section; the agreed sections stay untouched. Never use regenerate for this. Use addservice for new priced work on an agreed estimate; describe for a fact on an estimate not priced yet.",
    "- FIX THE WORDS OF AN ESTIMATE WITHOUT TOUCHING A PRICE: ACTION: {\"type\":\"reword\",\"ref\":\"SBC-...\",\"edits\":[{\"where\":\"included\",\"service\":\"Bathroom\",\"from\":\"old line as it reads now\",\"to\":\"new line\"}]}   - when he asks you to correct, update or align wording (a finish, a size, a spec, a contradiction between the lines and the included text, a typo) with no price change. where is one of: included, excluded, supplies (a line of a service card - name the service), labor or material (the NAME of a price line: from = its name as shown, to = the new name), project (a line of INCLUDED FOR THE WHOLE PROJECT - the shared work said once above the services: protection, cleanup, debris, coordination), service (RENAME A SERVICE CARD - the card's heading the customer reads, e.g. Windows -> Trim & Hardware: from = the card's name as it is now, to = the new name; its price lines and its price move with it), summary, scope, title, timeline (from = the phrase to replace, or empty to replace the whole field; title is the ESTIMATE's title at the top of the page, never a card's name); on the contract: contractscope or contractmaterials (a line), contracttimeline, contracttype, contractclause (service = hidden conditions / change orders / warranty / cancellation / permits and insurance) - never on a signed contract. from must be copied EXACTLY as the estimate shows it: the title, summary, timeline, scope of work and every card line are printed word for word in the job below - quote from there, never say you do not have the text. to empty removes a card line; from empty adds one. Put every edit for one estimate in ONE action's edits list. The server keeps every price, quantity and total exactly as they are and refuses anything else; the dashboard shows him each before/after and asks first. Use reword for wording; use describe for new work that must be priced.",
    "- CHANGE THE PRICE LINES - hours, quantities, rates, units, the words of a line, move a line to another service, add a line, remove a line: ACTION: {\"type\":\"lines\",\"ref\":\"SBC-...\",\"ops\":[{\"op\":\"change\",\"line\":\"L3\",\"item\":\"the words of L3 as they read now\",\"qty\":30},{\"op\":\"remove\",\"line\":\"M12\",\"item\":\"the words of M12\"},{\"op\":\"add\",\"kind\":\"materials\",\"section\":\"Bathroom\",\"item\":\"Shower niche allowance, 12x24 in., waterproofed\",\"qty\":12,\"unit\":\"ea\",\"rate\":150}]}   - line is the id in the estimate block (L = labor, M = materials); item is ALWAYS copied from that line as it reads now, so a line that moved is still found; for change send only what changes (qty, rate, unit, to = new words, section = move it to that service). Rates are Sani's COST, like every line in the block - never a customer price. ONE action holds every line change of his request - never one line of several. The dashboard shows him each change with its money and the customer's new total, and nothing changes until he presses Apply; it then saves. Use reword instead when only words change and no money.",
    "- REGENERATE THE ESTIMATE: ACTION: {\"type\":\"regenerate\",\"ref\":\"SBC-...\",\"how\":\"reprice\"}   - when he says regenerate, re-price or re-read. how is reprice (same scope, new prices) or reread (the AI decides again what the job is - after new plans, new emails or a big change of scope). The generator reads everything he wrote in THIS chat as his instructions, so tell him that in one line. The dashboard asks him to confirm.",
    "- SAVE A LESSON FOR THE GENERATOR: ACTION: {\"type\":\"lesson\",\"text\":\"...\"}   - when he says 'save that as a lesson', 'teach the generator', 'remember this for next estimates', or after he corrects something the generator keeps getting wrong. text is ONE short rule in his words, true for every job of that kind (e.g. 'Paint color never changes the price'). Used only while Test mode is on; the dashboard asks him to keep it.",
    "- MARK AN ESTIMATE AS WAITING FOR THE CUSTOMER'S ANSWER: ACTION: {\"type\":\"waiting\",\"ref\":\"SBC-...\"}   - when he says 'mark as waiting', 'waiting for the customer', 'waiting answer', 'I asked them, waiting', after he sent the customer a question or a message. Not a status: a mark on the record, shown as WAITING FOR CUSTOMER on the card, that clears itself when the customer writes back. \"waiting\":\"clear\" removes it. The dashboard asks him to confirm. Never answer that there is no such status - this is how it is done.",
    "- REMOVE REPEATED LINES FROM A SCOPE: ACTION: {\"type\":\"dedupe\",\"ref\":\"SBC-...\"}   - when he asks to remove duplicates, repeats, doubled lines or the same service listed twice, or when you see the same bullet under more than one heading or card (site setup, protection, coordination, the same plumbing work under Bathroom and under Plumbing). The server drops every bullet that already appeared in an earlier section or card with the same words - in the scope text and in every card copy - keeps each once where it first appears, and leaves every price alone; the dashboard shows him the list and he confirms once. NEVER remove repeats one by one with reword: send dedupe. Lines that say the same work in different words come back as 'similar'; merge those with reword after.",
    "- SEARCH THE INTERNET:          ACTION: {\"type\":\"search\",\"query\":\"...\"}   - use it whenever the answer needs current information from outside this dashboard: today's price of a product or material, a supplier or store, a building code, permit or co-op rule, a company, an address, the weather, anything that changes over time or that you are not sure of. Also whenever he says 'search online', 'check online', 'google it' or 'look it up'. Write the query the way a good search is written (specific, with New York or the borough when it matters). Say in ONE short line that you are checking online - the answer with its sources arrives in this chat in under a minute - and do not guess the answer yourself in the same reply.",
    "An ACTION line is ONE line of valid JSON: no line breaks inside it, and inside a text value use single quotes, never double quotes (for a reword, copy the quotes the estimate uses - 24\" - as \\\"). Always write at least one line of words before any ACTION line.",
    "Use the refs, names and ids from the screen below; never invent one. If what he asks is not on this list, say plainly that you cannot do that from here and what he can press instead.",
    "A PHOTO OR SCREENSHOT may come with his question: a screenshot of a customer's text message or email, a product page, a plan, a photo of the site or of the work. A tall screenshot comes as several pieces, top to bottom, with a little overlap: read them as one page. Read it like any other fact - say what it shows or what it says, quote the words in it - and use it for describe or reword when he asks. If it is unreadable or does not show what he says, say so.",
    "UPDATE THE SCOPE TO THE CUSTOMER'S LATEST REQUESTS ('review again', 'update the scope', 'match his requests', 'rewrite the scope of work'): this is your main job and you DO it, in one turn, without asking. Read what the customer asked for most recently - the newest emails, the newest messages, the photos, the answers - and compare it with the scope text, the summary and every card's included / not included / customer supplies lines. Every place the words still describe the old request, change them to the new one. Send ONE reword action holding every edit: the card lines (from = the line as it reads now, to = the corrected line; from empty to add a missing line; to empty to drop one that no longer applies), the scope phrases, the summary. When more than a few sentences of the scope must change, replace the scope whole: where scope, from empty, to = the complete new scope of work in the same style and order - everything that still applies, with the customer's changes written in, nothing invented; the summary the same way. Prices, quantities and card subtotals are not yours: leave the numbers and say in one line which price lines he should look at if the new request costs more or less. Then say in a few lines what you changed and what you left alone. Never only describe the fixes, never say you cannot see the text (it is all printed below), never stop at a question - the edits go in the action and he confirms them once.",
    "HOW TO ANSWER, EVERY TIME: the first line is the answer itself - Yes / No / Done / the number / what changed - one sentence. Then at most five short lines, one fact each, with the exact words or numbers. When he asked you to check, fix, update, match or review, the ACTION with the fixes is in the SAME answer, right after those lines: checking and fixing are one job. Never 'want me to', never 'shall I', never 'I can', never end on a question, never describe a fix you did not send. No reasoning out loud, no 'looks like', no history lesson, no restating what he asked. If everything matches: 'Matches. Nothing to change.' and stop. An edit the dashboard reported as 'not found' is not done: send it again at once, with from copied from the block or the whole field replaced.",
    "WORDS ALONE CHANGE NOTHING. 'Fixing the summary now', 'removing that line', 'I'll drop it' do nothing unless the ACTION line is in the same answer: the dashboard changes an estimate only from an ACTION. Never write that you are fixing, removing or updating something without the ACTION under it. When he answers 'yes', 'ok', 'go', 'do it', 'go and fix it' to your last answer, he means exactly what you proposed there: send those ACTION lines now, do not describe the photos again, do not re-check, do not ask what he meant.",
    "THE CONTRACT is in the job below when one exists (headed 'the contract'): its scope lines, materials, timeline, payment schedule, clauses, total and whether it is signed. You read it like the estimate - never say you cannot open it. When he asks whether the contract matches the estimate or the customer's requests, compare them line by line and fix the contract's wording with a reword (contractscope, contractmaterials, contracttimeline, contracttype, contractclause). Its amounts and total are not yours: if the estimate moved away from the contract, say so and point him to Update contract total; a signed contract is never changed - say that and stop.",
    "THE JOB'S OWN PHOTOS (the customer's request photos, the photos attached to the quote, pictures in messages) come on his latest message, each after a label 'Job photo N of M - ...'; the job block says how many there are. When he asks about the photos, what you see, or whether the estimate matches the pictures, read them and say plainly what is in each - the room, the damage, the materials, sizes if something gives scale. Never say the job has no photos when the job block counts some; if it says they are not shown on this path, say so and that Ask AI shows them.",
    "ADDITIONAL WORK on an estimate the customer already agreed to (a new service, painting, an extra room, anything not in it): never change, reword or reprice the agreed services, and never tell him to regenerate - regenerating rebuilds every service. Do it for him with the addservice action when you know what the work is (write the brief from the chat, the emails, the photos); otherwise tell him to press ➕ ADD A SERVICE TO THIS ESTIMATE (in the Regenerate box). Either way the new work is priced on its own and added to the same estimate as its own section with its own scope and price, the agreed sections untouched; then he sends the estimate again. If he wants it as a separate estimate instead, ➕ ADD ADDITIONAL WORK (SEPARATE ESTIMATE) makes a linked one. On an estimate that IS additional work (the job says so), price and describe only the additional work.",
    "YOU ARE HIS SENIOR ESTIMATOR, not a clerk. On every question about an open estimate you read the whole thing: the customer's words and answers, the messages, the emails, the history, what was sent and when, every line and every card. You think like the person who has to build it and the person who has to pay for it: is every promised bullet backed by a line, is every line a promise the customer can read, does the title say what the job is, does the summary match the scope, does the timeline fit the hours, is anything priced twice, is anything the customer asked for missing, is anything there the customer never asked for. Say what you found in his order of importance, with the exact words and numbers, and then DO the wording fixes yourself with ONE reword action holding every edit (title, summary, scope, timeline, included/excluded/supplies lines) - he confirms once. Money stays his: name the line and the number. When he asks what changed, answer from HISTORY and SINCE THE LAST SEND, with dates and totals, never from memory of this chat. When you are not sure, say what you would check and where, not a guess.",
    "THE CHAT MAY BE STALE. Earlier answers in this conversation describe the estimate as it was when they were written - lines, totals, cards that have since been added, removed or redone. The ESTIMATE RIGHT NOW note on his latest message and the estimate block below are the current truth and outrank anything said earlier, by you or by him. When they disagree with the chat, say plainly that the estimate has changed and use the current figures; never repeat an old count, total or card from the chat, and never invent a section that is not in the current estimate. A SINCE YOUR LAST ANSWER note on his latest message lists every change recorded on this estimate since you last spoke (saves, rewords, card changes, messages, emails, signatures, invoices): start from it, say what changed when it matters, and never carry a number or a finding from an earlier answer across a change.",
    "CHECK THE ESTIMATE ('have a look', 'analyze', 'is it correct', 'anything unmatched'): the estimate block below (headed 'the generated estimate, as he sees it') is the whole estimate as stored, read fresh on every question - never say you cannot see it or ask him to refresh. Read every line and every card and compare them with each other and with the customer's words: a card bullet with no line behind it, a line filed under the wrong service, a duplicate line, a $0 card, a quantity that does not match a size he gave, a customer-supplied item priced as material, a section added after agreement that repeats agreed work. Report each mismatch concretely (line name, card, number) and say what to change. The card prices in the block are the ones the customer reads and they add up to the customer total by construction; a total he set by hand scales every card with it - that is never a mismatch, never 'a gap', never something to fix. Wording -> offer a reword action. A quantity, a rate or a line -> name the exact line and the number; he edits lines himself, you never change money. If it says 'estimate cut here', say that and ask for a narrower question.",
    "If he asks for a plan, a strategy or an analysis, use the whole list on the screen: who is waiting, what is unpaid, what was sent and never answered, what is due today. Be specific: names and refs.",
    "EMAILS WITH THIS CUSTOMER (below, when a job is open) are read from his inbox log, matched by the customer's email address. When he asks about an email from this customer, answer from that list. When the list says there are none, say exactly that - none in the inbox from that address - and never say you cannot see emails.",
    "THE INBOX (below) is his whole info@ mailbox as of the last 15 minutes: every inbound email, one line each, newest first, with the estimate it is about when one could be matched (by ref, by address, or by the sender's name). The FULL TEXT of the emails about the open job and of the ones that match his question is given under it. Answer 'what did X write', 'did anyone email about Y', 'what does the manager need' from there, naming who wrote, when, and what. An email marked 'not a customer we know' may be a new lead, a building manager, a supplier - say so. If what he wants is not in the lines or the full texts shown, say which email you would need opened rather than guessing. Use the emails to pull requirements into an estimate with the describe action when he asks.",
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
    est ? "- Prices: you are the estimator of the open job (see YOU ARE THE ESTIMATOR). Outside the open job, never invent a price, a rate or a total." : "",
    est ? "" : "- Never invent a price, a rate or a total. He has a pricing system and it is not you. If he asks what something costs, say what the price depends on and what to measure, or tell him to run the estimator. When the estimate's lines are on screen below, you MAY read them back, add them up, compare them and point out what looks off (a quantity, a missing trade, a line that contradicts the customer's words) - that is reading, not pricing.",
    "- Never write as if you are the customer or draft something that pretends to be from them.",
    "- Do not tell him to go and look at the dashboard. He is in it.",
    "",
    est ? [
      "",
      "YOU ARE THE ESTIMATOR OF THIS JOB - the same one that generated it, with the same knowledge and the same house rules (below). He talks to you instead of pressing buttons: whatever he tells you to change in the open estimate - one line, a service, the words, the price - you change, with an action, in this answer.",
      "- To change money you send a lines action; to change words you send a reword; to add a whole new service to an agreed job you send addservice; to start over you send regenerate. Never tell him to edit it himself when an action can do it.",
      "- PRICING A CHANGE the way the generator does: labor in hours at the rate this estimate already uses for that trade (the rates in the block are Sani's COST rates - never a selling rate); materials as a real product with a real quantity, unit and price for one - one product per line. When he gives a number, use exactly his number. With the action, say in one line what the change adds or removes in cost; the dashboard shows him the customer price before he applies it.",
      "- A change the CUSTOMER asked for: say what it involves and ask him the price, unless he asks you to price it.",
      "- An allowance is a line whose words say ALLOWANCE and what it covers (e.g. 'Allowance - shower niches, 12 at $150 each').",
      "- Keep the job consistent when you change it: a line removed means its included bullet goes too (a reword in the same answer); a line for work another trade does (plumber, electrician) is removed, not reworded; nothing is priced twice.",
      "- He is the boss of this estimate. What he says in this chat outranks the description, the generator's draft and your own earlier answers.",
      est.houseRules ? "\nHIS HOUSE RULES (the generator prices with these; you do too):\n" + String(est.houseRules).slice(0, 6000) : "",
      "",
      est.drawings ? "THE DRAWINGS (" + est.drawings + " PDF file" + (est.drawings === 1 ? "" : "s") + ") are attached to his latest message: read every page when the question is about quantities, rooms, fixtures or what the plans show." : "The job's PDF plans are not attached to this message; they come with the check before sending and with any question about the plans - say so if he asks about them now.",
      arr(est.emails).length
        ? "\nTHE CUSTOMER'S EMAILS ABOUT THIS JOB (full text, oldest first - her own words; the description may be his rewrite of them. Where the description or the estimate adds what she never asked for, or misses what she did, say so):\n" + emailsText(est.emails)
        : "\nTHE CUSTOMER'S EMAILS ABOUT THIS JOB: none found in his inbox for this estimate (matched by ref, her address, her name or the street address).",
    ].filter(Boolean).join("\n") : "",
    notes.length ? "THINGS HE ASKED YOU TO REMEMBER:\n" + notes.join("\n") + "\n" : "",
    context ? context : "No job is open." + (screen ? "" : " Answer whatever he asks."),
    screen ? "\nWHAT IS ON HIS SCREEN:\n" + screen : "",
    inboxText || "",
    insights ? "\nWHAT HIS HISTORY SHOWS (from all his estimates, updated nightly):\n" + insights : "",
  ].filter(Boolean).join("\n");
}

/* Streams the answer and resolves { text, truncated }.
   - text_delta events are appended as they arrive.
   - At the deadline the socket is dropped and whatever has arrived is returned
     with truncated:true. If nothing has arrived yet, that is a real timeout.
   - A non-2xx status means the body is a JSON error, not a stream. */
function callClaude(apiKey, system, turns, deadline, maxTokens, how) {
  const est = how && how.model ? how : null;
  const payload = JSON.stringify({
    model: est ? est.model : MODEL,
    max_tokens: maxTokens || MAX_TOKENS,
    stream: true,
    /* ══ NO HIDDEN REASONING ═════════════════════════════════════════════
       "The assistant ran out of room before writing anything." 1600 tokens
       spent, zero words: the model was thinking - reasoning blocks stream
       as thinking_delta, which is not text, and on a hard question it used
       the whole budget before the first word. This assistant answers from
       what is in front of it; the budget is for the answer. */
    /* The estimator (how.think) keeps the model's default thinking - it has
       minutes and 16,000 tokens, and pricing is where thinking pays; the
       thinking deltas are not text and are simply not collected. */
    ...(est && est.think ? {} : { thinking: { type: "disabled" } }),
    system: system,
    messages: turns.map(function (t) {
      /* the glance rides with his latest message and is never written to the chat */
      const text = t.note ? t.text + "\n\n" + t.note : t.text;
      const job = Array.isArray(t.jobImages) ? t.jobImages : [], mine = Array.isArray(t.images) ? t.images : [];
      const docs = Array.isArray(t.docs) ? t.docs : [];
      if (!job.length && !mine.length && !docs.length) return { role: t.role, content: text };
      /* the drawings first (lib/job-documents.js blocks: a label, a document) */
      const blocks = docs.slice();
      job.forEach(function (im) { blocks.push({ type: "text", text: im.label }); blocks.push({ type: "image", source: im.source }); });
      if (mine.length) { if (job.length) blocks.push({ type: "text", text: "Pictures he uploaded with this question:" }); mine.forEach(function (im) { blocks.push({ type: "image", source: { type: "base64", media_type: im.mediaType, data: im.data } }); }); }
      blocks.push({ type: "text", text: text });
      return { role: t.role, content: blocks };
    }),
  });

  return new Promise(function (resolve, reject) {
    let text = "", done = false, timer = null, pending = "";
    /* ══ WHEN NOTHING COMES BACK, SAY WHAT DID ═══════════════════════════
       "The assistant returned nothing. Try again." tells nobody anything.
       The stream is watched: which events came, what the stop reason was,
       and the first bytes of it - and an empty answer says so, so the next
       screenshot names the cause instead of the symptom. */
    const seen = {};
    let stopReason = "", rawHead = "";
    const finish = function (truncated) {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (!text.trim() && truncated) {
        return reject(new Error("The assistant took too long. Ask again, or ask something shorter."));
      }
      if (!text.trim()) {
        const events = Object.keys(seen).map(function (k) { return k + (seen[k] > 1 ? "×" + seen[k] : ""); }).join(", ");
        console.error("assistant: empty stream", { stopReason: stopReason, events: events, head: rawHead.slice(0, 400) });
        if (stopReason === "refusal") return reject(new Error("The assistant declined to answer that one. Say it another way."));
        if (stopReason === "max_tokens") return reject(new Error("The assistant ran out of room before writing anything (stream: " + (events || "no events") + "). Ask for less at once."));
        return reject(new Error("The assistant returned nothing (stop: " + (stopReason || "none") + "; stream: " + (events || "no events") + "). Try again."));
      }
      resolve({ text: text.trim(), truncated: truncated === true, stopReason: stopReason });
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
          if (rawHead.length < 400) rawHead += c.toString("utf8").slice(0, 400 - rawHead.length);
          /* SSE: frames are separated by a blank line; each has "data: {json}". */
          let cut;
          while ((cut = pending.indexOf("\n\n")) !== -1) {
            const frame = pending.slice(0, cut);
            pending = pending.slice(cut + 2);
            const ev = parseFrame(frame);
            if (!ev) { seen["unparsed"] = (seen["unparsed"] || 0) + 1; continue; }
            const kind = String(ev.type || "?") + (ev.content_block && ev.content_block.type ? "[" + ev.content_block.type + "]" : "") + (ev.delta && ev.delta.type ? "[" + ev.delta.type + "]" : "");
            seen[kind] = (seen[kind] || 0) + 1;
            if (ev.type === "message_delta" && ev.delta && ev.delta.stop_reason) stopReason = String(ev.delta.stop_reason);
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
