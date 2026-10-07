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
3. A SMALL JOB STAYS SMALL. A repair is priced as a repair. Never add handyman hours as extra time on top of priced items. If there is real extra work with no price-book id (e.g. hang 4 shelves), put it in "custom". Never add demolition, rough plumbing, waterproofing or new tile unless the customer asked for that work.
4. Customer-supplied items: put the supply key in customerSupplies. Labor stays; only the material is removed.
5. Customer exclusions ("walls only", "no baseboards") go in that service's "exclusions", close to their own words.
6. Newest message wins. A contractor note beats the customer. input.contractorNotes are the owner's own answers and instructions: follow them exactly, they beat everything else. Never ask again for something already answered.
7. Never offer options or alternatives. Never mention TV mounting. Never set, install or connect an oven, range, cooktop or any gas appliance. Never use the word "licensed".
8. "questions": at most 3, only when the answer changes the price by real money. If the job is clear, return [].
9. "facts": every fact you used from the conversation/answers, each with what it changes ("effect").
10. Service names = the customer's selected services (e.g. "Bathroom", "Painting"). Never "General".
13. HARD CONDITIONS: if the request makes an item slower than normal (hand removal over a heated mat, very small room with many cuts, two-color pattern, old mud bed, delicate finishes), give that item "factor" 1.2-2.5 and "why" in plain words. The factor multiplies labor only.
14. Use the right item: tile floor takeout is tile_floor_demo (not floor_remove, which is vinyl/laminate). A floor-only tile job also needs toilet_pull_reset when a toilet sits on that floor, saddle at the door, floor_prep_patch, and heat_mat_care when there is an existing heated floor. coi_admin when the building needs a COI.
15. CONTRACTOR'S OLD LINES (input.contractorLines, if present) are his own priced judgment for this job. Never drop work he priced. For each old line: use a book id when it covers the same work, otherwise put it in "custom" with "old": its n. If the book item is clearly cheaper than his old line for the same work, prefer "custom" with "old": n - his number wins.
11. LOOK AT THE PHOTOS. Pick the item that matches what is really there: a toilet with an exposed metal flush pipe / flush valve from the wall (Sloan, Zurn, commercial style) is toilet_flushometer, not toilet. Say what you saw in "facts".
12. "site": read the building answers. "walk-up" / "no elevator" means elevator:false and walkup:true; put the floor number if given. Never ask again about floor or walk-up when the answers already say it.
${input && input.preflight ? `\nBEFORE PRICING - QUESTIONS FOR THE CONTRACTOR. The contractor (Sani's owner, not the customer) wants to talk with you BEFORE you price. Read everything. In "summary" write 2-3 plain sentences: what you understood the job is, and what is missing. In "questions" ask him ${input.quick ? 'up to 4 (QUICK MODE: only the biggest price drivers - size, how much is torn out, who supplies materials, building access)' : 'up to 6'} short, concrete questions whose answers change the price (size, how much is torn out, what stays, who supplies what, floor/elevator/COI, special conditions). Keep the summary to 2 short sentences. Each question is an object {"question":"under 12 words","choices":["2-4 short tap answers, 1-4 words each"]}; use [] choices only when the answer must be typed (like a size). Skip anything the request, the answers or his notes already say. If the request is almost empty, ask for the basics. Still return the JSON below; services may be empty.\n` : ''}${previous ? `\nTHIS IS A CHAT UPDATE. Previous reading below. Change ONLY what the new messages change. Keep every other item and quantity exactly the same.\nPREVIOUS READING:\n${JSON.stringify(previous)}\n` : ''}
REQUEST:
${JSON.stringify(input)}

Return JSON only:
{"projectTitle":"","summary":"2-3 plain sentences for the customer: what we will do and the result",
 "services":[{"name":"","items":[{"id":"","qty":0,"note":"","factor":1,"why":""}],"custom":[{"name":"","qty":1,"unit":"job","note":"","old":null}],"exclusions":[]}],
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
      const same = items.find((x) => x.id === b.id); if (same) same.qty += q; else items.push(Object.assign({ id: b.id, qty: Math.round(q * 10) / 10, note: s(it.note).slice(0, 140) }, (() => { const f = Math.min(2.5, Math.max(1, Number(it.factor) || 1)); return f > 1 && s(it.why) ? { factor: Math.round(f * 100) / 100, why: s(it.why).slice(0, 120) } : {}; })()));
    });
    const custom = (sv.custom || []).filter((c) => s(c && c.name) && !BAN.test(c.name)).slice(0, 40).map((c) => ({ name: s(c.name).slice(0, 90), qty: Number(c.qty) > 0 ? Number(c.qty) : 1, unit: s(c.unit) || 'job', note: s(c.note).slice(0, 140), old: Number.isInteger(Number(c.old)) && c.old !== null && c.old !== '' ? Number(c.old) : null }));
    const exclusions = (sv.exclusions || []).map(s).filter(Boolean).slice(0, 5);
    /* No padding: handyman hours only when they ARE the job, never on top of priced work. */
    /* Handyman hours on top of priced work are never padding and never silently
       deleted: real extra work ("hang 4 shelves") becomes a "Needs your price" line. */
    if (items.some((x) => x.id !== 'handyman_hour')) {
      const h = items.findIndex((x) => x.id === 'handyman_hour');
      if (h >= 0) {
        const hh = items.splice(h, 1)[0], what = s(hh.note).replace(/\bhandyman( labor| hours?)?\b/ig, '').replace(/^[\s:,-]+/, '').trim();
        if (what.length > 3) custom.push({ name: what.slice(0, 90), qty: 1, unit: 'job', note: 'AI suggested ' + hh.qty + ' hr' });
        else out.dropped.push('handyman_hour');
      }
    }
    if (items.length || custom.length) out.services.push({ name, items, custom, exclusions });
  });
  const keys = new Set(BOOK.ITEMS.flatMap((i) => (i.mat || []).map((m) => m[4]).filter(Boolean)));
  out.customerSupplies = (raw && raw.customerSupplies || []).map(s).filter((k) => keys.has(k));
  const st = (raw && raw.site) || {};
  out.site = { floor: Number(st.floor) || 0, elevator: st.elevator === true ? true : st.elevator === false ? false : null, walkup: st.walkup === true || st.elevator === false, coi: !!st.coi, buildingType: s(st.buildingType).slice(0, 40) };
  out.facts = (raw && raw.facts || []).filter((f) => f && s(f.text)).slice(0, 12).map((f, i) => ({ id: 'f' + (i + 1), text: s(f.text).slice(0, 160), effect: s(f.effect).slice(0, 120), on: true }));
  const qOk = (q) => q && !BAN.test(q) && !/brand|color|colour|sheen|finish type|budget|high.end/i.test(q);
  const qMax = input && input.preflight ? (input.quick ? 4 : 6) : 3;
  const qRaw = (raw && raw.questions || []).filter((q) => qOk(s(typeof q === 'string' ? q : q && q.question))).slice(0, qMax);
  out.questions = qRaw.map((q) => s(typeof q === 'string' ? q : q.question));
  /* Tap answers for the mobile Talk card; same order as questions. */
  out.questionChoices = qRaw.map((q) => (q && typeof q === 'object' && Array.isArray(q.choices) ? q.choices : []).map((c) => s(c).slice(0, 40)).filter((c) => c && !BAN.test(c)).slice(0, 4));
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
