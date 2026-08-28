/* contract-visibility.test.js — run: node js/contract-visibility.test.js */
/* The contract's route to the customer, and whether the preview tells the truth
   about it. Executed against quote.html's own contractHtml(). */
const fs=require('fs'),vm=require('vm');
const Q=fs.readFileSync(require('path').join(__dirname,'..','quote.html'),'utf8');
const D=fs.readFileSync(require('path').join(__dirname,'..','dashboard.html'),'utf8');
function ext(src,n){const s=src.indexOf('function '+n+'(');let i=src.indexOf('{',s),d=0;
 for(let j=i;j<src.length;j++){if(src[j]==='{')d++;else if(src[j]==='}'){d--;if(!d)return src.slice(s,j+1)}}}
let pass=0,fail=0;
const t=(n,c,d)=>{c?pass++:fail++;console.log((c?'PASS  ':'FAIL  ')+n+(d?'\n        '+d:''))};

const ctx={console,encodeURIComponent,ref:'SBC-260821-XQNQ',E:s=>String(s==null?'':s)};
vm.createContext(ctx);
vm.runInContext(ext(Q,'contractRequired'),ctx);
vm.runInContext(ext(Q,'contractHtml'),ctx);
/* Is the contract PRESENTED to the customer at all? Deliberately not a test of
   the button's wording: this file owns the visibility rule, and an earlier
   version asserted on the exact button text, so changing that text broke a test
   that had nothing to do with it. contract-approval.test.js owns which control
   appears and how many. */
const shows=r=>{
  const needs=vm.runInContext('contractRequired',ctx)(r);
  return /class="ey">Contract</.test(vm.runInContext('contractHtml',ctx)(r,needs));
};

const CONTRACT={sections:[{title:'Scope',body:'Stair work'}]};

console.log('\n1. The checkbox decides');
t('ticked + contract written  -> customer SEES it',
  shows({includeContractForCustomer:true,contract:CONTRACT}));
t('ticked, contract not written yet -> still offered',
  shows({includeContractForCustomer:true}));
t('UNTICKED + contract written -> customer does NOT see it',
  !shows({includeContractForCustomer:false,contract:CONTRACT}));
t('unticked, no contract -> nothing',
  !shows({includeContractForCustomer:false}));

console.log('\n2. Older records where no choice was ever made');
t('no flag + a contract exists -> still shown (never strip a live quote)',
  shows({contract:CONTRACT}));
t('no flag + no contract -> nothing', !shows({}));
t('null record does not throw', !shows(null));

console.log('\n3. The preview carries the decision');
const fn=ext(D,'previewBeforeSend');
t('the preview record includes the contract itself', /contract:\s*currentRecord\.contract/.test(fn));
t('...and the LIVE checkbox state, not the stored one',
  /includeContractForCustomer:\s*\(window\.__sbcIncludeContract === true\)/.test(fn),
  (fn.match(/includeContractForCustomer:[^,]*/)||['(absent)'])[0]);
t('send-quote writes that same flag',
  /record\.includeContractForCustomer = includeContract === true/
    .test(fs.readFileSync(require('path').join(__dirname,'..','netlify','functions','send-quote.js'),'utf8')));
t('the dashboard checkbox drives that variable',
  /var includeContract = \(window\.__sbcIncludeContract === true\)/.test(D));

console.log('\n  '+pass+' passed, '+fail+' failed');
