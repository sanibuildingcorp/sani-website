// netlify/functions/lib/generator-lab.js
//
// TEST MODE FOR THE GENERATOR.
//
//   "i wanna learn / teach them and make them better and better for future,
//    i wish them talk and think as human ... as a labor"
//   "new rules can we do as a test mode? If it's not going true then remove
//    and return to the same mode? I scare i don't want broke"
//
// One small settings blob ("generator-lab" in the estimates store):
//
//   { on: false, lessons: [{ id, text, on, at }], updatedAt }
//
// OFF (the default, and what a missing or unreadable blob means): labText()
// is the empty string, the generator's prompts are byte for byte what they
// were before this file existed, and nothing on the record changes.
//
// ON: every prompt the generator writes (the analyst, the estimator, the
// repair pass, the scope writer) carries one extra block - a foreman's way
// of thinking and talking, then his lessons that are switched on. The
// block says the rest of the instructions still win on conflict, so the
// guards (no "licensed", repair stays a repair, the voice rules, prices by
// line) all still hold, and the code checks after the AI run as before.
//
// Switching it off and pressing Regenerate returns any estimate to the
// old mode. Lessons stay saved either way.

"use strict";

const KEY = "generator-lab";
const MAX_LESSONS = 30;
const MAX_CHARS = 240;

function str(v) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim(); }

function clean(lab) {
  const l = lab && typeof lab === "object" ? lab : {};
  const lessons = (Array.isArray(l.lessons) ? l.lessons : [])
    .filter(function (x) { return x && str(x.text); })
    .slice(0, MAX_LESSONS)
    .map(function (x) { return { id: str(x.id) || newId(), text: str(x.text).slice(0, MAX_CHARS), on: x.on !== false, at: str(x.at) }; });
  return { on: l.on === true, lessons: lessons, updatedAt: str(l.updatedAt) };
}

function newId() { return "L" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

const FOREMAN = [
  "HOW TO THINK AND TALK (test rules, from Zura):",
  "You are a working foreman at Sani Building Corp who has done this kind of job a hundred times. Think the way a crew does it: walk in, look, do the real steps in order, clean up, leave. Size the job by what the customer actually asked for and what a crew actually spends on it - hours and days, not every possible risk. Leave out steps this job does not need. Write what the customer reads the way you would say it to them at the door: plain, short, friendly, sure of yourself.",
  "Everything else in these instructions still applies, and wins where it conflicts with this block.",
].join("\n");

/* The block the prompts carry, or "" when test mode is off. */
function labText(lab) {
  const l = clean(lab);
  if (!l.on) return "";
  const on = l.lessons.filter(function (x) { return x.on; });
  return "\n\n========================================\n" + FOREMAN +
    (on.length ? "\n\nLESSONS FROM ZURA'S OWN JOBS - follow them:\n" + on.map(function (x) { return "- " + x.text; }).join("\n") : "") +
    "\n========================================";
}

/* What goes on the estimate so the panel can say how it was made. */
function stamp(lab) {
  const l = clean(lab);
  if (!l.on) return null;
  return { testRules: true, lessons: l.lessons.filter(function (x) { return x.on; }).length, at: new Date().toISOString() };
}

async function load(store) {
  try { return clean(await store.get(KEY, { type: "json" })); } catch (e) { return clean(null); }
}

async function save(store, lab) {
  const l = clean(lab);
  l.updatedAt = new Date().toISOString();
  await store.setJSON(KEY, l);
  return l;
}

/* The changes the dashboard and Ask AI can make. Returns the new lab. */
function change(lab, body) {
  const l = clean(lab);
  const b = body && typeof body === "object" ? body : {};
  const a = str(b.action);
  if (a === "mode") { l.on = b.on === true; return l; }
  if (a === "add") {
    const t = str(b.text).slice(0, MAX_CHARS);
    if (!t) throw new Error("Write the lesson first");
    if (l.lessons.some(function (x) { return x.text.toLowerCase() === t.toLowerCase(); })) return l;
    if (l.lessons.length >= MAX_LESSONS) throw new Error("There are already " + MAX_LESSONS + " lessons. Delete one first.");
    l.lessons.push({ id: newId(), text: t, on: true, at: new Date().toISOString() });
    return l;
  }
  const i = l.lessons.findIndex(function (x) { return x.id === str(b.id); });
  if (i < 0) throw new Error("That lesson is not there any more");
  if (a === "toggle") { l.lessons[i].on = b.on === true; return l; }
  if (a === "edit") { const t = str(b.text).slice(0, MAX_CHARS); if (!t) throw new Error("A lesson cannot be empty"); l.lessons[i].text = t; return l; }
  if (a === "delete") { l.lessons.splice(i, 1); return l; }
  throw new Error("Unknown action");
}

module.exports = { KEY, MAX_LESSONS, MAX_CHARS, FOREMAN, clean, labText, stamp, load, save, change };
