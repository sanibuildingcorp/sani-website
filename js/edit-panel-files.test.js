/* edit-panel-files.test.js — run: node js/edit-panel-files.test.js
 *
 *   "I can't re-upload plans in edit section, i can almost everything edit
 *    but no photo upload or pdf. Or i have apply new request form as a
 *    customer for upload pdf"
 *
 * The Edit panel gets "Photos and plans": files go straight to storage
 * (upload-estimate-file, a signed URL - no 6 MB function limit), and Save
 * puts the links on the estimate (update-customer addPhotos/removePhotos),
 * where the estimator reads a PDF as drawings.
 */
const fs = require('fs'), path = require('path'), Module = require('module');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* a stand-in for Netlify Blobs, so the real handlers run here */
let stored = null;
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (req, parent, ...rest) { if (req === '@netlify/blobs') return 'fake-blobs'; return realResolve.call(this, req, parent, ...rest); };
require.cache['fake-blobs'] = { id: 'fake-blobs', filename: 'fake-blobs', loaded: true, exports: { getStore: () => ({ get: async () => JSON.parse(JSON.stringify(stored)), setJSON: async (k, v) => { stored = v; } }) } };
Object.assign(process.env, { DASHBOARD_KEY: 'k', SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SECRET_KEY: 's' });
const KEY = { 'x-sbc-key': 'k' };

(async () => {
  console.log('\n1. The file goes straight to storage\n');
  const up = require(path.join(ROOT, 'netlify/functions/upload-estimate-file.js')).handler;
  let asked = null;
  global.fetch = async (url, o) => { asked = { url, o }; return { ok: true, json: async () => ({ url: '/object/upload/sign/estimate-photos/SBC-1/x.pdf?token=T' }) }; };
  const no = await up({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ ref: 'SBC-1', fileName: 'a.pdf', contentType: 'application/pdf' }) });
  ok('BEHIND THE DASHBOARD KEY: no key, no upload link', no.statusCode === 401);
  const r = await up({ httpMethod: 'POST', headers: KEY, body: JSON.stringify({ ref: 'SBC-260925-Y373', fileName: 'A-101 Floor Plans.PDF', contentType: 'application/pdf' }) });
  const d = JSON.parse(r.body);
  ok('a signed upload URL into estimate-photos/<ref>/, and the public link it will have', r.statusCode === 200 && /^https:\/\/abc\.supabase\.co\/storage\/v1\/object\/upload\/sign\/estimate-photos\/SBC-1\/x\.pdf\?token=T$/.test(d.signedUrl) && /^https:\/\/abc\.supabase\.co\/storage\/v1\/object\/public\/estimate-photos\/SBC-260925-Y373\/\d+-[a-z0-9]+-a-101-floor-plans\.pdf$/.test(d.publicUrl), d.publicUrl);
  ok('...asked of Supabase with the service key, for a path under the estimate ref', /\/storage\/v1\/object\/upload\/sign\/estimate-photos\/SBC-260925-Y373\//.test(asked.url) && asked.o.headers.Authorization === 'Bearer s');
  const bad = await up({ httpMethod: 'POST', headers: KEY, body: JSON.stringify({ ref: 'SBC-1', fileName: 'x.exe', contentType: 'application/x-msdownload' }) });
  ok('only photos and PDF files', bad.statusCode === 400);

  console.log('\n2. Save puts it on the estimate\n');
  const uc = require(path.join(ROOT, 'netlify/functions/update-customer.js')).handler;
  stored = { ref: 'SBC-260925-Y373', customer: { name: 'Crismar' }, request: { service: 'Bathroom', photos: [{ name: 'old.jpg', data: 'https://abc.supabase.co/storage/v1/object/public/estimate-photos/SBC/old.jpg' }, { name: 'wrong.pdf', data: 'https://abc.supabase.co/storage/v1/object/public/estimate-photos/SBC/wrong.pdf' }] } };
  const base = 'https://abc.supabase.co/storage/v1/object/public/estimate-photos/SBC-260925-Y373/';
  const res = await uc({ httpMethod: 'POST', headers: KEY, body: JSON.stringify({ ref: 'SBC-260925-Y373', customer: { name: 'Crismar' },
    addPhotos: [{ name: 'A-101 Floor Plans.pdf', url: base + '1-a-101.pdf' }, { name: 'site.jpg', url: base + '2-site.jpg' }, { name: 'evil', url: 'https://evil.example/x.pdf' }],
    removePhotos: [1] }) });
  const photos = stored.request.photos;
  ok('THE PLAN IS ON THE ESTIMATE as a file (read as drawings), the photo as an image', res.statusCode === 200 && photos.some((p) => p.name === 'A-101 Floor Plans.pdf' && p.kind === 'file' && p.slot === 'contractor') && photos.some((p) => p.name === 'site.jpg' && p.kind === 'image'));
  ok('...a link outside this site\'s storage is refused', !photos.some((p) => /evil/.test(p.data)));
  ok('...a file marked for removal is gone, the rest kept', !photos.some((p) => p.name === 'wrong.pdf') && photos.some((p) => p.name === 'old.jpg') && photos.length === 3);
  ok('...the history says what was added and removed', JSON.stringify(stored.history || stored.events || stored).indexOf('added A-101 Floor Plans.pdf, site.jpg') > -1 && JSON.stringify(stored).indexOf('removed wrong.pdf') > -1);
  ok('...and the answer carries the new list back to the dashboard', JSON.parse(res.body).photos.length === 3);

  console.log('\n3. The panel and the estimator\n');
  const D = read('dashboard.html');
  ok('THE EDIT PANEL HAS "Photos and plans": the list, remove, and "Add photos or plans (PDF)"', /<label>Photos and plans<\/label>/.test(D) && /accept="image\/\*,application\/pdf" multiple onchange="sbcAddFiles\(event\)"/.test(D) && /window\.sbcToggleFile = /.test(D));
  ok('...the file is PUT straight to the signed URL (never through a function)', /await fetch\(d\.signedUrl, \{ method: 'PUT', headers: \{ 'Content-Type': type, 'x-upsert': 'true' \}, body: file \}\)/.test(D));
  ok('...Save waits for uploads and sends addPhotos / removePhotos', /Wait for the uploads to finish, then save\./.test(D) && /addPhotos: addPhotos, removePhotos: removePhotos/.test(D));
  ok('...and it says to press "Re-read the job from scratch" after', /Re-read the job from scratch<\/b> so it uses them/.test(D));
  const G = read('netlify/functions/generate-estimate-background.js');
  ok('THE ESTIMATOR KNOWS A PDF BY ITS LINK OR NAME, not only kind "file" (the form saved none)', /if \(p && \(p\.kind === "file" \|\| isPdf\(p\.name, data\)\)\) files\.push/.test(G));
  ok('the customer form now keeps the kind of each upload', /data:j\.url,slot:p\.slot\|\|'other',kind:p\.kind\|\|'image'\}\)/.test(read('estimate.html')));

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
