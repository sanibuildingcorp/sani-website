// node netlify/functions/lib/intake-questions.test.js
//
// The rules the intake questions must obey, executed. The prompt asks the model
// for all of these; this file proves the CODE holds them when the model does not.

const assert = require("assert");
const {
  normalizeQuestions,
  isBannedQuestion,
  maxQuestions,
  planPrompt,
  topicsIn,
  hasUnsureOption,
  NOT_SURE,
} = require("./intake-questions");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
}

const IN1 = { serviceCount: 1, serviceLabel: "Bathroom" };
const IN2 = { serviceCount: 2, serviceLabel: "Flooring, Painting" };

function q(over) {
  return Object.assign({
    questionId: "howBig",
    label: "How big is the bathroom, roughly?",
    why: "Area drives every tile and labor line",
    topic: "bathroom",
    type: "options-stack",
    options: ["Under 40 sq ft", "40-70 sq ft", "Bigger than 70"],
  }, over || {});
}

console.log("\nintake-questions\n");

/* ── the cap ───────────────────────────────────────────────────────────── */
t("one service allows 3 questions", () => assert.strictEqual(maxQuestions(1), 3));
t("two services allow 4", () => assert.strictEqual(maxQuestions(2), 4));
t("five services still allow only 4", () => assert.strictEqual(maxQuestions(5), 4));
t("garbage service count is treated as one", () => assert.strictEqual(maxQuestions("x"), 3));

t("the cap is enforced in code, not just asked for", () => {
  const many = [];
  for (let i = 0; i < 10; i++) many.push(q({ questionId: "q" + i, label: "Question number " + i, topic: "" }));
  const out = normalizeQuestions({ questions: many }, IN1);
  assert.strictEqual(out.length, 3, "returned " + out.length);
});

/* ── the bans ──────────────────────────────────────────────────────────── */
const BANNED = [
  ["who supplies", q({ label: "Who is supplying the tile?" })],
  ["are you providing", q({ label: "Are you providing the vanity?" })],
  ["quality tier", q({ label: "What level of finish?", options: ["Budget", "Mid-range", "High-end"] })],
  ["grade", q({ label: "Which grade of flooring?" })],
  ["brand", q({ label: "Any brand preference?" })],
  ["colour", q({ label: "What color are you thinking?" })],
  ["sheen", q({ label: "Which finish?", options: ["Matte", "Eggshell", "Satin"] })],
  ["installation labor", q({ label: "Do you need installation labor?" })],
  ["needs installing", q({ label: "Does the vanity need installing?" })],
  ["budget", q({ label: "What is your budget for this?" })],
  ["spend", q({ label: "How much do you want to spend?" })],
  ["price range", q({ label: "What price range works?" })],
  ["banned only in the reason", q({ label: "Pick one", why: "Sets the quality tier we price" })],
  ["banned only in an option", q({ label: "Pick one", options: ["Standard", "Premium package"] })],
];
BANNED.forEach(([name, bad]) => {
  t("banned: " + name, () => assert.ok(isBannedQuestion(bad), "not detected"));
  t("dropped: " + name, () => assert.strictEqual(normalizeQuestions({ questions: [bad] }, IN1).length, 0));
});

t("a legitimate question is not banned", () => {
  assert.ok(!isBannedQuestion(q()));
  assert.strictEqual(normalizeQuestions({ questions: [q()] }, IN1).length, 1);
});
t("material TYPE is allowed - it moves real money", () => {
  const ok = q({ label: "What is on the floor now?", topic: "flooring", options: ["Hardwood", "Tile", "Carpet"] });
  assert.ok(!isBannedQuestion(ok));
});

/* ── one question per trade ────────────────────────────────────────────── */
t("two questions about the same trade: the second is dropped", () => {
  const out = normalizeQuestions({ questions: [
    q({ questionId: "a", label: "How big is the bathroom?", topic: "bathroom" }),
    q({ questionId: "b", label: "Is the bathroom layout changing?", topic: "bathroom" }),
  ] }, IN2);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].questionId, "a");
});
t("a reworded duplicate with no stated topic is still caught by the text", () => {
  const out = normalizeQuestions({ questions: [
    q({ questionId: "a", label: "How many square feet of flooring?", topic: "" }),
    q({ questionId: "b", label: "What is under the floors right now?", topic: "" }),
  ] }, IN2);
  assert.strictEqual(out.length, 1);
});
t("different trades both survive", () => {
  const out = normalizeQuestions({ questions: [
    q({ questionId: "a", label: "How many square feet of flooring?", topic: "flooring" }),
    q({ questionId: "b", label: "How many rooms need painting?", topic: "painting" }),
  ] }, IN2);
  assert.strictEqual(out.length, 2);
});
t("two topic-less general questions both survive", () => {
  // Size, access and occupancy carry no trade, and asking two of them is fine.
  const out = normalizeQuestions({ questions: [
    q({ questionId: "a", label: "Which floor is the unit on?", topic: "", options: ["Ground", "2nd-3rd", "4th or higher"] }),
    q({ questionId: "b", label: "Will anyone be living there during the work?", topic: "", options: ["Yes", "No"] }),
  ] }, IN2);
  assert.strictEqual(out.length, 2);
});

