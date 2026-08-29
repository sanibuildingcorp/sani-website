/* photo-slots.test.js — run: node js/photo-slots.test.js
 *
 * "The customers many times sends photos where shows just damage very close
 *  which is very difficult to identify areas or figure dimensions."
 *
 * A close-up of a cracked tile is a photograph of a crack. It is not a
 * photograph of a job — it cannot say whether the room is 30 square feet or 300,
 * and both of those are a number in the estimate.
 *
 * The instinct is to do what a bank does with a check: watch the live preview and
 * say "move back". A web page cannot. Tapping "Take Photo" on a file input hands
 * off to the phone's OWN camera app, a separate program the page cannot see into
 * or draw on. So instead of guiding the shot, this asks for the right shots BY
 * NAME — which wins on the part that matters anyway, because it hands the
 * estimator something no overlay could: it knows which photo is the wide one.
 *
 * Two things these tests hold in place:
 *   - the two forms share ONE list, so "wide" cannot come to mean different
 *     things on the contact page and the estimate page;
 *   - the nudge stays a sentence, never a blocker. Zura's standing rule is that
 *     many customers do not know what they are looking at, and a form that
 *     refuses them is a lead lost.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const S = require('./photo-slots.js');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

const shot = (slot) => ({ name: 'x.jpg', data: 'data:image/jpeg;base64,x', kind: 'image', slot: slot });

console.log('\nthe shots we ask for\n');

/* ── the list ───────────────────────────────────────────────────────────── */
ok('there are four named shots plus a bucket for everything else',
  S.PHOTO_SLOTS.length === 4 && S.OTHER_SLOT.id === 'other' && S.ALL_SLOTS.length === 5);
ok('they are in the order a person would actually shoot them',
  S.PHOTO_SLOTS.map(s => s.id).join(',') === 'wide,area,close,scale',
  S.PHOTO_SLOTS.map(s => s.id).join(','));
ok('THE WIDE SHOT IS THE ONE THAT MATTERS — it is the only essential',
  S.PHOTO_SLOTS.filter(s => s.essential).map(s => s.id).join(',') === 'wide');
ok('every slot says where to stand, not just what to photograph',
  S.ALL_SLOTS.every(s => s.hint && s.hint.length > 8 && s.label && s.icon));
ok('the wide shot tells them to stand in the doorway', /doorway/i.test(S.slotById('wide').hint), S.slotById('wide').hint);
ok('the scale shot names things people actually have on them',
  /tape measure|dollar|shoe/i.test(S.slotById('scale').hint), S.slotById('scale').hint);
ok('the area shot warns against framing only the damage',
  /not just the bad part|whole/i.test(S.slotById('area').hint), S.slotById('area').hint);

ok('a slot can be looked up by id', S.slotById('close').label === 'Close-up');
ok('an unknown id is null, never a crash', S.slotById('nonsense') === null && S.slotById(null) === null && S.slotById(undefined) === null);
ok('slotLabel gives a name for the dashboard', S.slotLabel('wide') === 'The whole room');
ok('...and an empty string for junk, never "undefined" in front of a customer',
  S.slotLabel('junk') === '' && S.slotLabel(undefined) === '' && S.slotLabel(null) === '');

/* ── counting ───────────────────────────────────────────────────────────── */
{
  const c = S.countBySlot([shot('wide'), shot('close'), shot('close')]);
  ok('photos are counted against their slot', c.wide === 1 && c.close === 2 && c.area === 0);
}
ok('a photo with no slot counts as "other" rather than vanishing',
  S.countBySlot([{ name: 'a.jpg' }]).other === 1);
ok('...and so does one with a slot we do not recognise',
  S.countBySlot([{ slot: 'sideways' }]).other === 1);
ok('counting junk does not throw',
  S.countBySlot(null).wide === 0 && S.countBySlot([null, undefined]).other === 0 && S.countBySlot('nope').wide === 0);

