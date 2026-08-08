// Sani Building Corp — NYC market benchmark guardrails v2.3
// INTERNAL ESTIMATING QA ONLY. This module never changes customer pricing.
// Data basis: Sani NYC Pricing Benchmark (Aug 2026) + Brooklyn competitor intelligence (Aug 2026).
// Competitor ranges are informational context only and never drive BLOCK/PASS decisions.

const VERSION = 'nyc-benchmark-v2.3';

const BENCHMARKS = {
  bathroom_refresh:{label:'Bathroom cosmetic / refresh',unit:'project',low:9000,high:18000,confidence:'MED',source:'NYC pricing benchmark'},
  bathroom_gut_standard:{label:'Bathroom gut renovation — standard',unit:'project',low:35000,high:50000,confidence:'MED',source:'NYC pricing benchmark'},
  bathroom_painting:{label:'Bathroom painting',unit:'project',low:1200,high:2500,confidence:'MED',source:'NYC pricing benchmark'},
  bathroom_demo_allin:{label:'Bathroom tearout + ordinary disposal',unit:'project',low:1200,high:2800,confidence:'HIGH',source:'NYC pricing benchmark'},

  tile_typical_labor:{label:'Tile setting — typical labor',unit:'$/sqft labor',low:10,high:14,confidence:'MED',source:'NYC pricing benchmark'},
  tile_premium_labor:{label:'Tile setting — premium / large format',unit:'$/sqft labor',low:14,high:20,confidence:'MED',source:'NYC pricing benchmark'},
  tile_bath_installed:{label:'Bathroom tile installed',unit:'$/sqft',low:25,high:50,confidence:'MED',source:'NYC pricing benchmark'},

  waterproof_shower:{label:'Shower / bath waterproofing',unit:'project',low:3000,high:6000,confidence:'MED',source:'NYC pricing benchmark'},
  waterproof_membrane:{label:'Waterproof membrane installed',unit:'$/sqft',low:2,high:6,confidence:'MED',source:'NYC pricing benchmark'},

  plumbing_in_place:{label:'Plumbing fixtures — existing locations',unit:'project',low:4000,high:10000,confidence:'MED',source:'NYC pricing benchmark'},
  plumbing_relocation:{label:'Plumbing relocation / riser upgrades',unit:'project',low:12000,high:20000,confidence:'MED',source:'NYC pricing benchmark'},
  plumbing_rough_fixture:{label:'New plumbing rough per fixture',unit:'each',low:1500,high:2000,confidence:'MED',source:'NYC pricing benchmark'},

  drywall_standard:{label:'Standard drywall installed',unit:'$/sqft',low:1.50,high:3.00,confidence:'HIGH',source:'NYC pricing benchmark'},
  drywall_moisture:{label:'Moisture-resistant drywall installed',unit:'$/sqft',low:2.00,high:4.00,confidence:'HIGH',source:'NYC pricing benchmark'},
  drywall_level4:{label:'Level 4 drywall finish',unit:'$/sqft',low:2.05,high:3.95,confidence:'HIGH',source:'NYC pricing benchmark'},
  drywall_level5:{label:'Level 5 drywall finish',unit:'$/sqft',low:2.50,high:4.40,confidence:'HIGH',source:'NYC pricing benchmark'},

  painting_brooklyn:{label:'Brooklyn painting labor',unit:'$/sqft',low:4.00,high:5.50,confidence:'HIGH',source:'NYC pricing benchmark'},
  painting_queens:{label:'Queens painting labor',unit:'$/sqft',low:3.50,high:4.50,confidence:'HIGH',source:'NYC pricing benchmark'},
  painting_manhattan:{label:'Manhattan painting labor',unit:'$/sqft',low:5.00,high:7.00,confidence:'HIGH',source:'NYC pricing benchmark'},
  painting_full_scope:{label:'Painting walls + ceilings + trim',unit:'$/sqft',low:4.20,high:7.20,confidence:'HIGH',source:'NYC pricing benchmark'},
  painting_heavy_prep:{label:'Painting — heavy prep / premium',unit:'$/sqft',low:6.00,high:9.60,confidence:'HIGH',source:'NYC pricing benchmark'},

  engineered_flooring:{label:'Engineered hardwood installed',unit:'$/sqft',low:8,high:15,confidence:'MED',source:'NYC pricing benchmark'},
  solid_flooring:{label:'Solid hardwood installed',unit:'$/sqft',low:10,high:20,confidence:'MED',source:'NYC pricing benchmark'},
  floor_refinishing:{label:'Hardwood floor refinishing',unit:'$/sqft',low:4,high:8,confidence:'MED',source:'NYC pricing benchmark'},
  lvp_flooring:{label:'LVP / LVT installed',unit:'$/sqft',low:4,high:8,confidence:'MED',source:'NYC pricing benchmark'},

  carpenter_hourly:{label:'NYC carpenter billing rate',unit:'$/hour',low:61,high:102,confidence:'MED',source:'NYC pricing benchmark'},
  baseboard_install:{label:'Baseboard installation',unit:'$/lf',low:3,high:7,confidence:'MED',source:'NYC pricing benchmark'},

  door_interior:{label:'Standard interior door installed',unit:'each',low:400,high:900,confidence:'MED',source:'NYC pricing benchmark'},
  fire_door_90:{label:'90-minute steel fire door assembly installed',unit:'each',low:2200,high:4000,confidence:'MED',source:'NYC pricing benchmark'},

  window_standard:{label:'Standard vinyl replacement window',unit:'each',low:500,high:800,confidence:'HIGH',source:'NYC pricing benchmark'},
  window_average:{label:'NYC replacement window average',unit:'each',low:650,high:1250,confidence:'HIGH',source:'NYC pricing benchmark'},
  window_custom:{label:'Custom / specialty replacement window',unit:'each',low:1500,high:3000,confidence:'HIGH',source:'NYC pricing benchmark'},

  demo_full_interior:{label:'Full interior gut',unit:'$/sqft',low:3,high:12,confidence:'HIGH',source:'NYC pricing benchmark'},
  demo_tile:{label:'Old tile removal',unit:'$/sqft',low:3,high:6,confidence:'MED',source:'NYC pricing benchmark'},

  handyman_hourly:{label:'NYC handyman hourly',unit:'$/hour',low:48,high:80,confidence:'MED',source:'NYC pricing benchmark'},
  handyman_day:{label:'NYC handyman full day',unit:'day',low:350,high:600,confidence:'MED',source:'NYC pricing benchmark'},

  water_damage_project:{label:'Typical NYC water damage project',unit:'project',low:1492,high:6975,confidence:'HIGH',source:'NYC pricing benchmark'},
  water_damage_cat1:{label:'Clean-water remediation',unit:'$/sqft',low:4,high:5.50,confidence:'HIGH',source:'NYC pricing benchmark'},
  water_damage_cat2:{label:'Gray-water remediation',unit:'$/sqft',low:5,high:7,confidence:'HIGH',source:'NYC pricing benchmark'},
  water_damage_cat3:{label:'Black-water remediation',unit:'$/sqft',low:7,high:8.50,confidence:'HIGH',source:'NYC pricing benchmark'},

  kitchen_small:{label:'Small kitchen rip-and-replace',unit:'project',low:21000,high:71500,confidence:'HIGH',source:'NYC pricing benchmark'},
  kitchen_medium:{label:'Medium kitchen rip-and-replace',unit:'project',low:24500,high:107000,confidence:'HIGH',source:'NYC pricing benchmark'},

  repoint_spot:{label:'Spot brick repointing',unit:'$/sqft',low:8,high:14,confidence:'HIGH',source:'NYC pricing benchmark'},
  repoint_facade:{label:'Single-facade repointing',unit:'$/sqft',low:12,high:20,confidence:'HIGH',source:'NYC pricing benchmark'},
  stucco_repair:{label:'Stucco / parging repair',unit:'$/sqft',low:10,high:30,confidence:'MED',source:'NYC pricing benchmark'}
};

