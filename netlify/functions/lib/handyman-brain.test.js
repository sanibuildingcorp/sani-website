const assert = require('assert');
const b = require('./handyman-brain');
const rates = { hourly: 150, minimumCharge: 300, materialMarkupPct: 20 };
const o = { plan: { title: 'Remove 2 shutters', tasks: [{ task: 'Remove shutters', hours: 2, workers: 2, materialCost: 0 }, { task: 'Patch + touch-up', hours: 1, materialCost: 30 }], flatPrice: null, visitHours: '2-3 hours', tools: ['Drill'], warnings: ['COI needed'], customer: { scope: 'We are licensed to remove...', ready: ['COI sent to building'] }, confidence: 'high' } };
const p = b.validate(o, null, rates);
assert.strictEqual(p.price.labor, 750);            // (2x2 + 1) h x 150
assert.strictEqual(p.price.materials, 36);
assert.strictEqual(p.price.total, 790);            // 786 up to $5
assert.ok(!/licen/i.test(p.customer.scope));
// minimum visit
assert.strictEqual(b.validate({ plan: { tasks: [{ task: 'Hang 1 picture', hours: 0.5 }] } }, null, rates).price.total, 300);
// flat price wins, and is kept when the next answer omits it
const f = b.validate({ plan: Object.assign({}, o.plan, { flatPrice: 650 }) }, null, rates);
assert.strictEqual(f.price.total, 650);
const g = Object.assign({}, o.plan); delete g.flatPrice;
assert.strictEqual(b.validate({ plan: g }, f, rates).price.total, 650);
// bad answer never wipes a plan
assert.strictEqual(b.validate({ reply: 'hi' }, f, rates), null);
// send fields
const s = b.sendFields(p);
assert.strictEqual(s.fixedPrice, 790); assert.ok(/Please have ready: COI/.test(s.specialNotes));
assert.ok(b.parse('ok ```json\n{"a":1}\n```').a === 1);
console.log('handyman-brain: 9 pass');