/* ── what is missing ────────────────────────────────────────────────────── */
ok('with no wide shot, the wide shot is reported missing',
  S.missingEssential([shot('close')]).map(s => s.id).join(',') === 'wide');
ok('with a wide shot, nothing essential is missing',
  S.missingEssential([shot('wide'), shot('close')]).length === 0);
ok('the other three are never called missing — they help, they are not required',
  S.missingEssential([shot('wide')]).length === 0);

/* ══ THE NUDGE ════════════════════════════════════════════════════════════
   The whole feature comes down to this one sentence appearing at the right
   moment and never at the wrong one. */
console.log('\nthe one sentence\n');

ok('NOTHING IS SAID TO SOMEBODY WHO HAS SENT NO PHOTOS — that would just be noise',
  S.photoNudge([]) === '' && S.photoNudge(null) === '' && S.photoNudge(undefined) === '');
ok('nothing is said once the wide shot is there',
  S.photoNudge([shot('wide')]) === '' && S.photoNudge([shot('wide'), shot('close'), shot('scale')]) === '');
{
  const msg = S.photoNudge([shot('close')]);
  ok('ALL CLOSE-UPS GETS THE SPECIFIC ANSWER — this is the complaint, word for word', /all close-ups/i.test(msg), msg);
  ok('...and says why it matters, in money terms not camera terms', /size|area|guess/i.test(msg), msg);
  ok('...and says where to stand', /doorway/i.test(msg), msg);
}
{
  const msg = S.photoNudge([shot('close'), shot('close'), shot('close')]);
  ok('three close-ups and nothing else gets the same specific answer', /all close-ups/i.test(msg), msg);
}
{
  const msg = S.photoNudge([shot('area'), shot('close')]);
  ok('a mixed set with no wide shot gets the shorter ask', msg !== '' && !/all close-ups/i.test(msg), msg);
  ok('...still pointing at the doorway', /doorway/i.test(msg), msg);
}
{
  const msg = S.photoNudge([{ name: 'a.jpg' }, { name: 'b.jpg' }]);
  ok('loose photos with no slots at all still prompt for the wide shot', msg !== '', msg);
}
ok('the nudge is never a refusal — nothing here returns false, throws, or blocks',
  [[], [shot('close')], [shot('wide')], null, 'junk'].every(function (v) {
    try { return typeof S.photoNudge(v) === 'string'; } catch (e) { return false; }
  }));

/* ══ ONE LIST, BOTH FORMS ═════════════════════════════════════════════════
   Two pages each with their own copy of this list is two pages that quietly
   come to disagree about what "wide" means. */
console.log('\nboth forms read from this one file\n');

const CONTACT = fs.readFileSync(path.join(__dirname, '..', 'contact.html'), 'utf8');
const ESTIMATE = fs.readFileSync(path.join(__dirname, '..', 'estimate.html'), 'utf8');

