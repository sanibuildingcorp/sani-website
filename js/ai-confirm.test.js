/* ai-confirm.test.js — run: node js/ai-confirm.test.js
 *
 *   "I didn't not pressed anything!!! I text him to Remove all duplicated
 *    lines from the scope. And hi just text me what you see in screenshot!
 *    No asking anything! No shows me anything! He just ignore!"
 *
 * window.confirm() on iPhone Safari returns false at once, with no box,
 * when the page is not on screen - and an answer arrives thirty seconds
 * after he asked, often with the phone locked or another app in front.
 * The dashboard read that as Cancel. Every yes/no an action needs is now a
 * bubble in the chat with two buttons that waits until he taps one.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
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
function harness() {
  const calls = { fetched: [], browserConfirms: 0, toasts: [], rendered: 0 };
  const posts = [
    { success: true, applied: false, changed: true, count: 2, lines: [{ text: 'Site setup - protect the entry', count: 8 }, { text: 'Provide and use ram Board', count: 3 }], similar: [] },
    { success: true, applied: true, changed: true, count: 2, lines: [], similar: [], estimate: { projectTitle: 'DEDUPED', labor: [] } },
  ];
  const ctx = {
    String, JSON, Array, Object, Number, Error, RegExp, Math, Date, console, encodeURIComponent, Promise, setTimeout: (f) => f(),
    estimates: [{ ref: 'SBC-1', status: 'sent' }], currentRecord: { ref: 'SBC-1', estimate: {}, sentAt: '2026-09-10T00:00:00Z' },
    visits: [], activeTab: 'all', renderTabs() {}, renderList() {}, openEdit() {}, closeEdit() {}, aiClose() {}, aiStartSearch() {}, AI_LOG: [], aiRender() {}, aiSave() {}, aiTurn: (m) => m, aiScreen: () => null, aiAsk: async () => ({ reply: '', actions: [] }),
    renderEdit() { calls.rendered++; }, toast: (t) => calls.toasts.push(t), confirm: () => { calls.browserConfirms++; return true; }, document: { getElementById: () => null },
    esc: (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    aiLinkify: (s) => String(s).replace(/\n/g, '<br>'), aiPicsHtml: () => '',
    sbcFetch: async (url, o) => { calls.fetched.push(JSON.parse(o.body)); return { ok: true, json: async () => posts.shift() }; },
  };
  vm.createContext(ctx);
  vm.runInContext('var AI_CONFIRMS = {};', ctx);
  ['aiConfirm', 'aiConfirmAnswer', 'aiConfirmHtml', 'askBubble', 'aiBubble', 'aiExec', 'aiResendSkipped', 'aiRunActions'].forEach((n) => vm.runInContext(ext(n), ctx));
  return { ctx, calls, posts };
}

(async () => {
  console.log('\n1. The question is a bubble with buttons, not a browser box\n');
  {
    const h = harness();
    h.ctx.LOG = [{ role: 'user', text: 'Remove all duplicated lines from the scope.' }];
    let rendered = 0; h.ctx.render = () => { rendered++; };
    const p = vm.runInContext('aiExec({ type: "dedupe", ref: "SBC-1" }, LOG, render)', h.ctx);
    await new Promise((r) => setTimeout(r, 10));
    const q = h.ctx.LOG[1];
    ok('AFTER THE DRY RUN THE CHAT HOLDS THE QUESTION with two buttons, and NO browser confirm was called', h.calls.browserConfirms === 0 && q && q.role === 'assistant' && /^Remove 2 repeated lines from the scope of SBC-1\?/.test(q.text) && q.confirm && q.okLabel === 'Remove them' && q.cancelLabel === 'Not now' && rendered === 1, JSON.stringify(h.ctx.LOG.slice(1)));
    const html = vm.runInContext('askBubble(LOG[1], 1)', h.ctx);
    ok('...the bubble renders the question and the two buttons wired to the answer', /class="ask-msg ask-ai ask-confirm"/.test(html) && /Remove 2 repeated lines/.test(html) && new RegExp("onclick=\"aiConfirmAnswer\\('" + q.confirm + "', true\\)\">Remove them<").test(html) && /aiConfirmAnswer\('[^']+', false\)">Not now</.test(html) && !/ask-copy/.test(html), html);
    ok('...and the action is still waiting: only the dry run was posted', h.calls.fetched.length === 1);
    vm.runInContext('aiConfirmAnswer(LOG[1].confirm, true)', h.ctx);
    const said = await p;
    ok('HE TAPS "Remove them": the apply is posted, the record redrawn, the answer says what was removed', h.calls.fetched.length === 2 && h.calls.fetched[1].apply === true && h.ctx.currentRecord.estimate.projectTitle === 'DEDUPED' && /^Removed 2 repeated lines on SBC-1/.test(said), said);
    ok('...the bubble now shows the tick and the label, buttons gone', q.answered === 'ok' && /ask-confirm-done">✓ Remove them</.test(vm.runInContext('aiBubble(LOG[1], 1)', h.ctx)) && !/ask-confirm-btns/.test(vm.runInContext('aiBubble(LOG[1], 1)', h.ctx)) && rendered === 2);
  }

  console.log('\n2. Not now, and an expired question\n');
  {
    const h = harness();
    h.ctx.LOG = [{ role: 'user', text: 'remove them' }];
    h.ctx.render = () => {};
    const p = vm.runInContext('aiExec({ type: "dedupe", ref: "SBC-1" }, LOG, render)', h.ctx);
    await new Promise((r) => setTimeout(r, 10));
    vm.runInContext('aiConfirmAnswer(LOG[1].confirm, false)', h.ctx);
    const said = await p;
    ok('"Not now": nothing posted, the answer says so plainly and how to come back', h.calls.fetched.length === 1 && /^Cancelled - nothing was removed\. Ask me again when you want them removed\.$/.test(said) && h.ctx.LOG[1].answered === 'no', said);
    vm.runInContext('aiConfirmAnswer("c-gone", true)', h.ctx);
    ok('a button from a question that no longer waits (page reloaded) says the question expired', h.calls.toasts.some((t) => /That question has expired - ask me again\./.test(t)));
  }

  console.log('\n3. Every yes/no an action needs goes the same way; a caller with no chat gets the browser box\n');
  {
    const src = ext('aiExec');
    ok('status, visit, describe, reword, dedupe and addservice all ask through the chat', (src.match(/await ask\(log, render, /g) || []).length >= 6 && !/(?<![a-zA-Z.])confirm\(/.test(src.replace(/return Promise\.resolve\(!!confirm\(text\)\)/, '')), String((src.match(/await ask\(log, render, /g) || []).length));
    ok('the added section is confirmed in the chat, then addServiceAI runs with alreadyConfirmed', /await ask\(log, render, "Add this as its own section of "/.test(src) && /addServiceAI\(brief, svc, true\)/.test(src));
    const h = harness();
    const said = await vm.runInContext('aiExec({ type: "dedupe", ref: "SBC-1" })', h.ctx);
    ok('no chat to put it in: the browser box is used and the flow completes', h.calls.browserConfirms === 1 && /^Removed 2 repeated lines/.test(said));
    ok('the styles for the buttons exist', /\.ask-confirm-ok\{/.test(DASH) && /\.ask-confirm-no\{/.test(DASH) && /\.ask-confirm-done\{/.test(DASH));
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
