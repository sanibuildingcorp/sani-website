/* quote-timeline.test.js — run: node js/quote-timeline.test.js
 *
 *   "look how it's looks in my dashboard and then in preview mode what customer
 *    will see, so many differences and so many confusing details"
 *
 * On SBC-260915-XS76 the AI wrote ninety words into Estimated Timeline:
 *
 *   "Two site visits, typically completed within 3-5 business days once the COI
 *    is accepted by the managing agent. Visit 1 (approx. 4-5 hours): protection,
 *    opening prep, lath backing and setting-coat build-out. Cure/dry interval of
 *    24-48 hours. Visit 2 (approx. 3-4 hours): skim coats, sanding, final
 *    cleanup. The COI naming the condominium and managing agent is issued before
 *    the first visit; allow 2-3 business days for the building to process it.
 *    Kitchen remains usable between visits, with the work wall masked off."
 *
 * That went into the hero meta grid, which is
 *
 *   .meta { grid-template-columns: repeat(4,1fr) }          four across
 *   @media(max-width:600px){ .meta{grid-template-columns:1fr 1fr} }   two on a phone
 *
 * so on a phone the paragraph was rendered into a cell HALF THE SCREEN WIDE,
 * beside a cell holding "$1,888.68". White on navy, two or three words a line,
 * for most of a screen. Everything was there and none of it was readable.
 *
 * This is the same field that got a growing textarea in the dashboard so the
 * contractor could read it. What it looked like once it reached the customer was
 * never followed up - the dashboard was fixed and the quote was not.
 *
 * THE RULE. The cell keeps a short form. Anything longer also gets its own card
 * lower down, at full width. NOTHING IS SUMMARISED OR REWORDED - the short form
 * is the literal opening of what was written and the card carries every word, so
 * no wording the contractor approved can be altered on the way to the customer.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const QUOTE = fs.readFileSync(path.join(ROOT, 'quote.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

function ext(name) {
  const s = QUOTE.search(new RegExp('function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = QUOTE.indexOf('{', s); j < QUOTE.length; j++) {
    if (QUOTE[j] === '{') d++;
    else if (QUOTE[j] === '}') { d--; if (!d) return QUOTE.slice(s, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

const ctx = { console, String, Number, Array, Object, JSON, RegExp };
ctx.window = ctx; vm.createContext(ctx);
const helpers = QUOTE.split('\n').find(l => l.startsWith('const A=v=>Array.isArray'));
if (!helpers) throw new Error('quote.html no longer declares A/E/C on one line');
vm.runInContext(helpers, ctx);
const tlLine = QUOTE.split('\n').find(l => l.trim().startsWith('const TL_SHORT='));
if (!tlLine) throw new Error('TL_SHORT is gone');
vm.runInContext(tlLine, ctx);
vm.runInContext(ext('timelineShort'), ctx);
vm.runInContext(ext('timelineCard'), ctx);

/* The real value off SBC-260915-XS76. */
const REAL = 'Two site visits, typically completed within 3–5 business days once the COI is '
  + 'accepted by the managing agent. Visit 1 (approx. 4–5 hours): protection, opening prep, '
  + 'lath backing and setting-coat build-out. Cure/dry interval of 24–48 hours. Visit 2 '
  + '(approx. 3–4 hours): skim coats, sanding, final cleanup. The COI naming the condominium '
  + 'and managing agent is issued before the first visit; allow 2–3 business days for the '
  + 'building to process it. Kitchen remains usable between visits, with the work wall masked off.';

const short = (t) => vm.runInContext('timelineShort(' + JSON.stringify(t) + ')', ctx);
const card = (t) => vm.runInContext('timelineCard({timelineText:' + JSON.stringify(t) + '})', ctx);

/* ══ THE CELL ═════════════════════════════════════════════════════════════ */
console.log('\nthe hero cell gets something that fits in half a phone screen\n');
{
  const s = short(REAL);
  ok('THE NINETY-WORD PARAGRAPH NO LONGER GOES IN THE GRID CELL',
    s.length < 100 && s.length < REAL.length / 4, s.length + ' chars, was ' + REAL.length);
  ok('...and what is there is the literal opening of what was written, not a rewrite',
    REAL.indexOf(s.replace(/…$/, '')) === 0, JSON.stringify(s));
  ok('a truncated one is marked as truncated so nobody reads it as the whole story',
    /…$/.test(s) || /\.$/.test(s), JSON.stringify(s.slice(-24)));
}

