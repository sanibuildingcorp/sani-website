/* ============================================================================
   lib/estimate-engine-v5.js — turns a READING into an estimate. No AI here.
   ----------------------------------------------------------------------------
   reading (from lib/job-reader-v5.js, validated):
     { projectTitle, summary, services:[{ name, items:[{id,qty,note}], custom:[{name,qty,unit,note}],
       exclusions:[] }], customerSupplies:[supplyKey], site:{ floor, elevator, coi, buildingType },
       facts:[{id,text,effect,on}], questions:[], status, startDate }
   Same reading in -> same estimate out. Every time.
   Output uses the field names dashboard.html / quote.html already read.
   ============================================================================ */
'use strict';
const BOOK = require('./price-book-v5');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fill = (t, q, u) => String(t || '').replace(/\{q\}/g, fmtQty(q)).replace(/\{u\}/g, u || '');
function fmtQty(q) { q = Number(q) || 0; return q % 1 ? q.toFixed(1) : String(q); }
const BANNED = [/\blicen[cs]ed?\b/gi, /\btv\b[^.]*\b(mount|install)/gi];
function clean(s) { let t = String(s || '').trim(); BANNED.forEach((re) => { t = t.replace(re, ''); }); return t.replace(/\$\s?\d[\d,]*(\.\d+)?/g, '').replace(/\s{2,}/g, ' ').trim(); }
function uniq(a) { const s = new Set(); return a.filter((x) => { const k = String(x).toLowerCase().replace(/[^a-z0-9]/g, ''); if (!k || s.has(k)) return false; s.add(k); return true; }); }

function markupFor(cost) {
  const m = BOOK.MARKUP;
  if (cost <= m[0][0]) return m[0][1];
  for (let i = 1; i < m.length; i++) {
    if (cost <= m[i][0]) { const [c0, p0] = m[i - 1], [c1, p1] = m[i]; return p0 + (p1 - p0) * (cost - c0) / (c1 - c0); }
  }
  return m[m.length - 1][1];
}

