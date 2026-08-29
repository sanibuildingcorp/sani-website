/* camera-coach.test.js — run: node js/camera-coach.test.js
 *
 *   "where is it second photo camera move close or move out"
 *
 * This is the half of that feature that either works or is theatre. An overlay
 * that says "step back" at the wrong moment is worse than no overlay: it argues
 * with somebody standing in their own bathroom holding a phone.
 *
 * So the discriminator gets tested against made-up frames whose ground truth is
 * known by construction, BEFORE any of it reaches a viewfinder.
 *
 * THE HARD CASE, and the one that decides whether this idea works at all:
 * a close-up of TILE. It is one flat surface eighteen inches from the lens — the
 * exact thing we want to catch — but it is covered in grout lines that run right
 * across the frame, so a naive "does it have long straight lines?" test calls it
 * a room and says nothing.
 *
 * The measure used is peak-over-mean, and that is why. A room has ONE dominant
 * junction — the wall meeting the floor — standing out against a lot of quiet.
 * Tile has forty equal lines, so the mean rises with the peak and the ratio stays
 * flat. The frames below prove that holds rather than assuming it.
 */
const C = require('./camera-coach.js');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

const W = 160, H = 120;

/* A tiny deterministic noise source — a real sensor is never perfectly clean,
   and a spotless synthetic frame would flatter the algorithm. */
function rnd(seed) {
  let s = seed || 1;
  return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s / 0x7fffffff); };
}

/* ── the frames ─────────────────────────────────────────────────────────── */

/* A REALISTIC room from the doorway. The first version of this fixture was one
   perfect 1px line on a clean wall, which scored 36 and made the algorithm look
   far better than it is. A real bathroom is full of competing edges — a vanity,
   a mirror, wall tile, a toilet — and every one of them raises the mean this
   measure divides by. Modelled here, or the threshold set from it would be a
   threshold for a room that does not exist. */
function roomFrame() {
  const r = rnd(7), g = new Array(W * H);
  const jy = Math.round(H * 0.72);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = y > jy ? 96 : 168;                 /* floor darker than wall */
      v += (r() - 0.5) * 14;                     /* real surfaces are not flat */
      if (y < jy && (y % 17 === 0 || x % 19 === 0)) v -= 26;   /* wall tile, competing lines */
      g[y * W + x] = v;
    }
  }
  /* The junction, soft over two rows the way a real edge lands on a sensor. */
  for (let x = 0; x < W; x++) { g[jy * W + x] = 44; g[(jy + 1) * W + x] = 70; }
  for (let y = 0; y < jy; y++) { g[y * W + 45] = 62; g[y * W + 46] = 88; }   /* door frame */
  /* Clutter: a vanity and a mirror, each contributing their own edges. */
  for (let y = 46; y < jy; y++) for (let x = 96; x < 140; x++) g[y * W + x] = 128 + (r() - 0.5) * 12;
  for (let y = 12; y < 40; y++) for (let x = 100; x < 136; x++) g[y * W + x] = 196 + (r() - 0.5) * 12;
  return g;
}

/* A close-up of tile — THE HARD CASE. One flat surface eighteen inches from the
   lens, but ruled with grout lines that cross the whole frame in both
   directions. Soft-edged and slightly uneven, like real grout. */
function tileCloseupFrame() {
  const r = rnd(11), g = new Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = 176 + (r() - 0.5) * 14;
      if (y % 13 === 0 || x % 13 === 0) v = 92 + (r() - 0.5) * 18;   /* grout, evenly, everywhere */
      else if (y % 13 === 1 || x % 13 === 1) v = 140;                /* its soft shoulder */
      g[y * W + x] = v;
    }
  }
  return g;
}

/* A close-up of a painted wall with a crack: flat, low detail, one short mark
   that is nothing like a room's junction. */
function flatWallFrame() {
  const r = rnd(13), g = new Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) g[y * W + x] = 172 + (r() - 0.5) * 11;
  }
  for (let y = 40; y < 62; y++) g[y * W + 70 + (y % 3)] = 110;
  return g;
}

/* A close-up of stained grout: busy texture, no structure. */
function textureFrame() {
  const r = rnd(17), g = new Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = 90 + r() * 90;
  return g;
}

