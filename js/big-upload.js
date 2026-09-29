/* big-upload.js - a customer's big file goes straight to storage.
 *
 *   "customers who said they uploaded file but i can't see any file"
 *
 * The forms sent files to upload-photo inside a JSON body, which a Netlify
 * function refuses over ~6 MB (a 4.5 MB file, once base64). Such a file now
 * gets a one-time upload link from customer-upload-url and is PUT to storage
 * directly - up to the 15 MB the forms allow. Small files keep the old path.
 *
 * sbcIsBig(dataUrl)            -> true when the old path cannot take it
 * sbcBigUpload(dataUrl, ref, name) -> Promise<public link>; throws with a reason
 * Loaded by estimate.html, contact.html and quote.html.
 */
var SBC_BIG_UPLOAD_CHARS = 4000000;   /* ~3 MB file; upload-photo takes up to ~4.5 MB */
function sbcIsBig(dataUrl) { return typeof dataUrl === "string" && dataUrl.length > SBC_BIG_UPLOAD_CHARS; }
function sbcDataUrlToBlob(dataUrl) {
  var m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(String(dataUrl || ""));
  if (!m) throw new Error("not a file");
  var type = (m[1] || "application/octet-stream").toLowerCase();
  var bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: type });
}
async function sbcBigUpload(dataUrl, ref, name) {
  var blob = sbcDataUrlToBlob(dataUrl);
  var last = null;
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var r = await fetch("/.netlify/functions/customer-upload-url", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: ref, fileName: name || "file", contentType: blob.type, size: blob.size })
      });
      var j = await r.json().catch(function () { return null; });
      if (!r.ok || !j || !j.signedUrl) throw new Error((j && j.error) || ("upload link " + r.status));
      var put = await fetch(j.signedUrl, { method: "PUT", headers: { "Content-Type": blob.type, "x-upsert": "true" }, body: blob });
      if (!put.ok) throw new Error("storage " + put.status);
      return j.publicUrl;
    } catch (e) {
      last = e;
      if (/too large|Only photos/i.test(String(e && e.message))) break;   /* no point trying again */
    }
  }
  throw last || new Error("upload failed");
}
