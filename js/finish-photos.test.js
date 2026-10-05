/* finish-photos.test.js — run: node js/finish-photos.test.js
 *
 *   "In the finishing materials can we show real photos with links for let's
 *    customers click knows exactly finishing we have to use?"
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const Q = fs.readFileSync(path.join(ROOT, "quote.html"), "utf8"), D = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? "PASS  " : "FAIL  ") + n + (d ? "\n        " + d : "")); };

const ctx = { console }; vm.createContext(ctx);
vm.runInContext(Q.split("\n").find((l) => l.startsWith("const A=v=>Array.isArray")), ctx);
const line = Q.split("\n").find((l) => l.startsWith("function finishCard(e){"));
vm.runInContext(line, ctx);
const run = (e) => vm.runInContext("finishCard(" + JSON.stringify(e) + ")", ctx);
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
const h = run({ finishGroups: [
  { name: "Vanity", options: [{ name: "Gray 30 in.", price: 330 }, { name: "Oak 24 in. floating", spec: "Fluted", store: "Home Depot", link: "https://www.homedepot.com/p/x", photo: PNG, price: 220, isDefault: true }] },
  { name: "Tile", options: [{ name: "Marble-look <b>porcelain</b>", link: "javascript:alert(1)", photo: "http://insecure.example/x.jpg", isDefault: true }] },
  { name: "Empty", options: [] },
] });
ok("the customer page shows \"Your finishes\" with the INCLUDED (Default) option of each group", /Your finishes/.test(h) && /Oak 24 in\. floating/.test(h) && !/Gray 30 in\./.test(h));
ok("...its photo, spec and a link to the product page that opens in a new tab", h.indexOf('src="' + PNG + '"') !== -1 && /Fluted/.test(h) && /<a href="https:\/\/www\.homedepot\.com\/p\/x" target="_blank" rel="noopener nofollow"/.test(h) && /View product at Home Depot/.test(h));
ok("only http(s) links and safe images: a javascript: link and an http photo are dropped", !/javascript:/.test(h) && !/insecure\.example/.test(h));
ok("names are escaped, a group with no options is skipped", /Marble-look &lt;b&gt;porcelain&lt;\/b&gt;/.test(h) && !/Empty/.test(h));
ok("no prices on it - it says WHAT goes in", !/\$|220|330/.test(h.replace(PNG, "")));
ok("nothing when there are no finishes", run({}) === "" && run({ finishGroups: [] }) === "");
ok("it sits on the page right after \"Included for the whole project\"", /\$\{projectCard\(e\)\}\$\{finishCard\(e\)\}/.test(Q));
ok("the dashboard has a Product link box on each option", /placeholder="Product link \(Home Depot, Wayfair…\) — optional" oninput="sbcfEditOpt\(/.test(D) && /\\'link\\',this\.value\.trim\(\)/.test(D));

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
