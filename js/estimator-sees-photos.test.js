/* estimator-sees-photos.test.js — run: node js/estimator-sees-photos.test.js
 *
 *   "we can remove it too if we don't need it for AI estimate generator, like
 *    i showing many times screen shots for explanation"
 *
 * He believed the estimator was reading the photos. It was not. It received a
 * line of gpt-4o-mini text ABOUT them, and only when a dashboard toggle was on,
 * which by default it was off. Every estimate ever generated was priced from
 * the description and the answers alone.
 *
 * Asked directly, he chose: let it see the photos. So when a record carries
 * photographs, the understanding stage now runs on Claude with the images in
 * the message, each preceded by a one-line label saying which shot it is. With
 * no photos, nothing changes - the request is byte-identical to before.
 *
 * THE TWO THINGS THAT WOULD HURT: sending something the API rejects (a PDF, a
 * HEIC, a data URL with the "data:" prefix left on) fails the whole estimate;
 * and a photo passed with no label is just a picture of a crack, not of a job.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

function ext(name) {
  const s = SRC.search(new RegExp('(?:async )?function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = SRC.indexOf('{', s); j < SRC.length; j++) {
    if (SRC[j] === '{') d++;
    else if (SRC[j] === '}') { d--; if (!d) return SRC.slice(s, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}
function extConst(name) {
  const s = SRC.indexOf('const ' + name + ' =');
  if (s < 0) throw new Error('missing const ' + name);
  const e = SRC.indexOf('\n};', s);
  const semi = SRC.indexOf(';\n', s);
  return SRC.slice(s, (e > 0 && e < semi ? e + 3 : semi + 1));
}

/* ── the real helper, the real callClaude, a captured https ─────────────── */
let captured = null;
const ctx = {
  console, String, Number, Array, Object, JSON, RegExp, Buffer, Promise, Error,
  CLAUDE_MODEL: 'claude-opus-5', CLAUDE_EFFORT: 'high',
  https: { request: function (opts, cb) { return { on() { return this; }, setTimeout() {}, write(b) { captured = JSON.parse(b); }, end() {}, destroy() {} }; } },
};
vm.createContext(ctx);
vm.runInContext(extConst('SHOT_LABELS'), ctx);
vm.runInContext(SRC.split('\n').find(l => l.startsWith('const MAX_PHOTOS_TO_READ')), ctx);
vm.runInContext(ext('photoBlocksForClaude'), ctx);
vm.runInContext(ext('callClaude'), ctx);
const blocks = (photos) => { ctx.REQ = { photos: photos }; return vm.runInContext('photoBlocksForClaude(REQ)', ctx); };
const WIDE = vm.runInContext('SHOT_LABELS.wide', ctx);

