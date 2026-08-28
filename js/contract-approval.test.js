/* contract-approval.test.js — run: node js/contract-approval.test.js */
/* Approval routing: with a contract required the ONLY way through is the
   contract; without one, nothing changes. UI and server checked together —
   a rule enforced in only one of them is not enforced. */
const Module=require('module'),path=require('path'),fs=require('fs'),vm=require('vm');
let STORE={},writes=[];
const realLoad=Module._load;
Module._load=function(r,p,m){
 if(r==='@netlify/blobs')return{getStore:()=>({
   get:async k=>STORE[k]?JSON.parse(JSON.stringify(STORE[k])):null,
   setJSON:async(k,v)=>{writes.push(k);STORE[k]=JSON.parse(JSON.stringify(v))}})};
 return realLoad(r,p,m)};

const Q=fs.readFileSync(require('path').join(__dirname,'..','quote.html'),'utf8');
function ext(n){const s=Q.indexOf('function '+n+'(');let i=Q.indexOf('{',s),d=0;
 for(let j=i;j<Q.length;j++){if(Q[j]==='{')d++;else if(Q[j]==='}'){d--;if(!d)return Q.slice(s,j+1)}}}
const ctx={console,encodeURIComponent,ref:'SBC-1',E:s=>String(s==null?'':s),
 messageBox:()=>'<MSGBOX>',P:()=>{},S:()=>{}};
vm.createContext(ctx);
['contractRequired','contractHtml','actionHtml'].forEach(n=>vm.runInContext(ext(n),ctx));
const req=r=>vm.runInContext('contractRequired',ctx)(r);
const ui=r=>vm.runInContext('actionHtml',ctx)({name:'A Customer'},false,req(r));
const card=r=>vm.runInContext('contractHtml',ctx)(r,req(r));
/* The whole page below the prices, as the customer scrolls it. */
const page=r=>card(r)+ui(r);
const goldButtons=h=>(h.match(/class="approve"/g)||[]).length;
const contractLinks=h=>(h.match(/href="\/contract\.html/g)||[]).length;

let pass=0,fail=0;
const t=(n,c,d)=>{c?pass++:fail++;console.log((c?'PASS  ':'FAIL  ')+n+(d?'\n        '+d:''))};

const SIGNED={sections:{},signed:{name:'A Customer',at:'2026-08-28'}};
const UNSIGNED={sections:{}};

console.log('\n1. contractRequired()');
t('ticked + unsigned  -> required',  req({includeContractForCustomer:true,contract:UNSIGNED}));
t('ticked + no contract yet -> required', req({includeContractForCustomer:true}));
t('ticked + ALREADY SIGNED -> not a barrier any more',
  !req({includeContractForCustomer:true,contract:SIGNED}));
t('unticked -> never required', !req({includeContractForCustomer:false,contract:UNSIGNED}));
t('no choice made -> not required', !req({}));

console.log('\n2. What the customer is offered');
{
 const withC=ui({includeContractForCustomer:true,contract:UNSIGNED});
 t('contract job: NO approve-estimate button', !/onclick="P\('a'\)"/.test(withC));
 t('contract job: no confirm-approval shortcut', !/S\('accept'\)/.test(withC));
 t('contract job: the contract IS the approve button',
   /href="\/contract\.html\?ref=SBC-1"/.test(withC) && /sign the contract to approve/.test(withC));
 t('contract job: can still ask a question', /P\('q'\)/.test(withC));

 const noC=ui({includeContractForCustomer:false});
 t('no-contract job: approve button is there', /onclick="P\('a'\)"/.test(noC));
 t('no-contract job: confirm approval still works', /S\('accept'\)/.test(noC));
 t('no-contract job: no contract link', !/contract\.html/.test(noC));

 const done=vm.runInContext('actionHtml',ctx)({name:'A'},true,true);
 t('already approved: shows the approved notice, no buttons',
   /has been approved/.test(done) && !/P\('a'\)/.test(done));
}

console.log('\n2b. Exactly one way forward, never two');
{
 const withC=page({includeContractForCustomer:true,contract:UNSIGNED});
 t('contract job: only ONE link to the contract on the page',
   contractLinks(withC)===1, contractLinks(withC)+' links');
 t('contract job: only ONE gold button',
   goldButtons(withC)===1, goldButtons(withC)+' gold buttons');
 t('...and the card still explains what the contract is',
   /full contract for this project/.test(withC));
 t('...pointing at the button below it',
   /button at the bottom of this page/.test(withC));

 const signed=page({includeContractForCustomer:true,contract:SIGNED});
 t('signed job: the card keeps its own View button',
   contractLinks(signed)===1 && /View the contract/.test(signed),
   contractLinks(signed)+' links');
 t('signed job: and the normal approve button is back',
   /onclick="P\('a'\)"/.test(signed));

 const none=page({includeContractForCustomer:false});
 t('no-contract job: no contract card and no contract link at all',
   contractLinks(none)===0 && !/Contract</.test(none), contractLinks(none)+' links');
}

console.log('\n3. The server refuses the shortcut too');
(async()=>{
 process.env.DASHBOARD_KEY='k';
 const {handler}=require(path.join(__dirname,'..','netlify','functions','quote-response.js'));
 const base=()=>({ref:'SBC-1',status:'sent',customer:{name:'A Customer',email:'c@e.com'},
   estimate:{markupPct:0,showLaborCost:true,showMaterialsCost:true,
     labor:[{section:'S',item:'x',qty:1,unit:'ls',rate:1000}],materials:[]}});
 const call=b=>handler({httpMethod:'POST',headers:{},body:JSON.stringify(b)});

 STORE={'SBC-1':Object.assign(base(),{includeContractForCustomer:true,contract:UNSIGNED})};writes=[];
 let r=await call({ref:'SBC-1',action:'accept',signature:'A Customer'});
 let b=JSON.parse(r.body);
 t('accept on a contract job -> 409, refused', r.statusCode===409, r.statusCode+' '+r.body.slice(0,120));
 t('...and the estimate is NOT accepted', STORE['SBC-1'].status==='sent', STORE['SBC-1'].status);
 t('...nothing written at all', writes.length===0, JSON.stringify(writes));
 t('...and it points at the contract', /contract\.html\?ref=SBC-1/.test(b.contractUrl||''), b.contractUrl);

 STORE={'SBC-1':Object.assign(base(),{includeContractForCustomer:true,contract:SIGNED})};writes=[];
 r=await call({ref:'SBC-1',action:'accept',signature:'A Customer'});
 t('once signed, accept goes through', r.statusCode===200, r.statusCode+' '+r.body.slice(0,100));

 STORE={'SBC-1':Object.assign(base(),{includeContractForCustomer:false})};writes=[];
 r=await call({ref:'SBC-1',action:'accept',signature:'A Customer'});
 t('a no-contract job approves exactly as before', r.statusCode===200 && STORE['SBC-1'].status==='accepted',
   r.statusCode+' status='+STORE['SBC-1'].status);

 STORE={'SBC-1':Object.assign(base(),{includeContractForCustomer:true,contract:UNSIGNED})};writes=[];
 r=await call({ref:'SBC-1',action:'question',questionText:'When can you start?'});
 t('asking a question is never blocked by the contract', r.statusCode===200, r.statusCode+' '+r.body.slice(0,90));

 console.log('\n  '+pass+' passed, '+fail+' failed');
})();
