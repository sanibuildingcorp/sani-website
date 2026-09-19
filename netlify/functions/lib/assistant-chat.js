// netlify/functions/lib/assistant-chat.js
//
// The saved conversations of the assistant - one per estimate (keyed by ref)
// and one for the drawer ("global") - in the assistant-chats Blobs store.
// Shared by assistant.js (every answer) and assistant-search-background.js
// (an answer that came from the internet, minutes later), so the two can
// never disagree about the shape of a saved turn.
//
// A key is letters, digits, - and _ only: an estimate ref or "global".
// Anything else is refused, so a key can never reach into another store.

"use strict";

const { getStore } = require("@netlify/blobs");

const CHAT_MAX = 200;

function str(v) { return String(v == null ? "" : v).trim(); }

function chatStore() {
  return getStore({ name: "assistant-chats", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
}
function chatKeyOf(v) {
  const k = str(v);
  return /^[A-Za-z0-9_-]{1,40}$/.test(k) ? k : "";
}
async function loadChat(key) {
  const v = await chatStore().get(key, { type: "json" });
  return Array.isArray(v)
    ? v.filter(function (m) { return m && str(m.text); }).map(function (m) { return { role: m.role === "assistant" ? "assistant" : "user", text: str(m.text), at: str(m.at) }; })
    : [];
}
async function appendChat(key, userText, replyText) {
  const cur = await loadChat(key);
  const at = new Date().toISOString();
  if (str(userText)) cur.push({ role: "user", text: str(userText).slice(0, 2000), at: at });
  if (str(replyText)) cur.push({ role: "assistant", text: str(replyText).slice(0, 4000), at: at });
  await chatStore().set(key, JSON.stringify(cur.slice(-CHAT_MAX)));
}

module.exports = { CHAT_MAX, chatStore, chatKeyOf, loadChat, appendChat };
