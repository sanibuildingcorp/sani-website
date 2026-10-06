/* estimate-v4-cards.test.js — run: node js/estimate-v4-cards.test.js
 *
 * The rest of Perplexity's customer page, on the new estimate (docVersion 4):
 *   - "What will be installed": each finish as a product card - photo, the
 *     product, where it goes, who supplies it, Chosen / To choose by / On site
 *     by, and the product link. Set in the dashboard's Finishing Options.
 *   - Payment schedule: HIS terms, the same the contract generator uses.
 *     A contract he wrote for the job wins when it adds up to the total.
 *   - Talk to us: Call, Text, Email.
 * Old estimates (renderV7, renderLegacy) are unchanged.
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const Q = fs.readFileSync(path.join(ROOT, "quote.html"), "utf8");
const D = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");
const GC = fs.readFileSync(path.join(ROOT, "netlify", "functions", "generate-contract-background.js"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? "PASS  " : "FAIL  ") + n + (d ? "\n        " + d : "")); };
const fnSrc = (src, name) => { const i = src.indexOf("function " + name + "("); return src.slice(i, src.indexOf("\n", i)); };

const ctx = { console, SOW: false, ref: "SBC-261007-T1" }; vm.createContext(ctx);
vm.runInContext(Q.split("\n").find((l) => l.startsWith("const A=v=>Array.isArray")), ctx);
const payStart = Q.indexOf("const PAY_SMALL=");
vm.runInContext(fnSrc(Q, "productsCard") + "\n" + Q.slice(payStart, Q.indexOf("\n", payStart)) + "\n" + fnSrc(Q, "payPlan") + "\n" + fnSrc(Q, "payCard") + "\n" + fnSrc(Q, "talkCard"), ctx);
const plan = (total, r) => vm.runInContext("payPlan(" + JSON.stringify(r || {}) + "," + total + ")", ctx);
const sum = (p) => Math.round(p.reduce((t, x) => t + x.amount, 0) * 100) / 100;

console.log("\n1. Payment schedule: his terms\n");
ok("the contract generator says the same tiers (under $1,000 / $1,000-$5,000 50-50 / over $5,000 40-40-20)",
  /under \$1,000 → single payment on completion; \$1,000–\$5,000 → 50% deposit \/ 50% completion; over \$5,000 → 40% deposit \/ 40% mid-project milestone/.test(GC) && /\/ 20% completion/.test(GC));
const p900 = plan(900), p3000 = plan(3000), p5000 = plan(5000), p5900 = plan(5900), odd = plan(7777.77);
ok("under $1,000: paid in full on completion", p900.length === 1 && p900[0].amount === 900 && /completion/i.test(p900[0].label));
ok("$3,000: half when you sign, half on completion", p3000.length === 2 && p3000[0].amount === 1500 && p3000[1].amount === 1500);
ok("exactly $5,000 is still 50/50", p5000.length === 2 && p5000[0].amount === 2500);
ok("$5,900: 40% / 40% / 20% = $2,360 / $2,360 / $1,180", p5900.length === 3 && p5900[0].amount === 2360 && p5900[1].amount === 2360 && p5900[2].amount === 1180);
ok("an odd total still adds up to the cent", sum(odd) === 7777.77);
const contract = { contract: { sections: { paymentSchedule: [{ label: "Deposit on signing", amount: 1000 }, { label: "When tile is set", amount: 3000 }, { label: "Completion", amount: 1900 }] } } };
const pc = plan(5900, contract);
ok("a contract he wrote for this job wins when it adds up", pc.length === 3 && pc[1].label === "When tile is set" && pc[1].pct === 51);
ok("...and is ignored when it does not (the total changed after)", plan(6500, contract).length === 3 && plan(6500, contract)[1].label === "Midway, when the main work is done");
ok("no total, no payment card", plan(0).length === 0 && vm.runInContext("payCard({},0)", ctx) === "");
const pcard = vm.runInContext("payCard({},5900)", ctx);
ok("the card shows each payment, its share and the amount, and says nothing is paid today", /Payment schedule/.test(pcard) && /\$2,360\.00/.test(pcard) && /40%/.test(pcard) && /Nothing is paid today/.test(pcard));

console.log("\n2. What will be installed\n");
const est = { finishGroups: [
  { id: "a", name: "Toilet", where: "Bathroom, same place", supplier: "sani", status: "chosen", options: [{ name: "American Standard Cadet 3", spec: "elongated, soft-close seat", price: 320, isDefault: true, link: "https://www.homedepot.com/p/x", store: "Home Depot", photo: "https://example.com/t.jpg" }, { name: "Other toilet", price: 500 }] },
  { id: "b", name: "Shower grout", where: "Shower walls, about 60 sq ft", supplier: "sani", status: "choose", by: "Day 3", options: [{ name: "Mapei Ultracolor Plus FA", spec: "color to choose", price: 90 }] },
  { id: "c", name: "Vanity", supplier: "customer", status: "deliver", by: "Oct 14", options: [{ name: "Vanity", spec: "30 in white shaker" }] },
  { id: "d", name: "Empty", options: [] },
  { id: "e", name: "<b>x</b>", supplier: "evil", status: "nope", options: [{ name: "Paint", link: "javascript:alert(1)", photo: "http://insecure/x.jpg" }] }] };
const card = vm.runInContext("productsCard(" + JSON.stringify(est) + ")", ctx);
ok("a card per finish (the empty group is skipped)", (card.match(/class="prod"/g) || []).length === 4);
ok("the default option is the one shown", /American Standard Cadet 3/.test(card) && !/Other toilet/.test(card));
ok("where it goes and who supplies it", /<dt>Where<\/dt><dd>Bathroom, same place<\/dd>/.test(card) && /Sani supplies/.test(card) && /You supply/.test(card));
ok("status: Chosen, To choose by Day 3, On site by Oct 14", /badge ok">Chosen/.test(card) && /To choose by Day 3/.test(card) && /On site by Oct 14/.test(card));
ok("the product link opens the product page", /href="https:\/\/www\.homedepot\.com\/p\/x"/.test(card) && /View product at Home Depot/.test(card));
ok("no price on the cards", !/\$\d/.test(card) && !/320|500/.test(card));
ok("bad links, insecure photos, unknown supplier and status are dropped; names escaped", !/javascript:/.test(card) && !/http:\/\/insecure/.test(card) && !/evil|nope/.test(card) && /&lt;b&gt;x&lt;\/b&gt;/.test(card));
ok("no finishes, no card", vm.runInContext("productsCard({})", ctx) === "");

console.log("\n3. Where they sit\n");
const v8 = fnSrc(Q, "renderV8"), v7 = fnSrc(Q, "renderV7");
ok("new page: products after who supplies; payment and Talk to us after price basis, before the approve buttons",
  ["${whoCard(e,sv)}", "${productsCard(e)}", "${basisCard(e)}", "payCard(r,shown)", "talkCard()", "actionHtml("].reduce((p, k) => { const i = v8.indexOf(k); return p !== -1 && i > p ? i : -1; }, 0) > 0);
ok("no payment and no Talk card on the no-price page", /\$\{SOW\?'':\(hasPrice\?payCard\(r,shown\):''\)\+talkCard\(\)\}/.test(v8));
ok("old estimates keep their page: renderV7 still shows the old finishes card and no payment card", v7.indexOf("finishCard(e)") !== -1 && v7.indexOf("payCard(") === -1 && v7.indexOf("productsCard(") === -1);
const talk = vm.runInContext("talkCard()", ctx);
ok("Talk to us: call, text and email with the estimate number", /href="tel:\+13322770990"/.test(talk) && /href="sms:\+13322770990"/.test(talk) && /mailto:contact@sanibuildingcorp\.com\?subject=Estimate%20SBC-261007-T1/.test(talk));
ok("no \"licensed\", no TV mounting, no gas work in the new cards", !/licens|tv mount|gas (line|hook)/i.test(fnSrc(Q, "productsCard") + fnSrc(Q, "payCard") + fnSrc(Q, "talkCard")));

console.log("\n4. The dashboard sets them; the PDF lists them\n");
ok("each finish group has Where it goes, Supplied by, Status and a date", /placeholder="Where it goes/.test(D) && /\['sani','Sani supplies'\],\['customer','Customer supplies'\]/.test(D) && /\['chosen','Chosen'\],\['choose','To choose by'\],\['deliver','On site by'\]/.test(D) && /placeholder="Date \(e\.g\. Oct 14, Day 3\)"/.test(D));
const dctx = {}; vm.createContext(dctx);
const ef = D.slice(D.indexOf("  window.sbcfEditGroupField="), D.indexOf("\n", D.indexOf("  window.sbcfEditGroupField=")));
vm.runInContext("var window=this;var G={id:'g1'};function find(){return G}\n" + ef + "\nsbcfEditGroupField('g1','where',' Sink wall ');sbcfEditGroupField('g1','price','9999');", dctx);
ok("the edit keeps what he typed, and cannot touch a price", dctx.G.where === "Sink wall" && dctx.G.price === undefined);
const { buildScopePdf } = require("../netlify/functions/lib/scope-pdf");
const { scopeOnlyView, findMoney } = require("../netlify/functions/lib/scope-only");
const sow = scopeOnlyView({ estimate: Object.assign({ docVersion: 4, overview: "We will refresh your bathroom.", workSteps: [{ title: "A", text: "B." }], serviceBreakdown: [{ title: "Bathroom", included: ["x y z"] }] }, est) });
let pdf; try { pdf = buildScopePdf(sow, { now: "2026-10-07T12:00:00Z" }); } catch (err) { pdf = err; }
ok("the no-price view keeps the finish details and no money", findMoney(sow.estimate).length === 0 && sow.estimate.finishGroups[0].where === "Bathroom, same place");
ok("the scope PDF builds with What will be installed", pdf && !(pdf instanceof Error) && pdf.length > 1000, String(pdf && pdf.message || ""));

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
