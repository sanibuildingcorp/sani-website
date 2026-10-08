// netlify/functions/lib/trust-footer.js
//
// ONE TRUST FOOTER FOR EVERY CUSTOMER EMAIL.
//
// "more elegance, professional views design, more trustworthy ... insurance,
//  partnership logos, we accept payments logos as it is Visa, Mastercard and
//  other. I am a home depot pro but always use we are language ... and google
//  review logo"
//
// Email clients strip SVG and most CSS, so every mark here is plain inline-
// styled HTML (tables, text, colour) - it renders the same in Gmail, Apple Mail
// and Outlook, with or without images switched on. Only the round company logo
// is an image, and it has alt text.
//
// The facts below are the ones the website already publishes (index.html
// schema: 4.9 from 68 Google reviews; the profile links in sameAs). Change them
// here once and every email follows. Never "licensed": we do not claim it.

"use strict";

const SITE = "https://www.sanibuildingcorp.com";
const FACTS = {
  logo: SITE + "/images/pwa-icon-192.png",
  phone: "(332) 277-0990",
  tel: "+13322770990",
  email: "contact@sanibuildingcorp.com",
  rating: "4.9",
  reviews: "68",
  reviewUrl: "https://g.page/r/CXtX_n13XF6aEBE/review",
  googleUrl: "https://g.page/r/CXtX_n13XF6aEBE",
  houzz: "https://www.houzz.com/professionals/general-contractors/sani-building-corp-pfvwus-pf~1481232083",
  angi: "https://www.angi.com/companylist/us/ny/brooklyn/sani-building-corp-reviews-133303809.htm",
  yelp: "https://www.yelp.com/biz/sani-building-brooklyn-9",
};

const REVIEWS = '<div style="margin:0 0 10px;font-size:13px;line-height:1.5;color:#3a352d;font-style:italic">&ldquo;Very professional and detail oriented service! Handled everything end to end.&rdquo;<div style="font-style:normal;font-size:11px;color:#9a9284;margin-top:2px"><span style="color:#fbbc04">&#9733;&#9733;&#9733;&#9733;&#9733;</span> Frank H. &middot; Google review</div></div><div style="margin:0 0 10px;font-size:13px;line-height:1.5;color:#3a352d;font-style:italic">&ldquo;Incredibly prompt service. Professional, incredibly kind, and a pleasure to work with.&rdquo;<div style="font-style:normal;font-size:11px;color:#9a9284;margin-top:2px"><span style="color:#fbbc04">&#9733;&#9733;&#9733;&#9733;&#9733;</span> Amanda S. &middot; Google review</div></div>';

/* Payment acceptance marks, drawn in the brands' own colours as text. */
function payChip(label, style) {
  return '<td style="padding:3px"><span style="display:inline-block;min-width:54px;text-align:center;border:1px solid #e1ddd5;border-radius:6px;background:#ffffff;padding:6px 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:14px;' + style + '">' + label + "</span></td>";
}
function payRow() {
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto"><tr>' +
    payChip("VISA", "color:#1a1f71;font-weight:900;font-style:italic;letter-spacing:1px") +
    payChip('<span style="color:#eb001b;font-size:15px">&#9679;</span><span style="color:#f79e1b;font-size:15px;margin-left:-5px">&#9679;</span> <span style="color:#222;font-weight:700">mastercard</span>', "") +
    payChip("AMEX", "color:#ffffff;background:#2e77bc;border-color:#2e77bc;font-weight:900;letter-spacing:1px") +
    payChip("DISCOVER", "color:#222;font-weight:700;letter-spacing:.5px") +
    "</tr></table>" +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto"><tr>' +
    payChip("Zelle", "color:#6d1ed4;font-weight:800") +
    payChip("Bank transfer", "color:#333;font-weight:700") +
    payChip("Check", "color:#333;font-weight:700") +
    "</tr></table>";
}
function badge(icon, title, sub, href) {
  const inner = '<div style="font-size:18px;line-height:20px">' + icon + '</div>' +
    '<div style="font-size:12px;font-weight:700;color:#0a1628;margin-top:4px">' + title + "</div>" +
    '<div style="font-size:11px;color:#7a7368;margin-top:1px">' + sub + "</div>";
  return '<td width="33%" valign="top" style="padding:6px 4px;text-align:center">' +
    (href ? '<a href="' + href + '" style="text-decoration:none;color:inherit">' + inner + "</a>" : inner) + "</td>";
}

