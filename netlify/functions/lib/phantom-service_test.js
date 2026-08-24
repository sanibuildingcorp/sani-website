const { consolidateCustomerPresentation } = require('./deterministic-pricing');
let f=0; const t=(n,c)=>{console.log((c?'PASS  ':'FAIL  ')+n); if(!c)f++;};

/* The Pilates studio. Note the line items deliberately contain the exact incidental
   nouns that used to invent services: "windows", "glass", "mirror", "tile". */
const input={request:{service:'Handyman',selectedServices:['Handyman'],
 description:'Office space currently a pilates studio. Painting 850 sq ft, no punch required, walls are good condition to paint. Fabrication and mounting wall mirrors, some patchwork flooring/tiling, hanging/mounting/moving furniture. Ceiling 756 sqft, Walls 1870 sqft.'}};
const analysis={selected_trades:['Handyman'],confirmed_scope:[
 {trade:'Painting',scope_items:['Ceiling and wall painting','Surface prep and spot patching']},
 {trade:'Mirror Installation',scope_items:['Fabricate and mount full wall mirror panels']},
 {trade:'Flooring',scope_items:['Patch damaged flooring and tile at repair areas']},
 {trade:'Furniture',scope_items:['Mounting, moving and assembly of furniture']}]};
const est={markupPct:25,
 labor:[
  {section:'Painting',item:'Masking of trim, glass, windows and HVAC before spraying',qty:8,rate:48},
  {section:'Painting',item:'Ceiling and wall painting, two coats',qty:96,rate:48},
  {section:'Mirror Installation',item:'Fabricate and mount full wall mirror panels',qty:34,rate:62},
  {section:'Flooring',item:'Patch damaged flooring and reset tile',qty:26,rate:55},
  {section:'Furniture',item:'Furniture assembly and relocation',qty:22,rate:45},
  {section:'General',item:'Nightly set-up, breakdown and door/window protection',qty:10,rate:45}],
 materials:[
  {section:'Painting',item:'Paint, primer and sundries',qty:1,rate:1420},
  {section:'Mirror Installation',item:'Mirror glass panels and mounting hardware',qty:1,rate:2180}],
 customerSupplied:[],exclusions:[],options:[]};

const out=consolidateCustomerPresentation(JSON.parse(JSON.stringify(est)),analysis,input);
const names=out.serviceBreakdown.map(s=>s.title);
out.serviceBreakdown.forEach(s=>console.log(`   ${s.title.padEnd(22)} $${s.subtotal.toFixed(2)}`));
console.log();
t('NO Windows card (line said "windows" twice)', !names.includes('Windows'));
t('NO Bathroom card (line said "mirror", "tile")', !names.includes('Bathroom'));
t('NO Doors card (line said "door")', !names.includes('Doors'));
t('NO Tile card (patch tile folds into Flooring)', !names.includes('Tile'));
t('has the four the customer actually asked for',
  ['Painting','Mirrors & Glass','Flooring','Furniture Assembly'].every(x=>names.includes(x)));
t('exactly four cards', names.length===4);
t('no card is $0', out.serviceBreakdown.every(s=>s.subtotal>0));
const direct=8*48+96*48+34*62+26*55+22*45+10*45+1420+2180;
const sum=out.serviceBreakdown.reduce((a,s)=>a+s.subtotal,0);
t(`cards sum to grand ($${(direct*1.25).toFixed(2)})`, Math.abs(sum-direct*1.25)<0.02);

/* And a job that genuinely IS windows must still get a Windows card. */
const w=consolidateCustomerPresentation(
 {markupPct:25,labor:[{section:'Windows',item:'Remove and replace eight windows',qty:24,rate:70}],
  materials:[{section:'Windows',item:'Vinyl double-hung windows',qty:8,rate:415}],customerSupplied:[],exclusions:[],options:[]},
 {selected_trades:['Handyman'],confirmed_scope:[{trade:'Windows',scope_items:['Replace eight windows']}]},
 {request:{service:'Handyman',description:'Replace eight windows in a 3rd floor walk-up.'}});
t('a real windows job DOES get a Windows card', w.serviceBreakdown.map(s=>s.title).includes('Windows'));

console.log('\n'+(f?f+' FAILED':'ALL PASSED')); process.exit(f?1:0);
