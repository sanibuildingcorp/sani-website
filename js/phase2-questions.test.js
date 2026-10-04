/* phase2-questions.test.js — run: node js/phase2-questions.test.js
 *
 *   Simplewise "Further Questions" + "Building your estimate 65%" + "Edit with AI"
 *   -> "Yes go start" (Phase 2).
 *
 * 1. Questions before pricing: written for HIM from the record, one per
 *    screen, a star on the likely answer, Unsure / Other added by the app.
 *    His answers are saved on the record and reach the generator as
 *    contractor notes; a new answer re-reads the job (scope pin).
 * 2. Generation shows a percent from the stage the server reports.
 * 3. Edit with AI on Scope and Estimate goes through the same Ask AI path.
 * (The screens were checked in Chromium at 390px.)
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

const cq = require(path.join(ROOT, 'netlify/functions/lib/contractor-questions'));

/* ── the questions ── */
const qs = cq.cleanQuestions({ questions: [
  { emoji: '🔧', question: 'How will the old tub drain be capped?', why: 'plumbing labor', options: ['Cap above floor', 'Cap in subfloor', 'Unsure', 'Other'], recommended: 0 },
  { question: 'Is the contractor licensed for plumbing?', options: ['Yes', 'No'], recommended: 0 },
  { question: 'Who connects the gas range?', options: ['Sani', 'Utility'], recommended: 0 },
  { question: 'How will the old tub drain be capped?', options: ['A', 'B'] },
  { question: 'One option only', options: ['Yes'] },
  { question: 'Bad recommended index', options: ['A', 'B'], recommended: 7 },
] });
ok('Unsure / Other from the model are dropped: the app adds its own', qs[0].options.join('|') === 'Cap above floor|Cap in subfloor', qs[0].options.join('|'));
ok('the starred answer is kept', qs[0].recommended === 0);
ok('"licensed" never reaches the screen', !qs.some((q) => /licensed/i.test(q.question)) && qs.some((q) => /fully insured/.test(q.question)));
ok('no gas question is ever asked', !qs.some((q) => /\bgas\b/i.test(q.question)));
ok('a repeated question and a one-option question are dropped', qs.filter((q) => /tub drain/.test(q.question)).length === 1 && !qs.some((q) => /One option/.test(q.question)));
ok('a recommended index out of range means no star', qs.find((q) => /Bad recommended/.test(q.question)).recommended === -1);
ok('at most ' + cq.MAX_QUESTIONS + ' questions', cq.cleanQuestions({ questions: Array.from({ length: 20 }, (_, i) => ({ question: 'Q' + i, options: ['a', 'b'] })) }).length === cq.MAX_QUESTIONS);
ok('the prompt forbids price questions, gas, "licensed", and repeating what is answered', /Never ask anything already answered/.test(cq.SYSTEM) && /Never ask about prices/.test(cq.SYSTEM) && /gas/.test(cq.SYSTEM) && /licensed/.test(cq.SYSTEM));
const ctxJob = cq.jobContext({ request: { description: 'Regrout two tubs', serviceAnswers: { a: 'Walk-up' }, answerLabels: { a: 'Elevator?' } }, estimate: { markupPct: 30, notes: 'secret margin' }, contractorAnswers: [{ question: 'COI?', answer: 'Yes' }] });
ok('the model sees the job and his earlier answers, never the markup or internal notes', JSON.stringify(ctxJob).indexOf('secret margin') === -1 && JSON.stringify(ctxJob).indexOf('markupPct') === -1 && ctxJob.contractorAnswersSoFar.length === 1 && ctxJob.customerAnswers[0].question === 'Elevator?');
ok('his answers are cleaned: empty ones dropped', cq.cleanAnswers([{ question: 'Q', answer: 'A' }, { question: 'Q2', answer: '' }]).length === 1);

/* ── the answers reach the generator, and a new one re-reads the job ── */
const GEN = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'), 'utf8');
ok('the generator input carries contractor.answers from record.contractorAnswers', /Object\.assign\(\{ extraRequest: cleanText\(body\.extraRequest\), houseRules: cleanText\(body\.houseRules\) \}, contractorAnswersFor\(record\)\)/.test(GEN));
ok('...and the analysis prompt names them as authoritative contractor notes', /contractor\.answers, when present, are his answers/.test(GEN));
const pin = require(path.join(ROOT, 'netlify/functions/lib/scope-pin'));
const base = { customer: { address: 'x' }, request: { description: 'd' }, contractor: { extraRequest: '', houseRules: '' } };
const withA = JSON.parse(JSON.stringify(base)); withA.contractor.answers = [{ question: 'COI?', answer: 'Yes' }];
ok('a record with no answers keeps its old fingerprint (no job re-read for nothing)', pin.scopeFingerprint(base) === pin.scopeFingerprint(JSON.parse(JSON.stringify(base))) && pin.scopeFingerprint(base) !== pin.scopeFingerprint(withA));

