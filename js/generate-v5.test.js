/* generate-v5-background + estimate-v5-apply, offline (fake AI, fake Blobs).
   Covers Claude's review of PR #251: no temperature, key required, chat never
   writes record.estimate, hand price not doubled, messages during a run kept,
   apply/cancel/undo answer after the write. */
'use strict';
const assert = require('assert');
const Module = require('module');
const db = {}; let duringRun = null;
const realLoad = Module._load;
Module._load = function (r, ...a) {
  if (r === '@netlify/blobs') return { getStore: () => ({
    get: async (k) => (db[k] ? JSON.parse(JSON.stringify(db[k])) : null),
    setJSON: async (k, v) => { db[k] = JSON.parse(JSON.stringify(v)); } }) };
  return realLoad.call(this, r, ...a);
};
process.env.ANTHROPIC_API_KEY = 'x'; process.env.DASHBOARD_KEY = 'k';
const gen = require(__dirname + '/../netlify/functions/generate-v5-background.js');
const app = require(__dirname + '/../netlify/functions/estimate-v5-apply.js');
let reply, sent;
global.fetch = async (u, o) => { sent = JSON.parse(o.body); if (duringRun) { duringRun(); duringRun = null; }
  return { ok: true, json: async () => ({ content: [{ text: JSON.stringify(reply) }] }) }; };
const H = { 'x-sbc-key': 'k' };
const post = (fn, body, headers) => fn.handler({ httpMethod: 'POST', headers: headers || H, body: JSON.stringify(body) });
let n = 0; const ok = (name, c) => { assert.ok(c, name); n++; console.log('PASS  ' + name); };

(async () => {
  reply = { projectTitle: 'Toilet replacement', summary: 'Replace the toilet.', services: [{ name: 'General', items: [{ id: 'toilet', qty: 1 }] }], status: 'READY' };
  db['SBC-1'] = { ref: 'SBC-1', status: 'new', request: { service: 'Bathroom', description: 'replace toilet', photos: ['https://x/p.jpg'] }, thread: [{ id: 'm1', from: 'customer', text: 'hi', at: '2026-10-01' }], customer: { name: 'A' } };

  const no = await post(gen, { ref: 'SBC-1', jobId: 'j0', mode: 'new' }, {});
  ok('no dashboard key -> refused', no.statusCode === 401 || no.statusCode === 403);

  await post(gen, { ref: 'SBC-1', jobId: 'j1', mode: 'new' });
  let r = db['SBC-1'];
  ok('new draft is made, never "General"', r.aiStatus === 'done' && r.estimate.totals.total > 0 && r.estimate.manualCustomerScopeDraft.services[0].name === 'Bathroom');
  ok('no temperature sent; room for the answer', !('temperature' in sent) && sent.max_tokens >= 8000);

  // he types the toilet price by hand + a customer message lands during the next run
  const tl = r.estimate.labor.find((l) => l.bookId === 'toilet'); tl.rate = 250; tl.byHand = true; r.estimate.quotePhotos = ['keep']; db['SBC-1'] = r;
  const before = JSON.stringify(r.estimate);
  reply.services[0].items.push({ id: 'vanity', qty: 1 });
  duringRun = () => { db['SBC-1'].thread.push({ id: 'm2', from: 'customer', text: 'also the vanity', at: '2026-10-02' }); };
  await post(gen, { ref: 'SBC-1', jobId: 'j2', mode: 'chat' });
  r = db['SBC-1'];
  ok('chat update does not touch the live estimate', JSON.stringify(r.estimate) === before && r.estimateV5Pending && r.estimateV5Pending.changes.length > 0);
  ok('a message that arrived during the run is kept', r.thread.some((m) => m.id === 'm2'));
  const pl = r.estimateV5Pending.estimate.labor.filter((l) => l.bookId === 'toilet');
  ok('hand price on a book line is charged once', pl.length === 1 && pl[0].rate === 250);

  const ap = await post(app, { ref: 'SBC-1', action: 'apply' });
  const aj = JSON.parse(ap.body);
  ok('apply answers 200 with the saved estimate', ap.statusCode === 200 && aj.estimate.labor.some((l) => /vanity/i.test(l.item)) && !db['SBC-1'].estimateV5Pending);
  ok('his photos survive', JSON.stringify(db['SBC-1'].estimate.quotePhotos) === '["keep"]');
  const un = JSON.parse((await post(app, { ref: 'SBC-1', action: 'undo' })).body);
  ok('undo brings back the version before', JSON.stringify(un.estimate) === before);

  // an estimate made by the OLD generator (no v5Reading): chat -> pending only, marked full rebuild
  db['SBC-2'] = { ref: 'SBC-2', request: { service: 'Bathroom', description: 'toilet' }, thread: [], estimate: { markupPct: 25, labor: [{ section: 'Bathroom', item: 'My own toilet line', qty: 1, unit: 'job', rate: 400 }], materials: [] } };
  const old = JSON.stringify(db['SBC-2'].estimate);
  await post(gen, { ref: 'SBC-2', jobId: 'j3', mode: 'chat' });
  ok('old estimate + Update from chat -> only a pending draft, estimate untouched', JSON.stringify(db['SBC-2'].estimate) === old && db['SBC-2'].estimateV5Pending.fullRebuild === true);
  ok('his markup is kept on a rebuild', db['SBC-2'].estimateV5Pending.estimate.markupPct === 25);
  await post(app, { ref: 'SBC-2', action: 'cancel' });
  ok('cancel drops the pending draft', !db['SBC-2'].estimateV5Pending && JSON.stringify(db['SBC-2'].estimate) === old);

  console.log('\n' + n + ' passed');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
