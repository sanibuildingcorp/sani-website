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
ok("no labor lines but days typed: the typed timeline shows, curing counted INSIDE his days", noLabor && noLabor.workDays === 2 && noLabor.waitDays === 1 && noLabor.totalDays === 2 && noLabor.waitInside === true && noLabor.laborHours === 0);
const typed12 = scheduleOf(withEdit({ workDays: 12 }));
ok("he types 12 days: the job is 12 days start to finish, cure days are not added on top", typed12.totalDays === 12 && typed12.waitInside === true);
ok("auto count (nothing typed): cure days still add to the work days", auto.totalDays === Math.ceil(auto.workDays + auto.waitDays) && !auto.waitInside);
ok("junk in the boxes is ignored", JSON.stringify(scheduleOf(withEdit({ crew: "", workDays: -2, waitDays: "x" }))) === JSON.stringify(auto));

const ctx = { console }; vm.createContext(ctx);
vm.runInContext(Q.split("\n").find((l) => l.startsWith("const A=v=>Array.isArray")), ctx);
vm.runInContext(Q.slice(Q.indexOf("const SCH_HOUR="), Q.indexOf("function dayWord(")), ctx);
const cases = [withEdit({}), withEdit({ crew: 1 }), withEdit({ dailyHours: 10 }), withEdit({ workDays: 4, waitDays: 0 }), { labor: [], scheduleEdit: { workDays: 2, waitDays: 1 } }];
ok("quote.html counts every edit the same way as the server", cases.every((e) => JSON.stringify(vm.runInContext("scheduleOf(" + JSON.stringify(e) + ")", ctx)) === JSON.stringify(scheduleOf(e))));
ok("the customer page shows typed days even where the prices were taken out", !!vm.runInContext("schOf(" + JSON.stringify({ labor: [], scheduleEdit: { workDays: 2 } }) + ")", ctx));
const card = Q.slice(Q.indexOf("function renderPZ("), Q.indexOf("window.qzOpen=", Q.indexOf("function renderPZ(")));
ok("drying typed with no drying step named reads \"for drying and curing\", never \"while .\"", /'for drying and curing'/.test(card));
ok("the customer headline is the start-to-finish days, not weeks", /function qzDays\(sch\)\{if\(sch\.totalDays<=1\)return'1 day';const d=sch\.totalDays;return\(sch\.waitInside\?'':'About '\)\+d\+' working days'\}/.test(Q));

console.log("\n2. His numbers survive a regenerate\n");
/* The dashboard boxes themselves are the Perplexity estimate screen now
   (crew, hours a day, start date): js/dashboard-layout.test.js. */
ok("his timeline numbers survive a regenerate (server and dashboard lists)", OWNED.CONTRACTOR_OWNED_ESTIMATE_FIELDS.indexOf("scheduleEdit") !== -1 && /"scheduleEdit"\n\];/.test(D));

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
