/* ONE brain: the chat writes the estimate; code keeps the laws. */
const B = require('../netlify/functions/lib/estimator-brain');
const fs = require('fs');
let pass = 0, fail = 0; const ok = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL ', n); } };
const prev = { markupPct: 50, labor: [{ section: 'Bathroom', item: 'Glass door install', qty: 1, unit: 'ea', rate: 400, byHand: true }, { section: 'Bathroom', item: 'Wall tile installation', qty: 60, unit: 'sf', rate: 18, rateByHand: true, bookId: 'wall_tile' }], materials: [] };
const ch = { summary: 'We turn the tub into a walk-in shower for $9,000.', services: [{ name: 'Bathroom', included: ['Tub and alcove walls only'], excluded: ['Other walls stay as they are'], supplied: ['Wall tile'] }],
  workSteps: [{ title: 'Demolition', text: 'We remove the tub and the walls around it only.' }, { title: 'Cement board', text: 'Cement board on the three shower walls, floor to ceiling.' }],
  labor: [{ section: 'Bathroom', item: 'Tub + surround demolition', qty: 1, unit: 'job', rate: 999, bookId: 'tub_alcove_demo' }, { section: 'Bathroom', item: 'Wall tile installation', qty: 80, unit: 'sf', rate: 14, bookId: 'wall_tile' },
    { section: 'Bathroom', item: 'Shower niche framing', qty: 1, unit: 'ea', rate: 180, priced: 'ai' }, { section: 'Kitchen', item: 'Gas range hookup', qty: 1, unit: 'ea', rate: 100 }],
  materials: [{ section: 'Bathroom', item: 'Shower drain body', qty: 1, unit: 'ea', rate: 10, bookId: 'shower_pan_mortar' }] };
const e = B.validate(ch, prev);
const L = (n) => e.labor.find((l) => l.item === n);
ok('book rate wins over the AI rate', L('Tub + surround demolition').rate === 650);
ok('book material cost wins', e.materials[0].rate === 95);
ok('his own line comes back exactly', L('Glass door install') && L('Glass door install').rate === 400 && L('Glass door install').byHand);
ok('his own rate stays', L('Wall tile installation').rate === 18 && L('Wall tile installation').qty === 80);
ok('brain-priced work is flagged for him', L('Shower niche framing').aiPriced && e.warnings.some((w) => /AI priced.*niche/i.test(w)));
ok('no gas work', !e.labor.some((l) => /gas/i.test(l.item)));
ok('no price in customer text', !/\$/.test(e.summary));
ok('scope steps are the brain\'s own words', e.workSteps.length === 2 && /walls around it only/.test(e.workSteps[0].text));
ok('excluded and supplied reach the scope', e.manualCustomerScopeDraft.services[0].excluded[0] === 'Other walls stay as they are' && e.customerSupplied[0].item === 'Wall tile');
ok('no change -> null', B.validate(null, prev) === null && B.validate({ labor: [] }, prev) === null);
const p = B.prompt({ request: {} }, B.currentOf(prev), '', 'build it', 0);
ok('prompt has trade sense, price book and current estimate', /60 x 30 inches/.test(p) && /tub_alcove_demo/.test(p) && /Glass door install/.test(p) && /catch mistakes/i.test(p));
const g = fs.readFileSync(__dirname + '/../netlify/functions/generate-v5-background.js', 'utf8'), d = fs.readFileSync(__dirname + '/../dashboard.html', 'utf8');
ok('chat goes to the brain and parks a change list', /brainReply\(record, msg, att\)/.test(g) && /estimateV5Pending = Object\.assign\(\{ at: now\(\), jobId: jid, brain: true \}/.test(g));
ok('dashboard shows the change list after the brain builds', /PZ\.v5mode = "brain"; try \{ pzV5Changes/.test(d) && /function pzBrainBuild/.test(d));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
