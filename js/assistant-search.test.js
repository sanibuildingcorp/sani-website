/* assistant-search.test.js — run: node js/assistant-search.test.js
 *
 *   "Add internet search to the assistant like you said"
 *
 * A web search takes longer than a sync function has, so it is an ACTION:
 * the sync assistant says "checking online" and returns {type:"search"};
 * the dashboard starts assistant-search-background with a job id and polls
 * {action:"job"}; the background function asks Claude with the web search
 * tool, stores the job, and appends the answer to the chat.
 *
 * WHAT WOULD HURT: a search anyone can trigger (it costs money); an answer
 * that never reaches the chat; a found price turned into a quote; the
 * placeholder bubble never replaced, so he thinks it hung.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* ── stubs ─────────────────────────────────────────────────────────────── */
const STORES = {};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return '@netlify/blobs'; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (opts) => {
  const m = STORES[opts.name] || (STORES[opts.name] = new Map());
  return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); }, list: async () => ({ blobs: [] }) };
} } };
const https = require('https');
let sent = null, mode = 'sse', reply = 'ok', apiStatus = 200, apiBody = null;
const sse = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
const SEARCH_MSG = { content: [
  { type: 'server_tool_use', name: 'web_search', input: { query: 'Kohler Cimarron toilet price Home Depot' } },
  { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://www.homedepot.com/x', title: 'HD' }, { type: 'web_search_result', url: 'https://ignored.example/y', title: 'ignored' }] },
  { type: 'text', text: 'Home Depot lists the Kohler Cimarron at $329', citations: [{ type: 'web_search_result_location', url: 'https://www.homedepot.com/x', title: 'HD' }] },
  { type: 'text', text: '; Lowe\'s has it at $319.', citations: [{ type: 'web_search_result_location', url: 'https://www.lowes.com/y' }, { type: 'web_search_result_location', url: 'https://www.homedepot.com/x' }] },
] };
https.request = function (opts, cb) {
  const res = { statusCode: apiStatus, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  return { on() { return this; }, setTimeout() {}, write(b) { sent = JSON.parse(b); }, destroy() {}, end() { setImmediate(() => {
    cb(res);
    if (mode === 'sse') res._data(Buffer.from(sse({ type: 'message_start' }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: reply } }) + sse({ type: 'message_stop' })));
    else res._data(Buffer.from(JSON.stringify(apiBody || SEARCH_MSG)));
    if (res._end) res._end();
  }); } };
};
process.env.DASHBOARD_KEY = 'k';
process.env.ANTHROPIC_API_KEY = 'sk';
const fn = require(path.join(ROOT, 'netlify/functions/assistant.js'));
const bg = require(path.join(ROOT, 'netlify/functions/assistant-search-background.js'));
const post = async (mod, body, headers) => { const r = await mod.handler({ httpMethod: 'POST', headers: headers === undefined ? { 'x-sbc-key': 'k' } : headers, body: JSON.stringify(body) }); return { code: r.statusCode, body: JSON.parse(r.body || '{}') }; };

