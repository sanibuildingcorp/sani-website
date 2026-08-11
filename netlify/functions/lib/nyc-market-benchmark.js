// Sani Building Corp — NYC market benchmark guardrails v2.3
// INTERNAL ESTIMATING QA ONLY. This module never changes customer pricing.
// Data basis: Sani NYC Pricing Benchmark (Aug 2026) + Brooklyn competitor intelligence (Aug 2026)
//             + SANI_ACTUALS (Zura's own completed jobs — highest calibration priority).
// v2.4: added the missing MID-RANGE bathroom tier, three-way tier detection, Sani
//       completed-job anchors, markup-band check and explicit underpriced reporting.
// v2.5: painting rebuilt from sourced 2026 data (Angi NY, Google AI Overview, Housecall
//       Pro, Undertone, Zicklin). Bands widened, EXTERIOR path added (previously graded
//       against interior bands), per-room and per-apartment bands added, painter hourly
//       check added, and the misleading '...painting labor' labels corrected to ALL-IN:
//       the PAINTING_PER_SF check has always compared the full selling price, not labor.
// v2.6: UNIT FIX. Published painting $/SF rates (Angi $2-$6, Google $3-$7) are per SF of
//       FLOOR area, proven by Angi's own room table reproducing $2.00-$6.00/SF on floor
//       area for all five room sizes. The audit divided by PAINTABLE wall+ceiling area,
//       roughly 3x larger, so every painting job was graded against a band ~3x too high.
//       Bands are now basis-aware. Also adds SUB_BUDGET_TARGETS: the most a sub can be
//       paid and still leave Sani's own markup at market price.
// v2.7: carpentry split into real classifications (helper / rough / finish / master /
//       prevailing wage) with billable rates; LABOR_BURDEN added; markup restated as
//       GROSS MARGIN, the framing the trade actually uses; pre-war multiplier corrected
//       from 1.10 to 1.20-1.30; mid-grade trim and material waste factors added.
// v2.8: painting labor matrix + NYC production-rate method. INDEPENDENTLY CONFIRMS the
//       v2.6 unit finding — this source states its rates 'per Floor Sq Ft' outright.
//       Adds painter classifications, scope-specific floor-basis bands (walls / ceilings
//       / full package), prep tiers, graduated walk-up penalty by floor, Level-5 skim
//       coat, and specialty coatings. Also: back-solving this source's own billable rates
//       gives 65-71 paintable SF per painter-hour, vs paintingSfPerHour:32 in
//       deterministic-pricing.js — that constant is about 2x too slow.
// Competitor ranges are informational context only and never drive BLOCK/PASS decisions.

const VERSION = 'nyc-benchmark-v2.8';

