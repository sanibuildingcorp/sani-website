/* assistant.test.js — run: node js/assistant.test.js
 *
 *   "sometimes the customers description is very low and need ask questions for
 *    clarification and collect more information ... a personal AI assistance
 *    where i can chat with him and where he can help me with anything ... and
 *    also send questions direct from this first section to the customer before
 *    generating any estimate."
 *
 * A contact-form lead arrives with whatever the customer felt like typing - the
 * test record that prompted this said "something for test". The estimate form at
 * least asks follow-ups; the contact form asks nothing. Pressing Generate on two
 * words produces an estimate made almost entirely of assumptions, and that only
 * becomes visible after it is written.
 *
 * THREE THINGS THIS FILE GUARDS, in the order they would hurt.
 *
 * 1. THE PANEL MUST NEVER SEND. It drafts questions; the contractor sends them,
 *    from the conversation box that already exists, after reading them. If
 *    "Copy to customer message" ever became "send", a question the contractor
 *    had not read would reach a customer - and he asked for this panel precisely
 *    because he wants to see everything before it goes out.
 *
 * 2. THE ENDPOINT MUST STAY GATED. Every call spends money. An open endpoint
 *    that bills the owner per request is worse than one that merely leaks: it
 *    can be run in a loop by anyone who finds the URL.
 *
 * 3. IT MUST ANSWER INSIDE TEN SECONDS. Netlify kills a synchronous function at
 *    10s with no usable error. The first version waited for the whole answer
 *    under a fixed 8.5s cap; on a real five-part renovation record the answer
 *    was longer than that, Netlify killed it, and Safari showed "The string did
 *    not match the expected pattern" - its wording for res.json() on a page that
 *    is not JSON. The answer is now streamed and whatever has arrived by the
 *    deadline is returned, marked truncated. That is what section 3 exercises.
 *
 * The Claude call is stubbed at the https layer as an SSE stream: what is under
 * test is the gate, the context, the guardrails, the deadline and the shape of
 * the reply - not Anthropic's servers.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* ── stub @netlify/blobs and capture the outbound Claude request ─────────── */
const STORE = new Map();
let sent = null;
/* What the stub streams back. frames: SSE events in order; stall: never end the
   stream after the frames; status/body: a non-2xx JSON error instead. */
let stub = { status: 200, body: null, frames: null, stall: false, slowStore: false };
const DEFAULT_TEXT = '1. How old is the building?\n2. Is the bathroom in use right now? Not sure is fine.';

const sse = (obj) => 'event: ' + obj.type + '\ndata: ' + JSON.stringify(obj) + '\n\n';
const deltas = (text) => text.split(/(?<= )/).map(t => ({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } }));
const fullStream = (text) => [{ type: 'message_start' }].concat(deltas(text), [{ type: 'message_stop' }]);

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === '@netlify/blobs') return '@netlify/blobs';
  return origResolve.call(this, request, ...rest);
};
require.cache['@netlify/blobs'] = {
  id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: {
    getStore: () => ({
      get: (k) => new Promise((resolve) => {
        const v = STORE.has(k) ? JSON.parse(STORE.get(k)) : null;
        if (stub.slowStore) setTimeout(() => resolve(v), 5000); else resolve(v);
      })
    })
  }
};

