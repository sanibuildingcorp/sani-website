// ============================================================
//  form-alert.js  (v2 - Jul 28 2026)  →  netlify/functions/form-alert.js
//  Sends Zura an instant email when someone STARTS or ABANDONS
//  the estimate form, or (type:"visit") browses the site.
//
//  v2 adds BOT FILTERING for "visit" alerts. Audit of 749 sessions
//  over 30 days found 74% came from datacenters (Ashburn VA, Newark,
//  Washington VA) and ZERO from New York City. Those alerts were
//  crawlers, not customers. Now a visit alert is only sent when the
//  visitor passes both checks:
//    1. user-agent is not a known bot/crawler/headless client
//    2. the IP does not belong to a hosting/cloud network (ASN org)
//  Form "start"/"abandon" alerts are NEVER filtered - those are real
//  human interactions with the form.
//
//  v2 also puts the visitor's CITY in the email, which is the single
//  most useful thing to know (a Brooklyn visitor matters; Ashburn does not).
//  Uses existing env vars: RESEND_API_KEY, CONTRACTOR_EMAIL
// ============================================================
const https = require("https");

// --- Known bot / crawler / automation user-agents -----------------
const BOT_UA = /(bot|crawl|spider|slurp|headless|phantom|puppeteer|playwright|selenium|scrapy|curl|wget|python-requests|axios|go-http|java\/|libwww|okhttp|apache-http|monitor|uptime|pingdom|lighthouse|pagespeed|gtmetrix|preview|fetcher|archiver|facebookexternalhit|whatsapp|telegram|slackbot|discord|embedly|semrush|ahrefs|moz\.com|majestic|dotbot|petalbot|bytespider|amazonbot|gptbot|claudebot|anthropic|perplexity|ccbot|applebot|yandex|baidu|sogou|duckduckbot|bingbot|googlebot|adsbot|mediapartners)/i;

// --- Networks that host servers, not customers --------------------
const HOSTING_ORG = /(amazon|aws|google|microsoft|azure|cloudflare|digitalocean|linode|akamai|fastly|ovh|hetzner|vultr|oracle|alibaba|tencent|rackspace|equinix|leaseweb|contabo|scaleway|choopa|quadranet|colocation|datacenter|data center|hosting|server|vpn|proxy|m247|zenlayer|cogent|level3|gtt)/i;

// Look up the visitor's network + city. Best effort, never blocks the response.
async function lookupIp(ip) {
  if (!ip) return {};
  try {
    const r = await fetch("https://ipwho.is/" + encodeURIComponent(ip));
    if (!r.ok) return {};
    const d = await r.json();
    if (!d || d.success === false) return {};
    const conn = d.connection || {};
    return {
      city: d.city || null,
      region: d.region || null,
      country: d.country || null,
      org: conn.org || conn.isp || null,
      asn: conn.asn || null,
      isHosting: d.type === "hosting" ||
                 HOSTING_ORG.test(String(conn.org || "")) ||
                 HOSTING_ORG.test(String(conn.isp || ""))
    };
  } catch (e) { return {}; }
}

