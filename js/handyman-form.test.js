/* handyman-form.test.js — run: node js/handyman-form.test.js
 *
 *   "This is a in handyman request form, i need it upgrade for more smart for
 *    my business and my understanding"
 *
 * The owner picked: several jobs in one request; job size and place
 * questions; smarter, fewer photo questions; a clear job brief in the
 * dashboard; the natural look with a plain headline. The browser run that
 * walked every step on a phone (no sideways scroll, the date box inside the
 * card, the payload below) is in the PR; this checks what it left behind.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
const H = read('handyman-estimate.html');

console.log('\n1. The form\n');
ok('no "Full Handyman Day", no day rate, no "From $" prices on the page', !/Full Handyman Day|full-handyman-day|\/day|From \$/i.test(H));
ok('Bathroom Refresh is a service, with its own items', /id: "bathroom-refresh", icon: "🛁", name: "Bathroom Refresh"/.test(H) && /"Regrout tub \/ shower", "Re-caulk", "New faucet"/.test(H));
ok('...and /handyman-estimate?service=bathroom-refresh opens with it ticked', /get\('service'\)/.test(H) && /\/handyman-estimate\?service=bathroom-refresh/.test(read('handyman.html')));
ok('SEVERAL SERVICES: a card toggles, it does not jump to the next step', /function toggleService\(id\)/.test(H) && /state\.services\.splice\(i, 1\)/.test(H) && !/setTimeout\(function\(\) \{ goToStep\(2\)/.test(H));
ok('SEVERAL ITEMS per service, tapped as chips, plus the list in their own words', /state\.items\[id\]/.test(H) && /id="own-words"/.test(H));
const groups = (H.match(/data-single="(\w+)"/g) || []).map((x) => x.match(/"(\w+)"/)[1]);
ok('SIZE AND PLACE: how many things, where, floor and access, parts, how soon', JSON.stringify(groups) === JSON.stringify(['job_size', 'place', 'access', 'parts', 'when']), groups.join(','));
ok('...how many, where and how soon are required; access and parts are optional', /\[\['job_size', 'how many things'\], \['place', 'where the job is'\], \['when', 'how soon'\]\]/.test(H));
ok('...a restaurant and an office are places, not only homes', /<div class="chip">Restaurant<\/div>/.test(H) && /<div class="chip">Office or store<\/div>/.test(H));
ok('never TV mounting, never "licensed"', !/\bTV\b/.test(H) && !/\blicensed\b/i.test(H));
ok('PLAIN HEADLINE: "Get a free handyman quote", no "AI-Powered"', /<h1>Get a free handyman quote<\/h1>/.test(H) && !/AI-Powered/i.test(H));
ok('NATURAL LOOK: the homepage fonts, no Playfair or DM Sans download', /family=Archivo/.test(H) && /Source\+Sans\+3/.test(H) && !/Playfair|DM\+Sans/.test(H));
ok('...reading text 16px and up everywhere on the page', (H.match(/font-size:(\d+)px/g) || []).every((x) => +x.match(/\d+/)[0] >= 16), (H.match(/font-size:(\d+)px/g) || []).filter((x) => +x.match(/\d+/)[0] < 16).join(' '));
ok('THE DATE BOX stays inside the card on an iPhone', /\.input-text, \.input-textarea \{ display:block; width:100%; min-width:0; max-width:100%;[^}]*-webkit-appearance:none/.test(H));
ok('THE PHOTO BOX is a block (a bare <label> drew broken dashed pieces)', /\.photo-zone \{ display:flex;/.test(H));
ok('photos are optional: the button says "Skip photos" until one is added', /Skip photos →/.test(H));
ok('the customer never sees a price', !/estimatedLabor|\$\d/.test(H.replace(/\$\{[^}]*\}/g, '')));

console.log('\n2. What reaches the dashboard\n');
ok('the brief goes first in answers: services, job list, own words, size, place, access, parts, when', /services: serviceNames\(\)\.join\(', '\),\s*job_list: jobList\(\),\s*list_in_own_words: ownWords\(\),\s*job_size:[^,]+,\s*place:[^,]+,\s*access:[^,]+,\s*parts:[^,]+,\s*when:/.test(H));
ok('urgency is sent as the dashboard reads it ("this-week", "emergency-today")', /toLowerCase\(\)\.replace\(\/\\s\+\/g, '-'\)/.test(H));
ok('same endpoints as before', ['handyman-questions', 'handyman-analyze', 'handyman-submit'].every((f) => H.indexOf('/.netlify/functions/' + f) > -1));
const D = read('dashboard.html');
ok('DASHBOARD: "Job at a glance" sits above the photos in the booking', /handymanBrief\(b\) \+\s*'<div class="h-hero-grid">'/.test(D));
ok('...and the list shows the size and the place', /esc\(b\.answers\.job_size\)/.test(D) && /esc\(b\.answers\.place\)/.test(D));
{
  const src = D.slice(D.indexOf('function handymanBrief(b)'), D.indexOf('let currentHandymanBooking'));
  const ctx = { esc: (t) => String(t == null ? '' : t).replace(/</g, '&lt;') };
  vm.createContext(ctx); vm.runInContext(src + ';this.f=handymanBrief;', ctx);
  const html = ctx.f({ answers: { job_list: ['General Repairs: Door, Hinge', 'Bathroom Refresh: Re-caulk'], job_size: '2–3 things', place: 'Apartment', access: 'Walk-up, 4th floor or higher', parts: 'Please bring them', when: 'This week' }, preferred_date: '2026-10-01', preferred_time: 'morning' });
  ok('...it lists every job and every answer', ['General Repairs: Door, Hinge', 'Bathroom Refresh: Re-caulk', '2–3 things', 'Apartment', 'Walk-up, 4th floor or higher', 'Please bring them', 'This week', '2026-10-01 · morning'].every((x) => html.indexOf(x) > -1));
  ok('...an old booking without them shows nothing extra', ctx.f({ answers: { repair_type: 'Door' } }) === '');
}
ok('THE EMAIL to you carries the same brief', /\$\{jobBriefHtml\(booking\.answers\)\}/.test(read('netlify/functions/handyman-submit.js')));
ok('Bathroom Refresh has its icon in the dashboard', /"bathroom-refresh": "🛁"/.test(D));

console.log('\n3. Smarter questions, fewer\n');
const Q = require(path.join(ROOT, 'netlify/functions/handyman-questions.js'));
(async () => {
  const call = async (b) => JSON.parse((await Q.handler({ httpMethod: 'POST', body: JSON.stringify(b) })).body).questions;
  const known = { job_list: ['x'], job_size: '1 thing', place: 'House', when: 'Flexible' };
  const ASKED = /^(urgency|has_parts|issue_count|quantity|job_count|property_type|repair_type|surface|furniture_type|issue_type|refresh_items)$/;
  const multi = await call({ service: 'general-repairs', services: ['general-repairs', 'tile-grout', 'bathroom-refresh'], known });
  ok('no photos: at most 4 questions and "anything else"', multi.length <= 5 && multi[multi.length - 1].id === 'description', multi.map((q) => q.id).join(','));
  ok('...none asks again what the list page asked', multi.every((q) => !ASKED.test(q.id)));
  ok('...each service gets a turn', ['broken_missing', 'location', 'bath_condition'].every((id) => multi.some((q) => q.id === id)));
  ok('...and none is required', multi.every((q) => q.required === false));
  const fromAI = Q.formQuestions([
    { id: 'urgency', label: 'How urgent is this?' }, { id: 'door_parts', label: 'Do you already have the parts?' },
    { id: 'floor_q', label: 'Which floor is the apartment on?' }, { id: 'door_material', label: 'What is the door made of?', required: true },
    { id: 'a', label: 'A?' }, { id: 'b', label: 'B?' }, { id: 'c', label: 'C?' }, { id: 'd', label: 'D?' }]);
  ok('what the model writes is filtered the same way: urgency, parts, floor dropped; 4 kept', fromAI.map((q) => q.id).join(',') === 'door_material,a,b,c,description', fromAI.map((q) => q.id).join(','));
  ok('...a question about the tile being on the floor or wall is NOT dropped', Q.formQuestions([{ id: 'where', label: 'Is the tile on the floor or the wall?' }]).length === 2);
  const legacy = await call({ service: 'general-repairs' });
  ok('an old caller (no job list sent) still gets the old questions', legacy.some((q) => q.id === 'urgency'));
  ok('Bathroom Refresh has its own questions', (await call({ service: 'bathroom-refresh' })).some((q) => q.id === 'bath_condition'));

  console.log('\n4. The job file\n');
  const A = read('netlify/functions/handyman-analyze.js');
  ok('no "Full Handyman Day" day rate in the estimator any more', !/Full Handyman Day|\/day/.test(A));
  ok('the job list goes first in its prompt, numbered', /JOB LIST:/.test(A));
  ok('a long list is flagged: quote each item, not a day rate', /Long job list - quote each item, not a day rate/.test(A));

  console.log('\n5. The customer\'s confirmation email ("Yes go do all")\n');
  {
    const https = require('https'), { EventEmitter } = require('events');
    const sent = [], real = https.request;
    https.request = function (opts, cb) { const req = new EventEmitter(); let body = '';
      req.write = (d) => { body += d; }; req.setTimeout = () => {};
      req.end = () => { const res = new EventEmitter(); res.statusCode = 200; if (opts.hostname === 'api.resend.com') sent.push(JSON.parse(body));
        cb(res); res.emit('data', Buffer.from(opts.hostname === 'api.resend.com' ? '{}' : '[{}]')); res.emit('end'); };
      return req; };
    Object.assign(process.env, { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'k', RESEND_API_KEY: 'r' });
    const log = console.log, err = console.error; console.log = () => {}; console.error = () => {};
    const sub = require(path.join(ROOT, 'netlify/functions/handyman-submit.js')).handler;
    await sub({ httpMethod: 'POST', body: JSON.stringify({ customer: { name: 'Zurabi Test', phone: '1', email: 'z@example.com', address: 'x' },
      service: 'general-repairs', serviceName: 'General Repairs', urgency: 'emergency-today', preferredDate: '2026-09-26', preferredTime: 'morning',
      answers: { job_list: ['General Repairs: Door, Drywall hole', 'Bathroom Refresh: Re-caulk'], place: 'Apartment' },
      aiResult: { estimate: { customerNotes: 'Thanks — we can come today. We recommend a small deposit ($100).' }, internalBrief: {}, confidence: {} } }) });
    console.log = log; console.error = err; https.request = real;
    const cust = sent.find((m) => m.to[0] === 'z@example.com') || { html: '' };
    const mine = sent.find((m) => m.to[0] !== 'z@example.com') || { html: '' };
    ok('1. the AI note ("we can come today", "$100 deposit") is NOT sent to the customer', !/come today|deposit|\$100/i.test(cust.html));
    ok('2. urgency in plain words: "Emergency today", never "emergency-today"', /Emergency today/.test(cust.html) && !/emergency-today/.test(cust.html) && /How soon: <strong>Emergency today/.test(mine.html));
    ok('3. the customer sees their whole job list', /<li>General Repairs: Door, Drywall hole<\/li><li>Bathroom Refresh: Re-caulk<\/li>/.test(cust.html));
    ok('...and the date in words ("Sat, Sep 26 · morning")', /Sat, Sep 26 · morning/.test(cust.html));
    ok('4. the calm look: no navy, no "analyzed by our AI" check marks', !/#0d1b2a|analyzed by our AI|Damage identified|Materials estimated/i.test(cust.html) && /#faf8f4/.test(cust.html));
    ok('...you still get a copy (bcc), and never "licensed"', (cust.bcc || []).length === 1 && !/\blicensed\b/i.test(cust.html));
    ok('the AI note is kept for you in the dashboard, marked "not sent"', /AI suggested note · not sent to the customer/.test(D) && /esc\(b\.customer_notes\)/.test(D));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