/* ── the escape hatch ──────────────────────────────────────────────────── */
t("every choice question gets an 'I'm not sure' option", () => {
  const out = normalizeQuestions({ questions: [q()] }, IN1);
  assert.strictEqual(out[0].options[out[0].options.length - 1], NOT_SURE);
});
t("a text question does not get options", () => {
  const out = normalizeQuestions({ questions: [q({ type: "text", options: [], placeholder: "e.g. 250" })] }, IN1);
  assert.strictEqual(out[0].type, "text");
  assert.deepStrictEqual(out[0].options, []);
});
t("the model cannot add its own 'not sure' twice", () => {
  const out = normalizeQuestions({ questions: [q({ options: ["A", "B"] })] }, IN1);
  assert.strictEqual(out[0].options.filter((o) => o === NOT_SURE).length, 1);
});

/* ── ONE ESCAPE HATCH, NOT THREE ───────────────────────────────────────────
   Seen on the live form: "Not sure where it's coming from" and "I'm not sure"
   one above the other, with "Other — let me explain" under both. The model
   wrote its own uncertainty option despite being told not to, and the code
   appended a second. Three ways to say "I don't know" on one screen. */
t("the model's own uncertainty option is recognised", () => {
  assert.ok(hasUnsureOption(["Still leaking", "Not sure where it's coming from"]));
  assert.ok(hasUnsureOption(["Staying put", "Not sure yet"]));
  assert.ok(hasUnsureOption(["A", "Unsure"]));
  assert.ok(hasUnsureOption(["A", "I don't know"]));
  assert.ok(hasUnsureOption(["A", "No idea"]));
  assert.ok(hasUnsureOption(["A", "Can't tell"]));
});
t("a real answer is not mistaken for an uncertainty option", () => {
  // These say something. Only a leading "not sure"-style phrase counts.
  assert.ok(!hasUnsureOption(["Still leaking now", "Stopped, but stains remain"]));
  assert.ok(!hasUnsureOption(["Everything stays where it is", "Moving one or more fixtures"]));
  assert.ok(!hasUnsureOption(["House", "Apartment/co-op", "Condo"]));
  assert.ok(!hasUnsureOption(["Sure, go ahead"]));
});
t("no second 'not sure' is added when the model wrote one", () => {
  const out = normalizeQuestions({ questions: [q({
    label: "Is the leak still active, or has it been stopped?",
    topic: "water",
    options: ["Still leaking now", "Stopped, but stains remain", "Not sure where it's coming from"],
  })] }, IN1);
  assert.deepStrictEqual(out[0].options,
    ["Still leaking now", "Stopped, but stains remain", "Not sure where it's coming from"]);
});
t("the more informative wording is the one kept", () => {
  // "Not sure where it's coming from" is scope information - the source is
  // unknown and has to be found. "I'm not sure" is only an absence.
  const out = normalizeQuestions({ questions: [q({
    topic: "water", options: ["Still leaking", "Not sure where it's coming from"],
  })] }, IN1);
  assert.ok(out[0].options.indexOf("Not sure where it's coming from") !== -1);
  assert.strictEqual(out[0].options.indexOf(NOT_SURE), -1);
});
t("a question with no uncertainty option still gets one", () => {
  const out = normalizeQuestions({ questions: [q({ options: ["House", "Apartment/co-op", "Condo"] })] }, IN1);
  assert.strictEqual(out[0].options[out[0].options.length - 1], NOT_SURE);
});

