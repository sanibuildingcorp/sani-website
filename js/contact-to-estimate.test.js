/* contact-to-estimate.test.js — run: node js/contact-to-estimate.test.js
 *
 *   "Request received from one of them contact form but it's only coming in to
 *    the email and can we add it to the dashboard"
 *
 * On 15 Sep 2026 Mike Siudym sent a bathroom renovation request for 221 West
 * 82nd Street — a written scope, a heated floor to keep, a washer/dryer to work
 * around, and EIGHT photographs. The only record of it was a Netlify
 * notification in Gmail. Nothing in the dashboard, nothing the AI could read,
 * nothing to price without retyping the whole thing.
 *
 * The estimate form has written straight into the dashboard since July. The two
 * intakes are the same lead in different clothes, and only one of them arrived.
 *
 * WHAT THIS FUNCTION DELIBERATELY DOES NOT DO:
 *
 *   It sends no email. Both emails already exist and work — Netlify Forms
 *   notifies the contractor, send-confirmation.js thanks the customer. A second
 *   sender here would double both, which is exactly how v1-v3 of
 *   submission-created.js went wrong.
 *
 *   It generates no estimate. Pricing costs a model call, and a contact message
 *   can be three words. The record lands as "new" and waits to be opened.
 *
 * THE ONE THAT WOULD HURT MOST: the same lead arriving twice. A double tap, a
 * retried fetch or a flaky connection would otherwise put two copies of one job
 * in the dashboard, each with its own ref, and the contractor would price one
 * and answer the other. The ref is DERIVED from the id the browser already made
 * for the photo folder — contact-260915-q5w0 becomes SBC-260915-Q5W0 — so a
 * retry lands on the same ref and is refused. Asserted first and hardest.
 */
const fs = require('fs'), path = require('path'), Module = require('module');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* ── load the function with @netlify/blobs replaced by an in-memory store ──
   The real module is not installed here, and the point of these assertions is
   the RECORD, not Netlify's storage. */
const STORE = new Map();
let setJSONCalls = 0;
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === '@netlify/blobs') return '@netlify/blobs';
  return origResolve.call(this, request, ...rest);
};
require.cache['@netlify/blobs'] = {
  id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: {
    getStore: function () {
      return {
        get: async function (k) { return STORE.has(k) ? JSON.parse(STORE.get(k)) : null; },
        setJSON: async function (k, v) { setJSONCalls++; STORE.set(k, JSON.stringify(v)); }
      };
    }
  }
};
const fn = require(path.join(ROOT, 'netlify/functions/contact-to-estimate.js'));

const post = async (body) => {
  const res = await fn.handler({ httpMethod: 'POST', body: JSON.stringify(body) });
  return { code: res.statusCode, body: JSON.parse(res.body || '{}') };
};

/* Mike Siudym's actual submission. */
const MIKE = {
  contactRef: 'contact-260915-q5w0',
  name: 'Mike Siudym',
  phone: '9148432631',
  email: 'mikesiudym@gmail.com',
  service: 'Bathroom Renovation',
  area: 'Manhattan',
  address: '221 West 82nd Street',
  details: "Looking for a quote on a bathroom reno. Tub, tiling, vanity and shower fixtures. Have a heated floor and would like to keep that. There's a washer dryer in a closet in the bathroom as well which is fine the way it is.",
  /* The shape of a real upload URL, with a placeholder host. Pasting the live
     Supabase project address in here failed the Netlify build outright: its
     secret scanner matches the value of SUPABASE_URL against every deployed
     file, finds it, and stops the deploy. Nothing under test cares what the
     host is. */
  photos: Array.from({ length: 8 }, (_, i) =>
    'https://example-project.supabase.co/storage/v1/object/public/estimate-photos/contact-260915-q5w0/17895089' + i + '.jpg'),
  photoSlots: ['wide', 'other', 'other', 'other', 'other', 'other', 'other', 'other']
};

