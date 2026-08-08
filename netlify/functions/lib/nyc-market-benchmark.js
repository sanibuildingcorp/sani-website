// Sani Building Corp — NYC market benchmark guardrails v2.0
// Internal estimating QA only. This module DOES NOT mutate estimate pricing.
// Benchmarks are derived from the Sani Building Corp NYC Pricing Benchmark (Aug 2026).
// Purpose: compare generated selling prices against market ranges before a quote is sent.

const VERSION = 'nyc-benchmark-v2.0';

const BENCHMARKS = {
  bathroom_refresh: {
    label: 'Bathroom renovation — cosmetic / refresh',
    unit: 'project', low: 9000, high: 18000, confidence: 'MED',
    note: 'Outer-borough selling-price recommendation.'
  },
  bathroom_gut_standard: {
    label: 'Bathroom gut renovation — standard tier',
    unit: 'project', low: 35000, high: 50000, confidence: 'MED',
    note: 'Demo to studs, fixtures remain in place, mid-range finish.'
  },
  bathroom_gut_mid_high: {
    label: 'Bathroom gut renovation — mid/high tier',
    unit: 'project', low: 50000, high: 75000, confidence: 'MED'
  },
  bathroom_painting: {
    label: 'Bathroom painting', unit: 'project', low: 1200, high: 2500, confidence: 'MED'
  },
  painting_brooklyn: {
    label: 'Brooklyn painting labor', unit: 'sqft', low: 4.00, high: 5.50, confidence: 'HIGH'
  },
  painting_queens: {
    label: 'Queens painting labor', unit: 'sqft', low: 3.50, high: 4.50, confidence: 'HIGH'
  },
  painting_manhattan: {
    label: 'Manhattan painting labor', unit: 'sqft', low: 5.00, high: 7.00, confidence: 'HIGH'
  },
  painting_full_scope: {
    label: 'Painting walls + ceilings + trim', unit: 'sqft', low: 4.20, high: 7.20, confidence: 'HIGH'
  },
  tile_typical_labor: {
    label: 'Tile setting — typical labor', unit: 'sqft', low: 10, high: 14, confidence: 'MED'
  },
  tile_premium_labor: {
    label: 'Tile setting — premium / large format', unit: 'sqft', low: 14, high: 20, confidence: 'MED'
  },
  tile_installed: {
    label: 'Ceramic/porcelain installed', unit: 'sqft', low: 12, high: 45, confidence: 'MED'
  },
  window_standard_vinyl: {
    label: 'Standard vinyl replacement window', unit: 'each', low: 500, high: 800, confidence: 'HIGH'
  },
  window_average: {
    label: 'NYC replacement window average', unit: 'each', low: 650, high: 1250, confidence: 'HIGH'
  },
  window_custom: {
    label: 'Custom / specialty replacement window', unit: 'each', low: 1500, high: 3000, confidence: 'HIGH'
  },
  demo_bathroom: {
    label: 'Bathroom tearout', unit: 'project', low: 800, high: 2000, confidence: 'HIGH'
  },
  demo_full_interior: {
    label: 'Full interior gut', unit: 'sqft', low: 3, high: 12, confidence: 'HIGH'
  },
  handyman_hourly: {
    label: 'NYC handyman hourly', unit: 'hour', low: 48, high: 80, confidence: 'MED'
  },
  handyman_minimum: {
    label: 'NYC handyman minimum charge', unit: 'job', low: 150, high: 250, confidence: 'MED'
  }
};

