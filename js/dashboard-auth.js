/* ─────────────────────────────────────────────────────────────────────────────
   Sani Building Corp — shared dashboard auth helper.

   The dashboard password is NOT in this file and must never be added to it.
   It is verified by netlify/functions/dashboard-login.js against the
   DASHBOARD_PASSWORD environment variable in Netlify.

   Loaded by: dashboard.html, bid-analyzer.html, page-editor.html,
              seo-content.html, keyword-volumes.html, image-studio.html

   Everything here is a `var` or a function declaration on purpose. Both hoist,
   so a page can call these before its own `const`s are initialised without the
   TDZ throw described in Law 4 of CLAUDE.md.
   ───────────────────────────────────────────────────────────────────────────── */

var SBC_AUTH_FLAG = "sbc-auth";
var SBC_VISITS_KEY_STORE = "sbc-visits-key";
/* The write key for the gated endpoints. dashboard.html has always read this
   exact localStorage name, typed in by hand; keeping the name means an owner who
   already entered it stays logged in and notices nothing. */
var SBC_KEY_STORE = "sbcKey";

function sbcIsAuthed() {
  try { return sessionStorage.getItem(SBC_AUTH_FLAG) === "1"; }
  catch (e) { return false; }
}

/* The Live Visitors tab key, delivered by the login function after a correct
   password. Empty string until someone logs in on this tab. */
function sbcVisitsKey() {
  try { return sessionStorage.getItem(SBC_VISITS_KEY_STORE) || ""; }
  catch (e) { return ""; }
}

/* ══ THE WRITE KEY, IN ONE PLACE, FOR EVERY CONTRACTOR PAGE. ═════════════════
   save-estimate, list-estimates, seo-publish and publish-image-to-page were all
   reachable by anyone who knew the URL - no key, no password, nothing. Anyone
   could read every customer's name, address, phone and price, rewrite any
   estimate, or commit to the GitHub repo.

   The reason they were open is mundane: only dashboard.html had a key to send.
   It read localStorage "sbcKey", typed in once by hand, and no other tool page
   had any equivalent - so gating those endpoints would have broken image-studio,
   page-editor and seo-content outright.

   dashboard-login.js now hands the key back after a correct password, exactly
   as it already did for the Live Visitors key, and this reads it. Both sources
   are honoured, hand-typed first, so nothing that worked before stops working.
   Everything here is a `var` or a function declaration, and both hoist - Law 4. */
function sbcKey() {
  try {
    return localStorage.getItem(SBC_KEY_STORE) || sessionStorage.getItem(SBC_KEY_STORE) || "";
  } catch (e) { return ""; }
}

function sbcSetKey(k) {
  try {
    if (k) localStorage.setItem(SBC_KEY_STORE, String(k));
  } catch (e) {}
}

/* fetch() with the write key attached. Use this for every gated endpoint, so a
   new call site cannot forget the header and quietly 401 in front of the owner.
   On a 401 the stored key is dropped: it is wrong or stale, and keeping it only
   guarantees the next call fails the same way. */
function sbcFetch(url, options) {
  var opts = options || {};
  var headers = {};
  var src = opts.headers || {};
  for (var h in src) { if (Object.prototype.hasOwnProperty.call(src, h)) headers[h] = src[h]; }
  if (!headers["Content-Type"] && opts.body) headers["Content-Type"] = "application/json";
  headers["x-sbc-key"] = sbcKey();
  opts.headers = headers;
  return fetch(url, opts).then(function (r) {
    if (r.status === 401) {
      try {
        localStorage.removeItem(SBC_KEY_STORE);
        sessionStorage.removeItem(SBC_KEY_STORE);
      } catch (e) {}
    }
    return r;
  });
}

function sbcLogout() {
  try {
    sessionStorage.removeItem(SBC_AUTH_FLAG);
    sessionStorage.removeItem(SBC_VISITS_KEY_STORE);
    sessionStorage.removeItem(SBC_KEY_STORE);
    localStorage.removeItem(SBC_KEY_STORE);
  } catch (e) {}
}

/* Verify a password against the server.
   Always resolves — never rejects — with { ok:true } or { ok:false, error }.
   On success the session flag and visits key are already stored. */
function sbcVerifyPassword(password) {
  return fetch("/.netlify/functions/dashboard-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: password })
  }).then(function (r) {
    /* If the function timed out, Netlify returns an HTML page and .json()
       throws — in Safari as "The string did not match the expected pattern"
       (Law 1). Turn that into a readable message instead. */
    return r.json().catch(function () {
      return { ok: false, error: "Login service did not respond correctly. Check Netlify → Logs → Functions → dashboard-login." };
    });
  }).then(function (d) {
    if (d && d.ok) {
      try {
        sessionStorage.setItem(SBC_AUTH_FLAG, "1");
        sessionStorage.setItem(SBC_VISITS_KEY_STORE, d.visitsKey || "");
      } catch (e) {}
      /* Store the write key so every gated endpoint works on this device from
         here on, without the owner hand-typing it on each page. A key already
         typed in is left alone. */
      if (d.dashboardKey && !sbcKey()) sbcSetKey(d.dashboardKey);
      return { ok: true };
    }
    return { ok: false, error: (d && d.error) || "Incorrect password" };
  }).catch(function () {
    return { ok: false, error: "Network error. Check your connection and try again." };
  });
}
