// netlify/functions/lib/gmail-accounts.js
//
// A GMAIL HE CONNECTS HIMSELF, WITH A BUTTON.
//
//   "if i will have a connect button in my dashboard and i will connect by
//    this button manually whatever email i need to connect to my dashboard
//    where AI can read direct from there full list of emails"
//
// info@ is read over IMAP with an app password set in Netlify (inbox-sync).
// Any OTHER mailbox is connected from the dashboard the way he connected
// the assistant to his Gmail: Google's own sign-in screen, read-only
// permission, done. Google hands back a refresh token; that token lives in
// the "gmail-accounts" Blobs store and never leaves the server. gmail-sync
// then reads the mailbox every fifteen minutes into the assistant's inbox
// (lib/inbox-store.js), matched to estimates exactly like info@ mail.
//
//   index        { accounts: [{ email, addedAt, lastSync, lastResult, error }] }
//   t-<hash>     { email, refreshToken, addedAt, seen: [gmail ids...] }
//
// ONE-TIME SETUP (Google Cloud Console, then Netlify env, functions scope):
//   GOOGLE_CLIENT_ID      OAuth client id ("Web application")
//   GOOGLE_CLIENT_SECRET  its secret
//   Authorised redirect URI on that client:
//     https://www.sanibuildingcorp.com/.netlify/functions/gmail-callback
//   Scope asked for: gmail.readonly only. The assistant reads; it never
//   sends, labels or deletes from a connected mailbox.

"use strict";

const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const STATE_MS = 15 * 60 * 1000;
const SEEN_MAX = 600;

function str(v) { return String(v == null ? "" : v).trim(); }
function norm(s) { return str(s).toLowerCase(); }

function clientId() { return str(process.env.GOOGLE_CLIENT_ID); }
function clientSecret() { return str(process.env.GOOGLE_CLIENT_SECRET); }
function configured() { return !!(clientId() && clientSecret()); }
function siteBase() { return str(process.env.URL || "https://www.sanibuildingcorp.com").replace(/\/$/, ""); }
function redirectUri() { return siteBase() + "/.netlify/functions/gmail-callback"; }

/* ── THE STATE: proof the sign-in was started from his dashboard ─────────
   Google sends it back untouched; a callback whose state was not signed
   here, or is older than fifteen minutes, is refused before any token is
   exchanged. */
function signState(now) {
  const body = String(now || Date.now()) + "." + crypto.randomBytes(8).toString("hex");
  return body + "." + mac(body);
}
function checkState(state, now) {
  const s = str(state);
  const m = /^(\d+)\.([0-9a-f]{16})\.([0-9a-f]{32})$/.exec(s);
  if (!m) return false;
  const body = m[1] + "." + m[2];
  const want = mac(body);
  if (want.length !== m[3].length) return false;
  try { if (!crypto.timingSafeEqual(Buffer.from(want), Buffer.from(m[3]))) return false; } catch (e) { return false; }
  const age = (now || Date.now()) - Number(m[1]);
  return age >= 0 && age <= STATE_MS;
}
function mac(body) {
  return crypto.createHmac("sha256", clientSecret() || "unset").update(body).digest("hex").slice(0, 32);
}

function authUrl(state) {
  const q = {
    client_id: clientId(), redirect_uri: redirectUri(), response_type: "code", scope: SCOPE,
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state: state,
  };
  return AUTH_URL + "?" + Object.keys(q).map(function (k) { return k + "=" + encodeURIComponent(q[k]); }).join("&");
}

/* ── GOOGLE, OVER HTTPS ────────────────────────────────────────────────── */
function form(obj) {
  return Object.keys(obj).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]); }).join("&");
}
async function postForm(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(body) });
  let data = null;
  try { data = await r.json(); } catch (e) { data = null; }
  if (!r.ok) throw new Error("Google " + r.status + ": " + str(data && (data.error_description || data.error)).slice(0, 160));
  return data || {};
}
async function getJson(url, accessToken) {
  const r = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  let data = null;
  try { data = await r.json(); } catch (e) { data = null; }
  if (!r.ok) throw new Error("Gmail " + r.status + ": " + str(data && data.error && data.error.message).slice(0, 160));
  return data || {};
}

async function exchangeCode(code) {
  return postForm(TOKEN_URL, { code: str(code), client_id: clientId(), client_secret: clientSecret(), redirect_uri: redirectUri(), grant_type: "authorization_code" });
}
async function refreshAccess(refreshToken) {
  const d = await postForm(TOKEN_URL, { refresh_token: str(refreshToken), client_id: clientId(), client_secret: clientSecret(), grant_type: "refresh_token" });
  if (!str(d.access_token)) throw new Error("Google gave no access token");
  return str(d.access_token);
}
async function revoke(token) {
  try { await fetch(REVOKE_URL + "?token=" + encodeURIComponent(str(token)), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } }); } catch (e) { /* a token Google no longer knows is already revoked */ }
}
async function profile(accessToken) {
  const d = await getJson(API + "/profile", accessToken);
  return norm(d.emailAddress);
}
async function listMessages(accessToken, q, max) {
  const d = await getJson(API + "/messages?q=" + encodeURIComponent(q) + "&maxResults=" + (max || 40), accessToken);
  return Array.isArray(d.messages) ? d.messages : [];
}
async function getMessage(accessToken, id) {
  return getJson(API + "/messages/" + encodeURIComponent(str(id)) + "?format=full", accessToken);
}

