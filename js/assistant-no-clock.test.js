/* assistant-no-clock.test.js — run: node js/assistant-no-clock.test.js
 *
 *   "I can only see what's already loaded on this estimate — I
 *    ... (cut short by the time limit — ask "continue" for the rest)"
 *
 * Two things in one screenshot. The answer was cut at 8.8 seconds by the
 * synchronous clock: it now runs in assistant-background with a job id and
 * the dashboard polls for the whole answer, the way a search already works.
 * And the assistant said it could not see emails: it is now told, in the
 * prompt, exactly what the inbox log holds for this customer - including
 * "none" - and told never to say it cannot see emails.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
function ext(name) {
  const s = DASH.search(new RegExp('(?:async )?function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = DASH.indexOf('{', s); j < DASH.length; j++) { if (DASH[j] === '{') d++; else if (DASH[j] === '}') { d--; if (!d) return DASH.slice(s, j + 1); } }
  throw new Error('unbalanced ' + name);
}

/* ── stubs: Blobs stores, a Claude that streams what we tell it (slowly when asked), Supabase ── */
const STORES = { estimates: new Map(), 'assistant-memory': new Map(), 'assistant-jobs': new Map(), 'assistant-chats': new Map() };
let sent = null, reply = 'Here is the whole answer, every word of it.', slowMs = 0;
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return '@netlify/blobs'; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (opts) => { const m = STORES[opts.name] || new Map(); return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); } }; } } };
const https = require('https');
const sse = (obj) => 'event: ' + obj.type + '\ndata: ' + JSON.stringify(obj) + '\n\n';
https.request = function (opts, cb) {
  const res = { statusCode: 200, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  let destroyed = false;
  return {
    on() { return this; }, write(body) { sent = JSON.parse(body); }, destroy() { destroyed = true; },
    end() {
      /* slowMs = how long Claude "thinks" before the first word. */
      setTimeout(() => {
        if (destroyed) return;
        cb(res);
        res._data(Buffer.from(sse({ type: 'message_start' })));
        reply.split(/(?<=\.)/).forEach((t) => { if (!destroyed) res._data(Buffer.from(sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } }))); });
        if (!destroyed) res._data(Buffer.from(sse({ type: 'message_stop' })));
        if (res._end) res._end();
      }, slowMs);
    },
  };
};
let emailRows = [];
global.fetch = async (url) => ({ ok: true, json: async () => (/lead_messages/.test(String(url)) ? emailRows : []) });
process.env.DASHBOARD_KEY = 'k'; process.env.ANTHROPIC_API_KEY = 'sk'; process.env.SUPABASE_URL = 'https://sb.example'; process.env.SUPABASE_SECRET_KEY = 'ss';
const fn = require(path.join(ROOT, 'netlify/functions/assistant.js'));
const bg = require(path.join(ROOT, 'netlify/functions/assistant-background.js'));
const post = async (h, body, headers) => { const r = await h.handler({ httpMethod: 'POST', headers: headers || { 'x-sbc-key': 'k' }, body: JSON.stringify(body) }); return { code: r.statusCode, body: JSON.parse(r.body) }; };
STORES.estimates.set('SBC-1', JSON.stringify({ ref: 'SBC-1', status: 'sent', customer: { name: 'Maria', email: 'Maria@Example.com' }, request: { service: 'Bath', description: 'gut' }, estimate: { projectTitle: 'Bath' }, thread: [] }));

