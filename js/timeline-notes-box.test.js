/* timeline-notes-box.test.js — run: node js/timeline-notes-box.test.js
 *
 *   "This large text is hiding in my dashboard ... which is hard to read or
 *    rewrite in my dashboard if i need update texts"
 *
 * ESTIMATED TIMELINE and INTERNAL NOTES were <input type="text">. The AI writes a
 * PARAGRAPH into both. On SBC-260901 the timeline read:
 *
 *   "Ceiling texture sampling can be collected within 1-2 business days of
 *    contract, with lab results in 24-72 hours; no scraping starts until results
 *    are in hand. We can have your approval-ready alteration package — scope
 *    narrative, trade documentation and certificates of insurance naming the
 *    corporation, managing agent and any required additional insureds — to
 *    management within 3-5 business days..."
 *
 * A single-line input showed about forty characters of that and scrolled the rest
 * off sideways. The customer saw the whole thing in their quote; the contractor
 * who was supposed to be able to correct it could not read it.
 *
 * Both are now textareas that size themselves to their content on open.
 *
 * THE ONE THAT WOULD HURT MOST: a textarea holds its value as INNER TEXT, not in
 * a value="" attribute. Two ways that silently corrupts the record —
 *
 *   1. Whitespace. A newline immediately after <textarea> is swallowed by the
 *      HTML parser, but any other leading space is kept and gets saved straight
 *      back into the estimate on the next Save. The template must therefore put
 *      the value tight against the tag.
 *   2. Escaping. An unescaped "</textarea>" inside the text closes the element
 *      early and dumps the rest of the estimate's own markup into the page.
 *
 * Both are asserted below by building the real template and reading it back.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* ── the real esc(), lifted out of the page ─────────────────────────────── */
function ext(name) {
  const s = HTML.search(new RegExp('(async )?function ' + name + '\\('));
  if (s < 0) throw new Error('missing ' + name);
  let d = 0;
  for (let j = HTML.indexOf('{', s); j < HTML.length; j++) {
    if (HTML[j] === '{') d++;
    else if (HTML[j] === '}') { d--; if (!d) return HTML.slice(s, j + 1); }
  }
}
const ctx = { console, String, Number, Object, Array, JSON };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(ext('esc'), ctx);

/* ── build the two fields exactly as the page builds them ───────────────── */
const TEMPLATE = (function () {
  const i = HTML.indexOf("'<label>Estimated Timeline (customer sees)</label>'");
  if (i < 0) throw new Error('could not find the timeline field');
  /* End just past the </div> that closes the notes field, so the fragment is a
     balanced run of string concatenations and nothing else. */
  const notes = HTML.indexOf('</textarea>', HTML.indexOf('id="f-notes"', i));
  const j = HTML.indexOf("'</div>' +", notes);
  if (notes < 0 || j < 0) throw new Error('could not find the end of the notes field');
  return HTML.slice(i, j + "'</div>'".length);
})();