const BENCHMARKS = {
  bathroom_refresh:{label:'Bathroom cosmetic / refresh — no demolition',unit:'project',low:8000,high:16000,confidence:'MED',source:'NYC pricing benchmark + Google AI Overview Aug 2026'},
  bathroom_midrange:{label:'Bathroom mid-range remodel — full demo, layout unchanged',unit:'project',low:15000,high:32000,confidence:'MED',source:'Google AI Overview + Sweeten + FatBook 2026; anchored on Sani completed 5x7 job'},
  bathroom_gut_standard:{label:'Bathroom gut renovation — to studs / layout or plumbing moved',unit:'project',low:32000,high:58000,confidence:'MED',source:'NYC pricing benchmark + Corniel/Sweeten 2026'},
  bathroom_floor_only:{label:'Bathroom floor replacement (tile, optional heat)',unit:'project',low:2800,high:5200,confidence:'HIGH',source:'Sani completed job Aug 2026'},
  bathroom_painting:{label:'Bathroom painting',unit:'project',low:900,high:2500,confidence:'MED',source:'NYC pricing benchmark; Angi NY bathroom room-paint range starts $200 — Sani floor kept higher for mobilization'},
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

  /* ALL-IN customer price per paintable SF, NOT labor only. The PAINTING_PER_SF check
     has always divided the full selling total by SF; the old 'labor' labels were wrong.
     NYC all-in is $3-$7/SF (Google AI Overview Aug 2026) and $2-$6/SF (Angi NY Jul 2026).
     Manhattan runs ~25% above Brooklyn/Queens — bands below reflect that spread. */
  painting_brooklyn:{label:'Brooklyn painting — all-in per paintable SF',unit:'$/sqft',low:3.20,high:5.80,confidence:'HIGH',source:'Angi NY 2026 + Google AI Overview Aug 2026'},
  painting_queens:{label:'Queens painting — all-in per paintable SF',unit:'$/sqft',low:2.80,high:5.20,confidence:'HIGH',source:'Angi NY 2026 + Google AI Overview Aug 2026'},
  painting_manhattan:{label:'Manhattan painting — all-in per paintable SF',unit:'$/sqft',low:4.20,high:7.50,confidence:'HIGH',source:'Google AI Overview Aug 2026 (Manhattan ~25% over outer boroughs)'},
  painting_full_scope:{label:'Painting walls + ceilings + trim — all-in per FLOOR SF',unit:'$/sqft floor',low:6.00,high:8.00,confidence:'HIGH',source:'Google AI Overview Aug 2026 production-rate method; Undertone 2026 runs higher ($5.25-$10.62) on high-end Manhattan'},
  painting_heavy_prep:{label:'Painting — heavy prep / skim coat / premium',unit:'$/sqft',low:6.00,high:10.60,confidence:'MED',source:'Undertone Interiors 2026 + Angi complex-surface uplift $6-$10/SF'},
  painting_exterior:{label:'Exterior painting — all-in per SF',unit:'$/sqft',low:1.50,high:4.00,confidence:'HIGH',source:'Housecall Pro 2026 painting price guide'},

  /* Room- and unit-level bands. Customers think in rooms and apartments, not SF. */
  painting_room_nyc:{label:'Paint one room — New York, NY',unit:'project',low:450,high:1802,confidence:'HIGH',source:'Angi New York NY Jul 2026 (avg $1,239)'},
  painting_room_small:{label:'Paint one small room (10x10 to 10x12)',unit:'project',low:200,high:720,confidence:'MED',source:'Angi New York NY Jul 2026 room-size table'},
  painting_bedroom:{label:'Paint a bedroom',unit:'project',low:400,high:1500,confidence:'MED',source:'Angi New York NY Jul 2026 room-type table'},
  painting_living_room:{label:'Paint a living room',unit:'project',low:600,high:2400,confidence:'MED',source:'Angi New York NY Jul 2026 room-type table'},
  painting_hallway:{label:'Paint a stairway / hallway',unit:'project',low:1200,high:1900,confidence:'MED',source:'Angi New York NY Jul 2026 room-type table'},
  painting_apt_1br:{label:'Paint a studio / 1-bedroom apartment',unit:'project',low:1500,high:3000,confidence:'HIGH',source:'Google AI Overview Aug 2026'},
  painting_apt_2br:{label:'Paint a 2-bedroom apartment',unit:'project',low:3000,high:7000,confidence:'HIGH',source:'Google AI Overview Aug 2026'},
  painting_whole_home:{label:'Whole-home interior repaint (1,500-2,000 SF)',unit:'project',low:4500,high:11500,confidence:'MED',source:'Housecall Pro 2026 national $3,000-$8,000 lifted to NYC (~+30%, cross-checked against NYC 2BR band per floor SF)'},

  /* Painting add-ons and rates. */
  painting_ceiling_sf:{label:'Ceiling painting add-on',unit:'$/sqft',low:2,high:6,confidence:'HIGH',source:'Angi New York NY Jul 2026'},
  painting_trim_lf:{label:'Trim / baseboard / crown painting',unit:'$/lf',low:1,high:6,confidence:'HIGH',source:'Angi New York NY Jul 2026'},
  painting_door_each:{label:'Door repaint',unit:'each',low:100,high:300,confidence:'MED',source:'Housecall Pro 2026'},
  painting_accent_wall:{label:'Accent wall',unit:'project',low:100,high:300,confidence:'MED',source:'Housecall Pro 2026'},
  skim_coat_sf:{label:'Skim coating to remove texture',unit:'$/sqft',low:1.10,high:1.30,confidence:'HIGH',source:'Angi New York NY Jul 2026'},
  painter_hourly_nyc:{label:'NYC painter billing rate — blended',unit:'$/hour',low:55,high:100,confidence:'HIGH',source:'Angi New York NY Jul 2026 ($55-$100); Google AI Overview $50-$75'},
  painter_helper:{label:'Painter apprentice / helper — billable',unit:'$/hour',low:30,high:45,confidence:'HIGH',source:'Google AI Overview Aug 2026 painting matrix (base $18-$25, 40% burden)'},
  painter_standard:{label:'Standard painter — billable',unit:'$/hour',low:55,high:75,confidence:'HIGH',source:'Google AI Overview Aug 2026 painting matrix (base $28-$40, 45% burden)'},
  painter_taper:{label:'Taper / plasterer — billable',unit:'$/hour',low:70,high:95,confidence:'HIGH',source:'Google AI Overview Aug 2026 painting matrix (base $35-$50, 45% burden)'},
  painter_master_level5:{label:'Master / Level-5 finisher — billable',unit:'$/hour',low:95,high:130,confidence:'HIGH',source:'Google AI Overview Aug 2026 painting matrix (base $50-$70, 50% burden)'},
  painter_prevailing:{label:'Prevailing wage / union painter — total package billable',unit:'$/hour',low:115,high:140,confidence:'HIGH',source:'Google AI Overview Aug 2026 (base $55.76 + mandatory fringe)'},

  /* Scope-specific, explicitly per FLOOR square foot, 2 coats included. These are more
     precise than the borough bands and are preferred whenever the scope is detectable. */
  painting_walls_only:{label:'Painting walls only — per FLOOR SF, 2 coats',unit:'$/sqft floor',low:3.00,high:4.50,confidence:'HIGH',source:'Google AI Overview Aug 2026 NYC production-rate method'},
  painting_ceilings_only:{label:'Painting ceilings only — per FLOOR SF, 2 coats',unit:'$/sqft floor',low:1.50,high:2.50,confidence:'HIGH',source:'Google AI Overview Aug 2026 NYC production-rate method'},
  painting_full_package:{label:'Painting full package: walls + ceilings + trim — per FLOOR SF',unit:'$/sqft floor',low:6.00,high:8.00,confidence:'HIGH',source:'Google AI Overview Aug 2026 NYC production-rate method'},
  painting_trim_doors_lf:{label:'Trim, baseboards and doors painted',unit:'$/lf',low:8.50,high:11.50,confidence:'HIGH',source:'Google AI Overview Aug 2026 NYC production-rate method'},
  skim_coat_level5:{label:'Tier 3 Level-5 full skim coat — per WALL SF',unit:'$/sqft wall',low:4.00,high:6.00,confidence:'HIGH',source:'Google AI Overview Aug 2026 NYC prep tiers (note: WALL area, not floor)'},
  specialty_coating_sf:{label:'Specialty coating application (anti-graffiti, structural steel)',unit:'$/sqft',low:6.00,high:20.00,confidence:'MED',source:'Google AI Overview Aug 2026'},
  specialty_coating_gallon:{label:'Specialty coating material',unit:'gallon',low:120,high:180,confidence:'MED',source:'Google AI Overview Aug 2026'},
  painter_day_rate:{label:'NYC painter day rate (non-union)',unit:'day',low:300,high:500,confidence:'MED',source:'Google AI Overview Aug 2026'},

  engineered_flooring:{label:'Engineered hardwood installed',unit:'$/sqft',low:8,high:15,confidence:'MED',source:'NYC pricing benchmark'},
  solid_flooring:{label:'Solid hardwood installed',unit:'$/sqft',low:10,high:20,confidence:'MED',source:'NYC pricing benchmark'},
  floor_refinishing:{label:'Hardwood floor refinishing',unit:'$/sqft',low:4,high:8,confidence:'MED',source:'NYC pricing benchmark'},
  lvp_flooring:{label:'LVP / LVT installed',unit:'$/sqft',low:4,high:8,confidence:'MED',source:'NYC pricing benchmark'},

  /* Carpentry is not one rate. BILLABLE (what the customer is charged), already
     including labor burden and margin. Base wage and burden are in LABOR_BURDEN. */
  carpenter_hourly:{label:'NYC carpenter billing rate — blended',unit:'$/hour',low:55,high:110,confidence:'MED',source:'Google AI Overview Aug 2026 NYC estimating matrix'},
  carpenter_helper:{label:'Carpenter apprentice / helper — billable',unit:'$/hour',low:30,high:45,confidence:'HIGH',source:'Google AI Overview Aug 2026 (base $18-$25, 40% burden)'},
  carpenter_rough:{label:'Rough carpenter — billable',unit:'$/hour',low:55,high:80,confidence:'HIGH',source:'Google AI Overview Aug 2026 (base $32-$48, 45% burden)'},
  carpenter_finish:{label:'Finish carpenter — billable',unit:'$/hour',low:80,high:110,confidence:'HIGH',source:'Google AI Overview Aug 2026 (base $45-$65, 50% burden)'},
  carpenter_master:{label:'Master carpenter / cabinetmaker — billable',unit:'$/hour',low:115,high:150,confidence:'HIGH',source:'Google AI Overview Aug 2026 (base $60-$85, 50% burden)'},
  carpenter_prevailing:{label:'Prevailing wage / union carpenter — total package billable',unit:'$/hour',low:115,high:140,confidence:'HIGH',source:'Google AI Overview Aug 2026 (base $59.05 + mandatory fringe)'},
  baseboard_install:{label:'Baseboard installation — labor only, simple profile',unit:'$/lf',low:3,high:7,confidence:'MED',source:'NYC pricing benchmark'},
  trim_midgrade_lf:{label:'Mid-grade interior trim installed — labor + consumables',unit:'$/lf',low:9.50,high:11.00,confidence:'HIGH',source:'Google AI Overview Aug 2026 NYC unit costing'},

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

/* SANI_ACTUALS — real completed Sani jobs. These outrank every published benchmark
   in this file (see calibrationPriority). Add a row after every finished job.
   directCost = what Zura actually paid out. sell = what the customer actually paid. */
const SANI_ACTUALS = {
  bathroom_5x7_midrange:{
    label:'Sani completed — 5x7 bathroom, full demo, floor + half-wall tile',
    tier:'midrange', floorSf:35, sell:14500, subLabor:7000, materials:2690, directCost:9690,
    markupOnCost:1.50, grossMarginPct:33.2, crew:'3 workers, ~10 days',
    scope:'Demo + disposal, framing repair, basic plumbing + water controller, cement board & sheetrock, floor and half-wall tile, glass shower door, toilet, entry door, paint half walls + ceiling, fixture install',
    customerSupplied:['vanity','sink','mirror'],
    source:'Sani completed job — reported Aug 2026'
  },
  bathroom_floor_heated:{
    label:'Sani completed — bathroom floor replacement with heating system',
    tier:'floor_only', floorSf:35, sell:3850, subLabor:1500, materials:750, directCost:2250,
    markupOnCost:1.71, grossMarginPct:41.6, crew:'2 workers, ~2 days',
    scope:'Demo, disposal, thinset and tile installation, electric floor heat',
    customerSupplied:['floor tile'],
    source:'Sani completed job — reported Aug 2026'
  }
};

/* LABOR_BURDEN — multiplier from base wage to true employee cost. NYC workers'
   compensation for structural carpentry is unusually expensive, which is why these run
   high. Sani currently buys SUBCONTRACT packages, not payroll, so a sub's own burden is
   already inside his flat quote — these apply only to self-performed labor. */
const LABOR_BURDEN = {
  helper:{factor:1.40,note:'Apprentice / helper, ~40%'},
  rough:{factor:1.45,note:'Rough carpentry, ~45%'},
  finish:{factor:1.50,note:'Finish carpentry, ~50%'},
  general:{factor:1.45,note:'Use when the trade is unknown'},
  source:'Google AI Overview Aug 2026 NYC estimating matrix'
};

/* GROSS_MARGIN — the framing the trade actually uses. Price is burdened cost divided by
   (1 - margin), NOT cost times a markup. Same arithmetic, but margin is what every other
   contractor quotes, so it is what to compare against. Sani's own jobs: 33.2% on the 5x7
   bathroom, 41.6% on the floor job — inside or just above the NYC band. */
const GROSS_MARGIN = {
  nycStandardLow:0.30, nycStandardHigh:0.40,
  source:'Google AI Overview Aug 2026 — standard NYC remodeling target 30%-40%',
  saniObserved:[{job:'5x7 bathroom',margin:0.332},{job:'bathroom floor + heat',margin:0.416}]
};
function marginFromMarkup(mult){return mult>0?Math.round((1-1/mult)*1000)/1000:0;}
function markupFromMargin(margin){return margin<1?Math.round((1/(1-margin))*100)/100:0;}
function priceFromBurdenedCost(cost,margin){return money(cost/(1-margin));}

/* PREP_TIERS — surface preparation is the single biggest swing in a repaint and must
   be priced separately from the base rate, never absorbed into it. */
const PREP_TIERS = {
  tier1:{label:'Light prep — nail holes, scuff sanding',effect:'included in base rate',factor:1.00},
  tier2:{label:'Moderate prep — stress cracks, scraping peeling paint, spot priming',effect:'+15% labor hours',factor:1.15},
  tier3:{label:'Heavy Tier 3 — Level-5 full skim over old lath/plaster or wallpaper damage',effect:'$4.00-$6.00 per WALL SF, added on top',perWallSf:{low:4.00,high:6.00}},
  source:'Google AI Overview Aug 2026 NYC prep tiers'
};

/* WALKUP_BY_FLOOR — graduated, replacing the flat 10-20%. Carrying ladders, 5-gallon
   buckets and drop cloths up stairs costs more the higher it goes. */
const WALKUP_BY_FLOOR = {3:1.05, 4:1.10, 5:1.15, note:'5th floor and above use 1.15', appliesTo:'labor_hours', source:'Google AI Overview Aug 2026'};
function walkUpFactor(floorNumber){const f=Number(floorNumber)||0;if(f<3)return 1.00;if(f===3)return WALKUP_BY_FLOOR[3];if(f===4)return WALKUP_BY_FLOOR[4];return WALKUP_BY_FLOOR[5];}

/* MATERIAL_WASTE — tight urban sites, delivery constraints and irregular layouts push
   lumber and architectural trim above the usual 10% nominal allowance. */
const MATERIAL_WASTE = {
  standard:0.10,
  lumberAndTrim:{low:0.12,high:0.15,note:'Lumber and architectural trim moldings in NYC'},
  source:'Google AI Overview Aug 2026 NYC estimating guardrails'
};

/* MARKUP_BANDS — derived from SANI_ACTUALS, not from published guides. Zura's real
   markup on direct cost was 1.71x on a $2,250 job and 1.50x on a $9,690 job.
   Small jobs must carry more markup: fixed mobilization cost does not shrink. */
const MARKUP_BANDS = [
  {maxDirectCost:4000,      low:1.60,high:1.75,label:'Small job (under $4k direct cost)'},
  {maxDirectCost:12000,     low:1.48,high:1.60,label:'Medium job ($4k-$12k direct cost)'},
  {maxDirectCost:Infinity,  low:1.42,high:1.55,label:'Large job (over $12k direct cost)'}
];

/* SUB_BUDGET_TARGETS — DERIVED, not observed. Zura has no consistent painting history,
   so these are computed: sourced market price, minus paint materials, divided by Zura's
   own markup band (which IS from real completed jobs). The output is the most a
   subcontractor can be paid on that job while Sani still earns its normal markup at a
   market price. A sub quoting above `maxSubLabor` means the job cannot be sold at market
   — that is information about the sub, not a reason to raise the price.
   Replace any row with a real completed job the moment one exists. */
const PAINT_MATERIAL_PER_PAINTABLE_SF = 0.42;  /* 2 coats @ ~$45/gal over 350 SF, + primer + supplies */
const PAINT_TARGET_POSITION = 0.35;            /* Brooklyn sits below band midpoint; Manhattan lifts the top */
const PAINT_SF_PER_PAINTER_DAY = 500;          /* finished 2-coat wall+ceiling per painter per day, occupied repaint */
const PAINT_SUB_DAY_RATE = 400;                /* non-union NYC painter day rate, Google AI Overview Aug 2026 */
const SUB_BUDGET_JOBS = [
  {key:'paint_single_room',   band:'painting_room_nyc',   paintableSf:430,  label:'Paint one room (about 10x12)'},
  {key:'paint_studio_1br',    band:'painting_apt_1br',    paintableSf:1400, label:'Paint a studio / 1-bedroom apartment'},
  {key:'paint_2br',           band:'painting_apt_2br',    paintableSf:2100, label:'Paint a 2-bedroom apartment'},
  {key:'paint_whole_home',    band:'painting_whole_home', paintableSf:4000, label:'Whole-home interior repaint (1,500-2,000 SF)'}
];

const COMPETITOR_BANDS = {
  bathroom_refresh:{low:8000,high:28000,label:'Brooklyn public competitor refresh range',source:'Brooklyn competitor intelligence — Aug 2026'},
  bathroom_midrange:{low:12000,high:55000,label:'Brooklyn public competitor mid-range remodel',source:'Brooklyn competitor intelligence — Aug 2026'},
  bathroom_floor_only:{low:2500,high:7000,label:'Brooklyn public competitor bathroom floor replacement',source:'Brooklyn competitor intelligence — Aug 2026'},
  bathroom_gut:{low:28000,high:65000,label:'Brooklyn public competitor full-gut range',source:'Brooklyn competitor intelligence — Aug 2026'}
};

function buildSubBudgetTargets(){
  const out={};
  for(const j of SUB_BUDGET_JOBS){
    const b=BENCHMARKS[j.band]; if(!b) continue;
    const targetSell=money(b.low+PAINT_TARGET_POSITION*(b.high-b.low));
    const materials=money(j.paintableSf*PAINT_MATERIAL_PER_PAINTABLE_SF);
    /* markup band depends on direct cost, and direct cost depends on the band.
       Two passes settle it for every realistic figure. */
    let cost=targetSell/1.60, band=markupBandFor(cost);
    cost=money(targetSell/((band.low+band.high)/2)); band=markupBandFor(cost);
    cost=money(targetSell/((band.low+band.high)/2));
    const maxSubLabor=money(cost-materials);
    /* Bottom-up reality check: what the job actually takes, priced at a real day rate.
       If minViableSell exceeds the market ceiling, this job cannot be subbed out and
       sold at market — self-perform it, or decline it. */
    const painterDays=Math.round((j.paintableSf/PAINT_SF_PER_PAINTER_DAY)*10)/10;
    const realSubCost=money(painterDays*PAINT_SUB_DAY_RATE);
    const minViableSell=money((realSubCost+materials)*band.low);
    out[j.key]={label:j.label,marketLow:b.low,marketHigh:b.high,targetSell,
      paintableSf:j.paintableSf,materialsBudget:materials,directCostBudget:cost,
      maxSubLabor,markupBand:band.label,
      painterDays,realSubCostAtDayRate:realSubCost,minViableSell,
      subbable:minViableSell<=b.high,
      headroom:money(b.high-minViableSell),
      basis:'DERIVED from market band ÷ Sani markup band, cross-checked bottom-up at '+PAINT_SF_PER_PAINTER_DAY+' SF/painter-day and $'+PAINT_SUB_DAY_RATE+'/day. No completed Sani painting job yet.',
      source:b.source};
  }
  return out;
}

const MINIMUMS = {
  handyman:{amount:250,label:'Sani handyman mobilization minimum'},
  tile:{amount:1500,label:'Tile project minimum'},
  painting_room:{amount:750,label:'One-room painting minimum'},
  bathroom_painting:{amount:1200,label:'Bathroom painting minimum'},
  drywall_repair:{amount:400,label:'Minor drywall repair minimum'},
  demo_bathroom:{amount:1200,label:'Bathroom demolition minimum'},
  bathroom_project:{amount:6000,label:'Full bathroom project minimum'},
  bathroom_floor:{amount:2500,label:'Bathroom floor replacement minimum'},
  flooring:{amount:3000,label:'Hardwood flooring project minimum'},
  masonry:{amount:1500,label:'Exterior masonry mobilization minimum'}
};

const ACCESS = {
  walkUp:{low:1.10,high:1.20,appliesTo:'demo_material_handling'},
  freightElevator:{low:1.20,high:1.30,appliesTo:'delivery_and_labor'},
  preWar:{low:1.20,high:1.30,appliesTo:'labor_hours',note:'Plaster repair, old-growth framing and strict building rules slow production. Corrected from 1.10 in v2.7.'},
  preWarCoop:{low:1.10,high:1.20,appliesTo:'total'},
  shortWorkday:{divisor:0.80,appliesTo:'labor_hours'},
  offHours:{low:1.10,high:1.20,appliesTo:'labor'},
  borough:{Manhattan:{low:1.15,high:1.30,note:'Painting source specifies a flat 1.15x for Manhattan: parking tickets, elevator time slots, high-end liability insurance'},Brooklyn:{low:1.00,high:1.10,note:'Corrected in v2.8 — painting source treats Brooklyn and Queens as the 1.0x baseline, not a premium'},Queens:{low:1.00,high:1.00},Bronx:{low:0.95,high:1.00},'Staten Island':{low:0.93,high:1.00}}
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
  fireDoorCount:firstQ(q,['fire_door_count','fireDoorCount'])||findNumber(e,[/(\d+)\s+(?:90[- ]?minute|90[- ]?min|fire[- ]?rated)[^|\n]{0,30}doors?/i]),
  roomCount:firstQ(q,['room_count','roomCount','rooms'])||findNumber(e,[/(\d+)\s*rooms?\b/i]),
  bedroomCount:firstQ(q,['bedroom_count','bedroomCount','bedrooms'])||findNumber(e,[/(\d+)[- ]?(?:bed|bedroom|br)\b/i]),
  trimLf:firstQ(q,['trim_lf','trimLf'])||findNumber(e,[/([\d,]+(?:\.\d+)?)\s*(?:lf|linear feet|linear ft)[^|\n]{0,35}(?:trim|crown|molding)/i]),
  /* FLOOR area, the basis published painting rates actually use. Kept separate from
     paintingSf, which is wall+ceiling surface. Mixing them is a ~3x error. */
  paintingFloorSf:firstQ(q,['painting_floor_sf','paintingFloorSf','apartment_sf','apartmentSf','home_sf','homeSf','unit_sf','unitSf'])||findNumber(e,[/([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square foot|square feet)\s*(?:apartment|apt\b|home|house|unit|condo|space)/i,/(?:apartment|apt\b|home|house|unit|condo)[^\d|\n]{0,25}([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square feet)/i])
};}

/* Wall+ceiling paintable area vs floor area is NOT one number. A single 10x12 room runs
   about 3.6x (small footprint, four full walls). A whole apartment runs about 2.3x
   (bigger rooms, shared walls, closets and cabinets excluded). Converting a floor-basis
   band with one factor produced false HIGH flags, so the converted band spans the whole
   ratio range and drops one confidence level to say so. */
const PAINT_WALL_TO_FLOOR = {min:2.3,max:3.6,typical:3.0};
function toPaintableBasis(b){return {
  label:b.label.replace(' per SF','')+' — per SF of PAINTABLE wall+ceiling',
  unit:'$/sqft paintable',
  low:money(b.low/PAINT_WALL_TO_FLOOR.max),
  high:money(b.high/PAINT_WALL_TO_FLOOR.min),
  confidence:b.confidence==='HIGH'?'MED':'LOW',
  source:b.source+` (converted from floor basis ÷${PAINT_WALL_TO_FLOOR.min}-${PAINT_WALL_TO_FLOOR.max}; give a floor area for a tighter check)`};}

/* Exterior painting was previously graded against INTERIOR bands and always read LOW.
   Exterior is a different product at $1.50-$4.00/SF. */
const PAINT_EXTERIOR = /exterior paint|paint(?:ing)? the exterior|outside paint|siding paint|paint (?:the )?siding|exterior repaint|facade paint/;
function isExteriorPainting(e){return PAINT_EXTERIOR.test(e);}
const PAINT_CEILINGS = /ceiling/;
const PAINT_TRIM = /trim|baseboard|crown|molding|casing|doors? painted|paint(?:ing)? (?:the )?doors?/;
const PAINT_WALLS_ONLY = /walls? only|only the walls?|walls? and nothing/;
function paintingSfBenchmark(e,borough){
  if(isExteriorPainting(e))return BENCHMARKS.painting_exterior;
  if(/heavy prep|level 5|full skim|skim coat/.test(e))return BENCHMARKS.painting_heavy_prep;
  /* Scope-specific floor-basis bands are more precise than a borough average and are
     preferred whenever the scope is stated. Borough is only the fallback. */
  const ceil=PAINT_CEILINGS.test(e),trim=PAINT_TRIM.test(e);
  if(ceil&&trim)return BENCHMARKS.painting_full_package;
  if(PAINT_WALLS_ONLY.test(e)||(!ceil&&!trim&&/wall/.test(e)))return BENCHMARKS.painting_walls_only;
  if(ceil&&!trim&&!/wall/.test(e))return BENCHMARKS.painting_ceilings_only;
  return borough==='Manhattan'?BENCHMARKS.painting_manhattan:borough==='Brooklyn'?BENCHMARKS.painting_brooklyn:borough==='Queens'?BENCHMARKS.painting_queens:BENCHMARKS.painting_full_scope;
}

function position(value,low,high){if(!(value>0)||!(low>0)||!(high>0))return{status:'NO_DATA',ratioToMid:0};const mid=(low+high)/2,ratio=value/mid;if(value<low*0.65)return{status:'LOW',ratioToMid:money(ratio)};if(value>high*1.35)return{status:'HIGH',ratioToMid:money(ratio)};if(value<low||value>high)return{status:'REVIEW',ratioToMid:money(ratio)};return{status:'PASS',ratioToMid:money(ratio)};}
function addCheck(checks,code,b,actual,note,type='MARKET'){if(!b||!(actual>0))return;const p=position(actual,b.low,b.high);checks.push({code,type,label:b.label,actual:money(actual),expectedLow:money(b.low),expectedHigh:money(b.high),unit:b.unit,confidence:b.confidence||'MED',source:b.source||'',status:p.status,ratioToMid:p.ratioToMid,note:note||''});}
function addMinimum(checks,code,label,actual,min){if(!(actual>0)||!(min>0))return;checks.push({code,type:'MINIMUM',label,actual:money(actual),expectedLow:money(min),expectedHigh:money(min),unit:'project minimum',confidence:'HIGH',source:'Sani internal minimum from Aug 2026 benchmark plan',status:actual<min?'LOW':'PASS',ratioToMid:money(actual/min),note:'Internal mobilization/minimum check; does not auto-change price.'});}
/* Three-way bathroom tier. v2.3 was binary and treated ANY demolition wording as a
   full gut, so a mid-range remodel got graded against $35k-$50k and failed LOW.
   A gut means to the studs, or the layout/plumbing MOVES. Full demolition on its own
   is an ordinary mid-range remodel and is the most common Sani job. */
const BATH_GUT = /\bgut\b|to the studs?|down to studs?|demo(?:lition)?\s+to\s+stud|strip(?:ped)?\s+to\s+stud|relocat\w*\s+(?:the\s+)?(?:plumb|fixture|toilet|shower|tub|drain|riser)|move\s+(?:the\s+)?(?:plumb|toilet|shower|tub|drain|waste|riser)|new\s+riser|layout\s+chang|chang\w*\s+the\s+layout|reconfigur/;
const BATH_COSMETIC = /reglaz|refinish\s+(?:the\s+)?tub|wall panel|cosmetic|refresh|fixture swap|no demolition|without demolition|no demo\b|surface[- ]level/;
const BATH_DEMO = /demo(?:lition|lish)?|tear\s?out|tear out|remove existing tile|gut/;
const BATH_FLOOR_ONLY = /floor (?:tile )?(?:replace|replacement)|replace (?:the )?(?:bathroom )?floor|floor only|heated floor|floor heating|heating system/;
const BATH_FULL_SCOPE = /wall tile|shower|tub|vanity|toilet|waterproof|cement board/;
const BATH_DEMO_NEGATED = /\b(?:no|without|zero|minimal|non)[- ]?(?:major\s+|full\s+)?(?:demo(?:lition|lish)?|tear\s?out|gut)\b/g;
function bathroomTier(e){
  /* "no demolition" contains "demolition" — strip negated wording FIRST or a
     wall-panel job reads as a full mid-range remodel. Caught by the Node harness. */
  const d=String(e||'').replace(BATH_DEMO_NEGATED,' ');
  if(BATH_FLOOR_ONLY.test(e)&&!BATH_FULL_SCOPE.test(e))return'floor_only';
  if(BATH_GUT.test(d))return'gut';
  if(BATH_COSMETIC.test(e)&&!BATH_DEMO.test(d))return'cosmetic';
  if(BATH_DEMO.test(d))return'midrange';
  return'cosmetic';
}
function bathTierBenchmark(tier){return tier==='gut'?BENCHMARKS.bathroom_gut_standard:tier==='floor_only'?BENCHMARKS.bathroom_floor_only:tier==='midrange'?BENCHMARKS.bathroom_midrange:BENCHMARKS.bathroom_refresh;}
function bathTierCode(tier){return tier==='gut'?'BATH_GUT_PROJECT':tier==='floor_only'?'BATH_FLOOR_PROJECT':tier==='midrange'?'BATH_MIDRANGE_PROJECT':'BATH_REFRESH_PROJECT';}
function saniAnchorFor(tier){return Object.values(SANI_ACTUALS).find(a=>a.tier===tier)||null;}

function markupBandFor(directCost){for(const b of MARKUP_BANDS){if(directCost<=b.maxDirectCost)return b;}return MARKUP_BANDS[MARKUP_BANDS.length-1];}
function addMarkupCheck(checks,t){
  if(!(t.subtotal>0))return null;
  const band=markupBandFor(t.subtotal),actual=money(1+t.markupPct/100);
  const status=actual<band.low?'LOW':actual>band.high?'HIGH':'PASS';
  const gm=marginFromMarkup(actual);
  const gmLow=marginFromMarkup(band.low),gmHigh=marginFromMarkup(band.high);
  checks.push({code:'MARKUP_BAND',type:'MARKUP',label:band.label,actual,expectedLow:band.low,expectedHigh:band.high,unit:'x direct cost',confidence:'HIGH',source:'Sani completed jobs Aug 2026 (SANI_ACTUALS)',status,ratioToMid:money(actual/((band.low+band.high)/2)),
    grossMargin:gm,grossMarginBand:[gmLow,gmHigh],nycStandardMargin:[GROSS_MARGIN.nycStandardLow,GROSS_MARGIN.nycStandardHigh],
    note:`Direct cost $${t.subtotal}. Dashboard markup ${t.markupPct}% = ${Math.round(gm*1000)/10}% gross margin. Sani's own completed jobs ran ${Math.round(gmLow*1000)/10}-${Math.round(gmHigh*1000)/10}% margin on jobs this size; NYC standard is 30-40%.`});
  return {band,actual,status,suggestedLow:money(t.subtotal*band.low),suggestedHigh:money(t.subtotal*band.high)};
}

function competitiveContext(e,borough){if(!/bathroom/.test(e)||!['Brooklyn','NYC'].includes(borough))return[];const tier=bathroomTier(e),b=tier==='gut'?COMPETITOR_BANDS.bathroom_gut:tier==='floor_only'?COMPETITOR_BANDS.bathroom_floor_only:tier==='cosmetic'?COMPETITOR_BANDS.bathroom_refresh:COMPETITOR_BANDS.bathroom_midrange;return[{code:'BROOKLYN_COMPETITOR_CONTEXT',label:b.label,low:b.low,high:b.high,source:b.source,tier,informationalOnly:true}];}

const SUB_BUDGET_TARGETS = buildSubBudgetTargets();

function marketAudit(estimate,analysis,input){
  const e=evidence(input||{},analysis||{}),t=totals(estimate||{}),q=detectQuantities(e,analysis||{}),borough=detectBorough(e),checks=[],structureChecks=[],flags=[];
  const singleBath=isSinglePrimary(input,analysis,'bathroom'),singlePainting=isSinglePrimary(input,analysis,'painting'),singleFlooring=isSinglePrimary(input,analysis,'flooring'),singleWindows=isSinglePrimary(input,analysis,'window');
  const bathroom=sectionSellingTotal(estimate||{},'Bathroom')||sellingTotalBy(estimate,/bath|shower|vanity|toilet|waterproof|cement board|tile|grout|thinset|faucet|plumb/),painting=sectionSellingTotal(estimate||{},'Painting')||sellingTotalBy(estimate,/paint|primer|spackle/),flooring=sectionSellingTotal(estimate||{},'Flooring')||sellingTotalBy(estimate,/engineered hardwood|solid hardwood|flooring install|floor refin|lvp|lvt|vinyl plank|carpet/),windows=sectionSellingTotal(estimate||{},'Windows')||sellingTotalBy(estimate,/window|glazier/);

  const bathTier=singleBath?bathroomTier(e):null;
  let saniAnchorCheck=null;
  if(singleBath&&t.grandTotal>0){
    const b=bathTierBenchmark(bathTier);
    addCheck(checks,bathTierCode(bathTier),b,t.grandTotal,`Whole-project selling price; bathroom is the only declared primary service. Detected tier: ${bathTier}.`);
    /* Sani's own completed work outranks every published band in this file. */
    const anchor=saniAnchorFor(bathTier);
    if(anchor){
      const p=position(t.grandTotal,anchor.sell*0.80,anchor.sell*1.45);
      saniAnchorCheck={code:'SANI_ACTUAL_ANCHOR',type:'SANI_HISTORY',label:anchor.label,actual:money(t.grandTotal),expectedLow:money(anchor.sell*0.80),expectedHigh:money(anchor.sell*1.45),unit:'project',confidence:'HIGH',source:anchor.source,status:p.status,ratioToMid:p.ratioToMid,note:`Sani sold a comparable job at $${anchor.sell} (direct cost $${anchor.directCost}, ${anchor.crew}).`};
      checks.push(saniAnchorCheck);
    }
    addMinimum(checks,'BATH_PROJECT_MINIMUM',bathTier==='floor_only'?MINIMUMS.bathroom_floor.label:MINIMUMS.bathroom_project.label,t.grandTotal,bathTier==='floor_only'?MINIMUMS.bathroom_floor.amount:MINIMUMS.bathroom_project.amount);
  }
  const markupInfo=addMarkupCheck(checks,t);

  const paintActual=(singlePainting?t.grandTotal:painting),exteriorPaint=isExteriorPainting(e);
  if(paintActual>0&&(q.paintingFloorSf>0||q.paintingSf>0)){
    const base=paintingSfBenchmark(e,borough);
    /* Prefer floor area, the basis the published rates use. Fall back to paintable
       wall area and convert the band, never the other way round. Exterior bands are
       already surface-based and are never converted. */
    const useFloor=q.paintingFloorSf>0||exteriorPaint;
    const sf=useFloor?(q.paintingFloorSf||q.paintingSf):q.paintingSf;
    const b=useFloor?base:toPaintableBasis(base);
    addCheck(checks,'PAINTING_PER_SF',b,paintActual/sf,`${sf} SF on a ${useFloor?(exteriorPaint?'exterior surface':'FLOOR'):'PAINTABLE wall+ceiling'} basis. ALL-IN selling price per SF.`);
  }
  /* Unit- and room-level checks. These fire when SF is unknown, which is the common
     case on a phone intake where the customer says "2 bedroom apartment". */
  if(!exteriorPaint&&paintActual>0){
    if(q.bedroomCount>=2&&q.bedroomCount<=2)addCheck(checks,'PAINTING_APT_2BR',BENCHMARKS.painting_apt_2br,paintActual,'Detected a 2-bedroom apartment repaint.');
    else if(q.bedroomCount===1||/\bstudio\b/.test(e))addCheck(checks,'PAINTING_APT_1BR',BENCHMARKS.painting_apt_1br,paintActual,'Detected a studio / 1-bedroom apartment repaint.');
    if(q.roomCount===1&&!q.bedroomCount)addCheck(checks,'PAINTING_SINGLE_ROOM',BENCHMARKS.painting_room_nyc,paintActual,'Detected a single-room repaint. Angi New York average is $1,239.');
    if(singlePainting)addMinimum(checks,'PAINTING_MINIMUM',MINIMUMS.painting_room.label,paintActual,MINIMUMS.painting_room.amount);
  }
  /* Carpenter hourly sanity, classification-aware. A finish rate on rough framing
     is as wrong as a rough rate on cabinetry. */
  (function(){
    const carp=(estimate&&estimate.labor||[]).filter(l=>/carpen|framing|trim work|millwork|cabinet|molding/.test(lineText(l))&&/^(hr|hrs|hour|hours)$/i.test(String(l.unit||'')));
    if(!carp.length)return;
    const l=carp[0],lt=lineText(l);
    const b=/cabinet|millwork|custom built|master carpenter/.test(lt)?BENCHMARKS.carpenter_master
      :/prevailing wage|union carpenter/.test(lt)?BENCHMARKS.carpenter_prevailing
      :/finish carpen|trim|molding|baseboard|casing|crown/.test(lt)?BENCHMARKS.carpenter_finish
      :/helper|apprentice|laborer/.test(lt)?BENCHMARKS.carpenter_helper
      :/framing|rough carpen|blocking|subfloor|joist|stud/.test(lt)?BENCHMARKS.carpenter_rough
      :BENCHMARKS.carpenter_hourly;
    addCheck(checks,'CARPENTER_HOURLY_RATE',b,money(n(l.rate)*markupMultiplier(estimate)),'Billed carpenter rate (rate x markup), matched to classification.');
  })();

  if(q.trimLf>0){const tr=sellingTotalBy(estimate,/trim|molding|casing|crown/);if(tr>0)addCheck(checks,'TRIM_PER_LF',BENCHMARKS.trim_midgrade_lf,tr/q.trimLf,`Detected trim: ${q.trimLf} LF. Mid-grade installed basis.`);}

  /* Painter hourly rate sanity — catches an AI-invented rate before it reaches a card. */
  (function(){
    const pl=(estimate&&estimate.labor||[]).filter(l=>/paint|skim|tap(?:e|ing)|plaster/.test(lineText(l))&&/^(hr|hrs|hour|hours)$/i.test(String(l.unit||'')));
    if(!pl.length)return;
    const l=pl[0],lt=lineText(l);
    const b=/level 5|master (?:painter|finisher)|full skim/.test(lt)?BENCHMARKS.painter_master_level5
      :/prevailing wage|union painter/.test(lt)?BENCHMARKS.painter_prevailing
      :/tap(?:e|ing)|plaster|skim/.test(lt)?BENCHMARKS.painter_taper
      :/helper|apprentice|laborer/.test(lt)?BENCHMARKS.painter_helper
      :BENCHMARKS.painter_standard;
    addCheck(checks,'PAINTER_HOURLY_RATE',b,money(n(l.rate)*markupMultiplier(estimate)),'Billed painter rate (rate x markup), matched to classification.');
  })();

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

  /* A price that is too LOW is a margin problem, never a reason to block sending.
     Only over-market or structural defects can BLOCK. Underpricing is surfaced
     separately in `underpriced` so the dashboard can show it as money left behind. */
  const pricingChecks=checks.filter(c=>c.type!=='MARKUP');
  const severe=pricingChecks.filter(c=>['HIGH','LOW'].includes(c.status)),review=pricingChecks.filter(c=>c.status==='REVIEW'),highSevereOver=severe.filter(c=>c.confidence==='HIGH'&&c.status==='HIGH');
  let status='PASS';
  if(highSevereOver.length||severe.filter(c=>c.status==='HIGH').length>=2||structureChecks.some(x=>x.severity==='BLOCK'))status='BLOCK';
  else if(severe.length||review.length||structureChecks.length||(markupInfo&&markupInfo.status!=='PASS'))status='REVIEW';
  else if(!pricingChecks.length)status='NO_BENCHMARK';
  const projectCheck=checks.find(c=>/PROJECT$/.test(c.code)||/^PAINTING_(?:APT_\w+|SINGLE_ROOM|WHOLE_HOME)$/.test(c.code)),marketPosition=projectCheck?(projectCheck.status==='HIGH'?'HIGH':projectCheck.status==='LOW'?'LOW':projectCheck.status==='PASS'?'COMPETITIVE':'EDGE'):(status==='PASS'?'COMPETITIVE':status==='NO_BENCHMARK'?'UNKNOWN':'REVIEW');

  /* Underpriced reporting — the single number Zura asked for: am I leaving money? */
  let underpriced=null;
  const lowSignals=[];
  if(projectCheck&&['LOW','REVIEW'].includes(projectCheck.status)&&projectCheck.actual<projectCheck.expectedLow)lowSignals.push({basis:'NYC market band',target:money(projectCheck.expectedLow),floor:projectCheck.expectedLow,label:projectCheck.label});
  if(saniAnchorCheck&&saniAnchorCheck.actual<saniAnchorCheck.expectedLow)lowSignals.push({basis:'Sani completed job',target:money(saniAnchorCheck.expectedLow),floor:saniAnchorCheck.expectedLow,label:saniAnchorCheck.label});
  if(markupInfo&&markupInfo.status==='LOW')lowSignals.push({basis:'Sani markup band',target:money(markupInfo.suggestedLow),floor:markupInfo.suggestedLow,label:markupInfo.band.label});
  if(lowSignals.length&&t.grandTotal>0){
    const target=money(Math.min(...lowSignals.map(x=>x.target)));
    const gapAmt=target-t.grandTotal, gapPct=target/t.grandTotal-1;
    /* Sitting a few percent under a band floor is normal competitive positioning,
       not money left behind. Nagging on it would train Zura to ignore the flag. */
    if(gapPct>=0.05&&(gapAmt>=500||gapPct>=0.15)){
    underpriced={currentPrice:t.grandTotal,suggestedPrice:target,gap:money(target-t.grandTotal),gapPct:Math.round((target/t.grandTotal-1)*100),signals:lowSignals,
      message:`Current price $${t.grandTotal} sits below ${lowSignals.length===1?'one':lowSignals.length} reference point${lowSignals.length===1?'':'s'}. Comparable work supports at least $${target} — about $${money(target-t.grandTotal)} more.`};
    }
  }
  const markupSuggestion=markupInfo?{markupPct:t.markupPct,bandLabel:markupInfo.band.label,suggestedMarkupLow:Math.round((markupInfo.band.low-1)*100),suggestedMarkupHigh:Math.round((markupInfo.band.high-1)*100),priceAtBandLow:markupInfo.suggestedLow,priceAtBandHigh:markupInfo.suggestedHigh,status:markupInfo.status}:null;

  const guidance=status==='BLOCK'?'Do not auto-send. Review production rates, quantities, duplicated scope, customer-supplied finish treatment, access and allowances.':underpriced?`Nothing is over market. ${underpriced.message} Raise the price or send as-is knowingly.`:status==='REVIEW'?'Estimate is near/outside one or more market or structure guardrails. Contractor review recommended before sending.':status==='PASS'?'Generated pricing is within the available NYC benchmark checks.':'No reliable benchmark match was detected. Use normal estimator review and collect actual-job calibration data.';
  return{version:VERSION,status,marketPosition,pricingChanged:false,customerVisible:false,borough,bathroomTier:bathTier,totals:t,checks,structureChecks,accessFlags:flags,underpriced,markupSuggestion,saniActualsUsed:bathTier?(saniAnchorFor(bathTier)?saniAnchorFor(bathTier).label:null):null,competitiveContext:competitiveContext(e,borough),calibrationPriority:['Sani completed-job production history (SANI_ACTUALS)','current supplier/subcontractor quotes','NYC published benchmarks','public competitor context','AI judgment'],guidance,checkedAt:new Date().toISOString()};
}

module.exports={VERSION,BENCHMARKS,SANI_ACTUALS,MARKUP_BANDS,GROSS_MARGIN,LABOR_BURDEN,MATERIAL_WASTE,PREP_TIERS,WALKUP_BY_FLOOR,SUB_BUDGET_TARGETS,COMPETITOR_BANDS,MINIMUMS,ACCESS,PAINT_WALL_TO_FLOOR,bathroomTier,markupBandFor,marginFromMarkup,markupFromMargin,priceFromBurdenedCost,walkUpFactor,marketAudit};
