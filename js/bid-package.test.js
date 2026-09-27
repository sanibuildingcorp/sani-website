/* bid-package.test.js — run: node js/bid-package.test.js
 *
 *   "I had registered in Blue book but i was registered for painting and it's
 *    was so hard to price out, all files was down with so many files and
 *    needed read all files"
 *
 * The bid package reader: every file added at once, the device keeps only the
 * pages about cabinets / millwork / unit counts / money rules, the AI counts
 * the kitchens per type and writes the questions for the GC, and one button
 * makes a draft estimate per kitchen type. Nothing here sets a price.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const T = require(path.join(ROOT, 'js/bid-triage.js'));
const BP = require(path.join(ROOT, 'netlify/functions/lib/bid-package.js'));
const HTML = fs.readFileSync(path.join(ROOT, 'bid-analyzer.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

console.log('\n1. the device keeps only our pages\n');
{
  const casework = T.scorePage('SECTION 06 41 00 ARCHITECTURAL WOOD CASEWORK PART 1 GENERAL. Kitchen cabinets shall be AWI Custom grade. Base cabinets, wall cabinets, fillers, toe kick.');
  const elev = T.scorePage('A-501 ENLARGED UNIT PLANS AND INTERIOR ELEVATIONS - KITCHEN ELEVATION TYPE K1. 36" BASE CABINET, 30" WALL CABINET');
  const matrix = T.scorePage('UNIT MATRIX  FLOOR 2  A1 A2 B1  FLOOR 3 A1 A2 B1  TOTAL UNITS 48');
  const mep = T.scorePage('M-201 MECHANICAL PLAN. DUCT 12x8, 450 CFM. CIRCUIT 12, PANELBOARD LP-2. SPRINKLER HEAD. CONDUIT RUN. KITCHEN EXHAUST DUCT');
  const blank = T.scorePage('   ');
  const bidForm = T.scorePage('BID FORM. Bids are due March 3 at 2 PM. Retainage 10%. Insurance requirements: general liability $2,000,000.');
  ok('THE CASEWORK SPEC, THE KITCHEN ELEVATIONS AND THE UNIT MATRIX SCORE HIGH', casework.score >= 30 && elev.score >= 25 && matrix.score >= 10, JSON.stringify([casework.score, elev.score, matrix.score]));
  ok('...and say why (shown to him)', casework.why.indexOf('Spec 06 41 00 casework') !== -1 && matrix.why.indexOf('Unit matrix') !== -1);
  ok('the bid form / insurance / retainage page is kept too', bidForm.score >= 15, String(bidForm.score));
  ok('a mechanical sheet that says "kitchen exhaust" once scores far below ours', mep.score < 5, String(mep.score));
  ok('a page with no text is marked as a scan, not scored', blank.textless === true && blank.score === 0);

  /* A package: spec book (300 pages, 6 of ours), drawings (200, 8 of ours), MEP (400, none), a scanned kitchen set. */
  const pages = [];
  const add = (file, name, n, ours, textless) => { for (let p = 1; p <= n; p++) pages.push({ file, name, page: p, score: textless ? 0 : (ours.indexOf(p) !== -1 ? 40 : (p % 7 === 0 ? 1 : 0)), textless: !!textless }); };
  add(0, 'Project Manual.pdf', 300, [120, 121, 122, 123, 124, 125]);
  add(1, 'Architectural.pdf', 200, [4, 50, 51, 52, 53, 54, 55, 56]);
  add(2, 'MEP.pdf', 400, []);
  add(3, 'Kitchen elevations scan.pdf', 12, [], true);
  add(4, 'Structural scan.pdf', 30, [], true);
  const picked = T.pickPages(pages);
  const has = (f, p) => picked.some((x) => x.file === f && x.page === p);
  ok('A 942-PAGE PACKAGE BECOMES AT MOST 90 PAGES', picked.length <= 90 && picked.length > 20, String(picked.length));
  ok('...every casework / elevation / matrix page is in', [120, 121, 122, 123, 124, 125].every((p) => has(0, p)) && [4, 50, 51, 52, 53, 54, 55, 56].every((p) => has(1, p)));
  ok('...a scanned file named "kitchen" keeps all its pages; a scanned structural set only its cover', [1, 5, 12].every((p) => has(3, p)) && has(4, 1) && !has(4, 2));
  ok('...the cover / sheet index of each file is read', has(0, 1) && has(1, 1) && has(2, 1));
  ok('...in file order, then page order (the page map depends on it)', picked.every((p, i) => i === 0 || picked[i - 1].file < p.file || (picked[i - 1].file === p.file && picked[i - 1].page < p.page)));
  const small = T.pickPages(pages.slice(0, 40));
  ok('a package that fits is kept whole - nothing is dropped that did not need to be', small.length === 40);
  const trimmed = T.trimTo(picked, 20);
  ok('too heavy: the best pages stay, the weakest go', trimmed.length === 20 && [120, 121, 122, 123, 124, 125].every((p) => trimmed.some((x) => x.file === 0 && x.page === p)));
  ok('the stamp on each page names the file and page, in plain characters', T.stampText('Élévations — A.pdf', 3, 12) === 'PAGE 12  |  SOURCE: _l_vations _ A.pdf  p.3');
  ok('the page map reads "p.1 = file p.x"', T.pageMapText(picked.slice(0, 2)) === 'p.1 = Project Manual.pdf p.1\np.2 = Project Manual.pdf p.7');
}

