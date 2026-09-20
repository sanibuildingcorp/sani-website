/* scope-pdf.test.js — run: node js/scope-pdf.test.js
 *
 *   "Yes build the download PDF button"
 *
 * The scope of work as a file: scope-pdf?ref=… returns a real PDF laid out
 * from the same scope-only view the page renders, so it carries no price and
 * nothing private. When python3 with PyMuPDF is available the PDF is opened
 * and its text read back; otherwise the structural checks still run.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const QUOTE = fs.readFileSync(path.join(ROOT, 'quote.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const clone = (o) => JSON.parse(JSON.stringify(o));

const STORE = new Map();
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return '@netlify/blobs'; return origResolve.call(this, request, ...rest); };
require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: () => ({ get: async (k) => (STORE.has(k) ? clone(STORE.get(k)) : null) }) } };
const PW = require(path.join(ROOT, 'netlify/functions/lib/pdf-writer.js'));
const SP = require(path.join(ROOT, 'netlify/functions/lib/scope-pdf.js'));
const SO = require(path.join(ROOT, 'netlify/functions/lib/scope-only.js'));
const fn = require(path.join(ROOT, 'netlify/functions/scope-pdf.js'));

/* Read a PDF's text with PyMuPDF, when it is there. */
function pdfText(buf) {
  const tmp = path.join(require('os').tmpdir(), 'sbc-scope-' + process.pid + '.pdf');
  fs.writeFileSync(tmp, buf);
  try {
    const r = cp.spawnSync('python3', ['-c', 'import sys\ntry:\n import pymupdf as fitz\nexcept Exception:\n import fitz\nd=fitz.open(sys.argv[1])\nsys.stdout.write("\\f".join(p.get_text() for p in d))\nsys.stdout.write("\\nPAGES=%d\\n" % len(d))', tmp], { encoding: 'utf8', timeout: 20000 });
    if (r.status !== 0) return null;
    const m = r.stdout.match(/\nPAGES=(\d+)\n$/);
    if (!m) return null;
    return { pages: Number(m[1]), text: r.stdout.slice(0, m.index) };
  } catch (e) { return null; } finally { try { fs.unlinkSync(tmp); } catch (e) {} }
}

const EST = {
  projectTitle: 'Apartment Renovation — 3855 Shore Pkwy, 1K', summary: 'Crown molding in three rooms and a repaint.', markupPct: 25, notes: 'INTERNAL haggles',
  labor: [{ item: 'Install crown molding @ $6.50/ft', qty: 220, unit: 'ft', rate: 6.5, section: 'Carpentry' }],
  materials: [{ item: 'Crown molding, primed MDF', qty: 220, unit: 'ft', rate: 2.1, section: 'Carpentry' }],
  serviceBreakdown: [
    { title: 'Carpentry', subtotal: 2400, included: ['Install crown molding in the living room, the master bedroom, the second bedroom and the hallway, with mitred inside and outside corners and caulked joints ready for paint', 'Allowance $500 for corner blocks'], customerSupplies: [], notIncluded: ['Ceiling repairs', 'Do not price this as a full renovation'], options: [{ label: 'Option A — Crown molding premium profile', description: 'Larger 5.25" profile', price: 1350 }, { label: 'Option B — hidden', price: 900 }] },
    { title: 'Painting', subtotal: 1125, included: ['Prime and paint all new molding'], customerSupplies: ['Paint'], notIncluded: [], options: [] },
  ],
  offeredOptions: ['option a — crown molding premium profile'], timelineText: '5-7 business days', customerPresentationVersion: 'v8.1-deterministic-four-service',
};
const base = { customer: { name: 'Jan Kowalski', email: 'jan@example.com', address: '3855 Shore Pkwy, 1K, Brooklyn, NY' }, request: { service: 'Carpentry' }, thread: [{ id: 'm1', from: 'customer', text: 'Can you do $3,500?', at: '2026-09-19T00:00:00Z' }], contract: { total: 4406 }, includeContractForCustomer: true, customerFinalTotal: 4406.25 };
const SENT = Object.assign(clone(base), { ref: 'SBC-PDF1', status: 'sent', sentAt: '2026-09-18T00:00:00Z', estimate: Object.assign(clone(EST), { summary: 'LIVE DRAFT SUMMARY' }), sentVersion: { snapshotVersion: 1, n: 1, at: '2026-09-18T00:00:00Z', estimate: clone(EST), customerFinalTotal: 4406.25 } });
const UNSENT = Object.assign(clone(base), { ref: 'SBC-PDF2', status: 'drafted', estimate: clone(EST) });
[SENT, UNSENT].forEach((r) => STORE.set(r.ref, r));