/** The block, as email HTML. */
function emailHtml() {
  const f = FACTS;
  return '<div style="max-width:600px;margin:0 auto;padding:6px 16px 26px;font-family:Arial,Helvetica,sans-serif">' +
    '<div style="background:#ffffff;border:1px solid #e8e2d9;border-radius:14px;padding:18px 14px 14px">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
        badge('<span style="color:#c8860a">&#128737;</span>', "Fully insured", "COI on request") +
        badge('<span style="color:#fbbc04;letter-spacing:1px">&#9733;&#9733;&#9733;&#9733;&#9733;</span>', f.rating + " on Google", f.reviews + " reviews", f.googleUrl) +
        badge('<span style="display:inline-block;background:#f96302;color:#fff;font-weight:900;font-size:10px;line-height:12px;padding:3px 5px;border-radius:3px">PRO</span>', "Home Depot Pro", "trade supplier") +
      "</tr></table>" +
      '<div style="border-top:1px solid #efe9df;margin:12px 0 12px"></div>' +
      /* Real Google reviews, quoted word for word (shortened), first name and initial. */
      '<div style="padding:0 6px">' + REVIEWS + "</div>" +
      '<div style="border-top:1px solid #efe9df;margin:4px 0 10px"></div>' +
      '<div style="text-align:center;font-size:10px;letter-spacing:2px;color:#9a9284;text-transform:uppercase;margin:0 0 6px">We accept</div>' +
      payRow() +
      '<div style="border-top:1px solid #efe9df;margin:12px 0 10px"></div>' +
      '<div style="text-align:center;font-size:12px;color:#7a7368;line-height:1.9">' +
        'Find us on ' +
        '<a href="' + f.googleUrl + '" style="color:#4285f4;font-weight:700;text-decoration:none">Google</a> &middot; ' +
        '<a href="' + f.houzz + '" style="color:#4dbc15;font-weight:700;text-decoration:none">Houzz</a> &middot; ' +
        '<a href="' + f.angi + '" style="color:#ff6153;font-weight:700;text-decoration:none">Angi</a> &middot; ' +
        '<a href="' + f.yelp + '" style="color:#d32323;font-weight:700;text-decoration:none">Yelp</a>' +
      "</div>" +
    "</div>" +
    '<div style="text-align:center;padding:16px 8px 0;font-size:12px;color:#8a8a8a;line-height:1.8">' +
      '<img src="' + f.logo + '" width="36" height="36" alt="Sani Building Corp" style="width:36px;height:36px;border-radius:50%;vertical-align:middle;border:0"><br>' +
      '<strong style="color:#555;letter-spacing:1px">SANI BUILDING CORP</strong><br>' +
      "Renovation &amp; construction &middot; Brooklyn &amp; NYC Metro<br>" +
      '<a href="tel:' + f.tel + '" style="color:#8a8a8a">' + f.phone + "</a> &middot; " +
      '<a href="mailto:' + f.email + '" style="color:#8a8a8a">' + f.email + "</a><br>" +
      '<a href="' + SITE + '" style="color:#8a8a8a">www.sanibuildingcorp.com</a>' +
    "</div>" +
  "</div>";
}

/** Plain-text version for the text/plain part. */
function emailText() {
  const f = FACTS;
  return "\n--\nSani Building Corp · Fully insured (COI on request) · " + f.rating + " stars on Google (" + f.reviews + " reviews) · Home Depot Pro\n" +
    "We accept Visa, Mastercard, Amex, Discover, Zelle, bank transfer and check.\n" +
    f.phone + " · " + f.email + " · www.sanibuildingcorp.com\n";
}

/* Put the block just before </body>, once. Anything already carrying it is
   left alone, so a builder and its sender can both call this safely. */
const MARK = "<!--sbc-trust-->";
function inject(html) {
  const h = String(html || "");
  if (!h || h.indexOf(MARK) !== -1) return h;
  const block = MARK + emailHtml();
  const i = h.lastIndexOf("</body>");
  return i === -1 ? h + block : h.slice(0, i) + block + h.slice(i);
}

module.exports = { inject, emailHtml, emailText, FACTS };
