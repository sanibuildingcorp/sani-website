/* email-thread.test.js — run: node js/email-thread.test.js
 *
 *   "1) inside the text message is light color and looks unimportant message
 *    to read. 2) in the email every new send messages goes separate in
 *    customer email ... to be in one place as a normal email we sent and
 *    received"
 *
 * Two fixes. The earlier message moves BELOW the new one, shorter, labelled
 * and readable. And every email about an estimate - quote, messages, receipt
 * - carries the same References id, so Gmail keeps them in one conversation.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const build = require(path.join(ROOT, 'netlify/functions/lib/message-email.js'));

console.log('\nthe new message first, the earlier one below and readable\n');
{
  const REC = { ref: 'SBC-260806-C5FC', status: 'sent', sentAt: '2026-09-01T00:00:00Z', customer: { name: 'Jan', email: 'j@example.com' }, request: { service: 'Apartment Renovation' }, estimate: { projectTitle: 'Apartment Renovation — 3855 Shore Pkwy, 1K' } };
  const long = 'Yes — found it. ' + 'A long earlier message about travertine tile prices. '.repeat(12);
  const m = build({ ref: REC.ref, record: REC, message: { from: 'contractor', text: 'Again test message', at: '2026-09-19T20:36:00Z' }, previous: { from: 'contractor', text: long, at: '2026-09-19T20:01:00Z' }, audience: 'customer', siteUrl: 'https://www.sanibuildingcorp.com' });
  const h = m.html;
  const iNew = h.indexOf('Again test message'), iOld = h.indexOf('Yes — found it.'), iCard = h.indexOf('Tap here to type your reply');
  ok('THE NEW MESSAGE COMES FIRST, the earlier one after it, then the reply card', iNew !== -1 && iOld !== -1 && iNew < iOld && iOld < iCard, iNew + ' ' + iOld + ' ' + iCard);
  ok('the new message is in dark text', /padding:16px 18px;white-space:pre-wrap;font-size:15px;line-height:1\.65;color:#0a1628/.test(h));
  ok('THE EARLIER MESSAGE IS READABLE GREY, NOT LIGHT, and labelled "Earlier"', /color:#444444/.test(h) && /Earlier &middot; Sani Building Corp/.test(h) && !/color:#7a7a7a/.test(h));
  ok('...and cut short, so it cannot push the new message off the screen', h.indexOf('A long earlier message about travertine tile prices. '.repeat(7)) === -1 && /…<\/div>/.test(h));
  const none = build({ ref: REC.ref, record: REC, message: { from: 'contractor', text: 'First one', at: '2026-09-19T20:36:00Z' }, audience: 'customer', siteUrl: 'https://www.sanibuildingcorp.com' });
  ok('no earlier message, no block', none.html.indexOf('Earlier &middot;') === -1);
}

console.log('\none conversation per estimate in the customer\'s Gmail\n');
{
  const hd = build.threadHeaders('SBC-260806-C5FC');
  ok('THE THREAD ID IS MADE FROM THE REF, stable, as a message id', hd['References'] === '<sbc-260806-c5fc@sanibuildingcorp.com>' && hd['In-Reply-To'] === hd['References'], JSON.stringify(hd));
  ok('...and the same call gives the same id every time', JSON.stringify(build.threadHeaders('SBC-260806-C5FC')) === JSON.stringify(hd));
  ok('a different estimate gets a different thread', build.threadHeaders('SBC-260915-UYE6')['References'] !== hd['References']);
  ok('the old tracking header is still there', hd['X-Entity-Ref-ID'] === 'SBC-260806-C5FC');
  const src = (f) => fs.readFileSync(path.join(ROOT, 'netlify/functions', f), 'utf8');
  ok('THE MESSAGE EMAIL CARRIES IT', /headers: buildMessageEmail\.threadHeaders\(ref\),/.test(src('thread-reply.js')) && !/headers: \{ "X-Entity-Ref-ID": ref \}/.test(src('thread-reply.js')));
  ok('the quote email carries it, so the quote and the messages after it are one thread', /headers: require\("\.\/lib\/message-email"\)\.threadHeaders\(ref\),/.test(src('send-quote.js')));
  ok('the approval receipt carries it', /headers: buildMessageEmail\.threadHeaders\(ref\),/.test(src('quote-response.js')));
  ok('the customer subject is the same on every message, which Gmail also needs', build({ ref: 'R', record: { estimate: { projectTitle: 'T' } }, message: { text: 'a' }, audience: 'customer' }).subject === build({ ref: 'R', record: { estimate: { projectTitle: 'T' } }, message: { text: 'b' }, audience: 'customer' }).subject);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
