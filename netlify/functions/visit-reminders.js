// netlify/functions/visit-reminders.js — the site-visit reminder email.
//
//   "for tomorrow i have 3 on site visits bookings and i have write by hand
//    in my notebook for remind"
//
// SCHEDULED. netlify.toml runs this at 11:00 and 22:00 UTC every day:
//   11:00 UTC = 7 am New York in summer, 6 am in winter  -> "Today's visits"
//   22:00 UTC = 6 pm New York in summer, 5 pm in winter  -> "Tomorrow's visits"
// The function does not trust the cron for which list to send; it looks at
// the New York clock itself (before noon -> today, after -> tomorrow).
//
// WHO MAY CALL IT. Netlify's scheduler sends a body with `next_run`. He can
// also press it by hand from the dashboard with the dashboard key, and then
// may pick ?mode=today|tomorrow and ?force=1. Anyone else gets 401. And
// because a body with `next_run` in it can be typed by anyone, each (day,
// mode) is sent ONCE: a marker goes into Blobs and a repeat call is a no-op
// unless it is keyed and forced. A stranger hammering the URL cannot make
// his inbox fill up or burn the Resend quota.
//
// No visits that day -> no email. Silence means a free day, not a broken cron.

const https = require("https");
const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const R = require("./lib/visit-reminder");

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function visitsStore() {
  return getStore({ name: "visits", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
}
function markerStore() {
  return getStore({ name: "visit-reminders", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
}

async function loadVisits() {
  const s = visitsStore();
  const listing = await s.list();
  const out = [];
  for (const b of (listing.blobs || [])) {
    try {
      const v = await s.get(b.key, { type: "json" });
      if (v) out.push(v);
    } catch (e) { /* skip bad record */ }
  }
  return out;
}

exports.handler = async function (event) {
  const now = new Date();
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { body = {}; }
  const scheduled = !!(body && body.next_run);
  const keyed = requireDashboardKey(event) === null;

  if (!scheduled && !keyed) {
    return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "Bad or missing dashboard key" }) };
  }

  const qs = event.queryStringParameters || {};
  const mode = keyed && (qs.mode === "today" || qs.mode === "tomorrow") ? qs.mode : R.pickMode(now);
  const force = keyed && qs.force === "1";
  const dateKey = R.nyDate(now, mode === "today" ? 0 : 1);
  const markerKey = "sent:" + dateKey + ":" + mode;

  try {
    const visits = R.visitsOn(await loadVisits(), dateKey);
    if (!visits.length) {
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ sent: false, reason: "no visits", mode, dateKey, count: 0 }) };
    }

    const markers = markerStore();
    if (!force) {
      let already = null;
      try { already = await markers.get(markerKey, { type: "json" }); } catch (e) { already = null; }
      if (already) {
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ sent: false, reason: "already sent", mode, dateKey, count: visits.length, at: already.at }) };
      }
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "RESEND_API_KEY not set", mode, dateKey, count: visits.length }) };
    }
    const to = process.env.CONTRACTOR_EMAIL || "sanibuildingcorp@gmail.com";
    const siteUrl = process.env.SITE_URL || "https://www.sanibuildingcorp.com";
    const mail = R.buildReminderEmail({ mode, dateKey, visits, siteUrl });

    await sendResend(resendKey, {
      from: "Sani Building Corp <estimates@sanibuildingcorp.com>",
      to: [to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    await markers.set(markerKey, JSON.stringify({ at: now.toISOString(), count: visits.length, forced: force }));

    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ sent: true, mode, dateKey, count: visits.length, to }) };
  } catch (e) {
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: e.message, mode, dateKey }) };
  }
};

function sendResend(apiKey, payload) {
  const data = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.resend.com",
        port: 443,
        path: "/emails",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          Authorization: `Bearer ${apiKey}`,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
          else reject(new Error(`Resend ${res.statusCode}: ${body}`));
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}