function darkFrame() {
  const r = rnd(19), g = new Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = 8 + r() * 22;
  return g;
}
function blownOutFrame() {
  const g = new Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = 248;
  return g;
}
/* Properly lit but out of focus: a room whose edges have all been smeared. */
function blurryRoomFrame() {
  const src = roomFrame(), g = new Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0, c = 0;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < H && xx >= 0 && xx < W) { s += src[yy * W + xx]; c++; }
      }
      g[y * W + x] = s / c;
    }
  }
  return g;
}

const stats = (f) => C.frameStats(f, W, H);

console.log('\nreading the frame\n');

const room = stats(roomFrame());
const tile = stats(tileCloseupFrame());
const wall = stats(flatWallFrame());
const tex = stats(textureFrame());

console.log('        lineScore — room ' + room.lineScore.toFixed(2)
  + ' | tile ' + tile.lineScore.toFixed(2)
  + ' | wall ' + wall.lineScore.toFixed(2)
  + ' | texture ' + tex.lineScore.toFixed(2)
  + '   (surface below ' + C.TUNING.SURFACE_BELOW + ', scene above ' + C.TUNING.SCENE_ABOVE + ')\n');

ok('a furnished room reads as a scene', room.lineScore > C.TUNING.SCENE_ABOVE, 'got ' + room.lineScore.toFixed(2));
ok('THE HARD CASE: a tile close-up reads as one surface — forty equal grout lines are not a room',
  tile.lineScore < C.TUNING.SURFACE_BELOW, 'got ' + tile.lineScore.toFixed(2));
ok('a flat wall close-up does too', wall.lineScore < C.TUNING.SURFACE_BELOW, 'got ' + wall.lineScore.toFixed(2));
ok('nor is busy texture a room — being busy is not the same as being structured',
  tex.lineScore < C.TUNING.SURFACE_BELOW, 'got ' + tex.lineScore.toFixed(2));
ok('THE BAND HAS A REAL GAP, so neither verdict is scraping past a line',
  C.TUNING.SCENE_ABOVE > C.TUNING.SURFACE_BELOW * 1.5
  && room.lineScore > C.TUNING.SCENE_ABOVE * 1.15
  && tile.lineScore < C.TUNING.SURFACE_BELOW * 0.95,
  'room ' + room.lineScore.toFixed(2) + ' | tile ' + tile.lineScore.toFixed(2));
ok('and the room is clearly separated, not scraping past the line',
  room.lineScore > tile.lineScore * 1.4,
  'room ' + room.lineScore.toFixed(2) + ' vs tile ' + tile.lineScore.toFixed(2));

ok('brightness is read correctly', stats(darkFrame()).brightness < C.TUNING.DARK && room.brightness > 100);
ok('a blurred room reads as soft', stats(blurryRoomFrame()).sharpness < stats(roomFrame()).sharpness,
  'blurred ' + stats(blurryRoomFrame()).sharpness.toFixed(1) + ' vs sharp ' + room.sharpness.toFixed(1));
ok('junk in does not throw',
  (function () {
    try {
      C.frameStats(null, W, H); C.frameStats([], 0, 0); C.frameStats([1, 2, 3], W, H); C.frameStats(new Array(9).fill(5), 3, 3);
      return true;
    } catch (e) { return 'threw: ' + e.message; }
  })() === true);
ok('...and reports itself as unusable rather than guessing', C.frameStats(null, W, H).ok === false);

/* ══ WHAT IT SAYS, FOR THE SHOT THEY ASKED FOR ═══════════════════════════════
   The whole reason this can work at all: "move closer" and "step back" are
   opposite advice, and the difference is entirely WHICH tile they tapped. */
console.log('\nwhat it says\n');

{
  const c = C.coachFor('wide', tile);
  ok('WIDE SHOT, LENS FULL OF TILE → step back', c.state === 'bad' && /step back/i.test(c.text), JSON.stringify(c));
  ok('...and says how far back, in a way you can act on', /whole room/i.test(c.text), c.text);
}
ok('wide shot of an actual room → good', C.coachFor('wide', room).state === 'good', JSON.stringify(C.coachFor('wide', room)));
ok('CLOSE-UP TAKEN FROM ACROSS THE ROOM → move closer (the real room frame, not a made-up number)',
  C.coachFor('close', room).state === 'bad' && /move closer/i.test(C.coachFor('close', room).text),
  JSON.stringify(C.coachFor('close', room)));
