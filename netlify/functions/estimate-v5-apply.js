/* estimate-v5-apply.js — Apply / Cancel / Undo for the v5 estimator.
   A NORMAL function (not background): it answers only after the write, with
   the estimate as saved, so the dashboard can never show (and autosave back)
   the old estimate. Dashboard key required.
   POST { ref, action: "apply" | "cancel" | "undo" } -> { ok, estimate, estimateHistory } */
'use strict';
const { requireDashboardKey } = require('./lib/require-dashboard-key');
const { openRecord } = require('./generate-v5-background');
const cors = () => ({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-sbc-key', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
const res = (code, body) => ({ statusCode: code, headers: cors(), body: JSON.stringify(body) });
const A = (v) => (Array.isArray(v) ? v : []);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return res(200, {});
  if (event.httpMethod !== 'POST') return res(405, { error: 'Method Not Allowed' });
  const denied = requireDashboardKey(event, cors()); if (denied) return denied;
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const ref = String(b.ref || '').trim(), action = String(b.action || '');
  if (!ref) return res(400, { error: 'Missing ref' });
  const { store, record } = await openRecord(ref);
  if (!record) return res(404, { error: 'Estimate not found' });
  const now = new Date().toISOString();
  if (action === 'apply') {
    const p = record.estimateV5Pending;
    if (!p || !p.estimate) return res(409, { error: 'Nothing waiting to apply' });
    record.estimateHistory = A(record.estimateHistory).concat([{ at: now, why: 'before chat update', estimate: record.estimate }]).slice(-10);
    record.estimate = p.estimate;
    delete record.estimateV5Pending;
  } else if (action === 'cancel') {
    delete record.estimateV5Pending;
  } else if (action === 'undo') {
    const h = A(record.estimateHistory);
    if (!h.length) return res(409, { error: 'No earlier version saved' });
    record.estimate = h[h.length - 1].estimate;
    record.estimateHistory = h.slice(0, -1);
  } else return res(400, { error: 'action must be apply, cancel or undo' });
  record.updatedAt = now;
  await store.setJSON(ref, record);
  return res(200, { ok: true, estimate: record.estimate, estimateHistory: record.estimateHistory || [] });
};
