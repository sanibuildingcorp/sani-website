/* generator-off.test.js — run: node js/generator-off.test.js
 *
 *   "Look what he did after i clicked regenerate from customer conversation!
 *    It's stupid! Remove whole generation"
 *
 * The AI estimate generator is switched off everywhere: the server refuses
 * and touches nothing, auto-draft does not start, the ChatGPT tools and the
 * assistant say so, and the estimate screen has no Generate or "Update
 * estimate from chat". The code stays; AI_GENERATOR=on (server) and
 * SBC_AI_GENERATOR = true (dashboard) bring it back.
 */
"use strict";
delete process.env.AI_GENERATOR;
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const D = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");
const Module = require("module");
const STORES = {};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === "@netlify/blobs") return request; return origResolve.call(this, request, ...rest); };
require.cache["@netlify/blobs"] = { id: "@netlify/blobs", filename: "@netlify/blobs", loaded: true, exports: { getStore: (o) => { const m = STORES[(o && o.name) || o] || (STORES[(o && o.name) || o] = new Map()); return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); } }; } } };
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? "PASS  " : "FAIL  ") + n + (d ? "\n        " + d : "")); };
const fn = (src, name) => {
  const s = src.indexOf("function " + name + "(");
  if (s < 0) throw new Error("missing " + name);
  let d = 0;
  for (let j = src.indexOf("{", s); j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}") { d--; if (!d) return src.slice(s, j + 1); } }
  throw new Error("unbalanced " + name);
};

const sw = require("../netlify/functions/lib/generator-switch");
ok("off unless AI_GENERATOR=on is set", sw.on() === false && (process.env.AI_GENERATOR = "On ", sw.on() === true) && (delete process.env.AI_GENERATOR, sw.on() === false));
ok("auto-draft does not start new drafts", require("../netlify/functions/lib/auto-draft").enabled() === false);
const mcp = fs.readFileSync(path.join(ROOT, "netlify", "functions", "chatgpt-mcp.js"), "utf8");
ok("the ChatGPT regenerate and add-service tools stop before the estimator", (mcp.match(/if \(!require\("\.\/lib\/generator-switch"\)\.on\(\)\) return require\("\.\/lib\/generator-switch"\)\.OFF_MESSAGE;\n      const code = await kickEstimator\(/g) || []).length === 2);
ok("the old sync generator refuses too", /if \(!require\("\.\/lib\/generator-switch"\)\.on\(\)\) return jsonResponse\(403/.test(fs.readFileSync(path.join(ROOT, "netlify", "functions", "generate-estimate.js"), "utf8")));

console.log("\nThe estimate screen\n");
ok("dashboard switch is off", /\nvar SBC_AI_GENERATOR = false;\n/.test(D));
const ctx = { console, toasts: [], SBC_AI_OFF: "off-msg", SBC_AI_GENERATOR: false, fetch: () => { throw new Error("fetched"); } };
ctx.toast = (m) => ctx.toasts.push(m);
vm.createContext(ctx);
vm.runInContext(["async " + fn(D, "generateAI"), "async " + fn(D, "addServiceAI")].join("\n"), ctx);
(async () => {
  await vm.runInContext("generateAI(true, false)", ctx);
  const added = await vm.runInContext("addServiceAI('paint', 'Painting', true)", ctx);
  ok("Generate / Re-price / Update from chat / Add a service: one message, nothing is sent", ctx.toasts.length === 2 && ctx.toasts[0] === "off-msg" && added === false);
  const exec = fn(D, "aiExec");
  ok("the assistant's regenerate and add-a-service say it is off", /if \(t === "regenerate"\) \{[\s\S]{0,400}if \(!SBC_AI_GENERATOR\) return SBC_AI_OFF;/.test(exec) && /if \(t === "addservice"\) \{\s*if \(!SBC_AI_GENERATOR\) return SBC_AI_OFF;/.test(exec));
  const pz = D.slice(D.indexOf('<style id="pz-styles">'));
  ok("no Generate estimate button on an empty estimate; it says to add lines or a price book package", /: SBC_AI_GENERATOR \? '<div class="pz-ai"><b>AI read:<\/b> no estimate yet\. <button/.test(pz) && /No prices yet\. Add a service and your lines below, or tap one of your price book packages\./.test(pz));
  ok("no \"AI learned\" box and no Update estimate from chat", /if \(!SBC_AI_GENERATOR \|\| !pzLastCust\(r\)\) return "";/.test(fn(pz, "pzLearnHtml")));

  console.log("\nThe server\n");
  process.env.ANTHROPIC_API_KEY = "sk";
  const est = require("@netlify/blobs").getStore({ name: "estimates" });
  const rec = { ref: "SBC-1", estimate: { labor: [{ item: "Remove and set toilet", qty: 3, rate: 90 }] }, status: "drafted" };
  await est.setJSON("SBC-1", rec);
  const G = require("../netlify/functions/generate-estimate-background");
  const r = await G.handler({ httpMethod: "POST", headers: {}, body: JSON.stringify({ ref: "SBC-1", jobId: "j" }) });
  ok("the generator refuses (403) and the estimate is untouched", r.statusCode === 403 && JSON.stringify(await est.get("SBC-1")) === JSON.stringify(rec));
  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL  crashed: " + e.message); process.exit(1); });