ok('close-up that is actually close → good', C.coachFor('close', tile).state === 'good', JSON.stringify(C.coachFor('close', tile)));
ok('THE SAME FRAME GETS OPPOSITE ADVICE FOR THE TWO SHOTS — which is the whole point',
  C.coachFor('wide', tile).state === 'bad' && C.coachFor('close', tile).state === 'good');

ok('darkness is called before anything else — nothing else can be trusted in it',
  /dark/i.test(C.coachFor('wide', stats(darkFrame())).text), C.coachFor('wide', stats(darkFrame())).text);
ok('a blown-out frame is called too', /bright/i.test(C.coachFor('wide', stats(blownOutFrame())).text));
ok('a soft frame says to hold still', /hold still/i.test(C.coachFor('wide', stats(blurryRoomFrame())).text),
  C.coachFor('wide', stats(blurryRoomFrame())).text);
ok('the scale shot admits it cannot check, and just reminds them',
  /tape measure|dollar/i.test(C.coachFor('scale', room).text), C.coachFor('scale', room).text);
/* A flat wall is what the AREA shot is FOR, so it must be accepted — the first
   version of this test asserted the opposite and was simply wrong about the
   product. What area should catch is the lens jammed against the surface. */
ok('the area shot accepts a whole flat wall — that is the shot it is asking for',
  C.coachFor('area', wall).state === 'good', JSON.stringify(C.coachFor('area', wall)));
ok('...but says to step back when the lens is jammed against texture',
  C.coachFor('area', tex).state !== 'good' && /step back/i.test(C.coachFor('area', tex).text),
  JSON.stringify(C.coachFor('area', tex)));

/* ══ THE SILENT MIDDLE ════════════════════════════════════════════════════════
   The most important behaviour in the file. These thresholds came from frames I
   constructed, not from photographs of anyone's bathroom, so between the two
   confident ends the coach must NOT give distance advice it cannot back up. A
   camera that argues with somebody standing in their own room is worse than one
   that keeps quiet. */
{
  const middling = { ok: true, brightness: 150, sharpness: 400, edgeRatio: 0.2,
                     lineScore: (C.TUNING.SURFACE_BELOW + C.TUNING.SCENE_ABOVE) / 2 };
  const w = C.coachFor('wide', middling), c = C.coachFor('close', middling);
  ok('AN AMBIGUOUS FRAME GETS NO "STEP BACK" — it is not confident enough to say so',
    !/step back/i.test(w.text), w.text);
  ok('...and no "move closer" either', !/move closer/i.test(c.text), c.text);
  ok('...it still says something useful rather than going blank', w.text.length > 5 && c.text.length > 5);
  ok('...and neither is dressed up as certainty', w.state !== 'bad' && c.state !== 'bad');
}

/* ── the rule that keeps this from being obnoxious ──────────────────────── */
ok('NOTHING EVER REFUSES A PHOTO — every verdict is advice, and every one has words',
  ['wide', 'area', 'close', 'scale', 'other', '', null].every(function (slot) {
    return [room, tile, wall, tex, stats(darkFrame()), stats(blownOutFrame()), null, { ok: false }].every(function (s) {
      const c = C.coachFor(slot, s);
      return c && typeof c.text === 'string' && c.text.length > 3 && ['bad', 'warn', 'good'].indexOf(c.state) !== -1;
    });
  }));
ok('an unknown slot still gets something sensible', C.coachFor('nonsense', room).state === 'good');

/* ── rgba → luma ────────────────────────────────────────────────────────── */
{
  const rgba = [255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255];
  const g = C.toGray(rgba, 3);
  ok('white reads as white, black as black', g[0] === 255 && g[1] === 0);
  ok('red is weighted the way an eye sees it, not averaged', g[2] > 60 && g[2] < 90, 'got ' + g[2]);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
