/* dashboard-layout.test.js — run: node js/dashboard-layout.test.js
 *
 *   "I need exactly this dashboard layout made by perplexity"
 *
 * The estimate screen as Perplexity drew it: a navy bar that stays on top
 * (total, cost, profit, work days, Ready n/N, Preview, Send, the five steps),
 * numbered sections on the left, Ready to send / Money / Quick actions on the
 * right, Preview / Send at the bottom; one card per service with its prices as
 * a table (LAB / MAT), "Finishes & who supplies" with a Customer supplies tick.
 * Every number is worked out from the estimate; nothing is invented.
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const D = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");
const Q = fs.readFileSync(path.join(ROOT, "quote.html"), "utf8");
const { scheduleOf } = require("../netlify/functions/lib/schedule");
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? "PASS  " : "FAIL  ") + n + (d ? "\n        " + d : "")); };
const fn = (src, name) => {
  const s = src.indexOf("function " + name + "(");
  if (s < 0) throw new Error("missing " + name);
  let d = 0;
  for (let j = src.indexOf("{", s); j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}") { d--; if (!d) return src.slice(s, j + 1); } }
  throw new Error("unbalanced " + name);
};
const varLine = (src, name) => { const s = src.indexOf("var " + name + " ="); return src.slice(s, src.indexOf(";\n", s) + 1); };
const ws = D.slice(D.indexOf('<script>\n/* ═══════════ THE PERPLEXITY LAYOUT: head'), D.lastIndexOf("</body>"));

console.log("\n1. The timeline and the payment, the same as the server and the customer page\n");
const ctx = { console, isFinite, Number, Math, Date, String, Array, Object };
vm.createContext(ctx);
vm.runInContext(varLine(ws, "WS_HOUR") + "\nvar WS_WAITS = " + ws.slice(ws.indexOf("var WS_WAITS = [") + 15, ws.indexOf("];", ws.indexOf("var WS_WAITS = [")) + 2) + "\n" +
  ["wsScheduleOf", "wsFinish", "wsDay", "wsPayPlan"].map((n) => fn(ws, n)).join("\n"), ctx);
const bath = { labor: [
  { section: "Bathroom", item: "Protect and demo", qty: 8, unit: "hrs", rate: 70 },
  { section: "Bathroom", item: "Waterproofing membrane", qty: 6, unit: "hrs", rate: 90 },
  { section: "Bathroom", item: "Install wall tile", qty: 60, unit: "sf", rate: 14 },
  { section: "Painting", item: "Patch and paint 2 coats", qty: 320, unit: "sf", rate: 1.6 }] };
const cases = [bath, Object.assign({}, bath, { scheduleEdit: { crew: 1 } }), Object.assign({}, bath, { scheduleEdit: { workDays: 4, waitDays: 0 } }), { labor: [], scheduleEdit: { workDays: 2 } }, { labor: [{ item: "Small wall repair, skim coat", qty: 2.5, unit: "hrs", rate: 75 }] }, { labor: [{ item: "Remove and grout the shower", qty: 8, unit: "hrs", rate: 80 }] }, {}];
ok("the dashboard counts the timeline exactly as lib/schedule.js", cases.every((e) => JSON.stringify(vm.runInContext("wsScheduleOf(" + JSON.stringify(e) + ")", ctx)) === JSON.stringify(scheduleOf(e))));
const fin = vm.runInContext('wsDay(wsFinish("2026-10-15", 4))', ctx);
ok("start Thursday Oct 15, 4 days, Monday to Friday -> finish Tuesday Oct 20", fin === "Oct 20", fin);
ok("no start date, no finish", vm.runInContext('wsFinish("", 3)', ctx) === null);
const qctx = { console, SOW: false }; vm.createContext(qctx);
vm.runInContext(Q.split("\n").find((l) => l.startsWith("const A=v=>Array.isArray")), qctx);
const ps = Q.indexOf("const PAY_SMALL=");
vm.runInContext(Q.slice(ps, Q.indexOf("\n", ps)) + "\n" + Q.slice(Q.indexOf("function payPlan("), Q.indexOf("\n", Q.indexOf("function payPlan("))), qctx);
const amounts = (p) => JSON.stringify(p.map((x) => [x.amount, x.pct]));
ok("the payment rows match the customer page for every tier", [400, 999.99, 1000, 3000, 5000, 5000.01, 5900, 7777.77].every((t) => amounts(vm.runInContext("wsPayPlan(" + t + ")", ctx)) === amounts(vm.runInContext("payPlan({}," + t + ")", qctx))));
const contract = { contract: { sections: { paymentSchedule: [{ label: "Deposit", amount: 1000 }, { label: "Tile set", amount: 4900 }] } } };
ok("a contract written for the job wins when it adds up", vm.runInContext("wsPayPlan(5900," + JSON.stringify(contract) + ")[1].label", ctx) === "Tile set" && vm.runInContext("wsPayPlan(6000," + JSON.stringify(contract) + ").length", ctx) === 3);
const start = fn(Q, "schStartCells");
const sctx = {}; vm.createContext(sctx);
vm.runInContext(Q.split("\n").find((l) => l.startsWith("const A=v=>Array.isArray")).replace(/M=n=>SOW\?'':/, "M=n=>") + "\n" + start, sctx);
ok("the customer's timeline shows Start and Expected finish when he set a start", /Start<b>Oct 15<\/b><\/div><div>Expected finish<b>Oct 20<\/b>/.test(vm.runInContext('schStartCells({scheduleEdit:{start:"2026-10-15"}},{totalDays:4,workDays:4})', sctx)) && vm.runInContext("schStartCells({},{totalDays:4})", sctx) === "");

console.log("\n2. The screen\n");
const view = D.slice(D.indexOf("document.getElementById(\"edit-card\").innerHTML ="), D.indexOf("renderLines(\"labor\", est.labor || []);"));
const at = (k) => view.indexOf(k);
ok("the navy bar comes first, the sections in a grid, the side panel and the bottom bar last", at("wsHeadHtml(r)") > 0 && at("wsHeadHtml(r)") < at("stepBar(1,") && at('<aside class="ws-side" id="ws-side"></aside>') > at("modal-actions") && at('id="ws-foot"') > at("ws-side"));
ok("five sections in order: Request, Scope & Price, Timeline, Terms, Review & Send", ["stepBar(1, 'Request'", "stepBar(2, 'Scope & Price'", "stepBar(3, 'Timeline'", "stepBar(4, 'Terms'", "stepBar(5, 'Review & Send'"].reduce((p, k) => { const i = at(k); return p !== -1 && i > p ? i : -1; }, 0) > 0);
ok("the service cards sit in Scope & Price, the old flat line lists folded under More", at("stepBar(2,") < at('<div id="scope-control-wrap"></div>') && at('<div id="scope-control-wrap"></div>') < at("ws-more") && at("ws-more") < at('id="labor-body"') && at('id="labor-body"') < at("stepBar(3,"));
ok("Terms holds the markup slider, payment, warranty, validity and the internal totals", at("wsTermsHtml(est)") > at("stepBar(4,") && at("'<div class=\"totals-box\">'") > at("wsTermsHtml(est)") && at("'<div class=\"totals-box\">'") < at("stepBar(5,") && /<b>3-year workmanship<\/b>/.test(D) && /<b>30 days<\/b>/.test(D));
ok("one Save (the Services card): the bottom bar is Preview and Send only", !/id="ws-foot"[\s\S]{0,300}saveDraft\(\)/.test(D) && /wsPreview\(\)">Preview customer view</.test(D) && /sendToCustomer\(\)">Send estimate</.test(D));
ok("the head has the total, the cost / profit / days line, Ready n/N, Preview, Send and close", /id="ws-tot"/.test(ws) && /id="ws-sub"/.test(ws) && /id="ws-ready"/.test(ws) && /onclick="wsPreview\(\)">Preview</.test(ws) && /onclick="closeEdit\(\)"/.test(ws));
ok("the panels other parts of the page add (contract, follow-ups) are moved into their sections", /insertBefore\(ct, totals\.nextSibling\)/.test(ws) && /insertBefore\(fu, acts\)/.test(ws));
ok("the head and side follow every change (recalc), without redrawing a box he is typing in", /recalc = function \(\) \{ var o = _rc\.apply\(this, arguments\); try \{ wsRefresh\(\); \}/.test(ws) && /!side\.contains\(document\.activeElement\)/.test(ws));
ok("prices are a table: LAB / MAT tag on every line, open on every card", /<span class="ws-tag">' \+ \(blk\.kind === "labor" \? "LAB" : "MAT"\) \+ '<\/span>/.test(D) && /var linesOpen = !\(/.test(D));
ok("no price book buttons, no 'profit too low' warning: nothing that needs numbers he has not given", !/From price book|Profit per crew day is low|\+ Bathroom refresh/.test(D));
ok("no \"licensed\", TV mounting or gas work in the new code", !/licensed contractor|tv mount|gas (line|hook)up/i.test(ws));

console.log("\n3. Ready to send and Customer supplies\n");
{
  const c2 = { console, Object, Array, String, Number, isFinite, Math };
  vm.createContext(c2);
  vm.runInContext(fn(ws, "wsChecks") + "\nvar NEEDS=[];var STEPS=[];var TEXT='';var SVCS=[];" +
    "function scopeDraft(){return {services:SVCS}}function v4ReadLines(){return NEEDS}function v4ReadSteps(){return STEPS}function wsTextNow(){return TEXT}", c2);
  const rec = { estimate: { labor: [{ qty: 3 }], materials: [{ qty: 1 }] }, request: { description: "Bathroom in a co-op, elevator building" }, customer: {} };
  vm.runInContext("SVCS=[{name:'Bathroom',excluded:['Retile'],supplied:['Vanity']}];STEPS=[{title:'Protect',text:''}];", c2);
  let r = vm.runInContext("wsChecks(" + JSON.stringify(rec) + ")", c2).map((x) => [x[0], x[1]]);
  const get = (t) => (r.find((x) => x[1] === t) || [])[0];
  ok("checks: services, quantities, steps, Not included all pass", get("At least one service") && get("Every line has a quantity") && get("Steps for the customer are written") && get('Every service has "Not included"'));
  ok("a customer-supplied item needs a delivery date; a co-op needs the COI", get("Delivery date for customer-supplied items") === false && get("Building COI mentioned") === false);
  vm.runInContext("NEEDS=['Have your items on site by Oct 14','Send our insurance certificate (COI) request to your building management'];", c2);
  r = vm.runInContext("wsChecks(" + JSON.stringify(rec) + ")", c2).map((x) => [x[0], x[1]]);
  ok("...both pass once they are in What we need", get("Delivery date for customer-supplied items") === true && get("Building COI mentioned") === true);
  const house = { estimate: rec.estimate, request: { description: "House, kitchen" }, customer: {} };
  vm.runInContext("SVCS=[{name:'Kitchen',excluded:['x'],supplied:[]}];", c2);
  r = vm.runInContext("wsChecks(" + JSON.stringify(house) + ")", c2).map((x) => [x[0], x[1]]);
  ok("a house with nothing customer-supplied is not asked for either", !r.some((x) => /COI|Delivery/.test(x[1])));
  vm.runInContext("TEXT='We are a licensed contractor';", c2);
  r = vm.runInContext("wsChecks(" + JSON.stringify(house) + ")", c2).map((x) => [x[0], x[1]]);
  ok('"licensed" in the customer text is caught', get('No "licensed", no options, no gas work') === false);
}
{
  const c3 = { console, Object, Array, String, Number, isFinite, Math };
  vm.createContext(c3);
  vm.runInContext([fn(ws, "wsSupplyToggle"), fn(ws, "wsSupplyUndo"), fn(D, "scopeNorm"), fn(D, "scopeUnparkFor")].join("\n") +
    "\nvar toasts=[];function toast(t){toasts.push(t)}function syncLines(){}function scopeLinesRefresh(){}function fmt(n){return '$'+n}function scopeLineValue(l){return l.qty*l.rate}" +
    "\nvar SVC={name:'Bathroom',supplied:[]};function scopeDraft(){return {services:[SVC]}}" +
    "\nvar currentRecord={estimate:{labor:[{item:'Install vanity',qty:4,rate:120,section:'Bathroom'}],materials:[{item:'Grout kit',qty:1,rate:85,section:'Bathroom'},{item:'Vanity with top',qty:1,rate:489,section:'Bathroom'}]}};", c3);
  vm.runInContext("wsSupplyToggle(0,1,true)", c3);
  const e = vm.runInContext("currentRecord.estimate", c3);
  ok("TICK: the vanity's material leaves the price, its labor stays", e.materials.length === 1 && e.materials[0].item === "Grout kit" && e.labor.length === 1 && e.parkedLines.length === 1 && e.parkedLines[0].custSupplied === true);
  ok("...and it is listed as Customer supplies on the card", JSON.stringify(vm.runInContext("SVC.supplied", c3)) === '["Vanity with top"]');
  vm.runInContext("wsSupplyUndo(0,0)", c3);
  const e2 = vm.runInContext("currentRecord.estimate", c3);
  ok("UNTICK: the very same line comes back where it was, and the wording goes", e2.materials.length === 2 && e2.materials[1].item === "Vanity with top" && e2.materials[1].rate === 489 && e2.parkedLines.length === 0 && vm.runInContext("SVC.supplied.length", c3) === 0);
  ok("an untick never fires the tick path", vm.runInContext("(function(){var n=currentRecord.estimate.materials.length;wsSupplyToggle(0,0,false);return currentRecord.estimate.materials.length===n})()", c3) === true);
}

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
