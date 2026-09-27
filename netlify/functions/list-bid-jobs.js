// netlify/functions/list-bid-jobs.js
//
// GET -> { jobs: [{ id, status, created_at, file_name, error, name, stated, plus, counted }] }
//
//   "It's not working and i tired with it" - three readings of 750 3rd Avenue
//   finished on the server (650+ kitchens found) while his iPhone showed
//   "Load failed" or nothing: the page's list of earlier packages lived only
//   on the phone, and a phone that loses the page loses the list. The list
//   now comes from here, from the bid_jobs table itself.
//
// Contractor only (x-sbc-key): bid packages are private documents.

"use strict";

const { requireDashboardKey } = require("./lib/require-dashboard-key");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SECRET_KEY;
    if (!SUPABASE_URL || !KEY) throw new Error("Supabase env vars not set");
    /* Only the few fields the list shows - never the whole reading. */
    const select = "id,status,created_at,file_name,error,name:result->project->>name,stated:result->stated_total->>count,plus:result->stated_total->>plus,counted:result->>total_kitchens";
    const res = await fetch(SUPABASE_URL + "/rest/v1/bid_jobs?select=" + encodeURIComponent(select) + "&order=created_at.desc&limit=20", {
      headers: { "apikey": KEY, "Authorization": "Bearer " + KEY },
    });
    if (!res.ok) throw new Error("Supabase " + res.status + ": " + (await res.text()).slice(0, 200));
    const rows = await res.json();
    const jobs = (Array.isArray(rows) ? rows : []).map(function (r) {
      return {
        id: String(r.id || ""),
        status: String(r.status || ""),
        created_at: r.created_at || null,
        file_name: String(r.file_name || ""),
        error: r.error ? String(r.error).slice(0, 200) : null,
        name: r.name ? String(r.name).slice(0, 120) : "",
        stated: r.stated != null && r.stated !== "" ? Number(r.stated) : null,
        plus: r.plus === "true" || r.plus === true,
        counted: r.counted != null && r.counted !== "" ? Number(r.counted) : null,
      };
    }).filter(function (j) { return j.id; });
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ jobs: jobs }) };
  } catch (err) {
    console.error("list-bid-jobs error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-sbc-key",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}
