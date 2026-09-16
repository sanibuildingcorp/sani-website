/* visit-reminders.test.js — run: node netlify/functions/lib/visit-reminders.test.js
 *
 *   "for tomorrow i have 3 on site visits bookings and i have write by hand
 *    in my notebook for remind but i need your help for plane booking or on
 *    site visits calendar with notifications"
 *
 * The reminder is an email, twice a day: in the morning the visits for today,
 * in the evening the visits for tomorrow. This file runs the real handler
 * with Blobs and Resend stubbed, at fixed instants, and checks the three
 * things that would make it useless:
 *
 *   - the wrong DAY: the server runs on UTC, which turns over at 8 pm in
 *     Brooklyn. A 9 pm reminder built from the server's date would list the
 *     day after tomorrow.
 *   - the wrong LIST: done visits, other days, or nothing at all when there
 *     are three.
 *   - too MANY: a stranger who finds the URL must not be able to make it
 *     send, and a second scheduled call the same day must not send twice.
 */
const Module = require("module");
const path = require("path");

/* ── stubs: Blobs, https, and the clock ─────────────────────────────────── */
let VISITS = {};
let MARKERS = {};
let sent = [];
let resendStatus = 200;
const realLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === "@netlify/blobs") {
    return {
      getStore: (opts) => {
        const bag = opts.name === "visits" ? VISITS : MARKERS;
        return {
          get: async (k) => (bag[k] ? JSON.parse(JSON.stringify(bag[k])) : null),
          set: async (k, v) => { bag[k] = JSON.parse(v); },
          list: async () => ({ blobs: Object.keys(bag).map((key) => ({ key })) }),
        };
      },
    };
  }
  if (req === "https") {
    return {
      request: (opts, cb) => {
        let data = "";
        return {
          on() { return this; },
          write(b) { data += b; },
          end() {
            sent.push(JSON.parse(data));
            const handlers = {};
            cb({ statusCode: resendStatus, on: (ev, fn) => { handlers[ev] = fn; if (ev === "end") { handlers.data && handlers.data(Buffer.from('{"id":"x"}')); fn(); } } });
          },
        };
      },
    };
  }
  return realLoad(req, parent, isMain);
};

const RealDate = Date;
let NOW = RealDate.parse("2026-09-17T11:00:00Z");
global.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [NOW])); }
  static now() { return NOW; }
};

const R = require(path.resolve(__dirname, "visit-reminder.js"));
const { handler } = require(path.resolve(__dirname, "..", "visit-reminders.js"));

let pass = 0, fail = 0;
const t = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? "PASS  " : "FAIL  ") + n + (d ? "\n        " + d : "")); };

const KEY = "the-real-dashboard-key";
process.env.DASHBOARD_KEY = KEY;
process.env.RESEND_API_KEY = "re_test";
process.env.CONTRACTOR_EMAIL = "owner@example.com";

function seed() {
  VISITS = {
    "V-1": { id: "V-1", customer: "Maria Lopez", address: "1234 Ocean Pkwy, Brooklyn", reason: "measure bathroom", ref: "SBC-260910-AB12", datetime: "2026-09-17T14:00", done: false },
    "V-2": { id: "V-2", customer: "Ken Wu", address: "88 Bay 7th St, Brooklyn", reason: "confirm scope", ref: "", datetime: "2026-09-17T09:30", done: false },
    "V-3": { id: "V-3", customer: "Done Already", address: "1 Done St", reason: "", ref: "", datetime: "2026-09-17T16:00", done: true },
    "V-4": { id: "V-4", customer: "Tomorrow Person", address: "5 Next Ave, Brooklyn", reason: "walkthrough", ref: "", datetime: "2026-09-18T10:00", done: false },
    "V-5": { id: "V-5", customer: "Sam Green", address: "77 Kings Hwy", reason: "", ref: "", datetime: "2026-09-17T18:15", done: false },
  };
  MARKERS = {};
  sent = [];
  resendStatus = 200;
}
const scheduled = (extra) => handler(Object.assign({ httpMethod: "POST", headers: {}, body: JSON.stringify({ next_run: "2026-09-17T22:00:00.000Z" }), queryStringParameters: {} }, extra || {}));
const keyed = (qs) => handler({ httpMethod: "GET", headers: { "x-sbc-key": KEY }, body: "", queryStringParameters: qs || {} });
const J = (r) => JSON.parse(r.body);