/* ── ONE GMAIL MESSAGE, READ ─────────────────────────────────────────────
   { id, messageId, from, name, to, subject, at, text } from Google's
   payload: headers, then the text/plain part (or the html, stripped). */
function b64url(s) {
  const t = str(s).replace(/-/g, "+").replace(/_/g, "/");
  try { return Buffer.from(t, "base64").toString("utf8"); } catch (e) { return ""; }
}
function partText(part, want) {
  if (!part || typeof part !== "object") return "";
  if (part.mimeType === want && part.body && part.body.data) return b64url(part.body.data);
  const parts = Array.isArray(part.parts) ? part.parts : [];
  for (let i = 0; i < parts.length; i++) { const t = partText(parts[i], want); if (t) return t; }
  return "";
}
function stripHtml(h) {
  return str(h).replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/[ \t]+/g, " ").replace(/ +([.,;:!?])/g, "$1").replace(/\n\s*\n+/g, "\n\n").trim();
}
function parseAddress(v) {
  const s = str(v);
  const m = /^(.*?)\s*<([^>]+)>\s*$/.exec(s);
  if (m) return { name: m[1].replace(/^"|"$/g, "").trim(), address: norm(m[2]) };
  return { name: "", address: norm(s.replace(/^"|"$/g, "")) };
}
function readMessage(msg) {
  const m = msg || {};
  const headers = {};
  (((m.payload || {}).headers) || []).forEach(function (h) { if (h && h.name) headers[String(h.name).toLowerCase()] = str(h.value); });
  const from = parseAddress(headers.from);
  const text = partText(m.payload, "text/plain") || stripHtml(partText(m.payload, "text/html")) || str(m.snippet);
  const at = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : (headers.date ? new Date(headers.date).toISOString() : new Date().toISOString());
  return {
    id: str(m.id), messageId: (headers["message-id"] || "").slice(0, 250) || ("gmail-" + str(m.id)),
    from: from.address, name: from.name, to: str(headers.to).slice(0, 200), subject: headers.subject || "(no subject)",
    at: isNaN(Date.parse(at)) ? new Date().toISOString() : at, text: text,
  };
}

/* ── THE STORE ─────────────────────────────────────────────────────────── */
function store() {
  return getStore({ name: "gmail-accounts", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
}
function keyFor(email) { return "t-" + crypto.createHash("sha1").update(norm(email)).digest("hex").slice(0, 32); }

async function listAccounts() {
  const v = await store().get("index", { type: "json" });
  const accounts = v && Array.isArray(v.accounts) ? v.accounts.filter(function (a) { return a && a.email; }) : [];
  return accounts.map(function (a) { return { email: a.email, addedAt: a.addedAt || "", lastSync: a.lastSync || "", lastResult: a.lastResult || "", error: a.error || "" }; });
}
async function saveIndex(accounts) {
  await store().set("index", JSON.stringify({ updatedAt: new Date().toISOString(), accounts: accounts }));
}
/* A connected mailbox: the token under its own key, the address on the
   list. Connecting the same address again replaces its token. */
async function saveAccount(email, refreshToken) {
  const em = norm(email);
  if (!em || !str(refreshToken)) throw new Error("No mailbox or no token to keep");
  const s = store();
  const old = await s.get(keyFor(em), { type: "json" }).catch(function () { return null; });
  await s.set(keyFor(em), JSON.stringify({ email: em, refreshToken: str(refreshToken), addedAt: new Date().toISOString(), seen: old && Array.isArray(old.seen) ? old.seen : [] }));
  const accounts = (await listAccounts()).filter(function (a) { return a.email !== em; });
  accounts.push({ email: em, addedAt: new Date().toISOString(), lastSync: "", lastResult: "", error: "" });
  await saveIndex(accounts);
  return em;
}
async function tokenRecord(email) {
  return store().get(keyFor(norm(email)), { type: "json" });
}
async function removeAccount(email) {
  const em = norm(email);
  const s = store();
  const rec = await s.get(keyFor(em), { type: "json" }).catch(function () { return null; });
  if (rec && rec.refreshToken) await revoke(rec.refreshToken);
  try { await s.delete(keyFor(em)); } catch (e) { /* already gone */ }
  await saveIndex((await listAccounts()).filter(function (a) { return a.email !== em; }));
  return !!rec;
}
/* After a sync: what happened, and which Gmail ids are already filed. */
async function markSync(email, result, error, seenIds) {
  const em = norm(email);
  const accounts = await listAccounts();
  accounts.forEach(function (a) { if (a.email === em) { a.lastSync = new Date().toISOString(); a.lastResult = str(result); a.error = str(error); } });
  await saveIndex(accounts);
  if (Array.isArray(seenIds)) {
    const s = store();
    const rec = await s.get(keyFor(em), { type: "json" }).catch(function () { return null; });
    if (rec) { rec.seen = seenIds.slice(-SEEN_MAX); await s.set(keyFor(em), JSON.stringify(rec)); }
  }
}

module.exports = {
  SCOPE, AUTH_URL, TOKEN_URL, API, STATE_MS,
  configured, redirectUri, signState, checkState, authUrl,
  exchangeCode, refreshAccess, revoke, profile, listMessages, getMessage, readMessage, parseAddress, stripHtml,
  store, keyFor, listAccounts, saveAccount, tokenRecord, removeAccount, markSync,
};
