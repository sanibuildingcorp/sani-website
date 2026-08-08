const assert = require('assert');
const { marketAudit, VERSION } = require('./nyc-market-benchmark');

function input(service, description, address='Brooklyn, NY 11235', selectedServices=[]) {
  return {
    customer:{address},
    request:{service,selectedServices,description,groupedAnswers:{}},
    contractor:{}
  };
}
function analysis(projectType, quantities={}) {
  return {project_type:projectType,project_summary:'',selected_trades:[],site_conditions:{},quantities,confirmed_scope:[]};
}
function estimate(labor, materials, markupPct=25) {
  return {labor,materials,markupPct,customerSupplied:[],options:[]};
}
function line(section,item,qty,rate){ return {section,item,qty,rate,unit:'unit'}; }

// 1) A single bathroom remains a bathroom project even when its detailed scope mentions painting/tile.
{
  const e=estimate([
    line('General','Bathroom demolition and debris removal',30,70),
    line('Bathroom','Large-format tile installation',40,70),
    line('Bathroom','Plumbing fixtures existing locations',40,80),
    line('Painting','Bathroom painting',12,60)
  ],[
    line('Bathroom','Waterproofing and setting materials',1,3500),
    line('Bathroom','90-minute fire-rated door assembly',1,2600)
  ]);
  const a=marketAudit(e,analysis('Bathroom gut renovation',{tile_sf:87,fire_door_count:1}),input('Bathroom Renovation','Full gut bathroom. 87 SF large-format tile. Paint bathroom. Customer supplies tile and major fixtures. Third-floor walk-up.'));
  assert.equal(a.version,VERSION);
  assert(a.checks.some(c=>c.code==='BATH_GUT_PROJECT'),'single bathroom project benchmark missing');
  assert(a.competitiveContext.length===1,'Brooklyn competitor context missing');
  assert.equal(a.pricingChanged,false);
  assert.equal(a.customerVisible,false);
}

// 2) Clearly inflated tile labor should be surfaced without silently changing pricing.
{
  const e=estimate([line('Bathroom','Large-format tile installation',50,80)],[]);
  const a=marketAudit(e,analysis('Bathroom renovation',{tile_sf:87}),input('Bathroom Renovation','87 SF 24x48 large-format tile installation.'));
  const c=a.checks.find(x=>x.code==='TILE_LABOR_PER_SF');
  assert(c,'tile labor check missing');
  assert(['HIGH','REVIEW'].includes(c.status),'inflated tile labor was not flagged');
  assert.equal(a.pricingChanged,false);
}

// 3) Brooklyn painting near $5/SF should pass the market check.
{
  const e=estimate([line('Painting','Interior painting walls ceilings and trim',40,100)],[]); // $4,000 cost => $5,000 selling
  const a=marketAudit(e,analysis('Interior painting',{painting_sf:1000}),input('Interior Painting','Approximately 1,000 SF paintable walls ceilings and trim.'));
  const c=a.checks.find(x=>x.code==='PAINTING_PER_SF');
  assert(c,'painting check missing');
  assert.equal(c.status,'PASS');
}

// 4) Engineered flooring around $13.7/SF should pass and clear the NYC project minimum.
{
  const e=estimate([line('Flooring','Engineered hardwood flooring installation',70,100)],[]); // $8,750 selling / 640 SF
  const a=marketAudit(e,analysis('Flooring',{flooring_sf:640}),input('Flooring','Install approximately 640 SF engineered hardwood flooring.'));
  assert.equal(a.checks.find(x=>x.code==='FLOORING_PER_SF').status,'PASS');
  assert.equal(a.checks.find(x=>x.code==='FLOORING_MINIMUM').status,'PASS');
}

// 5) Customer-supplied finish materials + excessive contractor material share is a structural block/review.
{
  const e=estimate([line('Bathroom','Bathroom labor',100,80)],[line('Bathroom','Contractor materials',1,12000)]);
  const a=marketAudit(e,analysis('Bathroom renovation',{}),input('Bathroom Renovation','Customer supplies tile, vanity, toilet and fixtures.'));
  assert(a.structureChecks.some(x=>x.code==='CUSTOMER_SUPPLIED_MATERIAL_SHARE'),'customer-supplied material duplication guard missing');
  assert(['BLOCK','REVIEW'].includes(a.status));
}

// 6) Small kitchen project in a broad NYC market range should create a project benchmark.
{
  const e=estimate([line('Kitchen','Kitchen renovation labor',200,100)],[line('Kitchen','Cabinets and rough materials',1,16000)]); // $45k selling
  const a=marketAudit(e,analysis('Kitchen renovation',{}),input('Kitchen Renovation','70 SF kitchen rip-and-replace.'));
  const c=a.checks.find(x=>x.code==='KITCHEN_PROJECT');
  assert(c,'kitchen project check missing');
  assert.equal(c.status,'PASS');
}

console.log(`NYC market benchmark regression tests passed (${VERSION})`);
