// netlify/functions/lib/crew-job.js
//
// THE CREW JOB SHEET. What a worker sees on his phone when the owner taps
// "Send to crew": where, when, who, what the building needs, the photos, and
// the steps in short simple words with HOW to do each one. Tools and
// materials as checklists. NEVER prices, profit or the owner's private notes.
// The customer's phone only when the owner ticked "Share customer phone".
//
// Pure (no network): tested in crew-job.test.js.

"use strict";

const C = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n || 400);
const A = (v) => (Array.isArray(v) ? v : []);

function firstName(n) { return C(n, 80).split(" ")[0] || ""; }

/* Steps for the crew: the brain's crewSteps when it wrote them, otherwise
   each task with its "how" note (older plans). */
function stepsOf(plan) {
  const p = plan || {};
  const cs = A(p.crew && p.crew.steps).map((s) => ({ step: C(s && (s.step || s.title), 160), how: C(s && (s.how || s.text), 500) })).filter((s) => s.step);
  if (cs.length) return cs.slice(0, 15);
  return A(p.tasks).map((t) => ({ step: C(t && t.task, 160), how: C(t && t.note, 500) })).filter((s) => s.step).slice(0, 15);
}

/**
 * @param {object} booking   the Supabase bookings row
 * @param {object} plan      the brain plan (may be null)
 * @param {object} job       { sharePhone, crewName, appointmentDate, appointmentTime, durationText }
 */
function sheet(booking, plan, job) {
  const b = booking || {}, p = plan || {}, j = job || {}, a = b.answers || {};
  const ag = A(b.agreements)[0] || {};
  const building = [a.access, a.building_needs].map((x) => C(x, 300)).filter(Boolean);
  return {
    ref: C(b.ref, 40),
    title: C(p.title || b.service_name || "Handyman job", 120),
    /* What kind of job, in plain words, so the worker knows it at a glance. */
    jobType: C(p.crew && p.crew.jobType || b.service_name, 120),
    explain: C(p.crew && p.crew.explain || (p.customer && p.customer.scope), 1200),
    checks: A(p.crew && p.crew.checks).map((x) => C(x, 200)).filter(Boolean).slice(0, 10),
    crewName: C(j.crewName, 60),
    customer: firstName(b.customer_name),
    phone: j.sharePhone ? C(b.customer_phone, 40) : "",
    address: C(b.customer_address, 200),
    date: C(j.appointmentDate || ag.appointment_date || b.preferred_date, 40),
    time: C(j.appointmentTime || ag.appointment_time || b.preferred_time, 40),
    hours: C(j.durationText || p.visitHours || ag.duration_text, 40),
    building,
    customerSaid: C(b.customer_description, 1500),
    photos: A(b.photo_urls).filter((u) => /^https:\/\//.test(u)).slice(0, 10),
    steps: stepsOf(p),
    tools: A(p.tools).map((x) => C(x, 120)).filter(Boolean),
    materials: A(p.materials).map((x) => C(x, 160)).filter(Boolean),
    warnings: A(p.warnings).map((x) => C(x, 220)).filter(Boolean),
    notIncluded: A(p.customer && p.customer.notIncluded).map((x) => C(x, 200)).filter(Boolean),
  };
}

/* The text he sends from his phone (Messages or WhatsApp). */
function message(sh, url) {
  const when = [sh.date, sh.time].filter(Boolean).join(" ");
  return "Sani job: " + sh.title + (when ? " · " + when : "") + (sh.address ? " · " + sh.address : "") + "\nEverything you need is here: " + url;
}

module.exports = { sheet, message, stepsOf };
