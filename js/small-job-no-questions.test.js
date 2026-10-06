/* small-job-no-questions.test.js — run: node js/small-job-no-questions.test.js
 *
 *   "If it's identified photos then why still create questions list? ...
 *    Must say nothing to ask to customers!"  "light scrap, skim coat ...
 *    sand by hand ... and paint ... it is couple hours job"
 */
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const A = fs.readFileSync(path.join(ROOT, "netlify", "functions", "assistant.js"), "utf8");
const G = fs.readFileSync(path.join(ROOT, "netlify", "functions", "generate-estimate-background.js"), "utf8");
const J = require("../netlify/functions/lib/job-size");
let pass = 0, fail = 0;
const ok = (n, c) => { c === true ? pass++ : fail++; console.log((c === true ? "PASS  " : "FAIL  ") + n); };

ok("Ask AI sizes the job from the photos: small wall damage = scrape, skim, dry, sand, paint, one man, 2-3 hours", /SIZE THE JOB FROM THE PHOTOS[^"]*scrape, skim, dry, sand, paint: one man, 2-3 hours/.test(A));
ok("Ask AI: when the photos show the job, 'Nothing to ask ... Enough to price', no list, no draft", /'Nothing to ask - the photos show everything\. Enough to price\.'[^"]*no list, no draft/.test(A));
ok("...the old 'up to six questions' rule is gone", !/Never more than six/.test(A));
ok("the estimator's open questions are marked as often not needed", /open questions \(often none needed\)/.test(A));
ok("the estimate analysis asks NO questions when the job is visible", /12a\. NO QUESTIONS WHEN THE JOB IS VISIBLE[^\\]*clarification_questions is EMPTY and pricing_readiness is READY_TO_ESTIMATE/.test(G));
ok("both size rules describe a small wall repair as one handyman, 2 to 3 hours", [J.SIZE_RULE_ANALYSIS, J.SIZE_RULE_ESTIMATOR].every((r) => /SMALL WALL REPAIRS[\s\S]*light scrape[\s\S]*skim coat[\s\S]*hand sand[\s\S]*ONE handyman, about 2 to 3 hours/.test(r)));
ok("\"torn paint ... skim coat and paint\" reads as a repair", J.readsAsRepair("torn paint on the wall where tape was, need skim coat and paint") === true);
ok("...a renovation still does not", J.readsAsRepair("full bathroom renovation, patch the walls") === false);

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
