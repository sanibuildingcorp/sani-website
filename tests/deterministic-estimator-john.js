const assert = require('assert');
const { applyDeterministicPricing } = require('../netlify/functions/lib/deterministic-pricing');

const input = { request: { description: 'Apartment renovation. Painting approximately 2,600 SF of walls/ceilings/trim/doors. Install 640 SF engineered hardwood flooring with quarter round. Bathroom includes approximately 87 SF of 24x48 large-format porcelain tile. Windows: Option A replace all; Option B repair/replace selected windows.' } };
const analysis = { selected_trades: ['Bathroom','Flooring','Painting','Windows'], quantities: {} };
const estimate = {
  markupPct: 25,
  labor: [
    { section:'Painting', item:'Painter - prep and painting', qty:32, unit:'hrs', rate:75 },
    { section:'Flooring', item:'Engineered hardwood flooring installation', qty:20, unit:'hrs', rate:95 },
    { section:'Bathroom', item:'Tile setter - 24x48 large-format tile installation', qty:16, unit:'hrs', rate:110 },
    { section:'Bathroom', item:'Bathroom demolition and prep', qty:20, unit:'hrs', rate:75 },
    { section:'Windows', item:'Option A - replace all windows labor', qty:20, unit:'hrs', rate:95 },
    { section:'Windows', item:'Option B - repair selected windows labor', qty:12, unit:'hrs', rate:95 }
  ],
  materials: [
    { section:'Windows', item:'Option A - window installation materials', qty:1, unit:'allowance', rate:1800 },
    { section:'Windows', item:'Option B - repair materials', qty:1, unit:'allowance', rate:500 }
  ],
  customerSupplied: [], options: []
};

const out = applyDeterministicPricing(estimate, analysis, input);
const paint = out.labor.find(x => /painter/i.test(x.item));
const floor = out.labor.find(x => /hardwood/i.test(x.item));
const tile = out.labor.find(x => /tile setter/i.test(x.item));
assert(paint.qty >= 87, `painting expected >=87 hrs, got ${paint.qty}`);
assert(floor.qty >= 46, `flooring expected >=46 hrs, got ${floor.qty}`);
assert(tile.qty >= 22, `tile expected >=22 hrs, got ${tile.qty}`);
assert(!out.labor.some(x => /option b/i.test(x.item)), 'Option B labor must not remain in base labor');
assert(!out.materials.some(x => /option b/i.test(x.item)), 'Option B materials must not remain in base materials');
assert(out.options.some(x => /option b/i.test(x.label)), 'Option B must remain visible as an alternate');
assert(['PASS','REVIEW'].includes(out.estimateHealth.status), `health should not be BLOCKED: ${JSON.stringify(out.estimateHealth.issues)}`);
console.log(JSON.stringify({ paintingHours:paint.qty, flooringHours:floor.qty, tileHours:tile.qty, options:out.options, health:out.estimateHealth, totals:out.estimateHealth.totals }, null, 2));
