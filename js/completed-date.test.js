/* completed-date.test.js — run: node js/completed-date.test.js
 *
 *   "i need add date for completed jobs for let's my AI read and know when
 *    job was completed and it's good for remaining for me too"
 *
 * Mark Completed stamped "now"; he marks jobs days after the last day on
 * site. It asks for the date now (default today), shows it on the record and
 * on the list, lets him change it, and the assistant and the history read it.
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

console.log('\nMark Completed asks for the date\n');
{
  const calls = [], toasts = [], removed = [];
  let appended = null, confirms = 0;
  const ctx = {
    String, Number, Date, RegExp, JSON, console,
    currentRecord: { ref: 'SBC-1', status: 'accepted', customer: { name: 'Stephanie' }, estimate: {} },
    estimates: [{ ref: 'SBC-1', status: 'accepted' }],
    esc: (s) => String(s), toast: (t) => toasts.push(t), closeEdit: () => calls.push('closeEdit'), renderTabs: () => {}, renderList: () => {},
    confirm: () => { confirms++; return true; },
    sbcFetch: async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); return { ok: true, json: async () => ({}) }; },
    document: { getElementById: (id) => id === 'cmp-overlay' ? { remove() { removed.push(id); } } : null, createElement: () => ({ style: {}, set innerHTML(v) { appended = v; } }), body: { appendChild() {} } },
  };
  vm.createContext(ctx);
  vm.runInContext(ext('todayLocal') + '\n' + ext('fmtDay') + '\n' + ext('completedDayOf') + '\n' + ext('openCompletedModal') + '\n' + ext('finishCompleted') + '\n' + ext('markCompleted'), ctx);
  const today = vm.runInContext('todayLocal()', ctx);
  ok('todayLocal is YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(today), today);
  (async () => {
    await vm.runInContext('markCompleted(true)', ctx);
    ok('MARK COMPLETED OPENS THE DATE WINDOW, and saves nothing yet', appended !== null && calls.length === 0 && confirms === 0);
    ok('...with a date input defaulting to today, capped at today', new RegExp('<input type="date" id="cmp-date" value="' + today + '" max="' + today + '"').test(appended), (appended.match(/<input[^>]*>/) || [''])[0]);
    ok('...naming the customer', /Stephanie/.test(appended));
    await vm.runInContext('finishCompleted("2026-09-18")', ctx);
    ok('FINISHING WITH A DATE SAVES status completed, completedOn, and completedAt at noon that day', calls[0] && /save-estimate/.test(calls[0].url) && calls[0].body.status === 'completed' && calls[0].body.estimate.completedOn === '2026-09-18' && new Date(calls[0].body.estimate.completedAt).toISOString().slice(0, 10) === new Date('2026-09-18T12:00:00').toISOString().slice(0, 10), JSON.stringify(calls[0] && calls[0].body));
    ok('...updates the open record and the list row, closes the window and the record', ctx.currentRecord.estimate.completedOn === '2026-09-18' && ctx.estimates[0].completedOn === '2026-09-18' && ctx.estimates[0].status === 'completed' && removed.includes('cmp-overlay') && calls.includes('closeEdit'));
    ok('...and says the date back', /Completed on Sep 18, 2026/.test(toasts[0]), toasts[0]);
    calls.length = 0;
    await vm.runInContext('finishCompleted("nope")', ctx);
    ok('a bad date is refused, nothing saved', calls.length === 0 && /Pick a date/.test(toasts[toasts.length - 1]));
    await vm.runInContext('markCompleted(false)', ctx);
    ok('REOPEN still confirms and clears both date fields', confirms === 1 && calls[0].body.status === 'accepted' && calls[0].body.estimate.completedAt === null && calls[0].body.estimate.completedOn === null && ctx.estimates[0].completedOn === null);

    console.log('\nthe date is shown, and can be changed\n');
    ok('the record shows "Completed on <date>" with a Change date button', /🏁 Completed on <strong>' \+ esc\(fmtDay\(completedDayOf\(currentRecord\)\) \|\| 'date not set'\)/.test(DASH) && /onclick="openCompletedModal\(\)">✎ Change date/.test(DASH));
    ok('the list badge carries the date on completed jobs', /e\.status === 'completed' && fmtDay\(e\.completedOn \|\| e\.completedAt\)/.test(DASH));
    ok('fmtDay reads a plain day or an ISO instant', vm.runInContext('fmtDay("2026-09-18")', ctx) === 'Sep 18, 2026' && vm.runInContext('fmtDay("2026-09-18T16:00:00.000Z")', ctx) === 'Sep 18, 2026' && vm.runInContext('fmtDay("")', ctx) === '');
    ok('completedDayOf prefers the day he picked over the instant', vm.runInContext('completedDayOf({estimate:{completedOn:"2026-09-18",completedAt:"2026-09-20T02:00:00Z"}})', ctx) === '2026-09-18');

    console.log('\nthe assistant and the list know the date\n');
    const LE = fs.readFileSync(path.join(ROOT, 'netlify/functions/list-estimates.js'), 'utf8');
    ok('list-estimates sends completedAt and completedOn', /completedAt: e\.estimate\?\.completedAt \|\| null,/.test(LE) && /completedOn: e\.estimate\?\.completedOn \|\| null,/.test(LE));
    ok('the screen snapshot carries the completed day', /completed: d\(e\.completedOn \|\| e\.completedAt\)/.test(ext('aiScreen')));
    const A = fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant.js'), 'utf8');
    ok('the assistant prints it on the list line and on the open estimate', /" completed " \+ str\(e\.completed\)/.test(A) && /lines\.push\("COMPLETED: "/.test(A));
    const I = require(path.join(ROOT, 'netlify/functions/lib/insights.js'));
    const ins = I.buildInsights([{ ref: 'A', status: 'completed', customer: { name: 'x' }, request: { service: 'Paint' }, estimate: { labor: [{ qty: 1, rate: 1000 }], completedOn: '2026-09-18', completedAt: '2026-09-18T16:00:00.000Z' }, sentAt: '2026-09-01T00:00:00Z', acceptedAt: '2026-09-03T00:00:00Z' }], new Date('2026-09-20T00:00:00Z'));
    ok('the nightly history counts the days to completion from it', ins.recentAccepted[0].completedAt === '2026-09-18' && ins.recentAccepted[0].daysToComplete === 15, JSON.stringify(ins.recentAccepted[0]));

    const blocks = DASH.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    let broken = null;
    blocks.forEach(function (b, i) { try { new vm.Script(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; } });
    ok('all ' + blocks.length + ' script blocks parse', broken === null, broken || '');
    console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
    process.exit(fail ? 1 : 0);
  })().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
}
