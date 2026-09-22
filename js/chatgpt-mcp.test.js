/* chatgpt-mcp.test.js — run: node js/chatgpt-mcp.test.js
 *
 *   "i want AI which can add texts in estimate, i want AI which can learn
 *    each request from the customers ... i want talk to my dashboard from
 *    my phone in ChatGPT"
 *
 * The connector ChatGPT talks to: an MCP server over JSON-RPC. What would
 * hurt: a stranger reading or rewording estimates (the token gate); a price
 * moving through a reword (lib/reword.js refuses); a write that leaves no
 * trace (history); a link shown to someone not logged in.
 */
const fs = require('fs'), path = require('path'), Module = require('module'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* ── stubs: blobs, https (the estimator kick), the assistant module ── */
const STORES = { estimates: new Map(), 'assistant-memory': new Map() };
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return '@netlify/blobs'; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (opts) => {
  const m = STORES[opts.name] || (STORES[opts.name] = new Map());
  return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); }, setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); }, list: async () => ({ blobs: Array.from(m.keys()).map((key) => ({ key })) }) };
} } };
const https = require('https');
let kicked = [];
https.request = function (opts, cb) {
  const res = { statusCode: 202, resume() {}, on(ev, fn) { if (ev === 'end') setImmediate(fn); return this; } };
  return { on() { return this; }, setTimeout() { return this; }, write(b) { kicked.push({ path: opts.path, body: JSON.parse(b) }); }, destroy() {}, end() { setImmediate(() => cb(res)); } };
};
const ASSIST = path.join(ROOT, 'netlify/functions/assistant.js');
let asked = null, memoryNotes = [];
require.cache[ASSIST] = { id: ASSIST, filename: ASSIST, loaded: true, exports: {
  recordContext: async (ref) => (STORES.estimates.has(ref) ? { text: 'FULL VIEW OF ' + ref + ' as Ask AI sees it', glance: '' } : { text: '' }),
  loadMemory: async () => memoryNotes.slice(),
  remember: async (memory, text) => { memoryNotes = memory.concat([{ text, at: 'now' }]); },
  loadInsights: async () => 'Acceptance 40%',
  answer: async (body) => { asked = body; return { reply: 'The bathroom card is $4,500.01.', actions: [{ type: 'reword' }] }; },
} };
process.env.DASHBOARD_KEY = 'the-dashboard-key';
process.env.URL = 'https://sanibuildingcorp.com';
const M = require(path.join(ROOT, 'netlify/functions/chatgpt-mcp.js'));
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');

const TOKEN = M._connectorToken();
const URLP = '/.netlify/functions/chatgpt-mcp/' + TOKEN;
function rec() {
  return { ref: 'SBC-260921-WNGN', status: 'sent', customer: { name: 'Bruce Doynow', address: '233 west 99th st, Apt 18C' }, request: { service: 'Bathroom', description: 'shower floor' }, submittedAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-21T00:00:00Z',
    estimate: { projectTitle: 'Shower Floor Rebuild with New Bench', markupPct: 0, labor: [{ section: 'Bathroom', item: 'Shower floor rebuild', qty: 1, unit: 'ls', rate: 4500.01 }], materials: [],
      serviceBreakdown: [{ title: 'Bathroom', subtotal: 4500.01, included: ['We remove the shower floor tile.', 'We set new tile.', 'We set new tile.'], notIncluded: [] }],
      scopeOfWork: 'BATHROOM:\n• We remove the shower floor tile.\n• We set new tile.\n• We set new tile.' } };
}
function seed() {
  STORES.estimates.clear();
  STORES.estimates.set('SBC-260921-WNGN', JSON.stringify(rec()));
  STORES.estimates.set('SBC-260801-AAAA', JSON.stringify({ ref: 'SBC-260801-AAAA', status: 'accepted', customer: { name: 'Maria Lopez', address: 'Brooklyn' }, request: { service: 'Painting' }, submittedAt: '2026-08-01T00:00:00Z', estimate: { projectTitle: 'Hallway painting', labor: [{ qty: 1, rate: 1200 }], materials: [] } }));
  STORES.estimates.set('house-rules', JSON.stringify({ rules: 'Tile labor $16/SF' }));
  kicked = []; asked = null;
}
const call = (event) => M.handler(Object.assign({ httpMethod: 'POST', headers: {}, path: URLP, body: '' }, event));
const rpcCall = async (method, params, extra) => { const r = await call(Object.assign({ body: JSON.stringify({ jsonrpc: '2.0', id: 7, method, params }) }, extra || {})); return { code: r.statusCode, body: r.body ? JSON.parse(r.body) : null }; };
const tool = async (name, args) => { const r = await rpcCall('tools/call', { name, arguments: args }); return { code: r.code, res: r.body.result, err: r.body.error, text: r.body.result && r.body.result.content ? r.body.result.content[0].text : '' }; };
const saved = () => JSON.parse(STORES.estimates.get('SBC-260921-WNGN'));