(async () => {
  /* ══ THE CLOCK ══════════════════════════════════════════════════════════ */
  console.log("\n1. Which day is it in Brooklyn\n");
  const at = (iso) => new RealDate(RealDate.parse(iso));
  t("11:00 UTC in September is 7 am New York -> the morning run, today's list",
    R.nyHour(at("2026-09-17T11:00:00Z")) === 7 && R.pickMode(at("2026-09-17T11:00:00Z")) === "today");
  t("22:00 UTC in September is 6 pm New York -> the evening run, tomorrow's list",
    R.nyHour(at("2026-09-17T22:00:00Z")) === 18 && R.pickMode(at("2026-09-17T22:00:00Z")) === "tomorrow");
  t("11:00 UTC in January is 6 am New York - still the morning run",
    R.nyHour(at("2026-01-15T11:00:00Z")) === 6 && R.pickMode(at("2026-01-15T11:00:00Z")) === "today");
  t("THE UTC TURNOVER: 01:00 UTC on the 18th is still 9 pm on the 17th in Brooklyn",
    R.nyDate(at("2026-09-18T01:00:00Z"), 0) === "2026-09-17", R.nyDate(at("2026-09-18T01:00:00Z"), 0));
  t("...so 'tomorrow' from there is the 18th, not the 19th",
    R.nyDate(at("2026-09-18T01:00:00Z"), 1) === "2026-09-18", R.nyDate(at("2026-09-18T01:00:00Z"), 1));
  t("the day is written from its parts, so a UTC server does not shift it",
    R.longDay("2026-09-17") === "Thu, Sep 17", R.longDay("2026-09-17"));
  t("the hour is read from the visit string, not from a Date", R.clock("2026-09-17T14:00") === "2:00 PM" && R.clock("2026-09-17T09:30") === "9:30 AM" && R.clock("2026-09-17T00:05") === "12:05 AM" && R.clock("2026-09-17T12:00") === "12:00 PM");

  /* ══ THE LIST ═══════════════════════════════════════════════════════════ */
  console.log("\n2. Which visits go in the email\n");
  seed();
  {
    const list = R.visitsOn(Object.values(VISITS), "2026-09-17");
    t("THREE OPEN VISITS ON THE 17TH - not the done one, not tomorrow's", list.length === 3, list.map((v) => v.customer).join(", "));
    t("...earliest first", list.map((v) => v.customer).join("|") === "Ken Wu|Maria Lopez|Sam Green", list.map((v) => v.customer).join("|"));
  }
  {
    const m = R.buildReminderEmail({ mode: "today", dateKey: "2026-09-17", visits: Object.values(VISITS), siteUrl: "https://www.sanibuildingcorp.com/" });
    t("the subject says how many and which day", m.subject.indexOf("Today: 3 site visits") !== -1 && m.subject.indexOf("Thu, Sep 17") !== -1, m.subject);
    t("each visit shows its time, name and address", /9:30 AM &middot; Ken Wu/.test(m.html) && /2:00 PM &middot; Maria Lopez/.test(m.html) && /1234 Ocean Pkwy, Brooklyn/.test(m.html));
    t("the address is a Google Maps link", /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=1234%20Ocean%20Pkwy%2C%20Brooklyn"/.test(m.html));
    t("the reason and the estimate ref are there", /Why: measure bathroom/.test(m.html) && /Estimate SBC-260910-AB12/.test(m.html));
    t("the done visit is not in it", m.html.indexOf("Done Already") === -1);
    t("tomorrow's visit is not in today's email", m.html.indexOf("Tomorrow Person") === -1);
    t("the dashboard link has no double slash", m.html.indexOf("https://www.sanibuildingcorp.com/dashboard") !== -1 && m.html.indexOf(".com//") === -1);
    t("the plain-text copy carries the same three", /Ken Wu/.test(m.text) && /Maria Lopez/.test(m.text) && /Sam Green/.test(m.text) && m.text.indexOf("Done Already") === -1);
  }
  {
    const g = R.gcalLink(VISITS["V-1"]);
    t("ADD-TO-CALENDAR IS IN NEW YORK TIME - the dates are wall-clock and ctz says which clock",
      /dates=20260917T140000\/20260917T150000/.test(g) && /ctz=America%2FNew_York/.test(g), g);
    t("...with the customer, the address and the reason", /Site%20visit%3A%20Maria%20Lopez/.test(g) && /location=1234%20Ocean%20Pkwy/.test(g) && /measure%20bathroom/.test(g));
    t("a single visit reads 'site visit', not 'site visits'",
      R.buildReminderEmail({ mode: "tomorrow", dateKey: "2026-09-18", visits: Object.values(VISITS) }).subject.indexOf("Tomorrow: 1 site visit —") !== -1);
    t("a customer name with markup is escaped",
      R.buildReminderEmail({ mode: "today", dateKey: "2026-09-17", visits: [{ customer: "<b>x</b>", datetime: "2026-09-17T10:00" }] }).html.indexOf("<b>x</b>") === -1);
  }

  /* ══ THE HANDLER ════════════════════════════════════════════════════════ */
  console.log("\n3. Who can make it send\n");
  seed();
  {
    let r = await handler({ httpMethod: "GET", headers: {}, body: "", queryStringParameters: {} });
    t("A STRANGER WITH NO KEY AND NO SCHEDULE BODY GETS 401", r.statusCode === 401, r.statusCode + " " + r.body);
    r = await handler({ httpMethod: "GET", headers: { "x-sbc-key": "guess" }, body: "", queryStringParameters: {} });
    t("a wrong key is 401 too", r.statusCode === 401, String(r.statusCode));
    t("...and nothing was sent", sent.length === 0);
  }

  console.log("\n4. The morning run sends today's three, once\n");
  seed(); NOW = RealDate.parse("2026-09-17T11:00:00Z");
  {
    let r = await scheduled();
    let j = J(r);
    t("THE SCHEDULED MORNING CALL SENDS", r.statusCode === 200 && j.sent === true, r.body);
    t("...mode today, the 17th, three visits", j.mode === "today" && j.dateKey === "2026-09-17" && j.count === 3, r.body);
    t("...one email, to the contractor", sent.length === 1 && sent[0].to[0] === "owner@example.com", JSON.stringify(sent.map((s) => s.to)));
    t("...from the verified domain, not the Resend sandbox", /estimates@sanibuildingcorp\.com/.test(sent[0].from) && !/resend\.dev/.test(sent[0].from), sent[0].from);
    t("...with the three names in it", /Ken Wu/.test(sent[0].html) && /Maria Lopez/.test(sent[0].html) && /Sam Green/.test(sent[0].html));

    r = await scheduled(); j = J(r);
    t("A SECOND SCHEDULED CALL THE SAME MORNING DOES NOT SEND AGAIN", j.sent === false && j.reason === "already sent", r.body);
    t("...still one email", sent.length === 1);

    r = await handler({ httpMethod: "POST", headers: {}, body: JSON.stringify({ next_run: "x" }), queryStringParameters: { force: "1", mode: "tomorrow" } });
    j = J(r);
    t("a stranger typing next_run with ?force=1&mode=tomorrow gets neither - the marker holds and the mode is the clock's",
      j.sent === false && j.mode === "today" && sent.length === 1, r.body);

    r = await keyed({ force: "1" }); j = J(r);
    t("HE CAN FORCE A RESEND WITH THE KEY", j.sent === true && sent.length === 2, r.body);
    r = await keyed({ mode: "tomorrow" }); j = J(r);
    t("...and pick tomorrow's list by hand", j.sent === true && j.mode === "tomorrow" && j.dateKey === "2026-09-18" && j.count === 1, r.body);
    t("...which lists the one visit on the 18th", /Tomorrow Person/.test(sent[2].html) && !/Ken Wu/.test(sent[2].html));
  }

  console.log("\n5. The evening run sends tomorrow's - even after UTC midnight\n");
  seed(); NOW = RealDate.parse("2026-09-17T22:00:00Z");
  {
    const r = await scheduled(); const j = J(r);
    t("6 pm New York -> tomorrow's list, the 18th", j.sent === true && j.mode === "tomorrow" && j.dateKey === "2026-09-18" && j.count === 1, r.body);
  }
  seed(); NOW = RealDate.parse("2026-09-18T01:30:00Z");
  {
    const r = await scheduled(); const j = J(r);
    t("9:30 PM NEW YORK ON THE 17TH (already the 18th in UTC) STILL MEANS TOMORROW = THE 18TH", j.mode === "tomorrow" && j.dateKey === "2026-09-18", r.body);
  }

  console.log("\n6. Quiet when there is nothing, loud when Resend is broken\n");
  seed(); NOW = RealDate.parse("2026-09-20T11:00:00Z");
  {
    const r = await scheduled(); const j = J(r);
    t("A DAY WITH NO VISITS SENDS NOTHING", r.statusCode === 200 && j.sent === false && j.reason === "no visits" && sent.length === 0, r.body);
    t("...and leaves no marker behind", Object.keys(MARKERS).length === 0);
  }
  seed(); NOW = RealDate.parse("2026-09-17T11:00:00Z"); resendStatus = 422;
  {
    const r = await scheduled();
    t("a Resend failure is a 500 with the reason, not a silent 200", r.statusCode === 500 && /Resend 422/.test(r.body), r.body);
    t("...and the marker is NOT written, so the next run tries again", Object.keys(MARKERS).length === 0, JSON.stringify(MARKERS));
  }
  seed(); delete process.env.RESEND_API_KEY;
  {
    const r = await scheduled();
    t("no RESEND_API_KEY -> 500 that names it", r.statusCode === 500 && /RESEND_API_KEY/.test(r.body), r.body);
  }
  process.env.RESEND_API_KEY = "re_test";

  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})();
