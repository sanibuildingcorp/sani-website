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

function sbcLogout() {
  try {
    sessionStorage.removeItem(SBC_AUTH_FLAG);
    sessionStorage.removeItem(SBC_VISITS_KEY_STORE);
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
      return { ok: true };
    }
    return { ok: false, error: (d && d.error) || "Incorrect password" };
  }).catch(function () {
    return { ok: false, error: "Network error. Check your connection and try again." };
  });
}