console.log('\n2. what the AI is asked\n');
{
  const pr = BP.packagePrompt({ pageMap: 'p.1 = A.pdf p.4', pagesKept: 1, pagesTotal: 900, fileCount: 3, notes: 'We install only.' });
  ok('IT COUNTS KITCHENS PER TYPE AND SHOWS THE MATH', /COUNT how many kitchens of each type/.test(pr) && /count_source/.test(pr));
  ok('it never prices', /NEVER write a price, a rate or a dollar figure of your own/.test(pr));
  ok('never guesses a count - null and a question instead', /Never guess a count/.test(pr));
  ok('the gas rule', /never set or connect an oven, range, cooktop or anything on a gas line/.test(pr));
  ok('the page map and his notes go in', /p\.1 = A\.pdf p\.4/.test(pr) && /We install only\./.test(pr) && /1 of 900 pages, from 3 file/.test(pr));
  ok('no "licensed" - and the AI is told never to write it', /Never use the word "licensed"\./.test(pr) && pr.replace('Never use the word "licensed".', '').indexOf('licensed') === -1);
  ok('THE CONTACT IS THE GC\'S BID PERSON, never the cabinet supplier or kitchen designer (a real reading picked the Porcelanosa designer)', /never a cabinet supplier, kitchen designer, architect or engineer/.test(pr));
}

