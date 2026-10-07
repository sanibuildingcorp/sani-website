/* estimate-v4.test.js — run: node js/estimate-v4.test.js
 *
 *   "Upgrade direct in to the current estimate system ... with Perplexity
 *    design" / "clear understandable written estimate with scope of work"
 *
 * docVersion 4: the scope writer (the same AI, after the prices are final)
 * writes the whole estimate - what we will do, how the work will go, what
 * Sani supplies, what we need from the customer, what the price is based on.
 * The timeline is COUNTED from the labor lines (lib/schedule.js, the same
 * function in quote.html). Old estimates keep their old page.
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const Q = fs.readFileSync(path.join(ROOT, "quote.html"), "utf8");
const { scheduleOf } = require("../netlify/functions/lib/schedule");
const W = require("../netlify/functions/lib/scope-writer");
const { scopeOnlyView, findMoney } = require("../netlify/functions/lib/scope-only");
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? "PASS  " : "FAIL  ") + n + (d ? "\n        " + d : "")); };

console.log("\n1. The timeline is counted\n");
const small = { labor: [{ section: "Painting", item: "Scrape loose paint, skim coat, hand sand, prime and paint the wall", qty: 2.5, unit: "hrs", rate: 75 }] };
const bath = { labor: [
  { section: "Bathroom", item: "Protect and demo", qty: 8, unit: "hrs", rate: 70 },
  { section: "Bathroom", item: "Waterproofing membrane on shower walls", qty: 6, unit: "hrs", rate: 90 },
  { section: "Bathroom", item: "Install wall tile", qty: 60, unit: "sf", rate: 14 },
  { section: "Bathroom", item: "Grout and seal", qty: 4, unit: "hrs", rate: 80 },
  { section: "Painting", item: "Paint walls 2 coats", qty: 320, unit: "sf", rate: 1.6 }] };
const s1 = scheduleOf(small), s2 = scheduleOf(bath);
ok("A SMALL WALL REPAIR STAYS ONE DAY: 2.5 hours, one person, drying between the steps", s1.workDays === 0.5 && s1.crew === 1 && s1.waitDays === 0 && s1.totalDays === 1);
ok("a bathroom: hours / (2 people x 8 h), plus waterproofing, tile and grout waiting days", s2.crew === 2 && s2.workDays === 2.5 && s2.waitDays === 3 && s2.totalDays === 6 && s2.sections.length === 2);
ok("no labor, no timeline", scheduleOf({ labor: [] }) === null && scheduleOf({}) === null);
const ctx = { console }; vm.createContext(ctx);
vm.runInContext(Q.split("\n").find((l) => l.startsWith("const A=v=>Array.isArray")), ctx);
const qb = Q.slice(Q.indexOf("const SCH_HOUR="), Q.indexOf("function isV4("));
vm.runInContext(qb + "\n" + Q.slice(Q.indexOf("function isV4("), Q.indexOf("function dayWord(")), ctx);
ok("quote.html counts it the same way as lib/schedule.js", [small, bath, { labor: [{ item: "Mount door", qty: 3, unit: "ea", rate: 120 }] }].every((e) => JSON.stringify(vm.runInContext("scheduleOf(" + JSON.stringify(e) + ")", ctx)) === JSON.stringify(scheduleOf(e))));
ok("old estimates keep their page: only docVersion 4 with an overview or steps gets the new one", ctx.isV4({ docVersion: 4, overview: "We will repair the wall." }) === true && ctx.isV4({ overview: "x" }) === false && ctx.isV4({ docVersion: 4 }) === false);

console.log("\n2. The writer writes the whole estimate\n");
const est = () => ({ serviceBreakdown: [{ title: "Bathroom", included: [], customerSupplies: ["Vanity with top and faucet"], notIncluded: [] }], labor: bath.labor.slice(0, 4).map((l) => Object.assign({}, l, { section: "Bathroom" })), materials: [{ section: "Bathroom", item: "Toilet, elongated 2-piece", qty: 1, unit: "ea", rate: 300 }] });
const prompt = W.buildScopePrompt(est(), { project_type: "partial renovation" }, { request: { description: "Bathroom refresh" } });
ok("the prompt asks for overview, steps, Sani supplies, what we need, price basis", ["\"overview\"", "\"steps\"", "\"saniSupplies\"", "\"customerNeeds\"", "\"priceBasis\""].every((k) => prompt.indexOf(k) !== -1) && /NEVER an item the customer supplies/.test(prompt) && /customer_supplies/.test(prompt));
const repairPrompt = W.buildScopePrompt(est(), { project_type: "repair" }, { request: { description: "fix the wall" } });
ok("...a repair gets 1-2 sentences and 2-4 steps", /"overview" - 1 to 2 sentences/.test(repairPrompt) && /"steps" - 2 to 4/.test(repairPrompt));
const e = est();
W.applyScopeToEstimate(e, { services: [{ service: "Bathroom", included: ["Install the toilet and test it."], notIncluded: [] }],
  overview: "We will refresh your bathroom. We are a licensed contractor.",
  steps: [{ title: "Protect and prepare", text: "We cover the floors." }, { title: "", text: "dropped" }, { title: "Install", text: "Toilet set and tested" }],
  saniSupplies: ["Toilet, elongated 2-piece", "Vanity with top and faucet", "Grout, sealer and caulk"],
  customerNeeds: ["Clear the bathroom before we start"], priceBasis: ["Bathroom about 5x8 ft"] }, null, 3);
ok("docVersion 4 with overview and numbered steps (an untitled step is dropped)", e.docVersion === 4 && /refresh your bathroom/.test(e.overview) && e.workSteps.length === 2 && e.workSteps[1].text === "Toilet set and tested.");
ok("\"licensed\" is stripped from the overview", !/licens/i.test(e.overview));
ok("Sani supplies never lists what the customer supplies", e.saniSupplies.length === 2 && !e.saniSupplies.some((x) => /vanity/i.test(x)));
ok("what we need and price basis are kept", e.customerNeeds[0] === "Clear the bathroom before we start." && e.priceBasis[0] === "Bathroom about 5x8 ft.");
const old = est(); W.applyScopeToEstimate(old, { services: [{ service: "Bathroom", included: ["x y z"] }] }, null, 3);
ok("a writer answer without the new parts leaves docVersion unset", old.docVersion === undefined && old.overview === undefined);

console.log("\n3. Every page shows it\n");
ok("render: docVersion 4 -> the Perplexity customer page (renderPZ), otherwise exactly as before", /if\(isV7\(e\)&&isV4\(e\)\)renderPZ\(r\);else if\(isV7\(e\)\)renderV7\(r\);else renderLegacy\(r\);/.test(Q));
const v8 = Q.slice(Q.indexOf("function renderPZ("), Q.indexOf("window.qzOpen=", Q.indexOf("function renderPZ(")));
ok("the page order (the design): price, what we will do, steps, timeline, who supplies, what will be installed, included, not included, what we need, price basis, payment, promise, talk to us", ["Your price", "What we will do", "How the work will go", ">Timeline<", "Who supplies what", "What will be installed", "What is included", ">Not included<", "What we need from you", "This price is based on", "Payment schedule", "Our promise", "Talk to us"].reduce((p, k) => { const i = v8.indexOf(k); return p !== -1 && i > p ? i : -1; }, 0) > 0);
ok("customer supplies are shown once, in Who supplies what (not again per service)", v8.indexOf("customerSupplies,'sup'") === -1 && v8.indexOf("'Customer supplies'") === -1);
const sow = scopeOnlyView({ estimate: Object.assign(est(), { docVersion: 4, overview: "We will refresh your bathroom.", workSteps: [{ title: "A", text: "B." }], saniSupplies: ["Toilet"], customerNeeds: ["Clear the room."], priceBasis: ["5x8 ft"], schedule: scheduleOf(bath) }) });
ok("the no-price page keeps overview, steps, Sani supplies, what we need and the timeline - and no money", sow.estimate.docVersion === 4 && sow.estimate.workSteps.length === 1 && sow.estimate.saniSupplies.length === 1 && sow.estimate.schedule.workDays === 2.5 && findMoney(sow.estimate).length === 0);
const { buildScopePdf } = require("../netlify/functions/lib/scope-pdf");
let pdf = null; try { pdf = buildScopePdf(sow, { now: "2026-10-07T12:00:00Z" }); } catch (err) { pdf = err; }
ok("the scope PDF builds with the new sections", pdf && !(pdf instanceof Error) && pdf.length > 1000, String(pdf && pdf.message || ""));
const gen = fs.readFileSync(path.join(ROOT, "netlify", "functions", "generate-estimate-background.js"), "utf8"), save = fs.readFileSync(path.join(ROOT, "netlify", "functions", "save-estimate.js"), "utf8");
ok("the generator and every Save count the timeline", /estimate\.schedule = sch/.test(gen) && /existing\.estimate\.schedule = sch/.test(save));
ok("no \"licensed\", no options, no TV mounting, no gas work in the new page code", !/licens|tv mount|Option A|gas (line|hook)/i.test(v8 + qb));

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
