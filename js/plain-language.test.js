/* plain-language.test.js — run: node js/plain-language.test.js
 *
 *   "It's working very well the new AI assistant but i need more human
 *    language and easy for understanding for me and for customers"
 *
 * The site-visit card read "2026-10-14 10:00" and "Walkthrough and
 * field-measure all 13 bathrooms before the firm proposal ... site-built pans
 * or manufactured bases". Now: both chats (the drawer and the estimator) are
 * told to talk like a person, with the swaps named and dates in words, and
 * anything a customer reads even simpler. The visit card shows the date in
 * words.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const STORES = {};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return request; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (o) => { const m = STORES[o.name] || (STORES[o.name] = new Map()); return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } }; } } };
const https = require('https');
let calls = [];
const sse = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
https.request = function (opts, cb) {
  const res = { statusCode: 200, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  return { on() { return this; }, write(b) { calls.push(JSON.parse(b)); }, destroy() {}, end() { setImmediate(() => { cb(res); res._data(Buffer.from(sse({ type: 'message_start' }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }) + sse({ type: 'message_stop' }))); if (res._end) res._end(); }); } };
};
process.env.DASHBOARD_KEY = 'k'; process.env.ANTHROPIC_API_KEY = 'sk';
const bg = require(path.join(ROOT, 'netlify/functions/assistant-background.js'));
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const REC = { ref: 'SBC-260925-Y373', status: 'drafted', customer: { name: 'Crismar Hibirmas', address: '409 Suydam St' }, request: { service: 'Bathroom', description: '13 bathrooms.' }, estimate: { projectTitle: '409 Suydam', labor: [], materials: [], serviceBreakdown: [] } };
STORES.estimates = new Map(); STORES.estimates.set(REC.ref, JSON.stringify(REC));

(async () => {
  console.log('\n1. both chats are told to talk like a person\n');
  for (const [label, chat] of [['the estimator (inside the estimate)', REC.ref], ['the drawer', 'global']]) {
    calls = [];
    await bg.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ job: 'J-plain-' + chat, ref: REC.ref, chat: chat, messages: [{ role: 'user', text: 'set a visit' }] }) });
    const sys = (calls[0] || {}).system || '';
    ok(label + ': TALK LIKE A PERSON, with the swaps named', /TALK LIKE A PERSON, NOT A REPORT/.test(sys) && /'measure', not 'field-measure'/.test(sys) && /'final price', not 'firm proposal'/.test(sys) && /not 'site-built pans or manufactured bases'/.test(sys));
    ok(label + ': dates in words, never "2026-10-14 10:00"', /Dates and times in words: 'Wednesday, October 14 at 10 am', never '2026-10-14 10:00'/.test(sys));
    ok(label + ': NO SHORTHAND for him either - GC, ~, mm, boxes, man-hours - and no ** or ##', /'general contractor', not 'GC'; 'about', not '~'; inches, not mm; 'cabinets', not 'boxes'; 'hours of work', not 'man-hours'/.test(sys) && /No markdown symbols \(\*\*, ##\) - plain text only/.test(sys));
    ok(label + ': A PRICE IS LAID OUT one thing per line with labels, cost and customer price never mixed', /A PRICE OR A COUNT IS LAID OUT, ONE THING PER LINE/.test(sys) && /\n  Work: about N hours/.test(sys) && /\n  Your cost: \$\.\.\./.test(sys) && /\n  Price to the customer: \$\.\.\./.test(sys) && /Always say which number is his COST and which is the PRICE to the customer/.test(sys) && /the numbers come from the job, never from this example/.test(sys));
    ok(label + ': what a customer reads is simpler still - a homeowner, no trade shorthand', /ANYTHING A CUSTOMER WILL READ \(a message, questions, estimate wording, a visit note\) is even simpler/.test(sys) && /no trade shorthand, no abbreviations/.test(sys));
  }

  console.log('\n2. the visit card shows the date in words\n');
  {
    const s = DASH.indexOf('if (t === "visit") {');
    const body = DASH.slice(s, DASH.indexOf('if (t === "describe")', s));
    ok('the card uses fmtVisitTime, not the raw "2026-10-14 10:00"', /var vwhen = v\.datetime && !isNaN\(new Date\(v\.datetime\)\) && typeof fmtVisitTime === "function" \? fmtVisitTime\(v\.datetime\)/.test(body) && /"\\n" \+ vwhen \+/.test(body) && body.indexOf('v.datetime.replace("T", " ") + (v.reason') === -1);
    const f = DASH.slice(DASH.indexOf('function fmtVisitTime(dt){'), DASH.indexOf('function gcalLink('));
    const ctx = {}; vm.createContext(ctx); vm.runInContext(f, ctx);
    const out = ctx.fmtVisitTime('2026-10-14T10:00');
    ok('"2026-10-14T10:00" reads "Wed, Oct 14, 10:00 AM"', /^Wed, Oct 14, 10:00\sAM$/.test(out), out);
  }

  console.log('\n3. the chat shows bold, not stars; a copy to the customer has no marks\n');
  {
    const cut = (name) => { const st = DASH.indexOf('function ' + name + '('); let d = 0; for (let j = DASH.indexOf('{', st); j < DASH.length; j++) { if (DASH[j] === '{') d++; else if (DASH[j] === '}') { d--; if (!d) return DASH.slice(st, j + 1); } } };
    const ctx = { esc: (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') };
    vm.createContext(ctx); vm.runInContext(cut('aiLinkify') + cut('aiMarks') + cut('aiPlain'), ctx);
    const said = 'Labor for one: about **23 man-hours** - two men.\n## Your cost\nSee https://x.example/a.';
    const html = ctx.aiLinkify(said);
    ok('"**23 man-hours**" shows as bold, a "## " line as a bold line, links still work', /about <b>23 man-hours<\/b> - two men/.test(html) && /<b>Your cost<\/b>/.test(html) && html.indexOf('**') === -1 && /<a href="https:\/\/x\.example\/a"/.test(html), html);
    ok('what he types or a stray star is left alone, and HTML is still escaped', ctx.aiLinkify('5 * 3 = 15 <b>').indexOf('&lt;b&gt;') !== -1 && /5 \* 3/.test(ctx.aiLinkify('5 * 3')));
    ok('COPY TO CUSTOMER MESSAGE takes the marks out, keeps the words', ctx.aiPlain(said) === 'Labor for one: about 23 man-hours - two men.\nYour cost\nSee https://x.example/a.' && (DASH.match(/\+ aiPlain\(m\.text\);/g) || []).length === 2);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
