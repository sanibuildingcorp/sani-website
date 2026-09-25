const fs = require('fs'), path = require('path');
const { missingMainMaterials } = require('./main-material');
let f=0; const t=(n,c)=>{console.log((c?'PASS  ':'FAIL  ')+n); if(!c)f++;};

/* Joshua's kitchen floor: every prep product, the epoxy primer - and no epoxy. */
const analysis={contractor_supplied_finish_materials:['Commercial-grade epoxy floor coating system']};
const joshua={materials:[
  {item:'Commercial kitchen degreaser, 5 gal'},{item:'Diamond grinding segments, set'},
  {item:'Epoxy bonding primer, 3 gal kit'},{item:'Rapid-cure self-leveler, 50 lb bag'},
  {item:'Slip-resistant aggregate, 50 lb'}],customerSupplied:[]};
t('epoxy missing, only its primer listed: REPORTED', missingMainMaterials(joshua,analysis).length===1);
const fixed={...joshua,materials:[...joshua.materials,{item:'100% solids epoxy floor coating, 3 gal kit'}]};
t('the epoxy coating on its own line: nothing reported', missingMainMaterials(fixed,analysis).length===0);
t('the customer supplies the epoxy: nothing reported', missingMainMaterials({...joshua,customerSupplied:[{item:'Epoxy coating (owner purchased)'}]},analysis).length===0);

/* Real lines worded differently still count. */
t('"Engineered oak plank flooring" covers "Engineered hardwood"', missingMainMaterials({materials:[{item:'Engineered oak plank flooring, 20 sf box'}]},{contractor_supplied_finish_materials:['Engineered hardwood']}).length===0);
t('"Interior latex paint" covers "Benjamin Moore Regal paint"', missingMainMaterials({materials:[{item:'Interior latex paint, eggshell, 1 gal'}]},{contractor_supplied_finish_materials:['Benjamin Moore Regal paint']}).length===0);
t('a primer job is covered by its primer', missingMainMaterials({materials:[{item:'Bonding primer, 1 gal'}]},{contractor_supplied_finish_materials:['Bonding primer']}).length===0);
t('no finish listed: nothing reported', missingMainMaterials({materials:[]},{}).length===0 && missingMainMaterials({materials:[]},{contractor_supplied_finish_materials:[]}).length===0);

/* Wired in: a miss fails validation, so the repair pass adds it; the estimator is told. */
const GEN=fs.readFileSync(path.join(__dirname,'..','generate-estimate-background.js'),'utf8');
t('validateEstimate reports a missing finish as a failure', /missingMainMaterials\(estimate, analysis\)\.forEach\(\(item\) => failures\.push/.test(GEN));
t('the estimator is told the finish gets its own line', /4d\. THE FINISH PRODUCT THE JOB IS FOR GETS ITS OWN MATERIAL LINE/.test(GEN) && /A primer, bonding coat, filler or leveler for that product does NOT replace it/.test(GEN));
t('never "licensed"', !/\blicensed\b/i.test(fs.readFileSync(path.join(__dirname,'main-material.js'),'utf8')));

console.log('\n'+(f?f+' FAILED':'ALL PASSED')); process.exit(f?1:0);
