/* estimate-v4-cards.test.js — run: node js/estimate-v4-cards.test.js
 *
 *   "Merge it and go to customer page 1:1"
 *
 * The customer page for new estimates (docVersion 4) is Perplexity's
 * customer-page-layout, section for section (renderPZ in quote.html). These
 * tests render it in a sandbox from a real-shaped record and check what a
 * customer reads: the sections in the design's order, the numbers, the
 * product cards, the payment rows from his Terms, the promise from his
 * warranty, and the bar at the bottom (total, Change, Approve with name and
 * signature) that uses the page's own approve - nothing new is sent anywhere.
 * Older estimates keep their page.
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const Q = fs.readFileSync(path.join(ROOT, "quote.html"), "utf8");
const V = require("../netlify/functions/lib/estimate-validity");
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? "PASS  " : "FAIL  ") + n + (d ? "\n        " + d : "")); };
const fn = (name) => { const s = Q.search(new RegExp("function " + name + "\\s*\\(")); if (s < 0) throw new Error("missing " + name); let d = 0; for (let j = Q.indexOf("{", s); j < Q.length; j++) { if (Q[j] === "{") d++; else if (Q[j] === "}") { d--; if (!d) return Q.slice(s, j + 1); } } throw new Error("unbalanced " + name); };
const line = (start) => { const i = Q.indexOf(start); return Q.slice(i, Q.indexOf("\n", i)); };

const L = (sec, item, qty, unit, rate, x) => Object.assign({ section: sec, item, qty, unit, rate }, x || {});
const est = (over) => Object.assign({ projectTitle: "Bathroom Refresh & Painting", docVersion: 4, showSectionSubtotals: true,
  overview: "We will refresh your bathroom.", workSteps: [{ title: "Protect and prepare", text: "Floors covered." }, { title: "Shower grout", text: "Regrout." }],
  labor: [L("Bathroom", "Install toilet", 2, "h", 120), L("Bathroom", "Shower regrout & seal", 60, "sf", 14), L("Painting", "Paint walls 2 coats", 320, "sf", 1.6)],
  materials: [L("Bathroom", "Toilet, elongated 2-piece", 1, "ea", 199, { spec: "American Standard Cadet 3", finishStatus: "Chosen" }), L("Bathroom", "Grout, sealant & caulk kit", 1, "kit", 85), L("Painting", "Interior paint, gallon", 3, "gal", 58, { finishStatus: "To choose by date", link: "https://www.benjaminmoore.com/x" })],
  parkedLines: [{ kind: "materials", ownerText: "Vanity with top, 30 in", service: "Bathroom", idx: 0, custSupplied: true, line: L("Bathroom", "Vanity with top, 30 in", 1, "ea", 489, { spec: "Your purchase" }) }],
  serviceBreakdown: [{ title: "Bathroom", subtotal: 4000, included: ["Install the toilet"], customerSupplies: ["Vanity with top and faucet"], notIncluded: ["Re-tiling"] }, { title: "Painting", subtotal: 1900, included: ["Walls, 2 coats"], customerSupplies: [], notIncluded: ["Hallway ceiling"] }],
  saniSupplies: ["Toilet, elongated 2-piece"], customerNeeds: ["Have the vanity on site by Oct 14", "Reserve the elevator"], priceBasis: ["Bathroom about 5x8 ft"],
  scheduleEdit: { start: "2026-10-15" }, terms: { payment: "30,40,30", warranty: "1-year workmanship", validDays: 30 } }, over || {});

/* A sandbox page: the page's own helpers, a fake app element. */
function page(record, sow) {
  const ctx = { console, Math, Date, Number, String, Array, Object, JSON, isFinite, encodeURIComponent, setTimeout: () => {}, document: { body: { classList: { add() {} } }, getElementById: () => null }, window: {} };
  vm.createContext(ctx);
  vm.runInContext("var SOW=" + (sow ? "true" : "false") + ";var ref='SBC-261006-4821';var rec;var app={innerHTML:''};var chosen={};var VALID_DAYS=30;var WARRANTY_YEARS=3;" +
    "function track(){}function build(e){return (e.serviceBreakdown||[]).map(function(s){return {title:s.title,subtotal:s.subtotal||0,included:s.included||[],customerSupplies:s.customerSupplies||[],notIncluded:s.notIncluded||[]}})}" +
    "function calc(e){return {}}function shownTotal(){return 5900}function priced(){return !SOW}function isApproved(r){return !!r.acceptedAt}function contractRequired(r){return r.includeContractForCustomer===true}" +
    "function chosenFor(){return []}function withChosen(s){return s.included}function withoutChosen(s){return s.notIncluded}function addonHtml(){return ''}function contractHtml(){return ''}function sowFoot(){return '<SOWFOOT>'}function messageBox(){return '<MSGBOX>'}function threadHtml(){return '<THREAD>'}\n" +
    Q.split("\n").find((l) => l.startsWith("const A=v=>Array.isArray")).replace(/^const /, "var ") + "\n" +
    ["EB", "issuedAt", "validDays", "validUntil", "dayWord", "schEdit", "schWith", "scheduleOf", "schOf", "payPlan", "qzFinish", "qzIcon", "qzDays", "qzM", "qzShort", "qzFinishDay", "qzWarranty", "qzPay", "qzDue", "qzCards", "qzCardHtml", "renderPZ"].map(fn).join("\n") + "\n" +
    [line("const SCH_HOUR="), line("const SCH_WAITS="), line("const PAY_SMALL="), line("const QZ_FIN="), line("const QZ_ROUGH="), line("const QZ_BG=")].map((x) => x.replace(/^const /, "var ")).join("\n"), ctx);
  vm.runInContext("renderPZ(" + JSON.stringify(record) + ")", ctx);
  return vm.runInContext("app.innerHTML", ctx);
}
const rec = (over, e) => Object.assign({ ref: "SBC-261006-4821", status: "sent", sentAt: "2026-10-06T12:00:00Z", customer: { name: "Maria Lopez", address: "Astoria NY" }, request: { service: "Bathroom" }, estimate: est(e) }, over || {});
const html = page(rec());

