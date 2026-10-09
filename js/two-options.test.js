/* Two ways to do the job: Option 2 = extra lines, priced by the book, offered as a customer option. */
const assert = require('assert');
const brain = require('../netlify/functions/lib/estimator-brain.js');
const { resolveSelection } = require('../netlify/functions/lib/quote-options.js');
let pass = 0, fail = 0; const ok = (n, c) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n); } };
const change = { labor: [{ section: 'Bathroom', item: 'Wall tile installation', qty: 30, unit: 'sf', rate: 14, priced: 'his' }], materials: [],
  services: [{ name: 'Bathroom', included: ['x'], excluded: ['y'] }],
  alternative: { baseLabel: 'Keep upper wall tile', baseDescription: 'Small-format tile', label: 'Full wall replacement to ceiling', description: 'Large-format tile', included: ['All 3 walls to ceiling'],
    labor: [{ section: 'Bathroom', item: 'Wall tile installation (upper walls)', qty: 50, unit: 'sf', rate: 14, priced: 'his' }], materials: [] } };
const est = brain.validate(change, {});
ok('Option 1 label gets "Option 1 — "', est.choice && /^Option 1 — Keep upper/.test(est.choice.base.label));
ok('Option 2 label gets "Option 2 — "', /^Option 2 — Full wall/.test(est.choice.alt.label));
ok('Option 2 keeps only its extra lines', est.choice.alt.labor.length === 1 && est.labor.length === 1);
const again = brain.validate(Object.assign({}, change, { alternative: undefined }), est);
ok('a rebuild without "alternative" keeps Option 2', again.choice && again.choice.alt.label === est.choice.alt.label);
const drop = brain.validate(Object.assign({}, change, { alternative: null }), est);
ok('"alternative": null drops it', !drop.choice);
const record = { options: [{ section: 'Bathroom', label: est.choice.alt.label, price: 1056, fromChoice: true }] };
const r = resolveSelection(record, [require('../netlify/functions/lib/quote-options.js').optionId(est.choice.alt.label)]);
ok('the server prices Option 2 from the record', r.total === 1056);
console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
