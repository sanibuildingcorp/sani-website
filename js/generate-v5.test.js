/* generate-v5-background: new draft, chat update parked as changes, apply keeps his hand price + photos. Runs offline (fake AI, fake Blobs). */
const Module=require('module');const db={};const real=Module._load;Module._load=function(r,...a){if(r==='@netlify/blobs')return{db,getStore:()=>({get:async k=>db[k]?JSON.parse(JSON.stringify(db[k])):null,setJSON:async(k,v)=>{db[k]=JSON.parse(JSON.stringify(v))}})};return real.call(this,r,...a)};const B={db};
process.env.ANTHROPIC_API_KEY='x';const assert=require('assert');
const fn=require(__dirname+'/../netlify/functions/generate-v5-background.js');
let reply={projectTitle:'Toilet replacement',summary:'Replace the toilet. We are licensed.',services:[{name:'General',items:[{id:'toilet',qty:1}]}],facts:[{text:'Toilet is in hall bath'}],questions:['What color?','Is the shutoff valve working?'],status:'READY'};
global.fetch=async(u,o)=>({ok:true,json:async()=>({content:[{text:JSON.stringify(reply)}]})});
B.db['SBC-1']={ref:'SBC-1',status:'new',request:{service:'Bathroom',description:'replace toilet',photos:['https://x/p.jpg']},thread:[{from:'customer',text:'hi',at:'2026-10-01'}],customer:{name:'A'}};
(async()=>{
 await fn.handler({httpMethod:'POST',body:JSON.stringify({ref:'SBC-1',jobId:'j1',mode:'new'})});
 let r=B.db['SBC-1'];console.log(r.aiStatus,r.aiError||'',r.estimate.totals,r.estimate.manualCustomerScopeDraft.services.map(s=>s.name),r.estimate.summary,r.estimate.clarificationQuestions);
 r.estimate.labor[0].rate=999;r.estimate.labor[0].rateByHand=true;r.estimate.quotePhotos=['keep'];B.db['SBC-1']=r;
 reply.services[0].items.push({id:Object.keys(require(__dirname+'/../netlify/functions/lib/price-book-v5').byId).find(k=>/vanity/.test(k)),qty:1});
 await fn.handler({httpMethod:'POST',body:JSON.stringify({ref:'SBC-1',jobId:'j2',mode:'chat'})});
 r=B.db['SBC-1'];assert.strictEqual(r.estimate.totals.total,880.26,'live estimate must not move before Apply');console.log('pending',r.aiStatus,r.aiError||'',r.estimateV5Pending&&r.estimateV5Pending.changes.slice(0,4),'live total',r.estimate.totals.total);
 await fn.handler({httpMethod:'POST',body:JSON.stringify({ref:'SBC-1',apply:true})});
 r=B.db['SBC-1'];assert.strictEqual(r.estimate.labor[0].rate,999);assert.deepStrictEqual(r.estimate.quotePhotos,['keep']);assert.strictEqual(r.estimateHistory.length,1);assert.ok(!r.estimateV5Pending);console.log('PASS  generate-v5 new / chat / apply');
})();