/* ══ THE ESCAPE HATCH IS NEVER OPTIONAL. ═══════════════════════════════════
   Zura's rule, in his words: "many customers doesn't have a answers, they
   don't know in deep what's going on and let's keep for them."

   He is right, and it is worth saying why in code: a customer who cannot
   answer and has no way to say so will either guess or leave. A guess is the
   worse outcome of the two, because it arrives looking like a fact and gets
   priced like one.

   So: EVERY multiple-choice question reaches the customer with a way to say "I
   don't know" - either the model's own wording or ours. Deduplicating the two
   must never be able to leave a question with neither. This test walks a set of
   shapes that have caught real bugs and proves the guarantee holds for all of
   them. ("Other - let me explain" is added by the form itself, on top of this,
   for the customer who has an answer but not one of the listed ones.) */
t("EVERY choice question always offers a way to say 'I don't know'", () => {
  const shapes = [
    { name: "plain options",        options: ["House", "Apartment/co-op", "Condo"] },
    { name: "model wrote its own",  options: ["Still leaking now", "Not sure where it's coming from"] },
    { name: "model wrote 'not sure yet'", options: ["Staying put", "Not sure yet"] },
    { name: "model wrote ours verbatim",  options: ["Yes", "No", NOT_SURE] },
    { name: "two choices only",     options: ["Yes", "No"] },
    { name: "the maximum five",     options: ["a", "b", "c", "d", "e"] },
    { name: "odd casing",           options: ["Yes", "NOT SURE"] },
  ];
  shapes.forEach((shape) => {
    const out = normalizeQuestions({ questions: [q({ options: shape.options })] }, IN1);
    assert.strictEqual(out.length, 1, shape.name + ": question was dropped");
    assert.ok(hasUnsureOption(out[0].options),
      shape.name + ": no escape hatch — " + JSON.stringify(out[0].options));
    // ...and exactly one of them, never a stacked pair.
    const unsure = out[0].options.filter((o) => /not sure|unsure|don't know|no idea/i.test(o));
    assert.strictEqual(unsure.length, 1,
      shape.name + ": " + unsure.length + " uncertainty options — " + JSON.stringify(out[0].options));
  });
});

/* ── shape coercion ────────────────────────────────────────────────────── */
t("an unknown type becomes options-stack", () => {
  assert.strictEqual(normalizeQuestions({ questions: [q({ type: "dropdown" })] }, IN1)[0].type, "options-stack");
});
t("a choice question with one option becomes text", () => {
  const out = normalizeQuestions({ questions: [q({ options: ["Only one"] })] }, IN1);
  assert.strictEqual(out[0].type, "text");
  assert.deepStrictEqual(out[0].options, []);
});
t("a question with no label is dropped", () => {
  assert.strictEqual(normalizeQuestions({ questions: [q({ label: "  " })] }, IN1).length, 0);
});
t("junk in the list is skipped, not thrown", () => {
  const out = normalizeQuestions({ questions: [null, "nope", 7, q()] }, IN1);
  assert.strictEqual(out.length, 1);
});
t("no questions key at all returns an empty list", () => {
  assert.deepStrictEqual(normalizeQuestions({}, IN1), []);
  assert.deepStrictEqual(normalizeQuestions(null, IN1), []);
});
t("options are capped at 5 before the escape hatch", () => {
  const out = normalizeQuestions({ questions: [q({ options: ["a", "b", "c", "d", "e", "f", "g"] })] }, IN1);
  assert.strictEqual(out[0].options.length, 6, "5 + not sure");
});

/* ── ids ───────────────────────────────────────────────────────────────── */
t("a missing id is built from the label", () => {
  const out = normalizeQuestions({ questions: [q({ questionId: "" })] }, IN1);
  assert.ok(out[0].questionId.length > 0);
  assert.ok(/^[a-z0-9-]+$/.test(out[0].questionId), out[0].questionId);
});
t("duplicate ids are made unique", () => {
  const out = normalizeQuestions({ questions: [
    q({ questionId: "size", label: "How big is the floor area?", topic: "flooring" }),
    q({ questionId: "size", label: "How many rooms are painted?", topic: "painting" }),
  ] }, IN2);
  assert.notStrictEqual(out[0].questionId, out[1].questionId);
});

/* ── the trade header ──────────────────────────────────────────────────── */
t("a trade question is labelled with its trade", () => {
  const out = normalizeQuestions({ questions: [q({ topic: "flooring", label: "What is on the floor now?" })] }, IN2);
  assert.strictEqual(out[0].topicLabel, "Flooring");
});
t("on a single-service job a general question falls back to that service", () => {
  const out = normalizeQuestions({ questions: [q({ topic: "", label: "Which floor is the unit on?" })] }, IN1);
  assert.strictEqual(out[0].topicLabel, "Bathroom");
});
t("on a multi-service job a general question says Project Details", () => {
  const out = normalizeQuestions({ questions: [q({ topic: "", label: "Will anyone be living there?" })] }, IN2);
  assert.strictEqual(out[0].topicLabel, "Project Details");
});
t("an invented topic falls back to what the text says", () => {
  const out = normalizeQuestions({ questions: [q({ topic: "unicorns", label: "How many doors are being replaced?" })] }, IN2);
  assert.strictEqual(out[0].topicLabel, "Doors");
});
t("topicsIn finds water damage wording", () => {
  assert.ok(topicsIn("there is a leak and the ceiling is soft").indexOf("water") !== -1);
});
t("an access question is not a flooring question", () => {
  // "Which floor is the unit on" is about carrying material up four flights.
  // Filing it under Flooring used to burn the flooring slot, so the real
  // flooring question was then dropped as a duplicate.
  assert.deepStrictEqual(topicsIn("Which floor is the unit on?"), []);
  assert.deepStrictEqual(topicsIn("Is there an elevator, or is it a walk-up?"), []);
});
t("an access question does not block a real flooring question", () => {
  const out = normalizeQuestions({ questions: [
    q({ questionId: "acc", label: "Which floor is the unit on?", topic: "", options: ["Ground", "2nd or 3rd", "4th or higher"] }),
    q({ questionId: "flr", label: "How many square feet of flooring?", topic: "flooring" }),
  ] }, IN2);
  assert.strictEqual(out.length, 2, "the flooring question was swallowed");
  assert.strictEqual(out[1].topicLabel, "Flooring");
});
t("the reason text never decides the trade", () => {
  // "Area drives every tile and labor line" is why we ask, not what we ask about.
  const out = normalizeQuestions({ questions: [
    q({ questionId: "a", label: "How many doors are being replaced?", topic: "", why: "Area drives every tile and labor line" }),
    q({ questionId: "b", label: "How much wall tile is there?", topic: "tile" }),
  ] }, IN2);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].topicLabel, "Doors");
});
t("a topic the model states wins over the wording", () => {
  const out = normalizeQuestions({ questions: [q({ topic: "plumbing", label: "Is the tub staying where it is?" })] }, IN2);
  assert.strictEqual(out[0].topicLabel, "Plumbing");
});

