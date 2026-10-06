/* estimate-edit.test.js — run: node js/estimate-edit.test.js
 *
 *   "Yes all functions i need to be editable in my dashboard"
 *
 * Every section of the new customer page (docVersion 4) has a box in the
 * dashboard: what we will do, the steps, the timeline (people, hours a day,
 * working days, drying days), Sani supplies, what we need from the customer,
 * what the price is based on. A number typed in the timeline wins over the
 * count; an empty box means automatic.
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const Q = fs.readFileSync(path.join(ROOT, "quote.html"), "utf8");
const D = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");
const { scheduleOf } = require("../netlify/functions/lib/schedule");
const OWNED = require("../netlify/functions/lib/contractor-owned-fields");
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? "PASS  " : "FAIL  ") + n + (d ? "\n        " + d : "")); };

const bath = { labor: [
  { section: "Bathroom", item: "Protect and demo", qty: 8, unit: "hrs", rate: 70 },
  { section: "Bathroom", item: "Waterproofing membrane on shower walls", qty: 6, unit: "hrs", rate: 90 },
  { section: "Bathroom", item: "Install wall tile", qty: 60, unit: "sf", rate: 14 },
  { section: "Bathroom", item: "Grout and seal", qty: 4, unit: "hrs", rate: 80 },
  { section: "Painting", item: "Paint walls 2 coats", qty: 320, unit: "sf", rate: 1.6 }] };
const withEdit = (ed) => Object.assign({}, bath, { scheduleEdit: ed });

console.log("\n1. His timeline numbers win\n");
const auto = scheduleOf(bath);
ok("empty edit = the automatic count", JSON.stringify(scheduleOf(withEdit({}))) === JSON.stringify(auto) && auto.edited === undefined);
const one = scheduleOf(withEdit({ crew: 1 }));
ok("one person instead of two: 34.9 hours / 8 = 4.5 working days (two people: 2.5)", one.crew === 1 && one.workDays === 4.5 && auto.workDays === 2.5);
const ten = scheduleOf(withEdit({ dailyHours: 10 }));
ok("10 hours a day: fewer working days", ten.workDays < auto.workDays && ten.dailyHours === 10);
const typed = scheduleOf(withEdit({ workDays: 4, waitDays: 0 }));
ok("typed working days and drying days replace the count, total follows", typed.workDays === 4 && typed.waitDays === 0 && typed.totalDays === 4 && typed.edited === true && typed.auto.workDays === auto.workDays && typed.auto.waitDays === auto.waitDays);
const noLabor = scheduleOf({ labor: [], scheduleEdit: { workDays: 2, waitDays: 1 } });
ok("no labor lines but days typed: the typed timeline shows", noLabor && noLabor.workDays === 2 && noLabor.waitDays === 1 && noLabor.totalDays === 3 && noLabor.laborHours === 0);
ok("junk in the boxes is ignored", JSON.stringify(scheduleOf(withEdit({ crew: "", workDays: -2, waitDays: "x" }))) === JSON.stringify(auto));

const ctx = { console }; vm.createContext(ctx);
vm.runInContext(Q.split("\n").find((l) => l.startsWith("const A=v=>Array.isArray")), ctx);
vm.runInContext(Q.slice(Q.indexOf("const SCH_HOUR="), Q.indexOf("function dayWord(")), ctx);
const cases = [withEdit({}), withEdit({ crew: 1 }), withEdit({ dailyHours: 10 }), withEdit({ workDays: 4, waitDays: 0 }), { labor: [], scheduleEdit: { workDays: 2, waitDays: 1 } }];
ok("quote.html counts every edit the same way as the server", cases.every((e) => JSON.stringify(vm.runInContext("scheduleOf(" + JSON.stringify(e) + ")", ctx)) === JSON.stringify(scheduleOf(e))));
ok("the customer page shows typed days even where the prices were taken out", !!vm.runInContext("schOf(" + JSON.stringify({ labor: [], scheduleEdit: { workDays: 2 } }) + ")", ctx));
const card = Q.slice(Q.indexOf("function scheduleCard("), Q.indexOf("\n", Q.indexOf("function scheduleCard(")));
ok("drying typed with no drying step named reads \"for drying and curing\", never \"while .\"", /'for drying and curing'/.test(card));
ok("a 1-day job with drying days typed is not shown as \"1 day\"", /function schSmall\(sch\)\{return sch\.workDays<=1&&!\(sch\.waitDays>0\)\}/.test(Q) && /const small=schSmall\(sch\)/.test(card));

console.log("\n2. The dashboard has a box for every section\n");
const html = D.slice(D.indexOf("function v4Lines("), D.indexOf("function gatherForm() {"));
["f-overview", "v4-steps", "f-crew", "f-dayhours", "f-workdays", "f-waitdays", "f-sani", "f-needs", "f-basis"].forEach((id) => ok("box " + id, html.indexOf(id) !== -1));
ok("the section sits in the estimate form, before step 4", D.indexOf("v4EditHtml(est) +") !== -1 && D.indexOf("v4EditHtml(est) +") < D.indexOf("stepBar(4, 'Decide what the customer sees'"));
ok("Save reads the boxes AFTER the carried fields, so the edit is what is saved", /return v4Gather\(out\);\n\}/.test(D));
ok("his timeline numbers survive a regenerate (server and dashboard lists)", OWNED.CONTRACTOR_OWNED_ESTIMATE_FIELDS.indexOf("scheduleEdit") !== -1 && /"scheduleEdit"\n\];/.test(D));
const gen = fs.readFileSync(path.join(ROOT, "netlify", "functions", "generate-estimate-background.js"), "utf8");
ok("...and the regenerated timeline is counted with them", gen.indexOf("if (estimate.scheduleEdit)") > gen.indexOf("preserveContractorFields(carry.previous, estimate)"));

/* Run the dashboard functions against a tiny page. */
const dctx = { console, isFinite, Number }; vm.createContext(dctx);
vm.runInContext(D.slice(D.indexOf("function esc("), D.indexOf("}", D.indexOf("function esc(")) + 1) + "\n" + html, dctx);
const rec = { overview: "We will refresh your bathroom.", workSteps: [{ title: "Protect", text: "Cover floors." }], saniSupplies: ["Toilet", "Grout"], customerNeeds: ["Clear the room"], priceBasis: ["5x8 ft"], schedule: auto, scheduleEdit: { crew: 1 } };
const out = vm.runInContext("v4EditHtml(" + JSON.stringify(rec) + ")", dctx);
ok("the boxes open with what the AI wrote", /We will refresh your bathroom\./.test(out) && /value="Protect"/.test(out) && /Toilet\nGrout/.test(out) && /id="f-crew"[^>]*value="1"/.test(out) && /Counted from your labor lines/.test(out));
const vals = { "f-overview": "  New words.  ", "f-sani": "• Toilet\n\n- Grout\n", "f-needs": "Clear the room", "f-basis": "", "f-crew": "3", "f-dayhours": "", "f-workdays": "5", "f-waitdays": "0" };
const rows = [{ t: "Protect", x: "Cover floors." }, { t: "", x: "" }, { t: "", x: "Paint two coats" }];
dctx.document = {
  getElementById: (id) => (id in vals ? { value: vals[id] } : null),
  querySelectorAll: () => rows.map((r) => ({ querySelector: (c) => ({ value: c === ".v4-st" ? r.t : r.x }) })),
};
const g = vm.runInContext("v4Gather({ docVersion: undefined })", dctx);
ok("Save keeps the edited words", g.overview === "New words." && g.saniSupplies.join("|") === "Toilet|Grout" && g.customerNeeds.length === 1 && g.priceBasis.length === 0);
ok("steps: empty rows dropped, a step with only text becomes its title", g.workSteps.length === 2 && g.workSteps[1].title === "Paint two coats");
ok("timeline: typed numbers kept, empty boxes left automatic, 0 drying kept", g.scheduleEdit.crew === 3 && g.scheduleEdit.workDays === 5 && g.scheduleEdit.waitDays === 0 && !("dailyHours" in g.scheduleEdit));
ok("text written by hand turns the new customer page on", g.docVersion === 4);
vals["f-overview"] = ""; rows.length = 0; ["f-crew", "f-workdays", "f-waitdays"].forEach((k) => { vals[k] = ""; });
const g2 = vm.runInContext("v4Gather({})", dctx);
ok("all boxes empty: nothing turned on, no timeline edit", g2.docVersion === undefined && g2.scheduleEdit === null);
dctx.document = { getElementById: () => null, querySelectorAll: () => [] };
ok("a save made where the boxes are not on screen keeps the record as it is", JSON.stringify(vm.runInContext("v4Gather({ overview: 'kept' })", dctx)) === JSON.stringify({ overview: "kept" }));

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