function build(reading, opts) {
  opts = opts || {};
  const R = reading || {}, supplied = new Set((R.customerSupplies || []).map(String));
  const labor = [], materials = [], workSteps = [], customerSupplied = [], finishes = [], needs = [], warnings = [];
  const services = [];
  let hours = 0, cureDays = 0;
  const svcList = (R.services || []).filter((s) => s && s.name);
  const multi = svcList.length > 1;
  const wholeIds = new Set(['protect', 'cleanup', 'setup_small']);

  // Whole-project lines go once, under the main service when single-service (never "General").
  const projectLines = [{ id: 'protect', qty: 1 }, { id: 'cleanup', qty: 1 }];

  function addItem(svcName, it, isProject) {
    const b = BOOK.byId[it.id]; if (!b) return;
    const qty = Math.max(Number(it.qty) || 0, b.min || 0);
    const section = isProject ? (multi ? 'Whole Project' : svcName) : svcName;
    labor.push({ section, item: b.name, qty, unit: b.unit, rate: b.labor, bookId: b.id, engine: 'v5' });
    hours += (b.hours || 0) * qty;
    cureDays += b.cure || 0;
    (b.mat || []).forEach(([name, per, unit, cost, key, isFinish]) => {
      const q = Math.max(1, Math.ceil(per * qty * 100) / 100);
      const mq = unit === 'sf' || unit === 'lf' ? Math.ceil(per * qty) : Math.ceil(per * qty);
      const byOwner = key && supplied.has(key);
      /* Customer supplies it: no material line at all (no $0 rows); the labor stays. */
      if (!byOwner) materials.push({ section, item: name, qty: Math.max(1, mq || q), unit, rate: cost, bookId: b.id, supplyKey: key || null, engine: 'v5' });
      if (isFinish) {
        const f = { section, item: name, key, supplier: byOwner ? 'customer' : 'sani', status: byOwner ? 'Customer delivers by date' : 'To choose by date', where: section };
        finishes.push(f);
        if (byOwner) customerSupplied.push({ section, item: name, note: 'Purchase price excluded; installation included' });
      }
    });
    if (b.step) workSteps.push({ service: section, title: b.step[0], text: clean(fill(b.step[1], qty, b.unit)), bookId: b.id, cure: b.cure || 0 });
    (b.needs || []).forEach((n) => needs.push(n));
    return { b, qty };
  }

  svcList.forEach((s, si) => {
    const name = clean(s.name) || 'Project';
    const inc = [], not = [];
    (s.items || []).forEach((it) => {
      if (wholeIds.has(it.id)) return;
      const r = addItem(name, it, false); if (!r) { warnings.push('Unknown price-book item skipped: ' + it.id); return; }
      inc.push(clean(fill(r.b.inc, r.qty, r.b.unit)));
      (r.b.not || []).forEach((x) => not.push(x));
    });
    (s.custom || []).forEach((c) => {   // things the book does not have: NO price from AI
      labor.push({ section: name, item: clean(c.name), qty: Number(c.qty) || 1, unit: c.unit || 'job', rate: 0, needsPrice: true, engine: 'v5' });
      inc.push(clean(c.name));
      warnings.push('Needs your price: ' + clean(c.name));
    });
    (s.exclusions || []).forEach((x) => not.unshift(clean(x)));   // customer's own words first
    services.push({ name, included: uniq(inc), supplied: [], excluded: uniq(not).slice(0, 5) });
  });

  const smallWork = hours < 6;   // under ~6 crew-hours: one light setup line, not full protection + cleanup
  if (svcList.length) (smallWork ? [{ id: 'setup_small', qty: 1 }] : projectLines).forEach((p) => addItem(services[0].name, p, true));
  if (multi) services.push({ name: 'Whole Project', included: ['Protection of floors, hallway and elevator', 'Daily cleanup, debris removal and final cleaning'], supplied: [], excluded: [] });

  // Access adders
  const site = R.site || {};
  const floor = Number(site.floor) || 0;
  if (floor > 2 && site.elevator === false) {
    labor.push({ section: multi ? 'Whole Project' : (services[0] && services[0].name), item: 'Walk-up carrying, floor ' + floor, qty: floor - 2, unit: 'floor', rate: BOOK.ACCESS.walkupPerFloor, engine: 'v5' });
  }
  if (site.coi) needs.unshift('Send our insurance certificate (COI) request to your building management — we provide it the same day');
  if (site.elevator) needs.push('Reserve the service elevator for the first day');
  needs.push('Clear the work area of personal items before we start');
  finishes.filter((f) => f.supplier === 'customer').forEach((f) => needs.push(f.item + ' on site before we start'));

  services.forEach((sv) => { sv.supplied = uniq(customerSupplied.filter((c) => c.section === sv.name).map((c) => c.item)); });
  // Sort steps: whole-project protect first, cleanup last
  const first = workSteps.filter((s) => s.bookId === 'protect'), last = workSteps.filter((s) => s.bookId === 'cleanup' || s.bookId === 'setup_small');
  const mid = workSteps.filter((s) => !['protect', 'cleanup', 'setup_small'].includes(s.bookId));
  const steps = first.concat(mid, last);

  // Money
  const lab = labor.reduce((a, l) => a + l.qty * l.rate, 0), mat = materials.reduce((a, l) => a + l.qty * l.rate, 0);
  const cost = lab + mat;
  const markupPct = opts.markupPct != null ? Number(opts.markupPct) : Math.round(markupFor(cost) * 1000) / 10;
  let total = cost * (1 + markupPct / 100);
  /* No price floor or ceiling (his rule). */

  // Timeline (code, not AI)
  const workDays = Math.max(0.5, Math.ceil((hours / (BOOK.CREW * BOOK.DAY_HOURS)) * 2) / 2);
  const calendarDays = Math.ceil(workDays + cureDays);
  const timelineText = workDays <= 1 && !cureDays
    ? `About ${Math.max(2, Math.round(hours))} hours of work, done in one day.`
    : `About ${fmtQty(workDays)} working day${workDays > 1 ? 's' : ''}${cureDays ? ` plus ${cureDays} day${cureDays > 1 ? 's' : ''} of drying/curing` : ''} — about ${calendarDays} day${calendarDays > 1 ? 's' : ''} in total.`;

  const smallJob = total < 1500;
  const projectWide = smallJob ? [] : ['Permits, if your building requires them', 'Hidden damage found when opening walls or floors — we stop, show you, and give a written price first'];

  return {
    docVersion: 4, engine: BOOK.VERSION,
    projectTitle: clean(R.projectTitle) || services.map((s) => s.name).filter((n) => n !== 'Whole Project').join(' & '),
    summary: clean(R.summary),
    labor: labor.map((l) => Object.assign(l, { rate: r2(l.rate) })),
    materials: materials.map((l) => Object.assign(l, { rate: r2(l.rate) })),
    markupPct, customerSupplied, finishes,
    workSteps: steps, customerNeeds: uniq(needs).slice(0, 6),
    exclusions: projectWide,
    manualCustomerScopeDraft: { services },
    schedule: { workDays, cureDays, calendarDays, hours: r2(hours), crew: BOOK.CREW, workHours: BOOK.WORK_HOURS_TEXT },
    timelineText, smallJob,
    clarificationQuestions: (R.questions || []).slice(0, 3),
    estimateStatus: R.status || 'READY',
    totals: { labor: r2(lab), materials: r2(mat), cost: r2(cost), total: r2(total), profit: r2(total - cost) },
    warnings, v5Reading: R,
  };
}

