/* guided-camera.test.js — run: node js/guided-camera.test.js
 *
 * The camera is the nice-to-have. THE FALLBACK IS THE FEATURE.
 *
 * A great many customers reach this form through the Instagram or Facebook
 * in-app browser, which has historically refused camera access outright. Others
 * deny the permission prompt, or dismiss it, or are on a desktop with no camera
 * at all — which is where the contractor himself will test it first. If any one
 * of those paths dead-ends, a person standing in their own bathroom taps "The
 * whole room", nothing happens, and the lead is gone. To save a photograph.
 *
 * So most of this file is about the ways it is allowed to fail, and it asserts
 * the same ending every time: the ordinary file picker opens.
 *
 * The other rule held here: THE SHUTTER IS NEVER BLOCKED. The coach is a
 * sentence under the viewfinder, never a locked button. A camera that argues
 * with somebody holding a phone in their own bathroom is worse than a slightly
 * badly framed photo.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* ── a browser, small enough to see through ─────────────────────────────── */
function mkbrowser(opts) {
  opts = opts || {};
  const made = [];
  function node(tag) {
    const n = {
      tagName: tag, style: { cssText: '', overflow: '' }, children: [], parentNode: null,
      innerHTML: '', textContent: '', muted: false, autoplay: false,
      readyState: opts.readyState === undefined ? 4 : opts.readyState,
      videoWidth: opts.videoWidth === undefined ? 1920 : opts.videoWidth,
      videoHeight: opts.videoHeight === undefined ? 1080 : opts.videoHeight,
      width: 0, height: 0, clicked: 0,
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; return c; },
      setAttribute() {}, click() { this.clicked++; },
      getContext() {
        return {
          drawImage() {},
          getImageData(x, y, w, h) {
            /* A frame that reads as one flat surface — the "too close" case. */
            const d = new Array(w * h * 4);
            for (let i = 0; i < w * h; i++) {
              const v = 170 + ((i * 37) % 9);
              d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
            }
            return { data: d };
          },
        };
      },
      toDataURL() { return 'data:image/jpeg;base64,CAPTURED'; },
      play() { return opts.playRejects ? Promise.reject(new Error('nope')) : Promise.resolve(); },
    };
    made.push(n);
    return n;
  }

  const body = node('body');
  const ctx = {
    console: { log() {}, error() {} },
    String, Number, Array, Object, Boolean, Math, JSON, Date, Promise, Error, RegExp,
    setInterval: (fn) => { ctx.__ticks.push(fn); return ctx.__ticks.length; },
    clearInterval: () => { ctx.__cleared = (ctx.__cleared || 0) + 1; },
  };
  ctx.__ticks = [];
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.document = { body: body, createElement: node };
  ctx.made = made;

  ctx.__stopped = 0;
  const stream = { getTracks: () => [{ stop() { ctx.__stopped++; } }] };
  ctx.__stream = stream;

  if (opts.noMediaDevices) {
    ctx.navigator = {};
  } else if (opts.getUserMediaThrows) {
    ctx.navigator = { mediaDevices: { getUserMedia() { throw new Error('boom'); } } };
  } else if (opts.notAPromise) {
    ctx.navigator = { mediaDevices: { getUserMedia() { return null; } } };
  } else if (opts.denied) {
    ctx.navigator = {
      mediaDevices: {
        getUserMedia() {
          const e = new Error('Permission denied'); e.name = 'NotAllowedError';
          return Promise.reject(e);
        },
      },
    };
  } else {
    ctx.navigator = { mediaDevices: { getUserMedia() { return Promise.resolve(stream); } } };
  }

  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'camera-coach.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'guided-camera.js'), 'utf8'), ctx);
  return ctx;
}

const open = (ctx, o) => vm.runInContext('openGuidedCamera(OPTS)', Object.assign(ctx, { OPTS: o }));
const settle = () => new Promise(r => setTimeout(r, 0));

