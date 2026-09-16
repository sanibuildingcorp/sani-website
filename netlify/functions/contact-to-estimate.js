// netlify/functions/contact-to-estimate.js
//
// A CONTACT FORM SUBMISSION IS A LEAD. IT BELONGS IN THE DASHBOARD.
//
// Until now it went to email and nowhere else. On 15 Sep 2026 Mike Siudym sent a
// bathroom renovation request for 221 West 82nd Street — a written scope, a
// heated floor to keep, a washer/dryer to work around, and EIGHT photographs —
// and the only record of it was a Netlify notification in Gmail. Nothing in the
// dashboard. Nothing the AI could read. Nothing to price without retyping it.
//
// Meanwhile the estimate form has written straight into the dashboard since July
// (estimate-request.js). The two intakes are the same lead in different clothes.
//
// THIS FUNCTION DOES ONE THING: it writes the record. It sends no email, because
// both emails already exist and are working — Netlify Forms notifies the
// contractor, send-confirmation.js thanks the customer. A second sender here
// would double both of them, which is how v1-v3 of submission-created.js went
// wrong. Adding a writer next to them cannot disturb either.
//
// IT NEVER GENERATES AN ESTIMATE. The record lands as status "new" and waits.
// Pricing costs money and takes a model call, and a contact message can be three
// words. The contractor opens it and presses the button when he wants it.
//
// THE REF IS DERIVED, NOT ROLLED. The browser already makes a per-submission id
// for the photo folder — "contact-260915-q5w0". This turns it into
// "SBC-260915-Q5W0", so a retry, a double tap or a flaky connection produces the
// SAME ref and is refused as a duplicate instead of filling the dashboard with
// copies of one lead. It also means the photo folder and the estimate that owns
// it carry the same four characters, which is worth something at 11pm.

const { getStore } = require("@netlify/blobs");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };

  try {
    const b = JSON.parse(event.body || "{}");

    // A lead with no way to reach the person is not a lead.
    const name = str(b.name);
    const email = str(b.email);
    const phone = str(b.phone);
    if (!name || (!email && !phone)) {
      return json(400, { error: "A name and either an email or a phone are required" });
    }

    const ref = refFrom(b.contactRef);
    const photos = arr(b.photos).map(str).filter(Boolean).slice(0, 24);
    const slots = arr(b.photoSlots).map(str);

    // Borough is a separate field on the form and the street address is not much
    // use without it. One line, the way it would be written on an envelope.
    const address = [str(b.address), str(b.area)].filter(Boolean).join(", ");

    const record = {
      ref: ref,
      status: "new",
      source: "contact-form",
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      customer: { name: name, email: email, phone: phone, address: address },
      request: {
        service: str(b.service) || "General Enquiry",
        description: str(b.details).slice(0, 4000),
        propertyType: str(b.propertyType),
        photoCount: photos.length,
        // Same shape the estimate form writes, so the dashboard and the quote
        // page read these without knowing which form they came from.
        photos: photos.map(function (url, i) {
          return { url: url, slot: slots[i] || "other" };
        }),
      },
      estimate: {
        projectTitle: "",
        summary: "",
        scopeOfWork: "",
        timelineText: "",
        notes: "",
        markupPct: 0,
        showLaborCost: true,
        showMaterialsCost: false,
        labor: [],
        materials: [],
        quotePhotos: [],
      },
    };

    const store = getStore({
      name: "estimates",
      siteID: process.env.MY_SITE_ID,
      token: process.env.MY_BLOBS_TOKEN,
    });

    // A duplicate is a retry, not a second job. Say so and change nothing.
    const existing = await store.get(ref, { type: "json" });
    if (existing) return json(200, { success: true, ref: ref, duplicate: true });

    await store.setJSON(ref, record);
    return json(200, { success: true, ref: ref });
  } catch (err) {
    console.error("contact-to-estimate error:", err && err.message);
    return json(500, { error: "Could not save the request" });
  }
};

/* "contact-260915-q5w0" -> "SBC-260915-Q5W0". Anything unusable falls back to a
   fresh id rather than throwing away the lead. */
function refFrom(contactRef) {
  const m = /^contact-(\d{6})-([a-z0-9]{4})$/i.exec(str(contactRef));
  if (m) return "SBC-" + m[1] + "-" + m[2].toUpperCase();
  const d = new Date();
  const p = function (n) { return String(n).padStart(2, "0"); };
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let rand = "";
  for (let i = 0; i < 4; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  return "SBC-" + String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate()) + "-" + rand;
}

function str(v) { return String(v == null ? "" : v).trim(); }
function arr(v) { return Array.isArray(v) ? v : []; }
function json(code, obj) { return { statusCode: code, headers: cors(), body: JSON.stringify(obj) }; }
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