/* ══ WHAT GETS SENT ═══════════════════════════════════════════════════════ */
console.log('\neach photo goes in as a labelled image block\n');
{
  const b = blocks([{ name: 'wide.jpg', data: 'https://x.supabase.co/storage/v1/object/public/p/wide.jpg', kind: 'image', slot: 'wide' }]);
  ok('ONE PHOTO BECOMES A LABEL AND AN IMAGE', b.length === 2 && b[0].type === 'text' && b[1].type === 'image', JSON.stringify(b).slice(0, 200));
  ok('the label says which shot it is, in the words the analyst already knows',
    b[0].text.indexOf('Photo 1') === 0 && b[0].text.indexOf(WIDE) !== -1, b[0].text);
  ok('a hosted photo is sent by URL, not downloaded and re-encoded',
    b[1].source.type === 'url' && b[1].source.url.indexOf('https://') === 0);
}
{
  const b = blocks([{ name: 'a.jpg', data: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', kind: 'image', slot: 'detail' }]);
  ok('an inline (base64) photo is sent as base64 with its media type',
    b.length === 2 && b[1].source.type === 'base64' && b[1].source.media_type === 'image/jpeg');
  ok('...WITH THE "data:" PREFIX STRIPPED — left on, the API rejects the whole request',
    b[1].source.data === '/9j/4AAQSkZJRg==', b[1].source.data);
}
{
  /* A URL with no tell-tale extension - a storage object id - so ONLY the
     kind:'file' flag can save us. The first version used plan.pdf here, and
     the .pdf rule caught it, which meant removing the kind check changed
     nothing this file could see. */
  const b = blocks([{ name: 'floor-plan.dwg', data: 'https://x.supabase.co/storage/v1/object/public/p/9f3a1c', kind: 'file', slot: 'other' }]);
  ok('AN UPLOADED FILE THAT IS NOT AN IMAGE IS SKIPPED, on its kind flag alone', b.length === 0, JSON.stringify(b));
}
{
  ok('a URL ending in .pdf is skipped even without a kind', blocks([{ data: 'https://x/plan.pdf' }]).length === 0);
  ok('HEIC is skipped — the API does not take it', blocks([{ data: 'https://x/IMG_1.heic', slot: 'wide' }]).length === 0);
  ok('a data URL that is not an image is skipped', blocks([{ data: 'data:application/pdf;base64,JVBERi0=' }]).length === 0);
  ok('a photo with no data is skipped, not sent as an empty block', blocks([{ name: 'x.jpg', slot: 'wide' }]).length === 0);
}
{
  const b = blocks([{ name: 'photo-1', data: 'https://x/1.jpg', slot: 'wide' }]);
  ok('A CONTACT-FORM PHOTO ({name, data, slot}, no kind) IS INCLUDED', b.length === 2 && b[1].source.url === 'https://x/1.jpg');
}
{
  const b = blocks([{ data: 'https://x/1.jpg', slot: 'nonsense' }]);
  ok('an unknown slot still gets a label, so the picture is never unexplained',
    b.length === 2 && /Photo 1/.test(b[0].text) && /shot not stated/.test(b[0].text), b[0].text);
}
{
  const many = Array.from({ length: 12 }, (_, i) => ({ data: 'https://x/' + i + '.jpg', slot: 'other' }));
  const b = blocks(many);
  ok('twelve photos are capped at ' + vm.runInContext('MAX_PHOTOS_TO_READ', ctx), b.length === 16, b.length / 2 + ' images');
  ok('...numbered 1 to 8 in order', b[0].text.indexOf('Photo 1') === 0 && b[14].text.indexOf('Photo 8') === 0);
  ok('a skipped file does not use up a slot',
    blocks([{ data: 'https://x/p.pdf' }].concat(many)).length === 16);
}
ok('no photos at all gives no blocks', blocks([]).length === 0 && blocks(undefined).length === 0);

/* ══ HOW CALLCLAUDE SENDS THEM ════════════════════════════════════════════ */
console.log('\ncallClaude puts the pictures in the message, and changes nothing without them\n');
{
  captured = null;
  vm.runInContext("callClaude('k', 'THE PROMPT', 16000, null, photoBlocksForClaude({photos:[{data:'https://x/1.jpg',slot:'wide'}]}))", ctx);
  const msg = captured.messages[0];
  ok('THE USER TURN IS AN ARRAY OF BLOCKS', Array.isArray(msg.content) && msg.content.length === 3);
  ok('the image comes BEFORE the prompt, so the instructions are read with the picture in view',
    msg.content[1].type === 'image' && msg.content[2].type === 'text' && msg.content[2].text === 'THE PROMPT');
  ok('the model is still the estimator model', captured.model === 'claude-opus-5');

  captured = null;
  vm.runInContext("callClaude('k', 'THE PROMPT', 16000)", ctx);
  ok('WITHOUT PHOTOS THE REQUEST IS THE PLAIN STRING IT ALWAYS WAS — byte-identical to before',
    captured.messages[0].content === 'THE PROMPT', JSON.stringify(captured.messages[0].content).slice(0, 80));
  captured = null;
  vm.runInContext("callClaude('k', 'P', 100, null, [])", ctx);
  ok('an empty block list is the same as none', captured.messages[0].content === 'P');
}

/* ══ WIRED INTO THE UNDERSTANDING STAGE ═══════════════════════════════════ */
console.log('\nthe understanding stage actually uses it\n');
{
  /* ONE READER. For a day the job was read by Claude when photos were
     attached and by gpt-5-mini when they were not. The scope is decided in
     this stage, so the reader must not change with the customer's camera. */
  ok('THE JOB IS READ BY CLAUDE WHETHER OR NOT THERE ARE PHOTOS',
    /if \(anthropicKey\) \{\s*rawAnalysis = await callClaude\(anthropicKey, analysisPrompt, 16000, null, photoBlocks\);/.test(SRC));
  ok('the photo blocks are built whenever there is an Anthropic key',
    /const photoBlocks = anthropicKey \? photoBlocksForClaude\(record\.request\) : \[\];/.test(SRC));
  ok('OpenAI is only the fallback for a deployment with no Anthropic key',
    /\} else \{\s*rawAnalysis = await callOpenAI\(openaiKey, analysisPrompt\);/.test(SRC) &&
    !/rawAnalysis = openaiKey\s*\?/.test(SRC));
  ok('the record says which engine read the job, and whether it had the photos',
    /understanding: analysisEngine,/.test(SRC) && /with \$\{photoBlocks\.length \/ 2\} photos/.test(SRC));
  ok('the reader is told what the images are, and told not to measure from them',
    /1b\. PHOTOGRAPHS\./.test(SRC) && /Never measure a room from a photograph/.test(SRC));
  ok('the shot list still travels as text too, so a record read by OpenAI is not worse off than before',
    /photoShots: photoShots\(request\),/.test(SRC));
  ok('THE SCOPE PIN IS NOT TOUCHED — an existing pin is re-read only when he presses Re-read',
    !/photoBlocks|photoBlocksForClaude/.test(fs.readFileSync(path.join(ROOT, 'netlify/functions/lib/scope-pin.js'), 'utf8')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
