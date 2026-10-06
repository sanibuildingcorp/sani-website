/* multi-answer.test.js — run: node js/multi-answer.test.js
 *
 *   "In there need to add both, bench and grab bar but i can't mark both in
 *    from website filing form"
 */
"use strict";
const fs = require("fs"), path = require("path");
const { normalizeQuestions } = require("../netlify/functions/lib/intake-questions");
const E = fs.readFileSync(path.join(__dirname, "..", "estimate.html"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? "PASS  " : "FAIL  ") + n + (d ? "\n        " + d : "")); };
const IN = { serviceCount: 1, serviceLabel: "Bathroom" };
const one = (q) => normalizeQuestions({ questions: [Object.assign({ questionId: "x", topic: "bathroom", type: "options-stack" }, q)] }, IN)[0];

const acc = one({ label: "Does it need grab bars, bench, or a zero-threshold entry?", options: ["Grab bars", "Built-in bench", "Zero-threshold entry", "All of these"] });
ok("THE SCREENSHOT: \"All of these\" makes it a pick-several question, and that choice goes", acc.multi === true && acc.options.indexOf("All of these") === -1 && acc.options.indexOf("Built-in bench") !== -1);
ok("...the model can say so itself (multi: true)", one({ label: "What is damaged?", options: ["Floor", "Walls", "Ceiling"], multi: true }).multi === true);
ok("a size question stays pick-one", one({ label: "How big is the bathroom?", options: ["Small", "Medium", "Large"] }).multi === false);
ok("\"Both\" works the same way; a text question is never multi", one({ label: "Tub or shower work?", options: ["Tub", "Shower", "Both"] }).multi === true && one({ label: "How many sq ft?", type: "text", options: [], multi: true }).multi === false);
ok("the prompt tells the model about multi", /"multi": true when several choices can be true at the same time/.test(fs.readFileSync(path.join(__dirname, "..", "netlify", "functions", "lib", "intake-questions.js"), "utf8")));

ok("the form says \"You can select more than one\" on those questions", /const multiHint=q\.multi\?'<div class="multi-hint">You can select more than one<\/div>':'';/.test(E));
ok("...a tap toggles, the answer is every ticked choice joined", /if\(currentAIQuestion&&currentAIQuestion\.multi\)\{[\s\S]{0,400}el\.classList\.toggle\('selected'\);\s*aiMultiAnswer\(\);/.test(E) && /formData\.serviceAnswers\[currentAIQuestion\.questionId\]=vals\.join\(', '\)/.test(E));
ok("...\"I'm not sure\" stands alone", /if\(aiIsUnsure\(el\.dataset\.value\)\)\{all\.forEach\(function\(b\)\{if\(b!==el\)b\.classList\.remove\('selected'\);\}\)/.test(E));

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
