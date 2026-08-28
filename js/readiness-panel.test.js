/* readiness-panel.test.js — run: node js/readiness-panel.test.js */
/* The readiness panel, executed: it must surface what the estimator was unsure
   about, and stay silent on a record that has none of it. */
const fs=require('fs'),vm=require('vm');
const SRC=fs.readFileSync(require('path').join(__dirname,'..','dashboard.html'),'utf8');
let pass=0,fail=0;
const t=(n,c,d)=>{c?pass++:fail++;console.log((c?'PASS  ':'FAIL  ')+n+(d?'\n        '+d:''))};

/* Lift the IIFE out of renderEdit and run it against a chosen `est`. */
const start=SRC.indexOf('var readinessHtml = (function () {');
const end=SRC.indexOf("var analysisHtml = paList.length ?");
const BLOCK=SRC.slice(start,end);

function run(est){
  const c={console,Number,Math,String,Array,Object,JSON,Boolean,isFinite,
    est,esc:s=>String(s==null?'':s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))};
  vm.createContext(c);
  vm.runInContext(BLOCK+'\n;',c);
  return vm.runInContext('readinessHtml',c);
}

console.log('\n1. Silent when there is nothing to say');
t('a bare estimate renders nothing at all', run({})==='' , JSON.stringify(run({})));
t('an estimate with only line items renders nothing',
  run({labor:[{item:'x',qty:1,rate:5}]})==='');

console.log('\n2. It shows how sure the estimate is');
{
 const h=run({pricingReadiness:{status:'NEEDS_CUSTOMER_QUESTIONS',confidence_score:42,reason:'Tile area unknown.'}});
 t('the status is named in plain words', /Needs answers first/.test(h));
 t('the confidence number is shown', /42% confident/.test(h), (h.match(/\d+% confident/)||[''])[0]);
 t('it says what that means for the price',
   /price below may move/.test(h));
 t('the estimator’s own reason is shown', /Tile area unknown\./.test(h));
}
{
 const h=run({pricingReadiness:{status:'READY_TO_ESTIMATE',confidence_score:91}});
 t('a confident estimate says so', /Ready to price/.test(h) && /91% confident/.test(h));
}
{
 const h=run({pricingReadiness:{status:'SITE_VISIT_REQUIRED',confidence_score:10}});
 t('a job that cannot be priced online says exactly that',
   /Site visit needed/.test(h) && /cannot be responsibly priced/.test(h));
}

console.log('\n3. The questions the customer was never asked');
{
 const h=run({clarificationQuestions:[
   {question:'How many square feet of tile?',helper_text:'A rough number is fine.',affected_trade:'Bathroom',pricing_importance:'critical'},
   {question:'Is there an elevator?',affected_trade:'Stairs',pricing_importance:'high'}]});
 t('every question is listed', /How many square feet of tile\?/.test(h) && /Is there an elevator\?/.test(h));
 t('the helper text comes too', /A rough number is fine\./.test(h));
 t('and which service it affects', /affects Bathroom · critical/.test(h),
   (h.match(/affects [^<]*/)||[''])[0]);
 t('it tells him what to do with them', /Ask the customer in the Conversation box/.test(h));
}

console.log('\n4. Where the time went');
{
 const h=run({generationTiming:{totalMs:270000,analysisMs:20000,researchMs:150000,
   estimateMs:70000,scopeMs:25000,repairMs:0,materialPriceMs:5000}});
 t('the total is shown in seconds', /Took 270s to generate/.test(h), (h.match(/Took [^<]*/)||[''])[0]);
 t('the slowest stage is named', /Live market prices/.test(h));
 t('a stage that did not run is omitted', !/Repair pass/.test(h));
 t('each stage shows its own seconds', /150s/.test(h) && /70s/.test(h));
 const bar=(h.match(/width:(\d+)%/g)||[]);
 t('the bars are proportional', bar.includes('width:56%'), JSON.stringify(bar));
}
{
 const h=run({generationTiming:{totalMs:400000,estimateMs:100000,repairMs:120000,repairUsed:true}});
 t('a repair pass is called out when it ran', /A repair pass ran/.test(h));
}

console.log('\n5. Nothing it renders can break the page');
{
 const nasty=run({pricingReadiness:{status:'NEEDS_CUSTOMER_QUESTIONS',reason:'<img src=x onerror=alert(1)>'},
   clarificationQuestions:[{question:'<script>bad()</script>',affected_trade:'"><b>'}]});
 t('html in the AI output is escaped, not executed',
   !/<img src=x/.test(nasty) && !/<script>bad/.test(nasty) && /&lt;img/.test(nasty));
 t('missing confidence does not print NaN', !/NaN/.test(nasty), (nasty.match(/NaN[^<]*/)||[''])[0]);
}

console.log('\n  '+pass+' passed, '+fail+' failed');
