/* ============================================================================
   lib/estimator-brain.js — ONE brain. The chat IS the estimator.
   ----------------------------------------------------------------------------
   "I need direct communication to the main AI brain ... I need brain and not
    just programed calculations to generate regular texts for everything! I
    need real smart brain who can understand my mistakes, understand my
    missing, can think and can polish my mistakes" (Oct 8 2026)

   Before: the chat could only talk, and Regenerate was a second AI call that
   could only pick price-book ids; every customer sentence was a fixed book
   text. Two brains, one in a cage. Now every chat message goes to ONE call
   that sees everything (request, photos, customer messages, his notes, the
   whole chat, the current lines AND scope, the price book) and may:
     - talk back: what it understood, the mistakes / missing pieces it sees;
     - write the WHOLE estimate itself: lines, quantities, rates, and the scope
       of work in his words. That goes to estimateV5Pending: the same change
       list, Apply and Undo he already uses. Nothing moves before Apply.
   Code still guards what must never break (validate()):
     - his own lines (byHand) and his own rates (rateByHand) come back exactly;
     - a price-book line uses the book rate (cost before markup), unless he set it;
     - anything the brain prices itself is marked aiPriced and listed for him;
     - his markup stays; no "licensed", no gas appliances, no prices in texts.
   ============================================================================ */
'use strict';
const BOOK = require('./price-book-v5');
const { TRADE_SENSE } = require('./trade-sense');

