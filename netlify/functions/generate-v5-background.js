/* ============================================================================
   generate-v5-background.js — the new estimate brain (v5)
   ----------------------------------------------------------------------------
   "Please help me rewrite absolutely new generator ai for my dashboard!"

   ONE AI call reads the job (lib/job-reader-v5.js) and answers only:
   which price-book items, how many, who supplies what, what the customer
   left out, what the chat taught us. It cannot write a price, an hour or a
   rate. lib/estimate-engine-v5.js does all the money, steps, timeline and
   wording from lib/price-book-v5.js. Same reading -> same price.

   POST { ref, jobId, mode: "new" | "chat", offFacts?: [text] }   (dashboard key required)
     new   : read the whole job, build the estimate, save it (his hand-made
             fields, hand prices and edited scope are kept — same latches as before)
     chat  : read the newest messages against the previous reading; build;
             put back every hand line/rate; save as record.estimateV5Pending
             with a change list. NOTHING on the estimate changes until Apply.
     Apply / Cancel / Undo are in estimate-v5-apply.js (a normal function, so
     the dashboard gets the answer only after the write).
     The record is read AGAIN right before saving and only this run's fields
     are written, so a customer message or an autosave during the run is kept.
   Writes aiStatus / aiJobId / aiStage / aiError / aiFinishedAt like the old
   generator, so the dashboard's existing poll loop works unchanged.
   Separate switch: on unless V5_GENERATOR=off. The old generator stays off.
   ============================================================================ */
'use strict';
const { getStore } = require('@netlify/blobs');
const reader = require('./lib/job-reader-v5');
const engine = require('./lib/estimate-engine-v5');
const { preserveContractorFields, forRegenerate } = require('./lib/contractor-owned-fields');
const { keepHandPrices } = require('./lib/hand-prices');
const { requireDashboardKey } = require('./lib/require-dashboard-key');

const MODEL = process.env.V5_MODEL || process.env.ESTIMATOR_MODEL || 'claude-opus-5';
const on = () => String(process.env.V5_GENERATOR || '').trim().toLowerCase() !== 'off';
const cors = () => ({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-sbc-key', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' });
const res = (code, body) => ({ statusCode: code, headers: cors(), body: JSON.stringify(body) });
const A = (v) => (Array.isArray(v) ? v : []);
const s = (v) => (v == null ? '' : String(v)).trim();

function threadOf(record) {
  try { const t = require('./lib/thread'); if (t.normalizeThread) return A(t.normalizeThread(record)); } catch (_) {}
  return A(record.thread);
}

function inputFrom(record, offFacts) {
  const rq = record.request || {}, c = record.customer || {}, e = record.estimate || {};
  const msgs = threadOf(record).slice(-30).map((m) => ({ from: m.from, at: m.at, text: s(m.text).slice(0, 1500),
    photos: A(m.attachments).filter((a) => a && a.kind === 'image').length })).filter((m) => m.text);
  const input = {
    request: {
      services: A(rq.selectedServices).length ? rq.selectedServices : [].concat(rq.service || []),
      description: s(rq.description), answers: rq.serviceAnswers || {}, answerLabels: rq.answerLabels || {},
      customerSupplies: A(rq.customerSupplies), propertyType: s(rq.propertyType), address: s(c.address),
      emails: A(rq.emails).slice(-6).map((m) => ({ from: m.from, text: s(m.text || m.body).slice(0, 1500) })),
    },
    conversation: msgs,
    contractorNotes: [].concat(s(e.ownerNotes) || [], s(e.extraRequest) || [], A(record.contractorNotes),
      /* What he told the estimator in the private chat (his words only; newest wins). */
      A(record.ownerChat).filter((m) => m && m.from === 'owner' && s(m.text)).slice(-30).map((m) => 'Owner said: ' + s(m.text).slice(0, 1500))).filter(Boolean),
  };
  /* Old (pre-v5) estimate: show the reader his priced lines so no work is lost. */
  const old = oldLines(e);
  if (old.length) input.contractorLines = old.map((l, n) => ({ n, kind: l.kind, item: l.item, qty: l.qty, unit: l.unit, price: Math.round(l.qty * l.rate) }));
  return reader.withoutFacts(input, (A(offFacts).length ? offFacts : A(record.chatFacts && record.chatFacts.facts).filter((f) => f && f.on === false).map((f) => f.text)));
}
function oldLines(e) {
  if (!e || e.v5Reading) return [];
  const out = [];
  ['labor', 'materials'].forEach((kind) => A(e[kind]).forEach((l) => { if (l && s(l.item) && Number(l.rate) > 0) out.push({ kind, item: s(l.item).slice(0, 140), qty: Number(l.qty) || 1, unit: s(l.unit) || 'ea', rate: Number(l.rate), hours: Number(l.hours) || 0 }); }));
  return out.slice(0, 60);
}
/* custom {old:n} -> the exact old line. */
function attachOld(reading, e) {
  const old = oldLines(e);
  A(reading && reading.services).forEach((sv) => A(sv.custom).forEach((c) => { if (c && c.old != null && old[c.old]) c.oldLine = old[c.old]; }));
  return reading;
}

