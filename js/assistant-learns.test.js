/* assistant-learns.test.js — run: node js/assistant-learns.test.js
 *
 *   "let's each estimate has own AI assistant with own history, and use main
 *    brain and keep save in main memory ... the main brain can learn from my
 *    history too if he will analyze what customers accepted, what price for
 *    what job was accepted ... how long was takes this job ... how much i was
 *    charged for this job and how long i close it"
 *
 * Three pieces. lib/insights.js turns every record into what his history
 * shows (pure arithmetic). assistant-learn.js runs that nightly and stores
 * it. assistant.js reads it on every call, and now also saves every exchange
 * under the estimate's ref or under "global", and hands the history back.
 *
 * WHAT WOULD HURT: a wrong number in the history (it will be quoted to him as
 * fact); the internal notes riding into the insights; a history that
 * overwrites what he typed a minute ago; a learn endpoint anyone can hammer.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* ══ 1. THE ARITHMETIC ════════════════════════════════════════════════════ */
console.log('\nwhat his history shows, worked out from the records\n');
const I = require(path.join(ROOT, 'netlify/functions/lib/insights.js'));
const NOW = new Date('2026-09-19T12:00:00Z');
const REC = [
  { ref: 'SBC-A', status: 'completed', customer: { name: 'Maria' }, request: { service: 'Bathroom Renovation, Water Damage' },
    estimate: { markupPct: 0, notes: 'Internal band $9,000', labor: [{ qty: 1, unit: 'ls', rate: 12000 }], materials: [], completedAt: '2026-08-30T00:00:00Z' },
    sentAt: '2026-08-01T00:00:00Z', acceptedAt: '2026-08-05T00:00:00Z', invoices: [{ amount: 6000, status: 'paid' }, { amount: 6000, status: 'unpaid' }] },
  { ref: 'SBC-B', status: 'accepted', customer: { name: 'Ken' }, request: { service: 'Bathroom Renovation' },
    estimate: { markupPct: 0, labor: [{ qty: 1, unit: 'ls', rate: 8000 }], materials: [] }, sentAt: '2026-09-01T00:00:00Z', acceptedAt: '2026-09-11T00:00:00Z', invoices: [] },
  { ref: 'SBC-C', status: 'declined', customer: { name: 'Dora' }, request: { service: 'Painting' },
    estimate: { markupPct: 0, labor: [{ qty: 1, unit: 'ls', rate: 3000 }], materials: [] }, sentAt: '2026-09-02T00:00:00Z', declinedAt: '2026-09-03T00:00:00Z' },
  { ref: 'SBC-D', status: 'sent', customer: { name: 'Frank' }, request: { service: 'Painting' },
    estimate: { markupPct: 0, labor: [{ qty: 1, unit: 'ls', rate: 4000 }], materials: [] }, sentAt: '2026-09-05T00:00:00Z', thread: [{ from: 'customer', text: 'any update?' }] },
  { ref: 'SBC-E', status: 'sent', customer: { name: 'Sam' }, request: { service: 'Painting' },
    estimate: { markupPct: 0, labor: [{ qty: 1, unit: 'ls', rate: 4500 }], materials: [] }, sentAt: '2026-09-17T00:00:00Z' },
  { ref: 'SBC-F', status: 'new', customer: { name: 'New' }, request: { service: 'Carpentry' }, estimate: {} },
  null,
];
{
  const ins = I.buildInsights(REC, NOW);
  ok('COUNTS: 6 records, 5 sent, 2 accepted, 1 declined, 2 with no answer', ins.records === 6 && ins.sent === 5 && ins.accepted === 2 && ins.declined === 1 && ins.noAnswer === 2, JSON.stringify([ins.records, ins.sent, ins.accepted, ins.declined, ins.noAnswer]));
  ok('acceptance = accepted / (accepted + declined + no answer) = 2/5 = 40%', ins.acceptRate === 40, String(ins.acceptRate));
  ok('accepted work $20,000, paid so far $6,000 - only the PAID invoice counts', ins.acceptedValue === 20000 && ins.paidTotal === 6000);
  ok('DAYS: A took 4 to accept and 25 to finish; B 10 to accept - medians 7 and 25', ins.medianDaysToAccept === 7 && ins.medianDaysToComplete === 25, ins.medianDaysToAccept + ' / ' + ins.medianDaysToComplete);
  const bath = ins.services.find(s => s.service === 'Bathroom Renovation');
  ok('the kind of job is the service before the comma, so both bathrooms group together', !!bath && bath.count === 2, JSON.stringify(ins.services.map(s => s.service)));
  ok('...with its own accepted prices: median $10,000, lowest $8,000, highest $12,000, 100% accepted', bath.medianAccepted === 10000 && bath.lowestAccepted === 8000 && bath.highestAccepted === 12000 && bath.acceptRate === 100, JSON.stringify(bath));
  const paint = ins.services.find(s => s.service === 'Painting');
  ok('painting: 3 estimates, 0 accepted, 1 declined, 2 no answer -> 0%', paint.count === 3 && paint.accepted === 0 && paint.declined === 1 && paint.acceptRate === 0, JSON.stringify(paint));
  ok('FOLLOW-UPS: sent 5+ days ago with no answer - Frank (14d, and HE owes a reply), not Sam (2d)', ins.followUp.length === 1 && ins.followUp[0].ref === 'SBC-D' && ins.followUp[0].daysSinceSent === 14 && ins.followUp[0].waiting === true, JSON.stringify(ins.followUp));
  ok('recent accepted, newest first, with days and paid', ins.recentAccepted[0].ref === 'SBC-B' && ins.recentAccepted[1].ref === 'SBC-A' && ins.recentAccepted[1].daysToComplete === 25 && ins.recentAccepted[1].paid === 6000);
  const text = I.insightsText(ins);
  ok('THE TEXT SAYS IT IN ONE SCREEN', /6 estimates, 5 sent, 2 accepted, 1 declined, 2 sent with no answer\. Acceptance 40%/.test(text) && /Bathroom Renovation \| 2 \| 2 \/ 0 \/ 100% \| \$10,000 \[\$8,000-\$12,000\] \| 7 \| 25/.test(text) && /SBC-D \| Frank \| Painting \| \$4,000 \| 14d \(they wrote last - HE owes a reply\)/.test(text), text);
  ok('THE INTERNAL NOTES ARE NOT IN IT', JSON.stringify(ins).indexOf('9,000') === -1 && text.indexOf('Internal') === -1);
  ok('no records -> empty text, not a crash', I.insightsText(I.buildInsights([], NOW)) === '' && I.insightsText(null) === '');

  /*   "in which borough customers was, potentially in this borough customers
        are more reach and potentially they will accept this estimate" */
  console.log('\nwhere the customers are, and how each borough answers\n');
  const B = (addr) => I.boroughOf({ customer: { address: addr } });
  ok('ZIP FIRST: 10023 Manhattan, 11235 Brooklyn, 11354 Queens, 10456 Bronx, 10314 Staten Island, 11530 Long Island',
    /* addresses with the ZIP and NO borough word, so only the ZIP can decide */
    B('263 West End Ave 10023') === 'Manhattan' && B('3855 Shore Pkwy 11235') === 'Brooklyn' && B('Main St 11354') === 'Queens' && B('E 161st St, Bronx 10456') === 'Bronx' && B('Victory Blvd 10314') === 'Staten Island' && B('Garden City, NY 11530') === 'Long Island');
  ok('then names: Astoria is Queens, Upper West Side is Manhattan, Jersey City is New Jersey, Great Neck is Long Island',
    B('31-20 Ditmars Blvd, Astoria') === 'Queens' && B('Upper West Side apt') === 'Manhattan' && B('Jersey City, NJ') === 'New Jersey' && B('Great Neck') === 'Long Island');
  ok('"New York, NY" with no ZIP is Manhattan - that is how Manhattan customers write it', B('140 W 69th St, New York, New York') === 'Manhattan');
  ok('no address at all is Unknown, not a crash', B('') === 'Unknown' && I.boroughOf({}) === 'Unknown');
  ok('Brooklyn beats a stray "NY"', B('88 Bay 7th St, Brooklyn, NY') === 'Brooklyn');
  {
    const recs = [
      { ref: 'M1', status: 'accepted', customer: { name: 'a', address: 'New York, NY 10023' }, request: { service: 'Bathroom' }, estimate: { labor: [{ qty: 1, rate: 20000 }] }, sentAt: '2026-09-01T00:00:00Z', acceptedAt: '2026-09-03T00:00:00Z' },
      { ref: 'M2', status: 'accepted', customer: { name: 'b', address: 'Manhattan 10028' }, request: { service: 'Bathroom' }, estimate: { labor: [{ qty: 1, rate: 24000 }] }, sentAt: '2026-09-01T00:00:00Z', acceptedAt: '2026-09-03T00:00:00Z' },
      { ref: 'M3', status: 'sent', customer: { name: 'c', address: 'Harlem 10027' }, request: { service: 'Bathroom' }, estimate: { labor: [{ qty: 1, rate: 30000 }] }, sentAt: '2026-09-01T00:00:00Z' },
      { ref: 'Q1', status: 'declined', customer: { name: 'd', address: 'Astoria 11105' }, request: { service: 'Bathroom' }, estimate: { labor: [{ qty: 1, rate: 20000 }] }, sentAt: '2026-09-01T00:00:00Z', declinedAt: '2026-09-02T00:00:00Z' },
      { ref: 'Q2', status: 'accepted', customer: { name: 'e', address: 'Flushing 11354' }, request: { service: 'Bathroom' }, estimate: { labor: [{ qty: 1, rate: 9000 }] }, sentAt: '2026-09-01T00:00:00Z', acceptedAt: '2026-09-02T00:00:00Z' },
      { ref: 'B1', status: 'new', customer: { name: 'f', address: 'Brooklyn 11223' }, request: { service: 'Bathroom' }, estimate: {} },
    ];
    const ins = I.buildInsights(recs, NOW);
    const man = ins.boroughs.find(b => b.borough === 'Manhattan'), qns = ins.boroughs.find(b => b.borough === 'Queens'), bk = ins.boroughs.find(b => b.borough === 'Brooklyn');
    ok('MANHATTAN: 3 estimates, 2 accepted, 1 no answer -> 67%, accepted median $22,000, highest $24,000, median sent $24,000', man.count === 3 && man.accepted === 2 && man.noAnswer === 1 && man.acceptRate === 67 && man.medianAccepted === 22000 && man.highestAccepted === 24000 && man.medianSent === 24000, JSON.stringify(man));
    ok('QUEENS: 2 estimates, 1 accepted at $9,000, 1 declined at $20,000 -> 50%', qns.count === 2 && qns.accepted === 1 && qns.declined === 1 && qns.acceptRate === 50 && qns.medianAccepted === 9000, JSON.stringify(qns));
    ok('Brooklyn: 1 estimate never sent -> no rate', bk.count === 1 && bk.sent === 0 && bk.acceptRate === null);
    ok('biggest borough first', ins.boroughs[0].borough === 'Manhattan');
    const text = I.insightsText(ins);
    /* columns: accepted / declined / no answer / rate */
    ok('THE TEXT HAS THE BOROUGH TABLE', /BY BOROUGH/.test(text) && /Manhattan \| 3 \| 2 \/ 0 \/ 1 \/ 67% \| \$22,000, \$24,000 \| \$24,000 \| \$44,000/.test(text) && /Queens \| 2 \| 1 \/ 1 \/ 0 \/ 50%/.test(text), text.slice(text.indexOf('BY BOROUGH'), text.indexOf('BY BOROUGH') + 400));
    ok('...and each recent accepted job names its borough', /M2 \| b \| Bathroom, Manhattan \| \$24,000/.test(text), text.slice(text.indexOf('RECENT'), text.indexOf('RECENT') + 200));
  }
  const many = Array.from({ length: 300 }, (_, i) => ({ ref: 'SBC-' + i, status: 'accepted', customer: { name: 'Customer ' + i }, request: { service: 'Kind ' + (i % 40) }, estimate: { labor: [{ qty: 1, rate: 1000 + i }] }, sentAt: '2026-01-01T00:00:00Z', acceptedAt: '2026-01-0' + (1 + (i % 9)) + 'T00:00:00Z' }));
  ok('a big history is capped - 15 kinds, 15 recent, text under 5k', I.buildInsights(many, NOW).services.length === 15 && I.buildInsights(many, NOW).recentAccepted.length === 15 && I.insightsText(I.buildInsights(many, NOW)).length < 5000);
}