console.log('\nthe writer: a valid PDF, wrapped text, the standard fonts\n');
{
  const d = new PW.Doc({ title: 'T — test', footerLeft: 'left', footerRight: 'R' });
  d.text('Hello — “world” ✓ • · … é', { bold: true });
  d.text('word '.repeat(300));
  for (let i = 0; i < 80; i++) d.text('line ' + i);
  const buf = d.build();
  const s = buf.toString('latin1');
  ok('starts with %PDF-1.4 and ends with %%EOF', /^%PDF-1\.4\n/.test(s) && /%%EOF\n$/.test(s));
  ok('only the standard fonts are named, nothing embedded', /\/BaseFont \/Helvetica /.test(s) && /\/BaseFont \/Helvetica-Bold /.test(s) && !/FontFile/.test(s));
  const start = Number((s.match(/startxref\n(\d+)/) || [])[1]);
  ok('the xref table sits where startxref says', s.slice(start, start + 4) === 'xref', String(start));
  const firstOff = Number((s.match(/xref\n0 \d+\n0000000000 65535 f \n(\d{10})/) || [])[1]);
  ok('...and its first offset lands on "1 0 obj"', s.slice(firstOff, firstOff + 7) === '1 0 obj', s.slice(firstOff, firstOff + 12));
  ok('a long paragraph wraps into many lines, none wider than the page', (s.match(/\(word /g) || []).length > 10 && PW.wrap('word '.repeat(300), 11, false, PW.CONTENT_W).every((l) => PW.textWidth(l, 11, false) <= PW.CONTENT_W));
  ok('more text than one page makes more pages, each with a page number', /\/Count (\d+)/.test(s) && Number(s.match(/\/Count (\d+)/)[1]) >= 2 && /Page 1 of \d/.test(s) && /Page 2 of \d/.test(s));
  ok('the dash and quotes become WinAnsi bytes, the tick becomes a bullet, emoji vanish', PW.literal('a — b') === '(a \\227 b)' && PW.normalize('✓ x') === '• x' && PW.normalize('🏁 y') === ' y' && PW.normalize('“q”') === '“q”');
  const t = pdfText(buf);
  if (t) ok('PyMuPDF reads it back: the wrapped words, the footer, the page count', t.pages >= 2 && /Hello — “world” • • · … é/.test(t.text) && /Page 1 of/.test(t.text), (t.text.match(/Hello[^\n]*/) || [''])[0]);
  else console.log('skip  PyMuPDF not available - text read-back skipped');
}

console.log('\nthe document: the same cards as the page, nothing priced, nothing private\n');
(async () => {
  const view = require(path.join(ROOT, 'netlify/functions/get-estimate.js')).scopeView(clone(SENT));
  const cards = SP.scopeCards(view.estimate);
  ok('TWO SERVICE CARDS, with included / supplies / not included - and no alternative, checked or not', cards.length === 2 && cards[0].title === 'Carpentry' && cards[0].included.length === 2 && cards[1].supplies[0] === 'Paint' && cards[0].excluded.join('|') === 'Ceiling repairs' && cards[0].options.length === 0, JSON.stringify(cards).slice(0, 200));
  ok('an instruction written for the estimator is not a customer exclusion', cards[0].excluded.indexOf('Do not price this as a full renovation') === -1);
  const buf = SP.buildScopePdf(view, { now: '2026-09-20T12:00:00Z' });
  const s = buf.toString('latin1');
  ok('IT IS A PDF', /^%PDF-1\.4/.test(s) && /%%EOF\n$/.test(s) && buf.length > 2000, String(buf.length));
  /* Raw bytes: coordinates like "586.50" live in the stream, so the money
     figures checked here are ones no coordinate can spell. */
  ok('NO DOLLAR SIGN AND NO PRICE IN THE FILE', s.indexOf('$') === -1 && s.indexOf('4,406') === -1 && s.indexOf('4406') === -1 && s.indexOf('1350') === -1 && s.indexOf('1,350') === -1 && s.indexOf('2,400') === -1);
  ok('nothing private: no conversation, no notes, no email address of the customer, no hidden option', s.indexOf('3,500') === -1 && s.indexOf('haggles') === -1 && s.indexOf('jan@example.com') === -1 && s.indexOf('hidden') === -1);
  ok('the sent scope, not the live draft', s.indexOf('Crown molding in three rooms') !== -1 && s.indexOf('LIVE DRAFT') === -1);
  const t = pdfText(buf);
  if (t) {
    const x = t.text;
    ok('READ BACK: title, who it is for, the address, the reference and date', /Scope of Work/.test(x) && /Apartment Renovation — 3855 Shore Pkwy, 1K/.test(x) && /Prepared for: Jan Kowalski/.test(x) && /Project address: 3855 Shore Pkwy, 1K, Brooklyn, NY/.test(x) && /Reference: SBC-PDF1/.test(x) && /Date: September 20, 2026/.test(x), (x.match(/Date:[^\n]*/) || [''])[0]);
    ok('...the summary and the timeline', /Project summary/.test(x) && /Crown molding in three rooms and a repaint\./.test(x) && /Timeline/.test(x) && /5-7 business days/.test(x));
    ok('...both services with their sections', /Service 1[^\n]*Carpentry/.test(x) && /Service 2[^\n]*Painting/.test(x) && /Included in this service/.test(x) && /Customer supplies/.test(x) && /Not included/.test(x) && /Ceiling repairs/.test(x) && /Paint\n/.test(x));
    ok('...a long included line, wrapped, all of it there', /Install crown molding in the living room/.test(x) && /ready for paint/.test(x));
    ok('...the allowance line with the dollar figure scrubbed', /Allowance for corner blocks/.test(x));
    ok('...NO alternative in the PDF, and "no pricing" said twice', !/Optional alternatives/.test(x) && !/Option A — Crown molding premium profile/.test(x) && (x.match(/no pricing is included|contains no pricing/gi) || []).length >= 2);
    ok('...fully insured, never the forbidden word', /fully insured/.test(x) && !/licensed/i.test(x));
  } else console.log('skip  PyMuPDF not available - text read-back skipped');
  const legacy = SP.buildScopePdf({ ref: 'SBC-L', customer: { name: 'A' }, estimate: { projectTitle: 'Old job', scopeOfWork: 'Sand and refinish the floors.\nSeal.', exclusions: ['Furniture moving'] } }).toString('latin1');
  ok('a legacy record with a scope text and no service cards still makes a document', /Sand and refinish the floors/.test(legacy) && /Furniture moving/.test(legacy));
  ok('a record with no scope at all says so instead of failing', /has not been written yet/.test(SP.buildScopePdf({ ref: 'X', estimate: {} }).toString('latin1')));
  const many = SP.buildScopePdf({ ref: 'SBC-M', estimate: { projectTitle: 'Big', serviceBreakdown: Array.from({ length: 6 }, (_, i) => ({ title: 'Service ' + i, included: Array.from({ length: 20 }, (_, j) => 'Task ' + j + ' with a reasonably long description of the work involved here'), notIncluded: ['x'] })) } }).toString('latin1');
  ok('a big scope runs to several pages, numbered', Number((many.match(/\/Count (\d+)/) || [])[1]) >= 3 && /Page 3 of/.test(many));
  ok('the file name comes from the ref', SP.fileName(view) === 'Scope-of-Work-SBC-PDF1.pdf');

  console.log('\nthe function: a download, from the ref alone\n');
  let r = await fn.handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { ref: 'SBC-PDF1' } });
  ok('GET ?ref= RETURNS THE PDF as a base64 attachment with its file name', r.statusCode === 200 && r.isBase64Encoded === true && r.headers['Content-Type'] === 'application/pdf' && r.headers['Content-Disposition'] === 'attachment; filename="Scope-of-Work-SBC-PDF1.pdf"' && /^%PDF-1\.4/.test(Buffer.from(r.body, 'base64').toString('latin1')), JSON.stringify(r.headers));
  const body = Buffer.from(r.body, 'base64').toString('latin1');
  ok('...with no price and no private matter in it', body.indexOf('$') === -1 && body.indexOf('4406') === -1 && body.indexOf('haggles') === -1 && body.indexOf('3,500') === -1);
  r = await fn.handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { ref: 'SBC-PDF2' } });
  ok('a never-sent estimate still gives its scope (management is asked first)', r.statusCode === 200 && Buffer.from(r.body, 'base64').toString('latin1').indexOf('Crown molding in three rooms') !== -1);
  r = await fn.handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { ref: 'SBC-NOPE' } });
  ok('unknown ref -> 404', r.statusCode === 404);
  r = await fn.handler({ httpMethod: 'GET', headers: {}, queryStringParameters: {} });
  ok('no ref -> 400', r.statusCode === 400);
  r = await fn.handler({ httpMethod: 'POST', headers: {}, body: '{}' });
  ok('POST -> 405', r.statusCode === 405);
  const GE = fs.readFileSync(path.join(ROOT, 'netlify/functions/get-estimate.js'), 'utf8');
  ok('the page and the PDF are built from ONE scope view in get-estimate', /exports\.scopeView = scopeView;/.test(GE) && /if \(isScopeOnly\) return \{ statusCode: 200, headers: cors\(\), body: JSON\.stringify\(scopeView\(data\)\) \};/.test(GE));
  const page = JSON.parse((await require(path.join(ROOT, 'netlify/functions/get-estimate.js')).handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { ref: 'SBC-PDF1', sow: '1' } })).body);
  ok('...and that view still carries no money', SO.findMoney(page).length === 0 && page.scopeOnly === true);

  console.log('\nthe buttons: on the page, in the email, in the dashboard window\n');
  ok('THE SCOPE PAGE HAS A DOWNLOAD PDF BUTTON pointing at scope-pdf, next to Print', /href="\/\.netlify\/functions\/scope-pdf\?ref=\$\{encodeURIComponent\(ref\)\}" download="Scope-of-Work-\$\{E\(ref\)\}\.pdf">⬇ Download PDF<\/a><button type="button" class="attach-btn printbtn" onclick="printQuote\(this\)">🖨 Print<\/button>/.test(QUOTE));
  const SL = fs.readFileSync(path.join(ROOT, 'netlify/functions/send-scope-link.js'), 'utf8');
  ok('the scope email carries the PDF link too, in text and as a button', /"Download it as a PDF:\\n" \+ pdfUrl/.test(SL) && /Download as PDF<\/a>/.test(SL) && /scope-pdf\?ref=/.test(SL));
  ok('the dashboard window has a PDF button', /onclick="window\.open\(scopePdfUrl\(\), \\'_blank\\'\)">⬇ PDF<\/button>/.test(DASH) && /function scopePdfUrl\(\)/.test(DASH));

  [['dashboard.html', DASH], ['quote.html', QUOTE]].forEach(([name, src]) => {
    const blocks = src.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    let broken = null;
    blocks.forEach(function (bl, i) { try { new vm.Script(bl.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { if (!broken) broken = 'block ' + (i + 1) + ': ' + e.message; } });
    ok(name + ': all ' + blocks.length + ' script blocks parse', broken === null, broken || '');
  });
  ok('every function file has a legal Netlify name', fs.readdirSync(path.join(ROOT, 'netlify/functions')).every(f => /^[A-Za-z0-9_-]+(\.m?js)?$/.test(f) || f === 'lib'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the suite crashed instead of reporting\n        ' + (e && e.stack || e)); process.exit(1); });
