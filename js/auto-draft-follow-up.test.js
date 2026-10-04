/* auto-draft-follow-up.test.js — run: node js/auto-draft-follow-up.test.js
 *
 *   Perplexity's list -> "1-2": a draft made when an estimate-form request
 *   arrives; follow-up emails day 2, 5 and 10, on for every sent estimate,
 *   a switch per job.
 */
const path = require('path'), fs = require('fs'), Module = require('module');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

const stores = {};
const blobs = { getStore: (o) => { const n = typeof o === 'string' ? o : o.name; const m = stores[n] = stores[n] || new Map(); return {
  get: async (k, t) => m.has(k) ? (t && t.type === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null,
  set: async (k, v) => m.set(k, String(v)), setJSON: async (k, v) => m.set(k, JSON.stringify(v)), list: async () => ({ blobs: [...m.keys()].map((key) => ({ key })) }) }; } };
const mails = [];
const orig = Module._load;
Module._load = function (req) {
  if (req === '@netlify/blobs') return blobs;
  if (/lib\/send-email$/.test(req)) return { sendResend: async (p) => { mails.push(p); return '{}'; }, esc: (s) => s };
  return orig.apply(this, arguments);
};
process.env.DASHBOARD_KEY = 'k'.repeat(32);
const H = { 'x-sbc-key': process.env.DASHBOARD_KEY };
const DAY = 864e5;

const fu = require(path.join(ROOT, 'netlify/functions/lib/follow-up'));
const ad = require(path.join(ROOT, 'netlify/functions/lib/auto-draft'));

(async () => {
  /* ── follow-up rules ── */
  const sent = '2026-10-05T15:00:00Z', S = Date.parse(sent);
  const rec = (extra) => Object.assign({ ref: 'SBC-261005-AAAA', status: 'sent', sentAt: sent, customer: { name: 'Yan Sim', email: 'yan@example.com' }, estimate: { projectTitle: 'Regrout two tubs' } }, extra || {});
  ok('nothing before day 2', fu.due(rec(), S + 1.9 * DAY) === 0);
  ok('day 2: the first follow-up', fu.due(rec(), S + 2 * DAY) === 1);
  ok('day 5: the second, once the first went', fu.due(rec({ followUps: [{ step: 1, at: new Date(S + 2 * DAY).toISOString(), basis: sent }] }), S + 5 * DAY) === 2);
  ok('day 10: the third', fu.due(rec({ followUps: [1, 2].map((n) => ({ step: n, at: new Date(S + [0, 2, 5][n] * DAY).toISOString(), basis: sent })) }), S + 10 * DAY) === 3);
  ok('then it stops', fu.due(rec({ followUps: [1, 2, 3].map((n) => ({ step: n, at: new Date(S + [0, 2, 5, 10][n] * DAY).toISOString(), basis: sent })) }), S + 40 * DAY) === 0);
  ok('a late run never sends two in a row: at least two days apart', fu.due(rec({ followUps: [{ step: 1, at: new Date(S + 9 * DAY).toISOString(), basis: sent }] }), S + 10 * DAY) === 0);
  ok('opened but not answered still gets one', fu.due(rec({ status: 'opened' }), S + 2 * DAY) === 1);
  ['accepted', 'declined', 'review_requested', 'question', 'completed', 'cancelled', 'invoiced', 'paid'].forEach((st) => ok('never when the status is ' + st, fu.due(rec({ status: st }), S + 3 * DAY) === 0));
  ok('never once the customer wrote back (email or thread)', fu.due(rec({ lastCustomerMessageAt: new Date(S + DAY).toISOString() }), S + 3 * DAY) === 0 && fu.due(rec({ thread: [{ from: 'customer', at: new Date(S + DAY).toISOString(), text: 'hi' }] }), S + 3 * DAY) === 0);
  ok('...but a message from BEFORE the send does not stop it', fu.due(rec({ lastCustomerMessageAt: new Date(S - DAY).toISOString() }), S + 3 * DAY) === 1);
  ok('never when switched off for the job', fu.due(rec({ followUpOff: true }), S + 3 * DAY) === 0);
  ok('never for estimates sent before follow-ups started', fu.due(rec({ sentAt: '2026-09-20T15:00:00Z' }), Date.parse('2026-10-06T12:00:00Z')) === 0);
  ok('sent again: the count starts again from the new send', fu.due(rec({ sentAt: new Date(S + 6 * DAY).toISOString(), followUps: [{ step: 1, at: new Date(S + 2 * DAY).toISOString(), basis: sent }] }), S + 8 * DAY) === 1);
  ok('no email address, no follow-up', fu.due(rec({ customer: { name: 'X', email: '' } }), S + 3 * DAY) === 0);
  const m = fu.message(rec(), 1, 'https://www.sanibuildingcorp.com/quote.html?ref=SBC-261005-AAAA');
  ok('the email: their first name, the project, the link, from Zurabi, no price, never "licensed"', /^Hi Yan,/.test(m.text) && /Regrout two tubs/.test(m.text) && /quote\.html\?ref=SBC-261005-AAAA/.test(m.html) && /Zurabi/.test(m.text) && !/\$/.test(m.text) && !/licensed/i.test(m.text));
  ok('three different emails, the last says it is the last', fu.message(rec(), 3, 'u').text !== fu.message(rec(), 2, 'u').text && /last reminder/.test(fu.message(rec(), 3, 'u').text));

  /* ── the sender ── */
  const st = blobs.getStore({ name: 'estimates' });
  /* the clock: three days after a send that is after follow-ups started */
  const now = S + 3 * DAY, realNow = Date.now; Date.now = () => now;
  await st.setJSON('SBC-1', rec({ ref: 'SBC-1', sentAt: new Date(now - 3 * DAY).toISOString() }));
  await st.setJSON('SBC-2', rec({ ref: 'SBC-2', sentAt: new Date(now - 3 * DAY).toISOString(), status: 'accepted' }));
  await st.setJSON('house-rules', { rules: 'x' });
  const bg = require(path.join(ROOT, 'netlify/functions/follow-ups-background'));
  let r = JSON.parse((await bg.handler({ httpMethod: 'POST', headers: H, body: JSON.stringify({ dryRun: true }) })).body);
  ok('a dry run lists, sends nothing', r.sent.join() === 'SBC-1 #1' && mails.length === 0, JSON.stringify(r));
  r = JSON.parse((await bg.handler({ httpMethod: 'POST', headers: H, body: '{}' })).body);
  const s1 = JSON.parse(stores.estimates.get('SBC-1'));
  ok('one email, to the customer, threaded with the quote, reply to contact@', mails.length === 1 && mails[0].to[0] === 'yan@example.com' && mails[0].headers['In-Reply-To'] && /contact@|@/.test(mails[0].reply_to), JSON.stringify(mails[0] && mails[0].to));
  ok('it is written on the record with the send it belongs to, and in History', s1.followUps.length === 1 && s1.followUps[0].basis === s1.sentAt && s1.history.some((h) => /Follow-up email 1 of 3/.test(h.text)));
  r = JSON.parse((await bg.handler({ httpMethod: 'POST', headers: H, body: '{}' })).body);
  ok('run again the same day: nothing more is sent', mails.length === 1 && r.sent.length === 0);

  Date.now = realNow;
  /* ── the switch ── */
  const sw = require(path.join(ROOT, 'netlify/functions/follow-up-switch'));
  await sw.handler({ httpMethod: 'POST', headers: H, body: JSON.stringify({ ref: 'SBC-1', off: true }) });
  ok('the switch turns it off for that job, with a History line', JSON.parse(stores.estimates.get('SBC-1')).followUpOff === true && JSON.parse(stores.estimates.get('SBC-1')).history.some((h) => /switched off/.test(h.text)));

  /* ── schedule ── */
  const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
  ok('once a day, mid-morning New York', /\[functions\."follow-ups-scheduled"\]\s*schedule = "12 14 \* \* \*"/.test(toml));
  const sch = require(path.join(ROOT, 'netlify/functions/follow-ups-scheduled'));
  ok('only the scheduler may start it', (await sch.handler({ body: '{}' })).statusCode === 401);

  /* ── auto draft ── */
  ok('a request worth pricing: a real description, answers or a photo', ad.worthDrafting({ request: { description: 'Regrout and recaulk two bathtub surrounds please' } }) && ad.worthDrafting({ request: { description: '', photos: [{}] } }) && !ad.worthDrafting({ request: { description: 'hi' } }));
  process.env.AUTO_DRAFT = 'off';
  ok('AUTO_DRAFT=off stops it', (await ad.kick({ ref: 'SBC-9', request: { description: 'a b c d e f g' } })).reason === 'off');
  delete process.env.AUTO_DRAFT;
  const ER = fs.readFileSync(path.join(ROOT, 'netlify/functions/estimate-request.js'), 'utf8');
  ok('the estimate form starts it only for a request it just created (a retry never starts a second)', /if \(!existed\) savedNew = record;/.test(ER) && /if \(savedNew\) \{\s*tasks\.push\(autoDraft\.kick\(savedNew\)/.test(ER));
  ok('the contact form and emails never start one', !/auto-draft/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/contact-to-estimate.js'), 'utf8')) && !/auto-draft/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/email-lead-background.js'), 'utf8')));
  const AD = fs.readFileSync(path.join(ROOT, 'netlify/functions/lib/auto-draft.js'), 'utf8');
  ok('it runs the same estimator as Generate, with his house rules, a full read', /generate-estimate-background/.test(AD) && /reanalyze: true/.test(AD) && /houseRules: await houseRules\(\)/.test(AD));
  const GEN = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'), 'utf8');
  ok('History says the draft was made automatically', /Draft made automatically when the request arrived/.test(GEN));
  const D = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
  ok('opening a record whose draft is still running shows its progress', /currentRecord\.aiStatus === "running" && \/\^auto-\/\.test/.test(D));
  ok('the Messages tab shows the follow-ups and a switch', /🔔 AUTOMATIC FOLLOW-UP EMAILS/.test(D) && /etFollowUp\(/.test(D));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
