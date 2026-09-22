/* assistant-says-yes.test.js — run: node js/assistant-says-yes.test.js
 *
 *   He: "Customer decided without the painting service ... double check if
 *        there is still anything for painting and remove it"
 *   AI: "... Bathroom card still has one line: 'Patch and touch-up paint at
 *        walls and trim'. That's a leftover to fix. Fixing the summary line
 *        now to drop 'Painting'."                         <- no ACTION sent
 *   He: "Okay go and fix it"
 *   AI: "Now I see the actual layout clearly. The apartment is 2 bed / 2
 *        bath ... What specifically did you want fixed?"  <- read the photos
 *
 * Two failures, two backstops. (1) An answer that says it is fixing and
 * sends no ACTION is asked once more, in the same conversation, for the
 * ACTION lines only. (2) A short yes ("ok", "go and fix it", "do it") is a
 * yes to the last answer: the job's photos stay off that turn and the
 * message says what the yes means.
 */
const fs = require('fs'), path = require('path'), Module = require('module');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const STORES = {};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return request; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (o) => { const m = STORES[o.name] || (STORES[o.name] = new Map()); return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } }; } } };
const https = require('https');
let calls = [], replies = [];
const sse = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
https.request = function (opts, cb) {
  const res = { statusCode: 200, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  return { on() { return this; }, write(b) { calls.push(JSON.parse(b)); }, destroy() {}, end() { setImmediate(() => { const text = replies.length ? replies.shift() : 'ok'; cb(res); res._data(Buffer.from(sse({ type: 'message_start' }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text } }) + sse({ type: 'message_stop' }))); if (res._end) res._end(); }); } };
};
process.env.DASHBOARD_KEY = 'k'; process.env.ANTHROPIC_API_KEY = 'sk';
const fn = require(path.join(ROOT, 'netlify/functions/assistant.js'));
const bg = require(path.join(ROOT, 'netlify/functions/assistant-background.js'));
const SRC = fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant.js'), 'utf8');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const REC = {
  ref: 'SBC-260501-MAYB', status: 'sent', updatedAt: '2026-09-21T10:00:00Z',
  customer: { name: 'May Chen', address: '100 Riverside Blvd' },
  request: { service: 'Bathroom', description: 'Bathroom upgrade.', photos: [{ name: 'plan.png', kind: 'image', data: 'data:image/png;base64,' + PNG }, { name: 'plan2.png', kind: 'image', data: 'data:image/png;base64,' + PNG }] },
  estimate: { projectTitle: 'Primary Bath Upgrade', summary: 'Bathroom upgrade and painting of the hallway.', markupPct: 25, labor: [{ item: 'Tile work', qty: 40, unit: 'hrs', rate: 60, section: 'Bathroom' }], materials: [],
    serviceBreakdown: [{ title: 'Bathroom', included: ['Remove the tub', 'Patch and touch-up paint at walls and trim'], customerSupplies: [], notIncluded: [], subtotal: 3000 }] },
};
STORES.estimates = new Map(); STORES.estimates.set(REC.ref, JSON.stringify(REC));
const lastText = (payload) => { const c = payload.messages[payload.messages.length - 1].content; return typeof c === 'string' ? c : c.filter((b) => b.type === 'text').map((b) => b.text).join('\n'); };
const lastImages = (payload) => { const c = payload.messages[payload.messages.length - 1].content; return typeof c === 'string' ? 0 : c.filter((b) => b.type === 'image').length; };
const ask = (messages, job) => bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job, ref: REC.ref, chat: REC.ref + '-' + job, messages }) });
const result = (job) => JSON.parse(STORES['assistant-jobs'].get(job));

const CLAIM = "Painting's already gone - one card: **Bathroom, $3,750.00**.\nChecked for leftover painting mentions:\n- Bathroom card still has one line: \"Patch and touch-up paint at walls and trim\". That's a leftover to fix.\n- The summary still says painting.\n\nFixing the summary line now to drop \"Painting\" since that work is no longer part of this job.";
const FIX = 'Done.\nACTION: {"type":"reword","ref":"SBC-260501-MAYB","edits":[{"where":"included","service":"Bathroom","from":"Patch and touch-up paint at walls and trim","to":""},{"where":"summary","from":"Bathroom upgrade and painting of the hallway.","to":"Bathroom upgrade."}]}';