(async () => {
  console.log('\nthe same answer, without the clock\n');
  {
    /* Claude takes 600ms to start; the sync function is given 300ms. */
    slowMs = 600; fn._setBudgetForTests(300);
    const cut = await post(fn, { ref: 'SBC-1', chat: 'SBC-1', messages: [{ role: 'user', text: 'what should I ask?' }] });
    ok('THE SYNCHRONOUS FUNCTION, ON ITS CLOCK, HAS NOTHING OR A PIECE - that is the screenshot', cut.code === 502 || cut.body.truncated === true, JSON.stringify(cut.body));
    fn._setBudgetForTests(8800);
    const r = await post(bg, { job: 'A-test0001', ref: 'SBC-1', chat: 'SBC-1', messages: [{ role: 'user', text: 'what should I ask?' }] });
    const job = JSON.parse(STORES['assistant-jobs'].get('A-test0001'));
    ok('THE BACKGROUND FUNCTION WAITS FOR THE WHOLE ANSWER and writes it to the job', r.code === 200 && job.status === 'done' && job.reply === 'Here is the whole answer, every word of it.' && job.truncated === false && Array.isArray(job.actions), JSON.stringify(job));
    ok('...the same context went to Claude (the job on screen, the customer)', /THE JOB ON SCREEN/.test(sent.system) && /Customer: Maria/.test(sent.system));
    ok('...and the turn was saved to the same chat', JSON.parse(STORES['assistant-chats'].get('SBC-1')).slice(-1)[0].text === 'Here is the whole answer, every word of it.');
    const polled = await post(fn, { action: 'job', id: 'A-test0001' });
    ok('the sync function hands the job back whole', polled.code === 200 && polled.body.status === 'done' && polled.body.reply === job.reply);
    slowMs = 0;
    reply = 'Opening it.\nACTION: {"type":"open","ref":"SBC-1"}';
    await post(bg, { job: 'A-test0002', messages: [{ role: 'user', text: 'open SBC-1' }] });
    const j2 = JSON.parse(STORES['assistant-jobs'].get('A-test0002'));
    ok('actions ride along in the job, off the text', j2.reply === 'Opening it.' && j2.actions.length === 1 && j2.actions[0].type === 'open' && j2.actions[0].ref === 'SBC-1', JSON.stringify(j2));
    reply = 'Here is the whole answer, every word of it.';
    const noKey = await bg.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ job: 'A-thief001', messages: [{ role: 'user', text: 'hi' }] }) });
    ok('CONTRACTOR ONLY: no key -> 401, no job written', noKey.statusCode === 401 && !STORES['assistant-jobs'].has('A-thief001'));
    const noJob = await post(bg, { messages: [{ role: 'user', text: 'hi' }] });
    ok('no job id -> 400', noJob.code === 400);
    const empty = await post(bg, { job: 'A-empty001', messages: [] });
    const je = JSON.parse(STORES['assistant-jobs'].get('A-empty001'));
    ok('nothing to answer -> the job says so as an error, not a hang', empty.code === 502 && je.status === 'error' && /Nothing to answer/.test(je.error));
    ok('the sync handler still answers directly (the fallback) with the same shape', (await post(fn, { messages: [{ role: 'user', text: 'hi' }] })).body.reply === 'Here is the whole answer, every word of it.');
    const A = fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant.js'), 'utf8');
    ok('one answer() for both, exported', /exports\.answer = answer;/.test(A) && /assistant\.answer\(body, \{ deadline: Date\.now\(\) \+ ANSWER_MS/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant-background.js'), 'utf8')));
  }

  console.log('\nit is told what the inbox holds for this customer, even when that is nothing\n');
  {
    emailRows = [];
    sent = null;
    await post(fn, { ref: 'SBC-1', messages: [{ role: 'user', text: 'can you find emails he sent me?' }] });
    ok('NO EMAILS -> THE PROMPT SAYS SO, with the address it looked for', /EMAILS WITH THIS CUSTOMER: none in the inbox log from maria@example\.com/.test(sent.system), (sent.system.match(/EMAILS WITH THIS CUSTOMER[^\n]*/) || [''])[0]);
    ok('...and the rule: answer from the list, say "none" when it says none, never "I cannot see emails"', /never say you cannot see emails/.test(sent.system) && /matched by the customer's email address/.test(sent.system));
    emailRows = [{ direction: 'in', subject: 'Requirements', body: 'Please use the quiet-close hinges. Last requirement: finish by October.', created_at: '2026-09-15T10:00:00Z', message_id: 'x1' }];
    sent = null;
    await post(fn, { ref: 'SBC-1', messages: [{ role: 'user', text: 'can you find emails he sent me?' }] });
    ok('with emails, they are listed', /EMAILS WITH THIS CUSTOMER \(from the inbox, oldest first\):\n  2026-09-15 Customer \[Requirements\]: Please use the quiet-close hinges/.test(sent.system));
    STORES.estimates.set('SBC-2', JSON.stringify({ ref: 'SBC-2', customer: { name: 'Ken', email: 'ken@example.com' }, request: {}, estimate: {}, thread: [{ id: 'x1', from: 'customer', text: 'Please use the quiet-close hinges.', at: '2026-09-15T10:00:00Z' }] }));
    sent = null;
    await post(fn, { ref: 'SBC-2', messages: [{ role: 'user', text: 'emails?' }] });
    ok('emails already on the thread are not listed twice, and that is said', /EMAILS WITH THIS CUSTOMER: the only ones in the inbox log are already in MESSAGES SO FAR above\./.test(sent.system));
  }

  console.log('\nthe page: start in the background, collect the answer, or fall back\n');
  {
    function page(plan) {
      const calls = [];
      const ctx = {
        String, JSON, Math, Date, Promise, Array, Object, Error, RegExp, console: { error() {} },
        sbcKey: () => 'k', setTimeout: (f) => f(),
        fetch: async (url, o) => { const body = JSON.parse(o.body); calls.push({ url, body, key: o.headers['x-sbc-key'] }); const step = plan.shift(); if (step === 'throw') throw new Error('offline'); return typeof step === 'function' ? step() : { ok: true, status: 200, text: async () => JSON.stringify(step) }; },
      };
      vm.createContext(ctx);
      vm.runInContext(ext('aiAnswerJobId') + '\n' + ext('aiAsk') + '\nvar AI_ANSWER_POLL_MS = 1, AI_ANSWER_POLLS = 3;', ctx);
      return { ctx, calls, ask: (p) => vm.runInContext('aiAsk(' + JSON.stringify(p) + ')', ctx) };
    }
    const started = () => ({ ok: false, status: 202, text: async () => '' });
    {
      const p = page([started, { status: 'running' }, { status: 'done', reply: 'The whole answer.', truncated: false, actions: [{ type: 'open', ref: 'SBC-1' }] }]);
      const out = await p.ask({ ref: 'SBC-1', chat: 'SBC-1', messages: [{ role: 'user', text: 'hi' }] });
      ok('IT STARTS assistant-background WITH A JOB ID, THE KEY, AND THE SAME PAYLOAD', /assistant-background/.test(p.calls[0].url) && /^A-/.test(p.calls[0].body.job) && p.calls[0].body.chat === 'SBC-1' && p.calls[0].body.messages.length === 1 && p.calls[0].key === 'k', JSON.stringify(p.calls[0].body));
      ok('...polls the same job until done, and returns the whole answer with its actions', p.calls[1].body.action === 'job' && p.calls[1].body.id === p.calls[0].body.job && p.calls.length === 3 && out.reply === 'The whole answer.' && out.truncated === false && out.actions.length === 1, JSON.stringify(out));
    }
    {
      const p = page([{ reply: 'Direct.', truncated: false, actions: [] }]);
      const out = await p.ask({ messages: [{ role: 'user', text: 'hi' }] });
      ok('a reply in the body is taken as the reply - no polling (the synchronous shape still works)', out.reply === 'Direct.' && p.calls.length === 1);
    }
    {
      const p = page([started, { status: 'error', error: 'Claude returned 529' }]);
      let err = ''; try { await p.ask({ messages: [{ role: 'user', text: 'hi' }] }); } catch (e) { err = e.message; }
      ok('a failed job surfaces its reason', /Claude returned 529/.test(err), err);
    }
    {
      const p = page([started, { status: 'running' }, { status: 'running' }, { status: 'running' }]);
      let err = ''; try { await p.ask({ messages: [{ role: 'user', text: 'hi' }] }); } catch (e) { err = e.message; }
      ok('after the poll limit it says so - it never spins forever', /taking too long/.test(err) && /reopen this chat/.test(err), err);
    }
    {
      const p = page([() => ({ ok: false, status: 502, text: async () => '<html>Task timed out</html>' })]);
      let err = ''; try { await p.ask({ messages: [{ role: 'user', text: 'hi' }] }); } catch (e) { err = e.message; }
      ok('a dead function still gets the plain sentence with the status code', /HTTP 502/.test(err) && /web page/.test(err), err);
    }
    ok('both panels ask through aiAsk', /await aiAsk\(\{ ref: ref, chat: ref/.test(ext('askSend')) && /await aiAsk\(\{ ref: currentRecord/.test(ext('aiSend')));
    ok('the record panel warns a long answer can take a minute', /a long answer can take up to a minute/.test(ext('askSend')));
    const blocks = DASH.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    let broken = null;
    blocks.forEach(function (b, i) { try { new vm.Script(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; } });
    ok('all ' + blocks.length + ' script blocks parse', broken === null, broken || '');
    ok('every function file has a legal Netlify name', fs.readdirSync(path.join(ROOT, 'netlify/functions')).every(f => /^[A-Za-z0-9_-]+(\.m?js)?$/.test(f) || f === 'lib'));
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
