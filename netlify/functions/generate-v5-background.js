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
    contractorNotes: [].concat(s(e.extraRequest) || [], A(record.contractorNotes)).filter(Boolean),
  };
  const off = A(offFacts).length ? offFacts : A(record.chatFacts && record.chatFacts.facts).filter((f) => f && f.on === false).map((f) => f.text);
  return reader.withoutFacts(input, off);
}

/* The customer's photos and the pictures in messages, as image blocks (max 8). */
function photoBlocks(record) {
  const rq = record.request || {};
  const urls = [].concat(A(rq.photos).map((p) => (typeof p === 'string' ? p : p && p.url)),
    threadOf(record).flatMap((m) => A(m.attachments).filter((a) => a && a.kind === 'image').map((a) => a.url)));
  return urls.filter((u) => /^https:\/\//.test(s(u))).slice(-8).map((url) => ({ type: 'image', source: { type: 'url', url } }));
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
  await save({ aiStatus: 'running', aiJobId: s(b.jobId), aiError: '', aiStage: 'Reading the job…', aiStartedAt: now() });
  let out;
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    const previous = record.estimate && typeof record.estimate === 'object' ? record.estimate : null;
    /* redo = "Regenerate": read the whole job again from scratch, but like chat it
       only goes to pending with a change list; nothing changes before Apply. */
    const redo = b.mode === 'redo';
    const chat = b.mode === 'chat' || redo;
    const prevReading = redo ? null : previous && previous.v5Reading;
    const reading = await readJob(inputFrom(record, b.offFacts), chat && prevReading ? prevReading : null, photoBlocks(record));
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

async function openRecord(ref) {
  let store = null, record = null;
  for (const mk of [() => getStore({ name: 'estimates', siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN }), () => getStore('estimates')]) {
    try { store = mk(); record = await store.get(ref, { type: 'json' }); if (record) break; } catch (_) { store = null; }
  }
  return { store, record };
}
module.exports.openRecord = openRecord;
