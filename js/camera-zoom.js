/* js/camera-zoom.js — how far out this phone can actually see.
 *
 *   "Can we add zoom in / out when cameras is on for let them take full room
 *    pictures as possible? If room is to small and they have to take pictures
 *    for whole room let them zoom out by fingers touching"
 *
 * THE HOLE THIS FILLS. The coach says "step back until the whole room fits in".
 * In a Brooklyn bathroom there is nowhere to step back TO. You are already
 * against the door with your heels on the threshold, and the advice is useless —
 * worse than useless, because now the form is nagging somebody who is doing
 * everything right.
 *
 * ── THE ONE HARD LIMIT, SAID PLAINLY ────────────────────────────────────────
 *
 * You cannot digitally zoom OUT. Zooming in is cropping — throw away the edges
 * and enlarge what is left. Zooming out would mean inventing scene that the lens
 * never captured, and no amount of software does that.
 *
 * So a wider view can only come from a WIDER LENS. On an iPhone that is the
 * 0.5x ultra-wide, which is a physically separate camera the browser exposes as
 * its own device. Getting a small bathroom into one frame means switching to it
 * — not scaling anything.
 *
 * Which means this file is mostly about reading the list of cameras a phone
 * offers and working out how wide each one goes:
 *
 *   "Back Ultra Wide Camera"  → 0.5x   ← the one that saves the small bathroom
 *   "Back Camera"             → 1x
 *   "Back Dual Wide Camera"   → 1x     (contains "Wide", is NOT the ultra-wide)
 *   "Back Telephoto Camera"   → 2x
 *
 * A phone with no ultra-wide simply cannot go below 1x, and the pinch stops
 * there rather than pretending. Labels only appear after camera permission is
 * granted, so this can only be built once the stream is already running.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) Object.keys(api).forEach(function (k) { root[k] = api[k]; });
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  /* How far in cropping is allowed to go past the longest real lens before the
     picture stops being worth anything. Zooming in is never the point here —
     the whole feature is about getting wider — so this stays modest. */
  var MAX_DIGITAL = 3;

  /**
   * What kind of back camera is this, by its label?
   * Returns its widest-angle factor, or null if it is not a back camera at all.
   */
  function classifyCamera(label) {
    var l = String(label == null ? "" : label).toLowerCase();
    /* The front camera must never join the ladder: pinching wide in a bathroom
       and getting your own face is a bug people would remember. */
    if (/front|face|selfie|user/.test(l)) return null;
    /* Checked before the plain "wide" test — "Back Dual Wide Camera" is an
       ordinary 1x lens and only "Ultra Wide" is the 0.5x one. */
    if (/ultra/.test(l)) return 0.5;
    if (/tele|telephoto/.test(l)) return 2;
    return 1;
  }

  /* The camera list a phone hands over, turned into the stops a person can
     actually reach. `devices` is whatever enumerateDevices() returned. */
  function buildZoomLadder(devices) {
    var list = Array.isArray(devices) ? devices : [];
    var byFactor = {};
    list.forEach(function (d) {
      if (!d || d.kind !== "videoinput") return;
      var f = classifyCamera(d.label);
      if (f === null) return;
      /* First one at a given factor wins — phones list several composites and
         any of them opens the same glass. */
      if (!byFactor[f]) byFactor[f] = d.deviceId || "";
    });

    var stops = Object.keys(byFactor).map(Number).sort(function (a, b) { return a - b; });
    /* A device that told us nothing — no labels, permission not yet granted, a
       desktop webcam — still gets a usable 1x ladder rather than nothing. */
    if (!stops.length) { stops = [1]; byFactor[1] = ""; }

    return {
      stops: stops,
      deviceFor: byFactor,
      /* THE FLOOR IS A PIECE OF GLASS. No lens wider than this exists on the
         device, so neither does a wider picture. */
      min: stops[0],
      max: stops[stops.length - 1] * MAX_DIGITAL,
      /* Is there anything to offer at all? One lens and no crop range means no
         pinch control worth showing. */
      canZoomOut: stops.length > 1,
    };
  }

  function clampZoom(z, ladder) {
    var n = Number(z);
    if (!isFinite(n)) return ladder ? ladder.min : 1;
    if (!ladder) return n;
    return Math.min(ladder.max, Math.max(ladder.min, n));
  }

  /* A pinch multiplies the zoom it started from. Fingers apart (scale > 1) zooms
     in; fingers together zooms out, down to the widest lens and no further. */
  function pinchZoom(startZoom, scale, ladder) {
    var s = Number(scale);
    if (!isFinite(s) || s <= 0) s = 1;
    return clampZoom(Number(startZoom) * s, ladder);
  }

  /**
   * Which physical camera, and how much cropping on top, for a requested zoom.
   *
   * Always the WIDEST lens at or below what was asked for, then crop up to it.
   * Asking for 0.7x on a phone with an ultra-wide opens the 0.5x lens and crops
   * to 1.4 — which is a real 0.7x view. Doing it the other way round, opening
   * the 1x lens, could not produce it at all.
   */
  function deviceForZoom(ladder, z) {
    if (!ladder) return { factor: 1, deviceId: "", digital: 1 };
    var want = clampZoom(z, ladder);
    var base = ladder.stops[0];
    for (var i = 0; i < ladder.stops.length; i++) {
      if (ladder.stops[i] <= want + 1e-9) base = ladder.stops[i];
    }
    return {
      factor: base,
      deviceId: ladder.deviceFor[base] || "",
      /* Never below 1: cropping is the only tool here and it cannot widen. */
      digital: Math.max(1, want / base),
      zoom: want,
    };
  }

  /* The part of the frame a given crop actually keeps. Used for the captured
     photo AND for the frame the coach reads, so its advice matches what the
     person is looking at rather than the uncropped sensor. */
  function cropRect(vw, vh, digital) {
    var w = Number(vw) || 0, h = Number(vh) || 0;
    var d = Number(digital);
    if (!isFinite(d) || d <= 1) return { sx: 0, sy: 0, sw: w, sh: h };
    var sw = w / d, sh = h / d;
    return { sx: (w - sw) / 2, sy: (h - sh) / 2, sw: sw, sh: sh };
  }

  /* The stops worth putting on screen as tappable buttons — the real lenses,
     plus 2x if cropping can reach it and no lens already sits there. */
  function buttonStops(ladder) {
    if (!ladder) return [1];
    var out = ladder.stops.slice();
    if (out.indexOf(2) === -1 && ladder.max >= 2) out.push(2);
    return out.sort(function (a, b) { return a - b; });
  }

  /* "0.5x", "1x", "1.7x" — never "0.5000000001x". */
  function labelFor(z) {
    var n = Number(z) || 1;
    var r = Math.round(n * 10) / 10;
    return (Math.abs(r - Math.round(r)) < 0.05 ? String(Math.round(r)) : String(r)) + "×";
  }

  return {
    MAX_DIGITAL: MAX_DIGITAL,
    classifyCamera: classifyCamera,
    buildZoomLadder: buildZoomLadder,
    clampZoom: clampZoom,
    pinchZoom: pinchZoom,
    deviceForZoom: deviceForZoom,
    cropRect: cropRect,
    buttonStops: buttonStops,
    labelFor: labelFor,
  };
});
