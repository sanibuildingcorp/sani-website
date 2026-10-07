/* ============================================================================
   lib/job-reader-v5.js — the ONLY AI step. It reads; it never prices.
   ----------------------------------------------------------------------------
   Input: the request record (form, answers, description, photos, emails,
   conversation, contractor notes, previous reading on a chat update).
   Output: a READING — which price-book items, how many, who supplies what,
   site facts, customer exclusions, facts learned from the chat, max 3 questions.
   validate() enforces every rule in code (Law 3): unknown ids dropped,
   quantities clamped, prices/hours stripped, banned words removed, cap on
   questions, options removed. The prompt is a request; validate() is the law.
   ============================================================================ */
'use strict';
const BOOK = require('./price-book-v5');

function catalog() {
  return BOOK.ITEMS.filter((i) => i.trade !== 'Whole Project').map((i) => {
    const keys = (i.mat || []).filter((m) => m[4]).map((m) => m[4]);
    return `${i.id} | ${i.trade} | ${i.name} | unit: ${i.unit}${keys.length ? ' | customer can supply: ' + keys.join(', ') : ''}`;
  }).join('\n');
}

function prompt(input, previous) {
  return `You read renovation requests for Sani Building Corp (NYC, fully insured). You DO NOT price. Prices, hours and rates come from the price book in code.

YOUR ONLY JOB: say WHICH price-book items the job needs and HOW MANY, using the ids below.

PRICE BOOK (use these ids exactly):
${catalog()}

RULES
1. Use only ids from the list. If the job needs something not in the list, put it in "custom" with a name, quantity and unit — no price.
2. Quantities must come from the request, the answers, the conversation or the photos' obvious counts (1 toilet, 1 vanity). Areas: use measurements given. If none: bathroom floor 5x8=40 sf, shower walls 75 sf, a room's walls 350 sf, and write the assumption in "facts".
3. A SMALL JOB STAYS SMALL. A repair is priced as a repair. Never add handyman hours as extra time on top of priced items. Never add demolition, rough plumbing, waterproofing or new tile unless the customer asked for that work.
4. Customer-supplied items: put the supply key in customerSupplies. Labor stays; only the material is removed.
5. Customer exclusions ("walls only", "no baseboards") go in that service's "exclusions", close to their own words.
6. Newest message wins. A contractor note beats the customer. Never ask again for something already answered.
7. Never offer options or alternatives. Never mention TV mounting. Never set, install or connect an oven, range, cooktop or any gas appliance. Never use the word "licensed".
8. "questions": at most 3, only when the answer changes the price by real money. If the job is clear, return [].
9. "facts": every fact you used from the conversation/answers, each with what it changes ("effect").
10. Service names = the customer's selected services (e.g. "Bathroom", "Painting"). Never "General".
11. LOOK AT THE PHOTOS. Pick the item that matches what is really there: a toilet with an exposed metal flush pipe / flush valve from the wall (Sloan, Zurn, commercial style) is toilet_flushometer, not toilet. Say what you saw in "facts".
12. "site": read the building answers. "walk-up" / "no elevator" means elevator:false and walkup:true; put the floor number if given. Never ask again about floor or walk-up when the answers already say it.
${previous ? `\nTHIS IS A CHAT UPDATE. Previous reading below. Change ONLY what the new messages change. Keep every other item and quantity exactly the same.\nPREVIOUS READING:\n${JSON.stringify(previous)}\n` : ''}
REQUEST:
${JSON.stringify(input)}

Return JSON only:
{"projectTitle":"","summary":"2-3 plain sentences for the customer: what we will do and the result",
 "services":[{"name":"","items":[{"id":"","qty":0,"note":""}],"custom":[{"name":"","qty":1,"unit":"job","note":""}],"exclusions":[]}],
 "customerSupplies":[],"site":{"floor":0,"elevator":null,"walkup":false,"coi":false,"buildingType":""},
 "facts":[{"text":"","effect":""}],"questions":[],"status":"READY | PRELIMINARY | NEEDS_CLARIFICATION | SITE_VISIT_REQUIRED"}`;
}

