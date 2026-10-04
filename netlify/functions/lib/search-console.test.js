// netlify/functions/lib/search-console.test.js — run: node netlify/functions/lib/search-console.test.js
//
//   "How to connect you directly google search console?" -> "Go start number 2"
//
// lib/search-console.js against a fake Google: the JWT is really signed and
// verified, the scope is read-only, the windows are right, the site falls
// back from the URL property to the domain property, and the report picks
// out the searches on page 2 with their page.
"use strict";
const crypto = require("crypto");
const fs = require("fs"), path = require("path");
const gsc = require("./search-console");
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? "PASS  " : "FAIL  ") + n + (d ? "\n        " + d : "")); };

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const FILE = { type: "service_account", project_id: "sani-search", client_email: "search-reader@sani-search.iam.gserviceaccount.com", private_key: PEM.replace(/\n/g, "\\n") };

(async () => {
  console.log("\n1. The key file\n");
  const k = gsc.parseKey(FILE);
  ok("a service account file is accepted, its escaped key turned back into lines", !!k && k.client_email === FILE.client_email && /\n/.test(k.private_key));
  ok("...as text, and as base64 text (how Netlify variables often hold it)", !!gsc.parseKey(JSON.stringify(FILE)) && !!gsc.parseKey(Buffer.from(JSON.stringify(FILE)).toString("base64")));
  ok("anything else is refused", gsc.parseKey({ client_email: "me@gmail.com", private_key: PEM }) === null && gsc.parseKey("hello") === null && gsc.parseKey(null) === null);

  console.log("\n2. Signing in to Google\n");
  const jwt = gsc.signJwt(k, Date.parse("2026-10-04T12:00:00Z"));
  const [h, b, sig] = jwt.split(".");
  const claims = JSON.parse(Buffer.from(b, "base64").toString());
  ok("the JWT is signed with the key (RS256) and verifies", crypto.createVerify("RSA-SHA256").update(h + "." + b).verify(publicKey, Buffer.from(sig.replace(/-/g, "+").replace(/_/g, "/"), "base64")));
  ok("...asks ONLY for read-only Search Console access", claims.scope === "https://www.googleapis.com/auth/webmasters.readonly" && claims.iss === FILE.client_email && claims.exp - claims.iat === 3600);

  console.log("\n3. The report\n");
  const calls = [];
  const fakeGoogle = (opts) => async (url, init) => {
    calls.push({ url, body: init.body });
    const res = (code, j) => ({ ok: code < 300, status: code, json: async () => j });
    if (/oauth2/.test(url)) return /assertion=/.test(init.body) ? res(200, { access_token: "tok" }) : res(400, { error: "invalid_grant" });
    if (init.headers.Authorization !== "Bearer tok") return res(401, {});
    const site = decodeURIComponent(url.split("/sites/")[1].split("/")[0]);
    if (opts.only && site !== opts.only) return res(403, { error: { message: "User does not have sufficient permission for site" } });
    const q = JSON.parse(init.body);
    if (!q.dimensions) return res(200, { rows: [q.startDate < "2026-09-01" ? { clicks: 30, impressions: 6000, ctr: 0.005, position: 21.4 } : { clicks: 36, impressions: 6501, ctr: 0.0056, position: 20.2 }] });
    if (q.dimensions.join() === "query") return res(200, { rows: [
      { keys: ["bathroom renovation brooklyn"], clicks: 3, impressions: 900, ctr: 0.0033, position: 12.4 },
      { keys: ["sani building corp"], clicks: 20, impressions: 60, ctr: 0.33, position: 1.1 },
      { keys: ["walk in shower nyc"], clicks: 0, impressions: 400, ctr: 0, position: 18.9 },
      { keys: ["bathroom remodel"], clicks: 0, impressions: 2000, ctr: 0, position: 45 },
    ] });
    if (q.dimensions.join() === "query,page") return res(200, { rows: [
      { keys: ["bathroom renovation brooklyn", "https://www.sanibuildingcorp.com/bathroom-renovation-brooklyn"], clicks: 3, impressions: 800, ctr: 0, position: 12 },
      { keys: ["bathroom renovation brooklyn", "https://www.sanibuildingcorp.com/"], clicks: 0, impressions: 100, ctr: 0, position: 30 },
    ] });
    if (q.dimensions.join() === "page") return res(200, { rows: [{ keys: ["https://www.sanibuildingcorp.com/"], clicks: 25, impressions: 3000, ctr: 0.008, position: 15 }] });
    return res(400, {});
  };
  const now = Date.parse("2026-10-04T12:00:00Z");
  const r = await gsc.report(fakeGoogle({ only: "sc-domain:sanibuildingcorp.com" }), k, { now });
  ok("a domain property is found when the URL property is not shared with the account", r.site === "sc-domain:sanibuildingcorp.com");
  ok("28 days ending 3 days ago, against the 28 before", r.range.now.endDate === "2026-10-01" && r.range.now.startDate === "2026-09-04" && r.range.before.endDate === "2026-09-03");
  ok("totals now and before", r.now.clicks === 36 && r.now.impressions === 6501 && r.now.ctr === 0.6 && r.now.position === 20.2 && r.before.clicks === 30);
  ok("ALMOST PAGE 1: only positions 8-20, most seen first", r.almostPage1.map((x) => x.query).join("|") === "bathroom renovation brooklyn|walk in shower nyc");
  ok("...each with the page Google shows most for it", r.almostPage1[0].page === "https://www.sanibuildingcorp.com/bathroom-renovation-brooklyn");
  ok("top searches by clicks; top pages", r.topQueries[0].query === "sani building corp" && r.topPages[0].page === "https://www.sanibuildingcorp.com/");
  ok("every call is a read (searchAnalytics/query or the token)", calls.every((c) => /oauth2\.googleapis\.com\/token$|\/searchAnalytics\/query$/.test(c.url)));

  let err = null;
  try { await gsc.report(fakeGoogle({ only: "https://nobody.example/" }), k, { now }); } catch (e) { err = e; }
  ok("not shared yet -> says exactly which email to add in Search Console", !!err && err.code === "no-access" && err.message.indexOf(FILE.client_email) !== -1);

  console.log("\n4. The endpoint and the dashboard\n");
  const FN = fs.readFileSync(path.join(__dirname, "..", "search-console.js"), "utf8");
  const D = fs.readFileSync(path.join(__dirname, "..", "..", "..", "dashboard.html"), "utf8");
  ok("contractor only, and the key file is never sent back", /requireDashboardKey\(event, cors\(\)\)/.test(FN) && /return json\(200, \{ saved: true, account: k\.client_email \}\)/.test(FN) && !/private_key: k\.private_key[^\n]*json\(200/.test(FN));
  ok("the dashboard has a 🔎 Google tab that walks through the setup and shows the report", /\{ id: "google", label: "🔎 Google" \}/.test(D) && /function renderGoogleTab\(force\)/.test(D) && /Almost page 1 \(position 8–20\)/.test(D) && /action:'save-key'/.test(D));
  ok("no key or account value is written in any repo file", !/BEGIN PRIVATE KEY/.test(FN + D) && !/iam\.gserviceaccount\.com/.test(D.replace(/\\\.iam\\\.gserviceaccount\\\.com/g, "")));

  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
