// netlify/functions/lib/schedule.js
//
// HOW LONG THE JOB TAKES, WORKED OUT FROM THE PRICE.
//
//   The customer page shows a real timeline (Perplexity's estimate design):
//   working days, waiting days for things to dry or cure, total days. The AI
//   never guesses it - it is counted here from the labor lines, so the time
//   always agrees with the price.
//
//   labor hours / (people x hours a day) = working days
//   + a waiting day where something must dry or cure (skim coat, waterproofing,
//     tile setting, grout) - drying is waiting, not labor.
//
// A small job stays small: up to one day of work is done by one person.
// quote.html carries the same function (scheduleOf); js/schedule.test.js
// checks the two give the same answer.

"use strict";

const HOUR_UNIT = /^(h|hr|hrs|hour|hours|man-?hours?)$/i;
const DEFAULT_RATE = 85;          // $/hour, only to turn a non-hour labor line into hours
const DEFAULTS = { crew: 2, dailyHours: 8 };

/* Things that must dry or cure before the next step, and how long. */
const WAITS = [
  { re: /waterproof|membrane|redgard|kerdi/i, days: 1, label: "Waterproofing cures" },
  { re: /mortar bed|mud bed|pre-?slope|leveling|self-?level/i, days: 1, label: "Floor base cures" },
  { re: /\btile\b|thinset|set tile|install tile/i, days: 1, label: "Tile sets" },
  { re: /\bgrout/i, days: 1, label: "Grout cures" },
  { re: /skim|spackle|joint compound|\bmud\b|tape and|taping|patch/i, days: 1, label: "Patches dry" },
];

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function lineHours(l, avgRate) {
  if (!l) return 0;
  if (HOUR_UNIT.test(String(l.unit || "").trim())) return Math.max(0, num(l.qty));
  const money = num(l.qty) * num(l.rate);
  return money > 0 ? money / (avgRate || DEFAULT_RATE) : 0;
}

/* The contractor's own numbers from the dashboard (estimate.scheduleEdit):
   people on the job, hours a day, and the working and drying days when he
   knows better than the count. An empty box means automatic. */
function editOf(e) {
  const ed = e && e.scheduleEdit && typeof e.scheduleEdit === "object" ? e.scheduleEdit : {};
  const pos = function (v) { const n = Number(v); return v !== "" && v != null && Number.isFinite(n) && n > 0 ? n : null; };
  const zeroOk = function (v) { const n = Number(v); return v !== "" && v != null && Number.isFinite(n) && n >= 0 ? n : null; };
  return { crew: pos(ed.crew), dailyHours: pos(ed.dailyHours), workDays: pos(ed.workDays), waitDays: zeroOk(ed.waitDays) };
}

function withEdit(sch, ed) {
  sch.auto = { workDays: sch.workDays, waitDays: sch.waitDays };
  if (ed.workDays != null) sch.workDays = ed.workDays;
  if (ed.waitDays != null) sch.waitDays = ed.waitDays;
  if (ed.workDays != null || ed.waitDays != null) sch.edited = true;
  sch.totalDays = Math.ceil(sch.workDays + sch.waitDays);
  return sch;
}

function scheduleOf(est, settings) {
  const e = est || {};
  const ed = editOf(e);
  const s = Object.assign({}, DEFAULTS, settings || {});
  if (ed.crew != null) s.crew = ed.crew;
  if (ed.dailyHours != null) s.dailyHours = ed.dailyHours;
  const labor = (Array.isArray(e.labor) ? e.labor : []).filter(function (l) { return l && String(l.item || "").trim(); });
  const typedOnly = function () {
    return ed.workDays == null ? null : withEdit({ version: 1, laborHours: 0, crew: Math.max(1, Math.round(num(s.crew)) || 1), dailyHours: num(s.dailyHours) || 8, workDays: ed.workDays, waitDays: 0, totalDays: 0, waits: [], sections: [] }, ed);
  };
  if (!labor.length) return typedOnly();
  const hourLines = labor.filter(function (l) { return HOUR_UNIT.test(String(l.unit || "").trim()) && num(l.rate) > 0; });
  const avgRate = hourLines.length ? hourLines.reduce(function (t, l) { return t + num(l.rate); }, 0) / hourLines.length : DEFAULT_RATE;
  const bySection = {};
  let hours = 0;
  labor.forEach(function (l) {
    const h = lineHours(l, avgRate);
    hours += h;
    const k = String(l.section || "Work").trim() || "Work";
    bySection[k] = (bySection[k] || 0) + h;
  });
  if (!(hours > 0)) return typedOnly();
  hours = Math.round(hours * 10) / 10;
  const crew = ed.crew != null ? Math.max(1, Math.round(ed.crew)) : (hours <= num(s.dailyHours) ? 1 : Math.max(1, Math.round(num(s.crew)) || 1));
  const dayCap = crew * Math.max(1, num(s.dailyHours) || 8);
  const workDays = Math.max(0.5, Math.ceil((hours / dayCap) * 2) / 2);
  const text = labor.map(function (l) { return String(l.item || ""); }).join(" | ");
  const waits = [];
  WAITS.forEach(function (w) { if (w.re.test(text) && waits.length < 3) waits.push({ label: w.label, days: w.days }); });
  /* A job of a day or less stays a one-day job: its drying happens between
     the steps that same visit ("it is couple hours job"). */
  const waitDays = workDays <= 1 ? 0 : waits.reduce(function (t, w) { return t + w.days; }, 0);
  const sections = Object.keys(bySection).map(function (k) { return { name: k, hours: Math.round(bySection[k] * 10) / 10 }; }).filter(function (x) { return x.hours > 0; });
  return withEdit({ version: 1, laborHours: hours, crew: crew, dailyHours: num(s.dailyHours) || 8, workDays: workDays, waitDays: waitDays, totalDays: Math.ceil(workDays + waitDays), waits: waits, sections: sections }, ed);
}

module.exports = { scheduleOf, DEFAULTS, HOUR_UNIT };