const COMPETITOR_BANDS = {
  bathroom_refresh:{low:8000,high:28000,label:'Brooklyn public competitor refresh range',source:'Brooklyn competitor intelligence — Aug 2026'},
  bathroom_midrange:{low:12000,high:55000,label:'Brooklyn public competitor mid-range remodel',source:'Brooklyn competitor intelligence — Aug 2026'},
  bathroom_gut:{low:28000,high:65000,label:'Brooklyn public competitor full-gut range',source:'Brooklyn competitor intelligence — Aug 2026'}
};

const MINIMUMS = {
  handyman:{amount:250,label:'Sani handyman mobilization minimum'},
  tile:{amount:1500,label:'Tile project minimum'},
  painting_room:{amount:750,label:'One-room painting minimum'},
  bathroom_painting:{amount:1200,label:'Bathroom painting minimum'},
  drywall_repair:{amount:400,label:'Minor drywall repair minimum'},
  demo_bathroom:{amount:1200,label:'Bathroom demolition minimum'},
  flooring:{amount:3000,label:'Hardwood flooring project minimum'},
  masonry:{amount:1500,label:'Exterior masonry mobilization minimum'}
};

const ACCESS = {
  walkUp:{low:1.10,high:1.20,appliesTo:'demo_material_handling'},
  freightElevator:{low:1.20,high:1.30,appliesTo:'delivery_and_labor'},
  preWar:{low:1.10,high:1.10,appliesTo:'labor'},
  preWarCoop:{low:1.10,high:1.20,appliesTo:'total'},
  shortWorkday:{divisor:0.80,appliesTo:'labor_hours'},
  offHours:{low:1.10,high:1.20,appliesTo:'labor'},
  borough:{Manhattan:{low:1.15,high:1.30},Brooklyn:{low:1.05,high:1.15},Queens:{low:1.00,high:1.00},Bronx:{low:0.95,high:1.00},'Staten Island':{low:0.93,high:1.00}}
};

