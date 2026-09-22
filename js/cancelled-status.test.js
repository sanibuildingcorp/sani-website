/* cancelled-status.test.js — run: node js/cancelled-status.test.js
 *
 *   "I need to mark cancelled too"
 *
 * Declined is the customer saying no to the price. Cancelled is a job that
 * stopped for any other reason, before or after it was agreed. It is a
 * status like the others: a tab, a badge, a button on the estimate (with
 * Reopen putting the old status back), the assistant's status action, and
 * a job that waits on nobody.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const ASSIST = fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant.js'), 'utf8');
const MCP = fs.readFileSync(path.join(ROOT, 'netlify/functions/chatgpt-mcp.js'), 'utf8');
const T = require(path.join(ROOT, 'netlify/functions/lib/thread.js'));

console.log('\n1. The dashboard: tab, badge, count, button\n');
{
  ok('A CANCELLED TAB in both tab lists, after Declined', /\{ id: "declined", label: "Declined" \},\s*\{ id: "cancelled", label: "Cancelled" \},/.test(DASH) && /\{id:'declined', icon:'❌', label:'Declined'\},\s*\{id:'cancelled', icon:'🚫', label:'Cancelled'\},/.test(DASH));
  ok('...counted, and accepted as a tab in the URL', /declined:0,cancelled:0,handyman:0/.test(DASH) && /'declined','cancelled','handyman'\]/.test(DASH));
  ok('a grey badge', /\.badge\.cancelled \{ background: #e5e7eb; color: #4b5563; \}/.test(DASH));
  ok('THE BUTTON: Mark Cancelled on any open estimate, Reopen on a cancelled one, nothing on a completed one', /currentRecord\.status === 'cancelled'\s*\? '<button class="btn-secondary" onclick="markCancelled\(false\)">↩ Reopen<\/button>'\s*: \(currentRecord && currentRecord\.status !== 'completed' \? '<button class="btn-secondary" onclick="markCancelled\(true\)">🚫 Mark Cancelled<\/button>' : ''\)\)/.test(DASH));
  ok('markCancelled saves status cancelled with the date and the status it had; Reopen puts that status back', /async function markCancelled\(on\)/.test(DASH) && /var next = on \? "cancelled" : back;/.test(DASH) && /var fields = on \? \{ cancelledAt: new Date\(\)\.toISOString\(\), statusBeforeCancel: was \} : \{ cancelledAt: null, statusBeforeCancel: null \};/.test(DASH) && /var back = \(currentRecord\.estimate && currentRecord\.estimate\.statusBeforeCancel\) \|\| "drafted";/.test(DASH) && /body: JSON\.stringify\(\{ ref: currentRecord\.ref, status: next, estimate: fields \}\)/.test(DASH));
  ok('a cancelled job is never WAITING FOR CUSTOMER (dashboard rule)', /if \(\/\^\(declined\|completed\|cancelled\)\$\/i\.test\(String\(r\.status \|\| ""\)\)\) return false;/.test(DASH));
}

console.log('\n2. The server\n');
{
  ok('waitingOnCustomer: a cancelled job waits on nobody', T.waitingOnCustomer({ status: 'cancelled', thread: [{ id: 'a', from: 'contractor', text: 'hi', at: '2026-09-21T10:00:00Z' }] }) === false && T.waitingOnCustomer({ status: 'cancelled', waitingOnCustomer: true }) === false);
  const rows = [{ ref: 'A', status: 'cancelled', updatedAt: '2026-09-21T10:00:00Z', customer: { email: 'x@example.com' } }, { ref: 'B', status: 'sent', updatedAt: '2026-09-01T10:00:00Z', customer: { email: 'x@example.com' } }];
  const pick = T.pickEstimateForEmail(rows);
  ok('an email from the customer goes to the open job, not the cancelled one', pick === 'B', JSON.stringify(pick));
  ok('THE ASSISTANT may set cancelled, switch to the tab, and is told declined is no to the price and cancelled is the job stopping', /const STATUSES = \["new", "drafted", "sent", "accepted", "declined", "completed", "cancelled"\];/.test(ASSIST) && /"declined", "cancelled", "handyman"/.test(ASSIST) && /declined = THE CUSTOMER declined it; cancelled = ZURA cancelled it himself/.test(ASSIST) && /When he says cancel or cancelled, send cancelled, never declined; when he says the customer said no, send declined\./.test(ASSIST));
  ok('ChatGPT\'s list tool knows the status', /declined, completed, cancelled\)/.test(MCP));
}
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