/* The customer's photos and the pictures in messages, as image blocks (max 8). */
function photoBlocks(record) {
  const rq = record.request || {};
  /* Form photos are stored as { data, slot } - data is the link (or a data: URL). */
  /* sitePhotos = internal photos the owner snaps from the Talk card (never shown to the customer). */
  const site = A(record.estimate && record.estimate.sitePhotos).map((p) => p && p.data);
  const urls = [].concat(A(rq.photos).map((p) => (typeof p === 'string' ? p : p && (p.data || p.url))), site,
    threadOf(record).flatMap((m) => A(m.attachments).filter((a) => a && a.kind === 'image').map((a) => a.url)));
  return urls.map(s).filter((u) => /^https:\/\//.test(u) || /^data:image\/(jpeg|png|gif|webp);base64,/.test(u)).slice(-8).map((u) => {
    const m = u.match(/^data:(image\/[a-z]+);base64,(.*)$/);
    return m ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } } : { type: 'image', source: { type: 'url', url: u } };
  });
}

async function readJob(input, previous, blocks) {
  const call = async (withPhotos) => {
    const content = [].concat(withPhotos ? blocks : [], [{ type: 'text', text: reader.prompt(input, previous) }]);
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      /* No temperature: Claude 5 models reject non-default sampling (see
         generate-estimate-background.js). Room for thinking + the JSON. */
      body: JSON.stringify({ model: MODEL, max_tokens: 12000, messages: [{ role: 'user', content }] }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || 'AI ' + r.status);
    return (j.content || []).map((b) => b.text || '').join('');
  };
  let text;
  try { text = await call(blocks.length > 0); } catch (e) { if (!blocks.length) throw e; text = await call(false); } // a bad photo link must not stop the estimate
  const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error('The reader returned no JSON');
  return reader.validate(JSON.parse(m[0]), input);
}