function n(v){const x=Number(v);return Number.isFinite(x)&&x>0?x:0;}
function money(v){return Math.round((Number(v)||0)*100)/100;}
function txt(v){return String(v==null?'':v).trim();}
function norm(v){return txt(v).toLowerCase();}
function lineTotal(l){return n(l&&l.qty)*n(l&&l.rate);}
function sum(lines){return (lines||[]).reduce((s,l)=>s+lineTotal(l),0);}
function allLines(estimate){return [...(estimate&&estimate.labor||[]),...(estimate&&estimate.materials||[])];}
function lineText(l){return norm(`${l&&l.section||''} ${l&&l.item||''} ${l&&l.description||''}`);}
function totals(estimate){const labor=money(sum(estimate&&estimate.labor)),materials=money(sum(estimate&&estimate.materials)),subtotal=money(labor+materials),markupPct=Number.isFinite(Number(estimate&&estimate.markupPct))?Number(estimate.markupPct):25,markup=money(subtotal*markupPct/100);return{labor,materials,subtotal,markupPct,markup,grandTotal:money(subtotal+markup)};}
function markupMultiplier(estimate){return 1+(Number.isFinite(Number(estimate&&estimate.markupPct))?Number(estimate.markupPct):25)/100;}
function sellingTotalBy(estimate,re){return money(allLines(estimate).filter(l=>re.test(lineText(l))).reduce((s,l)=>s+lineTotal(l),0)*markupMultiplier(estimate));}
function laborSellingBy(estimate,re){return money((estimate&&estimate.labor||[]).filter(l=>re.test(lineText(l))).reduce((s,l)=>s+lineTotal(l),0)*markupMultiplier(estimate));}
function sectionSellingTotal(estimate,section){const target=norm(section);return money(allLines(estimate).filter(l=>norm(l.section)===target).reduce((s,l)=>s+lineTotal(l),0)*markupMultiplier(estimate));}

