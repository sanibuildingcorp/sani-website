/* intake-flow.test.js — run: node js/intake-flow.test.js
 *
 * The customer's side of the new question flow, EXECUTED against the real
 * functions lifted out of estimate.html.
 *
 * What this file is really guarding: the form must keep moving no matter what
 * the planner does. A customer stuck on a spinner is a lead lost, and unlike a
 * wrong price nobody ever finds out it happened. So every path is exercised —
 * questions planned, nothing to ask, planner down, planner broken — and each one
 * has to end somewhere the customer can continue from.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'estimate.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? pass++ : fail++; console.log((c ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n        ' + d : '')); };

function ext(name) {
  const s = HTML.search(new RegExp('(async )?function ' + name + '\\('));
  if (s < 0) throw new Error('missing ' + name);
  let d = 0;
  for (let j = HTML.indexOf('{', s); j < HTML.length; j++) {
    if (HTML[j] === '{') d++;
    else if (HTML[j] === '}') { d--; if (!d) return HTML.slice(s, j + 1); }
  }
}

/* A DOM just real enough for step 2: elements that remember what was written
   into them, and a step machine that records where the customer was sent. */
function mkCtx(fetchImpl) {
  const els = {};
  function el(id) {
    if (!els[id]) els[id] = {
      id, style: {}, textContent: '', _html: '', disabled: false, value: '',
      set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
      querySelectorAll: () => [],
      classList: { add() {}, remove() {}, toggle() {} },
    };
    return els[id];
  }
  const ctx = {
    console, JSON, Math, String, Number, Boolean, Array, Object, Promise,
    setTimeout, clearTimeout, RegExp, Error,
    fetch: fetchImpl,
    document: {
      getElementById: el,
      querySelector: () => ({ classList: { add() {}, remove() {} }, style: {} }),
      querySelectorAll: () => [],
    },
    esc: s => String(s == null ? '' : s),
    _steps: [],
    _els: els,
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.scrollTo = () => {};
  vm.createContext(ctx);

  /* The state the real page holds at module scope. */
  vm.runInContext(`
    var formData={service:'bathroom,painting',serviceLabel:'Bathroom, Painting',serviceAnswers:{},
      description:'my bathroom is old and the hallway paint is peeling',photos:[],photoAnalysis:[],propertyType:''};
    var currentStep=1,currentAIQuestion=null,aiQuestionCount=0;
    var askedQuestionLabels=[],answerTopics={},answerLabels={};
    var plannedQuestions=[],plannedIndex=0,usingPlan=false,intakeReadAs='';
    function showStep(s){ _steps.push('show:'+s); }
    function goToStep(s){ _steps.push('go:'+s); }
    function hideSiteMenu(){}
  `, ctx);

  ['planIntakeQuestions', 'showPlannedQuestion', 'renderAIQuestion', 'answerAIQuestion',
   'loadNextAIQuestion', 'startStep2', 'selectAIOption'].forEach(n => vm.runInContext(ext(n), ctx));
  return ctx;
}

const PLANNED = [
  { questionId: 'bathSize', label: 'How big is the bathroom, roughly?', why: 'Area sets every tile line', type: 'options-stack', options: ['Under 40 sq ft', '40-70 sq ft', "I'm not sure"], topic: 'bathroom', topicLabel: 'Bathroom' },
  { questionId: 'rooms', label: 'How many rooms need painting?', why: 'Rooms set the hours', type: 'text', options: [], topic: 'painting', topicLabel: 'Painting' },
];

/* fetch stubs. `calls` records every endpoint the page reached for. */
function stub(routes) {
  const calls = [];
  const f = (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    const key = Object.keys(routes).find(k => url.indexOf(k) !== -1);
    if (!key) return Promise.reject(new Error('unrouted ' + url));
    const r = routes[key];
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve({ json: () => Promise.resolve(r) });
  };
  f.calls = calls;
  return f;
}

const PLANNER = 'estimate-intake-questions';
const LEGACY = 'estimate-ai-question';

(async function run() {
  console.log('\nintake flow (estimate.html)\n');

  /* ── the ordinary path ───────────────────────────────────────────────── */
  {
    const f = stub({ [PLANNER]: { questions: PLANNED, readAs: 'Re-tile a small bathroom and repaint the hallway.' } });
    const c = mkCtx(f);
    await vm.runInContext('startStep2()', c);
    ok('the planner is asked once, and only the planner',
      f.calls.length === 1 && f.calls[0].url.indexOf(PLANNER) !== -1,
      f.calls.map(x => x.url).join(', '));
    ok('the first question is on screen', c._els['step2-title'].textContent === PLANNED[0].label);
    ok('the reason and the position are shown under it',
      /Area sets every tile line/.test(c._els['step2-subtitle'].textContent) &&
      /Question 1 of 2/.test(c._els['step2-subtitle'].textContent),
      c._els['step2-subtitle'].textContent);
    ok('what the AI understood is kept', vm.runInContext('intakeReadAs', c).indexOf('Re-tile') === 0);

    /* answering moves on WITHOUT another network call - that is the whole point */
    vm.runInContext("selectAIOption({dataset:{value:'40-70 sq ft'},classList:{add(){},remove(){}},parentElement:{querySelectorAll:()=>[]}})", c);
    await vm.runInContext('answerAIQuestion()', c);
    ok('the second question needs no round trip', f.calls.length === 1, f.calls.length + ' calls');
    ok('the second question is on screen', c._els['step2-title'].textContent === PLANNED[1].label);
    ok('the answer was recorded', vm.runInContext("formData.serviceAnswers.bathSize", c) === '40-70 sq ft');
    ok('the question the customer read was recorded with it',
      vm.runInContext("answerLabels.bathSize", c) === PLANNED[0].label,
      vm.runInContext("JSON.stringify(answerLabels)", c));
    ok('the trade was recorded with it', vm.runInContext("answerTopics.bathSize", c) === 'Bathroom');

    await vm.runInContext('answerAIQuestion()', c);
    ok('after the last question the form goes on to supplies',
      c._steps[c._steps.length - 1] === "go:supplies", c._steps.join(' '));
  }

  /* ── nothing left to ask ─────────────────────────────────────────────── */
  {
    const f = stub({ [PLANNER]: { questions: [], readAs: 'Replace 200 sq ft of oak flooring.' } });
    const c = mkCtx(f);
    await vm.runInContext('startStep2()', c);
    ok('a complete description skips straight past the questions',
      c._steps[c._steps.length - 1] === 'go:supplies', c._steps.join(' '));
    ok('and it does NOT fall back to asking one at a time',
      !f.calls.some(x => x.url.indexOf(LEGACY) !== -1));
  }

  /* ── the planner is down ─────────────────────────────────────────────── */
  {
    const f = stub({ [PLANNER]: { questions: [], fallback: true, error: 'overloaded' },
                     [LEGACY]: { done: false, questionId: 'legacy', label: 'How big is the room?', type: 'text' } });
    const c = mkCtx(f);
    await vm.runInContext('startStep2()', c);
    ok('a planner failure falls back to the one-at-a-time endpoint',
      f.calls.length === 2 && f.calls[1].url.indexOf(LEGACY) !== -1,
      f.calls.map(x => x.url).join(', '));
    ok('and the customer still sees a question', c._els['step2-title'].textContent === 'How big is the room?');
  }
  {
    const f = stub({ [PLANNER]: new Error('network down'),
                     [LEGACY]: { done: true } });
    const c = mkCtx(f);
    await vm.runInContext('startStep2()', c);
    ok('a network error falls back too, and lands on supplies',
      c._steps[c._steps.length - 1] === 'go:supplies', c._steps.join(' '));
  }
  {
    /* Both endpoints gone. The customer must still reach the end of the form. */
    const f = stub({ [PLANNER]: new Error('down'), [LEGACY]: new Error('down') });
    const c = mkCtx(f);
    await vm.runInContext('startStep2()', c);
    ok('with both endpoints down the form still reaches the end',
      c._steps[c._steps.length - 1] === 'go:supplies', c._steps.join(' '));
  }

  /* ── what the planner is told ────────────────────────────────────────── */
  {
    const f = stub({ [PLANNER]: { questions: PLANNED } });
    const c = mkCtx(f);
    vm.runInContext("formData.propertyType='Brownstone / Townhouse';formData.photos=[{},{}];formData.photoAnalysis=[{detected:'Cracked wall tile'}];", c);
    await vm.runInContext('startStep2()', c);
    const b = f.calls[0].body;
    ok('the description is sent', b.description.indexOf('hallway paint is peeling') !== -1);
    ok('both services are counted', b.serviceCount === 2, String(b.serviceCount));
    ok('the property type is sent', b.propertyType === 'Brownstone / Townhouse');
    ok('the photo count is sent', b.photoCount === 2);
    ok('what the photos showed is sent', b.photoNotes[0] === 'Cracked wall tile');
  }

  /* ── going back and starting over ────────────────────────────────────── */
  {
    const f = stub({ [PLANNER]: { questions: PLANNED } });
    const c = mkCtx(f);
    await vm.runInContext('startStep2()', c);
    vm.runInContext("selectAIOption({dataset:{value:'Under 40 sq ft'},classList:{add(){},remove(){}},parentElement:{querySelectorAll:()=>[]}})", c);
    await vm.runInContext('startStep2()', c);   /* Back, then Continue again */
    ok('starting over clears the old answers',
      Object.keys(vm.runInContext('formData.serviceAnswers', c)).length === 0);
    ok('starting over clears the old labels',
      Object.keys(vm.runInContext('answerLabels', c)).length === 1,
      'only the freshly rendered question should be listed');
    ok('starting over restarts at question one',
      c._els['step2-title'].textContent === PLANNED[0].label);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
