/* assistant-everywhere.test.js — run: node js/assistant-everywhere.test.js
 *
 *   "i need personal AI assistant which can do everything, read everything in
 *    my dashboard, analyze, plan's strategy ... whatever page i will open,
 *    always personal AI assistant needs to read and if i ask questions then
 *    answers, if i command do that then let's him do it"
 *
 * Three things on top of the one-record panel: it SEES the screen, it
 * REMEMBERS what he tells it, and it can ACT. The server half is driven with
 * Blobs and Claude stubbed; the dashboard half is run in a vm with the page's
 * own functions stubbed, so an action is proven to reach openEdit,
 * save-estimate, the visits endpoint or the reply box - and never further.
 *
 * WHAT WOULD HURT: an action it invented running without him (a status flip,
 * a visit on the wrong day); half an action from a cut-off answer; anything
 * at all being sent to a customer; the internal price band riding along in
 * the screen snapshot.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* ── stubs: two Blobs stores and a Claude that says what we tell it ─────── */
const STORES = { estimates: new Map(), 'assistant-memory': new Map() };
let sent = null;
let reply = 'Nothing to do.';
let stall = false;

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === '@netlify/blobs') return '@netlify/blobs';
  return origResolve.call(this, request, ...rest);
};
require.cache['@netlify/blobs'] = {
  id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: {
    getStore: (opts) => {
      const m = STORES[opts.name] || new Map();
      return {
        get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null),
        set: async (k, v) => { m.set(k, v); },
      };
    },
  },
};
const https = require('https');
const sse = (obj) => 'event: ' + obj.type + '\ndata: ' + JSON.stringify(obj) + '\n\n';
https.request = function (opts, cb) {
  const res = { statusCode: 200, _data: null, _end: null, on(ev, fn) { if (ev === 'data') this._data = fn; if (ev === 'end') this._end = fn; return this; } };
  let destroyed = false;
  return {
    on() { return this; }, write(body) { sent = JSON.parse(body); }, destroy() { destroyed = true; },
    end() {
      setImmediate(() => {
        cb(res);
        res._data(Buffer.from(sse({ type: 'message_start' })));
        reply.split(/(?<=\n)/).forEach((t) => { if (!destroyed) res._data(Buffer.from(sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } }))); });
        if (stall) return;
        res._data(Buffer.from(sse({ type: 'message_stop' })));
        if (res._end) res._end();
      });
    },
  };
};
process.env.DASHBOARD_KEY = 'k';
process.env.ANTHROPIC_API_KEY = 'sk';
const fn = require(path.join(ROOT, 'netlify/functions/assistant.js'));
const call = async (body) => {
  const r = await fn.handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k' }, body: JSON.stringify(body) });
  return { code: r.statusCode, body: JSON.parse(r.body) };
};
const SCREEN = {
  today: '2026-09-19', tab: 'sent', ref: '', counts: { sent: 2, accepted: 1 },
  estimates: [
    { ref: 'SBC-1', name: 'Maria Lopez', service: 'Bathroom gut', status: 'sent', total: 12441.07, submitted: '2026-09-10', sent: '2026-09-11', unpaid: 0, invoices: 0, needsReply: true },
    { ref: 'SBC-2', name: 'Ken Wu', service: 'Painting', status: 'accepted', total: 3000, submitted: '2026-09-01', sent: '2026-09-02', unpaid: 1500, invoices: 1, needsReply: false },
  ],
  visits: [{ id: 'V-1', customer: 'Ken Wu', address: '88 Bay 7th St', datetime: '2026-09-20T10:00', reason: 'measure', ref: 'SBC-2', inCalendar: true }],
  handyman: [{ ref: 'HM-1', customer: 'Dora', service: 'Door repair', status: 'new', date: '2026-09-22', submitted: '2026-09-17' }],
  customers: 87,
};