function evidence(input,analysis){return norm([input&&input.customer&&input.customer.address,input&&input.request&&input.request.service,input&&input.request&&input.request.selectedServices,input&&input.request&&input.request.description,input&&input.request&&input.request.extraNotes,input&&input.contractor&&input.contractor.extraRequest,input&&input.request&&input.request.groupedAnswers,analysis&&analysis.project_type,analysis&&analysis.project_summary,JSON.stringify(analysis&&analysis.selected_trades||[]),JSON.stringify(analysis&&analysis.site_conditions||{}),JSON.stringify(analysis&&analysis.quantities||{}),JSON.stringify(analysis&&analysis.confirmed_scope||[])].filter(Boolean).join(' | '));}
function declaredServices(input,analysis){return norm([input&&input.request&&input.request.service,JSON.stringify(input&&input.request&&input.request.selectedServices||[]),analysis&&analysis.project_type].filter(Boolean).join(' | '));}
function isSinglePrimary(input,analysis,kind){const d=declaredServices(input,analysis);if(!d||d==='general')return false;const map={bathroom:/bathroom|bath remodel|bath renovation/,kitchen:/kitchen/,painting:/painting|interior paint/,flooring:/flooring|hardwood|lvp|lvt/,window:/window/,water_damage:/water damage|restoration|remediation/,handyman:/handyman/,masonry:/masonry|brick|facade|repoint|pointing/};const target=map[kind];if(!target||!target.test(d))return false;return Object.entries(map).filter(([k])=>k!==kind).every(([,re])=>!re.test(d));}
function firstQ(q,keys){for(const k of keys){if(n(q&&q[k]))return n(q[k]);}return 0;}
function findNumber(e,patterns){for(const re of patterns){const m=e.match(re);if(m)return n(String(m[1]).replace(/,/g,''));}return 0;}
function detectBorough(e){if(/\b100\d{2}\b|\b101\d{2}\b|\b102\d{2}\b|\bmanhattan\b/.test(e))return'Manhattan';if(/\b112\d{2}\b|\bbrooklyn\b/.test(e))return'Brooklyn';if(/\b111\d{2}\b|\b113\d{2}\b|\b114\d{2}\b|\bqueens\b|\bastoria\b|\blong island city\b|\bflushing\b/.test(e))return'Queens';if(/\b104\d{2}\b|\bbronx\b/.test(e))return'Bronx';if(/\b103\d{2}\b|\bstaten island\b/.test(e))return'Staten Island';return'NYC';}