console.log("\n1. The design, in order\n");
const order = ["SANI BUILDING CORP", "Your price", "What we will do", "How the work will go", "Timeline", "Who supplies what", "What will be installed", "What is included", "Not included", "What we need from you", "This price is based on", "Payment schedule", "Our promise", "Talk to us", 'class="qbar"'];
ok("every section, in the design's order, then the bar", order.reduce((p, k) => { const i = html.indexOf(k, p < 0 ? 0 : p); return p !== -1 && i > p ? i : -1; }, 0) > 0, order.filter((k) => html.indexOf(k) === -1).join(", "));
ok("hero: estimate number, issue date, valid until (30 days)", /Estimate SBC-261006-4821/.test(html) && /Oct 6, 2026/.test(html) && /Valid until Nov 5, 2026/.test(html));
ok("your price in whole dollars when there are no cents, and price by service", /<div class="qbig">\$5,900<\/div>/.test(html) && /<span>Bathroom<\/span><b>\$4,000<\/b>/.test(html) && /<span>Painting<\/span><b>\$1,900<\/b>/.test(html));
ok("...no price per service when he turned that off", !/<span>Bathroom<\/span><b>/.test(page(rec(null, { showSectionSubtotals: false }))));
ok("timeline: working days, earliest start, expected finish", /Earliest start<b>Oct 15<\/b>/.test(html) && /Expected finish<b>/.test(html) && /Working days<b>/.test(html));
ok("You supply with the ON SITE BY date taken from What we need", /Vanity with top and faucet <span class="qdue">ON SITE BY OCT 14<\/span>/.test(html));

console.log("\n2. What will be installed\n");
const cards = (html.match(/class="qpc"/g) || []).length;
ok("product cards: the customer's vanity first, then the toilet and the paint; kits are not cards", cards === 3 && html.indexOf("Vanity with top, 30 in") < html.indexOf("Toilet, elongated 2-piece</b>") && html.indexOf("Toilet, elongated 2-piece</b>") < html.indexOf("Interior paint, gallon") && !/Grout, sealant &amp; caulk kit<\/b>/.test(html));
ok("Supplied by: You supply for the vanity, Sani supplies for the toilet", /Vanity with top, 30 in<\/b>[\s\S]{0,400}<span>Supplied by<\/span><span>You supply<\/span>/.test(html) && /Toilet, elongated 2-piece<\/b>[\s\S]{0,400}<span>Supplied by<\/span><span>Sani Building Corp supplies<\/span>/.test(html));
ok("status tags: Chosen / To choose, and View product when there is a link", /qt-ok">Chosen/.test(html) && /qt-p">To choose/.test(html) && /href="https:\/\/www\.benjaminmoore\.com\/x"/.test(html) && /View product/.test(html));
ok("no price on a product card", !/qpc[\s\S]{0,600}\$\d/.test(html.slice(html.indexOf("What will be installed"), html.indexOf("What is included"))));