(async function () {
  /* ══ IT SEES THE SCREEN ═════════════════════════════════════════════════ */
  console.log('\nit sees what he sees\n');
  {
    sent = null; reply = 'Maria Lopez is waiting.';
    const r = await call({ messages: [{ role: 'user', text: 'who is waiting?' }], screen: SCREEN });
    const sys = sent.system;
    ok('THE ESTIMATE LIST IS IN THE PROMPT, one line each', /SBC-1 \| Maria Lopez \| Bathroom gut \| sent \| \$12441/.test(sys) && /SBC-2 \| Ken Wu/.test(sys), sys.slice(sys.indexOf('ALL ESTIMATES'), sys.indexOf('ALL ESTIMATES') + 300));
    ok('...with who is waiting for a reply spelled out', /SBC-1[^\n]*CUSTOMER WAITING FOR A REPLY/.test(sys));
    ok('...and what is unpaid', /SBC-2[^\n]*unpaid \$1500/.test(sys));
    ok('the open tab and today\'s date are there', /HE IS LOOKING AT: the sent tab/.test(sys) && /TODAY \(New York\): 2026-09-19/.test(sys));
    ok('site visits, with their ids so an action can name them', /SITE VISITS/.test(sys) && /2026-09-20T10:00 \| Ken Wu[^\n]*in Google Calendar \| id V-1/.test(sys));
    ok('handyman bookings and the customer count', /HANDYMAN BOOKINGS/.test(sys) && /HM-1 \| Dora \| Door repair/.test(sys) && /CUSTOMER DIRECTORY: 87/.test(sys));
    ok('"No job is open" is still said when no record is open - the old panel test relies on it', /No job is open\./.test(sys));
    ok('the reply comes back as before', r.code === 200 && r.body.reply === 'Maria Lopez is waiting.' && Array.isArray(r.body.actions) && r.body.actions.length === 0, JSON.stringify(r.body));
    ok('it is told what the dashboard is - tabs, the five steps, where replies land', /five steps/.test(sys) && /Visits tab/.test(sys) && /contact@/.test(sys));
    ok('it is told to plan from the whole list, with names and refs', /who is waiting, what is unpaid/.test(sys));
  }
  {
    sent = null;
    const big = Object.assign({}, SCREEN, { estimates: Array.from({ length: 400 }, (_, i) => ({ ref: 'SBC-' + i, name: 'Customer number ' + i + ' with a long name', service: 'A long service description for row ' + i, status: 'sent', total: 1000 + i, submitted: '2026-09-01', sent: '2026-09-02' })) });
    await call({ messages: [{ role: 'user', text: 'hi' }], screen: big });
    /* The list itself is capped at SCREEN_CHARS (14k); the rest is the rules,
       which grow a line at a time. 21k leaves room for that without ever
       letting a 400-row list through whole (that would be ~50k). The lines and
       regenerate actions (the chat as the estimator) added ~2k. */
    ok('A HUGE LIST IS CUT, NOT SENT WHOLE - the clock is the reason', sent.system.length < 39000 && /list cut here/.test(sent.system), sent.system.length + ' chars');
    sent = null;
    await call({ messages: [{ role: 'user', text: 'hi' }], screen: 'garbage' });
    ok('a screen that is not an object is ignored, not a crash', sent && /No job is open\. Answer whatever he asks\./.test(sent.system));
  }

  /* ══ IT READS THE WHOLE ESTIMATE ════════════════════════════════════════ */
  console.log('\nit reads the generated estimate, line by line\n');
  {
    /*   "Do this AI reading full generated estimate?"  It did not. */
    const FULL = {
      ref: 'SBC-FULL', status: 'sent', sentAt: '2026-09-18T10:00:00Z',
      customer: { name: 'Jan', address: 'Upper East Side' },
      request: { service: 'Carpentry', description: 'Molding install and closet' },
      estimate: {
        projectTitle: 'Upper East Side Apartment — Molding', timelineText: '5 to 7 days', markupPct: 25, notes: 'Internal band $8,000-$9,500. Squeeze the materials.',
        showLaborCost: true, showMaterialsCost: false,
        labor: [{ section: 'Carpentry', item: 'Floor and surface protection', qty: 4, unit: 'hrs', rate: 60 }, { section: 'Carpentry', item: 'Install customer-supplied molding', qty: 220, unit: 'ft', rate: 6.5 }],
        materials: [{ section: 'Carpentry', item: '16-gauge finish nails', qty: 1, unit: 'box', rate: 16.99 }],
        serviceBreakdown: [{ title: 'Carpentry', subtotal: 9181.16, included: ['Before any cutting begins, protection'], customerSupplies: [{ text: 'Lumber and wood material' }], notIncluded: ['Option D — Prime and paint'], options: [{ label: 'Option B — Replace 2 premium acoustic windows', price: 4393.75, description: 'each window' }] }],
        options: [{ label: 'Option A — Crown molding', price: 1250 }],
        finishGroups: [{ name: 'Paint sheen', options: [{ name: 'Eggshell', price: 0, isDefault: true }, { name: 'Satin', price: 120 }] }],
        pricingReadiness: { status: 'PRELIMINARY_ESTIMATE_WITH_ASSUMPTIONS', confidence_score: 62, reason: 'Room sizes not given.' },
        clarificationQuestions: [{ question: 'How many closets?' }],
        generationTiming: { scopeReused: true },
        assumptions: ['Ceilings are 9 ft'],
      },
      customerSelections: [{ group: 'Paint sheen', option: 'Satin', upgrade: 120 }],
      invoices: [{ number: 'INV-7', amount: 3000, status: 'unpaid' }],
      contract: { signedAt: '2026-09-19T00:00:00Z' },
    };
    STORES.estimates.set('SBC-FULL', JSON.stringify(FULL));
    sent = null; reply = 'Labor is 2 lines.';
    await call({ ref: 'SBC-FULL', messages: [{ role: 'user', text: 'why is labor so high?' }] });
    const sys = sent.system;
    ok('EVERY LABOR LINE IS THERE, with qty, unit, rate and line total', /\[Carpentry\] \| Install customer-supplied molding \| 220 ft \| @ \$6\.50 \| = \$1,430\.00/.test(sys) && /Floor and surface protection \| 4 hrs \| @ \$60\.00 \| = \$240\.00/.test(sys), sys.slice(sys.indexOf('LABOR LINES'), sys.indexOf('LABOR LINES') + 260));
    ok('and every material line, with its id', /MATERIAL LINES \(1\)/.test(sys) && /M1 \| \[Carpentry\] \| 16-gauge finish nails \| 1 box \| @ \$16\.99/.test(sys));
    /* labor 240 + 1430 = 1670, x1.25 = 2087.50; materials hidden, so that is the customer total */
    ok('the totals as the customer sees them - labor shown, materials hidden', /labor \$2,087\.50/.test(sys) && /materials \(hidden from customer\)/.test(sys) && /customer total \$2,087\.50/.test(sys), sys.slice(sys.indexOf('TOTALS THE CUSTOMER SEES'), sys.indexOf('TOTALS THE CUSTOMER SEES') + 200));
    /* the card carries the price the customer reads - the labor-only total on a
       one-card job - not the stored publish-time subtotal ($9,181.16) */
    ok('the service card: included, customer supplies, not included - and NO priced options (alternatives are gone)', /Carpentry - \$2,087\.50/.test(sys) && !/9,181\.16/.test(sys) && /included: Before any cutting begins/.test(sys) && /customer supplies: Lumber and wood material/.test(sys) && /NOT included: Option D/.test(sys) && !/priced options:/.test(sys));
    ok('the finish choices, and no ALTERNATIVES OFFERED line any more', !/ALTERNATIVES OFFERED/.test(sys) && /Paint sheen: Eggshell \(default\) \$0\.00; Satin \$120\.00/.test(sys));
    ok('what the customer chose', /WHAT THE CUSTOMER CHOSE: Paint sheen = Satin \(\+\$120\.00\)/.test(sys));
    ok('how sure: status, confidence, reason, open questions, scope held', /PRELIMINARY_ESTIMATE_WITH_ASSUMPTIONS, confidence 62% - Room sizes not given\./.test(sys) && /open questions: How many closets\?/.test(sys) && /scope held from the previous run/.test(sys));
    ok('assumptions, invoices, contract, dates', /ASSUMPTIONS MADE: Ceilings are 9 ft/.test(sys) && /INVOICES: INV-7 \$3,000\.00 unpaid/.test(sys) && /CONTRACT: signed 2026-09-19/.test(sys) && /SENT TO CUSTOMER: 2026-09-18/.test(sys));
    ok('THE INTERNAL NOTES AND THE MARKUP ARE STILL NOT THERE', sys.indexOf('8,000') === -1 && sys.indexOf('Squeeze') === -1 && !/[Mm]arkup/.test(sys) && sys.indexOf('25%') === -1, (sys.match(/.*(8,000|Squeeze|arkup|25%).*/) || [''])[0]);
    ok('it is told it may read and add up the lines, but still never price', /you MAY read them back, add them up/.test(sys) && /Never invent a price/.test(sys));

    const huge = JSON.parse(JSON.stringify(FULL));
    huge.estimate.labor = Array.from({ length: 400 }, (_, i) => ({ section: 'Carpentry', item: 'A rather long labor line description number ' + i, qty: i, unit: 'hrs', rate: 60 }));
    STORES.estimates.set('SBC-HUGE', JSON.stringify(huge));
    sent = null;
    await call({ ref: 'SBC-HUGE', messages: [{ role: 'user', text: 'hi' }] });
    /* The estimate itself is capped at ESTIMATE_CHARS (9k); the rules around
       it grow a line at a time (the inbox rules added ~1.4k, the lines and
       regenerate actions ~2k). */
    ok('a huge estimate is cut, not sent whole', /estimate cut here/.test(sent.system) && sent.system.length < 35000, sent.system.length + ' chars');

    STORES.estimates.set('SBC-THIN', JSON.stringify({ ref: 'SBC-THIN', status: 'new', customer: { name: 'x' }, request: { description: 'test request' }, estimate: {} }));
    sent = null;
    await call({ ref: 'SBC-THIN', messages: [{ role: 'user', text: 'hi' }] });
    ok('a record with no estimate yet adds nothing', sent.system.indexOf('THE GENERATED ESTIMATE') === -1 && /test request/.test(sent.system));
  }

  /* ══ IT REMEMBERS ═══════════════════════════════════════════════════════ */
  console.log('\nit remembers what he tells it\n');
  {
    sent = null; reply = 'Got it.\nACTION: {"type":"remember","text":"Frank Gaynor wants a call before 9 am"}';
    const r = await call({ messages: [{ role: 'user', text: 'remember Frank wants a call before 9' }], screen: SCREEN });
    const stored = JSON.parse(STORES['assistant-memory'].get('notes') || '[]');
    ok('A "REMEMBER" ACTION IS STORED ON THE SERVER', stored.length === 1 && stored[0].text === 'Frank Gaynor wants a call before 9 am', JSON.stringify(stored));
    ok('...and not handed to the dashboard as something to run', r.body.actions.length === 0);
    ok('...and the ACTION line is stripped from what he reads', r.body.reply === 'Got it.', JSON.stringify(r.body.reply));

    sent = null; reply = 'Sure.';
    await call({ messages: [{ role: 'user', text: 'what did I say about Frank?' }], screen: SCREEN });
    ok('THE NOTE IS IN THE NEXT CALL\'S PROMPT', /THINGS HE ASKED YOU TO REMEMBER:\n- Frank Gaynor wants a call before 9 am/.test(sent.system));

    for (let i = 0; i < 160; i++) { reply = 'ok\nACTION: {"type":"remember","text":"note ' + i + '"}'; await call({ messages: [{ role: 'user', text: 'r' }] }); }
    const many = JSON.parse(STORES['assistant-memory'].get('notes'));
    ok('memory is capped at 150, newest kept', many.length === 150 && many[149].text === 'note 159', many.length + ' notes');
    STORES['assistant-memory'].clear();
  }

  /* ══ IT ACTS - THROUGH A CLOSED LIST ════════════════════════════════════ */
  console.log('\nactions are parsed from the answer, and only the known ones\n');
  {
    reply = 'Opening it now.\nACTION: {"type":"open","ref":"SBC-1"}';
    let r = await call({ messages: [{ role: 'user', text: 'open Maria' }], screen: SCREEN });
    ok('AN "OPEN" ACTION COMES BACK AS DATA, off the text', r.body.reply === 'Opening it now.' && r.body.actions.length === 1 && r.body.actions[0].type === 'open' && r.body.actions[0].ref === 'SBC-1', JSON.stringify(r.body));

    reply = 'Two things.\nACTION: {"type":"tab","tab":"visits"}\nACTION: {"type":"status","ref":"SBC-2","status":"completed"}';
    r = await call({ messages: [{ role: 'user', text: 'x' }], screen: SCREEN });
    ok('several actions, in order', r.body.actions.map(a => a.type).join(',') === 'tab,status' && r.body.actions[1].status === 'completed');

    reply = 'ok\nACTION: {"type":"delete","ref":"SBC-1"}\nACTION: {"type":"tab","tab":"secret"}\nACTION: {"type":"status","ref":"SBC-1","status":"paid-in-cash"}\nACTION: {"type":"visit","customer":"X"}\nACTION: not json';
    r = await call({ messages: [{ role: 'user', text: 'x' }], screen: SCREEN });
    ok('AN UNKNOWN TYPE, A BAD TAB, A BAD STATUS, A VISIT WITH NO TIME, AND NON-JSON ARE ALL DROPPED', r.body.actions.length === 0, JSON.stringify(r.body.actions));
    ok('...the good text remains', r.body.reply === 'ok');

    reply = 'A visit:\nACTION: {"type":"visit","customer":"Ken Wu","address":"88 Bay 7th St","datetime":"2026-09-21T09:00","reason":"measure","ref":"SBC-2"}';
    r = await call({ messages: [{ role: 'user', text: 'x' }], screen: SCREEN });
    ok('a visit action carries every field', r.body.actions[0] && r.body.actions[0].datetime === '2026-09-21T09:00' && r.body.actions[0].address === '88 Bay 7th St');

    reply = 'Here:\nACTION: {"type":"draft","text":"Hi Maria, thanks for the photos. Can you confirm the tile size?"}';
    r = await call({ messages: [{ role: 'user', text: 'x' }], screen: SCREEN });
    ok('a draft action carries the text', r.body.actions[0] && /tile size/.test(r.body.actions[0].text));

    /* A cut-off answer. */
    fn._setBudgetForTests(250); stall = true;
    reply = 'Changing it.\nACTION: {"type":"status","ref":"SBC-2","status":"completed"}';
    r = await call({ messages: [{ role: 'user', text: 'x' }], screen: SCREEN });
    ok('A TRUNCATED ANSWER CARRIES NO ACTIONS - half an action is worse than none', r.body.truncated === true && r.body.actions.length === 0, JSON.stringify(r.body));
    stall = false; fn._setBudgetForTests(8800);

    reply = 'ACTION: {"type":"tab","tab":"new"}';
    r = await call({ messages: [{ role: 'user', text: 'x' }], screen: SCREEN });
    ok('an answer that is only an action still says something', r.body.reply === 'Done.' && r.body.actions.length === 1);
  }

  /* ══ THE DASHBOARD SIDE ═════════════════════════════════════════════════ */
  console.log('\nthe dashboard runs them with its own functions, and asks first where it matters\n');
  const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
  function ext(name) {
    const s = DASH.search(new RegExp('(?:async )?function ' + name + '\\s*\\('));
    if (s < 0) throw new Error('missing function ' + name);
    let d = 0;
    for (let j = DASH.indexOf('{', s); j < DASH.length; j++) {
      if (DASH[j] === '{') d++;
      else if (DASH[j] === '}') { d--; if (!d) return DASH.slice(s, j + 1); }
    }
    throw new Error('unbalanced ' + name);
  }
  function page(opts) {
    const o = opts || {};
    const calls = { opened: [], fetched: [], tabs: [], toasts: [], closed: 0, confirms: [] };
    const box = { value: o.boxValue || '', focus() { calls.focused = true; } };
    const ctx = {
      String, JSON, Array, Object, Number, Error, RegExp, Math, Date, console,
      estimates: o.estimates || [{ ref: 'SBC-1', status: 'sent', customer: { name: 'Maria Lopez' }, estimate: { projectTitle: 'Bath', customerTotal: 100, grandTotal: 140 }, request: {}, submittedAt: '2026-09-10T10:00:00Z', unpaidTotal: 0, invoiceCount: 0 }],
      visits: [], handymanBookings: [], custCache: null, activeTab: 'all', currentRecord: o.currentRecord || null,
      openEdit: (ref) => calls.opened.push(ref), closeEdit: () => { ctx.currentRecord = null; },
      renderTabs: () => calls.tabs.push('renderTabs'), renderList: () => calls.tabs.push('renderList'),
      aiClose: () => calls.closed++, toast: (t) => calls.toasts.push(t),
      confirm: (t) => { calls.confirms.push(t); return o.confirm !== false; },
      sbcFetch: async (url, opts2) => { calls.fetched.push({ url, body: JSON.parse(opts2.body) }); return { ok: true, json: async () => ({ ok: true, visit: { id: 'V-9', customer: 'Ken Wu', datetime: '2026-09-21T09:00' }, gcal: { status: 'ok' } }) }; },
      document: { getElementById: (id) => id === 'cnv-text' ? (o.noBox ? null : box) : (id === 'cnv-section' ? { scrollIntoView() { calls.scrolled = true; } } : null) },
      threadNeedsReply: () => false,
    };
    vm.createContext(ctx);
    vm.runInContext(ext('aiExec') + '\n' + ext('aiScreen'), ctx);
    return { ctx, calls, box, exec: (a) => vm.runInContext('aiExec(' + JSON.stringify(a) + ')', ctx) };
  }
  {
    const p = page();
    let said = await p.exec({ type: 'open', ref: 'SBC-1' });
    ok('OPEN CALLS openEdit WITH THE REF, and closes the drawer', p.calls.opened[0] === 'SBC-1' && p.calls.closed === 1 && /Opened SBC-1/.test(said), said);
    said = await p.exec({ type: 'open', ref: 'SBC-999' });
    ok('a ref that is not in the list is refused in words, not opened', p.calls.opened.length === 1 && /don't see SBC-999/.test(said), said);
    said = await p.exec({ type: 'tab', tab: 'visits' });
    ok('TAB SETS activeTab AND REDRAWS', p.ctx.activeTab === 'visits' && p.calls.tabs.join(',') === 'renderTabs,renderList', said);
  }
  {
    const p = page();
    const said = await p.exec({ type: 'status', ref: 'SBC-1', status: 'completed' });
    ok('STATUS ASKS HIM FIRST, naming the estimate and both statuses', p.calls.confirms.length === 1 && /SBC-1 \(Maria Lopez\) from sent to completed/.test(p.calls.confirms[0]), p.calls.confirms[0]);
    ok('...then saves through save-estimate with the key', p.calls.fetched[0] && /save-estimate/.test(p.calls.fetched[0].url) && p.calls.fetched[0].body.status === 'completed' && p.calls.fetched[0].body.ref === 'SBC-1');
    ok('...updates the row and redraws', p.ctx.estimates[0].status === 'completed' && /SBC-1 is now completed/.test(said));
  }
  {
    const p = page({ confirm: false });
    const said = await p.exec({ type: 'status', ref: 'SBC-1', status: 'completed' });
    ok('IF HE SAYS NO, NOTHING IS SAVED', p.calls.fetched.length === 0 && p.ctx.estimates[0].status === 'sent' && /not changed/.test(said), said);
  }
  {
    const p = page();
    const said = await p.exec({ type: 'visit', customer: 'Ken Wu', address: '88 Bay 7th St', datetime: '2026-09-21T09:00', reason: 'measure', ref: 'SBC-2' });
    ok('VISIT ASKS FIRST, showing name, address and time', /Ken Wu/.test(p.calls.confirms[0]) && /88 Bay 7th St/.test(p.calls.confirms[0]) && /2026-09-21 09:00/.test(p.calls.confirms[0]), p.calls.confirms[0]);
    ok('...then creates it through the visits endpoint', p.calls.fetched[0] && /functions\/visits/.test(p.calls.fetched[0].url) && p.calls.fetched[0].body.action === 'create' && p.calls.fetched[0].body.visit.datetime === '2026-09-21T09:00');
    ok('...adds it to the list and says it reached Google Calendar', p.ctx.visits.length === 1 && /Google Calendar/.test(said), said);
    const p2 = page({ confirm: false });
    await p2.exec({ type: 'visit', customer: 'Ken Wu', datetime: '2026-09-21T09:00' });
    ok('no confirm, no visit', p2.calls.fetched.length === 0 && p2.ctx.visits.length === 0);
  }
  {
    const p = page({ currentRecord: { ref: 'SBC-1' }, boxValue: 'Hi Maria,' });
    const said = await p.exec({ type: 'draft', text: 'Can you confirm the tile size?' });
    ok('DRAFT GOES INTO THE REPLY BOX, under what he already typed', p.box.value === 'Hi Maria,\n\nCan you confirm the tile size?', JSON.stringify(p.box.value));
    ok('...scrolls him to it, focuses it, and the toast says he still presses Send', p.calls.scrolled && p.calls.focused && /press Send reply/.test(p.calls.toasts[0]), p.calls.toasts[0]);
    ok('...and NOTHING WAS FETCHED - a draft is not a send', p.calls.fetched.length === 0);
    const p3 = page({ noBox: true });
    const s3 = await p3.exec({ type: 'draft', text: 'x' });
    ok('with no estimate open it says so instead of losing the text', /Open the estimate first/.test(s3), s3);
    const p4 = page();
    ok('an unknown action does nothing and says nothing', (await p4.exec({ type: 'send-email', to: 'x' })) === '' && p4.calls.fetched.length === 0);
  }
  {
    const src = ext('aiExec') + ext('aiRunActions') + ext('aiSend') + ext('aiCopyToCustomer');
    ok('NOTHING IN THE ASSISTANT CODE CALLS thread-reply OR send-reply', src.indexOf('thread-reply') === -1 && src.indexOf('send-reply') === -1 && src.indexOf('send-quote') === -1);
  }

  /* ══ THE SNAPSHOT ═══════════════════════════════════════════════════════ */
  console.log('\nthe snapshot it sends carries the list, not the internal numbers\n');
  {
    const p = page({ currentRecord: { ref: 'SBC-1', status: 'sent', customer: { name: 'Maria Lopez' }, estimate: { projectTitle: 'Bath', notes: 'Internal band $2,500-$3,500', markupPct: 45 }, invoices: [] } });
    p.ctx.activeTab = 'sent'; p.ctx.visits = [{ id: 'V-1', customer: 'Ken', datetime: '2026-09-20T10:00', done: false, gcalEventId: 'e' }, { id: 'V-2', customer: 'Old', datetime: '2026-09-01T10:00', done: true }];
    const s = vm.runInContext('aiScreen()', p.ctx);
    ok('TODAY IS THE NEW YORK DATE', /^\d{4}-\d{2}-\d{2}$/.test(s.today), s.today);
    ok('the open record and tab are named', s.ref === 'SBC-1' && s.tab === 'sent');
    ok('each estimate is one small object with the CUSTOMER total', s.estimates[0].ref === 'SBC-1' && s.estimates[0].total === 100 && s.estimates[0].name === 'Maria Lopez');
    ok('THE INTERNAL NOTES AND MARKUP ARE NOT IN IT', JSON.stringify(s).indexOf('2,500') === -1 && JSON.stringify(s).indexOf('markup') === -1 && JSON.stringify(s).indexOf('grandTotal') === -1);
    ok('done visits are left out, open ones say if they are in the calendar', s.visits.length === 1 && s.visits[0].inCalendar === true);
    ok('the open record summary is there', s.record && s.record.title === 'Bath' && s.record.total === '$100');
  }

  /* ══ THE PAGE ═══════════════════════════════════════════════════════════ */
  console.log('\nit can be opened from anywhere\n');
  {
    ok('THERE IS AN AI BUTTON IN THE TOPBAR', /<button class="topbar-btn" id="ai-open-btn" onclick="aiOpen\(\)"/.test(DASH));
    ok('...that stays visible on a phone, where the other topbar buttons hide', /\.topbar > button#ai-open-btn \{ display: inline-flex; \}/.test(DASH));
    ok('...and an entry in the ☰ menu', /<button id="menu-ai" onclick="sbcCloseDrawer\(\);aiOpen\(\)"/.test(DASH));
    ok('the drawer exists with its log, box and Ask button', /<div id="ai-drawer" class="ai-drawer"/.test(DASH) && /id="ai-log"/.test(DASH) && /id="ai-text"/.test(DASH) && /id="ai-btn-send" onclick="aiSend\(\)">Ask</.test(DASH));
    ok('Enter sends, Shift+Enter makes a new line', /onkeydown="if\(event\.key==='Enter'&&!event\.shiftKey\)\{event\.preventDefault\(\);aiSend\(\);\}"/.test(DASH));
    ok('the drawer says in writing that nothing is sent to a customer', /Nothing here is sent to a customer: a draft goes into the reply box and you press Send/.test(DASH));
    ok('the in-record panel sends the same screen snapshot', /screen: \(typeof aiScreen === "function" \? aiScreen\(\) : null\)/.test(ext('askSend')));
    ok('...and runs actions that come back, into its own log', /aiRunActions\(data\.actions, ASK_LOG\[ref\], askRender\)/.test(ext('askSend')));
    ok('both panels ask through aiAsk, which reads the reply as text first', /await aiAsk\(/.test(ext('aiSend')) && /await aiAsk\(/.test(ext('askSend')) && /await res\.text\(\)/.test(ext('aiAsk')) && ext('aiAsk').indexOf('res.json()') === -1);
    ok('the chat survives a reload of the page but not a new day - sessionStorage', /sessionStorage\.setItem\("sbc-ai-log"/.test(DASH));
    const blocks = DASH.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    let broken = null;
    blocks.forEach(function (b, i) { try { new vm.Script(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; } });
    ok('all ' + blocks.length + ' script blocks parse', broken === null, broken || '');
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e));
  process.exit(1);
});
