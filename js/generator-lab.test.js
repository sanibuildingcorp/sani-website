/* generator-lab.test.js — run: node js/generator-lab.test.js
 *
 *   "new rules can we do as a test mode? If it's not going true then remove
 *    and return to the same mode? I scare i don't want broke and then spend
 *    a lot time again for rebuild again"
 *
 * The promise this file holds: with Test mode OFF (the default, and what a
 * missing or broken settings blob means) every prompt the generator writes
 * is EXACTLY what it was - compared here against the prompt built with no
 * test-mode property at all. With it ON the only difference is one block:
 * the foreman's way of thinking and his lessons that are switched on.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'netlify/functions/generate-estimate-background.js'), 'utf8');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
const ASSIST = fs.readFileSync(path.join(ROOT, 'netlify/functions/assistant.js'), 'utf8');
const L = require(path.join(ROOT, 'netlify/functions/lib/generator-lab.js'));
const SW = require(path.join(ROOT, 'netlify/functions/lib/scope-writer.js'));
let pass = 0, fail = 0;
const ok = (n, c, d) => { c === true ? pass++ : fail++; console.log((c === true ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };
function ext(name) {
  const s = SRC.search(new RegExp('(?:async )?function ' + name + '\\s*\\('));
  if (s < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let j = SRC.indexOf('{', s); j < SRC.length; j++) { if (SRC[j] === '{') d++; else if (SRC[j] === '}') { d--; if (!d) return SRC.slice(s, j + 1); } }
  throw new Error('unbalanced ' + name);
}
const ctx = { JSON, String, Array, Number, Math, Set, Object, jobSize: require(path.join(ROOT, 'netlify/functions/lib/job-size.js')), voice: require(path.join(ROOT, 'netlify/functions/lib/customer-voice.js')), buildResearchBlock: () => '' };
vm.createContext(ctx);
['cleanText', 'labOf', 'buildHouseRulesBlock', 'buildAnchorBlock', 'buildProjectAnalysisPrompt', 'buildEstimatePrompt', 'buildRepairPrompt'].forEach((n) => vm.runInContext(ext(n), ctx));
const INPUT = () => ({ request: { description: 'Paint 2 rooms, Benjamin Moore Simply White', service: 'Painting', selectedServices: ['Painting'], customerSupplies: [] }, contractor: { houseRules: 'Painting: $4.50/SF labor', extraRequest: '' } });
const ANALYSIS = { project_type: 'partial renovation', selected_trades: ['Painting'], confirmed_scope: [] };
function prompts(lab) {
  ctx.IN = INPUT();
  if (lab !== undefined) Object.defineProperty(ctx.IN, '__lab', { value: L.labText(lab), enumerable: false });
  ctx.AN = ANALYSIS;
  return { a: vm.runInContext('buildProjectAnalysisPrompt(IN)', ctx), e: vm.runInContext('buildEstimatePrompt(IN, AN, null)', ctx), r: vm.runInContext('buildRepairPrompt(IN, AN, {}, {}, null)', ctx), s: SW.buildScopePrompt({ serviceBreakdown: [{ title: 'Painting' }], labor: [], materials: [] }, ANALYSIS, ctx.IN) };
}
const LAB_ON = { on: true, lessons: [{ id: 'a', text: 'Paint color never changes the price', on: true }, { id: 'b', text: 'Switched-off lesson', on: false }] };

console.log('\n1. OFF is exactly the old generator\n');
{
  const base = prompts(undefined);
  const off = prompts({ on: false, lessons: LAB_ON.lessons });
  const broken = prompts(null);
  ok('TEST MODE OFF: the analyst, estimator, repair and scope-writer prompts are byte for byte the old ones', off.a === base.a && off.e === base.e && off.r === base.r && off.s === base.s);
  ok('...even with lessons saved (they wait until it is switched on)', off.e.indexOf('Paint color never changes the price') === -1);
  ok('A MISSING OR BROKEN SETTINGS BLOB means OFF', broken.a === base.a && broken.e === base.e && L.labText(undefined) === '' && L.labText('garbage') === '' && L.stamp(null) === null);
  ok('the block never enters the input JSON the prompts print (nor the scope fingerprint)', JSON.stringify((() => { const i = INPUT(); Object.defineProperty(i, '__lab', { value: 'X', enumerable: false }); return i; })()).indexOf('__lab') === -1);
}

console.log('\n2. ON adds one block, and nothing else\n');
{
  const base = prompts(undefined);
  const on = prompts(LAB_ON);
  const block = L.labText(LAB_ON);
  ok('THE ONLY DIFFERENCE in every prompt is the one block', on.a.replace(block, '') === base.a && on.e.replace(block, '') === base.e && on.r.replace(block, '') === base.r && on.s.replace(block, '') === base.s);
  ok('THE BLOCK: the foreman, the lessons that are on, and "everything else still wins"', /working foreman at Sani Building Corp who has done this kind of job a hundred times/.test(block) && /- Paint color never changes the price/.test(block) && block.indexOf('Switched-off lesson') === -1 && /Everything else in these instructions still applies, and wins where it conflicts with this block\./.test(block));
  ok('...the house rules, "licensed" rule, repair rule and voice are all still in the ON prompt', /CONTRACTOR HOUSE RULES/.test(on.e) && /Never use the word "licensed"/.test(on.e) && /THE SIZE OF THE JOB IS THE SIZE OF THE REQUEST/.test(on.e) && /CUSTOMER VOICE/.test(on.e));
  ok('an estimate made in test mode is stamped (how many lessons); OFF leaves no stamp', L.stamp(LAB_ON).testRules === true && L.stamp(LAB_ON).lessons === 1 && L.stamp({ on: false }) === null && /if \(labStamp\) estimate\.generatedWith = labStamp;/.test(SRC));
}

console.log('\n3. Lessons: add, toggle, edit, delete, limits\n');
{
  let l = L.clean(null);
  l = L.change(l, { action: 'add', text: '  Paint color never   changes the price ' });
  l = L.change(l, { action: 'add', text: 'paint color never changes the price' });
  ok('ADD trims it, starts it ON, and ignores the same lesson twice', l.lessons.length === 1 && l.lessons[0].text === 'Paint color never changes the price' && l.lessons[0].on === true);
  const id = l.lessons[0].id;
  l = L.change(l, { action: 'toggle', id, on: false });
  ok('TOGGLE off', l.lessons[0].on === false);
  l = L.change(l, { action: 'edit', id, text: 'Color never matters for price' });
  ok('EDIT', l.lessons[0].text === 'Color never matters for price');
  l = L.change(l, { action: 'mode', on: true });
  ok('MODE on / off', l.on === true && L.change(l, { action: 'mode', on: false }).on === false);
  l = L.change(l, { action: 'delete', id });
  ok('DELETE', l.lessons.length === 0);
  let big = L.clean(null); for (let i = 0; i < 30; i++) big = L.change(big, { action: 'add', text: 'Lesson ' + i });
  let err = ''; try { L.change(big, { action: 'add', text: 'one more' }); } catch (e) { err = e.message; }
  ok('AT MOST 30 LESSONS, each at most 240 characters - a bad lesson cannot take over', /already 30 lessons/.test(err) && L.change(L.clean(null), { action: 'add', text: 'x'.repeat(500) }).lessons[0].text.length === 240);
}

console.log('\n4. The endpoint, the dashboard, Ask AI\n');
(async () => {
  const STORE = new Map();
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) { if (request === '@netlify/blobs') return '@netlify/blobs'; return origResolve.call(this, request, ...rest); };
  require.cache['@netlify/blobs'] = { id: '@netlify/blobs', filename: '@netlify/blobs', loaded: true, exports: { getStore: () => ({ get: async (k) => (STORE.has(k) ? JSON.parse(STORE.get(k)) : null), setJSON: async (k, v) => { STORE.set(k, JSON.stringify(v)); } }) } };
  process.env.DASHBOARD_KEY = 'k';
  const EP = require(path.join(ROOT, 'netlify/functions/generator-lab.js'));
  const call = (m, b, key) => EP.handler({ httpMethod: m, headers: key === false ? {} : { 'x-sbc-key': 'k' }, body: b ? JSON.stringify(b) : '' });
  let r = await call('GET');
  ok('GET with nothing saved: OFF, no lessons', r.statusCode === 200 && JSON.parse(r.body).on === false && JSON.parse(r.body).lessons.length === 0);
  r = await call('POST', { action: 'add', text: 'A tile repair is lift and re-set, never a floor rebuild' });
  r = await call('POST', { action: 'mode', on: true });
  ok('POST add + mode: saved in the estimates store under "generator-lab"', r.statusCode === 200 && JSON.parse(STORE.get('generator-lab')).on === true && JSON.parse(STORE.get('generator-lab')).lessons.length === 1);
  r = await call('POST', { action: 'mode', on: true }, false);
  ok('no key -> 401', r.statusCode === 401);
  r = await call('POST', { action: 'nonsense' });
  ok('a bad request -> 400, nothing broken', r.statusCode === 400 && JSON.parse(STORE.get('generator-lab')).on === true);
  ok('THE DASHBOARD: a TEST MODE fold next to House Rules with the switch, the lessons and Add', /\\u\{1F9EA\} TEST MODE <span class="hr-hint">teach the generator - switch off any time<\/span>/.test(DASH) && /function labPanelHtml\(\)/.test(DASH) && /Test mode: OFF — tap to switch on/.test(DASH) && /labAct\(\{action:\\'toggle\\'/.test(DASH) && /function labAdd\(\)/.test(DASH));
  ok('...switching ON asks first; switching OFF does not', /function labMode\(on\)\{\s*if \(!on \|\| confirm\('Switch Test mode ON\?/.test(DASH));
  ok('THE ESTIMATE says when it was made in test mode, and how to go back', /Made in test mode/.test(DASH) && /To go back: switch Test mode off and Regenerate\./.test(DASH));
  ok('ASK AI can save a lesson: the action, the confirm bubble, the endpoint', /lesson: \["text"\]/.test(ASSIST) && /SAVE A LESSON FOR THE GENERATOR: ACTION: \{\\"type\\":\\"lesson\\",\\"text\\":\\"\.\.\.\\"\}/.test(ASSIST) && /if \(t === "lesson"\) \{/.test(DASH) && /"Keep it", "Not now"/.test(DASH) && /sbcFetch\("\/\.netlify\/functions\/generator-lab"/.test(DASH));
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
