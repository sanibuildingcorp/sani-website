const { marketAudit, VERSION } = require('./lib/nyc-market-benchmark');
function line(section,item,qty,rate){return {section,item,qty,rate,unit:'unit'};}
function input(service,description,address='Brooklyn, NY 11235'){return {customer:{address},request:{service,selectedServices:[service],description,groupedAnswers:{}},contractor:{}};}
function analysis(project_type,quantities={}){return {project_type,project_summary:'',selected_trades:[],site_conditions:{},quantities,confirmed_scope:[]};}
function estimate(labor,materials,markupPct=25){return {labor,materials,markupPct,customerSupplied:[],options:[]};}
exports.handler=async function(){
  try{
    const cases=[];
    const bath=marketAudit(estimate([
      line('General','Bathroom demolition and debris removal',20,70),
      line('Bathroom','Large-format tile installation',18,70),
      line('Bathroom','Plumbing fixtures existing locations',36,80),
      line('Painting','Bathroom painting',12,60)
    ],[
      line('Bathroom','Waterproofing and setting materials',1,2600),
      line('Bathroom','90-minute fire-rated door assembly',1,2600)
    ]),analysis('Bathroom gut renovation',{tile_sf:87,fire_door_count:1}),input('Bathroom Renovation','Full gut bathroom. 87 SF 24x48 tile. Existing plumbing locations. Paint bathroom. Third-floor walk-up. Customer supplies tile and major fixtures.'));
    cases.push({name:'single-bath',ok:bath.checks.some(c=>c.code==='BATH_GUT_PROJECT')&&bath.pricingChanged===false&&bath.customerVisible===false,status:bath.status,checks:bath.checks.map(c=>({code:c.code,status:c.status}))});

    const paint=marketAudit(estimate([line('Painting','Interior painting walls ceilings and trim',40,100)],[]),analysis('Interior painting',{painting_sf:1000}),input('Interior Painting','Approximately 1,000 SF paintable walls ceilings and trim.'));
    const pc=paint.checks.find(c=>c.code==='PAINTING_PER_SF');
    cases.push({name:'brooklyn-paint',ok:!!pc&&pc.status==='PASS',status:paint.status,check:pc&&{actual:pc.actual,low:pc.expectedLow,high:pc.expectedHigh,status:pc.status}});

    const floor=marketAudit(estimate([line('Flooring','Engineered hardwood flooring installation',70,100)],[]),analysis('Flooring',{flooring_sf:640}),input('Flooring','Install approximately 640 SF engineered hardwood flooring.'));
    const fc=floor.checks.find(c=>c.code==='FLOORING_PER_SF');
    cases.push({name:'engineered-floor',ok:!!fc&&fc.status==='PASS'&&floor.checks.some(c=>c.code==='FLOORING_MINIMUM'&&c.status==='PASS'),status:floor.status,check:fc&&{actual:fc.actual,low:fc.expectedLow,high:fc.expectedHigh,status:fc.status}});

    const supplied=marketAudit(estimate([line('Bathroom','Bathroom labor',100,80)],[line('Bathroom','Contractor materials',1,12000)]),analysis('Bathroom renovation',{}),input('Bathroom Renovation','Customer supplies tile, vanity, toilet and major fixtures.'));
    cases.push({name:'customer-supplied-structure',ok:supplied.structureChecks.some(x=>x.code==='CUSTOMER_SUPPLIED_MATERIAL_SHARE')&&supplied.pricingChanged===false,status:supplied.status,structure:supplied.structureChecks.map(x=>x.code)});

    const ok=cases.every(c=>c.ok);
    return {statusCode:ok?200:500,headers:{'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify({ok,version:VERSION,cases})};
  }catch(error){return {statusCode:500,headers:{'content-type':'application/json'},body:JSON.stringify({ok:false,error:error.message})};}
};
