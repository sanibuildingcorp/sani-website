/* estimate-pdf.test.js — run: node js/estimate-pdf.test.js
 *
 *   "I need download or print function in my dashboard for let me download
 *    each estimate" - both versions, as PDF files.
 *
 * CUSTOMER PDF: what the customer's page shows, prices included, and nothing
 * the customer must not see (no line, no rate, no markup, no internal note).
 * INTERNAL PDF: every line, rate, the markup and the notes, marked as such.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const P = require(path.join(ROOT, 'netlify/functions/lib/estimate-pdf.js'));
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
/* the words drawn on the pages: every PDF string literal, joined */
const WIN = { 151: '—', 150: '–', 149: '•', 183: '·', 133: '…', 215: '×' };
const words = (buf) => (buf.toString('latin1').match(/\((?:\\.|[^\\)])*\) Tj/g) || []).map((x) => x.slice(1, -4)
  .replace(/\\([0-7]{3})/g, (m, o) => WIN[parseInt(o, 8)] || String.fromCharCode(parseInt(o, 8))).replace(/\\(.)/g, '$1')).join(' | ');

const REC = () => ({ ref: 'SBC-260923-66W0', status: 'sent', sentAt: '2026-09-23T15:00:00Z',
  customer: { name: 'Joshua Inasuen', phone: '(555) 555-1234', email: 'j@example.com', address: '151 W 46th St, New York, NY' },
  request: { service: 'Flooring' },
  estimate: { projectTitle: 'Kitchen Floor Resurfacing', markupPct: 25, showLaborCost: false, showMaterialsCost: false,
    summary: 'Resurface the commercial kitchen floor overnight.', timelineText: 'Two night shifts.',
    labor: [{ section: 'Kitchen Floor', item: 'Diamond grind and repair cracked concrete', qty: 24, unit: 'hrs', rate: 65 }, { section: 'Kitchen Floor', item: 'Prime and epoxy coat', qty: 32, unit: 'hrs', rate: 65 }],
    materials: [{ section: 'Kitchen Floor', item: '100% solids epoxy floor coating, 3 gal kit', qty: 6, unit: 'kit', rate: 389 }],
    serviceBreakdown: [{ title: 'Kitchen Floor', subtotal: 9999, included: ['Grind, repair and epoxy the floor'], customerSupplies: [], notIncluded: ['Moving heavy equipment'] }],
    customerSupplied: [], exclusions: [], assumptions: ['SECRET ASSUMPTION'], notes: 'SECRET NOTE: building needs COI' } });
/* 24*65 + 32*65 + 6*389 = 1560 + 2080 + 2334 = 5974; x1.25 = 7467.50 */

console.log('\n1. The customer PDF\n');
{
  const v = REC(); v.notSentYet = false;
  const buf = P.buildCustomerPdf(v, { now: '2026-09-25T12:00:00Z' });
  const w = words(buf);
  ok('a real PDF file', buf.slice(0, 8).toString() === '%PDF-1.4' && /%%EOF\s*$/.test(buf.toString('latin1')));
  ok('title, customer, address, reference', ['Kitchen Floor Resurfacing', 'Prepared for: Joshua Inasuen', '151 W 46th St', 'SBC-260923-66W0'].every((x) => w.indexOf(x) > -1));
  ok('the customer total, from lib/customer-total.js: $7,467.50', /Your estimate \| \$7,467\.50/.test(w), w.slice(0, 400));
  ok('...and the service price scaled to it, as the quote page does (not the raw $9,999)', w.indexOf('$9,999') === -1 && (w.match(/\$7,467\.50/g) || []).length >= 2);
  ok('the scope: included and not included', w.indexOf('Grind, repair and epoxy the floor') > -1 && w.indexOf('Moving heavy equipment') > -1);
  ok('NO labor or material line, no rate, no markup, no internal note', !/Diamond grind|epoxy floor coating, 3 gal|\$65\.00|\$389|Markup|SECRET/.test(w));
  const lab = REC(); lab.estimate.showLaborCost = true; lab.estimate.showMaterialsCost = true;
  const wl = words(P.buildCustomerPdf(lab));
  ok('labor and materials rows appear only when you chose to show them, marked up', /Labor \| \$4,550\.00/.test(wl) && /Materials \| \$2,917\.50/.test(wl) && !/Labor \|/.test(w));
  const opt = REC(); opt.customerOptionSelections = [{ label: 'Option A — cove base', price: 500, section: 'Kitchen Floor' }, { label: 'Adopted one', price: 900, adoptedAt: 'x' }];
  const wo = words(P.buildCustomerPdf(opt));
  ok('an option the customer added is listed and counted; an adopted one is not counted twice', /Added: Option A — cove base \| \+\$500\.00/.test(wo) && /Your estimate \| \$7,967\.50/.test(wo) && wo.indexOf('Adopted one') === -1);
  const d = REC(); d.notSentYet = true;
  ok('a draft never sent says so', /DRAFT — this estimate has not been sent/.test(words(P.buildCustomerPdf(d))));
  ok('file name: Estimate-<name>-<ref>.pdf', P.fileName(REC(), 'customer') === 'Estimate-Joshua-Inasuen-SBC-260923-66W0.pdf');
}

