/* img-alt.test.js — run: node js/img-alt.test.js
 *
 *   "Check website pages photos alt texts and make sure all photos have a
 *    alt texts and they are seo friendly! Always check keywords too!"
 *
 * Every photo on a public page has a real alt text. The only exceptions are
 * the hidden second copies in the gallery's moving strip (aria-hidden, there
 * only so the loop is seamless) and images whose src is filled in by script
 * (lightboxes, customer uploads).
 */
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const PRIVATE = new Set(["dashboard.html", "estimate.html", "contact.html", "quote.html", "contract.html", "handyman-estimate.html"]);
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? "PASS  " : "FAIL  ") + n + (d ? "\n        " + d : "")); };

const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html") && !PRIVATE.has(f));
const missing = [], generic = [];
pages.forEach((f) => {
  const s = fs.readFileSync(path.join(ROOT, f), "utf8");
  const re = /<img\b[^>]*>/gi;
  let m;
  while ((m = re.exec(s))) {
    const tag = m[0];
    const src = (tag.match(/\bsrc="([^"]*)"/) || [])[1];
    if (!src || !/^\/?images\//.test(src)) continue; /* filled in by script */
    const before = s.slice(Math.max(0, m.index - 300), m.index);
    if (/aria-hidden="true"[^<]*>\s*$/.test(before)) continue; /* hidden loop copy */
    const alt = (tag.match(/\balt="([^"]*)"/) || [])[1];
    if (!alt || alt.trim().length < 8) missing.push(f + ": " + src);
    else if (/^(photo|image|picture|img|project photo)\s*\d*$/i.test(alt.trim()) || /project \d+$/i.test(alt.trim())) generic.push(f + ": " + alt);
  }
});
ok("every photo on a public page has an alt text", missing.length === 0, missing.slice(0, 10).join("\n        "));
ok("no alt text is just \"photo\" or \"project 3\"", generic.length === 0, generic.slice(0, 10).join("\n        "));

const G = fs.readFileSync(path.join(ROOT, "gallery.html"), "utf8");
ok("gallery: the moving strip's visible photos are described", !/class="lw-pic" data-for="[^"]*" aria-label="[^"]*"><img [^>]*alt=""/.test(G));
const B = fs.readFileSync(path.join(ROOT, "bathroom-renovation.html"), "utf8");
ok("bathroom renovation photos say what they show and where (keyword + NYC)", (B.match(/alt="[^"]*(bathroom (renovation|remodel)|Bathroom remodel)[^"]*NYC[^"]*"/gi) || []).length >= 6);

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