/* Chat update: rebuild from the NEW reading, then put back everything he did by hand.
   Returns the list of changes so the dashboard can show Apply / Cancel. */
function update(prevEstimate, newReading, opts) {
  const prev = prevEstimate || {};
  /* His markup stays his: an estimate that already has a markup keeps it. */
  const hasMarkup = prev.markupPct != null && ((prev.labor || []).length || (prev.materials || []).length);
  const next = build(newReading, Object.assign({ markupPct: hasMarkup ? prev.markupPct : undefined }, opts));
  ['labor', 'materials'].forEach((k) => {
    const hand = (prev[k] || []).filter((l) => l && (l.byHand || l.rateByHand));
    hand.forEach((h) => {
      /* A book line he edited REPLACES the rebuilt book line (never charged twice). */
      const i = next[k].findIndex((l) => !l.byHand && ((h.bookId && l.bookId === h.bookId && (l.item === h.item || l.section === h.section)) || (norm(l.item) === norm(h.item) && norm(l.section) === norm(h.section))));
      /* byHand (he typed the line) keeps his whole line; rateByHand keeps only his rate. */
      if (i >= 0) next[k][i] = h.byHand ? Object.assign({}, h) : Object.assign(next[k][i], { rate: h.rate, rateByHand: true });
      else next[k].push(Object.assign({}, h));
    });
  });
  // keep hand-edited text
  if (prev.summaryByHand) { next.summary = prev.summary; next.summaryByHand = true; }
  retotal(next);
  const changes = diff(prev, next);
  return { estimate: next, changes };
}

function norm(v) { return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function key(l) { return (l.section || '') + '|' + (l.item || ''); }
function diff(a, b) {
  const out = [];
  ['labor', 'materials'].forEach((k) => {
    const A = new Map((a[k] || []).map((l) => [key(l), l])), B = new Map((b[k] || []).map((l) => [key(l), l]));
    B.forEach((l, id) => { const o = A.get(id);
      if (!o) out.push({ type: 'add', what: l.item, section: l.section, to: l.qty + ' ' + l.unit, money: r2(l.qty * l.rate) });
      else if (o.qty !== l.qty || o.rate !== l.rate) out.push({ type: 'change', what: l.item, section: l.section, from: o.qty + ' ' + o.unit, to: l.qty + ' ' + l.unit, money: r2(l.qty * l.rate - o.qty * o.rate) }); });
    A.forEach((l, id) => { if (!B.has(id)) out.push({ type: 'remove', what: l.item, section: l.section, money: r2(-l.qty * l.rate) }); });
  });
  const ex = (s) => new Set(((s.manualCustomerScopeDraft || {}).services || []).flatMap((x) => x.excluded || []));
  const ea = ex(a), eb = ex(b);
  eb.forEach((x) => { if (!ea.has(x)) out.push({ type: 'add', what: 'Not included: ' + x, money: 0 }); });
  return out;
}

function retotal(e) {
  const lab = (e.labor || []).reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const mat = (e.materials || []).reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const cost = lab + mat, total = cost * (1 + (Number(e.markupPct) || 0) / 100);
  e.totals = { labor: r2(lab), materials: r2(mat), cost: r2(cost), total: r2(total), profit: r2(total - cost) };
  return e;
}
module.exports = { retotal, build, update, diff, markupFor };