/* The engine's cards also as serviceBreakdown, which quote.html and the cards read. */
function withBreakdown(est) {
  const svcs = A(est.manualCustomerScopeDraft && est.manualCustomerScopeDraft.services);
  const sub = (name) => [].concat(A(est.labor), A(est.materials)).filter((l) => l.section === name).reduce((a, l) => a + l.qty * l.rate, 0) * (1 + (est.markupPct || 0) / 100);
  est.serviceBreakdown = svcs.map((x) => ({ title: x.name, included: x.included, customerSupplies: A(est.customerSupplied).filter((c) => c.section === x.name).map((c) => c.item), notIncluded: x.excluded, subtotal: Math.round(sub(x.name) * 100) / 100 }));
  est.pricingReadiness = { status: est.estimateStatus };
  est.assumptions = A(est.v5Reading && est.v5Reading.facts).filter((f) => /assum/i.test(f.text)).map((f) => f.text);
  // finish cards the dashboard already understands
  ['materials'].forEach((k) => A(est[k]).forEach((l) => { const f = A(est.finishes).find((x) => x.item === l.item && x.section === l.section); if (f) { l.finish = true; l.finishStatus = f.status; } }));
  return est;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return res(200, {});
  if (event.httpMethod !== 'POST') return res(405, { error: 'Method Not Allowed' });
  const denied = requireDashboardKey(event, cors()); if (denied) return denied;
  if (!on()) return res(403, { error: 'The v5 estimator is switched off (V5_GENERATOR=off).' });
  const b = JSON.parse(event.body || '{}'); const ref = s(b.ref);
  if (!ref) return res(400, { error: 'Missing ref' });
  const { store, record } = await openRecord(ref);
  if (!record) return res(404, { error: 'Estimate not found' });
  const now = () => new Date().toISOString();
  /* Only these fields are ever written by this function. */
  const save = async (fields) => {
    const fresh = (await store.get(ref, { type: 'json' })) || record;
    Object.assign(fresh, fields);
    await store.setJSON(ref, fresh);
    return fresh;
  };
  /* talk = private chat with the estimator. A reply only; nothing on the estimate moves.
     Own talkJob fields, so it never disturbs a running Generate. */
  if (b.mode === 'talk') {
    const msg = s(b.message).slice(0, 2000), jid = s(b.jobId);
    const sp = A(record.estimate && record.estimate.sitePhotos);
    const att = A(b.photos).map(Number).filter((i) => Number.isInteger(i) && sp[i] && sp[i].data).slice(0, 6);
    let reply, err = '';
    try {
      if (!msg) throw new Error('Empty message');
      if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
      reply = await talkReply(record, msg, att);
    } catch (e) { err = e.message || 'error'; }
    const fresh = (await store.get(ref, { type: 'json' })) || record;
    if (!err) fresh.ownerChat = A(fresh.ownerChat).concat([Object.assign({ from: 'owner', text: msg, at: now() }, att.length ? { photos: att } : {}), { from: 'ai', text: reply.reply, chips: reply.chips, at: now() }]).slice(-80);
    fresh.talkJob = { id: jid, done: true, error: err, at: now() };
    await store.setJSON(ref, fresh);
    return res(202, { ok: true });
  }
  await save({ aiStatus: 'running', aiJobId: s(b.jobId), aiError: '', aiStage: 'Reading the job…', aiStartedAt: now() });
  let out;
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    const previous = record.estimate && typeof record.estimate === 'object' ? record.estimate : null;
    /* ask = "Talk to the estimator first": questions for HIM, no prices, nothing on the estimate moves. */
    if (b.mode === 'ask') {
      const rd = await readJob(Object.assign(inputFrom(record, b.offFacts), { preflight: true, quick: !!b.quick }), null, photoBlocks(record));
      await save({ aiStatus: 'done', aiStage: '', aiError: '', aiJobId: s(b.jobId), aiFinishedAt: now(), v5Ask: { at: now(), jobId: s(b.jobId), summary: rd.summary, questions: rd.questions, choices: rd.questionChoices || [], quick: !!b.quick } });
      return res(202, { ok: true });
    }
    /* redo = "Regenerate\": read the whole job again from scratch, but like chat it
       only goes to pending with a change list; nothing changes before Apply. */
    const redo = b.mode === 'redo';
    const chat = b.mode === 'chat' || redo;
    const prevReading = redo ? null : previous && previous.v5Reading;
    const reading = attachOld(await readJob(inputFrom(record, b.offFacts), chat && prevReading ? prevReading : null, photoBlocks(record)), previous);
    let est, changes = [];
    if (chat && prevReading) {
      const u = engine.update(previous, reading); est = u.estimate;
    } else {
      est = engine.build(reading);
      keepHandPrices(previous, est);
      if (previous && previous.markupPct != null && (A(previous.labor).length || A(previous.materials).length)) est.markupPct = previous.markupPct; // his markup
      engine.retotal(est);
    }
    /* His photos, contract, final total, view choices, timeline numbers and any
       scope text he edited by hand come across untouched (same latch as before). */
    preserveContractorFields(forRegenerate(previous).previous, est);
    syncKeptScopeSupplies(est);
    /* He set his own total by hand: the AI never overrides it silently. */
    if (previous && Number(previous.totalSetByHand) > 0) {
      est.totalSetByHand = Number(previous.totalSetByHand);
      est.warnings = A(est.warnings).concat(['You set your own total ($' + est.totalSetByHand.toLocaleString('en-US') + ') by hand. The new lines may total differently - tap Set my own total again after Apply if you want it back.']);
    }
    withBreakdown(est);
    changes = previous ? engine.diff(previous, est) : [];
    out = { aiStatus: 'done', aiStage: '', aiError: '', aiJobId: s(b.jobId), aiFinishedAt: now(), updatedAt: now(), v5Status: { ok: true, at: now(), warnings: est.warnings, changes: changes.length } };
    if (chat && previous) {
      /* "Update from chat" NEVER writes record.estimate. It waits for Apply. */
      out.estimateV5Pending = { at: now(), jobId: s(b.jobId), estimate: Object.assign({}, previous, est), changes, fullRebuild: !(previous && previous.v5Reading), redo };
      /* Old-generator estimate: the change list lets him tick old lines to KEEP. */
    } else {
      out.estimateHistory = A(record.estimateHistory).concat(previous ? [{ at: now(), why: 'before new AI draft', estimate: previous }] : []).slice(-10);
      out.estimate = est;
      if (record.status === 'new') out.status = 'drafted';
    }
  } catch (e) {
    out = { aiStatus: 'error', aiError: e.message, aiStage: '', aiJobId: s(b.jobId), aiFinishedAt: now(), v5Status: { ok: false, at: now(), error: e.message } };
  }
  await save(out);
  return res(202, { ok: true });
};