console.log("\n3. Payment, promise, approve\n");
ok("payment 30 / 40 / 30 on $5,900: $1,770 / $2,360 / $1,770 (the design's numbers)", /30%<\/span><\/td><td class="n">\$1,770<\/td>/.test(html) && /40%<\/span><\/td><td class="n">\$2,360<\/td>/.test(html));
const contractTerms = page(rec(null, { terms: {} }));
ok("no choice: his contract terms (40 / 40 / 20 over $5,000), as the page shows today", /40%<\/span><\/td><td class="n">\$2,360<\/td>/.test(contractTerms) && /20%<\/span><\/td><td class="n">\$1,180<\/td>/.test(contractTerms));
ok("our promise: the warranty he picked (1 year), fully insured, written price for any change", /<b>1 year<\/b>workmanship warranty/.test(html) && /for 1 year at no charge/.test(html) && /Fully<\/b>insured/.test(html));
ok("...3 years when he has not picked", /<b>3 years<\/b>workmanship warranty/.test(contractTerms));
ok("the bar: total, Change, Approve; the approve box asks for name, signature and the tick", /Total<b>\$5,900<\/b>/.test(html) && /onclick="qzChange\(\)">Change</.test(html) && /onclick="qzOpen\(\)">Approve</.test(html) && /id="sig"/.test(html) && /id="qz-sig"/.test(html) && /id="qz-agree"/.test(html));
const appr = Q.slice(Q.indexOf("window.qzApprove="), Q.indexOf("window.qzApprove=") + 900);
ok("Approve & sign uses the page's own approve (S('accept')), only after a name and the tick", /if\(!s\|\|!C\(s\.value\)\)/.test(appr) && /if\(!a\|\|!a\.checked\)/.test(appr) && /await S\('accept'\)/.test(appr) && appr.indexOf("a.checked") < appr.indexOf("S('accept')"));
ok("a contract job approves on the contract page", /href="\/contract\.html\?ref=SBC-261006-4821">Approve<\/a>/.test(page(rec({ includeContractForCustomer: true }))));
ok("approved: the bar says so, no buttons", /Approved ✓/.test(page(rec({ acceptedAt: "2026-10-07T00:00:00Z" }))) && !/qzOpen\(\)/.test(page(rec({ acceptedAt: "2026-10-07T00:00:00Z" }))));
ok("the messages and Change box are the page's own", /<MSGBOX><THREAD>/.test(html));

console.log("\n4. Valid for (his Terms)\n");
ok("14 / 30 / 60 days on the page", /Valid until Oct 20, 2026/.test(page(rec(null, { terms: { validDays: 14 } }))) && /Valid until Dec 5, 2026/.test(page(rec(null, { terms: { validDays: 60 } }))));
ok("...and the server enforces the same days from the version sent", V.validDays({ sentVersion: { at: "2026-10-06T12:00:00Z", estimate: { terms: { validDays: 14 } } }, estimate: { terms: { validDays: 60 } } }) === 14 && V.validDays({ estimate: {} }) === 30 && V.validDays({ estimate: { terms: { validDays: 99 } } }) === 30);

console.log("\n5. The scope link (no prices)\n");
const sow = page(rec(null, {}), true);
ok("no price, no payment, no bar, no approve; the scope footer instead", !/\$\d/.test(sow) && !/Payment schedule/.test(sow) && !/qbar/.test(sow) && /<SOWFOOT>/.test(sow) && /Scope of work SBC-261006-4821/.test(sow));
ok("no \"licensed\", no TV mounting, no gas work in the page code", !/licens|tv mount|gas (line|hook)/i.test(Q.slice(Q.indexOf("THE CUSTOMER PAGE — PERPLEXITY"), Q.indexOf("window.qzApprove="))));

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
