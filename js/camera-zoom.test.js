/* camera-zoom.test.js — run: node js/camera-zoom.test.js
 *
 *   "If room is to small and they have to take pictures for whole room let them
 *    zoom out by fingers touching"
 *
 * The coach says "step back until the whole room fits in". In a Brooklyn
 * bathroom there is nowhere to step back TO — you are already against the door.
 * The advice becomes nagging at somebody who is doing everything right.
 *
 * THE HARD LIMIT THIS FILE IS BUILT AROUND: you cannot digitally zoom out.
 * Zooming in is cropping. Zooming out would mean inventing scene the lens never
 * saw. A wider picture can only come from a WIDER LENS — on an iPhone, the 0.5x
 * ultra-wide, which is a physically separate camera with its own entry in the
 * device list. So most of this is about reading that list correctly, and about
 * stopping honestly at the widest glass the phone actually has.
 */
const Z = require('./camera-zoom.js');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const vid = (id, label) => ({ kind: 'videoinput', deviceId: id, label: label });

/* What an iPhone 13+ actually hands back once permission is granted. */
const IPHONE = [
  vid('front1', 'Front Camera'),
  vid('back1', 'Back Camera'),
  vid('backuw', 'Back Ultra Wide Camera'),
  vid('backdual', 'Back Dual Wide Camera'),
];
/* A cheaper Android, and a laptop. */
const ONE_CAM = [vid('c1', 'Back Camera')];
const LAPTOP = [vid('w1', 'FaceTime HD Camera')];
/* Before permission is granted, labels are empty strings. */
const UNLABELLED = [vid('a', ''), vid('b', '')];

console.log('\nreading the phone\'s camera list\n');

ok('the ultra-wide is found', Z.classifyCamera('Back Ultra Wide Camera') === 0.5);
ok('THE TRAP: "Back Dual Wide Camera" is an ordinary 1x lens, not the ultra-wide',
  Z.classifyCamera('Back Dual Wide Camera') === 1, 'got ' + Z.classifyCamera('Back Dual Wide Camera'));
ok('the plain back camera is 1x', Z.classifyCamera('Back Camera') === 1);
ok('the telephoto is 2x', Z.classifyCamera('Back Telephoto Camera') === 2);
ok('THE FRONT CAMERA IS EXCLUDED — pinching wide in a bathroom must never show your own face',
  Z.classifyCamera('Front Camera') === null && Z.classifyCamera('FaceTime HD Camera') === null);
ok('an unlabelled camera is treated as an ordinary one, not thrown away',
  Z.classifyCamera('') === 1 && Z.classifyCamera(null) === 1);
ok('case does not matter', Z.classifyCamera('BACK ULTRA WIDE CAMERA') === 0.5);

console.log('\nwhat this phone can actually reach\n');
{
  const l = Z.buildZoomLadder(IPHONE);
  ok('an iPhone offers 0.5x and 1x', JSON.stringify(l.stops) === JSON.stringify([0.5, 1]), JSON.stringify(l.stops));
  ok('THE SMALL BATHROOM IS SAVED — it can go wider than 1x', l.canZoomOut === true && l.min === 0.5);
  ok('the ultra-wide is remembered by id, so it can be opened', l.deviceFor[0.5] === 'backuw', l.deviceFor[0.5]);
  ok('the front camera never made it into the ladder',
    Object.keys(l.deviceFor).every(k => l.deviceFor[k] !== 'front1'), JSON.stringify(l.deviceFor));
  ok('the dual-wide did not displace the plain back camera at 1x', l.deviceFor[1] === 'back1');
}
{
  const l = Z.buildZoomLadder(ONE_CAM);
  ok('A PHONE WITH NO ULTRA-WIDE STOPS AT 1x — it does not pretend', l.min === 1 && l.canZoomOut === false);
  ok('...but can still crop inwards', l.max > 1, 'max ' + l.max);
}
{
  const l = Z.buildZoomLadder(LAPTOP);
  ok('a laptop with only a front camera still yields a usable 1x ladder rather than nothing',
    l.min === 1 && l.stops.length === 1);
}
{
  const l = Z.buildZoomLadder(UNLABELLED);
  ok('cameras with no labels yet (permission not granted) do not break it', l.min === 1 && l.stops.length === 1);
}
ok('junk in does not throw',
  (function () {
    try { Z.buildZoomLadder(null); Z.buildZoomLadder([]); Z.buildZoomLadder([null, {}, { kind: 'audioinput' }]); return true; }
    catch (e) { return 'threw: ' + e.message; }
  })() === true);