ok('the contact form loads it', /<script src="js\/photo-slots\.js"><\/script>/.test(CONTACT));
ok('the estimate form loads it', /<script src="js\/photo-slots\.js"><\/script>/.test(ESTIMATE));
ok('the contact form renders the tiles FROM the shared list, not from its own copy',
  /PHOTO_SLOTS\.map\(/.test(CONTACT) && !/id:\s*["']wide["']/.test(CONTACT));
ok('...and so does the estimate form',
  /PHOTO_SLOTS\.map\(/.test(ESTIMATE) && !/id:\s*["']wide["']/.test(ESTIMATE));
ok('both use the shared nudge rather than writing their own sentence',
  /photoNudge\(contactFiles\)/.test(CONTACT) && /photoNudge\(formData\.photos\)/.test(ESTIMATE));
ok('both record which shot a photo is', /slot: slot \|\| "other"/.test(CONTACT) && /slot:slot\|\|'other'/.test(ESTIMATE));
ok('a named shot holds one photo — picking again replaces it',
  /contactFiles\.filter\(function\(p\)\{ return !p \|\| p\.slot !== slot; \}\)/.test(CONTACT) &&
  /formData\.photos\.filter\(function\(p\)\{return !p\|\|p\.slot!==slot;\}\)/.test(ESTIMATE));
ok('THE 8-FILE CAP DOES NOT APPLY TO A NAMED SHOT — refusing the photo that makes the job estimable would be backwards',
  /if \(!slot\) \{[\s\S]{0,400}CONTACT_MAX_FILES - contactFiles\.length/.test(CONTACT) &&
  /\}else\{\n\s*files=files\.slice\(0,8-formData\.photos\.length\);/.test(ESTIMATE));
ok('the slots travel with a contact submission', /name="photo_slots"/.test(CONTACT));
ok('...in the same order as the links', /uploaded\.map\(function\(u\)\{return u\.slot\|\|"other";\}\)\.join\("\\n"\)/.test(CONTACT));
ok('the estimate form sends the slot with each uploaded photo', /slot:p\.slot\|\|'other'/.test(ESTIMATE));
ok('a missing photo-slots.js leaves the contact form working rather than taking the page down',
  /try\{ contactRenderShots\(\); \}catch/.test(CONTACT));

/* ── it really is loadable as a browser script, not just a node module ──── */
{
  const ctx = { Object: Object, Array: Array, String: String };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'photo-slots.js'), 'utf8'), ctx);
  ok('loaded as a plain <script> it puts the list on window',
    Array.isArray(ctx.PHOTO_SLOTS) && ctx.PHOTO_SLOTS.length === 4);
  ok('...and the nudge too', typeof ctx.photoNudge === 'function' && ctx.photoNudge([]) === '');
}

/* ══ THE ESTIMATOR IS TOLD WHICH SHOT IS WHICH ════════════════════════════
   The whole point: "this is the whole room from the doorway" is evidence about
   size. The same picture unlabelled is just another image. */
console.log('\nthe estimator is told what it is looking at\n');
const GEN = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'generate-estimate-background.js'), 'utf8');
ok('the shots reach the estimator input', /photoShots: body\.usePhotoAnalysis === false \? \[\] : photoShots\(request\)/.test(GEN));
ok('...and are switched off by the same toggle that switches photos off',
  /photoShots: body\.usePhotoAnalysis === false/.test(GEN));
ok('THE PIN IS NOT DISTURBED — framing is not a change of job, and a new key there would stale every record',
  !/photoShots/.test(fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'lib', 'scope-pin.js'), 'utf8')));
{
  /* Run the real helper out of the file. */
  const src = GEN.slice(GEN.indexOf('const SHOT_LABELS'), GEN.indexOf('\n}', GEN.indexOf('function photoShots')) + 2);
  const c = {}; vm.createContext(c); vm.runInContext(src, c);
  const run = (photos) => vm.runInContext('photoShots(' + JSON.stringify({ photos: photos }) + ')', c);
  ok('a wide shot is described in words the analyst can use',
    /whole room/.test(run([{ slot: 'wide' }])[0]), JSON.stringify(run([{ slot: 'wide' }])));
  ok('several shots are all described', run([{ slot: 'wide' }, { slot: 'close' }, { slot: 'scale' }]).length === 3);
  {
    const r = run([{ slot: 'close' }, { slot: 'other' }]);
    ok('ALL CLOSE-UPS IS SAID OUT LOUD, with the instruction not to guess dimensions',
      r.length === 2 && /do not infer room dimensions/.test(r[1]), JSON.stringify(r));
  }
  ok('no photos at all says nothing — there is nothing to warn about', run([]).length === 0);
  ok('unlabelled photos from before the slots existed get the warning, not a crash',
    run([{ name: 'a.jpg' }]).length === 1 && /do not infer/.test(run([{ name: 'a.jpg' }])[0]));
  ok('an unrecognised slot is skipped rather than shown raw to the AI',
    run([{ slot: 'sideways' }]).every(function (s) { return s.indexOf('sideways') === -1; }));
  ok('junk does not throw',
    (function () { try { run(null); run([null]); vm.runInContext('photoShots(null)', c); return true; } catch (e) { return 'threw: ' + e.message; } })() === true);
}