(async function () {
  /* ══ 1. THE SYNC SIDE ══════════════════════════════════════════════════ */
  console.log('\nthe assistant asks for a search instead of guessing\n');
  {
    mode = 'sse'; reply = 'Checking online for that now.\nACTION: {"type":"search","query":"Kohler Cimarron toilet price Home Depot Brooklyn"}';
    sent = null;
    const r = await post(fn, { messages: [{ role: 'user', text: 'how much is a Kohler Cimarron toilet at Home Depot?' }] });
    ok('A SEARCH ACTION COMES BACK AS DATA, with the query', r.body.actions.length === 1 && r.body.actions[0].type === 'search' && /Kohler Cimarron/.test(r.body.actions[0].query), JSON.stringify(r.body));
    ok('...and the text says it is checking', r.body.reply === 'Checking online for that now.');
    ok('it is told WHEN to search - prices, suppliers, codes, "search online"', /SEARCH THE INTERNET/.test(sent.system) && /today's price of a product/.test(sent.system) && /'search online'/.test(sent.system) && /do not guess the answer yourself/.test(sent.system));
    reply = 'ok\nACTION: {"type":"search"}';
    const bad = await post(fn, { messages: [{ role: 'user', text: 'x' }] });
    ok('a search with no query is dropped', bad.body.actions.length === 0);
  }
  {
    const src = fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant.js'), 'utf8');
    ok('the chat helpers now live in lib/assistant-chat.js and assistant.js uses them', /require\("\.\/lib\/assistant-chat"\)/.test(src) && !/^function chatStore\(\)/m.test(src) && !/^async function appendChat\(/m.test(src));
    ok('...so the background function appends to the SAME chats', /require\("\.\/lib\/assistant-chat"\)/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant-search-background.js'), 'utf8')));
  }

  /* ══ 2. THE BACKGROUND SEARCH ══════════════════════════════════════════ */
  console.log('\nthe background function searches, stores the job, and writes the chat\n');
  {
    let r = await post(bg, { job: 'S-abc123', query: 'x' }, {});
    ok('A STRANGER GETS 401 - every search costs money', r.code === 401 && !STORES['assistant-jobs']);
    r = await post(bg, { query: 'x' });
    ok('no job id -> 400', r.code === 400);
    r = await post(bg, { job: 'S-abc123' });
    ok('no query -> 400', r.code === 400);

    mode = 'json'; sent = null;
    r = await post(bg, { job: 'S-abc123', chat: 'SBC-1', query: 'Kohler Cimarron toilet price Home Depot Brooklyn', question: 'how much is a Kohler Cimarron toilet?', history: [{ role: 'user', text: 'earlier q' }, { role: 'assistant', text: 'earlier a' }, { role: 'user', text: 'how much is a Kohler Cimarron toilet?' }], context: 'Estimate SBC-1: Bathroom for Maria, $12,441' });
    ok('THE SEARCH RUNS AND THE JOB IS DONE', r.code === 200 && r.body.ok === true, JSON.stringify(r.body));
    const job = JSON.parse(STORES['assistant-jobs'].get('S-abc123'));
    ok('...the job record holds the answer', job.status === 'done' && /Kohler Cimarron at \$329; Lowe's has it at \$319\./.test(job.answer), JSON.stringify(job).slice(0, 300));
    ok('...WITH ITS SOURCES, the cited ones only, no duplicates, in order', job.sources.join(',') === 'https://www.homedepot.com/x,https://www.lowes.com/y' && /Sources:\n- https:\/\/www\.homedepot\.com\/x\n- https:\/\/www\.lowes\.com\/y/.test(job.answer) && job.answer.indexOf('ignored.example') === -1, job.answer);
    ok('...and it counted the searches', job.searches === 1);
    const saved = JSON.parse(STORES['assistant-chats'].get('SBC-1'));
    ok('THE ANSWER IS APPENDED TO THE ESTIMATE\'S CHAT, marked as from online', saved.length === 1 && saved[0].role === 'assistant' && saved[0].text.indexOf('🔎 ') === 0 && /\$329/.test(saved[0].text), JSON.stringify(saved));
    ok('it used the web search tool, capped, on the assistant model', sent.tools[0].type === 'web_search_20260209' && sent.tools[0].max_uses === 5 && sent.model === 'claude-sonnet-5' && !sent.stream);
    ok('the question and the query both reach the model, after the recent history', sent.messages.length === 3 && /how much is a Kohler Cimarron toilet\?\n\nSearch for: Kohler Cimarron toilet price/.test(sent.messages[2].content) && sent.messages[0].content === 'earlier q');
    ok('the house rules travel with it, and a found price is never a quote', /never use the word 'licensed'/i.test(sent.system) && /Never mention TV mounting/.test(sent.system) && /never turn it into a price for a job/.test(sent.system) && /Sources:/.test(sent.system));
    ok('what is on screen goes along as one line', /Estimate SBC-1: Bathroom for Maria/.test(sent.system));

    apiStatus = 400; apiBody = { error: { message: 'web_search is not available' } };
    r = await post(bg, { job: 'S-err001', chat: 'SBC-1', query: 'x' });
    const bad = JSON.parse(STORES['assistant-jobs'].get('S-err001'));
    ok('AN API ERROR BECOMES A JOB IN ERROR, with the reason', r.code === 502 && bad.status === 'error' && /web_search is not available/.test(bad.error), JSON.stringify(bad));
    ok('...and nothing was written to the chat for it', JSON.parse(STORES['assistant-chats'].get('SBC-1')).length === 1);
    apiStatus = 200; apiBody = null;

    ok('_extract joins text blocks and dedupes citations', bg._extract(SEARCH_MSG).sources.length === 2 && /\$319/.test(bg._extract(SEARCH_MSG).text));
    ok('_extract on an empty message is empty, not a crash', bg._extract({}).text === '' && bg._extract(null).sources.length === 0);
  }

  /* ══ 3. POLLING ════════════════════════════════════════════════════════ */
  console.log('\nthe sync function hands the job back\n');
  {
    let r = await post(fn, { action: 'job', id: 'S-abc123' });
    ok('A DONE JOB COMES BACK WHOLE', r.code === 200 && r.body.status === 'done' && /\$329/.test(r.body.answer));
    r = await post(fn, { action: 'job', id: 'S-notyet01' });
    ok('a job not written yet reads as running - the page keeps polling', r.code === 200 && r.body.status === 'running');
    r = await post(fn, { action: 'job', id: '../x' });
    ok('a bad id is refused', r.code === 400);
    r = await post(fn, { action: 'job', id: 'S-abc123' }, {});
    ok('polling needs the key too', r.code === 401);
  }

  /* ══ 4. THE PAGE ═══════════════════════════════════════════════════════ */
  console.log('\nthe page shows a searching bubble and swaps the answer in\n');
  {
    const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
    function ext(name) {
      const s = DASH.search(new RegExp('(?:async )?function ' + name + '\\s*\\('));
      if (s < 0) throw new Error('missing function ' + name);
      let d = 0;
      for (let j = DASH.indexOf('{', s); j < DASH.length; j++) { if (DASH[j] === '{') d++; else if (DASH[j] === '}') { d--; if (!d) return DASH.slice(s, j + 1); } }
      throw new Error('unbalanced ' + name);
    }
    ok('a search action goes to aiStartSearch with the log it was asked from', /if \(t === "search"\) \{\s*aiStartSearch\(String\(a\.query \|\| ""\), log \|\| AI_LOG, render \|\| aiRender\);/.test(ext('aiExec')));
    ok('aiRunActions passes the log and renderer down', /aiExec\(actions\[i\], log, render\)/.test(ext('aiRunActions')));
    ok('the drawer note says it can search online', /searches online when a question needs it/.test(DASH));

    function page(plan) {
      const calls = [], renders = { n: 0 };
      const ctx = {
        String, JSON, Math, Date, Promise, Array, console,
        AI_LOG: [], currentRecord: { ref: 'SBC-1' }, aiSave: () => calls.push('save'), aiScreen: () => ({ record: { ref: 'SBC-1', title: 'Bath', name: 'Maria', total: '$100' } }),
        setTimeout: (f) => f(),
        sbcFetch: async (url, o) => { const body = JSON.parse(o.body); calls.push({ url, body }); const step = plan.shift(); if (step === 'throw') throw new Error('offline'); if (typeof step === 'function') return step(); return { ok: true, status: 200, json: async () => step }; },
      };
      vm.createContext(ctx);
      vm.runInContext(ext('aiJobId') + '\n' + ext('aiStartSearch') + '\nvar AI_SEARCH_POLL_MS = 1, AI_SEARCH_POLLS = 3;', ctx);
      return { ctx, calls, renders };
    }
    {
      const log = [{ role: 'user', text: 'how much is a Kohler toilet?' }];
      const p = page([() => ({ ok: false, status: 202, json: async () => ({}) }), { status: 'running' }, { status: 'done', answer: 'Home Depot: $329\n\nSources:\n- https://hd' }]);
      let n = 0;
      await vm.runInContext('aiStartSearch("Kohler toilet price", LOG, RENDER)', Object.assign(p.ctx, { LOG: log, RENDER: () => { n++; } }));
      ok('A SEARCHING BUBBLE APPEARS FIRST, then the answer replaces it in place', log.length === 2 && log[1].text.indexOf('🔎 Home Depot: $329') === 0 && log[1].pending === false, JSON.stringify(log));
      ok('the background function was started with a job id, the chat key of THIS record, the query and the question', p.calls[0].url.indexOf('assistant-search-background') !== -1 && /^S-/.test(p.calls[0].body.job) && p.calls[0].body.chat === 'SBC-1' && p.calls[0].body.query === 'Kohler toilet price' && p.calls[0].body.question === 'how much is a Kohler toilet?', JSON.stringify(p.calls[0].body));
      ok('...with one line of the open estimate as context', /Estimate SBC-1: Bath for Maria, \$100/.test(p.calls[0].body.context));
      ok('then it polled the same job id until done', p.calls[1].body.action === 'job' && p.calls[1].body.id === p.calls[0].body.job && p.calls.length === 3 && n >= 2);
    }
    {
      const p = page([() => ({ ok: false, status: 202, json: async () => ({}) }), { status: 'running' }, { status: 'running' }, { status: 'running' }]);
      const log = [];
      await vm.runInContext('aiStartSearch("x", LOG, RENDER)', Object.assign(p.ctx, { LOG: log, RENDER: () => {} }));
      ok('AFTER THE POLL LIMIT THE BUBBLE SAYS SO - it never spins forever', /taking too long/.test(log[0].text) && log[0].pending === false, log[0].text);
    }
    {
      const p = page([() => ({ ok: false, status: 202, json: async () => ({}) }), { status: 'error', error: 'web_search is not available' }]);
      const log = [];
      await vm.runInContext('aiStartSearch("x", LOG, RENDER)', Object.assign(p.ctx, { LOG: log, RENDER: () => {} }));
      ok('a failed job is shown with its reason', /search failed: web_search is not available/.test(log[0].text));
    }
    {
      const p = page(['throw']);
      const log = [];
      await vm.runInContext('aiStartSearch("x", LOG, RENDER)', Object.assign(p.ctx, { LOG: log, RENDER: () => {} }));
      ok('a start that fails is shown, not silent', /Could not start the search: offline/.test(log[0].text) && p.calls.length === 1);
    }
    {
      const p = page([() => ({ ok: false, status: 202, json: async () => ({}) }), { status: 'done', answer: 'a' }]);
      await vm.runInContext('aiStartSearch("x", AI_LOG, RENDER)', Object.assign(p.ctx, { RENDER: () => {} }));
      ok('from the drawer the chat key is "global", and the log is saved', p.calls[0].body.chat === 'global' && p.calls.includes('save'));
    }
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
