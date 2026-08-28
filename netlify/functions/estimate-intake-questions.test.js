// node netlify/functions/estimate-intake-questions.test.js
//
// The endpoint, EXECUTED, against a stubbed Anthropic API. Syntax-checking this
// file would have told us nothing: every bug worth catching here is in what the
// handler does with an answer it did not expect.

const assert = require("assert");
const Module = require("module");
const path = require("path");

let pass = 0, fail = 0;
const results = [];
function t(name, fn) { results.push([name, fn]); }

/* ── the stub ──────────────────────────────────────────────────────────────
   Replaces node's https for the handler only. `plan` decides what this call
   does; `sent` records exactly what the handler put on the wire. */
let plan = null;
let sent = null;

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "https" && parent && /estimate-intake-questions\.js$/.test(parent.filename || "")) {
    return httpsStub;
  }
  return realLoad.apply(this, arguments);
};

const httpsStub = {
  request(opts, cb) {
    const handlers = {};
    const req = {
      on(ev, fn) { handlers[ev] = fn; return req; },
      write(chunk) { sent = { opts: opts, body: JSON.parse(String(chunk)) }; },
      destroy() {},
      end() {
        setImmediate(() => {
          if (plan.kind === "timeout") { if (handlers.timeout) handlers.timeout(); return; }
          if (plan.kind === "socket") { if (handlers.error) handlers.error(new Error("ECONNRESET")); return; }
          const res = {
            on(ev, fn) {
              if (ev === "data") setImmediate(() => fn(Buffer.from(plan.body)));
              if (ev === "end") setImmediate(() => setImmediate(fn));
              return res;
            },
          };
          cb(res);
        });
      },
    };
    return req;
  },
};

function apiReply(obj) {
  return JSON.stringify({
    id: "msg_1",
    stop_reason: "end_turn",
    content: [
      { type: "thinking", thinking: "weighing what is missing" },
      { type: "text", text: JSON.stringify(obj) },
    ],
  });
}

const handlerPath = path.join(__dirname, "estimate-intake-questions.js");
const { handler } = require(handlerPath);
Module._load = realLoad;   // only the handler's own require needed stubbing

function post(body) {
  return handler({ httpMethod: "POST", body: JSON.stringify(body) });
}

const REQ = {
  service: "bathroom,painting",
  serviceLabel: "Bathroom, Painting",
  serviceCount: 2,
  description: "My bathroom is old and the paint is peeling in the hallway.",
  propertyType: "Apartment / Co-op",
  photoCount: 2,
  photoNotes: ["Cracked wall tile above tub"],
};

const GOOD = {
  readAs: "Gut and re-tile a small bathroom, plus repaint the hallway.",
  questions: [
    { questionId: "bathSize", label: "How big is the bathroom, roughly?", why: "Area sets every tile and labor line", topic: "bathroom", type: "options-stack", options: ["Under 40 sq ft", "40-70 sq ft", "Over 70 sq ft"] },
    { questionId: "layout", label: "Is the toilet or tub moving to a new spot?", why: "Moving a drain is the biggest cost swing", topic: "plumbing", type: "options-grid", options: ["Staying put", "Moving"] },
    { questionId: "rooms", label: "How many rooms need painting?", why: "Rooms and ceiling height set the hours", topic: "painting", type: "text", placeholder: "e.g. hallway plus 2 bedrooms" },
  ],
};

process.env.ANTHROPIC_API_KEY = "sk-test";

/* ── behaviour ─────────────────────────────────────────────────────────── */

t("OPTIONS is answered without calling the API", async () => {
  sent = null;
  const r = await handler({ httpMethod: "OPTIONS" });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(sent, null);
});

t("GET is refused", async () => {
  const r = await handler({ httpMethod: "GET" });
  assert.strictEqual(r.statusCode, 405);
});

t("a request with no service is a 400", async () => {
  const r = await post({ description: "something" });
  assert.strictEqual(r.statusCode, 400);
});

t("the planned questions come back in order", async () => {
  plan = { kind: "ok", body: apiReply(GOOD) };
  const r = await post(REQ);
  const d = JSON.parse(r.body);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(d.questions.length, 3);
  assert.strictEqual(d.questions[0].questionId, "bathSize");
  assert.strictEqual(d.questions[2].type, "text");
  assert.strictEqual(d.readAs.indexOf("Gut and re-tile") , 0);
});