/* ── the endpoints save on the record, contractor only ── */
(async () => {
  const stores = {};
  const blobs = { getStore: (o) => { const n = o.name; const m = stores[n] = stores[n] || new Map(); return { get: async (k, t) => m.has(k) ? (t && t.type === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null, set: async (k, v) => m.set(k, String(v)), setJSON: async (k, v) => m.set(k, JSON.stringify(v)) }; } };
  const orig = Module._load;
  Module._load = function (req) { if (req === '@netlify/blobs') return blobs; return orig.apply(this, arguments); };
  process.env.DASHBOARD_KEY = 'k'.repeat(32);
  const fn = require(path.join(ROOT, 'netlify/functions/contractor-questions'));
  await blobs.getStore({ name: 'estimates' }).setJSON('SBC-1', { ref: 'SBC-1', contractorAnswers: [{ question: 'Old?', answer: 'x' }] });
  const H = { 'x-sbc-key': process.env.DASHBOARD_KEY };
  let r = await fn.handler({ httpMethod: 'POST', headers: H, body: JSON.stringify({ ref: 'SBC-1', answers: [{ id: 'q1', question: 'How capped?', answer: 'Cap above floor' }, { question: 'old?', answer: 'y' }] }) });
  const saved = JSON.parse(stores.estimates.get('SBC-1'));
  ok('answers are saved on the record; one answered again replaces its old answer', r.statusCode === 200 && saved.contractorAnswers.length === 2 && saved.contractorAnswers.some((a) => a.answer === 'y') && !saved.contractorAnswers.some((a) => a.answer === 'x'), JSON.stringify(saved.contractorAnswers));
  ok('...and the History tab gets a line', (saved.history || []).some((h) => /Answered 2 questions before pricing/.test(h.text)));
  r = await fn.handler({ httpMethod: 'GET', headers: H, queryStringParameters: { ref: 'SBC-1' } });
  ok('GET returns his saved answers with no questions yet', JSON.parse(r.body).status === 'none' && JSON.parse(r.body).answers.length === 2);

  /* ── the dashboard ── */
  ok('a "Questions before pricing" button on the Estimate tab, with the count answered', /'❓ Questions before pricing · ' \+ nAns \+ ' answered'/.test(DASH));
  ok('each screen: the question, its options with a star on the recommended one, Unsure, Other', /q\.options\.concat\(\['Unsure'\]\)/.test(DASH) && /k === q\.recommended \? '<span class="cq-star">★<\/span>'/.test(DASH) && /onclick="cqOther\(\)"><span>Other<\/span>/.test(DASH));
  ok('"Save and generate" saves first, then runs the generator', /await sbcFetch\('\/\.netlify\/functions\/contractor-questions', \{ method: 'POST'[\s\S]{0,900}generateAI\(hasPrice\(r\), false\)/.test(DASH));
  ok('the question text is escaped before it reaches the page', /'<h2>' \+ esc3\(\(q\.emoji/.test(DASH));

  /* progress */
  const g = DASH.slice(DASH.indexOf('var GEN_STAGE_PCT'), DASH.indexOf('function genProgressBar'));
  const c = {}; vm.createContext(c); vm.runInContext(g, c);
  ok('progress follows the stage: reading 5%, pricing 40%, scope 90%', c.genPct('Reading the job', 0) === 5 && c.genPct('Pricing the work', 0) === 40 && c.genPct('Writing the scope of work', 0) === 90);
  ok('inside a stage it creeps but never reaches the next stage, and never 100 before the end', c.genPct('Reading the job', 10 * 60000) === 24 && c.genPct('Writing the scope of work', 60 * 60000) === 98);
  ok('the button shows the percent and the stage; it never goes backwards', /lastPct = Math\.max\(lastPct, genPct\(stage, Date\.now\(\) - stageAt\)\)/.test(DASH));

  /* edit with AI */
  ok('Edit with AI sends through askSend (same chat, same before/after confirm on price changes)', /ask\.value = text;[\s\S]{0,600}await askSend\(\)/.test(DASH));
  ok('...on the Scope and Estimate tabs', /\['scope', 'estimate'\]\.forEach\(function\(k\)\{\s*var holder/.test(DASH));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