/* ══ stubs for the functions ═════════════════════════════════════════════ */
const STORES = { estimates: new Map(), 'assistant-memory': new Map(), 'assistant-chats': new Map() };
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return '@netlify/blobs'; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (opts) => {
  const m = STORES[opts.name] || (STORES[opts.name] = new Map());
  return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); }, list: async () => ({ blobs: Array.from(m.keys()).map((key) => ({ key })) }) };
} } };
const https = require('https');
let sent = null, reply = 'ok';
const sse = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
https.request = function (opts, cb) {
  const res = { statusCode: 200, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  return { on() { return this; }, write(b) { sent = JSON.parse(b); }, destroy() {}, end() { setImmediate(() => { cb(res); res._data(Buffer.from(sse({ type: 'message_start' }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: reply } }) + sse({ type: 'message_stop' }))); if (res._end) res._end(); }); } };
};
process.env.DASHBOARD_KEY = 'k';
process.env.ANTHROPIC_API_KEY = 'sk';
const learn = require(path.join(ROOT, 'netlify/functions/assistant-learn.js'));
const fn = require(path.join(ROOT, 'netlify/functions/assistant.js'));
const post = async (mod, body, headers) => { const r = await mod.handler({ httpMethod: 'POST', headers: headers === undefined ? { 'x-sbc-key': 'k' } : headers, body: JSON.stringify(body) }); return { code: r.statusCode, body: JSON.parse(r.body) }; };