ok('an audio device is not a camera', Z.buildZoomLadder([{ kind: 'audioinput', label: 'Mic' }]).stops.length === 1);
{
  const l = Z.buildZoomLadder([vid('t', 'Back Telephoto Camera'), vid('u', 'Back Ultra Wide Camera'), vid('b', 'Back Camera')]);
  ok('three lenses come back in order, widest first', JSON.stringify(l.stops) === JSON.stringify([0.5, 1, 2]), JSON.stringify(l.stops));
}

console.log('\npinching\n');
{
  const l = Z.buildZoomLadder(IPHONE);
  ok('fingers together zooms out', Z.pinchZoom(1, 0.5, l) === 0.5);
  ok('fingers apart zooms in', Z.pinchZoom(1, 2, l) === 2);
  ok('IT STOPS AT THE WIDEST LENS — no amount of pinching invents a wider one',
    Z.pinchZoom(1, 0.01, l) === 0.5 && Z.pinchZoom(0.5, 0.1, l) === 0.5);
  ok('...and stops at the far end too', Z.pinchZoom(1, 100, l) === l.max);
  ok('a pinch that does not move changes nothing', Z.pinchZoom(0.8, 1, l) === 0.8);
  ok('nonsense scales are ignored rather than throwing',
    Z.pinchZoom(1, 0, l) === 1 && Z.pinchZoom(1, NaN, l) === 1 && Z.pinchZoom(1, -3, l) === 1);
  ok('a nonsense starting point falls back to the widest', Z.clampZoom(NaN, l) === 0.5);
}
{
  const l = Z.buildZoomLadder(ONE_CAM);
  ok('ON A PHONE WITH NO ULTRA-WIDE, PINCHING OUT HONESTLY DOES NOTHING',
    Z.pinchZoom(1, 0.2, l) === 1, 'got ' + Z.pinchZoom(1, 0.2, l));
}

console.log('\nwhich lens opens, and how much cropping on top\n');
{
  const l = Z.buildZoomLadder(IPHONE);
  {
    const d = Z.deviceForZoom(l, 0.5);
    ok('0.5x opens the ultra-wide with no cropping', d.deviceId === 'backuw' && d.digital === 1, JSON.stringify(d));
  }
  {
    const d = Z.deviceForZoom(l, 0.7);
    ok('0.7x OPENS THE ULTRA-WIDE AND CROPS UP — the 1x lens could not produce this view at all',
      d.deviceId === 'backuw' && Math.abs(d.digital - 1.4) < 1e-9, JSON.stringify(d));
  }
  {
    const d = Z.deviceForZoom(l, 1);
    ok('1x opens the ordinary back camera', d.deviceId === 'back1' && d.digital === 1, JSON.stringify(d));
  }
  {
    const d = Z.deviceForZoom(l, 2);
    ok('2x crops the 1x lens when there is no telephoto', d.deviceId === 'back1' && d.digital === 2, JSON.stringify(d));
  }
  ok('asking for less than the widest lens is clamped, not honoured',
    Z.deviceForZoom(l, 0.1).digital === 1 && Z.deviceForZoom(l, 0.1).zoom === 0.5);
  ok('CROPPING NEVER GOES BELOW 1 — that would be inventing picture',
    [0.1, 0.5, 0.9, 1, 2, 99].every(z => Z.deviceForZoom(l, z).digital >= 1));
}
{
  const l = Z.buildZoomLadder([vid('t', 'Back Telephoto Camera'), vid('u', 'Back Ultra Wide Camera'), vid('b', 'Back Camera')]);
  ok('with a telephoto present, 2x uses the real glass instead of cropping',
    Z.deviceForZoom(l, 2).deviceId === 't' && Z.deviceForZoom(l, 2).digital === 1);
  ok('...and 1.5x still uses the 1x lens, cropped', Z.deviceForZoom(l, 1.5).deviceId === 'b');
}
ok('no ladder at all does not throw', Z.deviceForZoom(null, 1).digital === 1);

