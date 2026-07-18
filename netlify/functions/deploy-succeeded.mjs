// ============================================================
// deploy-succeeded.mjs
// ------------------------------------------------------------
// Runs automatically after every successful Netlify deploy
// (Netlify event-triggered function — the filename is the trigger).
//
// Reads the live sitemap.xml and submits every URL to IndexNow,
// which notifies Bing (and other IndexNow engines) within minutes.
// Replaces the old Wix auto-submission that stopped at migration.
//
// No env vars required. Key file lives at /{KEY}.txt in site root.
// ============================================================

const HOST = "www.sanibuildingcorp.com";
const KEY = "a7ebddc053e946f89c2a38f825fdd941";
const SITEMAP = `https://${HOST}/sitemap.xml`;

export default async () => {
  try {
    // 1. Pull the freshly deployed sitemap
    const res = await fetch(SITEMAP, { headers: { "Cache-Control": "no-cache" } });
    if (!res.ok) throw new Error(`Sitemap fetch failed: ${res.status}`);
    const xml = await res.text();

    // 2. Extract all URLs
    const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
      .map((m) => m[1])
      .filter((u) => u.includes(HOST));
    if (!urls.length) throw new Error("No URLs found in sitemap");

    // 3. Submit the batch to IndexNow
    const submit = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: HOST,
        key: KEY,
        keyLocation: `https://${HOST}/${KEY}.txt`,
        urlList: urls,
      }),
    });

    console.log(`IndexNow: submitted ${urls.length} URLs — HTTP ${submit.status}`);
    return new Response(
      JSON.stringify({ submitted: urls.length, status: submit.status }),
      { status: 200 }
    );
  } catch (err) {
    console.error("IndexNow submission failed:", err.message);
    // Never fail the deploy pipeline over a ping
    return new Response(JSON.stringify({ error: err.message }), { status: 200 });
  }
};