(async function () {
  /* ══ 2. THE NIGHTLY JOB ════════════════════════════════════════════════ */
  console.log('\nassistant-learn: nightly, or by hand with the key\n');
  {
    REC.filter(Boolean).forEach(r => STORES.estimates.set(r.ref, JSON.stringify(r)));
    let r = await post(learn, {}, {});
    ok('A STRANGER GETS 401', r.code === 401 && !STORES['assistant-memory'].has('insights'));
    r = await post(learn, { next_run: '2026-09-20T09:30:00Z' }, {});
    ok('THE SCHEDULER RUNS IT AND THE INSIGHTS ARE STORED', r.code === 200 && r.body.ok === true && r.body.records === 6 && STORES['assistant-memory'].has('insights'), JSON.stringify(r.body));
    const stored = JSON.parse(STORES['assistant-memory'].get('insights'));
    ok('...the same numbers as the library gives', stored.accepted === 2 && stored.acceptRate === 40 && stored.followUp.length === 1);
    r = await post(learn, {});
    ok('the dashboard key runs it by hand too', r.code === 200 && r.body.records === 6);
    ok('it is on the nightly schedule in netlify.toml', /\[functions\."assistant-learn"\]\s*\n\s*schedule = "30 9 \* \* \*"/.test(fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8')));
    ok('it calls no AI - arithmetic only', !/anthropic|openai|api\.resend/i.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant-learn.js'), 'utf8')));
  }

  /* ══ 3. THE BRAIN READS IT ═════════════════════════════════════════════ */
  console.log('\nthe assistant reads the history on every call\n');
  {
    sent = null;
    await post(fn, { messages: [{ role: 'user', text: 'what do I usually get for a bathroom?' }] });
    const sys = sent.system;
    ok('WHAT HIS HISTORY SHOWS IS IN THE PROMPT', /WHAT HIS HISTORY SHOWS/.test(sys) && /Bathroom Renovation \| 2 \| 2 \/ 0 \/ 100% \| \$10,000/.test(sys) && /SBC-D \| Frank/.test(sys), sys.slice(sys.indexOf('WHAT HIS HISTORY'), sys.indexOf('WHAT HIS HISTORY') + 300));
    ok('...and it is told what it may do with it, and what it is not', /you may quote it/i.test(sys) && /History is not a price for a new job/.test(sys));
    STORES['assistant-memory'].delete('insights');
    sent = null;
    await post(fn, { messages: [{ role: 'user', text: 'hi' }] });
    ok('no insights yet -> no history section, and still an answer', sent.system.indexOf('WHAT HIS HISTORY SHOWS') === -1);
  }

  /* ══ 4. CHATS THAT STAY ════════════════════════════════════════════════ */
  console.log('\nevery exchange is saved under its chat, and comes back\n');
  {
    reply = 'Ask about the tile size.';
    let r = await post(fn, { chat: 'SBC-A', ref: 'SBC-A', messages: [{ role: 'user', text: 'what should I ask?' }] });
    ok('the answer still comes back', r.code === 200 && r.body.reply === 'Ask about the tile size.');
    let saved = JSON.parse(STORES['assistant-chats'].get('SBC-A') || '[]');
    ok('THE QUESTION AND THE ANSWER ARE SAVED UNDER THE ESTIMATE\'S REF', saved.length === 2 && saved[0].role === 'user' && saved[0].text === 'what should I ask?' && saved[1].role === 'assistant' && saved[1].text === 'Ask about the tile size.' && /^\d{4}-/.test(saved[1].at), JSON.stringify(saved));
    reply = 'Also the grout color.';
    await post(fn, { chat: 'SBC-A', ref: 'SBC-A', messages: [{ role: 'user', text: 'what should I ask?' }, { role: 'assistant', text: 'Ask about the tile size.' }, { role: 'user', text: 'anything else?' }] });
    saved = JSON.parse(STORES['assistant-chats'].get('SBC-A'));
    ok('the next exchange is APPENDED - only the new turn and its answer', saved.length === 4 && saved[2].text === 'anything else?' && saved[3].text === 'Also the grout color.');
    r = await post(fn, { action: 'history', chat: 'SBC-A' });
    ok('HISTORY COMES BACK FOR THAT CHAT', r.code === 200 && r.body.chat === 'SBC-A' && r.body.messages.length === 4 && r.body.messages[3].text === 'Also the grout color.', JSON.stringify(r.body).slice(0, 200));
    ok('...without touching Claude', (sent = null, true) && (await post(fn, { action: 'history', chat: 'SBC-A' })) && sent === null);
    r = await post(fn, { action: 'history', chat: 'nope' });
    ok('an unknown chat is simply empty', r.code === 200 && r.body.messages.length === 0);
    r = await post(fn, { action: 'history', chat: '../etc' });
    ok('a key with odd characters is refused', r.code === 400);
    r = await post(fn, { action: 'history', chat: 'SBC-A' }, {});
    ok('history needs the dashboard key like everything else', r.code === 401);
    await post(fn, { chat: 'global', messages: [{ role: 'user', text: 'plan my day' }] });
    ok('the drawer saves under "global", separate from the estimate', JSON.parse(STORES['assistant-chats'].get('global')).length === 2 && JSON.parse(STORES['assistant-chats'].get('SBC-A')).length === 4);
    await post(fn, { messages: [{ role: 'user', text: 'no chat key here' }] });
    ok('a call with no chat key saves nothing', !STORES['assistant-chats'].has('') && STORES['assistant-chats'].size === 2);
    for (let i = 0; i < 110; i++) await post(fn, { chat: 'BIG', messages: [{ role: 'user', text: 'q' + i }] });
    const big = JSON.parse(STORES['assistant-chats'].get('BIG'));
    ok('a chat is capped at 200 turns, newest kept', big.length === 200 && big[big.length - 2].text === 'q109' && big[big.length - 1].role === 'assistant', big.length + ' turns, last user turn ' + big[big.length - 2].text);
    ok('the page sends the last 30 turns, and the server reads 30', /slice\(-30\)/.test(fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8')) && /const TURNS_SENT = 30;/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant.js'), 'utf8')));
    ok('GET is still refused - history travels by POST', (await fn.handler({ httpMethod: 'GET', headers: {} })).statusCode === 405);
  }

  /* ══ 5. THE DASHBOARD LOADS IT BACK ════════════════════════════════════ */
  console.log('\nthe page loads the saved chat when a record or the drawer opens\n');
  {
    const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
    function ext(name) {
      const s = DASH.search(new RegExp('(?:async )?function ' + name + '\\s*\\('));
      if (s < 0) throw new Error('missing function ' + name);
      let d = 0;
      for (let j = DASH.indexOf('{', s); j < DASH.length; j++) { if (DASH[j] === '{') d++; else if (DASH[j] === '}') { d--; if (!d) return DASH.slice(s, j + 1); } }
      throw new Error('unbalanced ' + name);
    }
    ok('OPENING A RECORD LOADS ITS CHAT, after the record is drawn', /renderEdit\(\);[\s\S]{0,600}askLoadHistory\(ref\);/.test(ext('openEdit')));
    ok('the record panel saves under the ref', /chat: ref,/.test(ext('askSend')));
    ok('the drawer saves under "global"', /chat: "global",/.test(ext('aiSend')));
    ok('the drawer loads its history once, the first time it opens', /if \(!AI_LOADED\) \{ AI_LOADED = true; aiLoadHistory\(\); \}/.test(ext('aiOpen')));
    ok('there is a "My history" chip', /My history<\/button>/.test(DASH));

    const runs = [];
    const ctx = { String, JSON, Array, console, ASK_LOG: {}, AI_LOG: [], currentRecord: { ref: 'SBC-A' }, askRender: () => runs.push('askRender'), aiRender: () => runs.push('aiRender'), aiSave: () => {},
      sbcFetch: async (url, o) => { runs.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ messages: [{ role: 'user', text: 'old q' }, { role: 'assistant', text: 'old a' }] }) }; } };
    vm.createContext(ctx);
    vm.runInContext(ext('aiHistory') + '\n' + ext('askLoadHistory') + '\n' + ext('aiLoadHistory'), ctx);
    await vm.runInContext('askLoadHistory("SBC-A")', ctx);
    ok('askLoadHistory ASKS FOR THAT REF and fills the panel', runs[0] && runs[0].action === 'history' && runs[0].chat === 'SBC-A' && ctx.ASK_LOG['SBC-A'].length === 2 && runs.includes('askRender'), JSON.stringify(runs));
    ctx.ASK_LOG['SBC-B'] = [{ role: 'user', text: 'typed just now' }]; runs.length = 0;
    await vm.runInContext('askLoadHistory("SBC-B")', ctx);
    ok('IT NEVER OVERWRITES WHAT HE TYPED THIS SESSION - it does not even ask', runs.length === 0 && ctx.ASK_LOG['SBC-B'][0].text === 'typed just now');
    ctx.currentRecord = { ref: 'SBC-Z' }; runs.length = 0;
    await vm.runInContext('askLoadHistory("SBC-A2")', ctx);
    ok('a history arriving after he moved to another record is dropped', !ctx.ASK_LOG['SBC-A2']);
    runs.length = 0;
    await vm.runInContext('aiLoadHistory()', ctx);
    ok('the drawer loads "global" into an empty log', runs[0].chat === 'global' && ctx.AI_LOG.length === 2 && runs.includes('aiRender'));
    ctx.sbcFetch = async () => { throw new Error('offline'); }; ctx.ASK_LOG = {};
    await vm.runInContext('askLoadHistory("SBC-A")', ctx);
    ok('a failed load is silent - the panel just starts empty', !ctx.ASK_LOG['SBC-A']);

    const blocks = DASH.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    let broken = null;
    blocks.forEach(function (b, i) { try { new vm.Script(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; } });
    ok('all ' + blocks.length + ' script blocks parse', broken === null, broken || '');
    ok('every function file has a legal Netlify name', fs.readdirSync(path.join(ROOT, 'netlify/functions')).every(f => /^[A-Za-z0-9_-]+(\.m?js)?$/.test(f) || f === 'lib'));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e));
  process.exit(1);
});
