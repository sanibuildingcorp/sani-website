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
 *    10s with no usable error, so the request has to give up first and say
 *    something readable.
 *
 * The Claude call is stubbed at the https layer: what is under test is the
 * gate, the context, the guardrails in the prompt and the shape of the reply -
 * not Anthropic's servers.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* ── stub @netlify/blobs and capture the outbound Claude request ─────────── */
const STORE = new Map();
let sent = null, stubStatus = 200, stubBody = null, stubTimeout = false;

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === '@netlify/blobs') return '@netlify/blobs';
  return origResolve.call(this, request, ...rest);
};
require.cache['@netlify/blobs'] = {
  id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: {
    getStore: () => ({ get: async (k) => (STORE.has(k) ? JSON.parse(STORE.get(k)) : null) })
  }
};

const https = require('https');
const realRequest = https.request;
https.request = function (opts, cb) {
  const chunks = [];
  let timeoutFn = null;
  const res = {
    statusCode: stubStatus,
    _end: null,
    on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; }
  };
  return {
    setTimeout(ms, fn) { timeoutFn = fn; this._timeoutMs = ms; },
    on(ev, fn) { if (ev === 'error') this._err = fn; return this; },
    write(body) { sent = { opts, body: JSON.parse(body) }; },
    destroy(err) { if (this._err) this._err(err); },
    end() {
      if (stubTimeout) { if (timeoutFn) timeoutFn.call(this); return; }
      setImmediate(() => {
        cb(res);
        if (res._data) res._data(Buffer.from(stubBody != null ? stubBody : JSON.stringify({
          content: [{ type: 'text', text: '1. How old is the building?\n2. Is the bathroom in use right now? Not sure is fine.' }]
        })));
        if (res._end) res._end();
      });
    },
    _timeoutMs: 0
  };
};

process.env.DASHBOARD_KEY = 'test-key';
process.env.ANTHROPIC_API_KEY = 'sk-test';
const fn = require(path.join(ROOT, 'netlify/functions/assistant.js'));
https.request = https.request; /* keep the stub installed for the whole file */

const call = async (body, key) => {
  const res = await fn.handler({
    httpMethod: 'POST',
    headers: key === undefined ? { 'x-sbc-key': 'test-key' } : (key === null ? {} : { 'x-sbc-key': key }),
    body: JSON.stringify(body)
  });
  return { code: res.statusCode, body: JSON.parse(res.body || '{}') };
};

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

  /* ══ 3. TEN SECONDS ═════════════════════════════════════════════════════ */
  console.log('\nit gives up before Netlify kills it\n');
  {
    const src = fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant.js'), 'utf8');
    const ms = Number((src.match(/ABORT_MS\s*=\s*(\d+)/) || [])[1]);
    ok('THERE IS AN ABORT, AND IT IS UNDER TEN SECONDS', ms > 0 && ms < 10000, ms + 'ms');
    ok('the output is capped, so a long answer cannot run the clock out',
      Number((src.match(/MAX_TOKENS\s*=\s*(\d+)/) || [])[1]) <= 1500);

    stubTimeout = true;
    const slow = await call({ messages: [{ role: 'user', text: 'hi' }] });
    stubTimeout = false;
    ok('a slow call returns a readable message, not a platform kill',
      slow.code === 502 && /took too long/i.test(slow.body.error || ''), JSON.stringify(slow.body));
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
    ok('a long history is trimmed rather than allowed to run the clock out',
      sent.body.messages.length === 12 && sent.body.messages[11].content === 'q29',
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
    stubStatus = 429; stubBody = JSON.stringify({ error: { message: 'rate limit exceeded' } });
    const limited = await call({ messages: [{ role: 'user', text: 'hi' }] });
    ok('an API error is passed through in plain words',
      limited.code === 502 && /rate limit/i.test(limited.body.error || ''), JSON.stringify(limited.body));

    stubStatus = 200; stubBody = JSON.stringify({ content: [] });
    const blank = await call({ messages: [{ role: 'user', text: 'hi' }] });
    ok('an empty answer is reported, not shown as a blank bubble',
      blank.code === 502 && /returned nothing/i.test(blank.body.error || ''));
    stubBody = null;

    const bad = await fn.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'test-key' }, body: '{oops' });
    ok('an unreadable body is refused', bad.statusCode === 400);
    ok('GET is refused', (await fn.handler({ httpMethod: 'GET', headers: {} })).statusCode === 405);
    ok('the browser preflight is answered', (await fn.handler({ httpMethod: 'OPTIONS' })).statusCode === 200);
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