function render(timeline, notes) {
  const est = { timelineText: timeline, notes: notes };
  /* The template is a run of '...' + '...' fragments; evaluate it as one
     expression against the real esc(). */
  const expr = TEMPLATE.replace(/\+\s*$/, '').trim().replace(/\+$/, '');
  ctx.est = est;
  return vm.runInContext('(' + expr.replace(/\/\*[\s\S]*?\*\//g, '') + ')', ctx);
}

/* ══ THE SHAPE OF THE CONTROL ═════════════════════════════════════════════ */
console.log('\nboth long-text fields are textareas, not single-line inputs\n');
ok('ESTIMATED TIMELINE IS A TEXTAREA — this is the whole bug',
  /<textarea id="f-timeline"/.test(HTML) && !/<input type="text" id="f-timeline"/.test(HTML));
ok('INTERNAL NOTES IS A TEXTAREA',
  /<textarea id="f-notes"/.test(HTML) && !/<input type="text" id="f-notes"/.test(HTML));
ok('both open at five rows rather than one',
  (HTML.match(/<textarea id="f-(timeline|notes)" rows="5"/g) || []).length === 2);
/* Asserted against the RENDERED output, not the source. In the source this
   handler lives inside a JS string, so its quotes are backslash-escaped and a
   regex written against the raw file matches nothing — which is how the first
   version of this line failed while the page was perfectly correct. */
ok('both grow as you type',
  (render('x', 'y').match(/oninput="this\.style\.height='auto';this\.style\.height=this\.scrollHeight\+2\+'px'"/g) || []).length === 2);

/* ══ THE ONE THAT WOULD HURT MOST ═════════════════════════════════════════ */
console.log('\nthe text goes in clean and comes back out unchanged\n');
{
  const REAL = "Ceiling texture sampling can be collected within 1-2 business days of contract, "
    + "with lab results in 24-72 hours; no scraping starts until results are in hand. We can have "
    + "your approval-ready alteration package — scope narrative, trade documentation and "
    + "certificates of insurance naming the corporation, managing agent and any required additional "
    + "insureds — to management within 3-5 business days.";
  const html = render(REAL, 'Watch items: (1) The asbestos sample is the gate.');

  /* Pull the inner text back out the way a browser would. */
  const inner = (html.match(/<textarea id="f-timeline"[^>]*>([\s\S]*?)<\/textarea>/) || [])[1];
  ok('the timeline value is present in full', inner !== undefined && inner.length > 300, (inner || '').length + ' chars');
  ok('NO LEADING WHITESPACE — it would be saved back into the record verbatim',
    inner !== undefined && inner === inner.replace(/^\s+/, ''), JSON.stringify((inner || '').slice(0, 12)));
  ok('no trailing whitespace either',
    inner !== undefined && inner === inner.replace(/\s+$/, ''));

  const decoded = (inner || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  ok('THE TEXT ROUND-TRIPS EXACTLY — every character the AI wrote survives',
    decoded === REAL, decoded === REAL ? '' : 'differs at ' + [...REAL].findIndex((c, k) => decoded[k] !== c));

  const n = (html.match(/<textarea id="f-notes"[^>]*>([\s\S]*?)<\/textarea>/) || [])[1];
  ok('the internal notes round-trip too',
    (n || '').replace(/&#39;/g, "'") === 'Watch items: (1) The asbestos sample is the gate.', n);
}

console.log('\ntext that would break the element out\n');
{
  const HOSTILE = 'done </textarea><script>alert(1)</script> in 5 days';
  const html = render(HOSTILE, '');
  ok('A LITERAL </textarea> IN THE TEXT CANNOT CLOSE THE BOX EARLY',
    html.indexOf('</textarea><script>') === -1);
  ok('...and only the two real closing tags exist',
    (html.match(/<\/textarea>/g) || []).length === 2, (html.match(/<\/textarea>/g) || []).length + ' found');
  const inner = (html.match(/<textarea id="f-timeline"[^>]*>([\s\S]*?)<\/textarea>/) || [])[1];
  const decoded = (inner || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  ok('...and the contractor still sees exactly what he typed',
    decoded === HOSTILE, decoded);
}
{
  const html = render('', '');
  ok('an empty timeline renders an empty box, not the string "undefined"',
    /<textarea id="f-timeline"[^>]*><\/textarea>/.test(html), (html.match(/f-timeline[\s\S]{0,90}/) || [])[0]);
  ok('...and the placeholder still tells him what goes there',
    /placeholder="e\.g\. 5-7 business days"/.test(html));
}
{
  /* A real record where the AI used line breaks. */
  const ML = 'Week 1: sampling and lab.\nWeek 2: board package.\nWeek 3-6: board review.';
  const inner = (render(ML, '').match(/<textarea id="f-timeline"[^>]*>([\s\S]*?)<\/textarea>/) || [])[1];
  ok('line breaks survive — a textarea can hold them and an input never could',
    inner === ML, JSON.stringify(inner));
}

/* ══ WHAT MUST NOT HAVE BROKEN ════════════════════════════════════════════ */
console.log('\nsaving still reads the same two fields the same way\n');
ok('the timeline is still read with .value.trim()',
  /timelineText: document\.getElementById\("f-timeline"\)\.value\.trim\(\)/.test(HTML));
ok('the notes are still read with .value.trim()',
  /notes: document\.getElementById\("f-notes"\)\.value\.trim\(\)/.test(HTML));
/* One literal lookup each — the save function. The render-time sizing loop
   reaches them through a variable, so it does not add a second literal. If this
   count ever climbs, a new call site exists that also has to cope with the
   value being inner text rather than an attribute. */
ok('each id is looked up literally in exactly one place, so there is no second call site to update',
  (HTML.match(/getElementById\("f-timeline"\)/g) || []).length === 1 &&
  (HTML.match(/getElementById\("f-notes"\)/g) || []).length === 1,
  (HTML.match(/getElementById\("f-timeline"\)/g) || []).length + ' / ' +
  (HTML.match(/getElementById\("f-notes"\)/g) || []).length);

console.log('\nthe box is the right size the moment the estimate opens\n');
ok('BOTH BOXES ARE SIZED ON RENDER — otherwise a paragraph still looks like one line until you type',
  /\["f-timeline", "f-notes"\]\.forEach/.test(HTML) &&
  /box\.style\.height = \(box\.scrollHeight \+ 2\) \+ "px"/.test(HTML));
ok('...and that runs inside the estimate editor, after the markup exists',
  HTML.indexOf('["f-timeline", "f-notes"].forEach') > HTML.indexOf('<textarea id="f-timeline"'));
ok('a very long paragraph stops growing before it swallows the page',
  /\.field textarea\.grow-box \{ max-height: 340px; overflow-y: auto; \}/.test(HTML));
ok('both boxes carry the class that cap applies to',
  (HTML.match(/class="grow-box"/g) || []).length === 2);

/* ══ THE FILE THAT TAKES EVERYTHING DOWN ══════════════════════════════════ */
console.log('\nevery script block in dashboard.html still parses\n');
{
  const blocks = HTML.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
  let broken = null;
  blocks.forEach(function (b, i) {
    const body = b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    try { new (require('vm').Script)(body); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; }
  });
  ok('all ' + blocks.length + ' blocks parse — a slip here blanks the whole dashboard',
    broken === null, broken || '');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
