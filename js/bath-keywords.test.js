/* bath-keywords.test.js — run: node js/bath-keywords.test.js
 *
 *   Search Console (the dashboard's 🔎 Google tab), almost page 1:
 *   "bathroom remodeling brooklyn" 10.8, "bathroom remodeling nyc" 11.8,
 *   "bathroom renovation nyc" 15.8, "bathroom remodel manhattan" 16.4 (Google
 *   showed the main page, not the Manhattan one). -> "Yes" + "Use both if
 *   it's possible: renovation and remodeling too".
 */
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? "PASS  " : "FAIL  ") + n + (d ? "\n        " + d : "")); };
const B = read("bathroom-renovation-brooklyn.html"), M = read("bathroom-renovation-manhattan.html"), H = read("bathroom-renovation.html"), SM = read("sitemap.xml");
const both = (s) => /remodel/i.test(s) && /renovation/i.test(s);
const tag = (h, re) => (h.match(re) || [, ""])[1];

ok("Brooklyn: H1 says remodeling AND renovation", both(tag(B, /<h1>([\s\S]*?)<\/h1>/)));
ok("Brooklyn: a section on bathroom remodeling & renovation in Brooklyn homes", /<!-- BATH-DEPTH:START -->[\s\S]*Bathroom Remodeling &amp; Renovation<br> <em>in Brooklyn Homes<\/em>[\s\S]*<!-- BATH-DEPTH:END -->/.test(B));
ok("Manhattan: title, meta, H1 say remodel AND renovation (Google picked the main page for \"bathroom remodel manhattan\")", /^Bathroom Remodel &amp; Renovation Manhattan\b/.test(tag(M, /<title>([^<]*)<\/title>/)) && both(tag(M, /<meta name="description" content="([^"]*)"/)) && both(tag(M, /<h1>([\s\S]*?)<\/h1>/)));
ok("...meta description fits Google (≤160) and says fully insured", tag(M, /<meta name="description" content="([^"]*)"/).length <= 160 && /Fully insured/.test(tag(M, /<meta name="description" content="([^"]*)"/)));
ok("Manhattan: a co-op & condo section (alteration agreement, certificate of insurance)", /in Manhattan Co-ops and Condos[\s\S]*alteration agreement[\s\S]*certificate of insurance/.test(M));
ok("main page: each area link says \"Bathroom remodeling & renovation in ...\"", (H.match(/class="bc-more" href="\/[a-z-]+">Bathroom remodeling &amp; renovation (in|on) /g) || []).length === 6 && /<h2>Bathroom Remodeling &amp; Renovation Near You<\/h2>/.test(H));
ok("sitemap: the three pages are marked changed so Google reads them again", ["bathroom-renovation", "bathroom-renovation-brooklyn", "bathroom-renovation-manhattan"].every((u) => new RegExp("/" + u + "</loc>\\s*<lastmod>2026-10-04<").test(SM)));
ok("no prices, no \"licensed\", no TV mounting, no gas in the new text", [B, M].every((h) => { const t = (h.match(/<!-- BATH-DEPTH:START -->[\s\S]*?<!-- BATH-DEPTH:END -->/) || [""])[0].replace(/<style[\s\S]*?<\/style>/, ""); return t.length > 500 && !/\$\d|licens|tv mount|\bgas\b/i.test(t); }));

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
