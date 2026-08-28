/* estimator-conversation.test.js — run: node netlify/functions/lib/estimator-conversation.test.js */
/* The customer's replies must actually reach the estimator. Executed against
   buildEstimatorInput / buildConversationForEstimator themselves. */
const Module=require('module'),path=require('path'),fs=require('fs'),vm=require('vm');
const realLoad=Module._load;
Module._load=function(r,p,m){ if(r==='@netlify/blobs')return{getStore:()=>({})}; return realLoad(r,p,m); };

const F=require('path').join(__dirname,'..','generate-estimate-background.js');
const SRC=fs.readFileSync(F,'utf8');
const ctx={module:{exports:{}},exports:{},console,Math,Date,JSON,Object,Array,Number,String,Boolean,RegExp,
  isNaN,isFinite,parseFloat,parseInt,Buffer,process,URL,
  require:n=>require(n.startsWith('.')?path.resolve(__dirname,'..',n):n)};
ctx.global=ctx; vm.createContext(ctx); vm.runInContext(SRC,ctx,{filename:F});
const G=n=>vm.runInContext(n,ctx);

let pass=0,fail=0;
const t=(n,c,d)=>{c?pass++:fail++;console.log((c?'PASS  ':'FAIL  ')+n+(d?'\n        '+d:''))};

/* Two things this fixture has to get right, both learned the hard way:
   normalizeThread DEDUPES ON ID, so every message needs its own — an earlier
   version reused one id and 38 of 40 messages silently vanished, making the cap
   look like it worked when nothing had been capped. And it SORTS BY `at`, so
   identical timestamps sort arbitrarily; giving every message the same time
   scrambled the order and looked like a bug in the code under test. Real
   messages have distinct ids and distinct times, and so does this. */
let _seq=0;
const msg=(from,text,minute)=>({
  id:from+'-'+(++_seq), from, text,
  at:new Date(Date.UTC(2026,7,21,10,Number(minute)||_seq)).toISOString(), via:'quote'});
function rec(thread){
  return {ref:'SBC-1',customer:{name:'A',email:'a@b.c'},
    request:{service:'Bathroom',selectedServices:['Bathroom'],description:'Bathroom is old, want it redone.',
      serviceAnswers:{},answerTopics:{},customerSupplies:[],photoAnalysis:[]},
    thread:thread};
}
const build=(r,body)=>G('buildEstimatorInput')(r,body||{ref:'SBC-1'});

console.log('\n1. It arrives at all');
{
 const i=build(rec([msg('contractor','How many square feet of tile?',1),
                    msg('customer','About 60 square feet. Also the second bathroom.',2)]));
 t('the estimator input now HAS a conversation', Array.isArray(i.request.conversation));
 t('both messages are there', i.request.conversation.length===2, JSON.stringify(i.request.conversation));
 t('the customer’s actual words survive',
   /60 square feet/.test(i.request.conversation[1].said), i.request.conversation[1].said);
 t('who said it is kept',
   i.request.conversation[0].from==='contractor' && i.request.conversation[1].from==='customer');
 t('and when', /^2026-/.test(i.request.conversation[0].at||''), i.request.conversation[0].at);
}

console.log('\n2. Order and recency');
{
 const many=[]; for(let k=0;k<40;k++) many.push(msg(k%2?'customer':'contractor','message number '+k,k));
 const i=build(rec(many));
 t('a long thread is capped', i.request.conversation.length<=30, i.request.conversation.length+' kept');
 t('it keeps the NEWEST, not the oldest',
   /number 39/.test(JSON.stringify(i.request.conversation)) && !/number 0"/.test(JSON.stringify(i.request.conversation)));
 t('and still reads in order',
   i.request.conversation[0].said.match(/\d+/)[0] < i.request.conversation.slice(-1)[0].said.match(/\d+/)[0]);
}
{
 const huge='x'.repeat(9000);
 const i=build(rec([msg('customer',huge,1),msg('customer','the real answer is 60 sq ft',2)]));
 const total=i.request.conversation.reduce((s,m)=>s+m.said.length,0);
 t('one enormous message cannot swallow the prompt', total<=6000, total+' chars');
 t('...and the newest message still gets through',
   /the real answer is 60 sq ft/.test(JSON.stringify(i.request.conversation)));
}

console.log('\n3. Records with no thread are unchanged');
{
 t('no thread -> empty list, not undefined',
   JSON.stringify(build(rec(undefined)).request.conversation)==='[]');
 t('empty thread -> empty list', JSON.stringify(build(rec([])).request.conversation)==='[]');
 t('a junk thread does not throw',
   JSON.stringify(build(rec([null,{},{text:''},'nope'])).request.conversation)==='[]');
}

console.log('\n4. The contractor can still turn it off');
{
 const r=rec([msg('customer','60 sq ft',1)]);
 t('useConversation:false excludes it',
   JSON.stringify(build(r,{ref:'SBC-1',useConversation:false}).request.conversation)==='[]');
 t('and omitting the flag includes it',
   build(r,{ref:'SBC-1'}).request.conversation.length===1);
}

console.log('\n5. Nothing else about the input changed');
{
 const r=rec([msg('customer','60 sq ft',1)]);
 const i=build(r);
 t('description still there', i.request.description==='Bathroom is old, want it redone.');
 t('selected services still there', JSON.stringify(i.request.selectedServices)==='["Bathroom"]');
 t('customer block still there', i.customer.name==='A');
 t('house rules slot still there', 'houseRules' in i.contractor);
}

console.log('\n6. The analysis stage is told what to do with it');
{
 t('the prompt names request.conversation', /request\.conversation/.test(SRC));
 t('a later message beats an earlier one', /LATER MESSAGE BEATS AN EARLIER ONE/.test(SRC));
 t('an answered question is not asked again',
   /Never ask again, in clarification_questions, for something a reply has already answered/.test(SRC));
}

console.log('\n  '+pass+' passed, '+fail+' failed');
