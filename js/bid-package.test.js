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

console.log('\n4. ONE draft estimate for the whole bid, a card per kitchen type\n');
{
  /* "it was maked several estimate draft in dashboard, it split for couple
      different projects" - eight drafts for one building. */
  const R = BP.normalizePackage({
    project: { name: '750 3rd Avenue', address: '750 3rd Avenue, New York, NY 10017', gc: 'Acme Builders', bid_due: 'March 3, 2 PM' },
    supply: 'install_only',
    kitchen_types: [
      { name: 'Type 01 (Kitchen/Kitchenette)', description: 'Galley kitchen', count: 24, count_source: 'Unit matrix p.4', units: ['A1', 'A2'], pages: [4, 5], items: [{ item: 'Base cabinet 36 in', qty: 2, unit: 'EA', page: 5 }, { item: 'Crown molding', qty: 12, unit: 'LF' }] },
      { name: 'Type 02 (Kitchenette)', count: null, pages: [6] },
      { name: 'Type 03', count: 8, items: [{ item: 'Wall cabinet 30 in', qty: 3, unit: 'EA' }] },
      { name: 'K 1', count: 1 }, { name: 'K 1', count: 2 },
    ],
    not_in_our_scope: ['Countertops - by others', 'Plumbing hookups - by licensed plumbing contractor'],
    requirements: [{ category: 'retainage', text: 'Retainage 10% until completion' }],
    questions_for_gc: [{ question: 'Can you send the unit matrix?' }],
  }, { pagesKept: 10 });
  const d = T.draftForBid(R, R.kitchen_types);
  ok('ONE ESTIMATE: EVERY KITCHEN TYPE IS A SERVICE OF IT - its own card and price', d.sections.length === 5 && d.service === d.sections.join(', ') && /ONE estimate for the whole bid/.test(d.description), d.service);
  ok('...service names never contain the , / & the estimate splits services on ("Kitchen/Kitchenette" stayed one card)', d.sections.every((n) => !/[,/&]/.test(n)) && d.service.split(/[,/&]+/).length === 5 && d.sections[0] === 'Kitchen Type 01 (Kitchen or Kitchenette)', JSON.stringify(d.sections));
  ok('..."Kitchen Type 03", never "Kitchen type Type 03"; the same name twice gets a number', d.sections[2] === 'Kitchen Type 03' && d.sections[3] === 'Kitchen Type K 1' && d.sections[4] === 'Kitchen Type K 1 2' && !/Type Type/i.test(d.description + d.projectTitle));
  ok('...each type: its count and one kitchen\'s contents; price all of them, or ONE when not counted', /- Kitchen Type 01 \(Kitchen or Kitchenette\) \(Galley kitchen\): 24 kitchens, units A1 A2\. One kitchen: Base cabinet 36 in x2; Crown molding x12 LF\./.test(d.description) && /Kitchen Type 02 \(Kitchenette\): count not confirmed\./.test(d.description) && /price ONE kitchen of that type/.test(d.description), d.description);
  ok('...install only, the gas line, the money rules, no "licensed", no price', /supplied by others - we install only/.test(d.description) && /Gas appliances - set and connected by the gas trade/.test(d.description) && /Retainage 10%/.test(d.description) && !/licensed/i.test(d.description) && !/\$/.test(d.description));
  ok('...one title for the bid', d.projectTitle === 'Bid: 750 3rd Avenue - kitchen cabinets, 5 kitchen types', d.projectTitle);
  const all = T.draftForBid(R, R.kitchen_types.filter((k) => k.count != null));
  ok('...with every type counted, the total kitchens are in the title', /4 kitchen types, 35 kitchens$/.test(all.projectTitle), all.projectTitle);
  const many = T.draftForBid(R, Array.from({ length: 30 }, (_, i) => ({ name: 'Type ' + i, count: 10, units: ['A', 'B'], items: Array.from({ length: 25 }, (_, j) => ({ item: 'Cabinet with a long description ' + j, qty: j, unit: 'EA' })) })));
  ok('A BIG BID STILL FITS the 3,000 characters the estimate keeps - and still names every type', many.description.length <= 2990 && Array.from({ length: 30 }, (_, i) => 'Kitchen Type ' + i + ':').every((n) => many.description.indexOf(n) !== -1) && /attached as one PDF\.$/.test(many.description), String(many.description.length));
  const lines = T.takeoffLines(R, R.kitchen_types);
  ok('THE FULL TAKEOFF GOES WITH IT AS A PDF: every type, every item with its page, the questions', lines[0] === '# BID TAKEOFF - 750 3rd Avenue' && lines.indexOf('# Kitchen Type 01 (Kitchen or Kitchenette) - 24 kitchens') !== -1 && lines.indexOf('- Base cabinet 36 in: 2 EA (p.5)') !== -1 && lines.indexOf('# Questions for the GC') !== -1 && lines.indexOf('1. Can you send the unit matrix?') !== -1 && !lines.some((l) => /licensed/i.test(l)), JSON.stringify(lines.slice(0, 12)));
  ok('the estimate keeps 3,000 characters of a new description (it kept 2,000)', /String\(body\.description \|\| "Created manually from dashboard"\)\.slice\(0, 3000\)/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/create-estimate.js'), 'utf8')));
}

console.log('\n4b. the GC\'s own words: the total and the work in every kitchen\n');
{
  /* "Regardless of what the GC or developer is planning, let's just say that we
      are providing a quote just for the installation of cabinetry (650+
      kitchens) ... Set and level appliances with custom panels (fridge and
      dishwasher). Install LED lights (light bar and run wires) ... we will
      expect them to distribute the kitchens into the building and possibly
      take care of trash removal." - the GC's email, pasted into the notes. */
  const pr = BP.packagePrompt({ notes: 'quote ... (650+ kitchens)' });
  ok('THE NOTES ARE READ AS THE GC\'S OWN EMAIL: the total, the work for us, what goes to others', /often the general contractor's own email, pasted in/.test(pr) && /the total number of kitchens, the work they ask us to do, and what they give to others/.test(pr));
  ok('...a stated total is kept, never split across the types by the AI', /put it in stated_total with where it came from - never split a total across the types yourself/.test(pr) && /"stated_total": \{ "count": 650, "plus": true/.test(pr));
  ok('...the work in every kitchen (panels, LED light bar and wires), never gas', /per_kitchen_work: the work done in EVERY kitchen besides hanging the cabinet boxes/.test(pr) && /gas appliances never/.test(pr));
  ok('..."possibly" by others is marked "(to confirm)" and asked', /goes in not_in_our_scope marked "\(to confirm\)", with a question/.test(pr));

  const R = BP.normalizePackage({
    project: { name: '750 3rd Avenue' }, supply: 'install_only',
    our_scope_summary: 'Install the cabinets, set the fridge and dishwasher with panels and install the LED light bars.',
    stated_total: { count: '650+', plus: true, source: "GC's message: '650+ kitchens'" },
    per_kitchen_work: ['Set and level the refrigerator and dishwasher with their custom panels', 'Install the LED light bar and run its wires', 'Set the gas range'],
    kitchen_types: [{ name: 'Type 01', count: null }, { name: 'Type 02', count: null }],
    not_in_our_scope: ['Distribution of the kitchens into the building - by others', 'Trash removal - by others (to confirm)', 'Countertops - by others'],
  }, { pagesKept: 8 });
  ok('THE TOTAL IS KEPT: 650+, from the GC\'s message', R.stated_total && R.stated_total.count === 650 && R.stated_total.plus === true && /650\+ kitchens/.test(R.stated_total.source), JSON.stringify(R.stated_total));
  ok('...the work in every kitchen is kept; a gas line never is', R.per_kitchen_work.length === 2 && !R.per_kitchen_work.some((x) => /gas/i.test(x)));
  const d = T.draftForBid(R, R.kitchen_types);
  ok('THE DRAFT: title "650+ kitchens (mix not confirmed)", each type priced per kitchen', /Bid: 750 3rd Avenue - kitchen cabinets, 2 kitchen types, 650\+ kitchens \(mix not confirmed\)/.test(d.projectTitle) && /The general contractor's total: 650\+ kitchens .*each type is priced per kitchen/.test(d.description), d.projectTitle + '\n' + d.description);
  ok('...with our work and the work in every kitchen for the estimator to price', /Our work: Install the cabinets, set the fridge and dishwasher with panels and install the LED light bars\./.test(d.description) && /In every kitchen also: Set and level the refrigerator and dishwasher with their custom panels; Install the LED light bar and run its wires\./.test(d.description));
  ok('...and what is by others, "to confirm" kept', /Trash removal - by others \(to confirm\)/.test(d.description) && /Distribution of the kitchens into the building - by others/.test(d.description));
  const lines = T.takeoffLines(R, R.kitchen_types);
  ok('...the takeoff PDF says it too', lines.indexOf("Total kitchens stated: 650+ kitchens - GC's message: '650+ kitchens'") !== -1 && lines.indexOf('# Work in every kitchen') !== -1 && lines.indexOf('- Install the LED light bar and run its wires') !== -1);

  const C = BP.normalizePackage({ stated_total: { count: 650, plus: true }, kitchen_types: [{ name: 'A', count: 300 }, { name: 'B', count: 200 }] }, { pagesKept: 8 });
  ok('ONCE EVERY TYPE IS COUNTED, a sum under the stated total becomes a check and a question', C.checks.some((c) => /add up to 500 kitchens; the stated total is 650\+/.test(c)) && C.questions_for_gc.some((q) => /add up to 500 kitchens, but the total given is 650\+/.test(q.question)));
  const OK = BP.normalizePackage({ stated_total: { count: 650, plus: true }, kitchen_types: [{ name: 'A', count: 400 }, { name: 'B', count: 260 }] }, { pagesKept: 8 });
  ok('...660 against "650+" is fine', !OK.checks.length && T.draftForBid(OK, OK.kitchen_types).projectTitle === 'Bid: Bid package - kitchen cabinets, 2 kitchen types, 660 kitchens');
  ok('the page shows 650+ as the total while the mix is not confirmed, and lists the work in every kitchen', /"Kitchens - their total"/.test(HTML) && /<b>In every kitchen:<\/b>/.test(HTML));
}

console.log('\n5. the page\n');
{
  ok('ALL THE FILES AT ONCE', /<input type="file" id="file-input" accept="application\/pdf,\.pdf" multiple/.test(HTML));
  ok('the skim and the trim run on the device (pdf.js + pdf-lib from cdnjs, the triage script)', /cdnjs\.cloudflare\.com\/ajax\/libs\/pdf-lib\/1\.17\.1\/pdf-lib\.min\.js/.test(HTML) && /<script src="\/js\/bid-triage\.js"><\/script>/.test(HTML) && /BidTriage\.pickPages\(sk\.pages/.test(HTML));
  ok('every bid endpoint is called WITH the key', !/fetch\("\/\.netlify\/functions\/(upload-bid-file|analyze-bid-background|get-bid-analysis)/.test(HTML.replace(/sbcFetch\(/g, 'SBC(')) && (HTML.match(/sbcFetch\("\/\.netlify\/functions\/(upload-bid-file|analyze-bid-background|get-bid-analysis)/g) || []).length >= 4);
  ok('the drafts go through create-estimate, upload-estimate-file and update-customer, with the key', /sbcFetch\("\/\.netlify\/functions\/create-estimate"/.test(HTML) && /sbcFetch\("\/\.netlify\/functions\/upload-estimate-file"/.test(HTML) && /sbcFetch\("\/\.netlify\/functions\/update-customer"/.test(HTML));
  ok('the draft needs the GC name and email - it asks, never guesses', /Type the GC contact name and email first/.test(HTML));
  ok('ONE BUTTON MAKES ONE ESTIMATE: create-estimate is called once, with every chosen type', (HTML.match(/sbcFetch\("\/\.netlify\/functions\/create-estimate"/g) || []).length === 1 && /const d = BidTriage\.draftForBid\(R, chosen\);/.test(HTML) && !/for\(const k of chosen\)/.test(HTML));
  ok('...the takeoff PDF first, then the bid pages of those types, one file', /await takeoffPages\(out, BidTriage\.takeoffLines\(R, chosen\)\);/.test(HTML) && /out\.copyPages\(src, idx\)/.test(HTML));
  ok('...every type ticked; an uncounted one is priced as one kitchen', /class="d-kt" value="'\+i\+'" checked>/.test(HTML) && /count not confirmed \(priced as one kitchen\)/.test(HTML));
  ok('...made once, it asks before making another', /saveDraft\(jobId, "__bid", j1\.ref\)/.test(HTML) && /A draft estimate for this bid was already made\. Make another one\?/.test(HTML));
  {
    /* "Analysis failed: Load failed" - while the reading itself finished on the server. */
    const vm = require('vm');
    const cutFn = (name) => { const i = HTML.indexOf('function ' + name + '('); let d = 0; for (let j = HTML.indexOf('{', i); j < HTML.length; j++) { if (HTML[j] === '{') d++; else if (HTML[j] === '}') { d--; if (!d) return HTML.slice(i, j + 1); } } };
    const els = {}; const el = (id) => (els[id] = els[id] || { style: {}, innerHTML: '', disabled: false });
    const ctx = { window: {}, document: { getElementById: el }, pickedFiles: [], showRecent() {}, esc: (x) => String(x) };
    vm.createContext(ctx); vm.runInContext(cutFn('isDropped') + cutFn('showError'), ctx);
    ctx.window.__startedJob = 'bid-1'; ctx.showError('Load failed');
    ok('A DROPPED CONNECTION AFTER THE FILES WENT: "the reading goes on without it" - not "Analysis failed"', /<b>Connection lost:<\/b> Your phone lost the connection, but the reading goes on without it\. In a minute, tap it at the top of Earlier packages\./.test(els.results.innerHTML), els.results.innerHTML);
    ctx.window.__startedJob = null; ctx.showError('TypeError: Failed to fetch');
    ok('...before the files went: press Read again', /before the files were sent\. Press Read the package again\./.test(els.results.innerHTML));
    ctx.showError('The AI answer was cut off');
    ok('...a real failure still says "Analysis failed"', /<b>Analysis failed:<\/b> The AI answer was cut off/.test(els.results.innerHTML));
  }
  ok('opening an earlier package tries three times before giving up', /for\(let i = 0; i < 3; i\+\+\)/.test(HTML) && /const d = await getJob\(id\);/.test(HTML));
  ok('earlier packages show the date AND the time, so the same files read twice can be told apart', /toLocaleString\(\[\], \{ month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" \}\)/.test(HTML));
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
