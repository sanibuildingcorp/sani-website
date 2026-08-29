/* js/camera-coach.js — reading a camera frame well enough to say "step back".
 *
 *   "where is it second photo camera move close or move out"
 *
 * WHAT THIS CAN AND CANNOT DO, PLAINLY.
 *
 * It cannot measure distance. Nothing in a phone browser can tell you that the
 * lens is 14 inches from a wall — there is no depth sensor exposed to a web page
 * and no reference of known size in the frame.
 *
 * What it CAN do is tell a picture of a ROOM apart from a picture of a SURFACE,
 * and that turns out to be the same question in practice. Look at the difference:
 *
 *   A room shot from a doorway has long, continuous, straight edges — where the
 *   wall meets the floor, the door frame, the ceiling line, the edge of a vanity.
 *   Those run right across the frame.
 *
 *   A close-up of a cracked tile has none. It is one flat surface. It may be
 *   busy with texture — grout lines, speckle, stains — but that texture is spread
 *   evenly everywhere and no single line crosses the picture.
 *
 * So the frame is scored on how much of its edge energy collects into a few long
 * lines rather than spreading evenly. High means structure, means a room. Low
 * means one surface filling the lens, means too close for a wide shot.
 *
 * THE OTHER HALF: it knows which shot is being taken, because the customer tapped
 * a tile before the camera opened. "Move closer" and "step back" are opposite
 * advice and the difference is entirely which of the four they asked for. That is
 * the thing a generic camera overlay could never do, and it is the reason the
 * named shots had to come first.
 *
 * THE RULE THIS OBEYS: the guidance NEVER blocks the shutter. It is a sentence
 * under the viewfinder, and the button always works. Many customers do not know
 * what they are looking at, and a camera that argues with somebody standing in
 * their own bathroom is worse than a slightly wrong photo.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) Object.keys(api).forEach(function (k) { root[k] = api[k]; });
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  /* All tuned against downscaled frames, roughly 160x120. Named and gathered
     here because they are heuristics, not laws, and whoever tunes them next
     should be able to find them in one place. */
  var TUNING = {
    DARK: 42,           /* mean luma below this and nothing else can be trusted */
    BRIGHT: 240,        /* blown out — usually a window behind the subject */
    EDGE_AT: 18,        /* gradient magnitude that counts as an edge */
    BLUR_BELOW: 7,      /* Laplacian variance below this reads as soft */

    /* ── THE TWO THAT DECIDE "STEP BACK" ────────────────────────────────────
       These are a band with a DELIBERATE GAP IN THE MIDDLE, not a single line.

       Measured against constructed frames: a furnished room from a doorway
       scores about 13, a tile close-up about 5, a flat wall about 3, pure
       texture about 1.2. So the two ends are well separated — but those are
       constructed frames, not photographs of anyone's actual bathroom, and a
       single threshold splitting 5 from 13 would be a guess wearing the costume
       of a measurement.

       So the middle is silent. Below SURFACE_BELOW the lens is unambiguously
       filled with one surface; above SCENE_ABOVE they are unambiguously standing
       back looking at a scene; in between the coach says nothing about distance
       and lets the person decide. A camera that argues with somebody standing in
       their own bathroom is worse than one that keeps quiet, so when this is
       unsure it is quiet. */
    SURFACE_BELOW: 5.5,
    SCENE_ABOVE: 9.5,
  };

  function clampByte(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }

  /* Frame statistics. `gray` is any array-like of 0-255 luma, row-major, w by h.
     Kept free of canvas and DOM so it can be run against made-up frames in a
     test instead of only against a real bathroom. */
  function frameStats(gray, w, h) {
    var n = w * h;
    if (!gray || !w || !h || n < 16 || gray.length < n) {
      return { ok: false, brightness: 0, sharpness: 0, edgeRatio: 0, lineScore: 1 };
    }

    var sum = 0, i;
    for (i = 0; i < n; i++) sum += gray[i];
    var brightness = sum / n;

    /* Row and column edge energy. A long horizontal line is a change ACROSS y,
       so it lands in one row; a door frame is a change across x, in one column. */
    var rowE = new Array(h - 1), colE = new Array(w - 1);
    var y, x, d, acc;
    for (y = 0; y < h - 1; y++) {
      acc = 0;
      for (x = 0; x < w; x++) acc += Math.abs(gray[(y + 1) * w + x] - gray[y * w + x]);
      rowE[y] = acc / w;
    }
    for (x = 0; x < w - 1; x++) {
      acc = 0;
      for (y = 0; y < h; y++) acc += Math.abs(gray[y * w + x + 1] - gray[y * w + x]);
      colE[x] = acc / h;
    }

    /* Edge density, and the Laplacian variance that stands in for focus. */
    var edges = 0, lapSum = 0, lapSq = 0, lapN = 0;
    for (y = 1; y < h - 1; y++) {
      for (x = 1; x < w - 1; x++) {
        i = y * w + x;
        var gx = gray[i + 1] - gray[i - 1];
        var gy = gray[i + w] - gray[i - w];
        if (Math.abs(gx) + Math.abs(gy) > TUNING.EDGE_AT) edges++;
        var lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
        lapSum += lap; lapSq += lap * lap; lapN++;
      }
    }
    var lapMean = lapN ? lapSum / lapN : 0;
    var sharpness = lapN ? (lapSq / lapN) - (lapMean * lapMean) : 0;

    return {
      ok: true,
      brightness: brightness,
      sharpness: sharpness,
      edgeRatio: lapN ? edges / lapN : 0,
      /* THE ONE THAT MATTERS. Peak over mean: a frame whose edge energy is
         spread evenly (one flat surface) sits near 1. A frame with a few long
         lines crossing it (a room) climbs well above 2. */
      lineScore: Math.max(peakOverMean(rowE), peakOverMean(colE)),
    };
  }

  function peakOverMean(arr) {
    if (!arr || !arr.length) return 1;
    var sum = 0, max = 0;
    for (var i = 0; i < arr.length; i++) { sum += arr[i]; if (arr[i] > max) max = arr[i]; }
    var mean = sum / arr.length;
    /* A dead-flat frame — a lens cap, a blank white wall in even light — has no
       peak and no mean. It is not "structured"; it is nothing. */
    if (mean < 0.35) return 1;
    return max / mean;
  }

  /* What to say, for the shot they actually asked for.
     Returns { state, text } where state is "bad" | "warn" | "good". Nothing here
     ever returns "do not let them take it". */
  function coachFor(slot, stats) {
    if (!stats || !stats.ok) return { state: "warn", text: "Line up your shot" };

    /* Light first: in the dark, every other measurement is noise, so there is no
       honest way to say anything about framing. */
    if (stats.brightness < TUNING.DARK) {
      return { state: "bad", text: "Too dark — turn a light on if you can" };
    }
    if (stats.brightness > TUNING.BRIGHT) {
      return { state: "bad", text: "Too bright — try turning away from the window" };
    }
    /* Only judged once the light is decent: a dark frame is full of sensor noise,
       which reads as detail and would call a blurry shot sharp. */
    if (stats.sharpness < TUNING.BLUR_BELOW && stats.edgeRatio < 0.5) {
      return { state: "warn", text: "Hold still — it's still focusing" };
    }

    if (slot === "wide") {
      /* Unambiguously one surface filling the lens. This is the case the
         contractor complained about, and the only one worth interrupting for. */
      if (stats.lineScore < TUNING.SURFACE_BELOW) {
        return { state: "bad", text: "Too close — step back until the whole room fits in" };
      }
      if (stats.lineScore > TUNING.SCENE_ABOVE) {
        return { state: "good", text: "That's the whole room — take it" };
      }
      /* The silent middle: enough structure that they may well be framing the
         room properly, not enough to promise it. No distance advice. */
      return { state: "warn", text: "Check the far wall is in shot" };
    }

    if (slot === "close") {
      if (stats.lineScore > TUNING.SCENE_ABOVE) {
        return { state: "bad", text: "Move closer — fill the frame with the damage" };
      }
      if (stats.lineScore < TUNING.SURFACE_BELOW) {
        return { state: "good", text: "Close enough — take it" };
      }
      return { state: "warn", text: "A little closer if you can" };
    }

    if (slot === "area") {
      /* Wants the middle: the whole wall or floor, not the room and not the
         crack. Only the clearly-too-close end is called. */
      if (stats.lineScore < 2.2) {
        return { state: "warn", text: "Step back a little — get the whole wall or floor in" };
      }
      return { state: "good", text: "Good — take it" };
    }

    if (slot === "scale") {
      /* Genuinely undetectable: nothing in a frame says "that is a tape measure".
         So this is a reminder rather than a measurement, and it says so by never
         claiming the shot is right — only that the object has to be in it. */
      return { state: "warn", text: "Make sure the tape measure or dollar is in the shot" };
    }

    return { state: "good", text: "Take it when you're ready" };
  }

  /* Pull luma out of a canvas's RGBA buffer. Separate from frameStats so the
     statistics can be tested without a canvas anywhere near them. */
  function toGray(rgba, n) {
    var gray = new Array(n);
    for (var i = 0; i < n; i++) {
      var p = i * 4;
      /* Rec. 601 luma — cheap, and closer to perceived brightness than a mean. */
      gray[i] = clampByte((rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000);
    }
    return gray;
  }

  return {
    TUNING: TUNING,
    frameStats: frameStats,
    coachFor: coachFor,
    toGray: toGray,
  };
});