const ACCESS = {
  walkUp: { low: 1.10, high: 1.20, appliesTo: 'demo_material_handling' },
  freightElevator: { low: 1.20, high: 1.30, appliesTo: 'delivery_and_labor' },
  preWar: { low: 1.10, high: 1.10, appliesTo: 'labor' },
  preWarCoop: { low: 1.10, high: 1.20, appliesTo: 'total' },
  shortWorkday: { divisor: 0.80, appliesTo: 'labor_hours' },
  offHours: { low: 1.10, high: 1.20, appliesTo: 'labor' },
  borough: {
    Manhattan: { low: 1.15, high: 1.30 },
    Brooklyn: { low: 1.05, high: 1.15 },
    Queens: { low: 1.00, high: 1.00 },
    Bronx: { low: 0.95, high: 1.00 },
    'Staten Island': { low: 0.93, high: 1.00 }
  }
};

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
}
function money(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(v) { return txt(v).toLowerCase(); }
function lineTotal(l) { return n(l && l.qty) * n(l && l.rate); }
function sum(lines) { return (lines || []).reduce((s, l) => s + lineTotal(l), 0); }

function totals(estimate) {
  const labor = money(sum(estimate && estimate.labor));
  const materials = money(sum(estimate && estimate.materials));
  const subtotal = money(labor + materials);
  const markupPct = Number.isFinite(Number(estimate && estimate.markupPct)) ? Number(estimate.markupPct) : 25;
  const markup = money(subtotal * markupPct / 100);
  return { labor, materials, subtotal, markupPct, markup, grandTotal: money(subtotal + markup) };
}

function sectionSellingTotal(estimate, section) {
  const target = norm(section);
  const raw = [...(estimate.labor || []), ...(estimate.materials || [])]
    .filter(l => norm(l.section) === target)
    .reduce((s, l) => s + lineTotal(l), 0);
  const mm = 1 + (Number(estimate.markupPct || 25) / 100);
  return money(raw * mm);
}

function evidence(input, analysis) {
  return norm([
    input && input.customer && input.customer.address,
    input && input.request && input.request.service,
    input && input.request && input.request.description,
    input && input.request && input.request.extraNotes,
    analysis && analysis.project_type,
    analysis && analysis.project_summary,
    JSON.stringify((analysis && analysis.site_conditions) || {}),
    JSON.stringify((analysis && analysis.quantities) || {})
  ].filter(Boolean).join(' | '));
}

function findNumber(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return n(String(m[1]).replace(/,/g, ''));
  }
  return 0;
}

function detectBorough(e) {
  if (/manhattan|new york,?\s*ny|\b100\d{2}\b|\b101\d{2}\b|\b102\d{2}\b/.test(e)) return 'Manhattan';
  if (/brooklyn|\b112\d{2}\b/.test(e)) return 'Brooklyn';
  if (/queens|astoria|long island city|\blic\b|flushing|\b111\d{2}\b|\b113\d{2}\b|\b114\d{2}\b/.test(e)) return 'Queens';
  if (/bronx|\b104\d{2}\b/.test(e)) return 'Bronx';
  if (/staten island|\b103\d{2}\b/.test(e)) return 'Staten Island';
  return 'NYC';
}