console.log('\n3. what is kept of the answer\n');
{
  const R = BP.normalizePackage({
    project: { name: 'The Rivet', gc: 'Acme Builders', contact_email: 'not an email', page: 999 },
    supply: 'install_only',
    unit_types: [{ unit_type: 'A1', count: 12, kitchen_type: 'K1' }, { unit_type: 'A2', count: '8 units', kitchen_type: 'K1' }, { unit_type: 'B1', count: 16, kitchen_type: 'K2' }],
    kitchen_types: [
      { name: 'K1', count: 24, pages: [4, 4, 12, 500, 'x'], confidence: 'high', items: [{ item: 'Base cabinet 36 in', qty: '2', unit: 'ea', page: 12 }, { item: '' }] },
      { name: 'K2', count: 16, pages: [13], confidence: 'high' },
      { name: 'K3', count: 'N/A' },
    ],
    questions_for_gc: ['Who supplies the hardware?', { question: 'Is blocking by the GC?', page: 5 }],
    shared_pages: [20, 2],
  }, { pagesKept: 30, pagesTotal: 900, files: [{ name: 'a.pdf', pages: 900, kept: 30 }], pageMap: [{ file: 'a.pdf', page: 4 }] });
  const k1 = R.kitchen_types[0];
  ok('A UNIT LIST THAT DOES NOT ADD UP BECOMES A QUESTION FOR THE GC, AND THE COUNT IS MARKED LOW', k1.confidence === 'low' && R.checks.some((c) => /K1: the unit list adds up to 20 kitchens, the count says 24/.test(c)) && R.questions_for_gc.some((q) => /type K1/.test(q.question)), JSON.stringify(R.checks));
  ok('a list that adds up stays as it was', R.kitchen_types[1].confidence === 'high');
  ok('a count that is not a number is "not found", never 0', R.kitchen_types[2].count === null && R.checks.some((c) => /K3: no count found/.test(c)));
  ok('total kitchens = the counted types', R.total_kitchens === 40);
  ok('pages point at real pages only, once each, in order', JSON.stringify(k1.pages) === '[4,12]' && R.project.page === null && JSON.stringify(R.shared_pages) === '[2,20]');
  ok('items: quantities as numbers, units upper case, empty ones dropped', k1.items.length === 1 && k1.items[0].qty === 2 && k1.items[0].unit === 'EA');
  ok('a bad email is not kept (the draft asks him for one)', R.project.contact_email === '');
  const L = BP.normalizePackage({ not_in_our_scope: ['Plumbing and electrical hookups - by licensed plumbing/electrical contractor (p.1, p.7)'], questions_for_gc: [{ question: 'Is a Licensed electrician on site?' }] }, { pagesKept: 8 });
  ok('"LICENSED" NEVER REACHES THE PAGE OR A DRAFT ESTIMATE, whatever the AI writes', L.not_in_our_scope[0] === 'Plumbing and electrical hookups - by plumbing/electrical contractor (p.1, p.7)' && L.questions_for_gc[0].question === 'Is a electrician on site?', JSON.stringify(L.not_in_our_scope));
  ok('plain-string questions are kept', R.questions_for_gc[0].question === 'Who supplies the hardware?' && R.questions_for_gc[1].page === 5);
  ok('the files and page map ride along for the page', R.files[0].kept === 30 && R.page_map[0].page === 4 && R.pages_total === 900 && R.mode === 'package');
  ok('the AI\'s JSON is read even with fences or a sentence in front', BP.parseJson('Here it is:\n```json\n{"a":1}\n```').a === 1 && BP.parseJson('nope') === null);
}

console.log('\n4. one draft estimate per kitchen type\n');
{
  const R = BP.normalizePackage({
    project: { name: 'The Rivet', address: '12 Main St, Brooklyn', gc: 'Acme Builders', bid_due: 'March 3, 2 PM' },
    supply: 'install_only',
    kitchen_types: [{ name: 'K1', description: 'L-shaped with island', count: 24, count_source: 'Unit matrix p.4: floors 2-7, 4 per floor = 24', units: ['A1', 'A2'], items: [{ item: 'Base cabinet 36 in', qty: 2, unit: 'EA' }, { item: 'Wall cabinet 30 in', qty: 4, unit: 'EA' }] }],
    not_in_our_scope: ['Countertops - by others'],
    requirements: [{ category: 'retainage', text: 'Retainage 10% until completion' }],
  }, { pagesKept: 10 });
  const d = T.draftFor(R, R.kitchen_types[0]);
  ok('THE DRAFT SAYS HOW MANY KITCHENS AND TO PRICE ONE TIMES THE COUNT', /K1 \(L-shaped with island\): 24 kitchens - units A1, A2\./.test(d.description) && /the work of one kitchen times 24/.test(d.description), d.description);
  ok('...what is in one kitchen', /In ONE kitchen:\n- Base cabinet 36 in: 2 EA\n- Wall cabinet 30 in: 4 EA/.test(d.description));
  ok('...install only, when the package says so', /supplied by others - we install only/.test(d.description));
  ok('...the gas line even when the AI forgot it', /Not in our work: Countertops - by others; Gas appliances - set and connected by the gas trade\./.test(d.description));
  ok('...the money rules', /Bid rules: Retainage 10% until completion\./.test(d.description));
  ok('...no price anywhere, under the estimate\'s 2,000 characters', !/\$/.test(d.description) && d.description.length <= 2000);
  ok('...a clear title, as Carpentry', d.projectTitle === 'Kitchen type K1 - 24 kitchens - The Rivet' && d.service === 'Carpentry');
  const old = T.draftFor({ not_in_our_scope: ['Plumbing hookups - by licensed plumbing contractor'] }, { name: 'Type 01', count: null });
  ok('...and a package read before this fix still makes a draft without "licensed"', !/licensed/i.test(old.description) && /Plumbing hookups - by plumbing contractor/.test(old.description), old.description);
  const long = T.draftFor(R, Object.assign({}, R.kitchen_types[0], { items: Array.from({ length: 30 }, (_, i) => ({ item: 'Cabinet with a very long description number ' + i + ' '.repeat(3) + 'x'.repeat(60), qty: i, unit: 'EA' })) }));
  ok('a long kitchen still fits in 2,000 characters', long.description.length <= 2000);
}

