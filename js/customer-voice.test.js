/* customer-voice.test.js — run: node js/customer-voice.test.js
 *
 *   "do not use like ( ooo this need protection, ohh this need building
 *    approves, ohh it's need time, and always feels hard and scary, don't
 *    write long explanations as it is in the timeline! ). I need softness
 *    headers and softness timelines, none of the building management
 *    approvals required 2-3 weeks! It maximum 1 week."
 *
 * One rule block, VOICE, in every prompt that writes for the customer (the
 * estimator's summary and timeline, the scope writer's lines and timeline,
 * the contract's timeline), and a deterministic backstop on what comes
 * back: an approval that "takes 1-2 weeks" becomes "under a week", a
 * timeline longer than two sentences is cut to two.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const V = require(path.join(ROOT, 'netlify/functions/lib/customer-voice.js'));
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

console.log('\n1. softenTimeline: approvals take under a week, two sentences at most\n');
{
  const frank = 'Co-op approval track requires 1-2 weeks from signed contract for preparation and submission of alteration package, insurance certificates and board review. Construction runs about 3 weeks once approved. Material lead times for glass add 5-10 days after tile. Weather and elevator availability may affect the schedule.';
  const out = V.softenTimeline(frank);
  ok('"Co-op approval track requires 1-2 weeks" -> "under a week"; the construction weeks stay; the timeline is cut to two sentences', out === 'Co-op approval track requires under a week from signed contract for preparation and submission of alteration package, insurance certificates and board review. Construction runs about 3 weeks once approved.', out);
  ok('"2-3 weeks" for board approval, "two to three weeks", "10 business days" and "14 days" all become under a week', V.softenText('Board approval takes 2-3 weeks.') === 'Board approval takes under a week.' && V.softenText('Allow two to three weeks for building management approval.') === 'Allow under a week for building management approval.' && V.softenText('Permit review by the building is 10 business days.') === 'Permit review by the building is under a week.' && V.softenText('The alteration agreement needs 14 days.') === 'The alteration agreement needs under a week.');
  ok('a wait of a week or less is left alone; a duration in a sentence with no approval word is left alone', V.softenText('Board approval takes about 5 days.') === 'Board approval takes about 5 days.' && V.softenText('Building approval usually takes under a week.') === 'Building approval usually takes under a week.' && V.softenText('Tile work takes 2-3 weeks.') === 'Tile work takes 2-3 weeks.' && V.softenText('Glass is measured after tile and takes 10 days to arrive.') === 'Glass is measured after tile and takes 10 days to arrive.');
  ok('a short timeline passes through untouched; empty stays empty', V.softenTimeline('About three weeks of work once we start.') === 'About three weeks of work once we start.' && V.softenTimeline('') === '' && V.softenTimeline(null) === '');
  ok('softenLines does each line; non-strings pass through', JSON.stringify(V.softenLines(['Board approval: 2-3 weeks.', 42])) === '["Board approval: under a week.",42]');
}

console.log('\n2. The rule block, in every customer-facing prompt\n');
{
  ok('VOICE says short and calm, plain headers, two-sentence summary, one or two-sentence timeline, approvals under a week, no difficulty words, no long explanations', /Short, calm, plain\. One idea per sentence, under 18 words/.test(V.VOICE) && /Headers are two or three plain words/.test(V.VOICE) && /The summary is two short sentences\. The timeline is one or two/.test(V.VOICE) && /NEVER takes 1-2 weeks, 2-3 weeks or longer[^\n]*it takes under a week/.test(V.VOICE) && /never 'strict', 'must', 'required by the building', 'risk', 'hazard', 'complex', 'challenging', 'compliance', 'coordination', 'per the alteration agreement'/.test(V.VOICE) && /No long explanations/.test(V.VOICE));
  ok('VOICE: HUMAN WORDS A HOMEOWNER USES - the jargon swaps named, trade words explained, no abbreviations, dates in words ("i need more human language and easy for understanding for me and for customers")', /Human words a homeowner uses, like a person talking, warm and polite/.test(V.VOICE) && /'measure', not 'field-measure'; 'final price', not 'firm proposal'/.test(V.VOICE) && /not 'site-built pan' \/ 'manufactured base'/.test(V.VOICE) && /If a trade word is needed, say what it is in a few words/.test(V.VOICE) && /No abbreviations \(sf, LF, GC, TBD, w\/, approx\.\): write them out/.test(V.VOICE) && /Product names stay exact \(brand, model, size\)/.test(V.VOICE) && /Dates in words: 'October 14', never '2026-10-14'/.test(V.VOICE));
  ok('VOICE: WE AND YOU, SAY IT ONCE, a short Not included line with the real bad example, read it back ("teach him your language please")', /WHO IS TALKING: always 'we' \(Sani Building Corp\) and 'you' \(the customer\)/.test(V.VOICE) && /SAY IT ONCE: one line is one fact/.test(V.VOICE) && /Good: 'Countertops - installed by others\.'/.test(V.VOICE) && /Bad: 'Countertops are not installed by us\. Your kitchen installers are never asked to install countertops\.'/.test(V.VOICE) && /No 'never' or 'always' about the customer/.test(V.VOICE) && /If a homeowner would need to read it twice, rewrite it/.test(V.VOICE));
  const gen = src('netlify/functions/generate-estimate-background.js');
  ok('THE ESTIMATOR carries VOICE before its output shape, asks for a two-sentence summary and a one-or-two-sentence timeline, and softens both on the way in', /\$\{voice\.VOICE\}\\n\\nOUTPUT JSON ONLY:/.test(gen) && /"summary": "two short, calm sentences the customer reads"/.test(gen) && /"timelineText": "one or two short sentences: how long the work takes once it starts; building approval, if any, usually under a week"/.test(gen) && /summary: voice\.softenText\(cleanText\(raw\.summary\)\)/.test(gen) && /timelineText: voice\.softenTimeline\(cleanText\(raw\.timelineText\)\)/.test(gen));
  const sw = src('netlify/functions/lib/scope-writer.js');
  ok('THE SCOPE WRITER carries VOICE in its hard rules, softens every bullet and the timeline', /HARD RULES\n\$\{voice\.VOICE\}/.test(sw) && /let s = voice\.softenText\(stripBanned\(t\)\);/.test(sw) && /const tl = voice\.softenTimeline\(stripBanned\(written && written\.timeline\)\);/.test(sw));
  const ct = src('netlify/functions/generate-contract-background.js');
  ok('THE CONTRACT carries VOICE, is handed a softened estimate timeline, asks for a short calm one, and softens what comes back', /\$\{voice\.VOICE\}\n\nOUTPUT: Return ONLY a JSON object/.test(ct) && /- Timeline: \$\{voice\.softenTimeline\(est\.timelineText\) \|\| "To be scheduled"\}/.test(ct) && /"timeline": "One or two short, calm sentences: how long the work takes once it starts; building approval, if any, under a week"/.test(ct) && /timeline: voice\.softenTimeline\(parsed\.timeline \|\| est\.timelineText\) \|\| "To be scheduled"/.test(ct));
  ok('no price is touched anywhere in the voice library', !/rate|qty|subtotal|total/.test(src('netlify/functions/lib/customer-voice.js').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
}
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
