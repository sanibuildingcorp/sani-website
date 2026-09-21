/* scope-dedupe.test.js — run: node js/scope-dedupe.test.js
 *
 *   "this is a text what i ask to my ai to check if there is duplicate
 *    services, or texts and remove all duplicated but he don't do it"
 *
 * The scope carried the same four lines under every heading, the same
 * three material lines under five, and the plumbing work under BATHROOM
 * and again under PLUMBING. Removing them one reword at a time was forty
 * exact quotes; the assistant could not. Now one action, dedupe: the
 * server drops every bullet that already appeared - scope text and every
 * card copy - keeps each once where it first appears, prices untouched;
 * the dashboard shows the list and he confirms once.
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
const STORES = { estimates: new Map() };
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return request; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: (o) => { const m = STORES[o.name] || (STORES[o.name] = new Map()); return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); }, setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); } }; } } };
const https = require('https');
let reply = '';
const sse = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
https.request = function (opts, cb) {
  const res = { statusCode: 200, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  return { on() { return this; }, write() {}, destroy() {}, end() { setImmediate(() => { cb(res); res._data(Buffer.from(sse({ type: 'message_start' }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: reply } }) + sse({ type: 'message_stop' }))); if (res._end) res._end(); }); } };
};
process.env.DASHBOARD_KEY = 'k'; process.env.ANTHROPIC_API_KEY = 'sk';
const D = require(path.join(ROOT, 'netlify/functions/lib/scope-dedupe.js'));
const R = require(path.join(ROOT, 'netlify/functions/lib/reword.js'));
const fn = require(path.join(ROOT, 'netlify/functions/dedupe-scope.js'));
const assistant = require(path.join(ROOT, 'netlify/functions/assistant.js'));

const SETUP = 'Site setup \u2014 protect apartment entry, studio floor and living area; build zippered dust containment barrier at the bathroom doorway';
const PROTECT = 'Building common-area protection \u2014 hallway, service elevator cab and lobby along the debris/delivery route, installed and maintained per the alteration agreement';
const COORD = 'Project coordination and supervision \u2014 trade sequencing, material procurement and selections, site visits and customer/board communication through completion';
const RAM = 'Provide and use ram Board temporary floor protection, 38 in. x 100 ft roll';
const PLUMB = 'Plumbing \u2014 full replacement of the bathroom waste line back to the riser: new closet bend, lavatory and shower waste, vent connection and riser tie-in in cast iron no-hub';
function record() {
  const cards = [
    { title: 'Bathroom', subtotal: 12000, included: [SETUP, PROTECT, COORD, 'Bathroom gut demolition \u2014 remove cast iron tub, tub surround, all wall tile', PLUMB], customerSupplies: ['Vanity'], notIncluded: ['Painting of other rooms'] },
    { title: 'Plumbing', subtotal: 6000, included: [SETUP, PROTECT, COORD, 'Full replacement of the bathroom waste line back to the riser', 'Install new shower valve, shower trim and shower drain'], customerSupplies: ['Vanity'], notIncluded: [] },
    { title: 'Tile', subtotal: 5000, included: [SETUP, 'New floor tile throughout the bathroom', RAM], customerSupplies: [], notIncluded: ['Painting of other rooms'] },
    { title: 'Painting', subtotal: 1500, included: [PROTECT.replace('\u2014', '-') + '.', 'Prime and paint bathroom ceiling', RAM], customerSupplies: [], notIncluded: [] },
    { title: 'General', subtotal: 800, included: [SETUP, COORD, RAM], customerSupplies: [], notIncluded: [] },
  ];
  const text = cards.map((c) => c.title.toUpperCase() + ':\n' + c.included.map((i) => '\u2022 ' + i).join('\n')).join('\n\n') + '\n\nNotes: work hours 9-5 per the alteration agreement.';
  return {
    ref: 'SBC-260813-WPPF', status: 'sent', sentAt: '2026-09-10T00:00:00Z', customerFinalTotal: 26836.43,
    customer: { name: 'Frank' },
    estimate: {
      projectTitle: 'Full Gut Bathroom', markupPct: 25, scopeOfWork: text,
      labor: [{ section: 'Bathroom', item: 'Demo', qty: 10, unit: 'hrs', rate: 100 }], materials: [],
      serviceBreakdown: cards,
      customerScopePublished: true,
      publishedCustomerScope: { services: cards.map((c) => ({ name: c.title, subtotal: c.subtotal, included: c.included.slice(), supplied: c.customerSupplies.slice(), excluded: c.notIncluded.slice() })) },
      manualCustomerScopeDraft: { services: [{ name: 'Bathroom', included: [SETUP, SETUP] }] },
      scopeSections: [{ title: 'Bathroom', items: [SETUP, COORD] }, { title: 'Tile', items: [SETUP] }],
    },
  };
}

(async () => {
  console.log('\n1. lib/scope-dedupe.js: each line once, where it first appears\n');
  {
    const rec = record();
    const before = R.moneyFingerprint(rec);
    const out = D.dedupeScope(rec);
    const inc = (i) => rec.estimate.serviceBreakdown[i].included;
    ok('THE BATHROOM CARD KEEPS ITS LINES; Plumbing, Tile, Painting and General lose the repeats of site setup, protection and coordination', inc(0).length === 5 && inc(1).join('|') === 'Full replacement of the bathroom waste line back to the riser|Install new shower valve, shower trim and shower drain' && inc(2).join('|') === 'New floor tile throughout the bathroom|' + RAM && inc(4).length === 0, JSON.stringify(rec.estimate.serviceBreakdown.map((c) => c.included.length)));
    ok('...a repeat with a plain dash and a trailing period is still the same line (Painting\'s protection line went)', inc(3).join('|') === 'Prime and paint bathroom ceiling', JSON.stringify(inc(3)));
    ok('...the ram Board line stays once, under Tile where it first appears', inc(2).indexOf(RAM) !== -1 && inc(3).indexOf(RAM) === -1 && inc(4).indexOf(RAM) === -1);
    ok('...customer supplies and not-included are deduped on their own lists', rec.estimate.serviceBreakdown[1].customerSupplies.length === 0 && rec.estimate.serviceBreakdown[0].customerSupplies.length === 1 && rec.estimate.serviceBreakdown[2].notIncluded.length === 0);
    const pub = rec.estimate.publishedCustomerScope.services;
    ok('THE PUBLISHED COPY, THE DRAFT AND THE SECTIONS GET THE SAME PASS', pub[1].included.length === 2 && pub[4].included.length === 0 && rec.estimate.manualCustomerScopeDraft.services[0].included.length === 1 && rec.estimate.scopeSections[1].items.length === 0);
    const t = rec.estimate.scopeOfWork;
    ok('THE SCOPE TEXT: repeats gone, first occurrences kept, a heading left empty gone with them, the prose note kept', /^BATHROOM:\n\u2022 Site setup/.test(t) && (t.match(/Site setup/g) || []).length === 1 && (t.match(/ram Board/g) || []).length === 1 && !/GENERAL:/.test(t) && /PLUMBING:\n\u2022 Full replacement of the bathroom waste line back to the riser\n\u2022 Install new shower valve/.test(t) && /Notes: work hours 9-5/.test(t), t);
    ok('the report: one entry per distinct line with the number of places it repeated in', out.changed === true && out.count === 6 && out.lines.every((l) => l.count >= 2) && out.lines.some((l) => l.text === SETUP && l.count >= 8), JSON.stringify(out.lines.map((l) => [l.text.slice(0, 20), l.count])));
    ok('SAME WORK IN DIFFERENT WORDS IS REPORTED, NOT REMOVED: the waste-line sentence under Bathroom and under Plumbing', out.similar.length === 1 && out.similar[0].aIn === 'Bathroom' && out.similar[0].bIn === 'Plumbing' && /Full replacement of the bathroom waste line/.test(out.similar[0].b) && inc(1).length === 2, JSON.stringify(out.similar));
    ok('the money fingerprint did not move', R.moneyFingerprint(rec) === before && rec.estimate.serviceBreakdown[4].subtotal === 800);
    const clean = record(); clean.estimate.serviceBreakdown = [{ title: 'A', included: ['x', 'y'] }]; clean.estimate.scopeOfWork = 'A:\n\u2022 x\n\u2022 y'; delete clean.estimate.publishedCustomerScope; delete clean.estimate.manualCustomerScopeDraft; delete clean.estimate.scopeSections;
    ok('nothing repeated: changed false, nothing touched', D.dedupeScope(clean).changed === false && clean.estimate.scopeOfWork === 'A:\n\u2022 x\n\u2022 y');
  }

  console.log('\n2. The function: a dry run shows, apply removes and saves\n');
  {
    STORES.estimates.set('SBC-260813-WPPF', JSON.stringify(record()));
    const post = async (body) => { const r = await fn.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify(body) }); return { code: r.statusCode, body: JSON.parse(r.body) }; };
    const dry = await post({ ref: 'SBC-260813-WPPF', apply: false });
    const stored = JSON.parse(STORES.estimates.get('SBC-260813-WPPF'));
    ok('DRY RUN: the lines that would go, nothing saved', dry.code === 200 && dry.body.changed === true && dry.body.applied === false && dry.body.count === 6 && stored.estimate.serviceBreakdown[4].included.length === 3 && !dry.body.estimate, JSON.stringify(dry.body).slice(0, 200));
    const ap = await post({ ref: 'SBC-260813-WPPF', apply: true });
    const saved = JSON.parse(STORES.estimates.get('SBC-260813-WPPF'));
    ok('APPLY: removed, saved, the estimate returned for the page, a history line left', ap.code === 200 && ap.body.applied === true && saved.estimate.serviceBreakdown[4].included.length === 0 && ap.body.estimate.serviceBreakdown[1].included.length === 2 && /^Repeated lines removed \(6\): "Site setup/.test(saved.history[saved.history.length - 1].text) && saved.history[saved.history.length - 1].kind === 'removed', JSON.stringify(saved.history));
    ok('...prices as they were', saved.customerFinalTotal === 26836.43 && saved.estimate.serviceBreakdown[0].subtotal === 12000);
    ok('applied twice: nothing more to remove', (await post({ ref: 'SBC-260813-WPPF', apply: true })).body.changed === false);
    ok('no key -> 401; no ref -> 400; unknown ref -> 404', (await fn.handler({ httpMethod: 'POST', headers: {}, body: '{"ref":"SBC-260813-WPPF"}' })).statusCode === 401 && (await post({})).code === 400 && (await post({ ref: 'SBC-NOPE' })).code === 404);
    ok('it is in the endpoint-auth gated list', /\["dedupe-scope", "POST"/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/lib/endpoint-auth.test.js'), 'utf8')));
  }

  console.log('\n3. The assistant: the action, and the rule\n');
  {
    reply = 'Removing the repeats.\nACTION: {"type":"dedupe","ref":"SBC-260813-WPPF"}';
    const r = await assistant.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify({ messages: [{ role: 'user', text: 'remove all duplicated' }] }) });
    const b = JSON.parse(r.body);
    ok('A DEDUPE ACTION COMES THROUGH', b.actions.length === 1 && b.actions[0].type === 'dedupe' && b.actions[0].ref === 'SBC-260813-WPPF', JSON.stringify(b.actions));
    const A = fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant.js'), 'utf8');
    ok('IT IS TOLD: duplicates, repeats, the same bullet under more than one heading -> dedupe; never one by one with reword; similar lines merged with reword after', /REMOVE REPEATED LINES FROM A SCOPE: ACTION: \{\\"type\\":\\"dedupe\\"/.test(A) && /NEVER remove repeats one by one with reword: send dedupe/.test(A) && /come back as 'similar'; merge those with reword after/.test(A));
  }

  console.log('\n4. The dashboard: the list, one confirm, then the apply\n');
  {
    const calls = { fetched: [], confirms: [], toasts: [] };
    const posts = [
      { success: true, applied: false, changed: true, count: 2, lines: [{ text: SETUP, count: 8 }, { text: RAM, count: 3 }], similar: [{ a: PLUMB, aIn: 'Bathroom', b: 'Full replacement of the bathroom waste line back to the riser', bIn: 'Plumbing' }] },
      { success: true, applied: true, changed: true, count: 2, lines: [], similar: [{ a: PLUMB, aIn: 'Bathroom', b: 'Full replacement of the bathroom waste line back to the riser', bIn: 'Plumbing' }], estimate: { projectTitle: 'DEDUPED', labor: [] } },
    ];
    const ctx = {
      String, JSON, Array, Object, Number, Error, RegExp, Math, Date, console, encodeURIComponent, Promise, setTimeout: (f) => f(),
      estimates: [{ ref: 'SBC-260813-WPPF', status: 'sent', sentAt: '2026-09-10T00:00:00Z' }], currentRecord: { ref: 'SBC-260813-WPPF', estimate: {}, sentAt: '2026-09-10T00:00:00Z' },
      visits: [], activeTab: 'all', renderTabs() {}, renderList() {}, openEdit() {}, closeEdit() {}, aiClose() {}, aiStartSearch() {}, AI_LOG: [], aiRender() {}, aiSave() {}, aiTurn: (m) => m, aiScreen: () => null, aiAsk: async () => ({ reply: '', actions: [] }),
      renderEdit() { calls.rendered = (calls.rendered || 0) + 1; }, toast: (t) => calls.toasts.push(t), confirm: (t) => { calls.confirms.push(t); return true; }, document: { getElementById: () => null },
      sbcFetch: async (url, o) => { calls.fetched.push({ url, body: JSON.parse(o.body) }); return { ok: true, json: async () => posts.shift() }; },
    };
    vm.createContext(ctx);
    ['aiExec', 'aiResendSkipped', 'aiRunActions'].forEach((n) => vm.runInContext(ext(n), ctx));
    const said = await vm.runInContext('aiExec({ type: "dedupe", ref: "SBC-260813-WPPF" })', ctx);
    ok('A DRY RUN FIRST, then ONE CONFIRM listing each repeated line with how many places it repeats in, then the apply', calls.fetched.length === 2 && calls.fetched[0].body.apply === false && calls.fetched[1].body.apply === true && calls.confirms.length === 1 && /^Remove 2 repeated lines from the scope of SBC-260813-WPPF\?\nEach line stays once, where it first appears\. Prices untouched\.\n\n\u2022 Site setup[^\n]{0,70}…  \(×8\)\n\u2022 Provide and use ram Board[^\n]*\(×3\)$/.test(calls.confirms[0]), calls.confirms[0]);
    ok('...the returned estimate goes onto the open record and it redraws', ctx.currentRecord.estimate.projectTitle === 'DEDUPED' && calls.rendered === 1);
    ok('...and the answer says what was removed, names the similar pair for a reword, and that the customer still sees the sent version', /^Removed 2 repeated lines on SBC-260813-WPPF; each kept once where it first appears, every price as it was\. Same work in different words \(merge with a reword\): "Plumbing \u2014 full replacement[^"]*" \(Bathroom\) ≈ "Full replacement of the bathroom waste line back to the riser" \(Plumbing\)\. The customer still sees the sent version until you send an update\.$/.test(said), said);
    /* the screen: "OK, nothing changed." after a Cancel read as the AI failing */
    posts.push({ success: true, applied: false, changed: true, count: 9, lines: Array.from({ length: 9 }, (_, i) => ({ text: 'Repeated line number ' + (i + 1), count: 2 })), similar: [] });
    ctx.confirm = (t) => { calls.confirms.push(t); return false; };
    const cancelled = await vm.runInContext('aiExec({ type: "dedupe", ref: "SBC-260813-WPPF" })', ctx);
    ok('A CANCEL SAYS SO: "you pressed Cancel ... nothing was removed", no apply; and the dialog shows six examples then "…and 3 more"', /^Cancelled - nothing was removed\. Ask me again when you want them removed\.$/.test(cancelled) && calls.fetched.length === 3 && /• Repeated line number 6  \(×2\)\n…and 3 more$/.test(calls.confirms[1]), cancelled + ' | ' + calls.confirms[1]);
    ctx.confirm = (t) => { calls.confirms.push(t); return true; };
    posts.push({ success: true, applied: false, changed: false, count: 0, lines: [], similar: [] });
    ok('nothing repeated: says so, no confirm, no apply', /^No repeated lines on SBC-260813-WPPF\.$/.test(await vm.runInContext('aiExec({ type: "dedupe", ref: "SBC-260813-WPPF" })', ctx)) && calls.confirms.length === 2 && calls.fetched.length === 4);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
