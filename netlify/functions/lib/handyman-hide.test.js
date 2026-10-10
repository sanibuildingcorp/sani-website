const assert = require('assert'), path = require('path'), fs = require('fs');
const { apply } = require(path.join(__dirname, '..', 'handyman-hide.js'))._test;
assert.deepStrictEqual(apply({}, 'SBC-H-1', true, 'd'), { 'SBC-H-1': 'd' });
assert.deepStrictEqual(apply({ 'SBC-H-1': 'd' }, 'SBC-H-1', false, 'x'), {});
const H = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'dashboard.html'), 'utf8');
assert.ok(/Delete this order/.test(H) && /Bring back/.test(H) && /handymanBookings = handymanBookings\.filter\(function \(b\) \{ return !HB_DELETED\[b\.ref\]; \}\);/.test(H));
console.log('handyman-hide: 3 pass');
