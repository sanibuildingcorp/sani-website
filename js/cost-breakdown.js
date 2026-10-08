/* Customer cost breakdown (estimate.showCostBreakdown, off by default).
   Per service: Labor / Materials / Other (disposal, protection, permits...).
   Every amount is the line's share of the CUSTOMER total: markup, a hand-set
   total and added options are spread in proportion, so the rows add up to the
   price to the cent and no cost, rate or profit can be worked back out.
   Used by quote.html and netlify/functions/lib/estimate-pdf.js. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.costBreakdown = factory();
})(typeof self !== "undefined" ? self : this, function () {
  var OTHER = /dispos|dumpster|container|contractor bags|debris|haul|protect|permit|filing|delivery|parking|elevator|clean.?up|travel|insurance|coi\b|fee\b/i;
  var WORK = /demo|tear.?out|install|tile|plumb|frame|framing|build|drywall|sheetrock|paint|carpent|electric|waterproof|set\b|rough/i;
  var C = function (x) { return String(x == null ? "" : x).trim(); };
  var key = function (x) { return C(x).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); };
  var LT = function (l) { return (Number(l && l.qty) || 0) * (Number(l && l.rate) || 0); };
  function build(e, services, total) {
    e = e || {}; total = Number(total) || 0;
    var names = (services || []).map(C).filter(Boolean);
    var rows = {}; var order = [];
    var row = function (n) { if (!rows[n]) { rows[n] = { title: n, labor: 0, materials: 0, other: 0 }; order.push(n); } return rows[n]; };
    names.forEach(row);
    var put = function (l, kind) {
      var v = LT(l); if (!(v > 0)) return;
      var sec = C(l.section), hit = names.filter(function (n) { return key(n) === key(sec); })[0];
      var r = row(hit || (names.length === 1 ? names[0] : "Whole project"));
      var it = C(l.item);
      /* "Demolition to studs + disposal" is labor: only lines that are ABOUT
         disposal, protection, permits... go to Other. */
      r[OTHER.test(it) && !WORK.test(it) ? "other" : kind] += v;
    };
    (Array.isArray(e.labor) ? e.labor : []).forEach(function (l) { put(l, "labor"); });
    (Array.isArray(e.materials) ? e.materials : []).forEach(function (l) { put(l, "materials"); });
    var raw = 0; order.forEach(function (n) { var r = rows[n]; raw += r.labor + r.materials + r.other; });
    if (!(raw > 0) || !(total > 0)) return null;
    var f = total / raw, cells = [];
    order.forEach(function (n) { var r = rows[n]; ["labor", "materials", "other"].forEach(function (k) { r[k] = Math.round(r[k] * f); if (r[k]) cells.push([r, k]); }); });
    /* whole dollars, the cents left over go on the biggest cell */
    var sum = 0; order.forEach(function (n) { var r = rows[n]; sum += r.labor + r.materials + r.other; });
    var diff = Math.round((total - sum) * 100) / 100;
    if (diff && cells.length) { cells.sort(function (a, b) { return b[0][b[1]] - a[0][a[1]]; }); cells[0][0][cells[0][1]] = Math.round((cells[0][0][cells[0][1]] + diff) * 100) / 100; }
    var list = order.map(function (n) { var r = rows[n]; r.total = Math.round((r.labor + r.materials + r.other) * 100) / 100; return r; }).filter(function (r) { return r.total > 0; });
    var all = { labor: 0, materials: 0, other: 0 };
    list.forEach(function (r) { all.labor += r.labor; all.materials += r.materials; all.other += r.other; });
    Object.keys(all).forEach(function (k) { all[k] = Math.round(all[k] * 100) / 100; });
    return { services: list, totals: all, total: total };
  }
  return { build: build };
});