const https = require('https');
const realRequest = https.request;
https.request = function (opts, cb) {
  const res = { statusCode: stub.status, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  let destroyed = false;
  return {
    setTimeout() {},
    on(ev, fn) { if (ev === 'error') this._err = fn; return this; },
    write(body) { sent = { opts, body: JSON.parse(body) }; },
    destroy() { destroyed = true; },
    end() {
      setImmediate(() => {
        cb(res);
        if (stub.status < 200 || stub.status >= 300) {
          if (res._data) res._data(Buffer.from(stub.body || '{}'));
          if (res._end) res._end();
          return;
        }
        const frames = stub.frames || fullStream(DEFAULT_TEXT);
        /* One frame per tick, split mid-frame once, to prove the parser
           reassembles across chunk boundaries the way a real socket delivers. */
        let i = 0;
        const tick = () => {
          if (destroyed) return;
          if (i >= frames.length) { if (!stub.stall && res._end) res._end(); return; }
          const s = sse(frames[i++]);
          if (i === 2 && s.length > 10) {
            res._data(Buffer.from(s.slice(0, 7)));
            setImmediate(() => { if (!destroyed) { res._data(Buffer.from(s.slice(7))); setImmediate(tick); } });
          } else {
            res._data(Buffer.from(s));
            setImmediate(tick);
          }
        };
        tick();
      });
    },
  };
};

process.env.DASHBOARD_KEY = 'test-key';
process.env.ANTHROPIC_API_KEY = 'sk-test';
const fn = require(path.join(ROOT, 'netlify/functions/assistant.js'));

const call = async (body, key) => {
  const res = await fn.handler({
    httpMethod: 'POST',
    headers: key === undefined ? { 'x-sbc-key': 'test-key' } : (key === null ? {} : { 'x-sbc-key': key }),
    body: JSON.stringify(body)
  });
  return { code: res.statusCode, body: JSON.parse(res.body || '{}') };
};
const reset = () => { stub = { status: 200, body: null, frames: null, stall: false, slowStore: false }; fn._setBudgetForTests(8800); };

const THIN = {
  ref: 'SBC-260915-UYE6', status: 'new', source: 'contact-form',
  customer: { name: 'zurabi asanashvili', address: '3855 shore pkwy, Apt 1K, Brooklyn' },
  request: { service: 'Bathroom Renovation', description: 'test request', photos: [{ data: 'https://x/y.jpg', slot: 'wide' }] },
  estimate: { notes: 'Internal band $2,500-$3,500. Markup 25%.', scopeOfWork: '' }
};

(async function () {

  /* ══ 2. THE GATE ════════════════════════════════════════════════════════ */
  console.log('\nthe endpoint is contractor-only, because every call costs money\n');
  {
    const noKey = await call({ messages: [{ role: 'user', text: 'hi' }] }, null);
    ok('NO KEY IS REFUSED', noKey.code === 401, JSON.stringify(noKey.body));
    const badKey = await call({ messages: [{ role: 'user', text: 'hi' }] }, 'wrong');
    ok('a wrong key is refused', badKey.code === 401);
    ok('...and neither one reached Claude', sent === null);

    const src = fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant.js'), 'utf8');
    ok('it uses the shared gate rather than inventing its own',
      /require\("\.\/lib\/require-dashboard-key"\)/.test(src) && /requireDashboardKey\(event/.test(src));

    const good = await call({ messages: [{ role: 'user', text: 'hi' }] });
    ok('the right key gets through', good.code === 200 && !!good.body.reply, JSON.stringify(good.body).slice(0, 80));
  }

  /* ══ THE STREAM IS READ CORRECTLY ═══════════════════════════════════════ */
  console.log('\nthe streamed answer is reassembled exactly\n');
  {
    reset(); sent = null;
    const r = await call({ messages: [{ role: 'user', text: 'hi' }] });
    ok('THE REPLY IS EVERY DELTA, IN ORDER, WITH ITS SPACES', r.body.reply === DEFAULT_TEXT, JSON.stringify(r.body.reply));
    ok('a complete answer is not marked truncated', r.body.truncated === false);
    ok('it asks Claude to stream', sent.body.stream === true);

    /* A delta that is ONLY a space or a newline. The first draft ran every
       delta through str(), which trims - so "How old" + " " + "is" came out
       "How oldis". */
    stub.frames = fullStream('a b\nc');
    const sp = await call({ messages: [{ role: 'user', text: 'hi' }] });
    ok('WHITESPACE-ONLY DELTAS ARE KEPT — otherwise words are glued together',
      sp.body.reply === 'a b\nc', JSON.stringify(sp.body.reply));

    stub.frames = [{ type: 'message_start' }, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }];
    const er = await call({ messages: [{ role: 'user', text: 'hi' }] });
    ok('an error event inside the stream is reported in plain words',
      er.code === 502 && /Overloaded/.test(er.body.error || ''), JSON.stringify(er.body));
  }

  /* ══ 3. TEN SECONDS ═════════════════════════════════════════════════════ */
  console.log('\nit gives up before Netlify kills it, and hands over what it has\n');
  {
    const src = fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant.js'), 'utf8');
    const ms = Number((src.match(/BUDGET_MS\s*=\s*(\d+)/) || [])[1]);
    ok('THERE IS A BUDGET, AND IT IS UNDER TEN SECONDS', ms > 0 && ms < 10000, ms + 'ms');
    ok('it is measured from the start of the handler, not from the Claude call',
      /const started = Date\.now\(\)/.test(src) && /started \+ budgetMs/.test(src));
    ok('the output is capped, so a long answer cannot run the clock out',
      Number((src.match(/MAX_TOKENS\s*=\s*(\d+)/) || [])[1]) <= 1500);
    ok('the record read has its own, shorter, timeout',
      /withTimeout\(recordContext\(/.test(src) && Number((src.match(/RECORD_MS\s*=\s*(\d+)/) || [])[1]) < ms);

    /* THE CASE FROM THE SCREENSHOT: a long answer still being written at the
       deadline. Stream two deltas, then hang. */
    reset(); fn._setBudgetForTests(300);
    stub.frames = [{ type: 'message_start' }].concat(deltas('1. How old is the building? 2. Is'));
    stub.stall = true;
    const t0 = Date.now();
    const cut = await call({ messages: [{ role: 'user', text: 'What should I ask?' }] });
    const took = Date.now() - t0;
    ok('A STALLED ANSWER COMES BACK AS 200 WITH WHAT HAD ARRIVED — not a platform kill',
      cut.code === 200 && cut.body.reply === '1. How old is the building? 2. Is', JSON.stringify(cut.body));
    ok('...marked truncated, so the panel can say so', cut.body.truncated === true);
    ok('...and it returned at the deadline, not whenever the socket felt like it', took < 1500, took + 'ms');

    /* Nothing arrived at all. */
    reset(); fn._setBudgetForTests(300);
    stub.frames = [{ type: 'message_start' }]; stub.stall = true;
    const slow = await call({ messages: [{ role: 'user', text: 'hi' }] });
    ok('a stream that never says anything is a readable timeout',
      slow.code === 502 && /took too long/i.test(slow.body.error || ''), JSON.stringify(slow.body));

    /* Blobs is slow: the record is skipped and the question still gets answered. */
    reset(); stub.slowStore = true; sent = null;
    STORE.set(THIN.ref, JSON.stringify(THIN));
    const t1 = Date.now();
    const noRec = await call({ ref: THIN.ref, messages: [{ role: 'user', text: 'hi' }] });
    ok('a slow record read is abandoned rather than spending the budget on it',
      noRec.code === 200 && !!noRec.body.reply && (Date.now() - t1) < 3000 && /No job is open/.test(sent.body.system),
      (Date.now() - t1) + 'ms');
    reset();
  }

  /* ══ WHAT THE ASSISTANT IS TOLD ═════════════════════════════════════════ */
  console.log('\nit knows about the job on screen, but not the contractor\'s costs\n');
  {
    STORE.set(THIN.ref, JSON.stringify(THIN));
    sent = null;
    await call({ ref: THIN.ref, messages: [{ role: 'user', text: 'What should I ask this customer?' }] });
    const sys = sent.body.system;
    ok('the customer\'s own words are in the context', sys.indexOf('test request') !== -1);
    ok('so is the service and the address',
      sys.indexOf('Bathroom Renovation') !== -1 && sys.indexOf('3855 shore pkwy') !== -1);
    ok('and that the contact form asked no follow-ups — which is WHY the description is thin',
      /contact form \(no follow-up questions were asked\)/.test(sys));
    ok('THE INTERNAL PRICE BAND IS NOT SENT — these answers get read out to customers',
      sys.indexOf('2,500') === -1 && sys.indexOf('Markup') === -1, 'internal notes leaked into the prompt');

    ok('the house wording rules travel with every call',
      /never use the word 'licensed'/i.test(sys) && /Never mention TV mounting/i.test(sys));
    ok('...including never inventing a price',
      /Never invent a price/i.test(sys));
    ok('...and offering "Not sure", because his customers often do not know',
      /Not sure/.test(sys));
    ok('it is told to answer anything, not only estimate questions',
      /unrelated to the job on screen/i.test(sys));
    ok('it is told to keep answers short — the clock is the reason',
      /under about 150 words/i.test(sys));
  }

  /* ══ THE CONVERSATION ═══════════════════════════════════════════════════ */
  console.log('\nit is a conversation, not a series of unrelated questions\n');
  {
    sent = null;
    await call({
      ref: THIN.ref,
      messages: [
        { role: 'user', text: 'What should I ask?' },
        { role: 'assistant', text: '1. How old is the building?' },
        { role: 'user', text: 'Make it shorter' }
      ]
    });
    ok('every turn is passed through, in order', sent.body.messages.length === 3 &&
      sent.body.messages[2].content === 'Make it shorter');
    ok('roles are preserved so the model knows which side said what',
      sent.body.messages.map(m => m.role).join(',') === 'user,assistant,user');

    sent = null;
    const many = Array.from({ length: 30 }, (_, i) => ({ role: 'user', text: 'q' + i }));
    await call({ ref: THIN.ref, messages: many });
    /* 12 at first; raised to 30 when he asked for more. Input is cheap in time. */
    ok('a long history is trimmed rather than allowed to run the clock out',
      sent.body.messages.length === 30 && sent.body.messages[29].content === 'q29',
      sent.body.messages.length + ' turns sent');

    const empty = await call({ ref: THIN.ref, messages: [] });
    ok('an empty question is refused rather than billed', empty.code === 400);

    sent = null;
    const noRef = await call({ messages: [{ role: 'user', text: 'what is a good markup for tile work' }] });
    ok('IT STILL WORKS WITH NO JOB OPEN — he asked for an assistant, not an estimate tool',
      noRef.code === 200 && !!noRef.body.reply);
    ok('...and says so in the context', /No job is open/.test(sent.body.system));
  }

  /* ══ WHEN CLAUDE MISBEHAVES ═════════════════════════════════════════════ */
  console.log('\nfailures say something he can act on\n');
  {
    reset();
    stub.status = 429; stub.body = JSON.stringify({ error: { message: 'rate limit exceeded' } });
    const limited = await call({ messages: [{ role: 'user', text: 'hi' }] });
    ok('an API error is passed through in plain words',
      limited.code === 502 && /rate limit/i.test(limited.body.error || ''), JSON.stringify(limited.body));

    reset();
    stub.frames = [{ type: 'message_start' }, { type: 'message_stop' }];
    const blank = await call({ messages: [{ role: 'user', text: 'hi' }] });
    ok('an empty answer is reported, not shown as a blank bubble',
      blank.code === 502 && /returned nothing/i.test(blank.body.error || ''));
    reset();

    const bad = await fn.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'test-key' }, body: '{oops' });
    ok('an unreadable body is refused', bad.statusCode === 400);
    ok('GET is refused', (await fn.handler({ httpMethod: 'GET', headers: {} })).statusCode === 405);
    ok('the browser preflight is answered', (await fn.handler({ httpMethod: 'OPTIONS' })).statusCode === 200);
  }

  /* ══ THE DASHBOARD SIDE OF THE SAME BUG ═════════════════════════════════ */
  console.log('\nthe panel reads the reply as text first, so a dead function gets a real message\n');
  {
    const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
    const s = DASH.search(/async function askSend\s*\(/);
    let d = 0, body = '';
    for (let j = DASH.indexOf('{', s); j < DASH.length; j++) {
      if (DASH[j] === '{') d++;
      else if (DASH[j] === '}') { d--; if (!d) { body = DASH.slice(s, j + 1); break; } }
    }
    /* The fetching moved into aiAsk, which both panels share; askSend keeps
       the truncated note. Comments stripped first: the code explains the bug
       in a comment that names res.json(), and a search over the raw body
       found that and failed. */
    const a = DASH.search(/async function aiAsk\s*\(/);
    let d2 = 0, ask = '';
    for (let j = DASH.indexOf('{', a); j < DASH.length; j++) {
      if (DASH[j] === '{') d2++;
      else if (DASH[j] === '}') { d2--; if (!d2) { ask = DASH.slice(a, j + 1); break; } }
    }
    const code = (body + ask).replace(/\/\*[\s\S]*?\*\//g, '');
    ok('THE ASSISTANT CALL NO LONGER USES res.json() — that is what produced "did not match the expected pattern"',
      code.indexOf('res.json()') === -1 && code.indexOf('await res.text()') !== -1 && /await aiAsk\(/.test(body));
    ok('a non-JSON body becomes a sentence with the status code in it',
      /No answer came back \(HTTP " \+ res\.status/.test(ask));
    ok('a truncated reply is shown as truncated, with a way to get the rest',
      /data\.truncated/.test(body) && /continue/.test(body));

    /* Run it against a fetch that returns Netlify's dead-function page. */
    const log = {};
    const ctx = {
      console: { error() {} }, String, JSON, Error, RegExp, Object, Math, Date, Array, Promise, setTimeout: (f) => f(),
      currentRecord: { ref: 'R1' }, ASK_LOG: log, sbcKey: () => 'k',
      askRender() {},
      document: { getElementById: (id) => id === 'ask-text' ? { value: 'What should I ask?' } : { textContent: '', disabled: false } },
      fetch: async () => ({ ok: false, status: 502, text: async () => '<html><body>Task timed out</body></html>' }),
    };
    vm.createContext(ctx);
    vm.runInContext(body + '\n' + ask + '\nfunction aiAnswerJobId(){return "A-test01"}', ctx);
    await vm.runInContext('askSend()', ctx);
    const last = (log.R1 || []).slice(-1)[0] || {};
    ok('THE PANEL SHOWS WHAT HAPPENED, NOT SAFARI\'S PATTERN ERROR',
      /HTTP 502/.test(last.text || '') && /web page/.test(last.text || '') && /shorter/.test(last.text || ''), last.text);

    ctx.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ reply: '1. How old?', truncated: true }) });
    await vm.runInContext('askSend()', ctx);
    const cut = (log.R1 || []).slice(-1)[0] || {};
    ok('a truncated reply carries the note', /1\. How old\?/.test(cut.text) && /cut short/.test(cut.text), cut.text);

    ctx.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ reply: '1. How old?', truncated: false }) });
    await vm.runInContext('askSend()', ctx);
    const whole = (log.R1 || []).slice(-1)[0] || {};
    ok('a whole reply carries no note', whole.text === '1. How old?', whole.text);
  }

  /* ══ 1. THE ONE THAT WOULD HURT MOST ════════════════════════════════════ */
  console.log('\nthe panel drafts; the contractor sends\n');
  {
    const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');

    ok('the panel is rendered inside the customer request card',
      /askPanelHtml\(r\) \+/.test(DASH) &&
      DASH.indexOf('askPanelHtml(r) +') > DASH.indexOf("'<div class=\"cust-photos\">'"),
      'panel is not between the photos and the generator');
    ok('...and above the Generate button, where the decision is actually made',
      DASH.indexOf('askPanelHtml(r) +') < DASH.indexOf('AI ESTIMATE GENERATOR'));

    /* Run the real copy-to-customer handler. */
    const s = DASH.search(/function askCopyToCustomer\s*\(/);
    let d = 0, body = '';
    for (let j = DASH.indexOf('{', s); j < DASH.length; j++) {
      if (DASH[j] === '{') d++;
      else if (DASH[j] === '}') { d--; if (!d) { body = DASH.slice(s, j + 1); break; } }
    }
    /* CHECKED BEFORE THE FUNCTION IS RUN, ON PURPOSE. When this assertion sat
       below the execution instead, planting a fetch() into the function made the
       whole file CRASH - the vm context has no fetch - and a crash prints no
       FAIL line at all. It read as "the plant caught nothing" when in fact the
       suite had died on the line before. A guard against sending must be legible
       as a failure, not as silence. */
    ok('IT DOES NOT SEND — no call to thread-reply, no fetch, anywhere in it',
      body.indexOf('thread-reply') === -1 && body.indexOf('fetch(') === -1,
      (body.match(/.*(?:thread-reply|fetch\().*/) || [''])[0].trim());

    let toasted = '', focused = false, scrolled = false;
    const box = { value: '', focus() { focused = true; } };
    const ctx = {
      console, String,
      currentRecord: { ref: 'R1' },
      ASK_LOG: { R1: [{ role: 'user', text: 'What should I ask?' }, { role: 'assistant', text: '1. How old is the building?' }] },
      toast: (t) => { toasted = t; },
      document: { getElementById: (id) => id === 'cnv-text' ? box : (id === 'cnv-section' ? { scrollIntoView() { scrolled = true; } } : null) }
    };
    vm.createContext(ctx);
    vm.runInContext(body, ctx);

    vm.runInContext('askCopyToCustomer(1)', ctx);
    ok('COPYING PUTS THE TEXT IN THE CUSTOMER BOX', box.value.indexOf('How old is the building') !== -1, box.value);
    ok('...and scrolls him to it so he reads it', scrolled && focused);
    ok('...and the toast tells him he still has to press Send',
      /press Send reply/i.test(toasted), toasted);

    box.value = 'Hi Mike,';
    vm.runInContext('askCopyToCustomer(1)', ctx);
    ok('copying twice appends rather than wiping what he already typed',
      box.value.indexOf('Hi Mike,') === 0 && box.value.indexOf('How old') !== -1, box.value);

    vm.runInContext('askCopyToCustomer(0)', ctx);
    ok('his OWN question cannot be copied to the customer — only the answer',
      box.value.indexOf('What should I ask?') === -1);

    ok('the panel says in writing that nothing is sent',
      /Nothing here is sent to the customer/.test(DASH));
    ok('the send button on the panel says "Ask", not "Send"',
      /id="ask-btn" onclick="askSend\(\)">Ask</.test(DASH));
  }

  console.log('\nevery script block in dashboard.html still parses\n');
  {
    const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
    const blocks = DASH.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    let broken = null;
    blocks.forEach(function (b, i) {
      try { new vm.Script(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); }
      catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; }
    });
    ok('all ' + blocks.length + ' blocks parse', broken === null, broken || '');
  }

  https.request = realRequest;
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  /* A thrown error used to print nothing at all - no FAIL line, no count - so a
     planted bug that crashed the harness looked exactly like a planted bug the
     harness had failed to notice. Anything that escapes is a failure now. */
  console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e));
  console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed\n');
  process.exit(1);
});