const A = (v) => (Array.isArray(v) ? v : []);
const s = (v) => (v == null ? '' : String(v)).trim();
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const BAN = /\blicen[cs]ed?\b|\btv\b|\boven\b|\brange\b(?!\s*hood)|\bcooktop\b|\bgas (line|appliance|stove|hook)/i;
const noMoney = (t) => s(t).replace(/\blicen[cs]ed?\b/gi, 'fully insured').replace(/\$\s?\d[\d,]*(\.\d+)?/g, '').replace(/\s{2,}/g, ' ').trim();
const norm = (v) => s(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function bookText() {
  return BOOK.ITEMS.map((i) => {
    const mats = A(i.mat).map((m) => `${m[0]} ${m[1]}/${i.unit} @ $${m[3]}/${m[2]}`).join('; ');
    return `${i.id} | ${i.trade} | ${i.name} | labor $${i.labor}/${i.unit}, min ${i.min || 1}, ${i.hours} crew-hr/${i.unit}${mats ? ' | materials: ' + mats : ''}`;
  }).join('\n');
}

function currentOf(e) {
  e = e || {};
  const ln = (k) => A(e[k]).map((l) => ({ section: l.section, item: s(l.item).slice(0, 140), qty: Number(l.qty) || 0, unit: l.unit, rate: Number(l.rate) || 0,
    bookId: l.bookId || undefined, his: l.byHand ? 'his own line - keep exactly' : l.rateByHand ? 'his own rate - keep the rate' : undefined, aiPriced: l.aiPriced || undefined }));
  const scope = A(e.manualCustomerScopeDraft && e.manualCustomerScopeDraft.services);
  return { projectTitle: e.projectTitle, summary: e.summary || e.overview, markupPct: e.markupPct, labor: ln('labor'), materials: ln('materials'),
    services: scope.map((x) => ({ name: x.name, included: x.included, excluded: x.excluded, supplied: x.supplied })),
    workSteps: A(e.workSteps).map((w) => ({ title: w.title, text: w.text })), timelineText: e.timelineText, total: e.totals && e.totals.total };
}

function prompt(job, current, history, msg, nPhotos) {
  return `${TRADE_SENSE}

You are THE estimator of Sani Building Corp (renovation contractor, NYC / Long Island, fully insured, Home Depot Pro). There is no other brain: what you write here IS the estimate and the scope of work the customer reads and signs. You are talking privately with the owner, an experienced contractor, usually on his phone. The customer never sees this chat.

THINK LIKE A SENIOR ESTIMATOR, NOT A FORM:
- Read everything below first: the request, the photos, customer emails and messages, his notes, the whole chat and the current estimate.
- Understand the real job. Picture the room. Use the standard sizes; never ask for a size they already answer.
- Check HIS plan: catch mistakes, contradictions and missing pieces (e.g. tile to the ceiling but cement board only to 6 ft; glass door missing; paint included but he said the walls are not touched; quantities that do not match the room; a step in the wrong order). Say them plainly and fix them in the estimate, or ask if you truly cannot decide.
- Polish his words into clear, professional customer English, in "we" language, keeping his meaning and his order.

WHEN TO CHANGE THE ESTIMATE ("change"):
- He asks to build / generate / regenerate / update / change / add / remove / fix something, or he answers your question and the plan is clear -> return "change" with the COMPLETE estimate (every line, the whole scope), not only the difference.
- He only asks a question or explains why -> "change": null and answer.
- If one detail is unknown, still build with your best assumption and say the assumption in "reply".

PRICES (all rates are Sani's COST before markup; code adds his markup):
- A price-book item: use its book rate and its materials (qty per unit x quantity), and put its "bookId".
- A line marked "his own line" comes back exactly as it is. "his own rate": keep that rate.
- Work the book does not have: give your best realistic NYC subcontractor cost, set "priced":"ai". Never leave a line at 0.
- Do not add protection / cleanup twice; use the book items protect and cleanup (or setup_small for a small job) once.
- Material lines are only things Sani buys. Customer-supplied items: no material line; say it in "supplied".

SCOPE OF WORK (what the customer signs):
- "workSteps": the job step by step in the order it happens, from HIS description and the chat, polished. Only work he described or that his plan clearly needs. A wall, floor or fixture he said stays is in no step.
- EVERY service (also Painting, Whole Project) gets at least one step (with its "service") and at least one "excluded" line.
- One protection line and one cleanup/disposal line for the whole job; never a second disposal or bags line inside a service.
- Plumbing: when the shower drain sits in a different spot than the old tub drain, say so and price moving the drain line; never assume it ties in for free.
- "dayPlan": one line per day for the customer, as many lines as workDays, in work order; put curing overnight with the step it follows (e.g. "Shower base, cement board, waterproofing (cures overnight)").
- "workDays": the whole job in days, curing included. If he told the customer a number of days, use his number.
- "priceBasis": 2-5 short lines the CUSTOMER reads under "This price is based on", in we-language (e.g. "Your bathroom is about 5 x 8 ft with an 8 ft ceiling"). Never write "owner", "photos show", "answered" or anything from his private notes.
- "services": per service, "included" (short lines the customer reads), "excluded" (his exclusions + honest limits), "supplied" (what the customer provides).
- "summary": 2-3 sentences for the customer: what we do and the result. "timelineText": realistic, e.g. "About 5 working days".
- Never write a price in any text. Never say "licensed". No gas work, no TV mounting. No options or alternatives.

HOW TO TALK ("reply"): plain contractor talk, short. If you changed the estimate, say in 2-5 short lines what you changed and why, and any mistake or missing piece you caught. At most 2 questions, only when the answer changes real money. No markdown.

PRICE BOOK (id | trade | name | labor | materials):
${bookText()}

JOB (request, answers, customer messages, his notes):
${JSON.stringify(job).slice(0, 16000)}

CURRENT ESTIMATE (what the customer would get now):
${JSON.stringify(current).slice(0, 16000)}

CHAT SO FAR:
${history || '(new chat)'}
OWNER: ${msg}${nPhotos ? `\n[He attached ${nPhotos} new photo(s) with this message: the first image(s) above. Look closely.]` : ''}

Return JSON only:
{"reply":"","chips":["0-3 short tap replies he might send next"],
 "change": null | {"projectTitle":"","summary":"","timelineText":"","workDays":0,"dayPlan":[{"day":1,"text":"what we do that day, short"}],"priceBasis":["we-language line the customer reads"],
   "services":[{"name":"Bathroom","included":[""],"excluded":[""],"supplied":[""]}],
   "workSteps":[{"service":"which service this step belongs to","title":"2-4 words","text":"1-2 sentences"}],
   "labor":[{"section":"Bathroom","item":"","qty":1,"unit":"job","rate":0,"bookId":"","priced":"book|his|ai","hours":0}],
   "materials":[{"section":"Bathroom","item":"","qty":1,"unit":"ea","rate":0,"bookId":"","priced":"book|his|ai"}]}}`;
}

/* The law, in code. Returns { estimate, warnings } or null when there is no change. */
function validate(change, previous) {
  if (!change || typeof change !== 'object') return null;
  const prev = previous || {};
  const warnings = [];
  const line = (l, kind) => {
    const item = noMoney(l && l.item).slice(0, 140);
    if (!item || BAN.test(item)) return null;
    let qty = Number(l.qty); if (!Number.isFinite(qty) || qty <= 0) qty = 1;
    let rate = Number(l.rate); if (!Number.isFinite(rate) || rate < 0) rate = 0;
    const out = { section: s(l.section).slice(0, 60) || 'Project', item, qty: r2(qty), unit: s(l.unit).slice(0, 12) || 'ea', rate: r2(rate), engine: 'brain' };
    const b = BOOK.byId[s(l.bookId)];
    if (b) {
      out.bookId = b.id;
      if (kind === 'labor' && b.unit === out.unit) { out.rate = b.labor; out.qty = Math.max(out.qty, b.min || 0); if (b.hours) out.hours = r2(b.hours * out.qty); }
      if (kind === 'materials') { const m = A(b.mat).find((x) => norm(x[0]) === norm(item)); if (m) { out.rate = m[3]; if (m[4]) out.supplyKey = m[4]; } }
    } else if (s(l.priced) !== 'his') {
      out.aiPriced = true;
      warnings.push('AI priced, please check: ' + item + ' ($' + Math.round(out.qty * out.rate).toLocaleString('en-US') + ')');
    }
    if (kind === 'labor' && !out.hours && Number(l.hours) > 0) out.hours = r2(Number(l.hours));
    if (out.rate === 0) { out.needsPrice = true; warnings.push('Needs your price: ' + item); }
    return out;
  };
  const est = { labor: A(change.labor).map((l) => line(l, 'labor')).filter(Boolean).slice(0, 80), materials: A(change.materials).map((l) => line(l, 'materials')).filter(Boolean).slice(0, 80) };
  if (!est.labor.length && !est.materials.length) return null;
  /* One disposal line for the whole job: drop any second bags/disposal line. */
  const isDisp = (l) => /\b(disposal|debris bags|contractor bags|dumpster)\b/i.test(l.item) && !/clean/i.test(l.item);
  const disp = est.materials.filter(isDisp);
  if (disp.length > 1) { const keep = disp.find((l) => /whole project/i.test(l.section)) || disp[0]; est.materials = est.materials.filter((l) => !isDisp(l) || l === keep || l.byHand); }
  /* His own lines and rates always come back. */
  ['labor', 'materials'].forEach((k) => {
    A(prev[k]).filter((h) => h && (h.byHand || h.rateByHand)).forEach((h) => {
      const i = est[k].findIndex((l) => norm(l.item) === norm(h.item) && norm(l.section) === norm(h.section))
        >= 0 ? est[k].findIndex((l) => norm(l.item) === norm(h.item) && norm(l.section) === norm(h.section))
        : (h.bookId ? est[k].findIndex((l) => l.bookId === h.bookId && norm(l.section) === norm(h.section)) : -1);
      if (h.byHand) { if (i >= 0) est[k][i] = Object.assign({}, h); else est[k].push(Object.assign({}, h)); }
      else if (i >= 0) Object.assign(est[k][i], { rate: h.rate, rateByHand: true, aiPriced: undefined });
    });
  });
  const txt = (v, n) => noMoney(v).slice(0, n);
  const list = (a, n) => A(a).map((x) => txt(x, 200)).filter((x) => x && !BAN.test(x)).slice(0, n);
  const services = A(change.services).filter((x) => x && s(x.name)).slice(0, 8).map((x) => ({ name: txt(x.name, 60), included: list(x.included, 20), excluded: list(x.excluded, 8), supplied: list(x.supplied, 10) }));
  const steps = A(change.workSteps).filter((w) => w && s(w.text) && !BAN.test(s(w.title) + ' ' + s(w.text))).slice(0, 16)
    .map((w) => ({ service: (services.find((x) => norm(x.name) === norm(w.service)) || services[0] || {}).name || est.labor[0].section, title: txt(w.title, 40) || 'Step', text: txt(w.text, 360), fromBrain: true, cure: 0 }));
  const summary = txt(change.summary, 600);
  Object.assign(est, {
    projectTitle: txt(change.projectTitle, 90) || prev.projectTitle,
    summary, overview: summary,
    timelineText: txt(change.timelineText, 160) || prev.timelineText,
    workSteps: steps.length ? steps : A(prev.workSteps),
    manualCustomerScopeDraft: { services: services.length ? services : A(prev.manualCustomerScopeDraft && prev.manualCustomerScopeDraft.services) },
    saniSupplies: [...new Set(est.materials.map((m) => m.item))].slice(0, 12),
    customerSupplied: services.flatMap((x) => x.supplied.map((it) => ({ section: x.name, item: it, note: 'Purchase price excluded; installation included' }))),
    priceBasis: list(change.priceBasis, 8).length ? list(change.priceBasis, 8) : A(prev.priceBasis).filter((x) => !/\b(owner|photos show|assumed|answered)\b/i.test(String(x))),
    scheduleEdit: Number(change.workDays) > 0 && Number(change.workDays) <= 60 ? Object.assign({}, prev.scheduleEdit, { workDays: Math.round(Number(change.workDays)) }) : prev.scheduleEdit,
    dayPlan: A(change.dayPlan).map((d) => ({ day: Number(d && d.day) || 0, text: txt(d && d.text, 140) })).filter((d) => d.text && !BAN.test(d.text)).slice(0, 30).length ? A(change.dayPlan).map((d) => ({ day: Number(d && d.day) || 0, text: txt(d && d.text, 140) })).filter((d) => d.text && !BAN.test(d.text)).slice(0, 30) : A(prev.dayPlan),
    showLaborCost: undefined, showMaterialsCost: undefined, displayMode: undefined,
    warnings, brainAt: new Date().toISOString(),
  });
  return est;
}

module.exports = { prompt, validate, currentOf, bookText };
