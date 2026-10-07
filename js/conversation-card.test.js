/* conversation-card.test.js — run: node js/conversation-card.test.js
 *
 *   "keep my existing per-customer conversation and its AI reading; only move
 *    and redesign it" (Perplexity pack 3, images 00e and 00f)
 *
 * The Conversation card sits right after Request: the same thread and the
 * same Send, chat bubbles, what the AI learned with a tick per fact, "Update
 * estimate from chat" when a customer message is newer than the estimate,
 * questions to ask, 📎 / 📷 / ✨, and a 💬 count in the phone header. An
 * update keeps the prices he typed by hand.
 */
"use strict";
/* These checks run the generator as it works when switched ON (lib/generator-switch.js); js/generator-off.test.js holds the switch itself. */
process.env.AI_GENERATOR = "on";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const D = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");
const Module = require("module");
const STORES = {};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === "@netlify/blobs") return request; return origResolve.call(this, request, ...rest); };
require.cache["@netlify/blobs"] = { id: "@netlify/blobs", filename: "@netlify/blobs", loaded: true, exports: { getStore: (o) => { const m = STORES[o.name] || (STORES[o.name] = new Map()); return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); } }; } } };
/* The AI, stubbed: whatever ANSWER holds comes back. */
let ANSWER = "", ASKED = null;
const claudePath = require.resolve("../netlify/functions/lib/claude");
require.cache[claudePath] = { id: claudePath, filename: claudePath, loaded: true, exports: { messages: async (k, payload) => { ASKED = payload; return { content: [{ type: "text", text: ANSWER }] }; }, textOf: (m) => m.content[0].text, jsonOf: (t) => { try { return JSON.parse(t); } catch (e) { return null; } } } };
process.env.DASHBOARD_KEY = "k";
process.env.ANTHROPIC_API_KEY = "test";
delete process.env.RESEND_API_KEY;
const { keepHandPrices } = require("../netlify/functions/lib/hand-prices");
const pin = require("../netlify/functions/lib/scope-pin");
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? "PASS  " : "FAIL  ") + n + (d ? "\n        " + d : "")); };
const fn = (src, name) => {
  const s = src.indexOf("function " + name + "(");
  if (s < 0) throw new Error("missing " + name);
  let d = 0;
  for (let j = src.indexOf("{", s); j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}") { d--; if (!d) return src.slice(s, j + 1); } }
  throw new Error("unbalanced " + name);
};
const pz = D.slice(D.indexOf('<style id="pz-styles">'), D.lastIndexOf("</body>"));

