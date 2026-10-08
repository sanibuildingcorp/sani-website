// node js/chat-aware-regen.test.js - Regenerate reads the estimator chat as Q&A + the agreed plan, and reports back
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'netlify/functions/generate-v5-background.js'), 'utf8');
const grab = (name) => { const i = src.indexOf('function ' + name + '('); let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(i, j + 1); };
const pw = src.match(/const PLAN_WORDS = \[[^\]]*\];/)[0];
const ctx = { A: (v) => (Array.isArray(v) ? v : []), s: (v) => String(v == null ? '' : v).trim() };
vm.createContext(ctx); vm.runInContext([pw, grab('norm'), grab('chatNotes'), grab('regenReport')].join('\n') + '\nthis.chatNotes=chatNotes;this.regenReport=regenReport;', ctx);
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c || !x ? '' : '\n      ' + x)); };
const chat = [
  { from: 'owner', text: 'Full gut, new toilet, vanity, glass panel, bench, new ceiling with spot lights' },
  { from: 'ai', text: 'Got it. How many recessed lights, and existing wiring or a new circuit from the panel?' },
  { from: 'owner', text: '4 lights, existing wiring' },
  { from: 'ai', text: 'Set — 4 recessed lights tied into the existing ceiling wiring. Tap Regenerate and I will build the full gut: wall tile about 260sf, new toilet, vanity, valve, rain head, handheld, glass panel, bench, grab bars and the new ceiling.' },
  { from: 'owner', text: 'Regenerate' },
];
const n = ctx.chatNotes(chat);
ok('a short answer goes in WITH the question it answers', n.some((x) => /question: "Got it\. How many recessed lights/.test(x) && /4 lights, existing wiring/.test(x)), JSON.stringify(n));
ok('the estimator\'s last summary goes in as the agreed plan', /^PLAN AGREED IN THE CHAT/.test(n[n.length - 1]) && /grab bars/.test(n[n.length - 1]));
ok('"Regenerate" itself is not sent as an instruction', !n.some((x) => /: Regenerate$/.test(x)));
const prev = { markupPct: 20, labor: [{ section: 'B', item: 'Demo', qty: 1, rate: 1000 }], materials: [] };
const est = { markupPct: 20, labor: [{ section: 'B', item: 'Demo', qty: 1, rate: 1000 }, { section: 'B', item: 'Install toilet', qty: 1, rate: 300 }, { section: 'B', item: 'Recessed light install', qty: 4, rate: 90 }], materials: [{ section: 'B', item: 'Glass panel', qty: 1, rate: 500 }] };
const r = ctx.regenReport(prev, est, [{ type: 'add', what: 'Install toilet' }, { type: 'add', what: 'Recessed light install' }, { type: 'add', what: 'Glass panel' }], chat);
ok('report gives old → new total and what was added', /\$1,200 → \$2,592/.test(r) && /Added: Install toilet; Recessed light install; Glass panel/.test(r), r);
ok('report names plan items missing from the lines (vanity, bench, grab bar...)', /Check: the plan mentions [^\n]*vanity/.test(r) && /bench/.test(r) && /grab bar/.test(r) && !/mentions[^\n]*toilet/.test(r), r);
const n2 = ctx.chatNotes(chat.concat([{ from: 'ai', report: true, text: 'Regenerated: $1 → $2. Added: x. Review the change list and tap Apply to use it.' }]));
ok('a report is never mistaken for the plan', /grab bars/.test(n2[n2.length - 1]));
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