exports.handler = async (event) => {
  let data = {};
  if (event.httpMethod === "GET") {
    if ((event.queryStringParameters || {}).test !== "1") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }
    data = { type: "test" };
  } else if (event.httpMethod === "POST") {
    try { data = JSON.parse(event.body || "{}"); } catch (e) { data = {}; }
  } else {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const type = ["abandon","visit","test"].includes(data.type) ? data.type : "start";

  // ---- BOT LABELING (visit alerts only) ----------------------------
  // Per Zura (Jul 29): send EVERY visit alert, but label bots/crawlers in
  // the subject so human visitors stand out. Form start/abandon alerts are
  // always plain - a bot does not fill forms.
  const reqHeaders = event.headers || {};
  const ua = String(reqHeaders["user-agent"] || reqHeaders["User-Agent"] || "");
  const clientIp = String(
    reqHeaders["x-nf-client-connection-ip"] ||
    (reqHeaders["x-forwarded-for"] || "").split(",")[0] || ""
  ).trim();

  let visitorGeo = {};
  let isBotVisit = false;
  let botReason = "";
  if (type === "visit") {
    if (!ua || BOT_UA.test(ua)) { isBotVisit = true; botReason = "crawler user-agent"; }
    visitorGeo = await lookupIp(clientIp);
    if (visitorGeo.isHosting) { isBotVisit = true; botReason = botReason ? botReason + " + datacenter IP" : "datacenter/hosting IP"; }
  }
  const src = String(data.source || "direct").slice(0, 120);
  const step = parseInt(data.step, 10) || 1;
  const name = String(data.name || "").slice(0, 80);
  const phone = String(data.phone || "").slice(0, 40);
  const service = String(data.service || "").slice(0, 80);

  const resendKey = process.env.RESEND_API_KEY;
  const to = process.env.CONTRACTOR_EMAIL || "sanibuildingcorp@gmail.com";
  if (!resendKey) {
    return { statusCode: 200, headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ result: "FAILED", error: "RESEND_API_KEY env var is missing in Netlify" }) };
  }

  const nyTime = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });

  const page = String(data.page || "").slice(0, 120);
  const isStart = type === "start";
  const subject =
    type === "test" ? "\u2705 TEST — form-alert is working" :
    type === "visit" ? (isBotVisit ? "\uD83E\uDD16 Bot/crawler — " : "\uD83D\uDC40 Visitor on your website — ") + (page || "/") :
    isStart ? "\uD83D\uDFE2 Someone started the estimate form"
            : "\uD83D\uDFE1 Estimate form abandoned at step " + step;

  const rows = [];
  rows.push(row("Time", nyTime + " (NY)"));
  if (type === "visit") {
    const place = [visitorGeo.city, visitorGeo.region].filter(Boolean).join(", ");
    if (place) rows.push(row("Where", place + (visitorGeo.country ? " (" + visitorGeo.country + ")" : "")));
    if (visitorGeo.org) rows.push(row("Network", visitorGeo.org));
    if (isBotVisit) rows.push(row("Why flagged as bot", botReason));
    rows.push(row("Page they opened", page || "/"));
    rows.push(row("Came from", src));
  } else if (type !== "test") {
    rows.push(row("Came from page", src));
    rows.push(row(isStart ? "Reached step" : "Quit at step", String(step) + " of 5"));
  }
  if (service) rows.push(row("Service picked", service));
  if (name) rows.push(row("Name (partial lead!)", name));
  if (phone) rows.push(row("Phone (partial lead!)", phone));

  const html =
    '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">' +
    '<div style="background:#0a1628;padding:18px 22px;border-radius:10px 10px 0 0">' +
    '<span style="color:#f0a500;font-size:16px;font-weight:bold">Sani Building Corp — Live Form Alert</span></div>' +
    '<div style="border:1px solid #e5e5e5;border-top:0;border-radius:0 0 10px 10px;padding:20px 22px">' +
    '<p style="font-size:15px;margin:0 0 14px"><strong>' +
    (type === "test" ? "This is a test. Email delivery from form-alert works — alerts will arrive at this inbox." :
     type === "visit" ? "Someone is browsing your website right now." :
     isStart ? "A visitor just started filling the free-estimate form." :
      "A visitor left the estimate form without finishing.") +
    "</strong></p><table style=\"font-size:14px;border-collapse:collapse;width:100%\">" +
    rows.join("") + "</table>" +
    (phone ? '<p style="margin:16px 0 0;font-size:14px;color:#2d8a2d"><strong>They left a phone number — call them back!</strong></p>' : "") +
    '<p style="margin:16px 0 0;font-size:12px;color:#999">Automatic alert from sanibuildingcorp.com/estimate</p>' +
    "</div></div>";

  function row(k, v) {
    return '<tr><td style="padding:5px 10px 5px 0;color:#777;white-space:nowrap">' + k +
      '</td><td style="padding:5px 0;color:#0a1628"><strong>' + esc(v) + "</strong></td></tr>";
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  let sendResult = { sent: false, error: null };
  try {
    const r = await sendResend(resendKey, {
      from: "Sani Building Corp <estimates@sanibuildingcorp.com>",
      to: [to],
      subject: subject,
      html: html,
    });
    sendResult.sent = true;
    sendResult.resend = r.slice(0, 200);
  } catch (e) {
    sendResult.error = e.message;
    console.error("form-alert email failed:", e.message);
  }
  if (type === "test") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        test: true,
        emailSentTo: to,
        fromAddress: "estimates@sanibuildingcorp.com",
        result: sendResult.sent ? "SUCCESS — check inbox AND spam/Promotions" : "FAILED",
        error: sendResult.error,
      }, null, 2),
    };
  }
  return { statusCode: 200, body: "ok" };
};

function sendResend(apiKey, payload) {
  const data = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.resend.com",
        port: 443,
        path: "/emails",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          Authorization: `Bearer ${apiKey}`,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
          else reject(new Error("Resend " + res.statusCode + ": " + body));
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}
