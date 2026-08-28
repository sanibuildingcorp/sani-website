/* contract-backlink.test.js — run: node js/contract-backlink.test.js */
/* contract.html must never be a dead end: the estimate sends the customer here
   to approve, so there has to be a route back to the scope, the prices and the
   message box. Executed against renderBackLink() itself. */
const fs=require('fs'),vm=require('vm');
const C=fs.readFileSync(require('path').join(__dirname,'..','contract.html'),'utf8');
function ext(n){const s=C.indexOf('function '+n+'(');let i=C.indexOf('{',s),d=0;
 for(let j=i;j<C.length;j++){if(C[j]==='{')d++;else if(C[j]==='}'){d--;if(!d)return C.slice(s,j+1)}}}
let pass=0,fail=0;
const t=(n,c,d)=>{c?pass++:fail++;console.log((c?'PASS  ':'FAIL  ')+n+(d?'\n        '+d:''))};

function run(ref){
 const els={};
 const ctx={console,encodeURIComponent,ref,
   document:{getElementById:id=>els[id]||(els[id]={id,innerHTML:''})}};
 vm.createContext(ctx);
 vm.runInContext(ext('renderBackLink'),ctx);
 vm.runInContext('renderBackLink()',ctx);
 return els;
}

console.log('\n1. The link is there, top and bottom');
{
 const els=run('SBC-260821-XQNQ');
 t('a back link at the top', /href="\/quote\.html\?ref=SBC-260821-XQNQ"/.test(els['back-to-estimate'].innerHTML),
   els['back-to-estimate'].innerHTML.slice(0,120));
 t('and another at the foot of the document',
   /href="\/quote\.html\?ref=SBC-260821-XQNQ"/.test(els['back-to-estimate-foot'].innerHTML));
 t('it says where it goes', /Back to your estimate/.test(els['back-to-estimate'].innerHTML));
 t('...and that questions live there',
   /ask us a question/.test(els['back-to-estimate'].innerHTML));
}

console.log('\n2. The ref survives intact');
{
 const els=run('SBC 26/08 &weird');
 const h=els['back-to-estimate'].innerHTML;
 t('an awkward ref is url-encoded, not broken',
   /href="\/quote\.html\?ref=SBC%2026%2F08%20%26weird"/.test(h), h.slice(0,140));
}

console.log('\n3. No ref, no broken link');
{
 const els=run(null);
 t('nothing is rendered rather than a link to nowhere',
   (els['back-to-estimate']===undefined)||els['back-to-estimate'].innerHTML==='',
   JSON.stringify(els['back-to-estimate']||null));
}

console.log('\n4. Wiring and print');
t('renderBackLink runs when the contract becomes visible',
  /state-main"\)\.style\.display="block";\s*\n\s*renderBackLink\(\);/.test(C));
t('the back link is hidden when printing',
  /@media print\{[\s\S]*?\.back-est\{display:none\}/.test(C));
t('the top slot sits above the hero, seen on landing',
  C.indexOf('id="back-to-estimate"')<C.indexOf('<div class="hero">'));

console.log('\n  '+pass+' passed, '+fail+' failed');
