/* "Demo only around the bathtub" must never become "Bathroom demolition to studs".
   130 Jackson St, Oct 2026. */
const R = require('../netlify/functions/lib/job-reader-v5');
const E = require('../netlify/functions/lib/estimate-engine-v5');
const { tubOnly, TRADE_SENSE } = require('../netlify/functions/lib/trade-sense');
let pass = 0, fail = 0; const ok = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL ', n); } };

const notes = ['His bathroom tub to walking shower transforming need only shower area tiling and outside the shower is just painted walls', 'Remind we can demo only around bathtub for transform tub to walking shower.'];
const raw = { services: [{ name: 'Bathroom', items: [{ id: 'bath_demo_gut', qty: 90 }, { id: 'bath_backer', qty: 140 }, { id: 'wall_tile', qty: 120 }, { id: 'waterproof', qty: 93 }, { id: 'shower_pan_mortar', qty: 1 }, { id: 'shower_valve', qty: 1 }, { id: 'shower_glass', qty: 1 }] }],
  scopeSteps: [{ title: 'Demolition', text: 'We remove the bathtub and the walls around it only. The other walls stay as they are.' }, { title: 'Cement board', text: 'Cement board on the three shower walls, floor to ceiling.' }] };
const rd = R.validate(raw, { request: { services: ['Bathroom'] }, contractorNotes: notes });
const ids = rd.services[0].items.map((i) => i.id);
ok('owner said tub only -> tubOnly', rd.tubOnly === true);
ok('no demolition to studs', !ids.includes('bath_demo_gut') && ids.includes('tub_alcove_demo'));
ok('cement board on the wet walls only, max 80 sf', !ids.includes('bath_backer') && rd.services[0].items.find((i) => i.id === 'wet_backer').qty <= 80);
ok('wall tile capped to the alcove', rd.services[0].items.find((i) => i.id === 'wall_tile').qty <= 80);
const est = E.build(rd);
ok('customer steps are his words', est.workSteps.some((s) => /walls around it only/.test(s.text)) && !est.workSteps.some((s) => /down to the studs|other walls\./.test(s.text) && !/stay/.test(s.text)));
ok('protection first, cleanup last', est.workSteps[0].bookId === 'protect' && est.workSteps[est.workSteps.length - 1].bookId === 'cleanup');
ok('no "to the studs" anywhere in the scope', !/studs/.test(JSON.stringify(est)));
ok('full gut words keep the gut', !tubOnly('full gut renovation, demo only around tub first'));
ok('customer words alone do not switch', R.validate(raw, { request: { services: ['Bathroom'], description: 'demo only around tub' }, contractorNotes: [] }).services[0].items.some((i) => i.id === 'bath_demo_gut'));
ok('both brains share the sizes', /60 x 30 inches/.test(TRADE_SENSE) && /80 sf/.test(TRADE_SENSE));
ok('chat prompt uses the same knowledge', /trade-sense'\)\.TRADE_SENSE/.test(require('fs').readFileSync(__dirname + '/../netlify/functions/generate-v5-background.js', 'utf8')));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