console.log('\n5. the page\n');
{
  ok('ALL THE FILES AT ONCE', /<input type="file" id="file-input" accept="application\/pdf,\.pdf" multiple/.test(HTML));
  ok('the skim and the trim run on the device (pdf.js + pdf-lib from cdnjs, the triage script)', /cdnjs\.cloudflare\.com\/ajax\/libs\/pdf-lib\/1\.17\.1\/pdf-lib\.min\.js/.test(HTML) && /<script src="\/js\/bid-triage\.js"><\/script>/.test(HTML) && /BidTriage\.pickPages\(sk\.pages/.test(HTML));
  ok('every bid endpoint is called WITH the key', !/fetch\("\/\.netlify\/functions\/(upload-bid-file|analyze-bid-background|get-bid-analysis)/.test(HTML.replace(/sbcFetch\(/g, 'SBC(')) && (HTML.match(/sbcFetch\("\/\.netlify\/functions\/(upload-bid-file|analyze-bid-background|get-bid-analysis)/g) || []).length >= 4);
  ok('the drafts go through create-estimate, upload-estimate-file and update-customer, with the key', /sbcFetch\("\/\.netlify\/functions\/create-estimate"/.test(HTML) && /sbcFetch\("\/\.netlify\/functions\/upload-estimate-file"/.test(HTML) && /sbcFetch\("\/\.netlify\/functions\/update-customer"/.test(HTML));
  ok('the draft needs the GC name and email - it asks, never guesses', /Type the GC contact name and email first/.test(HTML));
  ok('a kitchen type with no count is not ticked for a draft (tick it by hand once the GC answers)', /\(ref\?' disabled':\(k\.count==null\?'':' checked'\)\)/.test(HTML));
  ok('a draft made once is not made twice', /madeDrafts\(window\.__jobId\)/.test(HTML) && /saveDraft\(jobId, k\.name, j1\.ref\)/.test(HTML));
  ok('the questions copy as an email', /Before we price the cabinet and millwork work on/.test(HTML));
  ok('the old "every trade" takeoff is still there', /value="all"/.test(HTML) && /function renderResults\(R, pdfUrl\)/.test(HTML));
  ok('no "licensed", no TV mounting', !/licensed/i.test(HTML) && !/tv mount/i.test(HTML));
}

(async () => {
  console.log('\n6. the background reader, run with the network stubbed\n');
  const calls = [];
  /* The streamed answer, as the API sends it: a thinking block, then the text in pieces. */
  const sse = (text, stop) => {
    const ev = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
    const body = ev({ type: 'message_start', message: { id: 'm' } }) + ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }) +
      ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } }) + ev({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }) +
      [text.slice(0, 7), text.slice(7, 40), text.slice(40)].map((t) => ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: t } })).join('') +
      ev({ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 1234 } }) + ev({ type: 'message_stop' });
    return { ok: true, status: 200, json: async () => { throw new Error('stream'); }, text: async () => body };
  };
  let answer = { project: { name: 'The Rivet' }, kitchen_types: [{ name: 'K1', count: 24, pages: [2] }], questions_for_gc: ['Who supplies hardware?'] };
  global.fetch = async (url, opts) => {
    const o = opts || {};
    calls.push({ url: String(url), method: o.method || 'GET', body: o.body ? JSON.parse(o.body) : null });
    const res = (status, obj) => ({ ok: status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) });
    if (/object\/sign\//.test(url)) return res(200, { signedURL: '/object/sign/bid-documents/bids/x.pdf?token=t' });
    if (/api\.anthropic\.com/.test(url)) return sse(JSON.stringify(answer), 'end_turn');
    return res(200, []);
  };
  process.env.SUPABASE_URL = 'https://sb.example.co'; process.env.SUPABASE_SECRET_KEY = 'sk'; process.env.ANTHROPIC_API_KEY = 'ak'; process.env.DASHBOARD_KEY = 'k1';
  const { handler } = require(path.join(ROOT, 'netlify/functions/analyze-bid-background.js'));
  const body = { jobId: 'bid-1', filePath: 'bids/x.pdf', fileName: 'bid-package-30-pages.pdf', notes: 'We install only.', mode: 'package', pagesKept: 30, pagesTotal: 900, files: [{ name: 'A.pdf', pages: 900, kept: 30 }], pageMap: [{ file: 'A.pdf', page: 4 }, { file: 'A.pdf', page: 51 }] };

  let r = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) });
  ok('NO KEY: REFUSED, AND NOTHING IS READ OR PAID FOR', r.statusCode === 401 && calls.length === 0, r.statusCode + ' ' + calls.length);

  r = await handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k1' }, body: JSON.stringify(body) });
  const ai = calls.find((c) => /anthropic/.test(c.url));
  const saved = calls.filter((c) => c.method === 'PATCH').pop();
  ok('with the key it runs', r.statusCode === 200, r.statusCode + ' ' + r.body);
  ok('THE KEPT PAGES GO TO THE AI AS ONE DOCUMENT, WITH THE PACKAGE PROMPT AND PAGE MAP', ai && ai.body.messages[0].content[0].type === 'document' && /bids\/x\.pdf\?token=t/.test(ai.body.messages[0].content[0].source.url) && /p\.2 = A\.pdf p\.51/.test(ai.body.messages[0].content[1].text) && /30 of 900 pages/.test(ai.body.messages[0].content[1].text));
  ok('it thinks before it counts, with room for a long answer', ai && ai.body.thinking && ai.body.thinking.type === 'adaptive' && ai.body.max_tokens >= 20000 && !('temperature' in ai.body));
  ok('"THE AI ANSWER WAS CUT OFF" AFTER 5 MINUTES: now streamed, 48,000 of room, medium effort', ai && ai.body.stream === true && ai.body.max_tokens >= 48000 && ai.body.output_config && ai.body.output_config.effort === 'medium');
  ok('...and the answer is told to stay short (one line per cabinet size)', /at most 25 item lines per kitchen type \(one line per cabinet size/.test(BP.packagePrompt({})));
  ok('the price book is not loaded - nothing is priced here', !calls.some((c) => /price_book|bid_settings/.test(c.url)));
  ok('THE CLEANED RESULT IS SAVED ON THE JOB', saved && saved.body.status === 'done' && saved.body.result.mode === 'package' && saved.body.result.total_kitchens === 24 && saved.body.result.page_map[1].page === 51 && saved.body.result.file_name === 'bid-package-30-pages.pdf', JSON.stringify(saved && saved.body).slice(0, 200));

  calls.length = 0;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), method: (opts || {}).method || 'GET', body: opts && opts.body ? JSON.parse(opts.body) : null });
    const res = (status, obj) => ({ ok: true, status, json: async () => obj, text: async () => JSON.stringify(obj) });
    if (/object\/sign\//.test(url)) return res(200, { signedURL: '/x' });
    if (/anthropic/.test(url)) return sse('{"project":', 'max_tokens');
    return res(200, []);
  };
  r = await handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k1' }, body: JSON.stringify(body) });
  const err = calls.filter((c) => c.method === 'PATCH').pop();
  ok('a cut-off answer is an error he can read, with what to do, saved on the job', r.statusCode === 500 && err && err.body.status === 'error' && /cut off/.test(err.body.error) && /Upload fewer files at a time/.test(err.body.error));

  calls.length = 0;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), method: (opts || {}).method || 'GET', body: opts && opts.body ? JSON.parse(opts.body) : null });
    const res = (status, obj) => ({ ok: true, status, json: async () => obj, text: async () => JSON.stringify(obj) });
    if (/object\/sign\//.test(url)) return res(200, { signedURL: '/x' });
    if (/anthropic/.test(url)) { const s = sse('{"project":{"name":"X"}}', 'end_turn'); const body = (await s.text()).split('event: message_delta')[0]; return { ok: true, status: 200, text: async () => body }; }
    return res(200, []);
  };
  r = await handler({ httpMethod: 'POST', headers: { 'x-sbc-key': 'k1' }, body: JSON.stringify(body) });
  const cut = calls.filter((c) => c.method === 'PATCH').pop();
  ok('a stream that breaks off before the end is an error too, never a half answer', r.statusCode === 500 && cut && /stopped early/.test(cut.body.error));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