function detectQuantities(e, analysis) {
  const q = (analysis && analysis.quantities) || {};
  const paintingSf = n(q.painting_sf || q.paintingSf || q.paintable_sf || q.paintableSf) || findNumber(e, [
    /([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square feet)[^|\n]{0,45}(?:paint|paintable)/,
    /(?:paint|paintable)[^\d]{0,45}([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square feet)/
  ]);
  const tileSf = n(q.tile_sf || q.tileSf) || findNumber(e, [
    /(?:total\s+tile\s+installation|tile\s+installation)[^\d]{0,35}([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square feet)/,
    /([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square feet)[^|\n]{0,45}(?:tile|shower wall)/
  ]);
  let windowCount = n(q.window_count || q.windowCount || q.windows);
  if (!windowCount) {
    let total = 0, m;
    const rx = /(?:quantity|qty)\s*[:#-]?\s*(\d+)/g;
    while ((m = rx.exec(e))) total += Number(m[1]) || 0;
    windowCount = total;
  }
  return { paintingSf, tileSf, windowCount };
}

function position(value, low, high) {
  if (!(value > 0) || !(low > 0) || !(high > 0)) return { status: 'NO_DATA', ratioToMid: 0 };
  const mid = (low + high) / 2;
  const ratio = value / mid;
  if (value < low * 0.80) return { status: 'LOW', ratioToMid: money(ratio) };
  if (value > high * 1.20) return { status: 'HIGH', ratioToMid: money(ratio) };
  if (value < low || value > high) return { status: 'REVIEW', ratioToMid: money(ratio) };
  return { status: 'PASS', ratioToMid: money(ratio) };
}

function addCheck(checks, code, label, actual, low, high, unit, confidence, note) {
  if (!(actual > 0) || !(low > 0) || !(high > 0)) return;
  const p = position(actual, low, high);
  checks.push({ code, label, actual: money(actual), expectedLow: money(low), expectedHigh: money(high), unit, confidence, status: p.status, ratioToMid: p.ratioToMid, note: note || '' });
}

function marketAudit(estimate, analysis, input) {
  const e = evidence(input || {}, analysis || {});
  const t = totals(estimate || {});
  const q = detectQuantities(e, analysis || {});
  const borough = detectBorough(e);
  const checks = [];

  const bathroom = sectionSellingTotal(estimate || {}, 'Bathroom');
  const painting = sectionSellingTotal(estimate || {}, 'Painting');
  const windows = sectionSellingTotal(estimate || {}, 'Windows');

  const singleBath = /bathroom/.test(e) && !/(whole|entire|full)\s+(apartment|home|house)|kitchen renovation|window replacement|engineered hardwood/.test(e);
  const gutBath = /gut|demo(?:lition)?\s+to\s+stud|complete bathroom demolition|full bathroom demolition/.test(e);
  if (singleBath && bathroom > 0) {
    const b = gutBath ? BENCHMARKS.bathroom_gut_standard : BENCHMARKS.bathroom_refresh;
    addCheck(checks, gutBath ? 'BATH_GUT_PROJECT' : 'BATH_REFRESH_PROJECT', b.label, bathroom, b.low, b.high, b.unit, b.confidence, b.note);
  }

  if (q.paintingSf > 0 && painting > 0) {
    const perSf = painting / q.paintingSf;
    const b = borough === 'Manhattan' ? BENCHMARKS.painting_manhattan : borough === 'Brooklyn' ? BENCHMARKS.painting_brooklyn : borough === 'Queens' ? BENCHMARKS.painting_queens : BENCHMARKS.painting_full_scope;
    addCheck(checks, 'PAINTING_PER_SF', `${b.label} market check`, perSf, b.low, b.high, '$/sqft', b.confidence, `Detected paintable area: ${q.paintingSf} SF.`);
  }

  if (q.tileSf > 0 && bathroom > 0) {
    const tileLabor = (estimate.labor || []).filter(l => /tile|grout|thinset/i.test(`${l.section || ''} ${l.item || ''}`)).reduce((s, l) => s + lineTotal(l), 0);
    const mm = 1 + (Number(estimate.markupPct || 25) / 100);
    if (tileLabor > 0) {
      const perSf = tileLabor * mm / q.tileSf;
      const premium = /24\s*[x×]\s*48|large.?format|herringbone|diagonal|mosaic/.test(e);
      const b = premium ? BENCHMARKS.tile_premium_labor : BENCHMARKS.tile_typical_labor;
      addCheck(checks, 'TILE_LABOR_PER_SF', `${b.label} market check`, perSf, b.low, b.high, '$/sqft labor', b.confidence, `Detected tile area: ${q.tileSf} SF.`);
    }
  }

  if (q.windowCount > 0 && windows > 0) {
    const perWindow = windows / q.windowCount;
    const b = BENCHMARKS.window_average;
    addCheck(checks, 'WINDOW_PER_UNIT', b.label, perWindow, b.low, b.high, '$/window', b.confidence, `Detected window count: ${q.windowCount}.`);
  }

  const walkUp = /walk.?up|third floor|3rd floor|fourth floor|4th floor/.test(e);
  const flags = [];
  if (walkUp) flags.push({ code: 'WALK_UP', label: 'Walk-up / no-elevator condition detected', benchmark: '10–20% on demo/material handling', lowFactor: ACCESS.walkUp.low, highFactor: ACCESS.walkUp.high });
  if (borough !== 'NYC') flags.push({ code: 'BOROUGH', label: borough, benchmark: ACCESS.borough[borough] || null });

  const high = checks.filter(c => c.status === 'HIGH');
  const low = checks.filter(c => c.status === 'LOW');
  const review = checks.filter(c => c.status === 'REVIEW');
  let status = 'PASS';
  if (high.length || low.length) status = 'BLOCK';
  else if (review.length) status = 'REVIEW';
  else if (!checks.length) status = 'NO_BENCHMARK';

  return {
    version: VERSION,
    status,
    pricingChanged: false,
    customerVisible: false,
    borough,
    totals: t,
    checks,
    accessFlags: flags,
    guidance: status === 'BLOCK'
      ? 'Do not auto-send. Review production rates, customer-supplied finish treatment, duplicate scope, access, and allowances.'
      : status === 'REVIEW'
        ? 'Estimate is near/outside a benchmark edge. Contractor review recommended before sending.'
        : status === 'PASS'
          ? 'Generated pricing is within the available NYC benchmark checks.'
          : 'No reliable benchmark quantity/project match was detected; use normal estimator review.',
    checkedAt: new Date().toISOString()
  };
}

module.exports = { VERSION, BENCHMARKS, ACCESS, marketAudit };
