/* dashboard-layout.test.js — run: node js/dashboard-layout.test.js
 *
 *   "Rebuild exactly one in one copy design layout!!! From current dashboard
 *    remove whatever need to remove!"
 *
 * The estimate screen is Perplexity's dashboard-layout.html, wired to the real
 * record (the pz- block at the end of dashboard.html). The old screen is the
 * hidden "More tools" drawer. These tests hold the design's parts, its numbers,
 * and the edits that move money: the customer-supplies tick, autosave, the
 * timeline count, the payment rows.
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const D = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");
const Q = fs.readFileSync(path.join(ROOT, "quote.html"), "utf8");
const { scheduleOf } = require("../netlify/functions/lib/schedule");
const Module = require("module");
const STORES = {};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === "@netlify/blobs") return request; return origResolve.call(this, request, ...rest); };
require.cache["@netlify/blobs"] = { id: "@netlify/blobs", filename: "@netlify/blobs", loaded: true, exports: { getStore: (o) => { const m = STORES[o.name] || (STORES[o.name] = new Map()); return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); } }; } } };
process.env.DASHBOARD_KEY = "k";
const PB = require("../netlify/functions/price-book");
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
const lit = (name, open, close) => { const s = pz.indexOf("var " + name + " = " + open); return "var " + name + " = " + pz.slice(s + ("var " + name + " = ").length, pz.indexOf(close + ";", s) + close.length) + ";"; };

console.log("\n1. The design, part for part\n");
[
  ["the sticky top bar: ref and customer, total, cost / profit / work days", /class="pz-top"/.test(pz) && /id="pz-tot"/.test(pz) && /"Cost " \+ pzF\(t\.sub\) \+ " · Profit "/.test(pz)],
  ["Ready n/8, Preview and Send in the top bar", /"Ready " \+ okN \+ "\/" \+ C\.length/.test(pz) && /onclick="pzPreview\(\)">Preview</.test(pz) && /onclick="pzSend\(\)">Send</.test(pz)],
  ["the 5-step bar", /\["Request", "Scope & Price", "Timeline", "Terms", "Review & Send"\]/.test(pz)],
  ["1 · Request with photos · messages and the AI read", /<h2>1 · Request<\/h2>/.test(pz) && /<b>AI read:<\/b>/.test(pz)],
  ["2 · Scope & Price with the price book packages", /2 · Scope &amp; Price/.test(pz) && /class="pz-tpl"/.test(pz)],
  ["each service: Prices, Finishes & who supplies, Steps for the customer, Included, Not included — stacked and foldable, no tabs", /"Prices"[\s\S]{0,200}"Finishes &amp; who supplies"[\s\S]{0,200}"Steps for the customer"[\s\S]{0,200}"Included"[\s\S]{0,200}"Not included"/.test(pz) && /<details class="pz-sec"/.test(pz)],
  ["+ Labor / + Material, + Add service, + Add from my product library, ↻ AI rewrite", /\+ Labor</.test(pz) && /\+ Material</.test(pz) && /\+ Add service</.test(pz) && /\+ Add from my product library</.test(pz) && /↻ AI rewrite</.test(pz)],
  ["3 · Timeline: crew, day hours, start, the bar", /3 · Timeline \(auto from labor hours\)/.test(pz) && /id="pz-tl"/.test(pz) && /type="date"/.test(pz)],
  ["4 · Price & terms: money, set total, markup, payment, warranty, valid for", /4 · Price &amp; terms/.test(pz) && /pz-s4[\s\S]{0,400}Customer price/.test(pz) && /Set my own total/.test(pz) && /type="range"/.test(pz) && /Warranty/.test(pz) && /Valid for/.test(pz)],
  ["5 · What we need from the customer", /5 · What we need from the customer/.test(pz)],
  ["Ready to send, Money (you only), Quick actions with the design's five buttons", /Ready to send/.test(pz) && /Money \(you only\)/.test(pz) && ["Duplicate estimate", "Save as my template", "Scope only (no prices)", ">PDF<", "AI chat"].every((k) => pz.indexOf(k) !== -1)],
  ["the sticky bottom bar: Preview customer view, Send estimate (desktop) / 👁 Preview, ⋯, Send (phone)", /class="pz-foot"[\s\S]{0,200}Preview customer view[\s\S]{0,400}Send estimate/.test(pz) && /👁 Preview<\/span>/.test(pz) && /onclick="pzMenu\(true\)">⋯</.test(pz)],
  ["phone header: one slim bar (total, profit · % · days, ready chip, ▾) and a 5-part gold line; tap opens and closes it", /class="pz-mtop" id="pz-mtop" onclick="this\.classList\.toggle\(\\'x\\'\)"/.test(pz) && /\.pz-mtop\.x \.pz-mmore\{display:block\}/.test(pz) && /"profit " \+ pzF\(pro\)/.test(pz) && /id="pz-mprog"/.test(pz)],
  ["...open: customer and phone first, cost / labor / material, jump chips Customer, Request, Chat, Price, Timeline, Terms", /\["Customer", "pz-s0"\], \["Request", "pz-s1"\], \["Chat", "pz-chat"\], \["Price", "pz-s2"\], \["Timeline", "pz-s3"\], \["Terms", "pz-s4"\]/.test(pz) && /"Cost " \+ pzF\(t\.sub\) \+ " · Labor "/.test(pz)],
  ["on phone Preview and Send are only in the bottom bar; desktop keeps the big header", /\.pz-top\{display:none\}/.test(pz) && /@media\(max-width:640px\)\{\n \.pz-top\{display:none\}/.test(pz)],
  ["the ⋯ menu: Duplicate, Save template, Scope only, PDF, AI chat (and More tools, Close)", ["Duplicate estimate", "Save as my template", "Scope only (no prices)", '["PDF"', '["AI chat"', '["More tools"', '["Close this estimate"'].every((k) => pz.indexOf(k) !== -1)],
  ["the customer card is first, above Request", /var html = pzCustomerHtml\(r\) \+ '<div class="pz-c" id="pz-s1">/.test(pz)],
  ["phone: the line name on its own row, then tag / qty / unit / rate / total / ✕", /\.pz-sec \.pz-t tr\{display:grid;grid-template-columns:44px 64px 34px 78px 1fr 26px/.test(pz) && /\.pz-sec \.pz-t td:nth-child\(2\)\{grid-column:1\/-1;order:-1\}/.test(pz)],
  ["the old screen is the hidden More tools drawer (every tool still there)", /while \(card\.firstChild\) tools\.appendChild\(card\.firstChild\)/.test(pz) && /<b>More tools<\/b>/.test(pz)],
  ["the screen mounts after every other part of the page has drawn (last renderEdit wrapper)", D.lastIndexOf("try { pzMount(); }") > D.lastIndexOf("var _orig = renderEdit") && D.lastIndexOf("var _orig = renderEdit") > D.indexOf('<style id="pz-styles">')],
  ["no \"licensed\", no TV mounting, no gas work in the screen", !/licensed contractor|tv mount|gas (line|hook)up/i.test(pz)],
].forEach((x) => ok(x[0], x[1] === true));

console.log("\n2. The numbers\n");
const ctx = { console, isFinite, Number, Math, Date, String, Array, Object };
vm.createContext(ctx);
vm.runInContext([
  "var PZ_HOUR = /^(h|hr|hrs|hour|hours|man-?hours?)$/i;",
  lit("PZ_WAITS", "[", "]"), lit("PZ_PAY", "{", "}"), lit("PZ_PAY_LBL", "{", "}"),
].join("\n") + "\n" + ["pzScheduleOf", "pzFinish", "pzDay", "pzPayPlan", "pzF"].map((n) => fn(pz, n)).join("\n"), ctx);
const bath = { labor: [
  { section: "Bathroom", item: "Protect and demo", qty: 8, unit: "hrs", rate: 70 },
  { section: "Bathroom", item: "Waterproofing membrane", qty: 6, unit: "hrs", rate: 90 },
  { section: "Bathroom", item: "Install wall tile", qty: 60, unit: "sf", rate: 14 },
  { section: "Painting", item: "Patch and paint 2 coats", qty: 320, unit: "sf", rate: 1.6 }] };
const cases = [bath, Object.assign({}, bath, { scheduleEdit: { crew: 1 } }), Object.assign({}, bath, { scheduleEdit: { crew: 3, dailyHours: 9 } }), Object.assign({}, bath, { scheduleEdit: { workDays: 4, waitDays: 0 } }), { labor: [], scheduleEdit: { workDays: 2 } }, { labor: [{ item: "Small wall repair, skim coat", qty: 2.5, unit: "hrs", rate: 75 }] }, { labor: [{ item: "Remove and grout the shower", qty: 8, unit: "hrs", rate: 80 }] }, {}];
ok("the screen counts the timeline exactly as lib/schedule.js (crew and day hours too)", cases.every((e) => JSON.stringify(vm.runInContext("pzScheduleOf(" + JSON.stringify(e) + ")", ctx)) === JSON.stringify(scheduleOf(e))));
ok("start Thursday Oct 15, 4 days, Monday to Friday -> finish Oct 20", vm.runInContext('pzDay(pzFinish("2026-10-15", 4))', ctx) === "Oct 20");
const rows = (t, c) => vm.runInContext("pzPayPlan(" + t + "," + JSON.stringify(c) + ")", ctx);
ok("30 / 40 / 30 on $4,869: $1,461 / $1,948 / $1,461 (the design's numbers)", JSON.stringify(rows(4869, "30,40,30").map((p) => vm.runInContext("pzF(" + p.amount + ")", ctx))) === '["$1,461","$1,948","$1,461"]');
ok("...the rows always add up to the total to the cent", ["30,40,30", "50,50", "25,25,25,25", "100", "contract"].every((c) => Math.abs(rows(7777.77, c).reduce((t, p) => t + p.amount, 0) - 7777.77) < 0.001));
const qctx = { console, SOW: false }; vm.createContext(qctx);
vm.runInContext(Q.split("\n").find((l) => l.startsWith("const A=v=>Array.isArray")), qctx);
const ps = Q.indexOf("const PAY_SMALL=");
vm.runInContext(Q.slice(ps, Q.indexOf("\n", ps)) + "\n" + Q.slice(Q.indexOf("function payPlan("), Q.indexOf("\n", Q.indexOf("function payPlan("))), qctx);
ok("\"Your contract terms\" (the default) is what the customer page shows today", [400, 3000, 5000, 5900].every((t) => JSON.stringify(rows(t, "contract").map((p) => [p.amount, p.pct])) === JSON.stringify(vm.runInContext("payPlan({}," + t + ")", qctx).map((p) => [p.amount, p.pct]))));
ok("defaults: contract payment, 3-year warranty, 30 days (nothing changes until he picks)", /\(tm\.payment \|\| "contract"\) === v/.test(pz) && /\(tm\.warranty \|\| "3-year workmanship"\) === v/.test(pz) && /Number\(tm\.validDays \|\| 30\) === v/.test(pz));

console.log("\n3. Edits that move money, and saving\n");
{
  const c3 = { console, Object, Array, String, Number, isFinite, Math, JSON };
  vm.createContext(c3);
  vm.runInContext(["pzEst", "pzSvcs", "pzSupply", "pzUnsupply", "pzOwner", "pzLinesOf", "pzSum", "pzMk"].map((n) => fn(pz, n)).concat([fn(D, "scopeNorm"), fn(D, "scopeUnparkFor")]).join("\n") +
    "\nvar PZ={scopeTouched:false};var dirty=0;function pzDirty(){dirty++}function pzSyncOld(){}function pzRender(){}function toast(){}function fmt(n){return '$'+n}function scopeLineValue(l){return l.qty*l.rate}" +
    "\nfunction scopeSectionOf(l){return l.section}var SVC={name:'Bathroom',supplied:[]};function scopeDraft(){return {services:[SVC]}}" +
    "\nvar currentRecord={estimate:{markupPct:25,labor:[{item:'Install vanity',qty:4,rate:120,section:'Bathroom'}],materials:[{item:'Grout kit',qty:1,rate:85,section:'Bathroom'},{item:'Vanity with top, 30 in',qty:1,rate:489,section:'Bathroom'}]}};", c3);
  vm.runInContext("pzSupply(0,1,true)", c3);
  const e = vm.runInContext("currentRecord.estimate", c3);
  ok("TICK Customer supplies: the vanity's $489 leaves the price, its labor stays", e.materials.length === 1 && e.labor.length === 1 && vm.runInContext("pzSum('Bathroom')", c3) === 565 && e.parkedLines[0].custSupplied === true);
  ok("...it is listed as Customer supplies, and the change saves itself", JSON.stringify(vm.runInContext("SVC.supplied", c3)) === '["Vanity with top, 30 in"]' && vm.runInContext("dirty", c3) === 1 && vm.runInContext("PZ.scopeTouched", c3) === true);
  vm.runInContext("pzUnsupply(0,0)", c3);
  const e2 = vm.runInContext("currentRecord.estimate", c3);
  ok("UNTICK: the very same line comes back where it was", e2.materials.length === 2 && e2.materials[1].item === "Vanity with top, 30 in" && e2.materials[1].rate === 489 && e2.parkedLines.length === 0 && vm.runInContext("SVC.supplied.length", c3) === 0);
}
ok("every change saves itself, 1.2 s after the last one, to save-estimate", /PZ\.saveT = setTimeout\(pzSaveNow, 1200\)/.test(pz) && /sbcFetch\("\/\.netlify\/functions\/save-estimate"/.test(pz));
ok("the save stamps the service prices and publishes the wording when he changed it", /scopeStampBreakdown\(\)/.test(fn(pz, "pzPrepare")) && /PZ\.scopeTouched \|\| e\.customerScopePublished === true/.test(fn(pz, "pzPrepare")));
ok("one estimate object: in this screen the save reads it straight, never an old box", /gatherForm = function \(\) \{ return document\.getElementById\("pz-main"\) \? pzGather\(\) : _g\.apply\(this, arguments\); \}/.test(pz));
ok("the hidden tools are kept in step with every line edit (no old copy can write back)", /renderLines\("labor", e\.labor \|\| \[\]\); renderLines\("materials", e\.materials \|\| \[\]\)/.test(fn(pz, "pzSyncOld")));
ok("Send prepares the same estimate first, then the usual send (preview, contract, email)", /pzPrepare\(\); sendToCustomer\(\);/.test(fn(pz, "pzSend")));
ok("Preview shows the real customer page with the unsaved estimate (one renderer)", /quote\.html\?ref=' \+ encodeURIComponent\(currentRecord\.ref\) \+ '&preview=1/.test(fn(pz, "pzPreview")) && /sbc-preview-record/.test(fn(pz, "pzPreview")));

console.log("\n3b. The customer card\n");
{
  const cc = { console, Object, Array, String, Number, Date, encodeURIComponent, isFinite }; vm.createContext(cc);
  vm.runInContext("function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;')}\n" + lit("PZ_STATUS", "{", "}") + "\n" + ["pzDigits", "pzBuilding", "pzCustomerHtml"].map((n) => fn(pz, n)).join("\n"), cc);
  const card = vm.runInContext("pzCustomerHtml(" + JSON.stringify({ ref: "SBC-261006-4821", status: "new", submittedAt: "2026-10-06T15:00:00Z", customer: { name: "Maria Lopez", phone: "(917) 555-0142", email: "maria.l@email.com", address: "31-xx 30th Ave, Apt 3B, Astoria NY 11102" }, request: { propertyType: "Co-op", timeline: "Within 2 weeks", serviceAnswers: { fl: "3rd floor", el: "Elevator", wall: "Peeling" }, answerLabels: { fl: "What floor is it on?", el: "Elevator or walk-up?", wall: "Wall condition" } } }) + ")", cc);
  ok("name, status chip New · not sent", /pz-cname">Maria Lopez</.test(card) && /New · not sent/.test(card));
  ok("Call / Text / Email / Map: tel:, sms:, mailto:, Google Maps", /href="tel:\+19175550142"/.test(card) && /href="sms:\+19175550142"/.test(card) && /href="mailto:maria\.l@email\.com"/.test(card) && /href="https:\/\/maps\.google\.com\/\?q=31-xx%2030th%20Ave%2C%20Apt%203B%2C%20Astoria%20NY%2011102"/.test(card));
  ok("rows from the real record: phone, email, full address, building, request, wants start", /<span>Address<\/span><span>31-xx 30th Ave, Apt 3B, Astoria NY 11102<\/span>/.test(card) && /<span>Building<\/span><span>Co-op · 3rd floor · Elevator<\/span>/.test(card) && /<span>Request<\/span><span>Oct 6, 2026 · website form · SBC-261006-4821<\/span>/.test(card) && /<span>Wants start<\/span><span>Within 2 weeks<\/span>/.test(card));
  ok("no Prefers row when nothing was saved; the wall answer is not building info", !/Prefers/.test(card) && !/Peeling/.test(card));
  ok("Edit details opens the existing customer editor", /onclick="sbcEditCustomer\(\)">Edit details</.test(card));
  const bare = vm.runInContext("pzCustomerHtml({ref:'R',status:'sent',customer:{name:'X'},request:{}})", cc);
  ok("no phone or email: those buttons are greyed out, not broken links", /Sent/.test(bare) && /pointer-events:none">📞 Call/.test(bare) && !/href="tel:"/.test(bare));
}

console.log("\n3b2. Every priced line is on a card\n");
{
  const c4 = { console, Object, Array, String, Number }; vm.createContext(c4);
  vm.runInContext(["pzEst", "pzSvcs", "pzOwner", "pzLinesOf", "pzSum"].map((n) => fn(pz, n)).concat([fn(D, "scopeNorm")]).join("\n") +
    "\nvar SV=[{name:'General'}];function scopeDraft(){return {services:SV}}function scopeSectionOf(l){return l.section}" +
    "\nvar currentRecord={estimate:{labor:[{item:'Remove old toilet',qty:2,rate:90,section:'Toilet Replacement'}],materials:[{item:'White two-piece toilet',qty:1,rate:250,section:'Toilet Replacement'}]}};", c4);
  ok("\"finishes is empty but in preview shows toilet\": a line under a section with no card shows on the card", vm.runInContext("pzLinesOf('General').length", c4) === 2 && vm.runInContext("pzSum('General')", c4) === 430);
  vm.runInContext("SV=[{name:'Bathroom'},{name:'Painting'}];currentRecord.estimate.labor.push({item:'Paint',qty:1,rate:100,section:'painting'})", c4);
  ok("...a section matches its own card whatever the capitals; loose lines go on the first card; each line on one card only", vm.runInContext("pzLinesOf('Painting').length", c4) === 1 && vm.runInContext("pzLinesOf('Bathroom').length", c4) === 2);
}

console.log("\n3b3. The customer's photos and files are on the Request card\n");
{
  const c5 = { console, String }; vm.createContext(c5);
  vm.runInContext("function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;')}\n" + ["reqFileUrl", "reqIsDoc", "reqDocTile", "reqPhotosHtml"].map((n) => fn(D, n)).join("\n") + "\n" + fn(pz, "pzReqPhotos") +
    "\nvar currentRecord={request:{photos:[{data:'https://x/p1.jpg',slot:'wide'},{data:'https://x/plan.pdf',name:'Plan.pdf',kind:'file'}]}};", c5);
  const h = vm.runInContext("pzReqPhotos()", c5);
  ok("\"photos or files uploaded by customer doesn't show\": the photo shows and opens large, the PDF opens", /<img src="https:\/\/x\/p1\.jpg"[^>]*openLightbox/.test(h) && /openReqFile\(1\)[\s\S]*Plan\.pdf/.test(h));
  ok("its own id: never the \"Photos on the estimate\" card's (pz-photos), so neither redraws over the other", /id="pz-reqfiles"/.test(h) && (pz.match(/id="pz-photos"/g) || []).length === 1);
  ok("...on the Request card, above the AI read; nothing when there are none", /'<\/p>' \+ pzReqPhotos\(\) \+ aiRead/.test(fn(pz, "pzRender")) && vm.runInContext("currentRecord={request:{}};pzReqPhotos()", c5) === "");
}

console.log("\n3c. ✕ on every finish card\n");
{
  const fc = { console, JSON, String }; vm.createContext(fc);
  vm.runInContext("function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;')}\n" + fn(pz, "pzFDel"), fc);
  const x = vm.runInContext("pzFDel(\"pzDelLine('materials',3)\", \"Toilet\")", fc);
  ok("\"i added toilet but i can't delete\": ✕ asks, then removes the line", /class="pz-fdel"/.test(x) && /confirm\(&quot;Remove Toilet\?&quot;\)\)pzDelLine\('materials',3\)/.test(x));
  const fin = fn(pz, "pzFinishesHtml");
  ok("...on Sani-supplied, customer-supplied and AI-listed customer items alike", /pzFDel\("pzDelLine\('materials',"/.test(fin) && /pzFDel\("pzDelParked\("/.test(fin) && /pzFDel\("pzDropSupplied\("/.test(fin));
  ok("a name with a quote cannot break the button", /Remove Kid&#39;s sink/.test(vm.runInContext("pzFDel('x()', \"Kid's sink\")", fc)));
}

console.log("\n4. Price book (his own templates and products)\n");
const t = PB.cleanTemplate({ name: " Bathroom refresh ", lines: [{ kind: "labor", item: "Protect floors", qty: 3, unit: "h", rate: 70 }, { kind: "materials", item: "Toilet", qty: 1, unit: "ea", rate: 199 }, { item: "" }], included: ["a", ""], excluded: ["b"], steps: [{ title: "Protect", text: "x" }] });
ok("a template keeps his lines, wording and steps, nothing else", t.name === "Bathroom refresh" && t.lines.length === 2 && t.lines[1].kind === "materials" && t.included.length === 1 && t.steps.length === 1);
ok("no name, no template; negative or junk prices become 0", PB.cleanTemplate({ name: "" }) === null && PB.cleanTemplate({ name: "x", lines: [{ item: "a", qty: -1, rate: "abc" }] }).lines[0].rate === 0);
const pr = PB.cleanProduct({ name: "Toilet", spec: "Cadet 3", rate: 199, link: "javascript:alert(1)", photo: "http://x" });
ok("a product keeps name / spec / price; unsafe links and photos are dropped", pr.name === "Toilet" && pr.rate === 199 && pr.link === "" && pr.photo === "");
const pbSrc = fs.readFileSync(path.join(ROOT, "netlify", "functions", "price-book.js"), "utf8");
ok("contractor only: every method checks the dashboard key", /const denied = requireDashboardKey\(event, cors\(\)\);\s*if \(denied\) return denied;/.test(pbSrc));
(async () => {
  const call = (method, body, key) => PB.handler({ httpMethod: method, headers: key ? { "x-sbc-key": key } : {}, body: body ? JSON.stringify(body) : "" });
  const no = await call("GET", null, "");
  const saved = await call("POST", { template: { name: "Bathroom refresh", lines: [{ kind: "labor", item: "Protect", qty: 3, unit: "h", rate: 70 }] } }, "k");
  const again = await call("POST", { template: { name: "bathroom REFRESH", lines: [] } }, "k");
  const got = JSON.parse((await call("GET", null, "k")).body);
  ok("no key, no price book; with the key a template saves, the same name replaces it", no.statusCode === 401 && saved.statusCode === 200 && again.statusCode === 200 && got.templates.length === 1 && got.templates[0].name === "bathroom REFRESH");
  await call("POST", { remove: "template", name: "Bathroom Refresh" }, "k");
  ok("...and removes it", JSON.parse((await call("GET", null, "k")).body).templates.length === 0);
  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})();
ok("the package buttons come only from what he saved (none are invented)", /var book = \(PZ\.book && PZ\.book\.templates\) \|\| \[\];/.test(pz) && !/Bathroom refresh|Room painting|Shower tile|Floor tile/.test(pz));

