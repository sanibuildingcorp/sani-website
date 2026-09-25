/* estimator-reads-drawings.test.js — run: node js/estimator-reads-drawings.test.js
 *
 * The review of SBC-260925-Y373 (13 bathrooms, $107,869.05):
 *   "Page 6 says labor is $112,700 and the selling price is approximately
 *    $164,200. It also says 'no drawings' and quantities came from a typical
 *    5 x 8 bathroom. Those notes do not match this estimate or the plans."
 * Both were true. The PDF plans never reached the AI (only photos did), and
 * the notes were written before the lines were re-priced. "Do all":
 *   1. every PDF plan goes to the AI as a document, at every stage;
 *   2. the estimator's notes carry no money.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'netlify/functions/generate-estimate-background.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
function ext(name) {
  const s = SRC.search(new RegExp('(?:async )?function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing ' + name);
  let d = 0;
  for (let j = SRC.indexOf('{', s); j < SRC.length; j++) { if (SRC[j] === '{') d++; else if (SRC[j] === '}') { d--; if (!d) return SRC.slice(s, j + 1); } }
}

console.log('\n1. The plans reach the AI\n');
const calls = [];
const ctx = {
  thread: { normalizeThread: (r) => r.thread || [] },
  cleanText: (v) => (v == null ? '' : String(v).trim()),
  console: { error: () => {}, log: () => {} },
  callClaude: async (key, prompt, max, tools, blocks) => { calls.push({ prompt, blocks: blocks || null }); if (ctx.refuse && (blocks || []).some((b) => b.type === 'document')) throw new Error('400 PDF has too many pages'); return '{}'; },
};
vm.createContext(ctx);
vm.runInContext('const MAX_DOCS_TO_READ = 3;\n' + ext('documentBlocksForClaude') + '\n' + ext('drawingsRule') + '\n' + ext('callWithDrawings'), ctx);
const request = { photos: [
  { name: 'kitchen.jpg', kind: 'image', data: 'data:image/jpeg;base64,AAAA' },
  { name: 'A-101 Floor plans.pdf', kind: 'file', data: 'data:application/pdf;base64,JVBERi0x' },
  { name: 'Finish schedule.pdf', kind: 'file', data: 'https://x.supabase.co/storage/v1/object/public/estimate-photos/SBC/1-abc.pdf' },
  { name: 'notes.docx', kind: 'file', data: 'https://x.supabase.co/storage/v1/object/public/estimate-photos/SBC/2.docx' } ] };
const record = { thread: [{ from: 'contractor', attachments: [{ name: 'A-201 Elevations.pdf', kind: 'file', url: 'https://x.supabase.co/storage/v1/object/public/estimate-photos/SBC/3.pdf' }, { name: 'extra.pdf', kind: 'file', url: 'https://x.supabase.co/x/4.pdf' }] }] };
const blocks = ctx.documentBlocksForClaude(request, record);
const docs = blocks.filter((b) => b.type === 'document');
ok('PDF PLANS BECOME DOCUMENT BLOCKS: an uploaded PDF and a PDF link', docs[0] && docs[0].source.type === 'base64' && docs[0].source.media_type === 'application/pdf' && docs[1] && docs[1].source.type === 'url' && /1-abc\.pdf$/.test(docs[1].source.url));
ok('...and a PDF the contractor sent later in a message', docs[2] && /3\.pdf$/.test(docs[2].source.url));
ok('...each one labelled with its name and where it came from', /Drawing \/ document 1 — A-101 Floor plans\.pdf, from the customer's request/.test(blocks[0].text) && /A-201 Elevations\.pdf, from a message from the contractor/.test(blocks[4].text));
ok('...photos and non-PDF files are not sent as documents, and at most 3 are read', docs.length === 3 && !JSON.stringify(blocks).includes('kitchen.jpg') && !JSON.stringify(blocks).includes('.docx'));

{
  const noKind = ctx.documentBlocksForClaude({ photos: [{ name: 'A-101.pdf', data: 'https://x.supabase.co/storage/v1/object/public/estimate-photos/SBC/9-a-101.pdf', slot: 'other' }, { name: 'room.jpg', data: 'https://x.supabase.co/storage/v1/object/public/estimate-photos/SBC/9-room.jpg' }] }, {});
  ok('A PDF THE CUSTOMER FORM SAVED WITH NO KIND is still read as a drawing (the form stored none)', noKind.filter((b) => b.type === 'document').length === 1 && /9-a-101\.pdf$/.test(noKind[1].source.url));
}

(async () => {
  await ctx.callWithDrawings('k', 'ANALYSIS', 32000, [{ type: 'image' }], blocks, {}, 'analysis');
  ok('THE ANALYSIS READS THEM, after the photos, and is told to take quantities from them per room', calls[0].blocks.length === 1 + blocks.length && calls[0].blocks[0].type === 'image' && /PROJECT DRAWINGS ATTACHED \(3 files\)\. Read every page\. Take room sizes, fixture counts and finish areas from the drawings - per room, then totalled/.test(calls[0].prompt));
  await ctx.callWithDrawings('k', 'PRICE', 32000, null, blocks, {}, 'estimate');
  ok('THE PRICING AND REPAIR PASSES SEE THEM TOO, and may never say there are none', calls[1].blocks.length === blocks.length && /Never write that there are no drawings\./.test(calls[1].prompt));
  calls.length = 0; ctx.refuse = true; const timing = {};
  await ctx.callWithDrawings('k', 'PRICE', 32000, null, blocks, timing, 'estimate');
  ok('A FILE THE API REFUSES never costs the estimate: tried again without the drawings, and noted', calls.length === 2 && calls[1].blocks === null && calls[1].prompt === 'PRICE' && /too many pages/.test(timing.drawingsSkipped));
  calls.length = 0; ctx.refuse = false;
  await ctx.callWithDrawings('k', 'PRICE', 32000, null, [], {}, 'estimate');
  ok('no drawings: the request is exactly as before', calls[0].prompt === 'PRICE' && calls[0].blocks === null);
  ok('all three AI stages get the drawings; built once for the run', /const docBlocks = anthropicKey \? documentBlocksForClaude\(sourceRecord\.request, sourceRecord\) : \[\];/.test(SRC) && (SRC.match(/callWithDrawings\(anthropicKey, (analysisPrompt|estimatePrompt|repairPrompt), 32000, (photoBlocks|null), docBlocks, timing, "(analysis|estimate|repair)"\)/g) || []).length === 3);
  ok('...and the run records how many were read', /if \(docBlocks\.length\) timing\.drawingsRead = docBlocks\.length \/ 2;/.test(SRC));

  console.log('\n2. The notes carry no money\n');
  const c2 = { cleanText: ctx.cleanText }; vm.createContext(c2); vm.runInContext(ext('notesWithoutMoney'), c2);
  const notes = 'Repair pass: every customer-supplied item now has matching labor. Totals: 1,165 man-hours, labor $112,700; materials $18,675; at 25% markup about $164,200. Tile selection open (12x24 assumed). Re-price after the walkthrough.';
  const out = c2.notesWithoutMoney(notes);
  ok('A SENTENCE WITH A DOLLAR FIGURE IS DROPPED from the notes', !/\$/.test(out) && !/164,200|112,700/.test(out));
  ok('...everything else stays, in order', out === 'Repair pass: every customer-supplied item now has matching labor. Tile selection open (12x24 assumed). Re-price after the walkthrough.', out);
  ok('...notes with no money are untouched', c2.notesWithoutMoney('Confirm store hours.') === 'Confirm store hours.');
  ok('every estimate, first draft and repair, goes through it', /notes: notesWithoutMoney\(raw\.notes\),/.test(SRC));
  ok('the estimator is told: NOTES CARRY NO MONEY', /20\. NOTES CARRY NO MONEY\. The system re-prices every line after you/.test(SRC));
  ok('...and so is the repair pass', /"notes" carries no money: no totals, rates, markup or selling price/.test(SRC));

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