(async () => {
  console.log('\n1. What counts as a yes, and what counts as a claim\n');
  {
    ok('a short yes', ['Okay go and fix it', 'ok', 'Yes', 'go ahead', 'do it', 'fix it', 'Okay, do it now', 'yes please', 'go', 'apply it', 'please fix it', 'ok remove them'].every((t) => fn._isConfirmation(t) === true), ['Okay go and fix it', 'ok', 'Yes', 'go ahead', 'do it', 'fix it', 'Okay, do it now', 'yes please', 'go', 'apply it', 'please fix it', 'ok remove them'].filter((t) => !fn._isConfirmation(t)).join(' | '));
    ok('not a yes: a question, a new request, a long sentence', ['ok but what about the tiles?', 'Customer decided without the painting service, remove it', 'fix the timeline to two weeks', 'is it fixed?', 'go to the sent tab', ''].every((t) => fn._isConfirmation(t) === false), ['ok but what about the tiles?', 'Customer decided without the painting service, remove it', 'fix the timeline to two weeks', 'is it fixed?', 'go to the sent tab'].filter((t) => fn._isConfirmation(t)).join(' | '));
    ok('a claim to act: "Fixing ... now", "Removing the line", "I\'ll drop it"', fn._claimsToAct(CLAIM) === true && fn._claimsToAct('Removing the leftover line from the Bathroom card.') === true && fn._claimsToAct("I'll drop 'Painting' from the summary.") === true && fn._claimsToAct('Let me update the summary.') === true);
    ok('not a claim: nothing to fix, a suggestion, a question, a done answer', fn._claimsToAct('Matches. Nothing to change.') === false && fn._claimsToAct('You should fix the tile line yourself; it is money.') === false && fn._claimsToAct('Painting is gone. One card: Bathroom $3,750.00.') === false && fn._claimsToAct('Done. Two edits.') === false);
  }

  console.log('\n2. "Fixing the summary line now" with no ACTION: asked once more for the ACTION, which rides with the first words\n');
  {
    calls = []; replies = [CLAIM, FIX];
    await ask([{ role: 'user', text: 'Customer decided without painting. Double check if there is still anything for painting and remove it' }], 'A-yes001');
    const r = result('A-yes001');
    ok('TWO CALLS: the answer, then the nudge', calls.length === 2, String(calls.length));
    ok('THE NUDGE is the same conversation plus the answer and one user line asking for the ACTION only', calls[1].messages.length === 3 && calls[1].messages[1].role === 'assistant' && calls[1].messages[1].content === CLAIM && calls[1].messages[2].role === 'user' && /You wrote that you are fixing it, but there is no ACTION line, so nothing changed\. Send now the ACTION line\(s\)/.test(calls[1].messages[2].content), JSON.stringify(calls[1].messages.map((m) => m.role)));
    ok('THE RESULT: the first answer\'s words, with the reword from the second - two edits, the paint line removed and the summary fixed', r.status === 'done' && /Fixing the summary line now/.test(r.reply) && r.actions.length === 1 && r.actions[0].type === 'reword' && r.actions[0].edits.length === 2 && r.actions[0].edits[0].to === '' && r.actions[0].edits[1].where === 'summary', JSON.stringify(r.actions));
    const saved = JSON.parse(STORES['assistant-chats'].get(REC.ref + '-A-yes001'));
    ok('the saved chat has one exchange, not the nudge', saved.length === 2 && saved[1].role === 'assistant');
  }
  {
    calls = []; replies = ['Matches. Nothing to change.'];
    await ask([{ role: 'user', text: 'anything left for painting?' }], 'A-yes002');
    ok('an answer with nothing to fix: one call, no nudge', calls.length === 1 && result('A-yes002').actions.length === 0);
    calls = []; replies = [FIX];
    await ask([{ role: 'user', text: 'remove the painting leftovers' }], 'A-yes003');
    ok('an answer that already carries the ACTION: one call', calls.length === 1 && result('A-yes003').actions.length === 1);
    calls = []; replies = [CLAIM, 'Sorry, I cannot.'];
    await ask([{ role: 'user', text: 'remove the painting leftovers' }], 'A-yes004');
    ok('a nudge that still brings no ACTION: the first answer stands, no crash', calls.length === 2 && result('A-yes004').status === 'done' && result('A-yes004').actions.length === 0 && /Fixing the summary/.test(result('A-yes004').reply));
  }

  console.log('\n3. "Okay go and fix it": a yes to the last answer, no photos re-shown, the note says what it means\n');
  {
    calls = []; replies = [FIX];
    await ask([{ role: 'user', text: 'check if anything is left for painting' }, { role: 'assistant', text: CLAIM }, { role: 'user', text: 'Okay go and fix it' }], 'A-yes005');
    const last = calls[0].messages[calls[0].messages.length - 1];
    ok('NO JOB PHOTOS on the yes turn (the job has two)', lastImages(calls[0]) === 0, String(lastImages(calls[0])));
    ok('THE NOTE on his message: he is saying yes to your last answer, do it now as ACTION lines, do not describe the photos', /\[HE IS SAYING YES TO YOUR LAST ANSWER\. Do exactly what you said there, now, as ACTION lines/.test(typeof last.content === 'string' ? last.content : lastText(calls[0])) && /Do not describe the photos, do not re-check, do not ask what he meant\.\]/.test(typeof last.content === 'string' ? last.content : lastText(calls[0])), typeof last.content === 'string' ? last.content.slice(-300) : lastText(calls[0]).slice(-300));
    ok('...the glance still rides before it', /\[ESTIMATE RIGHT NOW \(SBC-260501-MAYB/.test(typeof last.content === 'string' ? last.content : lastText(calls[0])));
    ok('...and the reword comes back', result('A-yes005').actions.length === 1 && result('A-yes005').actions[0].type === 'reword');
    calls = []; replies = ['Photo 1 shows the plan.'];
    await ask([{ role: 'user', text: 'what do the photos show?' }], 'A-yes006');
    ok('a real question still gets the job photos (two) and no yes-note', lastImages(calls[0]) === 2 && !/HE IS SAYING YES/.test(lastText(calls[0])));
    calls = []; replies = ['ok'];
    await ask([{ role: 'user', text: 'ok' }], 'A-yes007');
    ok('a bare "ok" with no earlier answer to say yes to is an ordinary message: photos shown, no note', lastImages(calls[0]) === 2 && !/HE IS SAYING YES/.test(lastText(calls[0])));
  }

  console.log('\n4. The rule is in the prompt too\n');
  {
    ok('WORDS ALONE CHANGE NOTHING, and a yes means the last answer', /WORDS ALONE CHANGE NOTHING\. 'Fixing the summary now', 'removing that line', 'I'll drop it' do nothing unless the ACTION line is in the same answer/.test(SRC) && /When he answers 'yes', 'ok', 'go', 'do it', 'go and fix it' to your last answer, he means exactly what you proposed there: send those ACTION lines now, do not describe the photos again/.test(SRC));
    ok('the nudge runs only with clock left, never on a truncated answer', /out\.truncated !== true && claimsToAct\(parsed\.text\) && deadline - Date\.now\(\) > NUDGE_MIN_MS/.test(SRC));
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