t("every choice question arrives with an escape hatch", async () => {
  plan = { kind: "ok", body: apiReply(GOOD) };
  const d = JSON.parse((await post(REQ)).body);
  assert.strictEqual(d.questions[0].options[d.questions[0].options.length - 1], "I'm not sure");
  assert.deepStrictEqual(d.questions[2].options, [], "a text question needs no options");
});

t("the trade header is set on every question", async () => {
  plan = { kind: "ok", body: apiReply(GOOD) };
  const d = JSON.parse((await post(REQ)).body);
  assert.deepStrictEqual(d.questions.map((q) => q.topicLabel), ["Bathroom", "Plumbing", "Painting"]);
});

t("a banned question the model wrote anyway never reaches the customer", async () => {
  plan = { kind: "ok", body: apiReply({ questions: [
    { questionId: "who", label: "Who is supplying the tile?", topic: "tile", type: "options-grid", options: ["You", "Me"] },
    { questionId: "bathSize", label: "How big is the bathroom?", topic: "bathroom", type: "text" },
  ] }) };
  const d = JSON.parse((await post(REQ)).body);
  assert.strictEqual(d.questions.length, 1);
  assert.strictEqual(d.questions[0].questionId, "bathSize");
});

t("a model that ignores the cap is still held to it", async () => {
  const many = [];
  for (let i = 0; i < 9; i++) many.push({ questionId: "q" + i, label: "Question " + i + " about the job", topic: "", type: "text" });
  plan = { kind: "ok", body: apiReply({ questions: many }) };
  const d = JSON.parse((await post(REQ)).body);
  assert.strictEqual(d.questions.length, 4, "two services allow four");
  assert.strictEqual(d.max, 4);
});

t("no questions is a valid, successful answer", async () => {
  plan = { kind: "ok", body: apiReply({ readAs: "Replace 200 sq ft of oak flooring.", questions: [] }) };
  const d = JSON.parse((await post(REQ)).body);
  assert.strictEqual(d.questions.length, 0);
  assert.ok(!d.fallback, "an empty plan must not look like a failure - the form would ask again");
});

/* ── failing open ──────────────────────────────────────────────────────── */

t("an API error is a 200 with fallback set, never a 500", async () => {
  plan = { kind: "ok", body: JSON.stringify({ error: { message: "overloaded" } }) };
  const r = await post(REQ);
  assert.strictEqual(r.statusCode, 200, "a 500 here looks like a broken form");
  const d = JSON.parse(r.body);
  assert.strictEqual(d.fallback, true);
  assert.deepStrictEqual(d.questions, []);
});

t("a timeout falls back instead of hanging", async () => {
  plan = { kind: "timeout" };
  const d = JSON.parse((await post(REQ)).body);
  assert.strictEqual(d.fallback, true);
  assert.ok(/Timeout/.test(d.error), d.error);
});

t("a dropped socket falls back", async () => {
  plan = { kind: "socket" };
  const d = JSON.parse((await post(REQ)).body);
  assert.strictEqual(d.fallback, true);
});

t("prose instead of JSON falls back", async () => {
  plan = { kind: "ok", body: JSON.stringify({ content: [{ type: "text", text: "I could not decide." }] }) };
  const d = JSON.parse((await post(REQ)).body);
  assert.strictEqual(d.fallback, true);
});

t("a missing API key falls back without calling out", async () => {
  const keep = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  sent = null;
  const d = JSON.parse((await post(REQ)).body);
  process.env.ANTHROPIC_API_KEY = keep;
  assert.strictEqual(d.fallback, true);
  assert.strictEqual(sent, null);
});

t("a broken body is a fallback, not a crash", async () => {
  plan = { kind: "ok", body: apiReply(GOOD) };
  const r = await handler({ httpMethod: "POST", body: "{not json" });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(JSON.parse(r.body).fallback, true);
});

/* ── what goes on the wire ─────────────────────────────────────────────── */

t("the call is shaped the way Claude 5 models require", async () => {
  plan = { kind: "ok", body: apiReply(GOOD) };
  await post(REQ);
  assert.ok(/^claude-/.test(sent.body.model), sent.body.model);
  assert.ok(sent.body.max_tokens > 0);
  assert.ok(sent.body.output_config && sent.body.output_config.effort, "effort is the thinking control");
  assert.strictEqual(sent.body.thinking, undefined, "sending thinking is a 400 on these models");
  assert.strictEqual(sent.body.temperature, undefined, "Claude 5 rejects non-default sampling");
});