(async function () {
  console.log('\n1. Who may call\n');
  {
    seed();
    ok('THE TOKEN IS DERIVED FROM THE KEY, never the key, 48 hex chars, stable', TOKEN.length === 48 && /^[0-9a-f]+$/.test(TOKEN) && TOKEN !== process.env.DASHBOARD_KEY && TOKEN === crypto.createHmac('sha256', 'the-dashboard-key').update('chatgpt-connector-v1').digest('hex').slice(0, 48));
    ok('the connector URL is the site plus the token', M._connectorUrl() === 'https://sanibuildingcorp.com/.netlify/functions/chatgpt-mcp/' + TOKEN);
    let r = await call({ path: '/.netlify/functions/chatgpt-mcp', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    ok('NO TOKEN, NO KEY -> 401', r.statusCode === 401);
    r = await call({ path: '/.netlify/functions/chatgpt-mcp/' + 'f'.repeat(48), body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    ok('a wrong token -> 401', r.statusCode === 401);
    r = await call({ path: '/.netlify/functions/chatgpt-mcp', headers: { authorization: 'Bearer ' + TOKEN }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
    ok('the token as a Bearer header is accepted too', r.statusCode === 200 && JSON.parse(r.body).result !== undefined);
    r = await call({ path: '/.netlify/functions/chatgpt-mcp', headers: { 'x-sbc-key': 'the-dashboard-key' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
    ok('the dashboard key header is accepted', r.statusCode === 200);
    r = await call({ path: '/.netlify/functions/chatgpt-mcp', headers: { 'x-sbc-key': 'wrong' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
    ok('a wrong dashboard key -> 401, the token in the URL does not rescue it', r.statusCode === 401);
    const k = process.env.DASHBOARD_KEY; delete process.env.DASHBOARD_KEY;
    r = await call({ body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
    ok('NO KEY IN THE ENVIRONMENT -> 500, never open', r.statusCode === 500);
    process.env.DASHBOARD_KEY = k;
    r = await call({ httpMethod: 'GET', path: '/.netlify/functions/chatgpt-mcp', headers: { 'x-sbc-key': 'the-dashboard-key' } });
    const g = JSON.parse(r.body);
    ok('THE DASHBOARD, LOGGED IN, GETS THE LINK and the tool names', r.statusCode === 200 && g.url === M._connectorUrl() && g.tools.indexOf('add_scope_line') !== -1, r.body.slice(0, 120));
    r = await call({ httpMethod: 'GET', path: '/.netlify/functions/chatgpt-mcp' });
    ok('...not without the key', r.statusCode === 401);
    r = await call({ httpMethod: 'GET' });
    ok('a GET with the token is 405 (no event stream offered), not a link', r.statusCode === 405);
    r = await call({ httpMethod: 'OPTIONS', path: '/.netlify/functions/chatgpt-mcp' });
    ok('OPTIONS answers without a key and advertises x-sbc-key and Authorization', r.statusCode === 200 && /x-sbc-key/.test(r.headers['Access-Control-Allow-Headers']) && /Authorization/.test(r.headers['Access-Control-Allow-Headers']));
  }

  console.log('\n2. The protocol\n');
  {
    let r = await rpcCall('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'chatgpt' } });
    ok('initialize: the asked protocol version is echoed, tools are offered, instructions name the business and the voice', r.code === 200 && r.body.result.protocolVersion === '2025-03-26' && r.body.result.capabilities.tools && /Sani Building Corp/.test(r.body.result.instructions) && /Never the word 'licensed'/.test(r.body.result.instructions) && r.body.id === 7);
    r = await rpcCall('initialize', { protocolVersion: '1999-01-01' });
    ok('an unknown version gets the newest we speak', r.body.result.protocolVersion === '2025-06-18');
    let raw = await call({ body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    ok('a notification (no id) -> 202, empty body', raw.statusCode === 202 && raw.body === '');
    raw = await call({ body: '{not json' });
    ok('unreadable body -> JSON-RPC parse error', raw.statusCode === 200 && JSON.parse(raw.body).error.code === -32700);
    r = await rpcCall('nothing/here', {});
    ok('unknown method -> -32601', r.body.error && r.body.error.code === -32601);
    r = await rpcCall('tools/call', { name: 'nope', arguments: {} });
    ok('unknown tool -> -32602', r.body.error && r.body.error.code === -32602);
    raw = await call({ body: JSON.stringify([{ jsonrpc: '2.0', id: 'a', method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/x' }, { jsonrpc: '2.0', id: 'b', method: 'tools/list' }]) });
    const batch = JSON.parse(raw.body);
    ok('a batch answers each request in order, notifications left out', Array.isArray(batch) && batch.length === 2 && batch[0].id === 'a' && batch[1].id === 'b' && batch[1].result.tools.length > 5);
    r = await rpcCall('tools/list', {});
    const names = r.body.result.tools.map((t) => t.name);
    ok('TOOLS: search and fetch for ChatGPT, then the hands', ['search', 'fetch', 'list_estimates', 'get_estimate', 'add_scope_line', 'reword', 'set_text', 'remove_duplicates', 'add_note', 'remember', 'memory', 'regenerate', 'add_service', 'ask_estimate_ai'].every((n) => names.indexOf(n) !== -1), names.join(','));
    ok('every tool has a description and an object input schema', r.body.result.tools.every((t) => t.description.length > 20 && t.inputSchema.type === 'object'));
    /* ChatGPT marks an unlabelled tool "public write, destructive" and asks
       before every call, reading included. The labels say which is which. */
    const byName = {}; r.body.result.tools.forEach((t) => { byName[t.name] = t.annotations || {}; });
    ok('LABELS: reading tools are read-only, writing tools are not; only regenerate is destructive; none reaches the open world', ['search', 'fetch', 'list_estimates', 'get_estimate', 'memory', 'ask_estimate_ai'].every((n) => byName[n].readOnlyHint === true) && ['add_scope_line', 'reword', 'set_text', 'remove_duplicates', 'add_note', 'remember', 'regenerate', 'add_service'].every((n) => byName[n].readOnlyHint === false) && byName.regenerate.destructiveHint === true && ['reword', 'add_scope_line', 'set_text', 'remove_duplicates'].every((n) => byName[n].destructiveHint === false) && names.every((n) => byName[n].openWorldHint === false && typeof byName[n].title === 'string'), JSON.stringify(byName));
  }

  console.log('\n3. Reading\n');
  {
    seed();
    let t = await tool('search', { query: 'bruce' });
    const results = JSON.parse(t.text).results;
    ok('SEARCH by name: the ref, a title with customer, job, status and price, a dashboard link', results.length === 1 && results[0].id === 'SBC-260921-WNGN' && /Bruce Doynow - Shower Floor Rebuild/.test(results[0].title) && /sent, \$4,500\.01/.test(results[0].title) && /dashboard\?ref=SBC-260921-WNGN$/.test(results[0].url), t.text);
    t = await tool('search', { query: '' });
    ok('an empty search lists everything, newest first; house-rules is not an estimate', JSON.parse(t.text).results.length === 2 && JSON.parse(t.text).results[0].id === 'SBC-260921-WNGN');
    t = await tool('search', { query: 'painting accepted' });
    ok('every word must match: "painting accepted" finds Maria only', JSON.parse(t.text).results.length === 1 && JSON.parse(t.text).results[0].id === 'SBC-260801-AAAA');
    t = await tool('fetch', { id: 'sbc-260921-wngn' });
    const doc = JSON.parse(t.text);
    ok('FETCH reads the estimate through Ask AI\'s eyes (recordContext), ref in any case', doc.id === 'SBC-260921-WNGN' && doc.text === 'FULL VIEW OF SBC-260921-WNGN as Ask AI sees it' && t.res.structuredContent.id === doc.id);
    t = await tool('get_estimate', { ref: 'SBC-260921-WNGN' });
    ok('get_estimate is the same text, plain', t.text === 'FULL VIEW OF SBC-260921-WNGN as Ask AI sees it');
    t = await tool('fetch', { id: 'SBC-000000-ZZZZ' });
    ok('a ref that does not exist is a tool error, not a crash', t.res.isError === true && /not found/.test(t.text));
    t = await tool('list_estimates', { status: 'accepted' });
    ok('LIST filtered by status, as a table', /^ref \| status/.test(t.text) && /SBC-260801-AAAA \| accepted \| Maria Lopez, Brooklyn \| Hallway painting \| \$1,200\.00/.test(t.text) && t.text.indexOf('WNGN') === -1, t.text);
  }

  console.log('\n4. Writing: words move, prices never, every write leaves a history line\n');
  {
    seed();
    let t = await tool('add_scope_line', { ref: 'SBC-260921-WNGN', service: 'Bathroom', text: 'We grout the new tile and seal the corners.' });
    let s = saved();
    ok('ADD A LINE to the card; the scope of work box follows; the answer shows the cards with prices', s.estimate.serviceBreakdown[0].included.indexOf('We grout the new tile and seal the corners.') !== -1 && /We grout the new tile and seal the corners\./.test(s.estimate.scopeOfWork) && /Bathroom \$4,500\.01:/.test(t.text), t.text);
    ok('...with a history line that names ChatGPT', s.history.length === 1 && /^ChatGPT added to Bathroom: "We grout/.test(s.history[0].text) && s.history[0].kind === 'reworded', JSON.stringify(s.history));
    t = await tool('add_scope_line', { ref: 'SBC-260921-WNGN', service: 'Kitchen', text: 'x' });
    ok('a card that does not exist: refused, and the real cards are named', t.res.isError === true && /No card named Kitchen. Cards: Bathroom/.test(t.text));
    t = await tool('reword', { ref: 'SBC-260921-WNGN', edits: [{ where: 'included', service: 'Bathroom', from: 'We remove the shower floor tile.', to: 'We take up the old shower floor tile.' }, { where: 'labor', from: 'Shower floor rebuild', to: 'Shower floor rebuild, mosaic' }] });
    s = saved();
    ok('REWORD a card line and a price line name', s.estimate.serviceBreakdown[0].included[0] === 'We take up the old shower floor tile.' && s.estimate.labor[0].item === 'Shower floor rebuild, mosaic' && /Applied 2 edits/.test(t.text));
    ok('...prices untouched', s.estimate.labor[0].rate === 4500.01 && s.estimate.serviceBreakdown[0].subtotal === 4500.01);
    t = await tool('reword', { ref: 'SBC-260921-WNGN', edits: [{ where: 'included', service: 'Bathroom', from: 'nothing like this at all here', to: 'y' }] });
    ok('nothing matched -> tool error saying so', t.res.isError === true && /Nothing matched/.test(t.text));
    t = await tool('set_text', { ref: 'SBC-260921-WNGN', field: 'summary', text: 'We rebuild the shower floor and add a small bench.' });
    s = saved();
    ok('SET THE SUMMARY', s.estimate.summary === 'We rebuild the shower floor and add a small bench.' && /ChatGPT set the summary/.test(s.history[s.history.length - 1].text));
    t = await tool('remove_duplicates', { ref: 'SBC-260921-WNGN' });
    s = saved();
    ok('REMOVE DUPLICATES: "We set new tile." once', s.estimate.serviceBreakdown[0].included.filter((x) => x === 'We set new tile.').length === 1 && /Removed 1 repeated line/.test(t.text) && /ChatGPT removed repeated lines/.test(s.history[s.history.length - 1].text), t.text);
    t = await tool('remove_duplicates', { ref: 'SBC-260921-WNGN' });
    ok('...and nothing the second time', /No repeated lines/.test(t.text));
    t = await tool('add_note', { ref: 'SBC-260921-WNGN', text: 'Bruce called: wants the bench 36 inches.' });
    s = saved();
    ok('ADD A NOTE: a history line the estimate\'s Ask AI reads', s.history[s.history.length - 1].kind === 'note' && s.history[s.history.length - 1].text === 'ChatGPT note: Bruce called: wants the bench 36 inches.');
    t = await tool('remember', { text: 'Every bathroom scope names the tile size.' });
    ok('REMEMBER: a standing rule in the shared memory', memoryNotes.length === 1 && memoryNotes[0].text === 'Every bathroom scope names the tile size.' && /Remembered:/.test(t.text));
    t = await tool('memory', {});
    ok('MEMORY: the rules and what the history shows', /STANDING RULES:\n  - Every bathroom scope names the tile size\./.test(t.text) && /Acceptance 40%/.test(t.text), t.text);
  }

  console.log('\n5. The estimator and the in-dashboard assistant, from the phone\n');
  {
    seed();
    let t = await tool('regenerate', { ref: 'SBC-260921-WNGN', reanalyze: true, extraRequest: 'it is a repair' });
    ok('REGENERATE kicks the background estimator with the ref, a job id, reanalyze, the extra request and the stored house rules', kicked.length === 1 && /generate-estimate-background$/.test(kicked[0].path) && kicked[0].body.ref === 'SBC-260921-WNGN' && /^ai-/.test(kicked[0].body.jobId) && kicked[0].body.reanalyze === true && kicked[0].body.extraRequest === 'it is a repair' && kicked[0].body.houseRules === 'Tile labor $16/SF' && kicked[0].body.useDescription === true, JSON.stringify(kicked[0]));
    ok('...and says it takes a few minutes', /Started on SBC-260921-WNGN \(re-reading the job from scratch\)/.test(t.text));
    t = await tool('add_service', { ref: 'SBC-260921-WNGN', text: 'paint the hallway ceiling', service: 'Painting' });
    ok('ADD SERVICE kicks the estimator with addService', kicked.length === 2 && kicked[1].body.addService.text === 'paint the hallway ceiling' && kicked[1].body.addService.service === 'Painting' && kicked[1].body.houseRules === 'Tile labor $16/SF' && /Started: pricing/.test(t.text));
    t = await tool('regenerate', { ref: 'SBC-000000-ZZZZ' });
    ok('an unknown ref never reaches the estimator', kicked.length === 2 && t.res.isError === true);
    t = await tool('ask_estimate_ai', { ref: 'SBC-260921-WNGN', question: 'what is the bathroom price?' });
    ok('ASK THE ESTIMATE\'S OWN AI: same ref, the estimate\'s own chat, the question marked as from ChatGPT; its proposed changes are reported, not done', asked.ref === 'SBC-260921-WNGN' && asked.chat === 'SBC-260921-WNGN' && asked.messages[0].text === '(from ChatGPT) what is the bathroom price?' && /The bathroom card is \$4,500\.01\./.test(t.text) && /proposed 1 change/.test(t.text), t.text);
  }

  console.log('\n6. The dashboard shows the link, after login only\n');
  {
    ok('a ChatGPT panel next to the mailboxes, with a button that asks the function with the key', /id="chatgpt-panel"/.test(DASH) && /function chatgptPanelHtml\(\)/.test(DASH) && /sbcFetch\('\/\.netlify\/functions\/chatgpt-mcp', \{ method: 'GET' \}\)/.test(DASH) && /ChatGPT connection/.test(DASH));
    ok('the steps: Connectors, No authentication, Developer mode for writing, and a warning that the link is a key', /Settings (\\u2192|→) Connectors (\\u2192|→) Create/.test(DASH) && /Authentication: No authentication/.test(DASH) && /Developer mode/.test(DASH) && /The link is a key to your estimates/.test(DASH));
    ok('the link is never written into the page source', DASH.indexOf(TOKEN) === -1 && !/chatgpt-mcp\/[0-9a-f]{20}/.test(DASH));
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
