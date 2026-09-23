/* rename-card.test.js — run: node js/rename-card.test.js
 *
 *   "In estimate let's my Ask AI able to edit service cards title too"
 *   Ask AI: title (Windows): Windows -> Trim & Hardware
 *           "Nothing changed - Nothing matched: not found (Windows)"
 *
 * A reword edit with where "service" renames a card: every copy of the
 * card, every price line filed under it (so its price follows), supplies
 * and options filed under it, added-section records, the scope-of-work
 * header. Money never moves. A "title" edit whose from is a card's name
 * (what the model sent) renames the card too.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const R = require(path.join(ROOT, 'netlify/functions/lib/reword.js'));
const CC = require(path.join(ROOT, 'netlify/functions/lib/customer-cards.js'));
const ST = require(path.join(ROOT, 'netlify/functions/lib/scope-text.js'));
const ASSIST = fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant.js'), 'utf8');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

function rec() {
  const r = { ref: 'SBC-260923-R4A5', status: 'drafted', estimate: {
    projectTitle: 'Bedroom Trim Paint and Wall Cleanup', markupPct: 25,
    labor: [{ section: 'Windows', item: 'Remove outlet and switch covers, pull anchors', qty: 4, unit: 'hrs', rate: 75 }, { section: 'Windows', item: 'Paint 160 LF of trim', qty: 8, unit: 'hrs', rate: 75 }, { section: 'Painting', item: 'Paint walls', qty: 10, unit: 'hrs', rate: 60 }],
    materials: [{ section: 'Painting', item: 'Paint', qty: 1, unit: 'ls', rate: 200 }],
    customerSupplied: [{ item: 'Cover plates', section: 'Windows' }],
    serviceBreakdown: [{ title: 'Windows', subtotal: 900, included: ['We remove outlet and switch covers', 'We paint about 160 linear feet of trim'], customerSupplies: ['Cover plates'], notIncluded: ['Window repair'] }, { title: 'Painting', subtotal: 1000, included: ['We paint the walls'], customerSupplies: [], notIncluded: [] }],
    manualCustomerScopeDraft: { services: [{ name: 'Windows', subtotal: 900, included: ['We remove outlet and switch covers'], supplied: [], excluded: [], pinned: true }, { name: 'Painting', subtotal: 1000, included: ['We paint the walls'], supplied: [], excluded: [] }] },
    publishedCustomerScope: { services: [{ name: 'Windows', subtotal: 900, included: ['We remove outlet and switch covers'], supplied: [], excluded: [] }, { name: 'Painting', subtotal: 1000, included: ['We paint the walls'], supplied: [], excluded: [] }] },
    customerScopePublished: true,
  } };
  r.estimate.scopeOfWork = ST.scopeTextFromCards(r.estimate);
  return r;
}

console.log('\n1. Rename a card\n');
{
  const r = rec();
  const before = CC.customerCards(r).cards.map((c) => c.subtotal);
  let out = { applied: [], skipped: [] }, thrown = '';
  try { out = R.applyEdits(r, [{ where: 'service', from: 'Windows', to: 'Trim & Hardware' }]); } catch (x) { thrown = x.message; }
  ok('THE MONEY CHECK LETS A RENAME THROUGH (no price moved)', thrown === '', thrown);
  const e = r.estimate;
  ok('APPLIED, nothing refused', out.applied.length === 1 && out.skipped.length === 0, JSON.stringify(out));
  ok('EVERY COPY OF THE CARD: the estimator\'s card, the draft (still pinned), the published scope', e.serviceBreakdown[0].title === 'Trim & Hardware' && e.manualCustomerScopeDraft.services[0].name === 'Trim & Hardware' && e.manualCustomerScopeDraft.services[0].pinned === true && e.publishedCustomerScope.services[0].name === 'Trim & Hardware');
  ok('ITS PRICE LINES FOLLOW IT, the other card\'s lines do not move', e.labor[0].section === 'Trim & Hardware' && e.labor[1].section === 'Trim & Hardware' && e.labor[2].section === 'Painting' && e.materials[0].section === 'Painting');
  ok('...and its customer supplies', e.customerSupplied[0].section === 'Trim & Hardware');
  ok('THE SCOPE OF WORK HEADER follows (the box mirrors the cards)', /^TRIM & HARDWARE:\n/.test(e.scopeOfWork) && e.scopeOfWork.indexOf('WINDOWS') === -1, e.scopeOfWork.slice(0, 60));
  const after = CC.customerCards(r).cards;
  ok('THE PRICES ARE THE SAME, card by card', after.map((c) => c.subtotal).join(',') === before.join(',') && after[0].title === 'Trim & Hardware', JSON.stringify(after.map((c) => [c.title, c.subtotal])));
  ok('the estimate\'s own title is untouched', e.projectTitle === 'Bedroom Trim Paint and Wall Cleanup');
}

console.log('\n2. What the model actually sent, and the guards\n');
{
  const r = rec();
  const out = R.applyEdits(r, [{ where: 'title', service: 'Windows', from: 'Windows', to: 'Trim & Hardware' }]);
  ok('"title (Windows): Windows -> Trim & Hardware" RENAMES THE CARD (it was "Nothing matched")', out.applied.length === 1 && out.applied[0].where === 'service' && r.estimate.serviceBreakdown[0].title === 'Trim & Hardware' && r.estimate.projectTitle === 'Bedroom Trim Paint and Wall Cleanup', JSON.stringify(out));
  const r2 = rec();
  const o2 = R.applyEdits(r2, [{ where: 'card name', from: 'windows', to: 'Trim & Hardware' }]);
  ok('"card name", any case: the same', o2.applied.length === 1 && r2.estimate.serviceBreakdown[0].title === 'Trim & Hardware');
  const r3 = rec();
  let err = '';
  try { R.applyEdits(r3, [{ where: 'service', from: 'Windows', to: 'painting' }]); } catch (x) { err = x.message; }
  ok('A NAME ANOTHER CARD HAS is refused - it would merge two cards; nothing saved', /A card named "painting" already exists - renaming Windows would merge two cards/.test(err) && r3.estimate.serviceBreakdown[0].title === 'Windows', err);
  const r4 = rec();
  const o4 = R.applyEdits(r4, [{ where: 'service', from: 'Flooring', to: 'X' }]);
  ok('a card that does not exist: not found, nothing changed', o4.applied.length === 0 && o4.skipped[0].reason === 'not found');
  const r5 = rec(); R.applyEdits(r5, [{ where: 'service', from: 'Windows', to: 'Trim & Hardware' }]);
  const o5 = R.applyEdits(r5, [{ where: 'service', from: 'Windows', to: 'Trim & Hardware' }]);
  ok('done twice (a lost reply retried): the second is not a failure', o5.applied.length === 1 || (o5.skipped.length === 1 && o5.skipped[0].reason === 'not found'));
  const r6 = rec();
  let e6 = '';
  try { R.applyEdits(r6, [{ where: 'service', from: 'Windows', to: 'Trim & Hardware' }, { where: 'labor', from: 'Paint walls', to: 'Paint walls' }]); } catch (x) { e6 = x.message; }
  ok('a rename together with other edits still passes the money check', e6 === '', e6);
  const r7 = rec();
  const est7 = r7.estimate; const orig = est7.labor[0].rate;
  est7.labor[0].rate = orig; // unchanged
  const fpBefore = R.moneyFingerprint(rec(), { windows: 'Trim & Hardware' });
  R.applyEdits(r7, [{ where: 'service', from: 'Windows', to: 'Trim & Hardware' }]);
  ok('THE MONEY CHECK still bites: the renamed record, compared under the new name, is identical', R.moneyFingerprint(r7) === fpBefore);
}

console.log('\n3. The assistant and the confirm bubble\n');
{
  ok('THE ASSISTANT is told: where service renames a card, its price moves with it; title is the estimate\'s title, never a card', /service \(RENAME A SERVICE CARD - the card's heading the customer reads, e\.g\. Windows -> Trim & Hardware: from = the card's name as it is now, to = the new name; its price lines and its price move with it\)/.test(ASSIST) && /title is the ESTIMATE's title at the top of the page, never a card's name/.test(ASSIST));
  ok('"service" is a reword place the server accepts (ChatGPT\'s reword tool lists it too)', R.WHERE.indexOf('service') !== -1);
  ok('THE CONFIRM BUBBLE reads "Rename the service card: Windows -> Trim & Hardware"', /return "• Rename the service card:\\n   " \+ \(e\.from \|\| ""\) \+ "\\n   → " \+ \(e\.to \|\| ""\);/.test(DASH));
}
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
