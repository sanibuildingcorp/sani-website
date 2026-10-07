/* ============================================================================
   lib/price-book-v5.js — Sani's price book (the ONLY place prices live)
   ----------------------------------------------------------------------------
   The AI never writes a price, an hour or a rate. It picks items from this
   book by id and gives a quantity. Code does the rest.

   Every number is Sani's COST (sub package / material purchase), before markup.
   status: 'DRAFT' = seeded from PRICING-CALIBRATION.md + NYC sub rates and must
   be confirmed by Zura. Change a number here and every new estimate follows.

   Item fields
     id          stable key the AI must use
     trade       default service name it belongs to
     name        line name the contractor sees
     unit        sf | lf | ea | room | hr | job
     labor       Sani labor/sub cost per unit
     hours       crew-hours per unit (timeline only, never price)
     min         minimum quantity charged
     cure        waiting days after this step (drying, curing)
     mat         materials per unit: [itemName, qtyPerUnit, unit, costEach, supplyKey?, finish?]
                 supplyKey -> the customer can supply it (material drops, labor stays)
                 finish:true -> shown to the customer as a product card
     step        [title, customer-facing text]  ({q} = quantity, {u} = unit)
     inc         included line for the customer ({q} {u})
     not         job-specific "not included" lines (max 2 per item)
     needs       what we need from the customer
   ============================================================================ */
'use strict';

const VERSION = 'v5.0-draft-2026-10-06';