/* "I clicked regenerate but it's still shows similar": his edited scope wording
   is kept on a regenerate (contractor-owned-fields.js), so the old "Tile, toilet,
   vanity/faucet ... supplied by customer" line stayed in Not included and the
   Customer supplies list stayed empty, while the prices were already right.
   His wording stays; only the supplies are brought in line with the estimate:
   every item the estimate says the customer supplies is listed, and a Not
   included line that only says "supplied by customer" leaves. */
const BYCUST = /\b(supplied|provided|purchased|bought|furnished)\s+by\s+(the\s+)?(customer|owner|client|homeowner|you)\b|\b(customer|owner|client|homeowner)\s+(supplies|provides|buys|purchases|furnishes)\b/i;
function syncKeptScopeSupplies(est) {
  const cs = A(est && est.customerSupplied); if (!cs.length) return;
  const n = (v) => s(typeof v === 'string' ? v : v && (v.text || v.item)).toLowerCase().replace(/\s+/g, ' ');
  ['manualCustomerScopeDraft', 'publishedCustomerScope'].forEach((k) => {
    const sc = est[k]; if (!sc || !Array.isArray(sc.services)) return;
    sc.services.forEach((sv) => {
      const mine = cs.filter((c) => n(c.section) === n(sv.name) || sc.services.length === 1).map((c) => s(c.item)).filter(Boolean);
      if (!mine.length) return;
      const sup = A(sv.supplied), have = new Set(sup.map(n));
      mine.forEach((it) => { if (!have.has(n(it))) { sup.push(it); have.add(n(it)); } });
      sv.supplied = sup;
      sv.excluded = A(sv.excluded).filter((x) => !BYCUST.test(s(typeof x === 'string' ? x : x && (x.text || x.item))));
    });
  });
}
/* The photos he just attached first, then the job's other photos (max 8 total). */
function talkBlocks(record, att) {
  const sp = A(record.estimate && record.estimate.sitePhotos);
  const mine = A(att).map((i) => sp[i] && sp[i].data).filter(Boolean);
  const toBlock = (u) => { const m = s(u).match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.*)$/); return m ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } } : /^https:\/\//.test(s(u)) ? { type: 'image', source: { type: 'url', url: s(u) } } : null; };
  const first = mine.map(toBlock).filter(Boolean);
  const rest = photoBlocks(record).filter((bk) => !(bk.source && bk.source.data && mine.some((u) => u.indexOf(bk.source.data.slice(0, 200)) >= 0)));
  return first.concat(rest).slice(0, 8);
}
/* Private chat with the estimator: plain talk, short answers, no JSON estimate. */
async function talkReply(record, msg, att) {
  const e = record.estimate || {};
  const lines = [].concat(A(e.labor).map((l) => Object.assign({ kind: 'labor' }, l)), A(e.materials).map((l) => Object.assign({ kind: 'material' }, l)))
    .slice(0, 80).map((l) => ({ kind: l.kind, section: l.section, item: s(l.item).slice(0, 120), qty: Number(l.qty) || 0, unit: l.unit, rate: Number(l.rate) || 0, hours: Number(l.hours) || undefined }));
  const sub = lines.reduce((a, l) => a + l.qty * l.rate, 0), mk = Number(e.markupPct) || 0;
  const job = inputFrom(record);
  const history = A(record.ownerChat).slice(-20).map((m) => (m.from === 'owner' ? 'OWNER: ' : 'YOU: ') + s(m.text).slice(0, 1200)).join('\n');
  const prompt = `You are the estimating brain inside Sani Building Corp's dashboard (renovation contractor, NYC / Long Island). You are talking privately with the owner, an experienced contractor, often on his phone at a job site. The customer never sees this chat.

How to talk:
- Plain, direct contractor talk. 1-3 short sentences. No lists unless he asks. No markdown.
- If he tells you facts or changes ("customer buys tile", "make wall tile $18/sf", "3rd floor walk-up"), confirm in one line what you will change on the next Generate / Regenerate. You cannot change the estimate yourself; he taps Generate or Regenerate.
- If he asks why a number is what it is, explain from the current lines below (qty x rate). Do not invent numbers that are not there.
- Ask at most ONE follow-up question, only if its answer really changes the price.
- Never say "licensed". No gas work.

Return JSON only: {"reply":"...","chips":["0-3 short tap replies he might send next, 1-5 words each"]}

JOB (customer request, customer messages, his notes):
${JSON.stringify(job).slice(0, 14000)}

CURRENT ESTIMATE: ${lines.length ? `subtotal $${Math.round(sub)}, markup ${mk}%, total about $${Math.round(sub * (1 + mk / 100))}. Lines: ${JSON.stringify(lines).slice(0, 12000)}` : 'none yet (not generated).'}

CHAT SO FAR:
${history || '(new chat)'}
OWNER: ${msg}${A(att).length ? `\n[He attached ${att.length} new photo${att.length > 1 ? 's' : ''} with this message: the FIRST ${att.length} image${att.length > 1 ? 's' : ''} above. Look at them closely and answer about what you see.]` : ''}`;
  const call = async (withPhotos) => {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: 'user', content: [].concat(withPhotos ? talkBlocks(record, att) : [], [{ type: 'text', text: prompt }]) }] }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || 'AI ' + r.status);
    return (j.content || []).map((b) => b.text || '').join('');
  };
  let text; try { text = await call(true); } catch (_) { text = await call(false); }
  let o = null; try { const m = text.match(/\{[\s\S]*\}/); o = m && JSON.parse(m[0]); } catch (_) {}
  const reply = s(o && o.reply ? o.reply : text).replace(/\blicen[cs]ed?\b/gi, 'fully insured').slice(0, 1500) || 'Got it.';
  const chips = A(o && o.chips).map((c) => s(c).slice(0, 40)).filter(Boolean).slice(0, 3);
  return { reply, chips };
}

async function openRecord(ref) {
  let store = null, record = null;
  for (const mk of [() => getStore({ name: 'estimates', siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN }), () => getStore('estimates')]) {
    try { store = mk(); record = await store.get(ref, { type: 'json' }); if (record) break; } catch (_) { store = null; }
  }
  return { store, record };
}
module.exports.openRecord = openRecord;
