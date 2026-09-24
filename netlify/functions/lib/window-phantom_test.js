const { applyDeterministicPricing } = require('./deterministic-pricing');
let f=0; const t=(n,c)=>{console.log((c?'PASS  ':'FAIL  ')+n); if(!c)f++;};

/* "Look what it's shows in materials window option-a" - a kitchen floor job
   came back with "Window Option A" lines in its Materials. The request said
   "window" (the pass-through window, window protection) and "repair" (the
   floor), and that was enough to add six replacement windows to the total. */
const floorInput={request:{service:'Flooring',selectedServices:['Flooring'],
 description:'Commercial kitchen floor resurfacing, about 600 sq ft. Repair cracked areas, grind, prime, self-level and epoxy with slip-resistant finish. Work at night. Protect the pass-through window and equipment.',
 groupedAnswers:{'Any windows or doors to protect?':'Yes, the service window'}}};
const floorAnalysis={selected_trades:['Flooring'],confirmed_scope:[{trade:'Flooring',scope_items:['Grind, repair, self-level and epoxy the kitchen floor','Protect the pass-through window']}]};
const floorEst={markupPct:25,
 labor:[{section:'Flooring',item:'Diamond grind and repair cracked concrete',qty:24,rate:65},
        {section:'Flooring',item:'Prime, self-level and epoxy coat',qty:32,rate:65}],
 materials:[{section:'Flooring',item:'Rapid-cure self-leveler',qty:12,rate:58},
            {section:'Flooring',item:'Epoxy bonding primer',qty:4,rate:120}],
 customerSupplied:[],exclusions:[],options:[]};
const out=applyDeterministicPricing(floorEst,floorAnalysis,floorInput);
const lines=[...out.labor,...out.materials];
t('NO "Window Option A" line on a floor job', !lines.some(l=>/window option/i.test(l.item)));
t('...no window allowance or window labor at all', !lines.some(l=>/replacement windows/i.test(l.item)));
t('...no Window Option B offered', !(out.options||[]).some(o=>/window/i.test(`${o.label} ${o.description}`)));
t('...no window adjustment recorded', !out.deterministicPricing.adjustments.some(a=>/WINDOW|BASE_OPTION_PROMOTED/.test(a.type)));
t('...and the health check does not ask for windows', !out.estimateHealth.issues.some(i=>i.code==='WINDOW_BASE_OPTION_MISSING'));

/* A real windows job still gets its windows. */
const winInput={request:{service:'Handyman',description:'Replace eight windows in a 3rd floor walk-up.'}};
const winAnalysis={selected_trades:['Handyman'],confirmed_scope:[{trade:'Windows',scope_items:['Replace eight windows']}]};
const empty={markupPct:25,labor:[],materials:[],customerSupplied:[],exclusions:[],options:[]};
const w=applyDeterministicPricing(JSON.parse(JSON.stringify(empty)),winAnalysis,winInput);
t('a real windows job, nothing priced yet: the base windows are still added', w.labor.some(l=>/window option a/i.test(l.item)) && w.materials.some(l=>/replacement windows allowance/i.test(l.item)));

/* The customer picked Windows beside another trade. */
const both=applyDeterministicPricing(JSON.parse(JSON.stringify(floorEst)),{selected_trades:['Flooring']},
 {request:{service:'Flooring',selectedServices:['Flooring','Windows'],description:'Epoxy the kitchen floor and replace the two windows.'}});
t('customer picked Windows: the window base is still added', [...both.labor,...both.materials].some(l=>/window option a/i.test(l.item)));

/* The analyst wrote windows lines already: nothing added on top. */
const priced=applyDeterministicPricing({markupPct:25,labor:[{section:'Windows',item:'Remove and replace eight windows',qty:24,rate:70}],
 materials:[{section:'Windows',item:'Vinyl double-hung windows',qty:8,rate:415}],customerSupplied:[],exclusions:[],options:[]},winAnalysis,winInput);
t('windows already priced: no extra window lines', ![...priced.labor,...priced.materials].some(l=>/window option a/i.test(l.item)));

console.log('\n'+(f?f+' FAILED':'ALL PASSED')); process.exit(f?1:0);
