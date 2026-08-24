/* ============================================================================
   lib/material-prices.js — real retail prices for every material line
   ----------------------------------------------------------------------------
   WHY

   Zura, comparing his estimator against a competing app on the identical job
   description: theirs came back at $13,946, his at $49,728. The difference was
   almost entirely materials. Theirs priced a vanity at $549 and a toilet at
   $199 — real products at real prices. His wrote "$22,700 of materials" for a
   bathroom under 40 square feet, because the model had been asked for a number
   and nothing anchored it to anything.

   No table of rules can fix that. A rule is just a different invented number.
   The fix is to look the product up.

   WHAT THIS DOES

   After the estimate is priced, every material line is looked up on Google
   Shopping through Serper, preferring Home Depot and the other US big-box
   suppliers. When a credible price comes back, it REPLACES the model's guess
   and the line is stamped with where the price came from. When it does not, the
   model's number is left exactly as it was.

   No house rules. No benchmark table. No calibration factor. The price of a
   toilet is the price of a toilet.

   BOUNDARIES
   - Materials only. Labour is not a product and cannot be looked up; that stays
     with the model informed by lib/market-research.js.
   - Customer-supplied items are skipped — Sani is not buying those.
   - Failure is free. No key, no network, no result: the estimate is untouched.
   ========================================================================== */

'use strict';

const https = require('https');

/* Bounded so a 30-line materials list cannot stall a generation that already
   takes ~160 seconds. Highest-value lines first — that is where the money is. */
const MAX_LOOKUPS = 14;
const LOOKUP_TIMEOUT_MS = 7000;

/* Trade suppliers first. A price from a marketplace reseller is often a
   mis-listed multipack or a different product with a similar name. */
const PREFERRED = [
  'homedepot.com', 'lowes.com', 'menards.com', 'fergusonhome.com',
  'build.com', 'floorandecor.com', 'sherwin-williams.com', 'wayfair.com'
];

/* Anything outside this is a scrape error, not a price: a model number read as
   a price, a whole pallet, a per-case figure for a single item. */
const SANE_MIN = 0.5;
const SANE_MAX = 8000;

/* GUARD UPWARD ONLY.
   A first version also refused a looked-up price that was far BELOW the model's
   figure, and that guard rejected the single case this whole pass exists for: a
   $4,200 invented "Bathroom fixtures and accessories" allowance refused a real
   $79 listing because the drop was "too large to trust". The model's number was
   never evidence of anything — it was a guess. A real listing always beats it,
   however far it falls.

   Upward is different. A price ABOVE the estimate is more likely a scrape error
   than a discovery: a pallet quantity, a contractor pack, a different product
   with a similar name. Those are refused. */
const MAX_UP = 3;
const BIG_DROP = 0.15;  /* below 15% of the guess — accepted, but worth Zura's eye */

function str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }
function clean(v) { return str(v).replace(/\s+/g, ' ').trim(); }
function num(v) {
  const n = Number(String(v == null ? '' : v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}
function money(v) { return Math.round((Number(v) || 0) * 100) / 100; }

/* Lines that are not a purchasable product. Looking these up returns noise. */
const NOT_A_PRODUCT = /\b(labor|labour|coordination|supervision|cleanup|clean up|disposal|debris|permit|filing|allowance for|delivery|freight|dump fee|protection of|management)\b/i;

function searchable(item) {
  const t = clean(item);
  if (!t || t.length < 4) return '';
  if (NOT_A_PRODUCT.test(t)) return '';
  /* Strip the estimator's descriptive tail — "…, sized to the opening", "(as
     selected by owner)" — which turns a good query into a bad one. */
  return t
    .replace(/\((?:[^)]*)\)/g, ' ')
    .replace(/\b(as|per)\s+(selected|specified|owner|customer)[^,]*/gi, ' ')
    .replace(/[,;].*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

function serperShopping(apiKey, query) {
  const payload = JSON.stringify({ q: query, gl: 'us', num: 10 });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'google.serper.dev',
      path: '/shopping',
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(Array.isArray(body && body.shopping) ? body.shopping : []);
        } catch (_) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(LOOKUP_TIMEOUT_MS, () => { req.destroy(); resolve([]); });
    req.write(payload);
    req.end();
  });
}

