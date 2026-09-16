/* gcal-sync.test.js — run: node netlify/functions/lib/gcal-sync.test.js
 *
 *   "yes i want to add automatically"
 *
 * A visit saved in the dashboard goes into his Google Calendar by itself,
 * through an Apps Script web app in his own account. This file runs the real
 * sync module and the real visits handler with Blobs and fetch stubbed.
 *
 * WHAT WOULD HURT:
 *   - a visit LOST because Google was slow or the script was not deployed:
 *     the visit must be saved whatever the calendar says;
 *   - the WRONG HOUR: a New York wall-clock time read as UTC puts him at the
 *     door four or five hours early;
 *   - the SECRET leaking: it must go to Google and nowhere else, never into
 *     a response body or onto the stored visit;
 *   - "not connected" reported as a failure.
 */
const Module = require("module");
const path = require("path");

let BAG = {};
let writes = [];
const realLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === "@netlify/blobs") {
    return {
      getStore: () => ({
        get: async (k) => (BAG[k] ? JSON.parse(JSON.stringify(BAG[k])) : null),
        set: async (k, v) => { writes.push(k); BAG[k] = JSON.parse(v); },
        delete: async (k) => { delete BAG[k]; },
        list: async () => ({ blobs: Object.keys(BAG).map((key) => ({ key })) }),
      }),
    };
  }
  return realLoad(req, parent, isMain);
};

const G = require(path.resolve(__dirname, "gcal-sync.js"));
const { handler } = require(path.resolve(__dirname, "..", "visits.js"));

let pass = 0, fail = 0;
const t = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? "PASS  " : "FAIL  ") + n + (d ? "\n        " + d : "")); };

/* a fetch stub that records the call and answers as told */
let calls = [];
let answer = () => ({ status: 200, text: JSON.stringify({ ok: true, eventId: "evt_123@google.com" }) });
global.fetch = async (url, opts) => {
  calls.push({ url, opts, body: JSON.parse(opts.body) });
  const a = answer();
  if (a.throw) throw a.throw;
  return { ok: a.status >= 200 && a.status < 300, status: a.status, text: async () => a.text };
};

const KEY = "the-real-dashboard-key";
process.env.DASHBOARD_KEY = KEY;
const SECRET = "shh-this-is-the-shared-secret-for-the-test";
const URL = "https://script.google.com/macros/s/AKfycb-test/exec";
function connect() { process.env.GCAL_SYNC_URL = URL; process.env.GCAL_SYNC_SECRET = SECRET; }
function disconnect() { delete process.env.GCAL_SYNC_URL; delete process.env.GCAL_SYNC_SECRET; }
const post = (body) => handler({ httpMethod: "POST", headers: { "x-sbc-key": KEY }, body: JSON.stringify(body) });
const J = (r) => JSON.parse(r.body);
const VISIT = { customer: "Maria Lopez", address: "1234 Ocean Pkwy, Brooklyn", reason: "measure bathroom", datetime: "2026-09-17T14:00", ref: "SBC-260910-AB12" };

