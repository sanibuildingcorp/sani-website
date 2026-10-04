/* quote-price-card.test.js — run: node js/quote-price-card.test.js
 *
 *   [screenshot: the "Price by service" card on a customer's quote reads
 *    "${e.showSectionSubtotals!==false?rows:''}${costRows(e,ct)}${addedRows}"
 *    and the total row reads "Your estimate  ${M(shown)}"]
 *   "In all estimate in this section shows like this, i don't know what is
 *    this or if we need it or if it's error and need to remove"
 *
 * It was an error, on every priced quote, since the "Nobody is asked to
 * approve nothing" change. That change wrapped the prices card in a
 * conditional - `${hasPrice ? `...` : ''}` - and the edit that did it wrote
 * the placeholders INSIDE the nested template as "\${". In a template literal
 * a backslash before the dollar sign means "print this literally", so the
 * customer was shown the code instead of the price rows. The total in the
 * hero and the per-service prices were fine; only the card between them was.
 *
 * Every script block parsed, every existing test passed: nothing executed the
 * nested template, and a parse check cannot tell an escaped placeholder from a
 * real one. This file can: it renders the card the way the browser does.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const QUOTE = fs.readFileSync(path.join(ROOT, 'quote.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* ══ THE STATIC RULE ══════════════════════════════════════════════════════ */
console.log('\nno placeholder in quote.html is escaped into literal text\n');
{
  const escaped = (QUOTE.match(/\\\$\{/g) || []).length;
  ok('THERE IS NO "\\${" ANYWHERE IN quote.html — every one of them was code shown to a customer', escaped === 0, escaped + ' found');
}

/* ══ THE CARD, RENDERED ═══════════════════════════════════════════════════ */
console.log('\nthe prices card renders rows and a money total, not source code\n');
{
  /* Lift the exact nested template out of renderV7 and evaluate it the way
     the browser does, with stand-ins for the helpers it calls. */
  const line = QUOTE.split('\n').find(l => l.startsWith('function renderV7('));
  const s = line.indexOf('${hasPrice?`<section class="card prices">');
  const e = line.indexOf('</section>`:\'\'}', s);
  ok('the prices card template was found in renderV7', s > 0 && e > s);
  const tpl = line.slice(s + '${hasPrice?'.length, e + '</section>`'.length);
  const ctx = {
    e: { showSectionSubtotals: true }, ct: {}, shown: 12441.07,
    rows: '<div class="pr"><b>Bathroom</b><b>$12,441.07</b></div>',
    addedRows: '',
    costRows: () => '<div class="pr"><span>Labor</span><span>$9,000.00</span></div>',
    M: (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 }),
  };
  vm.createContext(ctx);
  const html = vm.runInContext(tpl, ctx);
  ok('THE PER-SERVICE ROW IS THERE', html.indexOf('<b>Bathroom</b><b>$12,441.07</b>') !== -1, html.slice(0, 200));
  ok('the cost rows are there', html.indexOf('<span>Labor</span>') !== -1);
  ok('THE TOTAL IS MONEY, NOT "${M(shown)}"', /<span>Your estimate<\/span><span>\$12,441\.07<\/span>/.test(html), (html.match(/Your estimate<\/span><span>[^<]*/) || [])[0]);
  ok('no source code leaks into the card', html.indexOf('${') === -1 && html.indexOf('costRows(') === -1, html);

  ctx.e = { showSectionSubtotals: false };
  const noSub = vm.runInContext(tpl, ctx);
  ok('with per-service prices switched off the rows are dropped, the total stays', noSub.indexOf('<b>Bathroom</b>') === -1 && /\$12,441\.07/.test(noSub));
}
{
  /* "In this project in the cards i need remove prices for in the customer side":
     with the switch off, each service card's heading carries no price either. */
  const line = QUOTE.split('\n').find(l => l.startsWith('function renderV7('));
  const s = line.indexOf('<div class="head">'), e = line.indexOf('<div class="body">', s);
  const tpl = '`' + line.slice(s, e) + '`';
  const ctx = { e: { showSectionSubtotals: true }, s: { title: 'Kitchen', subtotal: 1093.63 }, i: 0, E: (x) => String(x), chosenFor: () => [], M: (n) => '$' + Number(n).toFixed(2) };
  vm.createContext(ctx);
  const on = vm.runInContext(tpl, ctx);
  ok('A SERVICE CARD SHOWS ITS PRICE when the switch is on (the default)', /<h2>Kitchen<\/h2><\/div><b>\$1093\.63<\/b>/.test(on), on);
  ctx.e = { showSectionSubtotals: false };
  const off = vm.runInContext(tpl, ctx);
  ok('...AND NONE when it is off - the heading is the service name only', off.indexOf('$') === -1 && /<h2>Kitchen<\/h2><\/div><\/div>/.test(off), off);
  ctx.e = {};
  ok('an older estimate with no setting keeps its card prices', /\$1093\.63/.test(vm.runInContext(tpl, ctx)));
  ok('the prices card says "Your price" when the cards carry none', line.indexOf("${e.showSectionSubtotals!==false?'Price by service':'Your price'}") !== -1);
  const pdf = fs.readFileSync(path.join(__dirname, '..', 'netlify/functions/lib/estimate-pdf.js'), 'utf8');
  ok('the customer PDF: same heading, and its card bands already follow the switch', /e\.showSectionSubtotals !== false \? "Price by service" : "Your price"/.test(pdf) && /num\(c\.subtotal\) > 0 && e\.showSectionSubtotals !== false \?/.test(pdf));
  const dash = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
  ok('the dashboard switch says what it does, in plain words', /Show a price on each service card<\/div>/.test(dash) && /Off = the customer sees only the total, no price on the cards/.test(dash));
  ok('...and "Preview what the customer sees" hides the card prices too', /var cardPrices = !\(currentRecord && currentRecord\.estimate && currentRecord\.estimate\.showSectionSubtotals === false\);/.test(dash) && /\(cardPrices \? '<span class="sc-prev-total">'/.test(dash));
}
{
  const line = QUOTE.split('\n').find(l => l.startsWith('function renderLegacy('));
  const s = line.indexOf('${hasPrice?`<section class="card prices">');
  const e = line.indexOf('</section>`:\'\'}', s);
  ok('the prices card template was found in renderLegacy too', s > 0 && e > s);
  const tpl = line.slice(s + '${hasPrice?'.length, e + '</section>`'.length);
  const ctx = { e: {}, ct: { total: 1479.83 }, costRows: () => '<div class="pr">ROWS</div>', M: (n) => '$' + Number(n).toFixed(2) };
  vm.createContext(ctx);
  const html = vm.runInContext(tpl, ctx);
  ok('the legacy card renders rows and money as well', html.indexOf('ROWS') !== -1 && /Your estimate<\/span><span>\$1479\.83/.test(html), html);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