(async function () {

  /* ══ THE ONE THAT WOULD HURT MOST ═══════════════════════════════════════ */
  console.log('\nthe same lead cannot arrive twice\n');
  {
    STORE.clear(); setJSONCalls = 0;
    const a = await post(MIKE);
    const b = await post(MIKE);
    ok('THE REF IS DERIVED FROM THE SUBMISSION, not rolled fresh each time',
      a.body.ref === 'SBC-260915-Q5W0', a.body.ref);
    ok('a retry returns the SAME ref', b.body.ref === a.body.ref, b.body.ref);
    ok('A RETRY IS REFUSED AS A DUPLICATE — one job, one record',
      b.body.duplicate === true && STORE.size === 1, STORE.size + ' records');
    ok('...and the second attempt writes nothing at all', setJSONCalls === 1, setJSONCalls + ' writes');
    ok('the retry still reports success, so the page never shows an error for it',
      b.code === 200 && b.body.success === true);
  }

  /* ══ THE LEAD ITSELF ════════════════════════════════════════════════════ */
  console.log('\nMike Siudym arrives in the dashboard whole\n');
  {
    STORE.clear();
    const r = await post(MIKE);
    const rec = JSON.parse(STORE.get(r.body.ref));
    ok('THE RECORD EXISTS', !!rec, r.body.ref);
    ok('it is a NEW request, not a half-written estimate', rec.status === 'new', rec.status);
    ok('...and says where it came from', rec.source === 'contact-form', rec.source);
    ok('name, phone and email are all there',
      rec.customer.name === 'Mike Siudym' && rec.customer.phone === '9148432631' &&
      rec.customer.email === 'mikesiudym@gmail.com', JSON.stringify(rec.customer));
    ok('THE BOROUGH IS JOINED TO THE STREET — an address without it is not an address',
      rec.customer.address === '221 West 82nd Street, Manhattan', rec.customer.address);
    ok('the service he picked is the service on the record',
      rec.request.service === 'Bathroom Renovation');
    ok('EVERY WORD OF WHAT HE WROTE SURVIVES — the heated floor is the whole job',
      rec.request.description.indexOf('heated floor and would like to keep that') !== -1 &&
      rec.request.description.indexOf('washer dryer in a closet') !== -1);
    ok('ALL EIGHT PHOTOS ARRIVE', rec.request.photos.length === 8 && rec.request.photoCount === 8,
      rec.request.photos.length + ' photos');
    ok('...in the shape the dashboard and the quote page already read',
      rec.request.photos.every(p => typeof p.url === 'string' && typeof p.slot === 'string'),
      JSON.stringify(rec.request.photos[0]));
    ok('...keeping which shot is which', rec.request.photos[0].slot === 'wide');
    ok('the estimate half is empty and ready to be priced',
      rec.estimate.labor.length === 0 && rec.estimate.materials.length === 0 &&
      rec.estimate.scopeOfWork === '');
  }

  /* ══ WHAT IT MUST NOT DO ════════════════════════════════════════════════ */
  console.log('\nit writes a record and nothing else\n');
  {
    const src = fs.readFileSync(path.join(ROOT, 'netlify/functions/contact-to-estimate.js'), 'utf8');
    ['RESEND_API_KEY', 'resend.com', 'sendEmail', 'nodemailer', 'CONTRACTOR_EMAIL'].forEach(function (t) {
      ok('NO EMAIL: it never mentions ' + t + ' — both emails already exist and work',
        src.indexOf(t) === -1);
    });
    ['generate-estimate', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'].forEach(function (t) {
      ok('NO AI RUN: it never mentions ' + t + ' — pricing costs money and is the contractor\'s call',
        src.indexOf(t) === -1);
    });
  }

  /* ══ THE AWKWARD ONES ═══════════════════════════════════════════════════ */
  console.log('\nleads that are not tidy\n');
  {
    STORE.clear();
    const noPhotos = await post({ name: 'Ann Lee', email: 'a@b.com', service: 'Painting', details: 'Two rooms' });
    ok('the homepage form, which uploads no photos, still gets a record',
      noPhotos.body.success === true, JSON.stringify(noPhotos.body));
    ok('...with a ref of the right shape, rolled because it had no contactRef',
      /^SBC-\d{6}-[A-Z0-9]{4}$/.test(noPhotos.body.ref), noPhotos.body.ref);

    const phoneOnly = await post({ name: 'No Email', phone: '5551234', service: 'Handyman' });
    ok('a phone number with no email is still a lead', phoneOnly.body.success === true);

    const nameless = await post({ email: 'x@y.com', details: 'hello' });
    ok('NOTHING WITHOUT A NAME IS SAVED', nameless.code === 400, JSON.stringify(nameless.body));
    const unreachable = await post({ name: 'Ghost' });
    ok('...nor anything with no way to reach the person', unreachable.code === 400);

    STORE.clear();
    await post({ name: 'Vague', phone: '5550000', details: 'call me' });
    const rec = JSON.parse(STORE.get(Array.from(STORE.keys())[0]));
    ok('a three-word message still lands, and is labelled a general enquiry',
      rec.request.service === 'General Enquiry', rec.request.service);
    ok('a missing borough does not leave a dangling comma on the address',
      rec.customer.address === '', JSON.stringify(rec.customer.address));

    STORE.clear();
    await post({ name: 'Flood', email: 'f@g.com', photos: Array.from({ length: 60 }, (_, i) => 'u' + i) });
    const rec2 = JSON.parse(STORE.get(Array.from(STORE.keys())[0]));
    ok('a flood of photo links is capped rather than stored whole',
      rec2.request.photos.length === 24, rec2.request.photos.length + ' kept');

    const bad = await fn.handler({ httpMethod: 'POST', body: '{not json' });
    ok('an unparseable body is refused without throwing', bad.statusCode === 500);
    const wrongMethod = await fn.handler({ httpMethod: 'GET' });
    ok('GET is refused', wrongMethod.statusCode === 405);
    const preflight = await fn.handler({ httpMethod: 'OPTIONS' });
    ok('the browser preflight is answered', preflight.statusCode === 200);
  }

  /* ══ BOTH FORMS ARE WIRED ═══════════════════════════════════════════════ */
  console.log('\nboth pages that carry the form call it\n');
  {
    const contact = fs.readFileSync(path.join(ROOT, 'contact.html'), 'utf8');
    const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    ok('contact.html calls it', contact.indexOf('functions/contact-to-estimate') !== -1);
    ok('index.html calls it', index.indexOf('functions/contact-to-estimate') !== -1);
    ok('CONTACT.HTML SENDS THE SAME REF IT USED FOR THE PHOTO FOLDER, which is what makes retries safe',
      /var contactRef=contactUploadRef\(\);/.test(contact) &&
      /contactUploadFiles\(contactRef\)/.test(contact) &&
      /contactRef:contactRef/.test(contact));
    ok('the confirmation email is still sent, and still first',
      contact.indexOf('functions/send-confirmation') < contact.indexOf('functions/contact-to-estimate'));
    ok('a failure here cannot break the page or the customer\'s confirmation',
      /functions\/contact-to-estimate[\s\S]{0,900}?\.catch\(function\(\)\{\}\)/.test(contact) &&
      /functions\/contact-to-estimate[\s\S]{0,700}?\.catch\(function\(\)\{\}\)/.test(index));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
