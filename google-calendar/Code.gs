/* Sani Building Corp — site visits -> Google Calendar
 *
 * This is a Google Apps Script web app. It runs inside YOUR Google account
 * and writes each site visit from the dashboard into your calendar, with a
 * phone reminder 1 hour before and one the day before.
 *
 * Setup is in README.md next to this file. Two things to fill in:
 *   SECRET       a long random password. Put the SAME value in Netlify as
 *                GCAL_SYNC_SECRET. Never share it.
 *   CALENDAR_ID  leave empty for your main calendar.
 */
var SECRET = "PASTE-A-LONG-RANDOM-SECRET-HERE";
var CALENDAR_ID = "";

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ error: "bad json" }); }
  if (!SECRET || SECRET.indexOf("PASTE-") === 0 || body.secret !== SECRET) return out({ error: "bad secret" });

  var cal = CALENDAR_ID ? CalendarApp.getCalendarById(CALENDAR_ID) : CalendarApp.getDefaultCalendar();
  if (!cal) return out({ error: "calendar not found" });

  try {
    var start = new Date(Number(body.startMs));
    var end = new Date(Number(body.endMs));
    var opts = { location: body.location || "", description: body.description || "" };

    if (body.action === "create") {
      var ev = cal.createEvent(body.title || "Site visit", start, end, opts);
      setReminders(ev);
      return out({ ok: true, eventId: ev.getId() });
    }

    var existing = null;
    if (body.eventId) { try { existing = cal.getEventById(body.eventId); } catch (err) { existing = null; } }

    if (body.action === "update") {
      if (!existing) {
        var made = cal.createEvent(body.title || "Site visit", start, end, opts);
        setReminders(made);
        return out({ ok: true, eventId: made.getId() });
      }
      existing.setTitle(body.title || "Site visit");
      existing.setTime(start, end);
      existing.setLocation(opts.location);
      existing.setDescription(opts.description);
      return out({ ok: true, eventId: existing.getId() });
    }

    if (body.action === "delete") {
      if (existing) existing.deleteEvent();
      return out({ ok: true });
    }

    return out({ error: "unknown action" });
  } catch (err) {
    return out({ error: String((err && err.message) || err) });
  }
}

function setReminders(ev) {
  ev.removeAllReminders();
  ev.addPopupReminder(60);        // 1 hour before
  ev.addPopupReminder(24 * 60);   // the day before
}

/* Opening the web app URL in a browser shows this, so you can see it is live. */
function doGet() {
  return out({ ok: true, service: "sani-visits-gcal" });
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