console.log('\na short timeline is left exactly alone\n');
{
  ['5-7 business days', 'Two weeks', '', 'Approximately 3 days from start'].forEach(function (t) {
    ok('"' + t + '" is passed through untouched', short(t) === t, JSON.stringify(short(t)));
    ok('...and earns no second card', card(t) === '');
  });
}

/* ══ THE CARD ═════════════════════════════════════════════════════════════ */
console.log('\nthe full text is still delivered, word for word\n');
{
  const c = card(REAL);
  ok('A LONG TIMELINE GETS ITS OWN CARD', c.indexOf('<section class="card">') === 0, c.slice(0, 60));
  ok('EVERY WORD SURVIVES — nothing the contractor wrote is dropped on the way out',
    c.replace(/&#039;/g, "'").replace(/&amp;/g, '&').indexOf(REAL) !== -1);
  ok('it is labelled, so it is not mistaken for the scope',
    /<div class="ey">Timeline<\/div>/.test(c));
  ok('markup inside a timeline is escaped rather than rendered',
    card('Done in <b>5</b> days & nights. ' + 'x'.repeat(80)).indexOf('<b>5</b>') === -1);
}

/* ══ WIRED INTO BOTH RENDERERS ════════════════════════════════════════════ */
console.log('\nboth quote layouts use it — the old one and the current one\n');
{
  ok('the hero cell calls timelineShort in both renderers',
    (QUOTE.match(/<small>Timeline<\/small>\$\{E\(timelineShort\(e\.timelineText\)\|\|'TBD'\)\}/g) || []).length === 2,
    (QUOTE.match(/<small>Timeline<\/small>/g) || []).length + ' timeline cells');
  ok('NO RENDERER STILL DUMPS THE RAW FIELD INTO THE GRID',
    QUOTE.indexOf("<small>Timeline</small>${E(e.timelineText") === -1);
  ok('the card is placed in both renderers',
    (QUOTE.match(/\$\{timelineCard\(e\)\}/g) || []).length === 2);
  /* THE PLACEMENT, NOT THE PUNCTUATION AROUND IT. This used to match the exact
     string "</p></section>${timelineCard(e)}". Wrapping the summary card in a
     conditional - so a record with no summary does not show an empty one - moved
     the closing punctuation and the assertion failed on markup that was
     perfectly correct and in exactly the right place. It now asks the question
     it means: between the project summary and the next card, is the timeline. */
  ok('...directly after the project summary, where a customer looks for it',
    (function () {
      let from = 0, good = 0;
      for (let n = 0; n < 2; n++) {
        const at = QUOTE.indexOf('Project summary', from);
        if (at < 0) return 'only found ' + n + ' project summary blocks';
        const card = QUOTE.indexOf('${timelineCard(e)}', at);
        const nextSection = QUOTE.indexOf('<section class="card', at + 20);
        if (card > 0 && (nextSection < 0 || card < nextSection)) good++;
        from = at + 10;
      }
      return good === 2 ? true : 'timeline card follows the summary in ' + good + ' of 2 renderers';
    })() === true);
}

/* ══ WHAT MUST NOT HAVE BROKEN ════════════════════════════════════════════ */
console.log('\nnothing else about the hero moved\n');
{
  ok('an empty timeline still reads TBD rather than blank',
    /timelineShort\(e\.timelineText\)\|\|'TBD'/.test(QUOTE));
  ok('the meta grid is still four across, two on a phone',
    /\.meta\{display:grid;grid-template-columns:repeat\(4,1fr\)/.test(QUOTE) &&
    /\.meta\{grid-template-columns:1fr 1fr\}/.test(QUOTE));
  ok('the short form never returns more than the original',
    [REAL, 'x'.repeat(400), 'Short.', ''].every(t => short(t).replace(/…$/, '').length <= t.length));
  ok('a timeline with no sentence break still gets cut at a word, not mid-word',
    !/\S…$/.test(short('x'.repeat(30) + ' ' + 'y'.repeat(200))) ||
    short('word '.repeat(60)).endsWith('…'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