(async function () {

console.log('\ncan we even open a camera here\n');
ok('a browser with no mediaDevices says no', mkbrowser({ noMediaDevices: true }).cameraAvailable() === false);
ok('a normal one says yes', mkbrowser().cameraAvailable() === true);
ok('asking does NOT prompt for permission — that only happens when they tap a tile',
  (function () {
    let asked = 0;
    const c = mkbrowser();
    c.navigator.mediaDevices.getUserMedia = function () { asked++; return Promise.resolve(c.__stream); };
    c.cameraAvailable();
    return asked === 0;
  })());

/* ══ EVERY FAILURE ENDS AT THE FILE PICKER ═══════════════════════════════════ */
console.log('\nevery way this fails, and where each one lands\n');

async function fallsBack(name, opts) {
  const c = mkbrowser(opts);
  let fellBack = 0, photo = null, why = null;
  open(c, { slot: 'wide', label: 'The whole room',
    onPhoto: (d) => { photo = d; },
    onFallback: (w) => { fellBack++; why = w; } });
  await settle(); await settle();
  ok(name, fellBack === 1 && photo === null, 'fellBack=' + fellBack + ' why=' + why);
  return c;
}

await fallsBack('an old browser with no getUserMedia falls back', { noMediaDevices: true });
await fallsBack('PERMISSION DENIED falls back — this is the common one', { denied: true });
await fallsBack('getUserMedia throwing outright falls back', { getUserMediaThrows: true });
await fallsBack('a browser returning something that is not a promise falls back', { notAPromise: true });

{
  /* The Instagram / Facebook in-app browsers: the API is present and rejects. */
  const c = mkbrowser({ denied: true });
  let fellBack = 0;
  open(c, { slot: 'wide', onFallback: () => fellBack++ });
  await settle(); await settle();
  ok('AN IN-APP BROWSER THAT BLOCKS THE CAMERA still reaches the picker', fellBack === 1);
  ok('...and the overlay is taken back off the page, not left covering the form',
    c.document.body.children.length === 0, 'children=' + c.document.body.children.length);
  ok('...and scrolling is given back', c.document.body.style.overflow === '');
}

{
  const c = mkbrowser({ denied: true });
  let n = 0;
  open(c, { slot: 'wide', onFallback: () => n++ });
  await settle(); await settle(); await settle();
  ok('the fallback fires exactly once, never twice', n === 1, 'fired ' + n);
}

/* ══ IT ACTUALLY WORKS ═══════════════════════════════════════════════════════ */
console.log('\nwhen the camera does open\n');
{
  const c = mkbrowser();
  let photo = null, fellBack = 0;
  open(c, { slot: 'wide', label: 'The whole room', hint: 'Stand in the doorway',
    onPhoto: (d) => { photo = d; }, onFallback: () => fellBack++ });
  await settle(); await settle();
  ok('the overlay goes on the page', c.document.body.children.length === 1);
  ok('...and it does not fall back', fellBack === 0);
  ok('the video is inline, or iOS hijacks the whole screen full-screen',
    c.made.some(n => n.tagName === 'video' && n.muted === true));
  ok('a coaching loop is running', c.__ticks.length === 1);

  /* Drive one frame through it. The stub frame is one flat surface. */
  c.__ticks[0]();
  const coachNode = c.made.find(n => typeof n.textContent === 'string' && /step back|whole room|dark|still|far wall/i.test(n.textContent));
  ok('IT READS THE FRAME AND SAYS "STEP BACK" ON A WIDE SHOT OF ONE FLAT SURFACE',
    !!coachNode && /step back/i.test(coachNode.textContent), coachNode && coachNode.textContent);

  /* The shutter, on a frame the coach just called wrong. */
  const shutter = c.made.find(n => n.tagName === 'button' && n.style.cssText.indexOf('border-radius:50%') !== -1);
  ok('there is a shutter', !!shutter);
  shutter.onclick();
  ok('THE SHUTTER WORKS ANYWAY — the coach advises, it never refuses', photo === 'data:image/jpeg;base64,CAPTURED', String(photo));
  ok('...and taking the photo shuts the camera down', c.__stopped === 1, 'stopped=' + c.__stopped);
  ok('...and takes the overlay off the page', c.document.body.children.length === 0);
}
{
  const c = mkbrowser();
  let photo = null, fellBack = 0;
  open(c, { slot: 'close', onPhoto: (d) => { photo = d; }, onFallback: () => fellBack++ });
  await settle(); await settle();
  c.__ticks[0]();
  const coachNode = c.made.find(n => typeof n.textContent === 'string' && /close enough|move closer/i.test(n.textContent));
  ok('THE SAME FRAME ON A CLOSE-UP IS APPROVED — opposite advice for the opposite shot',
    !!coachNode && /close enough/i.test(coachNode.textContent), coachNode && coachNode.textContent);
}
{
  const c = mkbrowser();
  let fellBack = 0, why = null;
  open(c, { slot: 'wide', onFallback: (w) => { fellBack++; why = w; } });
  await settle(); await settle();
  const lib = c.made.find(n => n.tagName === 'button' && /Choose from library/.test(n.innerHTML || ''));
  ok('there is always a way to just pick an existing photo', !!lib);
  lib.onclick();
  ok('...which closes the camera and opens the picker', fellBack === 1 && why === 'library');
  ok('...releasing the camera as it goes', c.__stopped === 1);
}
{
  const c = mkbrowser();
  open(c, { slot: 'wide', onFallback: () => {} });
  await settle(); await settle();
  const close = c.made.find(n => n.tagName === 'button' && n.innerHTML === '&times;');
  ok('there is a close button', !!close);
  close.onclick();
  ok('closing releases the camera rather than leaving it recording', c.__stopped === 1);
  ok('...and stops the coaching loop', c.__cleared >= 1);
  ok('...and does NOT count as a fallback — they chose to leave', c.document.body.children.length === 0);
}
{
  /* A video element that never gets going must not throw on every tick. */
  const c = mkbrowser({ readyState: 0, videoWidth: 0 });
  open(c, { slot: 'wide', onFallback: () => {} });
  await settle(); await settle();
  ok('a camera that has not started yet does not throw when read',
    (function () { try { c.__ticks[0](); c.__ticks[0](); return true; } catch (e) { return 'threw: ' + e.message; } })() === true);
  const shutter = c.made.find(n => n.tagName === 'button' && n.style.cssText.indexOf('border-radius:50%') !== -1);
  ok('...and the shutter on a dead frame does nothing rather than saving a blank',
    (function () { try { shutter.onclick(); return true; } catch (e) { return 'threw: ' + e.message; } })() === true);
}
{
  const c = mkbrowser({ playRejects: true });
  let fellBack = 0;
  open(c, { slot: 'wide', onFallback: () => fellBack++ });
  await settle(); await settle();
  ok('a rejected play() (autoplay policy) does not tear the camera down', fellBack === 0 && c.__ticks.length === 1);
}

/* ══ THE PAGES USE IT ════════════════════════════════════════════════════════ */
console.log('\nboth forms are wired to it\n');
const CONTACT = fs.readFileSync(path.join(__dirname, '..', 'contact.html'), 'utf8');
const ESTIMATE = fs.readFileSync(path.join(__dirname, '..', 'estimate.html'), 'utf8');

[['contact.html', CONTACT], ['estimate.html', ESTIMATE]].forEach(function ([name, H]) {
  ok(name + ' loads the coach and the camera',
    /<script src="js\/camera-coach\.js"><\/script>/.test(H) && /<script src="js\/guided-camera\.js"><\/script>/.test(H));
  ok(name + ' — the tile is a button, not a <label for>, or the phone camera takes over',
    /class="shot\$?\{?[^"]*" role="button"/.test(H) && !/<label class="shot/.test(H));
  ok(name + ' — it checks the camera is possible before trying',
    /typeof openGuidedCamera!?[=\s]/.test(H) && /cameraAvailable\(\)/.test(H));
  ok(name + ' — the fallback is the ordinary file input',
    /input\.click\(\)/.test(H));
  /* Quote-agnostic: the two pages are written in different house styles. */
  ok(name + ' — even a throw while opening lands at the picker',
    /catch\s*\(err\)\s*\{\s*console\.error\(["']guided camera failed to open["'],\s*err\);\s*picker\(\);/.test(H));
  ok(name + ' — a photo from the camera replaces that slot rather than stacking',
    /filter\(function\s?\(p\)\s?\{\s?return !p \|\| p\.slot !== slotId; \}\)/.test(H) ||
    /filter\(function\(p\)\{return !p\|\|p\.slot!==slotId;\}\)/.test(H));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
})();
