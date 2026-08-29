/* js/guided-camera.js — the viewfinder, with a coach under it.
 *
 *   "where is it second photo camera move close or move out"
 *
 * WHY THIS EXISTS AS A SEPARATE CAMERA AT ALL.
 *
 * Tapping "Take Photo" on a file input opens the phone's OWN camera app. That is
 * a different program. This page cannot see its preview, cannot draw on it, and
 * cannot say a word to the person holding it. That is the whole reason a bank
 * check scanner has to be a native app — and the reason this has to open a
 * camera inside the page instead of borrowing the system one.
 *
 * WHAT IT KNOWS THAT A GENERIC OVERLAY COULD NOT.
 *
 * Which shot is being taken. The customer tapped "The whole room" or "Close-up"
 * before this opened, so "step back" and "move closer" — opposite instructions —
 * can each be given at the right moment. Without the named shots from phase one
 * there would be no way to know which one to say, and this feature could not
 * exist. See js/camera-coach.js for what the frame analysis can and cannot do.
 *
 * ── EVERY WAY THIS IS ALLOWED TO FAIL ───────────────────────────────────────
 * All of them end the same way: the ordinary file picker opens and the customer
 * carries on as if none of this existed.
 *
 *   - getUserMedia missing entirely (older browsers)
 *   - the page is not on https (the API is simply absent)
 *   - permission denied, or dismissed
 *   - NO CAMERA AT ALL — a desktop, which is where the contractor himself will
 *     test this first
 *   - the Instagram and Facebook in-app browsers, which a great many customers
 *     arrive through and which have historically refused camera access outright
 *   - anything thrown anywhere in here
 *
 * A lead must never be lost to a clever camera. The fallback is not an edge case
 * in this file; it is the main case, and everything else is the improvement.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) Object.keys(api).forEach(function (k) { root[k] = api[k]; });
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  /* Is an in-page camera even possible here? Asked without prompting for
     permission — that only happens once they tap a tile. */
  function cameraAvailable() {
    try {
      return !!(typeof navigator !== "undefined" &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === "function" &&
        typeof document !== "undefined" &&
        typeof document.createElement === "function");
    } catch (e) { return false; }
  }

  var ANALYSE_W = 160, ANALYSE_H = 120;
  var TICK_MS = 260;          /* four reads a second: responsive, not hot */
  var CAPTURE_MAX_W = 1600;   /* same as the rest of the upload path */

  function el(tag, css, html) {
    var n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /**
   * Open the camera for one named shot.
   *
   * @param {object} opts
   *   slot      — "wide" | "area" | "close" | "scale"
   *   label     — what to call it on screen
   *   hint      — the standing instruction for this shot
   *   onPhoto   — called with a JPEG data URI when they keep one
   *   onFallback— called when the camera cannot be used, for any reason at all
   */
  function openGuidedCamera(opts) {
    opts = opts || {};
    var fellBack = false;
    function fallback(why) {
      if (fellBack) return;
      fellBack = true;
      try { teardown(); } catch (e) {}
      /* Deliberately quiet. The customer does not need to hear about
         NotAllowedError; they need the ordinary picker to open. */
      if (typeof console !== "undefined" && why) console.log("guided camera unavailable:", why);
      if (typeof opts.onFallback === "function") opts.onFallback(why);
    }

    if (!cameraAvailable()) { fallback("unsupported"); return; }

    var stream = null, timer = null, closed = false;

    var wrap = el("div", "position:fixed;inset:0;z-index:99999;background:#000;display:flex;" +
      "flex-direction:column;font-family:'DM Sans',system-ui,sans-serif;color:#fff");

    var head = el("div", "display:flex;align-items:center;justify-content:space-between;gap:12px;" +
      "padding:14px 16px;background:rgba(0,0,0,.85);flex-shrink:0");
    var title = el("div", "font-size:15px;font-weight:700", esc(opts.label || "Take a photo"));
    var closeBtn = el("button", "background:none;border:none;color:#fff;font-size:26px;line-height:1;" +
      "cursor:pointer;padding:0 4px", "&times;");
    closeBtn.setAttribute("aria-label", "Close");
    head.appendChild(title); head.appendChild(closeBtn);

    var stage = el("div", "position:relative;flex:1;overflow:hidden;background:#000");
    var video = document.createElement("video");
    video.setAttribute("playsinline", "");     /* or iOS takes the video fullscreen */
    video.setAttribute("webkit-playsinline", "");
    video.muted = true; video.autoplay = true;
    /* CONTAIN, NOT COVER. The stage is a tall portrait box and the camera feed is
       landscape, so `cover` filled it by throwing away the left and right of the
       sensor — the viewfinder showed LESS of the room than the phone's own camera
       app does at 1x, which is the opposite of the point in a small bathroom.
       Worse, the capture used the full frame, so what was framed was not what was
       taken. `contain` shows the entire field of view the lens is giving us, and
       the photo then matches the preview exactly. */
    video.style.cssText = "width:100%;height:100%;object-fit:contain;display:block;background:#000";
    stage.appendChild(video);

    /* A frame to shoot into. Purely a guide — it crops nothing. */
    var reticle = el("div", "position:absolute;left:6%;top:8%;right:6%;bottom:8%;" +
      "border:2px solid rgba(255,255,255,.55);border-radius:10px;pointer-events:none");
    stage.appendChild(reticle);

    var hint = el("div", "position:absolute;left:0;right:0;top:0;padding:10px 16px;" +
      "background:linear-gradient(rgba(0,0,0,.6),transparent);font-size:12.5px;line-height:1.45;" +
      "color:rgba(255,255,255,.9);pointer-events:none", esc(opts.hint || ""));
    stage.appendChild(hint);

    /* THE COACH LINE. */
    var coach = el("div", "position:absolute;left:12px;right:12px;bottom:12px;padding:11px 14px;" +
      "border-radius:11px;font-size:14px;font-weight:700;text-align:center;background:rgba(0,0,0,.72);" +
      "backdrop-filter:blur(3px);pointer-events:none;transition:background .18s,color .18s", "Starting camera…");
    stage.appendChild(coach);

    /* ── ZOOM ─────────────────────────────────────────────────────────────────
       "If room is to small and they have to take pictures for whole room let
        them zoom out by fingers touching"
       In a Brooklyn bathroom there is nowhere to step back to, so "step back"
       has to come with a way to obey it. Wider can only come from a WIDER LENS —
       see js/camera-zoom.js — so this switches to the 0.5x ultra-wide rather
       than scaling anything. Hidden entirely on a phone that has only one lens
       and nothing to offer. */
    var zoomBar = el("div", "position:absolute;left:0;right:0;bottom:64px;display:none;" +
      "justify-content:center;gap:8px;pointer-events:auto");
    stage.appendChild(zoomBar);

    var foot = el("div", "display:flex;align-items:center;justify-content:space-between;gap:14px;" +
      "padding:16px 22px 22px;background:rgba(0,0,0,.9);flex-shrink:0");
    /* Always available, always: some people simply have the photo already. */
    var libBtn = el("button", "background:none;border:none;color:rgba(255,255,255,.75);font-size:12.5px;" +
      "cursor:pointer;padding:6px;text-align:left;max-width:96px;line-height:1.35", "Choose from library");
    var shutter = el("button", "width:70px;height:70px;border-radius:50%;background:#fff;border:5px solid rgba(255,255,255,.35);" +
      "cursor:pointer;flex-shrink:0;padding:0");
    shutter.setAttribute("aria-label", "Take photo");
    var spacer = el("div", "width:96px");
    foot.appendChild(libBtn); foot.appendChild(shutter); foot.appendChild(spacer);

    wrap.appendChild(head); wrap.appendChild(stage); wrap.appendChild(foot);

    /* Off-screen canvas the frames are read through. */
    var scratch = document.createElement("canvas");
    scratch.width = ANALYSE_W; scratch.height = ANALYSE_H;
    var sctx = scratch.getContext("2d", { willReadFrequently: true });

    var lastCoach = null;
    function paintCoach(c) {
      if (lastCoach && c.text === lastCoach.text) return;
      lastCoach = c;
      coach.textContent = c.text;
      coach.style.background = c.state === "good" ? "rgba(28,132,60,.88)"
        : c.state === "bad" ? "rgba(176,42,42,.9)"
        : "rgba(0,0,0,.72)";
    }

    function tick() {
      if (closed) return;
      try {
        if (video.readyState >= 2 && video.videoWidth) {
          /* THE COACH READS WHAT THEY ARE LOOKING AT, cropped exactly as the
             preview is. Reading the raw sensor instead would have it arguing
             about a view the person cannot see — telling somebody zoomed out to
             0.5x, with the whole room in frame, that they are too close. */
          var c = analyseCrop(video.videoWidth, video.videoHeight);
          sctx.drawImage(video, c.sx, c.sy, c.sw, c.sh, 0, 0, ANALYSE_W, ANALYSE_H);
          var d = sctx.getImageData(0, 0, ANALYSE_W, ANALYSE_H).data;
          var gray = toGrayLocal(d, ANALYSE_W * ANALYSE_H);
          paintCoach(coachForLocal(opts.slot, frameStatsLocal(gray, ANALYSE_W, ANALYSE_H)));
        }
      } catch (e) {
        /* A frame that cannot be read is not a reason to end anything — the
           shutter still works and the photo is still what matters. */
      }
    }

    /* ── the zoom state ─────────────────────────────────────────────────── */
    var ladder = null;      /* built once the stream is live and labels exist */
    var zoom = 1;           /* what the person asked for, across all lenses */
    var digital = 1;        /* the crop on top of whichever lens is open */
    var switching = false;

    function analyseCrop(vw, vh) {
      return (typeof cropRect === "function")
        ? cropRect(vw, vh, digital)
        : { sx: 0, sy: 0, sw: vw, sh: vh };
    }

    /* Cropping shown in the preview. The video element is scaled up and the
       stage clips it, which is the same picture the capture will produce. */
    function paintZoom() {
      try {
        video.style.transform = digital > 1 ? "scale(" + digital + ")" : "";
        video.style.transformOrigin = "center center";
      } catch (e) {}
      if (!ladder || !zoomBar.children.length) return;
      for (var i = 0; i < zoomBar.children.length; i++) {
        var b = zoomBar.children[i];
        var on = Math.abs(Number(b.__stop) - zoom) < 0.001;
        b.style.background = on ? "rgba(255,255,255,.92)" : "rgba(0,0,0,.55)";
        b.style.color = on ? "#000" : "#fff";
        b.textContent = (typeof labelFor === "function") ? labelFor(b.__stop) : String(b.__stop);
      }
    }

    /* Go to a zoom level: open a different lens if this one cannot reach it,
       then crop the rest of the way. */
    function applyZoom(z) {
      if (!ladder || switching) return;
      var want = (typeof deviceForZoom === "function") ? deviceForZoom(ladder, z) : null;
      if (!want) return;
      zoom = want.zoom;
      var sameLens = currentDeviceId === want.deviceId || !want.deviceId;
      digital = want.digital;
      paintZoom();
      if (sameLens) return;

      /* A different piece of glass. iOS allows only one camera at a time, so the
         old track has to be stopped before the new one is asked for. */
      switching = true;
      var oldStream = stream;
      navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: want.deviceId } },
        audio: false,
      }).then(function (s) {
        switching = false;
        if (closed) { try { s.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} return; }
        try { if (oldStream) oldStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        stream = s;
        currentDeviceId = want.deviceId;
        try { video.srcObject = s; var p = video.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
        paintZoom();
      }, function () {
        /* The lens would not open. Stay where we are rather than ending up with
           no camera at all — the previous stream was never stopped. */
        switching = false;
        zoom = lastGoodZoom;
        digital = lastGoodDigital;
        paintZoom();
      });
      lastGoodZoom = zoom; lastGoodDigital = digital;
    }
    var currentDeviceId = "";
    var lastGoodZoom = 1, lastGoodDigital = 1;

    /* Built after permission is granted — before that every label is "". */
    function buildZoomUi() {
      if (typeof buildZoomLadder !== "function") return;
      var enumerate = navigator.mediaDevices && navigator.mediaDevices.enumerateDevices;
      if (typeof enumerate !== "function") return;
      navigator.mediaDevices.enumerateDevices().then(function (devices) {
        if (closed) return;
        ladder = buildZoomLadder(devices);
        try {
          var track = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
          var settings = track && track.getSettings && track.getSettings();
          if (settings && settings.deviceId) currentDeviceId = settings.deviceId;
        } catch (e) {}

        /* ── WHEN THIS CAMERA CANNOT GO WIDE ENOUGH ────────────────────────────
           iOS does not reliably hand a web page the 0.5x ultra-wide as its own
           device, so on most iPhones this ladder starts at 1x. The phone's OWN
           camera app has that lens and its 0.5x button fits a whole small room
           in one frame — which is the entire thing being asked for here.
           Pretending otherwise, or offering a 2x button to somebody who needs to
           get WIDER, is worse than useless. So say it plainly and hand over. */
        if (!ladder.canZoomOut) {
          zoomBar.innerHTML = "";
          var wide = el("button", "padding:9px 15px;border:none;border-radius:999px;font-size:12px;" +
            "font-weight:700;cursor:pointer;background:rgba(255,255,255,.92);color:#111;max-width:86%;line-height:1.3",
            "Room too small? Use your phone camera at 0.5×");
          wide.onclick = function (ev) {
            if (ev && ev.stopPropagation) ev.stopPropagation();
            teardown();
            if (typeof opts.onFallback === "function") opts.onFallback("library");
          };
          zoomBar.appendChild(wide);
          zoomBar.style.display = "flex";
          return;
        }

        var stops = (typeof buttonStops === "function") ? buttonStops(ladder) : [1];
        /* Nothing to offer: one lens, no wider view to reach. Showing a dead
           control would be worse than showing none. */
        if (stops.length < 2) return;
        zoomBar.innerHTML = "";
        stops.forEach(function (st) {
          var b = el("button", "min-width:46px;padding:7px 10px;border:none;border-radius:999px;" +
            "font-size:12.5px;font-weight:700;cursor:pointer;background:rgba(0,0,0,.55);color:#fff");
          b.__stop = st;
          b.onclick = function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); applyZoom(st); };
          zoomBar.appendChild(b);
        });
        zoomBar.style.display = "flex";
        paintZoom();
      }, function () {});
    }

    /* ── pinch ──────────────────────────────────────────────────────────── */
    var pinchFrom = 0, pinchZoomFrom = 1;
    function spread(t) {
      var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }
    stage.addEventListener("touchstart", function (e) {
      if (!e.touches || e.touches.length !== 2) return;
      pinchFrom = spread(e.touches);
      pinchZoomFrom = zoom;
    }, { passive: true });
    stage.addEventListener("touchmove", function (e) {
      if (!e.touches || e.touches.length !== 2 || !pinchFrom || !ladder) return;
      if (e.preventDefault) e.preventDefault();   /* or the page pinch-zooms instead */
      var now = spread(e.touches);
      if (!now) return;
      var next = (typeof pinchZoom === "function")
        ? pinchZoom(pinchZoomFrom, now / pinchFrom, ladder) : zoom;
      /* Only act on a real change: switching lens on every pixel of movement
         would thrash the camera. */
      if (Math.abs(next - zoom) > 0.02) applyZoom(next);
    }, { passive: false });
    stage.addEventListener("touchend", function () { pinchFrom = 0; }, { passive: true });

    function teardown() {
      closed = true;
      if (timer) { clearInterval(timer); timer = null; }
      try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      stream = null;
      try { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); } catch (e) {}
      try { document.body.style.overflow = prevOverflow; } catch (e) {}
    }

    closeBtn.onclick = function () { teardown(); };
    libBtn.onclick = function () {
      /* Not a failure — a deliberate choice. Same exit either way. */
      teardown();
      if (typeof opts.onFallback === "function") opts.onFallback("library");
    };

    shutter.onclick = function () {
      /* THE SHUTTER IS NEVER BLOCKED, whatever the coach thinks of the frame. */
      try {
        var vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh) return;
        /* WHAT THEY FRAMED IS WHAT THEY GET. The preview is cropped by the
           zoom, so the saved photo has to be cropped identically — otherwise
           somebody carefully frames a room at 1.4x and receives a wider,
           different picture. */
        var c = analyseCrop(vw, vh);
        var w = Math.min(c.sw, CAPTURE_MAX_W);
        var h = Math.round(c.sh * (w / c.sw));
        var out = document.createElement("canvas");
        out.width = w; out.height = h;
        out.getContext("2d").drawImage(video, c.sx, c.sy, c.sw, c.sh, 0, 0, w, h);
        var data = out.toDataURL("image/jpeg", 0.85);
        teardown();
        if (typeof opts.onPhoto === "function") opts.onPhoto(data);
      } catch (e) {
        fallback("capture failed: " + (e && e.message));
      }
    };

    var prevOverflow = "";
    try {
      prevOverflow = document.body.style.overflow;
      document.body.appendChild(wrap);
      document.body.style.overflow = "hidden";
    } catch (e) { fallback("cannot open"); return; }

    /* The back camera, please. `ideal` rather than `exact` so a device with only
       a front camera still opens one instead of throwing. */
    var ask;
    try {
      ask = navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
    } catch (e) { fallback("getUserMedia threw"); return; }

    if (!ask || typeof ask.then !== "function") { fallback("no promise"); return; }

    ask.then(function (s) {
      if (closed) { try { s.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} return; }
      stream = s;
      try { video.srcObject = s; } catch (e) { fallback("cannot attach"); return; }
      var p = video.play();
      if (p && typeof p.catch === "function") p.catch(function () {});
      paintCoach({ state: "warn", text: opts.startText || "Line up your shot" });
      /* Only now: before permission is granted every camera label is an empty
         string, so the ultra-wide is indistinguishable from the rest. */
      try { buildZoomUi(); } catch (e) {}
      timer = setInterval(tick, TICK_MS);
    }, function (err) {
      /* Denied, dismissed, no camera, or blocked by an in-app browser. All the
         same from here: open the ordinary picker. */
      fallback((err && err.name) || "denied");
    });
  }

  /* These are the functions from camera-coach.js. Read off the global the way
     the browser exposes them, and re-checked at call time rather than captured,
     so load order between the two files cannot matter. If the coach is somehow
     absent the camera still works — it simply stops giving advice, which is a
     far better failure than not opening. */
  function frameStatsLocal(g, w, h) {
    return (typeof frameStats === "function")
      ? frameStats(g, w, h)
      : { ok: false, brightness: 0, sharpness: 0, edgeRatio: 0, lineScore: 1 };
  }
  function coachForLocal(slot, stats) {
    return (typeof coachFor === "function")
      ? coachFor(slot, stats)
      : { state: "warn", text: "Line up your shot" };
  }
  function toGrayLocal(rgba, n) {
    if (typeof toGray === "function") return toGray(rgba, n);
    var g = new Array(n);
    for (var i = 0; i < n; i++) g[i] = rgba[i * 4];
    return g;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  return {
    cameraAvailable: cameraAvailable,
    openGuidedCamera: openGuidedCamera,
  };
});