console.log('\n2. The internal PDF\n');
{
  const w = words(P.buildInternalPdf(REC(), { now: '2026-09-25T12:00:00Z' }));
  ok('"INTERNAL — NOT FOR THE CUSTOMER" at the top and in every page footer', /^INTERNAL — NOT FOR THE CUSTOMER/.test(w) && /INTERNAL — NOT FOR THE CUSTOMER · Sani Building Corp/.test(w));
  ok('every labor and material line with qty, rate and amount', /Diamond grind and repair cracked concrete \| 24 hrs \| \$65\.00 \| \$1,560\.00/.test(w) && /100% solids epoxy floor coating, 3 gal kit \| 6 kit \| \$389\.00 \| \$2,334\.00/.test(w));
  ok('the totals with the markup and the customer price', ['Labor (cost) | $3,640.00', 'Materials (cost) | $2,334.00', 'Subtotal | $5,974.00', 'Markup (25%) | $1,493.50', 'Grand total | $7,467.50', 'Customer price | $7,467.50'].every((x) => w.indexOf(x) > -1), w.slice(0, 900));
  ok('phone, email, status, assumptions and your notes', ['(555) 555-1234', 'j@example.com', 'Status: sent', 'SECRET ASSUMPTION', 'SECRET NOTE'].every((x) => w.indexOf(x) > -1));
  ok('file name: Internal-Estimate-<name>-<ref>.pdf', P.fileName(REC(), 'internal') === 'Internal-Estimate-Joshua-Inasuen-SBC-260923-66W0.pdf');
}

console.log('\n3. The endpoint and the dashboard\n');
{
  const F = read('netlify/functions/estimate-pdf.js');
  ok('estimate-pdf is behind the dashboard key, checked before anything is read', /const denied = requireDashboardKey\(event, cors\(\)\);\s*if \(denied\) return denied;/.test(F) && F.indexOf('requireDashboardKey(event') < F.indexOf('getStore('));
  ok('the customer copy is get-estimate\'s customer view (the SENT version)', /buildCustomerPdf\(customerPdfView\(data\)\)/.test(F));
  const G = read('netlify/functions/get-estimate.js');
  ok('customerPdfView applies the sent version and the checked alternatives only', /function customerPdfView\(data\) \{\s*const view = buildCustomerView\(data, false\);\s*applySentVersion\(data, view\);\s*stripUnoffered\(/.test(G) && /exports\.customerPdfView = customerPdfView;/.test(G));
  ok('get-estimate itself stays public (no key check added)', !/requireDashboardKey/.test(G));
  const D = read('dashboard.html');
  ok('two buttons in the estimate: CUSTOMER PDF and INTERNAL PDF', /onclick="downloadEstimatePdf\(\\'customer\\'\)"[^>]*>⬇ CUSTOMER PDF</.test(D) && /onclick="downloadEstimatePdf\(\\'internal\\'\)"[^>]*>⬇ INTERNAL PDF</.test(D));
  ok('...the file is fetched WITH the key (sbcFetch) and saved as a download', /async function downloadEstimatePdf\(version\) \{[\s\S]{0,700}sbcFetch\("\/\.netlify\/functions\/estimate-pdf\?ref="/.test(D) && /a\.download = name;/.test(D));
  ok('ON A PHONE the PDF goes to the share sheet (Save to Files, Mail, Print), not a dead-end viewer', /if \(phone && file && navigator\.canShare && navigator\.canShare\(\{ files: \[file\] \}\)\) \{\s*pdfReadySheet\(name, file, url\);/.test(D));
  ok('...opened from its own tap ("Save or share"), since the share sheet only opens from a tap', /document\.getElementById\("pdf-share"\)\.onclick = function \(\) \{\s*navigator\.share\(\{ files: \[file\], title: name \}\)/.test(D) && />📤 Save or share</.test(D));
  ok('...with Open and Close as well; a computer still downloads the file', /id="pdf-open"/.test(D) && /id="pdf-close"/.test(D) && /\} else \{\s*var a = document\.createElement\("a"\);\s*a\.href = url; a\.download = name;/.test(D));
  ok('never "licensed" in the PDFs', !/\blicensed\b/i.test(read('netlify/functions/lib/estimate-pdf.js')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