/* ══ THE DASHBOARD SHOWS THE LABEL ════════════════════════════════════════ */
console.log('\nthe contractor can see which shot is which\n');
const leads = require(path.join(__dirname, '..', 'netlify', 'functions', 'contact-leads.js'));
ok('contact-leads exports the slot parser', typeof leads.splitSlots === 'function');
if (typeof leads.splitSlots === 'function') {
  const P = leads.splitSlots;
  ok('slots line up with the links one for one',
    JSON.stringify(P('wide\nclose', 2)) === JSON.stringify(['wide', 'close']));
  ok('FEWER SLOTS THAN LINKS IS PADDED, never misaligned — a label under the wrong photo is worse than none',
    JSON.stringify(P('wide', 3)) === JSON.stringify(['wide', '', '']));
  ok('more slots than links is trimmed',
    JSON.stringify(P('wide\nclose\narea', 1)) === JSON.stringify(['wide']));
  ok('OLD SUBMISSIONS HAVE NO SLOT FIELD — that is blanks, not a crash',
    JSON.stringify(P(undefined, 2)) === JSON.stringify(['', '']) &&
    JSON.stringify(P('', 1)) === JSON.stringify(['']));
  ok('an invented slot id is dropped rather than shown', JSON.stringify(P('sideways', 1)) === JSON.stringify(['']));
  ok('no links means no slots', P('wide', 0).length === 0 && P('wide').length === 0);
  ok('case and stray spaces are tolerated', JSON.stringify(P(' WIDE ', 1)) === JSON.stringify(['wide']));
}

{
  const DASH = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
  function extFrom(src, name) {
    const s = src.search(new RegExp('(async )?function ' + name + '\\('));
    let d = 0;
    for (let j = src.indexOf('{', s); j < src.length; j++) {
      if (src[j] === '{') d++;
      else if (src[j] === '}') { d--; if (!d) return src.slice(s, j + 1); }
    }
  }
  const dctx = { console, String, Number, Array, Object, Boolean, Math, JSON };
  dctx.window = dctx; dctx.globalThis = dctx;
  vm.createContext(dctx);
  vm.runInContext(extFrom(DASH, 'esc'), dctx);
  vm.runInContext(extFrom(DASH, 'leadPhotosHtml'), dctx);
  const panel = (L) => vm.runInContext('leadPhotosHtml(' + JSON.stringify(L) + ')', dctx);

  const h = panel({ photos: ['https://a.com/1.jpg', 'https://a.com/2.jpg'], photoSlots: ['wide', 'close'] });
  ok('each thumbnail is labelled with the shot it is', /Whole room/.test(h) && /Close-up/.test(h), h.slice(0, 300));
  const h2 = panel({ photos: ['https://a.com/1.jpg'], photoSlots: ['close'] });
  ok('NO WIDE SHOT IS FLAGGED AT A GLANCE — that is why the estimate would be a guess', /no wide shot/.test(h2), h2.slice(0, 300));
  const h3 = panel({ photos: ['https://a.com/1.jpg'], photoSlots: ['wide'] });
  ok('...and not flagged when the wide shot is there', !/no wide shot/.test(h3));
  const h4 = panel({ photos: ['https://a.com/1.jpg'] });
  ok('a lead from before the slots existed shows the photo with no label and no warning',
    !/no wide shot/.test(h4) && h4.indexOf('<img') !== -1, h4.slice(0, 200));
  ok('an unknown slot renders no label rather than raw text',
    panel({ photos: ['https://a.com/1.jpg'], photoSlots: ['sideways'] }).indexOf('sideways') === -1);
  ok('the panel still renders using nothing but esc()',
    (function () { try { panel({ photos: ['https://a.com/1.jpg'], photoSlots: ['wide'] }); return true; } catch (e) { return 'threw: ' + e.message; } })() === true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
