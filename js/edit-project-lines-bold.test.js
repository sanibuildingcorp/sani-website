/* edit-project-lines-bold.test.js — run: node js/edit-project-lines-bold.test.js
 *
 *   "In there if i want add or change some text it's not allowed me, make it
 *    editable and if i wanna make bold text somewhere let me do it too in
 *    keyboard. Example if i wanna make Damage protection words bold"
 *
 * 1. "Included for the whole project" is edited by hand: a box per line, ✕,
 *    + Add, saved with Save (it was read-only: "ask Ask AI").
 * 2. Bold: select words in any customer line and tap B (or Ctrl/Cmd+B); the
 *    words are wrapped in **...** and tapping again takes it off.
 * 3. The customer's page, the dashboard preview and the PDF print them bold.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const QUOTE = fs.readFileSync(path.join(ROOT, 'quote.html'), 'utf8');
const cut = (src, name) => { const s = src.search(new RegExp('function ' + name + '\\s*\\(')); let d = 0; for (let j = src.indexOf('{', s); j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) return src.slice(s, j + 1); } } };

console.log('\n1. the whole-project lines are editable\n');
{
  const renders = [];
  const ctx = { currentRecord: { estimate: { projectIncluded: ['We cover the floor.', { text: 'OUR DAMAGE GUARANTEE: we repair it.' }, ''] } }, renderScopeControl: () => renders.push(1), document: { querySelectorAll: () => [] } };
  vm.createContext(ctx);
  vm.runInContext(['projList', 'projEdit', 'projDelete', 'projAdd'].map((n) => cut(DASH, n)).join('\n'), ctx);
  vm.runInContext("projEdit(1, 'OUR DAMAGE GUARANTEE: if anything is damaged, we repair it.')", ctx);
  ok('A LINE IS CHANGED IN PLACE (the list becomes plain text lines)', JSON.stringify(ctx.currentRecord.estimate.projectIncluded) === JSON.stringify(['We cover the floor.', 'OUR DAMAGE GUARANTEE: if anything is damaged, we repair it.']));
  vm.runInContext('projAdd()', ctx);
  ok('+ Add puts a new line at the end', ctx.currentRecord.estimate.projectIncluded.length === 3 && renders.length === 1);
  vm.runInContext("projEdit(2, '   ')", ctx);
  ok('emptying a line removes it', ctx.currentRecord.estimate.projectIncluded.length === 2 && renders.length === 2);
  vm.runInContext('projDelete(0)', ctx);
  ok('✕ deletes a line', JSON.stringify(ctx.currentRecord.estimate.projectIncluded) === JSON.stringify(['OUR DAMAGE GUARANTEE: if anything is damaged, we repair it.']));
  ok('the panel shows a box per line with ✕ and + Add, not "ask Ask AI"', /class="sc-item pi-item" rows="1"/.test(DASH) && /onchange="projEdit\(' \+ i \+ ',this\.value\)"/.test(DASH) && /onclick="projDelete\(' \+ i \+ '\)"/.test(DASH) && /onclick="projAdd\(\)">\+ Add<\/button>/.test(DASH) && DASH.indexOf('To change a line, ask Ask AI.') === -1);
  ok('...and Save carries it (projectIncluded is carried on every save)', /"projectIncluded", "projectExclusions"/.test(DASH));
}

console.log('\n2. bold: select, tap B\n');
{
  const ctx = {}; vm.createContext(ctx); vm.runInContext(cut(DASH, 'boldToggle'), ctx);
  const t = 'OUR DAMAGE GUARANTEE: if anything is damaged, we repair it.';
  const on = ctx.boldToggle(t, 0, 21);
  ok('SELECTED WORDS ARE WRAPPED IN **...**', on.text === '**OUR DAMAGE GUARANTEE:** if anything is damaged, we repair it.' && on.text.slice(on.a, on.b) === '**OUR DAMAGE GUARANTEE:**', JSON.stringify(on));
  const off1 = ctx.boldToggle(on.text, 2, 23);
  ok('tapping B again on the bold words takes the bold off (selection inside the marks)', off1.text === t, JSON.stringify(off1));
  const off2 = ctx.boldToggle(on.text, on.a, on.b);
  ok('...or with the marks selected too', off2.text === t);
  ok('a space at the edge of a selection stays outside the marks', ctx.boldToggle('we repair it', 2, 10).text === 'we **repair** it');
  ok('nothing selected: nothing changes (he is told to select first)', ctx.boldToggle(t, 5, 5) === null && /toast\("Select the words first, then tap B"\)/.test(cut(DASH, 'boldApply')));
  ok('the B button appears while a customer line is being typed, above the keyboard, and keeps the selection', /document\.addEventListener\("focusin"/.test(DASH) && /b\.addEventListener\("mousedown", function \(e\) \{ e\.preventDefault\(\); \}\);/.test(DASH) && /vv\.offsetTop \+ vv\.height - 58/.test(DASH));
  ok('Ctrl/Cmd+B works on a keyboard', /\(e\.ctrlKey \|\| e\.metaKey\) && \(e\.key === "b" \|\| e\.key === "B"\) && boldTarget\(e\.target\)/.test(DASH));
  ok('it saves through the line\'s own change handler', /el\.dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\);/.test(cut(DASH, 'boldApply')));
}

console.log('\n3. printed bold for the customer\n');
{
  const ctx = { String }; vm.createContext(ctx);
  vm.runInContext(QUOTE.split('\n').find((l) => l.startsWith('const A=v=>Array.isArray')), ctx);
  vm.runInContext(cut(QUOTE, 'EB') + cut(QUOTE, 'list'), ctx);
  const html = ctx.list('', 'in', ['**OUR DAMAGE GUARANTEE:** we repair it.', 'plain line']);
  ok('THE CUSTOMER\'S PAGE SHOWS THE WORDS BOLD', /<li><b>OUR DAMAGE GUARANTEE:<\/b> we repair it\.<\/li>/.test(html) && /<li>plain line<\/li>/.test(html), html);
  ok('...and nothing else in a line can become HTML', ctx.EB('**<img src=x>** & "q"') === '<b>&lt;img src=x&gt;</b> &amp; &quot;q&quot;');
  ok('the dashboard preview shows bold too', /var escB = function \(t\) \{ return esc\(t\)\.replace\(\/\\\*\\\*\(\[\^\*\\n\]\+\?\)\\\*\\\*\/g, "<b>\$1<\/b>"\); \};/.test(DASH));
  const { Doc, unmark } = require(path.join(ROOT, 'netlify/functions/lib/pdf-writer.js'));
  const d = new Doc({ title: 't' });
  d.text('**OUR DAMAGE GUARANTEE:** we repair it.', { bullet: '•' });
  const op = d.pages[0][d.pages[0].length - 1];
  ok('THE PDF PRINTS THEM IN BOLD (Helvetica-Bold), the rest as usual, no stars', /\/F2 11 Tf \(OUR\) Tj \/F2 11 Tf \( DAMAGE\) Tj \/F2 11 Tf \( GUARANTEE:\) Tj \/F1 11 Tf \( we\) Tj/.test(op) && op.indexOf('*') === -1, op);
  const d2 = new Doc({ title: 't' }); d2.text('plain words only');
  ok('a line with no marks prints exactly as before', /^BT \/F1 11 Tf .* \(plain words only\) Tj ET$/.test(d2.pages[0][d2.pages[0].length - 1]));
  ok('a table row or a band drops the marks rather than printing stars', unmark('**Kitchen** card') === 'Kitchen card');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