const MAXQ = { sf: 3000, lf: 1500, ea: 200, room: 20, hr: 80, job: 3 };
const BAN = /\blicen[cs]ed?\b|\btv\b|\boven\b|\brange\b(?!\s*hood)|\bcooktop\b|\bgas\b|\boption [ab]\b|\balternative\b/i;
const s = (v) => (v == null ? '' : String(v)).trim();

function validate(raw, input) {
  const out = { projectTitle: s(raw && raw.projectTitle).slice(0, 90), summary: s(raw && raw.summary).replace(/\blicen[cs]ed?\b/gi, 'fully insured').replace(/\$\s?\d[\d,]*/g, '').slice(0, 600),
    services: [], customerSupplies: [], site: {}, facts: [], questions: [], status: 'READY', dropped: [] };
  const selected = ((input && input.request && input.request.services) || []).map((x) => s(x));
  (Array.isArray(raw && raw.services) ? raw.services : []).forEach((sv) => {
    let name = s(sv && sv.name); if (!name || /^general$/i.test(name)) name = selected[0] || 'Project';
    const items = [];
    (sv.items || []).forEach((it) => {
      const b = BOOK.byId[s(it && it.id)];
      if (!b || b.trade === 'Whole Project') { out.dropped.push(s(it && it.id)); return; }
      let q = Number(it.qty); if (!Number.isFinite(q) || q <= 0) q = b.min || 1;
      q = Math.min(q, MAXQ[b.unit] || 100);
      const same = items.find((x) => x.id === b.id); if (same) same.qty += q; else items.push({ id: b.id, qty: Math.round(q * 10) / 10, note: s(it.note).slice(0, 140) });
    });
    const custom = (sv.custom || []).filter((c) => s(c && c.name) && !BAN.test(c.name)).slice(0, 5).map((c) => ({ name: s(c.name).slice(0, 90), qty: Number(c.qty) > 0 ? Number(c.qty) : 1, unit: s(c.unit) || 'job', note: s(c.note).slice(0, 140) }));
    const exclusions = (sv.exclusions || []).map(s).filter(Boolean).slice(0, 5);
    /* No padding: handyman hours only when they ARE the job, never on top of priced work. */
    if (items.some((x) => x.id !== 'handyman_hour')) { const h = items.findIndex((x) => x.id === 'handyman_hour'); if (h >= 0) { out.dropped.push('handyman_hour'); items.splice(h, 1); } }
    if (items.length || custom.length) out.services.push({ name, items, custom, exclusions });
  });
  const keys = new Set(BOOK.ITEMS.flatMap((i) => (i.mat || []).map((m) => m[4]).filter(Boolean)));
  out.customerSupplies = (raw && raw.customerSupplies || []).map(s).filter((k) => keys.has(k));
  const st = (raw && raw.site) || {};
  out.site = { floor: Number(st.floor) || 0, elevator: st.elevator === true ? true : st.elevator === false ? false : null, walkup: st.walkup === true || st.elevator === false, coi: !!st.coi, buildingType: s(st.buildingType).slice(0, 40) };
  out.facts = (raw && raw.facts || []).filter((f) => f && s(f.text)).slice(0, 12).map((f, i) => ({ id: 'f' + (i + 1), text: s(f.text).slice(0, 160), effect: s(f.effect).slice(0, 120), on: true }));
  out.questions = (raw && raw.questions || []).map((q) => s(typeof q === 'string' ? q : q && q.question)).filter((q) => q && !BAN.test(q) && !/brand|color|colour|sheen|finish type|budget|high.end/i.test(q)).slice(0, 3);
  const okStatus = ['READY', 'PRELIMINARY', 'NEEDS_CLARIFICATION', 'SITE_VISIT_REQUIRED'];
  out.status = okStatus.includes(s(raw && raw.status)) ? s(raw.status) : 'PRELIMINARY';
  return out;
}

/* A fact he unticks: re-read with that fact removed (the dashboard sends the
   list of facts that are OFF; the reader is told to ignore them). */
function withoutFacts(input, offFacts) {
  if (!offFacts || !offFacts.length) return input;
  return Object.assign({}, input, { contractorNotes: [].concat(input.contractorNotes || [], ['IGNORE these facts, they are wrong: ' + offFacts.join(' | ')]) });
}

module.exports = { prompt, validate, catalog, withoutFacts };