function sourceRank(r) {
  const link = clean(r && (r.link || r.source)).toLowerCase();
  const i = PREFERRED.findIndex(d => link.includes(d));
  return i === -1 ? PREFERRED.length : i;
}

/* Pick a price to trust. Not the cheapest — the cheapest shopping result is
   routinely an accessory, a sample tile, or a single knob for a $500 vanity.
   Take the preferred-supplier results, then their MEDIAN. */
function choosePrice(results) {
  const priced = (results || [])
    .map(r => ({ price: num(r && r.price), rank: sourceRank(r), title: clean(r && r.title), link: clean(r && (r.link || r.source)) }))
    .filter(r => Number.isFinite(r.price) && r.price >= SANE_MIN && r.price <= SANE_MAX);
  if (!priced.length) return null;

  const best = Math.min(...priced.map(r => r.rank));
  let pool = priced.filter(r => r.rank === best);
  if (pool.length < 3 && best < PREFERRED.length) {
    pool = priced.filter(r => r.rank <= best + 2);
  }
  if (!pool.length) pool = priced;

  const sorted = pool.slice().sort((a, b) => a.price - b.price);
  const mid = sorted[Math.floor(sorted.length / 2)];
  const host = (mid.link.match(/^https?:\/\/([^/]+)/) || [, ''])[1].replace(/^www\./, '');
  return { price: money(mid.price), title: mid.title, source: host || 'google shopping', samples: sorted.length };
}

function acceptable(found, guessed) {
  if (!Number.isFinite(guessed) || guessed <= 0) return true;   /* no guess to contradict */
  return found <= guessed * MAX_UP;
}
function isBigDrop(found, guessed) {
  return Number.isFinite(guessed) && guessed > 0 && found < guessed * BIG_DROP;
}

/* ---------------------------------------------------------------------------
   Entry point. `lookup(query)` is injected so this is testable without network.
--------------------------------------------------------------------------- */
async function priceMaterialsLive(estimate, lookup) {
  if (!estimate || !Array.isArray(estimate.materials) || !estimate.materials.length) return estimate;
  if (typeof lookup !== 'function') return estimate;

  const candidates = estimate.materials
    .map((m, i) => ({ m, i, q: searchable(m && m.item), value: (num(m.qty) || 0) * (num(m.rate) || 0) }))
    .filter(c => c.q)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_LOOKUPS);

  const priced = [];
  for (const c of candidates) {
    let hit = null;
    try { hit = choosePrice(await lookup(c.q)); } catch (_) { hit = null; }
    if (!hit) continue;

    const guessed = num(c.m.rate);
    if (!acceptable(hit.price, guessed)) {
      priced.push({ item: clean(c.m.item), skipped: true, guessed: money(guessed), found: hit.price, reason: 'Too far from the estimate to trust without a human look.' });
      continue;
    }

    priced.push({
      item: clean(c.m.item), from: money(guessed), to: hit.price,
      source: hit.source, matched: hit.title, samples: hit.samples,
      /* Not a rejection — the price stands. A flag so a very large correction is
         visible rather than silent, since a vague line can match a small accessory. */
      bigDrop: isBigDrop(hit.price, guessed) || undefined
    });
    c.m.rate = hit.price;
    c.m.sbcPricedFrom = hit.source;
    c.m.sbcMatchedProduct = hit.title;
  }

  if (priced.length) {
    const applied = priced.filter(p => !p.skipped);
    estimate.materialPricing = {
      version: 'material-prices-v1',
      at: new Date().toISOString(),
      lookedUp: candidates.length,
      repriced: applied.length,
      movedBy: money(applied.reduce((a, p) => a + (p.to - p.from), 0)),
      lines: priced
    };
  }
  return estimate;
}

module.exports = {
  priceMaterialsLive,
  isBigDrop,
  serperShopping,
  choosePrice,
  searchable,
  acceptable,
  MAX_LOOKUPS,
  PREFERRED
};