(async () => {
  console.log("\n1. New York wall-clock -> the instant Google gets\n");
  t("2 PM ON SEPT 17 IN BROOKLYN IS 18:00 UTC (EDT, -4)", G.nyWallToEpoch("2026-09-17T14:00") === Date.UTC(2026, 8, 17, 18, 0), String(new Date(G.nyWallToEpoch("2026-09-17T14:00")).toISOString()));
  t("2 PM on Jan 15 is 19:00 UTC (EST, -5)", G.nyWallToEpoch("2026-01-15T14:00") === Date.UTC(2026, 0, 15, 19, 0));
  t("midnight is handled - no hour 24", G.nyWallToEpoch("2026-09-17T00:30") === Date.UTC(2026, 8, 17, 4, 30));
  t("the morning of the spring change (Mar 8 2026, 10 AM) is 14:00 UTC, already -4", G.nyWallToEpoch("2026-03-08T10:00") === Date.UTC(2026, 2, 8, 14, 0), new Date(G.nyWallToEpoch("2026-03-08T10:00")).toISOString());
  t("the evening before it (Mar 7, 10 PM) is 03:00 UTC, still -5", G.nyWallToEpoch("2026-03-07T22:00") === Date.UTC(2026, 2, 8, 3, 0));
  t("junk gives null, not NaN", G.nyWallToEpoch("") === null && G.nyWallToEpoch("tomorrow") === null);

  console.log("\n2. Not connected is 'skipped', and nothing is sent\n");
  disconnect(); calls = [];
  {
    const r = await G.syncVisit("create", Object.assign({ id: "V-1" }, VISIT));
    t("NO URL/SECRET -> skipped, not error", r.status === "skipped", JSON.stringify(r));
    t("...and fetch was never called", calls.length === 0);
    t("configured() says so", G.configured() === false);
  }

  console.log("\n3. Connected: what leaves the server\n");
  connect(); calls = [];
  {
    const r = await G.syncVisit("create", Object.assign({ id: "V-1" }, VISIT));
    t("OK WITH THE EVENT ID GOOGLE GAVE BACK", r.status === "ok" && r.eventId === "evt_123@google.com", JSON.stringify(r));
    t("one POST to the web app URL, following redirects (Apps Script answers with a 302)",
      calls.length === 1 && calls[0].url === URL && calls[0].opts.method === "POST" && calls[0].opts.redirect === "follow");
    const b = calls[0].body;
    t("the secret travels in the body to Google", b.secret === SECRET);
    t("the title, address and reason are there", b.title === "Site visit: Maria Lopez" && b.location === VISIT.address && /measure bathroom/.test(b.description) && /SBC-260910-AB12/.test(b.description));
    t("START IS THE EPOCH FOR 2 PM NEW YORK, END ONE HOUR LATER", b.startMs === Date.UTC(2026, 8, 17, 18, 0) && b.endMs === b.startMs + 3600000, b.startMs + " " + b.endMs);
    t("the visit id is in the description, so an event can be traced back", /Visit V-1/.test(b.description));
  }
  {
    calls = [];
    const r = await G.syncVisit("update", Object.assign({ id: "V-1", gcalEventId: "evt_old" }, VISIT));
    t("an update carries the stored event id", calls[0].body.action === "update" && calls[0].body.eventId === "evt_old" && r.status === "ok");
    calls = [];
    const d = await G.syncVisit("delete", Object.assign({ id: "V-1" }, VISIT));
    t("deleting a visit that was never in the calendar sends nothing", d.status === "skipped" && calls.length === 0, JSON.stringify(d));
  }

  console.log("\n4. Google misbehaves: an error, never a throw\n");
  connect();
  {
    answer = () => ({ status: 200, text: JSON.stringify({ error: "bad secret" }) });
    const r = await G.syncVisit("create", Object.assign({ id: "V-1" }, VISIT));
    t("the script's own error comes back as the message", r.status === "error" && r.message === "bad secret", JSON.stringify(r));

    answer = () => ({ status: 200, text: "<!DOCTYPE html><html><body>Sign in</body></html>" });
    const h = await G.syncVisit("create", Object.assign({ id: "V-1" }, VISIT));
    t("A GOOGLE SIGN-IN PAGE (web app not deployed as Anyone) IS EXPLAINED, not shown as a JSON parse error",
      h.status === "error" && /deployed with access/.test(h.message), h.message);

    answer = () => ({ throw: Object.assign(new Error("aborted"), { name: "AbortError" }) });
    const a = await G.syncVisit("create", Object.assign({ id: "V-1" }, VISIT));
    t("a timeout says so in seconds", a.status === "error" && /did not answer within 6 s/.test(a.message), a.message);

    answer = () => ({ throw: new Error("ENOTFOUND script.google.com") });
    const n = await G.syncVisit("create", Object.assign({ id: "V-1" }, VISIT));
    t("a network error is the message", n.status === "error" && /ENOTFOUND/.test(n.message));

    const bad = await G.syncVisit("create", { id: "V-2", customer: "X", datetime: "nonsense" });
    t("a visit with no usable time is an error before anything is sent", bad.status === "error" && /date\/time/.test(bad.message));
  }
  answer = () => ({ status: 200, text: JSON.stringify({ ok: true, eventId: "evt_123@google.com" }) });

  console.log("\n5. The visits endpoint: the visit is saved whatever the calendar says\n");
  connect();
  {
    BAG = {}; writes = []; calls = [];
    const r = await post({ action: "create", visit: VISIT });
    const j = J(r);
    t("CREATE WHILE CONNECTED: 200, the visit carries the event id", r.statusCode === 200 && j.visit.gcalEventId === "evt_123@google.com", r.body);
    t("...and gcal.status ok in the answer, for the dashboard's note", j.gcal && j.gcal.status === "ok");
    t("...the stored copy has it too", BAG[j.visit.id].gcalEventId === "evt_123@google.com");
    t("THE SECRET IS NOT IN THE RESPONSE, NOT ON THE STORED VISIT", r.body.indexOf(SECRET) === -1 && JSON.stringify(BAG).indexOf(SECRET) === -1);
    t("saved BEFORE Google was asked, then again after", writes.length === 2 && writes[0] === j.visit.id);

    BAG = {}; writes = []; calls = [];
    answer = () => ({ throw: Object.assign(new Error("aborted"), { name: "AbortError" }) });
    const e = await post({ action: "create", visit: VISIT });
    const je = J(e);
    t("CREATE WHEN GOOGLE TIMES OUT: STILL 200, STILL SAVED", e.statusCode === 200 && !!BAG[je.visit.id], e.body);
    t("...with gcal.status error and the reason, no event id", je.gcal.status === "error" && /did not answer/.test(je.gcal.message) && !je.visit.gcalEventId);
    answer = () => ({ status: 200, text: JSON.stringify({ ok: true, eventId: "evt_retry" }) });

    calls = [];
    const s = await post({ action: "sync", id: je.visit.id });
    const js = J(s);
    t("SYNC (the retry button) creates it and stores the id", s.statusCode === 200 && js.visit.gcalEventId === "evt_retry" && calls[0].body.action === "create", s.body);

    calls = [];
    await post({ action: "update", id: je.visit.id, patch: { done: true } });
    t("marking DONE does not touch the calendar", calls.length === 0);

    calls = [];
    const u = await post({ action: "update", id: je.visit.id, patch: { datetime: "2026-09-17T16:30" } });
    t("CHANGING THE TIME UPDATES THE SAME EVENT", calls.length === 1 && calls[0].body.action === "update" && calls[0].body.eventId === "evt_retry" && calls[0].body.startMs === Date.UTC(2026, 8, 17, 20, 30), JSON.stringify(calls[0] && calls[0].body));
    t("...and the answer still carries the visit", J(u).visit.datetime === "2026-09-17T16:30");

    calls = [];
    await post({ action: "update", id: je.visit.id, patch: { datetime: "2026-09-17T16:30" } });
    t("the same time again is not a change - nothing sent", calls.length === 0);

    calls = [];
    const d = await post({ action: "delete", id: je.visit.id });
    t("DELETE REMOVES THE EVENT TOO", calls.length === 1 && calls[0].body.action === "delete" && calls[0].body.eventId === "evt_retry" && !BAG[je.visit.id], d.body);
  }
  {
    BAG = {}; calls = [];
    const g = await handler({ httpMethod: "GET", headers: { "x-sbc-key": KEY } });
    t("GET says the calendar is connected", J(g).gcalConfigured === true);
    disconnect();
    const g2 = await handler({ httpMethod: "GET", headers: { "x-sbc-key": KEY } });
    t("...or not", J(g2).gcalConfigured === false);
    const c = await post({ action: "create", visit: VISIT });
    t("create while NOT connected: saved, gcal skipped, nothing sent", c.statusCode === 200 && J(c).gcal.status === "skipped" && calls.length === 0, c.body);
  }

  console.log("\n6. The Apps Script in the repo carries no real secret\n");
  {
    const fs = require("fs");
    const gs = fs.readFileSync(path.resolve(__dirname, "..", "..", "..", "google-calendar", "Code.gs"), "utf8");
    t("Code.gs has the placeholder, and refuses to run with it", /var SECRET = "PASTE-A-LONG-RANDOM-SECRET-HERE";/.test(gs) && /SECRET\.indexOf\("PASTE-"\) === 0/.test(gs));
    t("it sets the two reminders", /addPopupReminder\(60\)/.test(gs) && /addPopupReminder\(24 \* 60\)/.test(gs));
    t("it handles create, update and delete, and answers JSON", /action === "create"/.test(gs) && /action === "update"/.test(gs) && /action === "delete"/.test(gs) && /ContentService\.MimeType\.JSON/.test(gs));
    t("it reads the instants the server sends, not a wall-clock string", /new Date\(Number\(body\.startMs\)\)/.test(gs));
  }

  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})();
