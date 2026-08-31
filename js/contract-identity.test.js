/* contract-identity.test.js — run: node js/contract-identity.test.js
 *
 *   "i edited address and company name in my estimate ... but then when i sent
 *    to customer updated contract it shows in title still with previous address,
 *    i don't wanna regenerate contract or full estimate ... but i need edit in
 *    current contract"
 *
 * THE NAME AND THE ADDRESS ON THE SIGNATURE PAGE COULD NOT BE EDITED.
 *
 * The contract editor had fields for Project Type, Scope of Work, Materials,
 * Timeline, the payment schedule and four clauses. It had none for the two
 * things printed at the very top of the document the customer signs: WHO the
 * contract is with, and WHERE the work is.
 *
 * Both were captured once when the contract was generated and frozen there. On
 * the server it was worse than a missing field — customerName was written as
 * `prev.customerName || record.customer.name` and never read from the edit at
 * all, so even a caller that sent one was ignored.
 *
 * So a company name typed wrong the first time, or a job address that turned out
 * to differ from the billing address, stayed wrong on the contract forever. The
 * only way out was to regenerate — which replaces every hand-edited word of the
 * scope, the thing he explicitly did not want.
 *
 * AND THE HALF THAT IS EASY TO MISS: the AI writes the address INTO the scope
 * prose ("Install protection ... at 327 West 76th Street"). Correcting the
 * address field does not touch that sentence, so the panel says so out loud.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
const SAVE = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'save-contract.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

/* The panel builder, run in a context holding only what its own script block
   has — the escAttr lesson, again. esc2 is what that block uses. */
function ext(src, name) {
  const s = src.search(new RegExp('(window\\.)?' + name + ' = function\\('));
  if (s < 0) throw new Error('missing ' + name);
  let d = 0;
  for (let j = src.indexOf('{', s); j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return src.slice(s, j + 1) + ';'; }
  }
}
const ctx = { console, String, Number, Array, Object, Boolean, Math, JSON };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
/* esc2 as the contract block defines it. */
const esc2src = HTML.match(/function esc2\([\s\S]{0,400}?\n\s*\}/);
vm.runInContext(esc2src ? esc2src[0] : 'function esc2(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}', ctx);
vm.runInContext(ext(HTML, 'contractIdentityHtml'), ctx);
const panel = (rec) => vm.runInContext('contractIdentityHtml(' + JSON.stringify(rec) + ', "L", "I")', ctx);

/* The live record: the address was corrected on the estimate, the contract kept
   the old one, and the old one is also baked into the scope prose. */
function xqnq(over) {
  return Object.assign({
    ref: 'SBC-260821-XQNQ',
    customer: { name: 'Kono Designs LLC', address: '121 East 27th street, 514. New York, NY 10016' },
    contract: {
      customerName: 'Kono Designs LLC',
      projectAddress: '327 West 76th Street',
      sections: { projectType: 'Five-Story Staircase Squeak Elimination',
                  scopeOfWork: ['Comprehensive squeak survey at 327 West 76th Street'] },
    },
  }, over || {});
}

console.log('\nthe name and address on the signature page\n');

ok('the panel renders using only its own block',
  (function () { try { panel(xqnq()); return true; } catch (e) { return 'threw: ' + e.message; } })() === true,
  (function () { try { panel(xqnq()); return ''; } catch (e) { return e.message; } })());

{
  const h = panel(xqnq());
  ok('THERE IS NOW A FIELD FOR THE COMPANY NAME', /id="sbc-ct-name"/.test(h));
  ok('THERE IS NOW A FIELD FOR THE PROJECT ADDRESS', /id="sbc-ct-address"/.test(h));
  ok('...pre-filled with what the contract currently says, not what the estimate says',
    h.indexOf('value="327 West 76th Street"') !== -1, h.slice(0, 400));
  ok('THE DISAGREEMENT IS POINTED OUT — the estimate has been corrected and the contract has not',
    /The estimate says/.test(h) && h.indexOf('121 East 27th street') !== -1, h);
  ok('...with one tap to take the estimate\'s value', /sbcUseEstimateAddress\(\)/.test(h));
  ok('AND THE TRAP IS NAMED: the old address is also written into the scope prose',
    /may also appear inside the Scope of Work/.test(h), h.slice(-260));
}
{
  /* Name matches, address does not — only the address should be flagged. */
  const h = panel(xqnq());
  ok('a field that already agrees is not nagged about',
    (h.match(/The estimate says/g) || []).length === 1, (h.match(/The estimate says/g) || []).length + ' notices');
}
{
  const h = panel(xqnq({ contract: { customerName: 'Kono Designs LLC', projectAddress: '121 East 27th street, 514. New York, NY 10016', sections: {} } }));
  ok('when both agree, nothing is flagged at all',
    !/The estimate says/.test(h) && !/Scope of Work/.test(h), h);
  ok('...but the fields are still there to edit', /id="sbc-ct-name"/.test(h) && /id="sbc-ct-address"/.test(h));
}
{
  const h = panel(xqnq({ contract: { customerName: '', projectAddress: '', sections: {} } }));
  ok('an empty contract field is not nagged about either — there is nothing to contradict',
    !/The estimate says/.test(h));
}
ok('a record with a separate project address prefers it over the billing address',
  panel(xqnq({ projectAddress: '99 Job Site Road' })).indexOf('99 Job Site Road') !== -1);
ok('junk does not throw',
  (function () {
    try { panel(null); panel({}); panel({ contract: null }); panel({ contract: { customerName: 5 } }); return true; }
    catch (e) { return 'threw: ' + e.message; }
  })() === true);
{
  const nasty = panel(xqnq({ customer: { name: '<img src=x onerror=alert(1)>', address: '"><script>alert(1)</script>' } }));
  ok('a hostile value cannot inject markup or break out of the input',
    nasty.indexOf('<img src=x') === -1 && nasty.indexOf('"><script>') === -1, nasty.slice(0, 300));
}

/* ── the wiring ─────────────────────────────────────────────────────────── */
console.log('\nthe edit actually reaches the contract\n');
ok('the panel is rendered inside the contract editor', /contractIdentityHtml\(currentRecord, LBL, IN\)/.test(HTML));
ok('saving sends the company name', /customerName: fieldVal\('sbc-ct-name'\)/.test(HTML));
ok('saving sends the project address', /projectAddress: fieldVal\('sbc-ct-address'\)/.test(HTML));
ok('...and a missing input yields "" rather than throwing on .value',
  /function fieldVal\(id\)\{ var el = document\.getElementById\(id\); return el \? el\.value\.trim\(\) : ''; \}/.test(HTML));

console.log('\nand the server stores it\n');
ok('THE SERVER READS THE EDITED NAME — it used to ignore it completely',
  /sections\.customerName !== undefined/.test(SAVE) && /clean\(sections\.customerName, 200\)/.test(SAVE));
ok('...and the edited address', /sections\.projectAddress !== undefined/.test(SAVE));
ok('the old fallbacks survive for callers that send neither',
  /prev\.customerName \|\| \(record\.customer && record\.customer\.name\)/.test(SAVE) &&
  /prev\.projectAddress/.test(SAVE));
ok('a signed contract still refuses every edit', /already signed and can no longer be edited/.test(SAVE));
ok('the values are length-clamped like every other field', /clean\(sections\.projectAddress, 300\)/.test(SAVE));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
