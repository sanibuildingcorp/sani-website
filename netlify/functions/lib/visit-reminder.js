// netlify/functions/lib/visit-reminder.js
//
// The words and the arithmetic behind the site-visit reminder email, kept
// apart from the network so a test can build the whole email without Resend
// or Blobs.
//
// A visit's `datetime` is the string the dashboard's datetime-local input
// gave it: "2026-09-17T14:00", New York wall-clock time, no zone. So "which
// day is this visit" is the first ten characters, and "what day is it in
// Brooklyn right now" comes from Intl with the New York zone - never from
// the server's clock, which is UTC and turns over at 8 pm his time.

"use strict";

const TZ = "America/New_York";

/* "YYYY-MM-DD" in New York, `offsetDays` days from `now`. */
function nyDate(now, offsetDays) {
  const d = new Date((now || new Date()).getTime() + (offsetDays || 0) * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/* The hour (0-23) in New York. */
function nyHour(now) {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false }).format(now || new Date());
  return Number(h) % 24;
}

/* Morning run -> today's list. Evening run -> tomorrow's list, so he can
   plan the night before instead of finding out over breakfast. */
function pickMode(now) {
  return nyHour(now) < 12 ? "today" : "tomorrow";
}

/* "Wed, Sep 17" from "2026-09-17". Built from parts, not new Date(), so a
   UTC server does not shift the day. */
function longDay(dateKey) {
  const p = String(dateKey || "").split("-").map(Number);
  if (p.length !== 3 || p.some(isNaN)) return String(dateKey || "");
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12));
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(d);
}

/* "2:00 PM" from "2026-09-17T14:00". */
function clock(datetime) {
  const m = /T(\d{2}):(\d{2})/.exec(String(datetime || ""));
  if (!m) return "";
  let h = Number(m[1]); const mm = m[2];
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return h + ":" + mm + " " + ap;
}

/* The open visits that fall on `dateKey`, earliest first. */
function visitsOn(visits, dateKey) {
  return (Array.isArray(visits) ? visits : [])
    .filter(function (v) { return v && !v.done && String(v.datetime || "").slice(0, 10) === dateKey; })
    .sort(function (a, b) { return String(a.datetime).localeCompare(String(b.datetime)); });
}

/* One-tap "add to Google Calendar". The dates are New York wall-clock and
   the ctz parameter says so - the dashboard's version leans on the phone's
   own zone, which a server cannot. One hour long, like the dashboard's. */
function gcalLink(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(v.datetime || ""));
  if (!m) return "";
  const start = m[1] + m[2] + m[3] + "T" + m[4] + m[5] + "00";
  const endH = String((Number(m[4]) + 1) % 24).padStart(2, "0");
  const end = m[1] + m[2] + m[3] + "T" + endH + m[5] + "00";
  return "https://calendar.google.com/calendar/render?action=TEMPLATE"
    + "&text=" + encodeURIComponent("Site visit: " + (v.customer || ""))
    + "&dates=" + start + "/" + end
    + "&ctz=" + encodeURIComponent(TZ)
    + "&location=" + encodeURIComponent(v.address || "")
    + "&details=" + encodeURIComponent((v.reason || "") + (v.ref ? (" · " + v.ref) : ""));
}

function mapsLink(address) {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(address || "");
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/**
 * @param {{mode:'today'|'tomorrow', dateKey:string, visits:object[], siteUrl?:string}} p
 * @returns {{subject:string, html:string, text:string, count:number}}
 */
function buildReminderEmail(p) {
  const mode = p.mode === "tomorrow" ? "tomorrow" : "today";
  const list = visitsOn(p.visits, p.dateKey);
  const siteUrl = (p.siteUrl || "https://www.sanibuildingcorp.com").replace(/\/$/, "");
  const when = mode === "today" ? "Today" : "Tomorrow";
  const n = list.length;
  const noun = n === 1 ? "site visit" : "site visits";
  const subject = "📅 " + when + ": " + n + " " + noun + " — " + longDay(p.dateKey);

  const rows = list.map(function (v) {
    return '<div style="border:1px solid #e8e2d9;border-radius:10px;padding:14px 16px;margin:0 0 12px;background:#fff">'
      + '<div style="font-size:18px;font-weight:700;color:#0d1b2a">' + esc(clock(v.datetime)) + ' &middot; ' + esc(v.customer) + '</div>'
      + (v.address ? '<div style="margin:6px 0 2px;font-size:15px"><a href="' + mapsLink(v.address) + '" style="color:#1a5fb4;text-decoration:none">📍 ' + esc(v.address) + '</a></div>' : '')
      + (v.reason ? '<div style="font-size:14px;color:#555;margin:4px 0">Why: ' + esc(v.reason) + '</div>' : '')
      + (v.ref ? '<div style="font-size:13px;color:#888;margin:4px 0">Estimate ' + esc(v.ref) + '</div>' : '')
      + '<div style="margin-top:10px"><a href="' + gcalLink(v) + '" style="display:inline-block;padding:9px 14px;border-radius:8px;background:#0d1b2a;color:#c9a84c;font-size:13px;font-weight:700;text-decoration:none">📆 Add to Google Calendar</a></div>'
      + '</div>';
  }).join("");

  const html = '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;background:#f6f4ef">'
    + '<div style="background:linear-gradient(135deg,#0d1b2a,#1a2d42);color:#fff;padding:22px;border-radius:10px 10px 0 0;text-align:center">'
    + '<div style="font-size:14px;letter-spacing:3px;color:#c9a84c">SANI BUILDING CORP</div>'
    + '<div style="font-size:11px;letter-spacing:2px;color:#aaa;margin-top:4px">SITE VISIT REMINDER</div>'
    + '</div>'
    + '<div style="background:#faf8f4;border:1px solid #e8e2d9;border-top:none;padding:22px;border-radius:0 0 10px 10px">'
    + '<div style="font-size:20px;font-weight:700;margin:0 0 4px">' + when + ' — ' + esc(longDay(p.dateKey)) + '</div>'
    + '<div style="font-size:14px;color:#666;margin:0 0 18px">' + n + ' ' + noun + ' scheduled</div>'
    + rows
    + '<div style="margin-top:18px;text-align:center"><a href="' + siteUrl + '/dashboard" style="display:inline-block;padding:12px 22px;border-radius:8px;background:#c9a84c;color:#0d1b2a;font-weight:700;text-decoration:none">Open the dashboard</a></div>'
    + '<div style="font-size:12px;color:#999;margin-top:16px;text-align:center">Mark a visit done in the dashboard and it leaves these reminders.</div>'
    + '</div></body></html>';

  const text = when + " — " + longDay(p.dateKey) + ": " + n + " " + noun + "\n\n"
    + list.map(function (v) {
      return clock(v.datetime) + "  " + v.customer
        + (v.address ? "\n   " + v.address + "\n   " + mapsLink(v.address) : "")
        + (v.reason ? "\n   Why: " + v.reason : "")
        + (v.ref ? "\n   Estimate " + v.ref : "")
        + "\n   Add to calendar: " + gcalLink(v);
    }).join("\n\n")
    + "\n\n" + siteUrl + "/dashboard\n";

  return { subject, html, text, count: n };
}

module.exports = { TZ, nyDate, nyHour, pickMode, longDay, clock, visitsOn, gcalLink, mapsLink, buildReminderEmail };