const ITEMS = [
  /* ---------- whole project ---------- */
  { id:'protect', trade:'Whole Project', name:'Protection: floors, hallway, elevator', unit:'job', labor:120, hours:1.5, min:1,
    mat:[['Floor protection paper & tape',1,'kit',45]], step:['Protect and prepare','We protect floors, the hallway and the elevator before any work starts.'],
    inc:'Protection of floors, hallway and elevator' },
  { id:'cleanup', trade:'Whole Project', name:'Daily cleanup, debris removal & final clean', unit:'job', labor:180, hours:2.5, min:1,
    mat:[['Contractor bags & disposal',1,'job',60]], step:['Clean and walkthrough','Final cleaning. We walk through everything with you before we finish.'],
    inc:'Daily cleanup, debris removal and final cleaning' },

  { id:'setup_small', trade:'Whole Project', name:'Small job: protection, cleanup & disposal', unit:'job', labor:60, hours:0.5, min:1,
    mat:[['Drop cloths, bags & disposal',1,'job',15]], step:['Clean and walkthrough','We protect the area, clean up, take the old parts away and check everything with you.'],
    inc:'Protection, cleanup and disposal' },

  /* ---------- bathroom ---------- */
  { id:'bath_demo_gut', trade:'Bathroom', name:'Bathroom demolition to studs + disposal', unit:'sf', labor:28, hours:0.45, min:35,
    step:['Demolition','We remove the old tile, fixtures and walls down to the studs and carry all debris out.'],
    inc:'Demolition of the {q} sq ft bathroom down to the studs, with disposal', not:['Replacing rotted framing or subfloor beyond small repairs — we show you and price it first'] },
  { id:'bath_rough_plumb', trade:'Bathroom', name:'Plumbing rough-in, fixtures in same location', unit:'job', labor:1100, hours:10, min:1,
    mat:[['Valves, fittings & supply lines',1,'kit',260]], step:['Plumbing','Plumbing is prepared for the new fixtures, in the same locations.'],
    inc:'Plumbing rough-in for fixtures in their current locations', not:['Moving fixtures to new locations','Work on the building riser or main lines'] },
  { id:'bath_backer', trade:'Bathroom', name:'Cement board & sheetrock walls', unit:'sf', labor:4.5, hours:0.06, min:80,
    mat:[['Cement board / moisture-resistant board',0.034,'sheet',16],['Screws, tape, mud',0.01,'kit',40]],
    step:['Walls','New cement board in the wet areas and moisture-resistant board on the other walls.'], inc:'New cement board and moisture-resistant walls, about {q} sq ft' },
  { id:'waterproof', trade:'Bathroom', name:'Shower waterproofing membrane', unit:'sf', labor:3.5, hours:0.04, min:40, cure:1,
    mat:[['Waterproofing membrane',0.012,'roll',119]], step:['Waterproofing','The shower walls and floor are waterproofed and left to cure.'], inc:'Waterproofing of about {q} sq ft of shower walls and floor' },
  { id:'wall_tile', trade:'Bathroom', name:'Wall tile installation', unit:'sf', labor:14, hours:0.18, min:30, cure:1,
    mat:[['Wall tile',1.1,'sf',4.5,'wall_tile',true],['Thinset, grout & trim kit',0.012,'kit',140]],
    step:['Wall tile','We set the wall tile, then grout it after it cures.'], inc:'Wall tile installed on about {q} sq ft, grouted and sealed' },
  { id:'floor_tile', trade:'Bathroom', name:'Floor tile installation incl. leveling', unit:'sf', labor:15, hours:0.2, min:25, cure:1,
    mat:[['Floor tile',1.1,'sf',4,'floor_tile',true],['Mortar, leveler & grout kit',0.025,'kit',95]],
    step:['Floor tile','The floor is leveled and new tile is set and grouted.'], inc:'Floor tile installed on about {q} sq ft, leveled and grouted' },
  { id:'floor_heat', trade:'Bathroom', name:'Electric floor heating mat + thermostat', unit:'sf', labor:6, hours:0.05, min:20,
    mat:[['Floor heating mat',1,'sf',12,'floor_heat',true],['Thermostat',0.03,'ea',180,'thermostat',true]],
    step:['Floor heating','The heating mat is laid and tested before the tile goes down.'], inc:'Electric floor heating, about {q} sq ft, with thermostat', not:['New electrical circuit at the panel, if the building requires one'] },
  { id:'regrout', trade:'Bathroom', name:'Remove old grout, regrout & seal', unit:'sf', labor:12, hours:0.12, min:20, cure:1,
    mat:[['Grout, sealer & caulk kit',0.015,'kit',85,'grout',true]], step:['Shower grout','Old grout is removed and the shower is regrouted. Please do not use the shower for 24 hours while it cures.'],
    inc:'Remove old grout and regrout about {q} sq ft, then seal', not:['Re-tiling or replacing cracked tile'] },
  { id:'recaulk', trade:'Bathroom', name:'Remove & replace silicone caulk', unit:'lf', labor:4, hours:0.05, min:10,
    mat:[['Silicone caulk',0.05,'tube',12]], step:['Caulking','Old caulk is removed and fresh silicone is applied.'], inc:'Fresh silicone caulk along about {q} ft of tub and shower edges' },
  { id:'toilet', trade:'Bathroom', name:'Remove old toilet, install new, connect & test', unit:'ea', labor:220, hours:2.5, min:1,
    mat:[['Toilet, elongated 2-piece with seat',1,'ea',199,'toilet',true],['Wax ring, bolts & supply line',1,'kit',35]],
    step:['Toilet','The old toilet is removed and taken away. The new toilet is set, connected and tested for leaks.'],
    inc:'Remove and dispose of the old toilet; install the new toilet, connect and test', not:['Replacing the shut-off valve or pipes inside the wall'], needs:['Clear access to the bathroom'] },
  { id:'toilet_flushometer', trade:'Bathroom', name:'Flushometer toilet (no tank) replace', unit:'ea', labor:380, hours:4, min:1,
    mat:[['Wall-hung/flushometer bowl',1,'ea',320,'toilet',true],['Flush valve kit',1,'ea',190,'flush_valve',true]],
    step:['Toilet','The old bowl and flush valve are removed, the new ones installed and tested.'], inc:'Replace the flushometer toilet and flush valve; connect and test', not:['Work on the building water supply riser'] },
  { id:'vanity', trade:'Bathroom', name:'Remove old vanity, install new, connect & test', unit:'ea', labor:300, hours:4, min:1,
    mat:[['Vanity with top, 30 in',1,'ea',489,'vanity',true],['Faucet',1,'ea',129,'faucet',true],['Drain, trap & supply kit',1,'kit',55]],
    step:['Vanity','The old vanity is removed. The new vanity is set level, the faucet and drain are connected and tested.'],
    inc:'Remove and dispose of the old vanity; install the new vanity, top and faucet; connect and test' },
  { id:'shower_glass', trade:'Bathroom', name:'Glass shower door install', unit:'ea', labor:350, hours:4, min:1,
    mat:[['Glass shower door',1,'ea',900,'shower_glass',true]], step:['Glass door','The glass shower door is installed and sealed.'], inc:'Glass shower door installed and sealed' },
  { id:'bath_accessories', trade:'Bathroom', name:'Install accessories (bar, hooks, paper holder, mirror)', unit:'ea', labor:45, hours:0.5, min:1,
    mat:[['Bathroom accessory',1,'ea',35,'accessories',true]], step:['Accessories','Towel bars, hooks, paper holder and mirror are mounted.'], inc:'Mount {q} bathroom accessories' },
  { id:'exhaust_fan', trade:'Bathroom', name:'Replace exhaust fan (existing duct & wiring)', unit:'ea', labor:220, hours:2, min:1,
    mat:[['Exhaust fan',1,'ea',140,'fan',true]], step:['Exhaust fan','The old fan is replaced using the existing duct and wiring.'], inc:'Replace the exhaust fan using the existing duct and wiring', not:['New ductwork to the outside'] },

  /* ---------- painting (sf = WALL/ceiling surface) ---------- */
  { id:'paint_prep', trade:'Painting', name:'Patch, sand & spot prime', unit:'room', labor:110, hours:1.5, min:1,
    mat:[['Patch, primer & tape kit',1,'kit',45]], step:['Prep for paint','Holes and cracks are patched and sanded, and the spots are primed.'], inc:'Patch and spot prime walls in {q} room(s)' },
  { id:'paint_walls', trade:'Painting', name:'Paint walls, 2 coats', unit:'sf', labor:1.1, hours:0.016, min:100,
    mat:[['Interior paint',1/350,'gal',58,'paint',true]], step:['Paint walls','Two coats on the walls.'], inc:'Paint about {q} sq ft of walls, 2 coats' },
  { id:'paint_ceiling', trade:'Painting', name:'Paint ceilings, 2 coats', unit:'sf', labor:1.0, hours:0.018, min:50,
    mat:[['Ceiling paint',1/350,'gal',48,'ceiling_paint',true]], step:['Paint ceilings','Two coats on the ceilings.'], inc:'Paint about {q} sq ft of ceilings, 2 coats' },
  { id:'paint_trim', trade:'Painting', name:'Paint trim & baseboard', unit:'lf', labor:2.2, hours:0.03, min:20,
    mat:[['Semi-gloss trim paint',1/400,'gal',62]], step:['Paint trim','Trim and baseboards are painted.'], inc:'Paint about {q} ft of trim and baseboard' },
  { id:'paint_door', trade:'Painting', name:'Paint door & frame, both sides', unit:'ea', labor:85, hours:1.2, min:1,
    mat:[['Door paint',0.25,'gal',62]], step:['Paint doors','Doors and frames are painted on both sides.'], inc:'Paint {q} door(s) and frame(s), both sides' },
  { id:'skim', trade:'Painting', name:'Skim coat walls', unit:'sf', labor:1.8, hours:0.025, min:40, cure:1,
    mat:[['Joint compound',1/150,'box',22]], step:['Skim coat','Walls are skim coated, dried and sanded smooth.'], inc:'Skim coat about {q} sq ft of walls' },

  /* ---------- repairs / handyman ---------- */
  { id:'drywall_patch', trade:'Handyman', name:'Drywall patch, tape, finish (small)', unit:'ea', labor:120, hours:1.5, min:1, cure:1,
    mat:[['Patch, tape & mud kit',1,'kit',25]], step:['Drywall repair','The damaged spot is patched, taped, finished and sanded smooth.'], inc:'Repair {q} small drywall area(s), ready for paint' },
  { id:'handyman_hour', trade:'Handyman', name:'Handyman labor', unit:'hr', labor:75, hours:1, min:2,
    step:['Handyman work','The work you described is done and checked with you.'], inc:'About {q} hours of handyman work as described' },
  { id:'door_install', trade:'Carpentry', name:'Install pre-hung interior door', unit:'ea', labor:220, hours:3, min:1,
    mat:[['Pre-hung interior door',1,'ea',130,'door',true],['Hinges/handle set',1,'ea',35,'door_hardware',true]], step:['Door','The old door is removed and the new door is installed and adjusted.'], inc:'Install {q} interior door(s), adjusted to close properly' },
  { id:'trim_install', trade:'Carpentry', name:'Install baseboard / casing', unit:'lf', labor:4.5, hours:0.06, min:20,
    mat:[['Baseboard / casing',1.1,'lf',2.2,'trim',true],['Nails, caulk & filler',0.01,'kit',30]], step:['Trim','New baseboard and casing are installed, caulked and filled.'], inc:'Install about {q} ft of baseboard/casing' },

  /* ---------- flooring ---------- */
  { id:'floor_remove', trade:'Flooring', name:'Remove existing flooring + disposal', unit:'sf', labor:1.8, hours:0.02, min:50,
    step:['Remove old floor','The old flooring is removed and taken away.'], inc:'Remove and dispose of about {q} sq ft of old flooring' },
  { id:'lvp', trade:'Flooring', name:'Install vinyl plank / laminate', unit:'sf', labor:2.8, hours:0.03, min:80,
    mat:[['Vinyl plank flooring',1.1,'sf',2.9,'flooring',true],['Underlayment & transitions',0.01,'kit',60]], step:['New floor','The new floor is installed with transitions at the doorways.'], inc:'Install about {q} sq ft of vinyl plank / laminate', not:['Subfloor replacement'] },

  /* ---------- kitchen ---------- */
  { id:'cabinet_box', trade:'Kitchen', name:'Install kitchen cabinet (per box)', unit:'ea', labor:95, hours:1.2, min:4,
    mat:[['Shims, screws & fillers',0.1,'kit',40]], step:['Cabinets','Cabinets are installed level and secured, with fillers and panels.'], inc:'Install {q} cabinet boxes, level and secured', not:['Countertop fabrication','Oven, range or cooktop — set and connected by your gas contractor'] },
  { id:'backsplash', trade:'Kitchen', name:'Backsplash tile installation', unit:'sf', labor:16, hours:0.2, min:15, cure:1,
    mat:[['Backsplash tile',1.1,'sf',6,'backsplash',true],['Thinset & grout kit',0.04,'kit',60]], step:['Backsplash','Backsplash tile is set, grouted and sealed.'], inc:'Backsplash tile on about {q} sq ft' },
];

/* Access & building adders: applied once per job by code, from what the reader saw. */
const ACCESS = {
  walkupPerFloor: 45,     // per floor above 2nd, no elevator — carrying materials and debris
  coiAdmin: 0,            // COI is free; it only adds a customer need
  parkingPerDay: 0,       // set if you charge for parking
};

/* Markup curve — anchored on Sani actuals (PRICING-CALIBRATION.md §4.2). */
const MARKUP = [[0, 0.65], [2250, 0.71], [9690, 0.496], [30000, 0.485]];
const CREW = 2, DAY_HOURS = 8, WORK_HOURS_TEXT = '8am–5pm, Mon–Fri';

  byId: Object.fromEntries(ITEMS.map((i) => [i.id, i])) };
