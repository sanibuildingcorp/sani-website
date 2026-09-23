/* shared-work-once.test.js — run: node js/shared-work-once.test.js
 *
 *   "Fix why the scope writer falls back"
 *   "Repeated bullets how can we fix it? This is one project with multiple
 *    services renovation and protection, supervision or other general
 *    preparation going for one time for all services and not for separate
 *    for each services"
 *
 * 1. The estimator prices shared work (protection, cleanup, debris,
 *    coordination) ONCE, section "Whole Project"; the splitter divides it
 *    across the services so every card price still includes its part.
 * 2. The phrase library says shared work once, in projectIncluded, not on
 *    every card; the scope writer does the same, and a line repeated on two
 *    cards is moved there.
 * 3. The writer's own words are kept when it names a card differently
 *    ("Window Replacement" for "Windows"), when it writes fewer than three
 *    lines, and after one failed try. Why stock phrases were kept is written
 *    on the estimate and shown on the panel.
 * 4. The customer page, the PDF, the box, the dashboard and Ask AI all show
 *    the one list.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const DP = require(path.join(ROOT, 'netlify/functions/lib/deterministic-pricing.js'));
const SW = require(path.join(ROOT, 'netlify/functions/lib/scope-writer.js'));
const ST = require(path.join(ROOT, 'netlify/functions/lib/scope-text.js'));
const R = require(path.join(ROOT, 'netlify/functions/lib/reword.js'));
const GEN = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'), 'utf8');
const QUOTE = fs.readFileSync(path.join(ROOT, 'quote.html'), 'utf8');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const ASSIST = fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant.js'), 'utf8');
const PDF = fs.readFileSync(path.join(ROOT, 'netlify/functions/lib/scope-pdf.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

const SERVICES = ['Bathroom', 'Flooring', 'Painting', 'Windows'];
function job() {
  return {
    markupPct: 25, showLaborCost: false, showMaterialsCost: false,
    labor: [
      { section: 'Bathroom', item: 'Bathroom demolition', qty: 20, rate: 70 }, { section: 'Bathroom', item: 'Tile installation', qty: 40, rate: 90 },
      { section: 'Flooring', item: 'Install engineered hardwood flooring', qty: 30, rate: 85 }, { section: 'Painting', item: 'Paint walls and ceilings, two coats', qty: 40, rate: 65 },
      { section: 'Windows', item: 'Install replacement windows', qty: 12, rate: 90 },
      { section: 'Bathroom', item: 'Site protection and floor covering', qty: 4, rate: 60 }, { section: 'Flooring', item: 'Site protection and floor covering', qty: 4, rate: 60 },
      { section: 'Painting', item: 'Daily cleanup and final clean', qty: 4, rate: 55 }, { section: 'Windows', item: 'Project coordination and supervision', qty: 6, rate: 95 },
      { section: 'Bathroom', item: 'Debris hauling and disposal', qty: 6, rate: 60 },
    ], materials: [], customerSupplied: [], exclusions: [], options: [],
  };
}
const ANALYSIS = { selected_trades: SERVICES, confirmed_scope: [] };
const INPUT = { request: { service: 'Bathroom', selectedServices: SERVICES, description: 'Apartment renovation: bathroom, hardwood floors, paint the apartment, replace windows' } };
const consolidated = () => DP.consolidateCustomerPresentation(job(), ANALYSIS, INPUT);

console.log('\n1. The estimator prices shared work once\n');
{
  ok('RULE 4a: protection, cleanup, debris and coordination are priced ONCE for the whole project, section "Whole Project", never repeated per service', /4a\. ONE PROJECT, SHARED WORK ONCE\. Work that serves the whole job - site protection and setup, daily and final cleanup, debris removal and disposal, project coordination and supervision - is done ONCE for the whole project, not once per service\. Price each such task ONCE, sized for the whole project, with \\"section\\": \\"Whole Project\\"\./.test(GEN.replace(/\\\\/g, '\\')) || /4a\. ONE PROJECT, SHARED WORK ONCE\./.test(GEN));
  ok('...the old "one cleanup line per service / one coordination line per service" rules are gone', !/emit three cleanup lines, one per service/.test(GEN) && !/Emit ONE coordination line PER SERVICE/.test(GEN));
  ok('the repair pass says the same', /Protection, cleanup, debris and coordination are priced ONCE for the whole project with \\"section\\": \\"Whole Project\\", never repeated per service\./.test(GEN) || /priced ONCE for the whole project with "section": "Whole Project"/.test(GEN));
}

console.log('\n2. The phrase library says shared work once\n');
{
  const out = consolidated();
  const all = out.serviceBreakdown.reduce((a, s) => a.concat(s.included), []);
  ok('PROTECTION, DEBRIS, CLEANUP, COORDINATION: said once, in projectIncluded', out.projectIncluded.length === 4 && /^Protect your floors/.test(out.projectIncluded[0]) && /Coordinate and supervise/.test(out.projectIncluded[3]), JSON.stringify(out.projectIncluded));
  ok('...and on NO card', !all.some((t) => /Protect your floors|Bag, carry out|Clean the space daily|Coordinate and supervise/.test(t)), JSON.stringify(all));
  ok('each card keeps its own work', out.serviceBreakdown.every((s) => s.included.length >= 1) && out.serviceBreakdown.find((s) => s.title === 'Windows').included[0].indexOf('windows') !== -1);
  const one = DP.consolidateCustomerPresentation({ markupPct: 25, labor: [{ section: 'Painting', item: 'Paint walls, two coats', qty: 20, rate: 65 }, { section: 'Painting', item: 'Site protection', qty: 2, rate: 60 }], materials: [], customerSupplied: [], exclusions: [], options: [] }, { selected_trades: ['Painting'], confirmed_scope: [] }, { request: { service: 'Painting', selectedServices: ['Painting'], description: 'paint two rooms' } });
  ok('ONE SERVICE: nothing is shared - protection stays on its card, no project list', one.projectIncluded.length === 0 && one.serviceBreakdown[0].included.some((t) => /Protect your floors/.test(t)));
}

console.log('\n3. The scope writer: its own words kept, shared work once, a reason when it falls back\n');
(async () => {
  const w = (o) => async () => JSON.stringify(o);
  {
    const est = consolidated();
    await SW.writeCustomerScope(est, ANALYSIS, INPUT, w({
      services: [
        { service: 'Bathroom Renovation', included: ['We gut the bathroom to the studs.', 'We waterproof the shower and set your tile.'] },
        { service: 'Hardwood Flooring', included: ['We lay about 800 sq ft of your engineered hardwood.'] },
        { service: 'Interior Painting', included: ['We paint every wall and ceiling, two coats.', 'We protect your floors and furniture before we start.'] },
        { service: 'Window Replacement', included: ['We take out six old windows and set the new ones.', 'We protect your floors and furniture before we start.'] },
      ],
      project: ['We cover the floors and hallway before any work starts.', 'We clean up every day and leave it broom clean.', 'One foreman runs the whole job and schedules every trade.'],
    }), JSON.parse);
    const by = {}; est.serviceBreakdown.forEach((s) => { by[s.title] = s.included; });
    ok('NAMES THAT DO NOT MATCH EXACTLY ("Window Replacement" for "Windows") still land on the right card', by.Windows[0] === 'We take out six old windows and set the new ones.' && by.Bathroom[0] === 'We gut the bathroom to the studs.' && by.Flooring[0] === 'We lay about 800 sq ft of your engineered hardwood.', JSON.stringify(by));
    ok('ONE OR TWO REAL LINES are kept - not swapped for stock phrases', by.Flooring.length === 1 && est.scopeWriter.servicesFallback === 0 && !est.scopeWriter.note, JSON.stringify(est.scopeWriter));
    ok('THE WRITER\'S "project" LIST replaces the stock one', est.projectIncluded[0] === 'We cover the floors and hallway before any work starts.' && est.projectIncluded.length >= 3, JSON.stringify(est.projectIncluded));
    ok('A LINE WRITTEN ON TWO CARDS is shared work: off both cards, said once', !by.Painting.some((t) => /protect your floors/i.test(t)) && !by.Windows.some((t) => /protect your floors/i.test(t)) && est.projectIncluded.filter((t) => /protect your floors and furniture/i.test(t)).length <= 1, JSON.stringify({ p: by.Painting, w: by.Windows, proj: est.projectIncluded }));
    ok('THE BOX (scope of work) starts with WHOLE PROJECT, then the services', /^WHOLE PROJECT:\n• We cover the floors/.test(est.scopeOfWork) && /\n\nBATHROOM:\n/.test(est.scopeOfWork), est.scopeOfWork.slice(0, 120));
  }
  {
    const est = consolidated();
    let calls = 0;
    await SW.writeCustomerScope(est, ANALYSIS, INPUT, async () => { calls++; if (calls === 1) return 'not json {'; return JSON.stringify({ services: SERVICES.map((s) => ({ service: s, included: ['We do the ' + s.toLowerCase() + ' work.'] })) }); }, JSON.parse);
    ok('AN UNREADABLE ANSWER IS TRIED ONCE MORE, and the second answer is used', calls === 2 && est.serviceBreakdown[0].included[0] === 'We do the ' + est.serviceBreakdown[0].title.toLowerCase() + ' work.' && !est.scopeWriter.note);
  }
  {
    const est = consolidated();
    await SW.writeCustomerScope(est, ANALYSIS, INPUT, w({ services: [{ service: 'Bathroom', included: ['We gut the bathroom.'] }] }), JSON.parse);
    ok('A CARD THE WRITER SKIPPED keeps its stock phrases, and the estimate says which and why', est.scopeWriter.servicesFallback === 3 && /stock phrases kept for .*Flooring: service not found in the answer/.test(est.scopeWriter.note), est.scopeWriter.note);
  }
  {
    const est = consolidated();
    await SW.writeCustomerScope(est, ANALYSIS, INPUT, async () => { throw new Error('socket hang up'); }, JSON.parse);
    ok('two failures: the phrase library stands (shared work still once), with the reason', /socket hang up/.test(est.scopeWriter.note) && est.projectIncluded.length === 4 && !est.serviceBreakdown.some((s) => s.included.some((t) => /Protect your floors/.test(t))));
  }
  ok('THE CLOCK: live material prices are skipped when they would leave the writer under its two minutes, and an out-of-time skip is written on the estimate', /const MATERIAL_MIN_MS = SCOPE_MIN_MS \+ 90 \* 1000;/.test(GEN) && /if \(process\.env\.SERPER_API_KEY && timeLeft\(\) < MATERIAL_MIN_MS\) \{/.test(GEN) && /estimate\.scopeWriter = \{ version: "scope-writer-v1", servicesWritten: 0, servicesFallback: \(estimate\.serviceBreakdown \|\| \[\]\)\.length, note: timing\.scopeSkipped/.test(GEN));

  console.log('\n4. Everyone shows the one list\n');
  ok('THE CUSTOMER PAGE: "Included for the whole project" above the services', /function projectCard\(e\)\{/.test(QUOTE) && /Included for the whole project/.test(QUOTE) && /\$\{projectCard\(e\)\}\$\{sv\.map\(\(s,i\)=>/.test(QUOTE));
  ok('THE SCOPE PDF: a "Whole project" card first', /cards\.unshift\(\{ title: "Whole project", included: shared/.test(PDF));
  ok('THE DASHBOARD: the list above the service cards; a warning line when stock phrases were kept', /Included for the whole project<\/div>/.test(DASH) && /Said once for all services\. To change a line, ask Ask AI\./.test(DASH) && /Customer wording: ' \+ esc\(String\(swn\)/.test(DASH));
  ok('ASK AI reads it and can reword it (where "project")', /INCLUDED FOR THE WHOLE PROJECT \(said once, above the services/.test(ASSIST) && /project \(a line of INCLUDED FOR THE WHOLE PROJECT/.test(ASSIST));
  const rec = { estimate: consolidated() }; rec.estimate.scopeOfWork = ST.scopeTextFromCards(rec.estimate);
  const out = R.applyEdits(rec, [{ where: 'project', from: 'Coordinate and supervise every trade, inspection and delivery', to: 'One foreman runs the job and schedules every trade' }]);
  ok('...a reword of a whole-project line lands, and the box follows', out.applied.length === 1 && rec.estimate.projectIncluded[3] === 'One foreman runs the job and schedules every trade' && /One foreman runs the job/.test(rec.estimate.scopeOfWork));
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
