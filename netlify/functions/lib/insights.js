// netlify/functions/lib/insights.js
//
//   "the main brain can learn from my history too if he will analyze what
//    customers accepted, what price for what job was accepted, the brain can
//    learn how long was takes this job from customer access to i mark
//    completed this job and the main brain can see how much i was charged
//    for this job and how long i close it"
//
// WHAT HIS HISTORY SHOWS, worked out from every estimate record. Pure
// arithmetic, no AI: counts, acceptance rate, the accepted prices per kind of
// job (median, lowest, highest), how many days from sent to accepted and from
// accepted to completed, what was paid, the recent accepted jobs, and the
// quotes that were sent and never answered. assistant-learn runs it nightly
// and stores the result; the assistant reads that result on every call, so a
// question about "my usual bathroom price" is answered from his own jobs.
//
// Customer-facing totals only. The internal notes and the markup are not in
// a record's insight, for the same reason they are not in the prompt.

"use strict";

const customerTotals = require("./customer-total");
const DAY = 86400000;

function str(v) { return String(v == null ? "" : v).trim(); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/* "Bathroom Renovation" from "Bathroom Renovation, Water Damage" or from a
   long project title. One short label per kind of job, so the same jobs
   group together. */
function serviceOf(rec) {
  const s = str(rec && rec.request && rec.request.service) || str(rec && rec.estimate && rec.estimate.projectTitle) || "Other";
  return (s.split(/[,;—–(/]| - /)[0] || "Other").trim().slice(0, 40) || "Other";
}
/* ── WHERE THE CUSTOMER IS ───────────────────────────────────────────────
     "in which borough customers was, potentially in this borough customers
      are more reach and potentially they will accept this estimate"
   Read from the address: a ZIP is the surest tell (100xx Manhattan, 112xx
   Brooklyn, 104xx Bronx, 103xx Staten Island, 11[0-1,3-6]xx Queens, 115-119
   Long Island), then borough and neighbourhood names, then NJ. "New York,
   NY" with no ZIP is Manhattan - that is how Manhattan customers write it. */
const BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island", "Long Island", "New Jersey"];
const QUEENS = /\b(astoria|flushing|forest hills|jackson heights|long island city|\blic\b|bayside|rego park|elmhurst|jamaica|woodside|sunnyside|ridgewood|kew gardens|fresh meadows|whitestone|howard beach|ozone park|corona|maspeth|glendale|middle village|college point|douglaston|little neck|far rockaway|rockaway|briarwood|hollis|bellerose|floral park|richmond hill|woodhaven|springfield gardens|laurelton|rosedale|st\.? albans|cambria heights)\b/i;
const LI = /\b(nassau|suffolk|hempstead|garden city|great neck|manhasset|port washington|mineola|valley stream|long beach|lynbrook|oceanside|rockville centre|freeport|massapequa|levittown|hicksville|huntington|babylon|islip|smithtown|bay shore|patchogue|riverhead|montauk|hamptons|southampton|east hampton|westbury|syosset|jericho|plainview|oyster bay|roslyn|glen cove|merrick|bellmore|wantagh|seaford|farmingdale|melville|commack|brentwood|central islip|ronkonkoma|sayville|lake grove|stony brook|port jefferson|setauket)\b/i;
function boroughOf(rec) {
  const a = [rec && rec.customer && rec.customer.address, rec && rec.request && rec.request.address, rec && rec.customer && rec.customer.borough, rec && rec.request && rec.request.borough].map(str).filter(Boolean).join(" ");
  if (!a) return "Unknown";
  const zip = (a.match(/\b(1[01]\d{3})\b/) || [])[1];
  if (zip) {
    const n = Number(zip);
    if (n >= 10001 && n <= 10299) return "Manhattan";
    if (n >= 10301 && n <= 10399) return "Staten Island";
    if (n >= 10401 && n <= 10499) return "Bronx";
    if (n >= 11201 && n <= 11299) return "Brooklyn";
    if ((n >= 11001 && n <= 11199) || (n >= 11351 && n <= 11499) || (n >= 11690 && n <= 11699)) return "Queens";
    if (n >= 11500 && n <= 11999) return "Long Island";
  }
  if (/\bstaten island\b/i.test(a)) return "Staten Island";
  if (/\bbrooklyn\b|\bbklyn\b/i.test(a)) return "Brooklyn";
  if (/\bbronx\b/i.test(a)) return "Bronx";
  if (/\bqueens\b/i.test(a) || QUEENS.test(a)) return "Queens";
  if (/\bmanhattan\b|\bupper (east|west) side\b|\bharlem\b|\btribeca\b|\bsoho\b|\bchelsea\b|\bmidtown\b/i.test(a)) return "Manhattan";
  if (/\bnew jersey\b|\bnj\b|\bjersey city\b|\bhoboken\b/i.test(a)) return "New Jersey";
  if (/\blong island\b/i.test(a) || LI.test(a)) return "Long Island";
  if (/\bnew york\b|\bnyc\b|\bny\b/i.test(a)) return "Manhattan";
  return "Unknown";
}
function days(a, b) {
  const ta = Date.parse(a), tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  /* Whole days, rounded DOWN: "sent 14 days ago" at 14.5 days is 14, not 15. */
  return Math.max(0, Math.floor((tb - ta) / DAY));
}
function median(list) {
  const a = list.filter(function (n) { return Number.isFinite(n); }).sort(function (x, y) { return x - y; });
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}
function money(n) { return "$" + Math.round(num(n)).toLocaleString("en-US"); }
function date(iso) { return str(iso).slice(0, 10); }

function rowOf(rec, now) {
  const est = (rec && rec.estimate) || {};
  let total = 0;
  try { total = num(customerTotals(est, rec).customerTotal); } catch (e) { total = 0; }
  const invoices = Array.isArray(rec.invoices) ? rec.invoices : [];
  const paid = invoices.filter(function (i) { return i && i.status === "paid"; }).reduce(function (s, i) { return s + num(i.amount); }, 0);
  const thread = Array.isArray(rec.thread) ? rec.thread : [];
  const last = thread.length ? thread[thread.length - 1] : null;
  const status = str(rec.status);
  const accepted = !!(rec.acceptedAt || status === "accepted" || status === "completed");
  const declined = !!(rec.declinedAt || status === "declined");
  return {
    ref: str(rec.ref), name: str(rec.customer && rec.customer.name), service: serviceOf(rec), borough: boroughOf(rec), status: status,
    total: total, paid: paid,
    submittedAt: date(rec.submittedAt), sentAt: date(rec.sentAt), acceptedAt: date(rec.acceptedAt), declinedAt: date(rec.declinedAt), completedAt: date(est.completedAt),
    accepted: accepted, declined: declined,
    daysToAccept: rec.sentAt && rec.acceptedAt ? days(rec.sentAt, rec.acceptedAt) : null,
    daysToComplete: rec.acceptedAt && est.completedAt ? days(rec.acceptedAt, est.completedAt) : null,
    daysSinceSent: rec.sentAt ? days(rec.sentAt, now.toISOString()) : null,
    waiting: !!(last && last.from !== "contractor"),
  };
}

/**
 * @param {object[]} records  every estimate record
 * @param {Date} [now]
 */
function buildInsights(records, now) {
  const t = now ? new Date(now) : new Date();
  const rows = (Array.isArray(records) ? records : []).filter(Boolean).map(function (r) { return rowOf(r, t); });

  const acc = rows.filter(function (r) { return r.accepted; });
  const dec = rows.filter(function (r) { return r.declined && !r.accepted; });
  const noAnswer = rows.filter(function (r) { return r.sentAt && !r.accepted && !r.declined; });
  const decided = acc.length + dec.length + noAnswer.length;

  const by = {};
  rows.forEach(function (r) {
    const b = by[r.service] || (by[r.service] = { service: r.service, count: 0, sent: 0, accepted: 0, declined: 0, totals: [], toAccept: [], toComplete: [] });
    b.count++;
    if (r.sentAt) b.sent++;
    if (r.accepted) { b.accepted++; if (r.total > 0) b.totals.push(r.total); if (r.daysToAccept != null) b.toAccept.push(r.daysToAccept); if (r.daysToComplete != null) b.toComplete.push(r.daysToComplete); }
    if (r.declined && !r.accepted) b.declined++;
  });
  const services = Object.keys(by).map(function (k) {
    const b = by[k];
    const settled = b.accepted + b.declined + (rows.filter(function (r) { return r.service === k && r.sentAt && !r.accepted && !r.declined; }).length);
    return {
      service: b.service, count: b.count, sent: b.sent, accepted: b.accepted, declined: b.declined,
      acceptRate: settled ? Math.round(100 * b.accepted / settled) : null,
      medianAccepted: median(b.totals), lowestAccepted: b.totals.length ? Math.min.apply(null, b.totals) : null, highestAccepted: b.totals.length ? Math.max.apply(null, b.totals) : null,
      medianDaysToAccept: median(b.toAccept), medianDaysToComplete: median(b.toComplete),
    };
  }).sort(function (a, b) { return b.count - a.count; }).slice(0, 15);

  /* Per borough: the same counts and accepted prices, so "Manhattan says
     yes to $20k bathrooms, Queens does not" is a thing it can read off. */
  const byB = {};
  rows.forEach(function (r) {
    const b = byB[r.borough] || (byB[r.borough] = { borough: r.borough, count: 0, sent: 0, accepted: 0, declined: 0, noAnswer: 0, totals: [], sentTotals: [] });
    b.count++;
    if (r.sentAt) { b.sent++; if (r.total > 0) b.sentTotals.push(r.total); }
    if (r.accepted) { b.accepted++; if (r.total > 0) b.totals.push(r.total); }
    else if (r.declined) b.declined++;
    else if (r.sentAt) b.noAnswer++;
  });
  const boroughs = Object.keys(byB).map(function (k) {
    const b = byB[k];
    const settled = b.accepted + b.declined + b.noAnswer;
    return {
      borough: b.borough, count: b.count, sent: b.sent, accepted: b.accepted, declined: b.declined, noAnswer: b.noAnswer,
      acceptRate: settled ? Math.round(100 * b.accepted / settled) : null,
      medianAccepted: median(b.totals), highestAccepted: b.totals.length ? Math.max.apply(null, b.totals) : null,
      medianSent: median(b.sentTotals),
      acceptedValue: b.totals.reduce(function (s, n) { return s + n; }, 0),
    };
  }).sort(function (a, b) { return b.count - a.count; });

  const recentAccepted = acc.filter(function (r) { return r.total > 0; })
    .sort(function (a, b) { return (b.acceptedAt || "").localeCompare(a.acceptedAt || ""); }).slice(0, 15)
    .map(function (r) { return { ref: r.ref, name: r.name, service: r.service, borough: r.borough, total: r.total, acceptedAt: r.acceptedAt, daysToAccept: r.daysToAccept, completedAt: r.completedAt, daysToComplete: r.daysToComplete, paid: r.paid }; });

  const followUp = noAnswer.filter(function (r) { return r.daysSinceSent != null && r.daysSinceSent >= 5; })
    .sort(function (a, b) { return b.daysSinceSent - a.daysSinceSent; }).slice(0, 15)
    .map(function (r) { return { ref: r.ref, name: r.name, service: r.service, total: r.total, daysSinceSent: r.daysSinceSent, waiting: r.waiting }; });

  return {
    at: t.toISOString(),
    records: rows.length, sent: rows.filter(function (r) { return r.sentAt; }).length,
    accepted: acc.length, declined: dec.length, noAnswer: noAnswer.length,
    acceptRate: decided ? Math.round(100 * acc.length / decided) : null,
    acceptedValue: acc.reduce(function (s, r) { return s + r.total; }, 0),
    paidTotal: rows.reduce(function (s, r) { return s + r.paid; }, 0),
    medianDaysToAccept: median(acc.map(function (r) { return r.daysToAccept; })),
    medianDaysToComplete: median(acc.map(function (r) { return r.daysToComplete; })),
    services: services, boroughs: boroughs, recentAccepted: recentAccepted, followUp: followUp,
  };
}

const INSIGHTS_CHARS = 5500;
function insightsText(ins) {
  if (!ins || typeof ins !== "object" || !ins.records) return "";
  const L = [];
  L.push("As of " + date(ins.at) + ": " + ins.records + " estimates, " + ins.sent + " sent, " + ins.accepted + " accepted, " + ins.declined + " declined, " + ins.noAnswer + " sent with no answer"
    + (ins.acceptRate != null ? ". Acceptance " + ins.acceptRate + "%" : "")
    + ". Accepted work " + money(ins.acceptedValue) + ", paid so far " + money(ins.paidTotal) + "."
    + (ins.medianDaysToAccept != null ? " Typical days from sent to accepted: " + ins.medianDaysToAccept + "." : "")
    + (ins.medianDaysToComplete != null ? " From accepted to completed: " + ins.medianDaysToComplete + "." : ""));
  if (ins.services && ins.services.length) {
    L.push("BY KIND OF JOB (kind | estimates | accepted / declined / rate | accepted price median [lowest-highest] | days to accept | days to finish):");
    ins.services.forEach(function (s) {
      L.push("  " + s.service + " | " + s.count + " | " + s.accepted + " / " + s.declined + (s.acceptRate != null ? " / " + s.acceptRate + "%" : "")
        + " | " + (s.medianAccepted != null ? money(s.medianAccepted) + " [" + money(s.lowestAccepted) + "-" + money(s.highestAccepted) + "]" : "-")
        + " | " + (s.medianDaysToAccept != null ? s.medianDaysToAccept : "-") + " | " + (s.medianDaysToComplete != null ? s.medianDaysToComplete : "-"));
    });
  }
  if (ins.boroughs && ins.boroughs.length) {
    L.push("BY BOROUGH (where | estimates | accepted / declined / no answer / rate | accepted price median, highest | median price of what was sent | accepted work):");
    ins.boroughs.forEach(function (b) {
      L.push("  " + b.borough + " | " + b.count + " | " + b.accepted + " / " + b.declined + " / " + b.noAnswer + (b.acceptRate != null ? " / " + b.acceptRate + "%" : "")
        + " | " + (b.medianAccepted != null ? money(b.medianAccepted) + ", " + money(b.highestAccepted) : "-")
        + " | " + (b.medianSent != null ? money(b.medianSent) : "-") + " | " + money(b.acceptedValue));
    });
  }
  if (ins.recentAccepted && ins.recentAccepted.length) {
    L.push("RECENT ACCEPTED JOBS (ref | customer | kind | price | accepted | days to accept | completed | paid):");
    ins.recentAccepted.forEach(function (r) {
      L.push("  " + [r.ref, r.name, r.service + (r.borough ? ", " + r.borough : ""), money(r.total), r.acceptedAt || "-", r.daysToAccept != null ? r.daysToAccept + "d" : "-", r.completedAt ? r.completedAt + (r.daysToComplete != null ? " (" + r.daysToComplete + "d)" : "") : "not yet", money(r.paid)].join(" | "));
    });
  }
  if (ins.followUp && ins.followUp.length) {
    L.push("SENT AND NEVER ANSWERED, oldest first (ref | customer | kind | price | days since sent):");
    ins.followUp.forEach(function (r) {
      L.push("  " + [r.ref, r.name, r.service, money(r.total), r.daysSinceSent + "d" + (r.waiting ? " (they wrote last - HE owes a reply)" : "")].join(" | "));
    });
  }
  const text = L.join("\n");
  return text.length > INSIGHTS_CHARS ? text.slice(0, INSIGHTS_CHARS) + "\n  ... (cut)" : text;
}

module.exports = { buildInsights, insightsText, serviceOf, boroughOf, days, median, rowOf, BOROUGHS };
