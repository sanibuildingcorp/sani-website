/* water-damage-scope.test.js — run: node js/water-damage-scope.test.js
 *
 *   An insurer refused umbrella cover after reading the water damage page.
 *   "I do water damage for water damaged walls, ceiling, floors ... Not
 *    structural water damage which is mold ... Add big texts ... what's our
 *    water damage service means" - and keep "water damage" for search.
 */
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? "PASS  " : "FAIL  ") + n + (d ? "\n        " + d : "")); };
const W = read("water-damage.html");
const text = (h) => h.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const means = (W.match(/<!-- WATER-DAMAGE-MEANS:START -->([\s\S]*?)<!-- WATER-DAMAGE-MEANS:END -->/) || ["", ""])[1];
/* everything on the page except the "what we do not do" box and the FAQ answers that say no */
const rest = text(W.replace(/<div class="wd-col wd-no">[\s\S]*?<\/ul>/, "").replace(/<p class="wd-note">[\s\S]*?<\/p>/, "").replace(/<div class="faq-grid">[\s\S]*?<\/section>/, "").replace(/<p class="wd-lead">[\s\S]*?<\/p>/, ""));

ok("the page still ranks for \"water damage\": title and H1 say Water Damage Repair", /<title>Water Damage Repair NYC/.test(W) && /<h1>Water Damage Repair<br>/.test(W));
ok("A BIG \"what our water damage service means\" section right under the top", !!means && W.indexOf("WATER-DAMAGE-MEANS:START") < W.indexOf("Our Services") && /finish repair/.test(means));
ok("...what we do: walls, ceilings, floors, trim, paint", ["drywall on walls and ceilings", "skim coat", "hardwood", "baseboards"].every((w) => means.indexOf(w) !== -1));
ok("...what we do NOT do: extraction, drying, mold, structural", ["water removal or extraction", "Drying, dehumidifiers", "mold remediation", "Structural repairs"].every((w) => means.indexOf(w) !== -1));
ok("nowhere else does the page offer mold, structural, emergency, sewage, flood or drying work", !/mold|structural|emergency|sewage|flood|dry-out|dehumidif|rotted|joist|exterior wood|siding/i.test(rest), (rest.match(/.{40}(mold|structural|emergency|sewage|flood|dry-out|dehumidif|rotted|joist|siding).{40}/i) || [""])[0]);
ok("the six reviews that were not real customers are gone", !/Paul Stefanidis|Anna Kowalczyk|Hassan Abdulrahman|Diane Marchetti|Kevin Osei|Frank Esposito/.test(W) && !/<section class="reviews-section">/.test(W));
const ld = JSON.parse((W.match(/<script type="application\/ld\+json">(\{"@context": "https:\/\/schema\.org", "@type": "FAQPage"[\s\S]*?)<\/script>/) || [, "{}"])[1]);
ok("Google's FAQ data matches the page and says no to mold and structural work", Array.isArray(ld.mainEntity) && ld.mainEntity.length === 10 && ld.mainEntity.some((q) => /mold remediation/i.test(q.name) && /^No\./.test(q.acceptedAnswer.text)) && ld.mainEntity.every((q) => W.indexOf(">" + q.name + "<") !== -1));
const others = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html") && !/^(dashboard|estimate|quote|contract|water-damage)\.html$/.test(f));
const bad = others.filter((f) => /(?<!No )mold remediation|water damage restoration|Emergency same-day response/i.test(read(f)));
ok("no other page sells water damage restoration or mold remediation", bad.length === 0, bad.join(", "));
ok("menu and llms.txt say Water Damage Repair, finish repairs only", /Water Damage Repair/.test(read("partials/menu.html")) && !/Water Damage Restoration/.test(read("partials/menu.html")) && /no mold remediation, water extraction, drying or structural work/.test(read("llms.txt")));
ok("no \"licensed\" anywhere in the new text", !/licens/i.test(means + W));

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
