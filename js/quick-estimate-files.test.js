/* quick-estimate-files.test.js — run: node js/quick-estimate-files.test.js
 *
 *   "In this request forms add upload photos and files and in below contact
 *    buttons in get free estimate in about 30 seconds replace with real time
 *    or something other"
 */
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const P = fs.readFileSync(path.join(ROOT, "partials", "quick-estimate.html"), "utf8");
const H = fs.readFileSync(path.join(ROOT, "bathroom-renovation.html"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c) => { c === true ? pass++ : fail++; console.log((c === true ? "PASS  " : "FAIL  ") + n); };

ok("the quick form has a photos/files picker (images, PDFs, iPhone HEIC)", /<input type="file" id="qeFiles" accept="image\/\*,application\/pdf,\.pdf,\.heic,\.heif" multiple hidden>/.test(P));
ok("...the links go in the contact form's own fields: photos, photo_count, photo_slots", /name="photos" id="qePhotos"/.test(P) && /name="photo_count" id="qePhotoCount"/.test(P) && /name="photo_slots" id="qePhotoSlots"/.test(P));
ok("...uploaded the way the contact page uploads (upload-photo, big files straight to storage)", /\/\.netlify\/functions\/upload-photo/.test(P) && /sbcBigUpload\(x\.data,ref,x\.name\)/.test(P) && /<script src="\/js\/big-upload\.js"><\/script>/.test(P));
ok("...the photos reach the confirmation email and the dashboard", /photos:urls,photoSlots:/.test(P) && /photoCount:urls\.length/.test(P));
ok("...a failed file never silently loses the lead: it asks first", /We could not send '\+up\.failed\.join/.test(P));
ok("...the FormData is rebuilt after the upload so Netlify gets the links", /d=new FormData\(f\); btn\.textContent='Sending…';/.test(P));
ok("the bathroom page carries the same quick form", H.indexOf(P.trim().slice(0, 400)) !== -1 && /id="qeFiles"/.test(H));

const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
const old = pages.filter((f) => /About 30 seconds/.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
ok('no page says "About 30 seconds" any more', old.length === 0);
ok('the bottom bar says "Reply within 24 hours" under Free Estimate', pages.filter((f) => /<span class="mb-tx"><b>Free Estimate<\/b><span>Reply within 24 hours<\/span>/.test(fs.readFileSync(path.join(ROOT, f), "utf8"))).length >= 40);

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