/* ── the prompt ────────────────────────────────────────────────────────── */
t("the prompt carries the customer's own words", () => {
  const p = planPrompt({ serviceCount: 1, serviceLabel: "Bathroom", description: "the tub is cracked" });
  assert.ok(p.indexOf("the tub is cracked") !== -1);
});
t("the prompt states the cap it will actually be held to", () => {
  const p = planPrompt({ serviceCount: 2, serviceLabel: "Flooring, Painting", description: "x" });
  assert.ok(p.indexOf("at most 4 questions") !== -1, "cap not stated");
});
t("an empty description is stated, not left blank", () => {
  const p = planPrompt({ serviceCount: 1, serviceLabel: "Bathroom", description: "" });
  assert.ok(p.indexOf("(they did not write anything)") !== -1);
});
t("photo findings reach the prompt when there are any", () => {
  const p = planPrompt({ serviceCount: 1, serviceLabel: "Bathroom", description: "x", photoNotes: ["Cracked wall tile"] });
  assert.ok(p.indexOf("Cracked wall tile") !== -1);
});
t("the photo block is absent when there are no photos", () => {
  const p = planPrompt({ serviceCount: 1, serviceLabel: "Bathroom", description: "x" });
  assert.ok(p.indexOf("WHAT THE PHOTOS SHOW") === -1);
});
t("the prompt never asks the model to add its own not-sure option", () => {
  const p = planPrompt({ serviceCount: 1, serviceLabel: "Bathroom", description: "x" });
  assert.ok(p.indexOf('Do not add an "I\'m not sure" option') !== -1);
});
t("the price drivers are in the prompt", () => {
  const p = planPrompt({ serviceCount: 1, serviceLabel: "Water Damage", description: "x" });
  assert.ok(p.indexOf("AREA OR COUNT") !== -1);
  assert.ok(p.indexOf("is the leak stopped or still active") !== -1);
});
t("the prompt never claims to be licensed", () => {
  const p = planPrompt({ serviceCount: 1, serviceLabel: "Bathroom", description: "x" });
  assert.ok(!/\blicensed\b/i.test(p.replace(/licensed sub/gi, "")), "the word appears in customer-visible framing");
});

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