function promptText() {
  const content = sent.body.messages[0].content;
  return content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

t("the customer's own words are what the model reads", async () => {
  plan = { kind: "ok", body: apiReply(GOOD) };
  await post(REQ);
  const prompt = promptText();
  assert.ok(prompt.indexOf("the paint is peeling in the hallway") !== -1);
  assert.ok(prompt.indexOf("Apartment / Co-op") !== -1);
  assert.ok(prompt.indexOf("Cracked wall tile above tub") !== -1);
});

t("the call gives up before Netlify kills the function at 10s", async () => {
  plan = { kind: "ok", body: apiReply(GOOD) };
  await post(REQ);
  assert.ok(sent.opts.timeout > 0 && sent.opts.timeout < 10000, "timeout is " + sent.opts.timeout);
});

t("a runaway description is truncated before it is sent", async () => {
  plan = { kind: "ok", body: apiReply(GOOD) };
  await post(Object.assign({}, REQ, { description: "x".repeat(50000) }));
  assert.ok(promptText().length < 20000, "prompt length " + promptText().length);
});

/* ── the photos ────────────────────────────────────────────────────────── */

const JPG = "data:image/jpeg;base64," + "A".repeat(400);
const PNG = "data:image/png;base64," + "B".repeat(400);

function imagesSent() {
  return sent.body.messages[0].content.filter((b) => b.type === "image");
}

t("the photos are sent to be looked at, not just counted", async () => {
  plan = { kind: "ok", body: apiReply(GOOD) };
  await post(Object.assign({}, REQ, { photos: [{ data: JPG }, { data: PNG }] }));
  const imgs = imagesSent();
  assert.strictEqual(imgs.length, 2);
  assert.strictEqual(imgs[0].source.media_type, "image/jpeg");
  assert.strictEqual(imgs[1].source.media_type, "image/png");
  assert.ok(imgs[0].source.data.indexOf("data:") === -1, "the data: prefix must be stripped");
});

t("the images come before the question, and the text comes last", async () => {
  plan = { kind: "ok", body: apiReply(GOOD) };
  await post(Object.assign({}, REQ, { photos: [{ data: JPG }] }));
  const content = sent.body.messages[0].content;
  assert.strictEqual(content[0].type, "image");
  assert.strictEqual(content[content.length - 1].type, "text");
});

t("the model is told not to spend a question on what a photo shows", async () => {
  plan = { kind: "ok", body: apiReply(GOOD) };
  await post(Object.assign({}, REQ, { photos: [{ data: JPG }] }));
  assert.ok(/LOOK AT THEM FIRST/.test(promptText()));
});

t("only the first three photos are looked at", async () => {
  plan = { kind: "ok", body: apiReply(GOOD) };
  await post(Object.assign({}, REQ, { photos: [{ data: JPG }, { data: JPG }, { data: JPG }, { data: JPG }, { data: JPG }] }));
  assert.strictEqual(imagesSent().length, 3);
});

t("a PDF or an unreadable file is skipped, not sent as a broken image", async () => {
  plan = { kind: "ok", body: apiReply(GOOD) };
  await post(Object.assign({}, REQ, { photos: [
    { data: "data:application/pdf;base64,JVBERi0=" },
    { data: "not a data url at all" },
    { data: JPG },
  ] }));
  const imgs = imagesSent();
  assert.strictEqual(imgs.length, 1);
  assert.strictEqual(imgs[0].source.media_type, "image/jpeg");
});

t("an oversized image is dropped rather than timing the customer out", async () => {
  plan = { kind: "ok", body: apiReply(GOOD) };
  await post(Object.assign({}, REQ, { photos: [{ data: "data:image/jpeg;base64," + "A".repeat(1000000) }, { data: JPG }] }));
  assert.strictEqual(imagesSent().length, 1);
});

t("no photos means no image blocks at all", async () => {
  plan = { kind: "ok", body: apiReply(GOOD) };
  await post(Object.assign({}, REQ, { photos: [], photoCount: 0 }));
  assert.strictEqual(imagesSent().length, 0);
  assert.ok(!/LOOK AT THEM FIRST/.test(promptText()));
});

(async function run() {
  console.log("\nestimate-intake-questions\n");
  for (const [name, fn] of results) {
    try { await fn(); pass++; console.log("  ok   " + name); }
    catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
  }
  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})();