console.log('\nthe crop itself\n');
{
  const r = Z.cropRect(1920, 1080, 1);
  ok('no zoom keeps the whole frame', r.sx === 0 && r.sy === 0 && r.sw === 1920 && r.sh === 1080);
}
{
  const r = Z.cropRect(1920, 1080, 2);
  ok('2x keeps the middle half, centred', r.sw === 960 && r.sh === 540 && r.sx === 480 && r.sy === 270, JSON.stringify(r));
}
ok('a crop below 1 is refused rather than stretching the frame',
  Z.cropRect(100, 100, 0.5).sw === 100 && Z.cropRect(100, 100, 0).sw === 100);
ok('cropRect survives junk', Z.cropRect(0, 0, 2).sw === 0 && Z.cropRect(null, null, NaN).sw === 0);

console.log('\nwhat the buttons say\n');
{
  const l = Z.buildZoomLadder(IPHONE);
  ok('an iPhone shows 0.5, 1 and 2', JSON.stringify(Z.buttonStops(l)) === JSON.stringify([0.5, 1, 2]), JSON.stringify(Z.buttonStops(l)));
}
{
  const l = Z.buildZoomLadder([vid('t', 'Back Telephoto Camera'), vid('b', 'Back Camera')]);
  ok('2x is not offered twice when a telephoto already provides it',
    JSON.stringify(Z.buttonStops(l)) === JSON.stringify([1, 2]), JSON.stringify(Z.buttonStops(l)));
}
ok('labels are readable, never floating-point noise',
  Z.labelFor(0.5) === '0.5×' && Z.labelFor(1) === '1×' && Z.labelFor(2) === '2×' &&
  Z.labelFor(1.4000000001) === '1.4×' && Z.labelFor(0.9999999) === '1×',
  [Z.labelFor(0.5), Z.labelFor(1), Z.labelFor(1.4000000001), Z.labelFor(0.9999999)].join(' '));
ok('a junk label does not print NaN', Z.labelFor(null) === '1×' && Z.labelFor(undefined) === '1×');

/* ══ THE CAMERA USES IT ══════════════════════════════════════════════════════ */
console.log('\nthe camera is wired to it\n');
const fs = require('fs'), path = require('path');
const CAM = fs.readFileSync(path.join(__dirname, 'guided-camera.js'), 'utf8');
const CONTACT = fs.readFileSync(path.join(__dirname, '..', 'contact.html'), 'utf8');
const ESTIMATE = fs.readFileSync(path.join(__dirname, '..', 'estimate.html'), 'utf8');

ok('the camera builds a ladder from the real device list', /enumerateDevices/.test(CAM) && /buildZoomLadder/.test(CAM));
ok('...only after the stream is live, because labels are empty before permission',
  CAM.indexOf('getUserMedia') < CAM.lastIndexOf('enumerateDevices'));
ok('pinch gestures are handled', /touchstart/.test(CAM) && /touchmove/.test(CAM) && /pinchZoom/.test(CAM));
ok('the captured photo is cropped to what they were shown', /cropRect/.test(CAM));
ok('THE COACH READS THE ZOOMED FRAME, not the raw sensor — or it would argue with a view they cannot see',
  /cropRect\(vw, vh, [\s\S]{0,40}\)[\s\S]{0,400}drawImage\(video, [a-z.]+\.sx/.test(CAM) ||
  /analyseCrop/.test(CAM), 'no evidence the analysis path crops');
ok('both pages load it',
  /<script src="js\/camera-zoom\.js"><\/script>/.test(CONTACT) && /<script src="js\/camera-zoom\.js"><\/script>/.test(ESTIMATE));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