function detectQuantities(e,analysis){const q=analysis&&analysis.quantities||{};return{
  paintingSf:firstQ(q,['painting_sf','paintingSf','paintable_sf','paintableSf'])||findNumber(e,[/([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square feet)[^|\n]{0,45}(?:paint|paintable)/i,/(?:paint|paintable)[^\d]{0,45}([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square feet)/i]),
  flooringSf:firstQ(q,['flooring_sf','flooringSf','floor_sf','floorSf'])||findNumber(e,[/([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square feet)[^|\n]{0,45}(?:flooring|hardwood|lvp|vinyl plank)/i]),
  tileSf:firstQ(q,['tile_sf','tileSf'])||findNumber(e,[/(?:total\s+tile\s+installation|tile\s+installation)[^\d]{0,35}([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square feet)/i,/([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square feet)[^|\n]{0,45}(?:tile|shower wall)/i]),
  drywallSf:firstQ(q,['drywall_sf','drywallSf','sheetrock_sf','sheetrockSf'])||findNumber(e,[/([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square feet)[^|\n]{0,45}(?:drywall|sheetrock|gypsum)/i]),
  demoSf:firstQ(q,['demo_sf','demoSf','demolition_sf','demolitionSf'])||findNumber(e,[/([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square feet)[^|\n]{0,45}(?:demo|demolition|gut)/i]),
  waterDamageSf:firstQ(q,['water_damage_sf','waterDamageSf','remediation_sf','remediationSf'])||findNumber(e,[/([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square feet)[^|\n]{0,45}(?:water damage|remediation|drying)/i]),
  masonrySf:firstQ(q,['masonry_sf','masonrySf','repoint_sf','repointSf','facade_sf','facadeSf'])||findNumber(e,[/([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square feet)[^|\n]{0,45}(?:repoint|pointing|brick|facade|stucco|parging)/i]),
  baseboardLf:firstQ(q,['baseboard_lf','baseboardLf'])||findNumber(e,[/([\d,]+(?:\.\d+)?)\s*(?:lf|linear feet|linear ft)[^|\n]{0,35}baseboard/i]),
  windowCount:firstQ(q,['window_count','windowCount','windows'])||findNumber(e,[/(\d+)\s+(?:replacement\s+)?windows?\b/i]),
  fireDoorCount:firstQ(q,['fire_door_count','fireDoorCount'])||findNumber(e,[/(\d+)\s+(?:90[- ]?minute|90[- ]?min|fire[- ]?rated)[^|\n]{0,30}doors?/i])
};}

function position(value,low,high){if(!(value>0)||!(low>0)||!(high>0))return{status:'NO_DATA',ratioToMid:0};const mid=(low+high)/2,ratio=value/mid;if(value<low*0.65)return{status:'LOW',ratioToMid:money(ratio)};if(value>high*1.35)return{status:'HIGH',ratioToMid:money(ratio)};if(value<low||value>high)return{status:'REVIEW',ratioToMid:money(ratio)};return{status:'PASS',ratioToMid:money(ratio)};}
function addCheck(checks,code,b,actual,note,type='MARKET'){if(!b||!(actual>0))return;const p=position(actual,b.low,b.high);checks.push({code,type,label:b.label,actual:money(actual),expectedLow:money(b.low),expectedHigh:money(b.high),unit:b.unit,confidence:b.confidence||'MED',source:b.source||'',status:p.status,ratioToMid:p.ratioToMid,note:note||''});}
function addMinimum(checks,code,label,actual,min){if(!(actual>0)||!(min>0))return;checks.push({code,type:'MINIMUM',label,actual:money(actual),expectedLow:money(min),expectedHigh:money(min),unit:'project minimum',confidence:'HIGH',source:'Sani internal minimum from Aug 2026 benchmark plan',status:actual<min?'LOW':'PASS',ratioToMid:money(actual/min),note:'Internal mobilization/minimum check; does not auto-change price.'});}
function competitiveContext(e,borough){if(!/bathroom/.test(e)||!['Brooklyn','NYC'].includes(borough))return[];const gut=/\bgut\b|demo(?:lition)?\s+to\s+stud|complete bathroom demolition|full bathroom demolition/.test(e),cosmetic=/reglaz|wall panel|cosmetic|refresh|fixture swap|no demolition|without demolition/.test(e),b=gut?COMPETITOR_BANDS.bathroom_gut:cosmetic?COMPETITOR_BANDS.bathroom_refresh:COMPETITOR_BANDS.bathroom_midrange;return[{code:'BROOKLYN_COMPETITOR_CONTEXT',label:b.label,low:b.low,high:b.high,source:b.source,informationalOnly:true}];}

function marketAudit(estimate,analysis,input){
  const e=evidence(input||{},analysis||{}),t=totals(estimate||{}),q=detectQuantities(e,analysis||{}),borough=detectBorough(e),checks=[],structureChecks=[],flags=[];
  const singleBath=isSinglePrimary(input,analysis,'bathroom'),singlePainting=isSinglePrimary(input,analysis,'painting'),singleFlooring=isSinglePrimary(input,analysis,'flooring'),singleWindows=isSinglePrimary(input,analysis,'window');
  const bathroom=sectionSellingTotal(estimate||{},'Bathroom')||sellingTotalBy(estimate,/bath|shower|vanity|toilet|waterproof|cement board|tile|grout|thinset|faucet|plumb/),painting=sectionSellingTotal(estimate||{},'Painting')||sellingTotalBy(estimate,/paint|primer|spackle/),flooring=sectionSellingTotal(estimate||{},'Flooring')||sellingTotalBy(estimate,/engineered hardwood|solid hardwood|flooring install|floor refin|lvp|lvt|vinyl plank|carpet/),windows=sectionSellingTotal(estimate||{},'Windows')||sellingTotalBy(estimate,/window|glazier/);

  const gutBath=/\bgut\b|demo(?:lition)?\s+to\s+stud|complete bathroom demolition|full bathroom demolition/.test(e);
  if(singleBath&&t.grandTotal>0)addCheck(checks,gutBath?'BATH_GUT_PROJECT':'BATH_REFRESH_PROJECT',gutBath?BENCHMARKS.bathroom_gut_standard:BENCHMARKS.bathroom_refresh,t.grandTotal,'Whole-project selling price used because bathroom is the only declared primary service.');

  const paintActual=(singlePainting?t.grandTotal:painting);if(q.paintingSf>0&&paintActual>0){const per=paintActual/q.paintingSf,heavy=/heavy prep|level 5|significant patch|extensive repair|premium paint/.test(e),b=heavy?BENCHMARKS.painting_heavy_prep:borough==='Manhattan'?BENCHMARKS.painting_manhattan:borough==='Brooklyn'?BENCHMARKS.painting_brooklyn:borough==='Queens'?BENCHMARKS.painting_queens:BENCHMARKS.painting_full_scope;addCheck(checks,'PAINTING_PER_SF',b,per,`Detected paintable area: ${q.paintingSf} SF.`);}

  const flooringActual=(singleFlooring?t.grandTotal:flooring);if(q.flooringSf>0&&flooringActual>0){const per=flooringActual/q.flooringSf,b=/refinish|sand\s*(?:and|&|\+)\s*(?:coat|finish)/.test(e)?BENCHMARKS.floor_refinishing:/lvp|lvt|vinyl plank/.test(e)?BENCHMARKS.lvp_flooring:/solid hardwood/.test(e)?BENCHMARKS.solid_flooring:BENCHMARKS.engineered_flooring;addCheck(checks,'FLOORING_PER_SF',b,per,`Detected flooring area: ${q.flooringSf} SF.`);addMinimum(checks,'FLOORING_MINIMUM',MINIMUMS.flooring.label,flooringActual,MINIMUMS.flooring.amount);}

  if(q.tileSf>0){const tileLabor=laborSellingBy(estimate,/tile setter|tile install|large[- ]?format|herringbone|mosaic|diagonal/),tileSell=sellingTotalBy(estimate,/tile setter|tile install|thinset|grout|tile setting|large[- ]?format|herringbone|mosaic|diagonal/);if(tileLabor>0){const premium=/24\s*[x×]\s*48|large.?format|herringbone|diagonal|mosaic/.test(e);addCheck(checks,'TILE_LABOR_PER_SF',premium?BENCHMARKS.tile_premium_labor:BENCHMARKS.tile_typical_labor,tileLabor/q.tileSf,`Detected tile area: ${q.tileSf} SF.`);}if(tileSell>0)addMinimum(checks,'TILE_MINIMUM',MINIMUMS.tile.label,tileSell,MINIMUMS.tile.amount);}

  if(q.drywallSf>0){const dry=sellingTotalBy(estimate,/drywall|sheetrock|gypsum|taping|mudding|level 4|level 5/);if(dry>0){const b=/level 5/.test(e)?BENCHMARKS.drywall_level5:/level 4/.test(e)?BENCHMARKS.drywall_level4:/moisture|mold resistant|greenboard/.test(e)?BENCHMARKS.drywall_moisture:BENCHMARKS.drywall_standard;addCheck(checks,'DRYWALL_PER_SF',b,dry/q.drywallSf,`Detected drywall area: ${q.drywallSf} SF.`);}}

  const windowActual=(singleWindows?t.grandTotal:windows);if(q.windowCount>0&&windowActual>0)addCheck(checks,'WINDOW_PER_UNIT',/custom|specialty|acoustic/.test(e)?BENCHMARKS.window_custom:BENCHMARKS.window_average,windowActual/q.windowCount,`Detected window count: ${q.windowCount}.`);

  const demo=sellingTotalBy(estimate,/demolition|tearout|tear out|interior gut|debris removal|debris disposal/);if(singleBath&&demo>0){addCheck(checks,'BATH_DEMO_PROJECT',BENCHMARKS.bathroom_demo_allin,demo,'Bathroom demo + ordinary disposal benchmark. Walk-up is shown separately as access context.');addMinimum(checks,'BATH_DEMO_MINIMUM',MINIMUMS.demo_bathroom.label,demo,MINIMUMS.demo_bathroom.amount);}else if(q.demoSf>0&&demo>0)addCheck(checks,'DEMO_PER_SF',BENCHMARKS.demo_full_interior,demo/q.demoSf,`Detected demolition area: ${q.demoSf} SF.`);

  if(singleBath){const waterproof=sellingTotalBy(estimate,/waterproof|membrane|shower pan|pan system/);if(waterproof>0)addCheck(checks,'SHOWER_WATERPROOFING',BENCHMARKS.waterproof_shower,waterproof,'Bathroom waterproofing / pan scope detected.');const plumbing=sellingTotalBy(estimate,/plumb|toilet|vanity|faucet|shower trim|supply line|drain line/);if(plumbing>0)addCheck(checks,'BATH_PLUMBING',/relocat|riser|new rough|move plumbing/.test(e)?BENCHMARKS.plumbing_relocation:BENCHMARKS.plumbing_in_place,plumbing,/relocat|riser|new rough|move plumbing/.test(e)?'Plumbing relocation/roughing language detected.':'Existing-location fixture/plumbing context detected.');}

  if(q.baseboardLf>0){const carp=sellingTotalBy(estimate,/baseboard install|install baseboard/);if(carp>0)addCheck(checks,'BASEBOARD_PER_LF',BENCHMARKS.baseboard_install,carp/q.baseboardLf,`Detected baseboard: ${q.baseboardLf} LF.`);}
  if(q.fireDoorCount>0){const fd=sellingTotalBy(estimate,/90[- ]?minute|90[- ]?min|fire[- ]?rated.*door|door.*fire[- ]?rated/);if(fd>0)addCheck(checks,'FIRE_DOOR_PER_UNIT',BENCHMARKS.fire_door_90,fd/q.fireDoorCount,`Detected fire-door count: ${q.fireDoorCount}.`);}

  if(q.waterDamageSf>0){const wd=sellingTotalBy(estimate,/water damage|remediation|extraction|structural drying|dry[- ]?out/);if(wd>0){const b=/cat(?:egory)?\s*3|black water|sewage/.test(e)?BENCHMARKS.water_damage_cat3:/cat(?:egory)?\s*2|gray water|grey water/.test(e)?BENCHMARKS.water_damage_cat2:BENCHMARKS.water_damage_cat1;addCheck(checks,'WATER_DAMAGE_PER_SF',b,wd/q.waterDamageSf,`Detected affected area: ${q.waterDamageSf} SF.`);}}else if(isSinglePrimary(input,analysis,'water_damage')&&t.grandTotal>0)addCheck(checks,'WATER_DAMAGE_PROJECT',BENCHMARKS.water_damage_project,t.grandTotal,'Project-level water-damage benchmark.');

  if(isSinglePrimary(input,analysis,'kitchen')&&t.grandTotal>0){const kitchenSf=findNumber(e,[/(\d+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square feet)[^|\n]{0,40}kitchen/i,/kitchen[^\d]{0,40}(\d+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square feet)/i]);addCheck(checks,'KITCHEN_PROJECT',kitchenSf&&kitchenSf<=90?BENCHMARKS.kitchen_small:BENCHMARKS.kitchen_medium,t.grandTotal,kitchenSf?`Detected kitchen area: ${kitchenSf} SF.`:'Kitchen size not reliably detected; medium benchmark used.');}

  if(q.masonrySf>0){const mas=sellingTotalBy(estimate,/repoint|pointing|brick|masonry|facade|stucco|parging/);if(mas>0){const b=/stucco|parging/.test(e)?BENCHMARKS.stucco_repair:/spot|localized/.test(e)?BENCHMARKS.repoint_spot:BENCHMARKS.repoint_facade;addCheck(checks,'MASONRY_PER_SF',b,mas/q.masonrySf,`Detected masonry area: ${q.masonrySf} SF.`);addMinimum(checks,'MASONRY_MINIMUM',MINIMUMS.masonry.label,mas,MINIMUMS.masonry.amount);}}

  if(isSinglePrimary(input,analysis,'handyman')&&t.grandTotal>0)addMinimum(checks,'HANDYMAN_MINIMUM',MINIMUMS.handyman.label,t.grandTotal,MINIMUMS.handyman.amount);

  const customerSupplied=/customer supplies|customer supplied|owner supplied|client supplied|customer will supply|provided by customer/.test(e);if(customerSupplied&&t.subtotal>0){const materialShare=t.materials/t.subtotal;if(materialShare>0.35)structureChecks.push({severity:materialShare>0.50?'BLOCK':'REVIEW',code:'CUSTOMER_SUPPLIED_MATERIAL_SHARE',message:`Customer-supplied finishes detected, but contractor material share is ${Math.round(materialShare*100)}% of direct cost. Itemize rough/install materials and verify no finish-material duplication.`});}
  const coordination=sum(allLines(estimate).filter(l=>/project coordination|project management|general conditions|supervision/.test(lineText(l))));if(t.subtotal>0&&coordination/t.subtotal>0.12)structureChecks.push({severity:'REVIEW',code:'COORDINATION_SHARE_HIGH',message:'Separate coordination/general-conditions lines exceed 12% of direct cost. Verify they are not duplicating markup/overhead.'});

  if(/walk.?up|third floor|3rd floor|fourth floor|4th floor|no elevator/.test(e))flags.push({code:'WALK_UP',label:'Walk-up / no-elevator condition detected',benchmark:'10–20% on demo/material handling',lowFactor:ACCESS.walkUp.low,highFactor:ACCESS.walkUp.high});
  if(/freight elevator/.test(e))flags.push({code:'FREIGHT_ELEVATOR',label:'Freight-elevator scheduling detected',benchmark:'20–30% delivery/labor logistics context'});
  if(/pre[- ]war|built pre[- ]?1945/.test(e))flags.push({code:'PRE_WAR',label:'Pre-war condition detected',benchmark:'~10% labor context before building-specific restrictions'});
  if(/night work|overnight|off[- ]hours|weekend work/.test(e))flags.push({code:'OFF_HOURS',label:'Off-hours work detected',benchmark:'10–20% labor premium context'});
  if(borough!=='NYC')flags.push({code:'BOROUGH',label:borough,benchmark:ACCESS.borough[borough]||null});

  const severe=checks.filter(c=>['HIGH','LOW'].includes(c.status)),review=checks.filter(c=>c.status==='REVIEW'),highConfidenceSevere=severe.filter(c=>c.confidence==='HIGH');let status='PASS';if(highConfidenceSevere.length||severe.length>=2||structureChecks.some(x=>x.severity==='BLOCK'))status='BLOCK';else if(severe.length||review.length||structureChecks.length)status='REVIEW';else if(!checks.length)status='NO_BENCHMARK';
  const projectCheck=checks.find(c=>/PROJECT$/.test(c.code)||/^BATH_GUT_PROJECT$|^BATH_REFRESH_PROJECT$/.test(c.code)),marketPosition=projectCheck?(projectCheck.status==='HIGH'?'HIGH':projectCheck.status==='LOW'?'LOW':projectCheck.status==='PASS'?'COMPETITIVE':'EDGE'):(status==='PASS'?'COMPETITIVE':status==='NO_BENCHMARK'?'UNKNOWN':'REVIEW');

  return{version:VERSION,status,marketPosition,pricingChanged:false,customerVisible:false,borough,totals:t,checks,structureChecks,accessFlags:flags,competitiveContext:competitiveContext(e,borough),calibrationPriority:['Sani completed-job production history','current supplier/subcontractor quotes','NYC published benchmarks','public competitor context','AI judgment'],guidance:status==='BLOCK'?'Do not auto-send. Review production rates, quantities, duplicated scope, customer-supplied finish treatment, access and allowances.':status==='REVIEW'?'Estimate is near/outside one or more market or structure guardrails. Contractor review recommended before sending.':status==='PASS'?'Generated pricing is within the available NYC benchmark checks.':'No reliable benchmark match was detected. Use normal estimator review and collect actual-job calibration data.',checkedAt:new Date().toISOString()};
}

module.exports={VERSION,BENCHMARKS,COMPETITOR_BANDS,MINIMUMS,ACCESS,marketAudit};
