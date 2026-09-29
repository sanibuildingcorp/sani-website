/* customer-upload.test.js — run: node js/customer-upload.test.js
 *
 *   "I have couple like this customers who said they uploaded file but i can't
 *    see any file, check if you can find it's them missing to uploaded or it
 *    from our side"
 *
 * It was our side. The forms allow 15 MB, but sent each file to upload-photo
 * as base64 in a JSON body, which a Netlify function refuses over ~6 MB - a
 * 4.5 MB file. The form skipped the file without a word and said "sent".
 * Storage showed it: of 272 customer files since June, the biggest is 4.49 MB.
 *
 * Now a big file gets a one-time upload link (customer-upload-url) and goes
 * straight to storage; a file that still fails is NAMED to the customer, who
 * can send without it or try again. Checked in a browser: a 6 MB PDF arrived
 * whole (6,291,456 bytes), and with the link service down it was named.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const HELPER = read('js/big-upload.js');
const EST = read('estimate.html'), CON = read('contact.html'), QUO = read('quote.html');

(async () => {
  console.log('\n1. the upload link\n');
  {
    process.env.SUPABASE_URL = 'https://sb.example.co'; process.env.SUPABASE_SECRET_KEY = 'sk';
    let asked = null;
    global.fetch = async (url) => { asked = String(url); return { ok: true, status: 200, json: async () => ({ url: '/object/upload/sign/estimate-photos/x?token=t' }), text: async () => '' }; };
    const { handler } = require(path.join(ROOT, 'netlify/functions/customer-upload-url.js'));
    const call = (b) => handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(b) });
    let r = await call({ ref: 'SBC-260929-AB12', fileName: 'A-801.pdf', contentType: 'application/pdf', size: 6291456 });
    const j = JSON.parse(r.body);
    ok('A 6 MB PDF GETS AN UPLOAD LINK, in the job\'s own folder of estimate-photos', r.statusCode === 200 && /\/storage\/v1\/object\/upload\/sign\/estimate-photos\/SBC-260929-AB12\/\d+-[a-z0-9]{6}\.pdf$/.test(asked) && /^https:\/\/sb\.example\.co\/storage\/v1\/object\/public\/estimate-photos\/SBC-260929-AB12\/\d+-[a-z0-9]{6}\.pdf$/.test(j.publicUrl) && /token=t/.test(j.signedUrl), asked);
    ok('photos, Word and drawing files too', (await call({ ref: 'r', contentType: 'image/heic', size: 1 })).statusCode === 200 && (await call({ ref: 'r', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 1 })).statusCode === 200);
    ok('never other file types', (await call({ ref: 'r', contentType: 'application/x-msdownload', size: 1 })).statusCode === 400 && (await call({ ref: 'r', contentType: 'text/html', size: 1 })).statusCode === 400);
    ok('never over 15 MB', (await call({ ref: 'r', contentType: 'application/pdf', size: 16 * 1024 * 1024 })).statusCode === 400);
    await call({ ref: '../../etc', contentType: 'image/jpeg', size: 1 });
    ok('a strange ref cannot leave its folder', /estimate-photos\/etc\/\d+/.test(asked), asked);
  }

  console.log('\n2. the browser side\n');
  {
    const puts = [];
    const ctx = { atob: (s) => Buffer.from(s, 'base64').toString('binary'), Blob: class { constructor(parts, o) { this.size = parts[0].length; this.type = o.type; } }, Uint8Array, console,
      fetch: async (url, o) => { if (/customer-upload-url/.test(url)) return { ok: true, status: 200, json: async () => ({ signedUrl: 'https://s/put', publicUrl: 'https://s/pub.pdf' }) }; puts.push({ url, type: o.headers['Content-Type'], size: o.body.size }); return { ok: true, status: 200 }; } };
    vm.createContext(ctx); vm.runInContext(HELPER, ctx);
    const big = 'data:application/pdf;base64,' + Buffer.alloc(3200000).toString('base64');
    ok('over ~3 MB a file takes the direct road; small ones keep the old one', ctx.sbcIsBig(big) === true && ctx.sbcIsBig('data:image/jpeg;base64,AAAA') === false);
    const url = await ctx.sbcBigUpload(big, 'SBC-1', 'A.pdf');
    ok('THE FILE IS PUT STRAIGHT TO STORAGE, whole, and its link comes back', url === 'https://s/pub.pdf' && puts.length === 1 && puts[0].url === 'https://s/put' && puts[0].type === 'application/pdf' && puts[0].size === 3200000, JSON.stringify(puts));
    ctx.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: 'File too large (max 15 MB)' }) });
    let err = null; try { await ctx.sbcBigUpload(big, 'r', 'A.pdf'); } catch (e) { err = e; }
    ok('a refused file throws with the reason (so it is named, not dropped)', !!err && /too large/.test(err.message));
  }

  console.log('\n3. the three pages\n');
  ok('ESTIMATE FORM: big files go direct; a failed file is named and the customer chooses', /<script src="js\/big-upload\.js"><\/script>/.test(EST) && /if\(typeof sbcIsBig==='function'&&sbcIsBig\(data\)\)\{\s*const url=await sbcBigUpload\(data,ref,p\.name\);/.test(EST) && /uploadFailed\.push\(p\.name\|\|\('file '\+\(i\+1\)\)\);/.test(EST) && /if\(uploadFailed\.length&&!confirm\('We could not send '/.test(EST) && /or Cancel to try again\./.test(EST));
  ok('...the old silent skip is gone', !/If this one fails, skip it rather than bloat the payload with base64/.test(EST));
  ok('CONTACT FORM: the same', /<script src="js\/big-upload\.js"><\/script>/.test(CON) && /var big = await sbcBigUpload\(p\.data, ref, p\.name\);/.test(CON) && /contactUploadFailed\.push\(p\.name \|\| \("file " \+ \(i\+1\)\)\);/.test(CON) && /if\(contactUploadFailed\.length&&!confirm\("We could not send "/.test(CON));
  {
    const fns = HELPER.slice(HELPER.indexOf('var SBC_BIG_UPLOAD_CHARS')).trim();
    ok('QUOTE PAGE: its own copy (it loads no <script src>) - identical to js/big-upload.js', QUO.indexOf(fns) !== -1 && !/<script src=/.test(QUO));
    ok('...big files go direct there too, and a failed file is named before sending', /if\(sbcIsBig\(data\)\)\{out\.push\(\{name:f\.name\|\|'file',url:await sbcBigUpload\(data,ref,f\.name\)/.test(QUO) && /msgUploadFailed\.push\(f&&f\.name\|\|'file'\)/.test(QUO) && /if\(msgUploadFailed\.length&&\(p\.attachments\.length\|\|p\.questionText\)&&!confirm\('We could not send '/.test(QUO));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