console.log("\n1. The card, where the design puts it\n");
const render = fn(pz, "pzRender");
ok("its own card right after Request, before Scope & Price", /aiRead \+ '<\/div>' \+\s*pzChatHtml\(r\);/.test(render) && render.indexOf("pzChatHtml(r)") < render.indexOf("2 · Scope &amp; Price"));
const card = fn(pz, "pzChatHtml");
ok("header 💬 Conversation + status chip, and the line under it", /💬 Conversation/.test(card) && /id="pz-chst"/.test(card) && /Every message here is read by the AI when it prices and writes the scope\. Newest message wins\./.test(card));
ok("reply box, 📎, 📷 Ask photos, ✨ Polish, Send reply (the existing send)", /id="cnv-text"[^>]*placeholder="Write a reply…"/.test(card) && /📎<input type="file"/.test(card) && /📷 Ask photos/.test(card) && /✨ Polish/.test(card) && /id="cnv-btn" onclick="sendThreadReply\(\)">Send reply</.test(card));
ok("the note under Send says what really happens: email (no text messages are sent)", /Sends by email with the project header\. Customer replies come back here\./.test(card) && !/Sends by text/.test(pz));
ok("one reply box: the old conversation leaves the More tools drawer", /tools\.querySelector\("#cnv-section"\)[\s\S]{0,80}removeChild\(oldCnv\)/.test(fn(pz, "pzMount")));
ok("phone header: 💬 chip with the message count, tap jumps to the chat; Chat jump chip", /id="pz-mchat" onclick="event\.stopPropagation\(\);pzJump\(\\'pz-chat\\'\)"/.test(pz) && /set\("pz-mchat", "💬 " \+ threadOf\(r\)\.length\)/.test(pz) && /\["Chat", "pz-chat"\]/.test(pz));
ok("a draft he is typing survives a redraw of the screen", /var draft = document\.getElementById\("cnv-text"\), draftVal = draft \? draft\.value : "";\s*main\.innerHTML = html;\s*if \(draftVal\)/.test(render));
ok("the thread redraws inside the card after a send (cnvRefresh -> pzChatRefresh)", /cnvRefresh = function \(\) \{ if \(document\.getElementById\("pz-chat"\)\) return pzChatRefresh\(\);/.test(pz));
ok("Send carries the attached files, and clears them after", /attachments: \(typeof cnvAttachments !== "undefined" && cnvAttachments\.length\) \? cnvAttachments : undefined/.test(fn(D, "sendThreadReply")) && /cnvAttachments\.length = 0/.test(fn(D, "sendThreadReply")));
ok("\"Ask customer\" in the AI read goes to this card", /pzJump\("pz-chat"\)/.test(fn(pz, "pzAskCustomer")));

console.log("\n2. Bubbles, status, what the AI learned\n");
const ctx = { console, Object, Array, String, Number, Date, isFinite, JSON };
ctx.SBC_AI_GENERATOR = true; vm.createContext(ctx);
vm.runInContext("function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;')}\nvar PZ={factsAsked:{},factsReading:'',factsChanged:''};\n" +
  "var PZ_VIA = { quote: \"quote page\", gmail: \"email\", dashboard: \"email\" };\n" +
  ["threadOf", "threadNeedsReply", "threadWaiting", "cnvAttachmentsHtml"].map((n) => fn(D, n)).join("\n") + "\n" +
  ["pzWhen", "pzMsgsHtml", "pzLastCust", "pzChatStale", "pzChatStatus", "pzLearnHtml", "pzAsks", "pzSuggHtml"].map((n) => fn(pz, n)).join("\n"), ctx);
const rec = {
  ref: "SBC-1", status: "drafted", aiFinishedAt: "2026-10-06T19:00:00Z", customer: { name: "Maria Lopez" },
  estimate: { labor: [{ item: "Paint", qty: 1, rate: 1 }], clarificationQuestions: [{ question: "Q1" }, "Q2", "Q3", "Q4"] },
  thread: [
    { id: "a", from: "customer", text: "Hi, the hallway is about 15 ft long.", at: "2026-10-06T18:10:00Z", via: "gmail" },
    { id: "b", from: "contractor", text: "Walls only?", at: "2026-10-06T18:31:00Z", via: "dashboard" },
    { id: "c", from: "customer", text: "Walls only. Vanity arrives Oct 12.", at: "2026-10-06T19:02:00Z", via: "quote", attachments: [{ name: "a.jpg", url: "https://x/a.jpg", kind: "image" }, { name: "b.jpg", url: "https://x/b.jpg", kind: "image" }] }],
  chatFacts: { at: "2026-10-06T19:03:00Z", basedOn: "2026-10-06T19:02:00Z", facts: [{ id: "f1", text: "Hallway ~15 ft long", effect: "painting qty 120 sf", on: true }, { id: "f2", text: "Ceiling not included", effect: "added to Not included", on: false }], ask: ["Is the shower valve working?", "Photo under the sink?"] },
};
const R = (expr, r) => vm.runInContext(expr.replace("R", JSON.stringify(r)), ctx);
const msgs = R("pzMsgsHtml(R)", rec);
ok("customer white on the left, me navy on the right", (msgs.match(/class="pz-msg them"/g) || []).length === 2 && (msgs.match(/class="pz-msg me"/g) || []).length === 1 && /\.pz-msg\.me\{background:#0f1f3a;color:#fff;align-self:flex-end\}/.test(pz) && /\.pz-msg\.them\{background:#fff;[^}]*align-self:flex-start\}/.test(pz));
ok("name · date · channel: \"Maria · Oct 6, 2:10 PM · email\", \"You · Oct 6, 2:31 PM · email\", quote page", /Maria · Oct 6, 2:10 PM · email</.test(msgs) && /You · Oct 6, 2:31 PM · email</.test(msgs) && /Maria · Oct 6, 3:02 PM · quote page</.test(msgs));
ok("photos shown inside the message", /Vanity arrives Oct 12\.<div class="cnv-att"><a href="https:\/\/x\/a\.jpg"[^>]*><img/.test(msgs));
ok("text is escaped", /&lt;b&gt;/.test(R("pzMsgsHtml(R)", { customer: {}, thread: [{ from: "customer", text: "<b>x", at: "2026-10-06T18:10:00Z" }] })));
ok("status: the customer wrote last -> Customer replied", /Customer replied/.test(R("pzChatStatus(R)", rec)));
const waiting = Object.assign({}, rec, { thread: rec.thread.slice(0, 2) });
ok("status: he wrote last -> ⏳ Waiting for customer, tap it to clear waiting", /⏳ Waiting for customer/.test(R("pzChatStatus(R)", waiting)) && /onclick="if\(confirm\('Clear waiting for customer\?'\)\)pzWaiting\(false\)">⏳ Waiting for customer/.test(R("pzChatStatus(R)", waiting)));
const learn = R("pzLearnHtml(R)", rec);
ok("🧠 AI learned: one line per fact with what it changed, each with a tick", /🧠 AI learned from this chat/.test(learn) && /data-f="f1" checked onchange="pzFactTick\(\)"><span>Hallway ~15 ft long → painting qty 120 sf/.test(learn));
ok("a fact he switched off stays unticked", /data-f="f2" onchange/.test(learn));
ok("the newest customer message is newer than the estimate -> the chip and the gold Update button", /Estimate is older than the last message/.test(learn) && /pz-gold pz-sm" onclick="pzChatUpdate\(\)">↻ Update estimate from chat/.test(learn));
const fresh = Object.assign({}, rec, { aiFinishedAt: "2026-10-06T20:00:00Z" });
ok("an estimate made after the last message: no chip, no button", !/older than the last message|Update estimate/.test(R("pzLearnHtml(R)", fresh)));
ok("a hand-made estimate (no AI run) is not called old", !R("pzChatStale(R)", Object.assign({}, rec, { aiFinishedAt: "" })));
ok("my own last message does not make the estimate old", !R("pzChatStale(R)", Object.assign({}, rec, { aiFinishedAt: "2026-10-06T19:05:00Z", thread: rec.thread.concat([{ id: "d", from: "contractor", text: "ok", at: "2026-10-06T20:00:00Z" }]) })));
ok("no customer message yet: no learned box", R("pzLearnHtml(R)", { thread: [{ from: "contractor", text: "x", at: "2026-10-06T18:10:00Z" }] }) === "");
const sugg = R("pzSuggHtml(R)", rec);
ok("AI suggests asking: the questions it found, tap puts one in the reply box", /AI suggests asking/.test(sugg) && /onclick="pzSugg\(0\)">Is the shower valve working\?</.test(sugg) && /box\.value = [^;]*q;/.test(fn(pz, "pzSugg")));
ok("...no questions from the chat yet: the estimate's own, at most 3", JSON.stringify(R("pzAsks(R)", Object.assign({}, rec, { chatFacts: null }))) === '["Q1","Q2","Q3"]');
ok("📷 Ask photos puts a link to their estimate page in the reply (Add photos or files)", /quote\.html\?ref=" \+ encodeURIComponent\(currentRecord\.ref\)/.test(fn(pz, "pzAskPhotos")) && /Add photos or files/.test(fn(pz, "pzAskPhotos")));
ok("📎 files go straight to storage and ride on the message", /customer-upload-url/.test(fn(pz, "pzAttach")) && /cnvAttachments\.push\(\{ name: f\.name \|\| "file", url: j\.publicUrl/.test(fn(pz, "pzAttach")));
ok("✨ Polish puts the words back in the box, sends nothing", /polish-reply/.test(fn(pz, "pzPolish")) && /box\.value = j\.text/.test(fn(pz, "pzPolish")) && !/sendThreadReply/.test(fn(pz, "pzPolish")));
ok("the AI reads the chat only when a customer message is newer than what it read (once per message)", /PZ\.factsAsked\[k\] \|\| \(cf\.at && Date\.parse\(cf\.basedOn \|\| ""\) >= Date\.parse\(lc\.at \|\| ""\)\)/.test(fn(pz, "pzFactsRead")));
ok("Update saves his edits first, then re-prices", /await pzSaveNow\(\);[\s\S]*pzGenerate\(true\)/.test(fn(pz, "pzChatUpdate")) && /generateAI\(again === true, false\)/.test(fn(pz, "pzGenerate")));

console.log("\n3. Prices he typed by hand survive the update\n");
ok("typing a qty, rate, name or unit marks the line his; so do lines he adds, templates and his library", /if \(field === "qty" \|\| field === "rate" \|\| field === "item" \|\| field === "unit"\) l\.byHand = true;/.test(fn(pz, "pzLine")) && /byHand: true \} : \{ item: "New material"/.test(fn(pz, "pzAddLine")) && /byHand: true \}\);/.test(fn(pz, "pzLoadTemplate")) && /byHand: true \}\);/.test(fn(pz, "pzLibrary")));
const prev = { labor: [{ section: "Painting", item: "Paint hallway walls", qty: 120, unit: "sf", rate: 2.1, byHand: true }, { section: "Painting", item: "Prep", qty: 2, unit: "hrs", rate: 70 }],
  materials: [{ section: "Bathroom", item: "Vanity 30 in (his pick)", qty: 1, unit: "ea", rate: 640, byHand: true }] };
const next = { labor: [{ section: "Painting", item: "Paint  hallway walls.", qty: 150, unit: "sf", rate: 1.6 }, { section: "Painting", item: "Prep", qty: 3, unit: "hrs", rate: 75 }], materials: [{ section: "Bathroom", item: "Toilet", qty: 1, unit: "ea", rate: 199 }] };
const out = keepHandPrices(prev, next);
ok("same work: his qty and rate come back", next.labor[0].qty === 120 && next.labor[0].rate === 2.1 && next.labor[0].byHand === true && out.kept === 1);
ok("a line he did not touch takes the new numbers", next.labor[1].qty === 3 && next.labor[1].rate === 75);
ok("a line he added himself that the new estimate lacks is kept", out.added === 1 && next.materials.length === 2 && next.materials[1].rate === 640);
ok("same name in another service is not his line", (() => { const n = { labor: [{ section: "Kitchen", item: "Paint hallway walls", qty: 9, rate: 9 }] }; keepHandPrices({ labor: [prev.labor[0]] }, n); return n.labor[0].qty === 9 && n.labor.length === 2; })());
ok("nothing typed by hand: nothing changes", JSON.stringify(keepHandPrices({ labor: [{ item: "a", qty: 1, rate: 1 }] }, { labor: [{ item: "a", qty: 2, rate: 2 }] }).estimate) === '{"labor":[{"item":"a","qty":2,"rate":2}]}');
const gen = fs.readFileSync(path.join(ROOT, "netlify", "functions", "generate-estimate-background.js"), "utf8");
const hk = gen.indexOf("keepHandPrices(previousEstimate, estimate)");
ok("the generator puts them back after live prices, before the service totals are built, never when adding a service", hk > gen.indexOf("priceMaterialsLive(estimate") && hk < gen.indexOf("estimate = finalizeCustomerPresentation(estimate, projectAnalysis, input);") && /if \(!addSvc && previousEstimate\) \{\s*const hand = keepHandPrices/.test(gen));

console.log("\n4. The ticks reach the estimator\n");
const cff = new Function("cleanText", fn(gen, "chatFactsFor") + "; return chatFactsFor;")((v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim());
const facts = cff(rec);
ok("ticked facts go as use, switched-off ones as ignore", JSON.stringify(facts) === JSON.stringify({ use: ["Hallway ~15 ft long -> painting qty 120 sf"], ignore: ["Ceiling not included -> added to Not included"] }) && cff({}) === null);
ok("the analysis and the pricing prompts are told not to use an ignored fact", /contractor\.chatFacts, when present[^\n]*"ignore" was switched off by the contractor - do not use it/.test(gen) && /input\.contractor\.chatFacts\.ignore lists facts from the customer chat he switched off: do not use them/.test(gen) && /if \(facts\) input\.contractor\.chatFacts = facts;/.test(gen));
const base = { customer: { address: "x" }, request: { description: "Paint", conversation: [] }, contractor: {} };
ok("a switched-off fact reads the job again; without one every fingerprint stays as it was", pin.scopeFingerprint(Object.assign({}, base, { contractor: { chatFacts: { use: ["a"], ignore: [] } } })) === pin.scopeFingerprint(base) && pin.scopeFingerprint(Object.assign({}, base, { contractor: { chatFacts: { use: [], ignore: ["a"] } } })) !== pin.scopeFingerprint(base));
const ge = fs.readFileSync(path.join(ROOT, "netlify", "functions", "get-estimate.js"), "utf8");
ok("the customer's page never gets what the AI read (quote view and scope link)", (ge.match(/delete view\.chatFacts;/g) || []).length === 2);

(async () => {
  console.log("\n5. The endpoints\n");
  const est = require("@netlify/blobs").getStore({ name: "estimates" });
  await est.setJSON("SBC-1", JSON.parse(JSON.stringify(rec)));
  const CF = require("../netlify/functions/chat-facts-background");
  const ev = (body, key) => ({ httpMethod: "POST", headers: key ? { "x-sbc-key": key } : {}, body: JSON.stringify(body) });
  ANSWER = JSON.stringify({ facts: [{ text: "Hallway ~15 ft long", effect: "painting qty 120 sf" }, { text: "Ceiling not included", effect: "added to Not included" }, { text: "Fully licensed building", effect: "" }], ask: ["Is the shower valve working?", "Are you licensed?", "Photo under the sink?", "COI?", "Fifth?"] });
  const denied = await CF.handler(ev({ ref: "SBC-1" }, ""));
  ok("contractor only: no key, refused", denied && denied.statusCode === 401);
  await CF.handler(ev({ ref: "SBC-1" }, "k"));
  let cf = (await est.get("SBC-1")).chatFacts;
  ok("reads the chat and stores the facts, newest message noted", cf.facts.length === 3 && Date.parse(cf.basedOn) === Date.parse("2026-10-06T19:02:00Z") && cf.facts[0].id === "f1");
  ok("a fact he had switched off stays off after a new read", cf.facts[0].on === true && cf.facts[1].on === false);
  ok("never \"licensed\", at most 3 questions", !/licens/i.test(JSON.stringify(cf)) && cf.ask.length === 3);
  ok("the AI is given the whole conversation, oldest first, both sides", /Maria Lopez: Hi, the hallway[\s\S]*Sani: Walls only\?[\s\S]*\[2 attachments\]/.test(ASKED.messages[0].content));
  await CF.handler(ev({ ref: "SBC-1", off: ["f1"] }, "k"));
  cf = (await est.get("SBC-1")).chatFacts;
  ok("a tick only switches facts, the AI is not asked again", cf.facts[0].on === false && cf.facts[1].on === true && cf.facts.length === 3);
  ANSWER = "not json";
  await CF.handler(ev({ ref: "SBC-1" }, "k"));
  cf = (await est.get("SBC-1")).chatFacts;
  ok("a failed read keeps the facts it had and says so", cf.facts.length === 3 && /Could not read/.test(cf.error));

  const TR = require("../netlify/functions/thread-reply");
  const tr = await TR.handler({ httpMethod: "POST", headers: { "x-sbc-key": "k" }, body: JSON.stringify({ ref: "SBC-1", text: "Here is the tile.", attachments: [{ name: "tile.jpg", url: "https://x/tile.jpg", kind: "image" }, { name: "bad", url: "javascript:alert(1)" }] }) });
  const last = JSON.parse(tr.body).message;
  ok("Send reply saves the files with the message (https links only)", tr.statusCode === 200 && last.attachments.length === 1 && last.attachments[0].url === "https://x/tile.jpg");

  const PR = require("../netlify/functions/polish-reply");
  ANSWER = "Hi Maria, we are licensed and ready.";
  const pr = await PR.handler({ httpMethod: "POST", headers: { "x-sbc-key": "k" }, body: JSON.stringify({ ref: "SBC-1", text: "hi maria we r ready" }) });
  const pno = await PR.handler({ httpMethod: "POST", headers: {}, body: JSON.stringify({ text: "x" }) });
  ok("✨ Polish: contractor only, the words come back, never \"licensed\"", pno.statusCode === 401 && pr.statusCode === 200 && JSON.parse(pr.body).text === "Hi Maria, we are insured and ready.");

  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})();
