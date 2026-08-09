// Sani Building Corp — deterministic estimator guardrails v2.0
// Pricing polish: cost-based labor + single markup + duplication controls.
// Aug 8, 2026
//
// IMPORTANT ARCHITECTURE:
// AI understands scope and proposes operations.
// This file controls the economics before the estimate reaches the customer.
//
// PRINCIPLE:
// labor line rates here are INTERNAL LOADED COST rates, not customer selling rates.
// Dashboard markupPct is applied ONCE after labor + materials.
// This prevents "selling rate + 25% markup" double-loading.

const { marketAudit } = require('./nyc-market-benchmark');

const RULES = {
  markupDefault: 25,
  paintingSfPerHour: 32,
  engineeredHardwoodSfPerHour: 16,
  largeFormatTileSfPerHour: 5,
  loadedCostRates: {
    helper: 48,
    demo: 52,
    painter: 55,
    carpenter: 72,
    flooring: 72,
    tile: 78,
    plumber: 95,
    electrician: 95,
    glazing: 82,
    windows: 75,
    drywall: 68,
    waterproofing: 78,
    supervision: 68,
    general: 60
  },
  maxLoadedRates: {
    helper: 58,
    demo: 62,
    painter: 65,
    carpenter: 85,
    flooring: 85,
    tile: 90,
    plumber: 110,
    electrician: 110,
    glazing: 95,
    windows: 90,
    drywall: 80,
    waterproofing: 90,
    supervision: 85,
    general: 75
  }
};

const num = v => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const money = v => Math.round((Number(v) || 0) * 100) / 100;
const text = v => String(v == null ? '' : v).trim();
const norm = v => text(v).toLowerCase();
const sumLines = lines => (lines || []).reduce((s, l) => s + num(l.qty) * num(l.rate), 0);

function evidence(input, analysis) {
  return [
    input?.request?.description,
    input?.request?.sqft,
    input?.contractor?.extraRequest,
    input?.request?.contractorNotes,
    input?.request?.extraNotes,
    JSON.stringify(input?.request?.groupedAnswers || {}),
    JSON.stringify(analysis?.quantities || {}),
    JSON.stringify(analysis?.confirmed_scope || [])
  ].filter(Boolean).join(' | ');
}
function requestEvidence(input, analysis) { return norm(evidence(input, analysis)); }

function findQty(e, patterns) {
  for (const re of patterns) {
    const m = e.match(re);
    if (m) return num(String(m[1]).replace(/,/g, ''));
  }
  return 0;
}
function scopedText(raw, label, nextLabels) {
  const end = nextLabels.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp('(?:^|\\n)\\s*\\d+\\.\\s*' + label + '\\b([\\s\\S]*?)(?=\\n\\s*\\d+\\.\\s*(?:' + end + ')\\b|$)', 'i');
  const m = raw.match(re);
  return m ? m[1] : '';
}
function extractQuantities(input, analysis) {
  const raw = evidence(input, analysis);
  const desc = text(input?.request?.description);
  const floor = scopedText(desc, 'FLOORING', ['PAINTING', 'WINDOW']);
  const paint = scopedText(desc, 'PAINTING', ['WINDOW']);
  const bath = scopedText(desc, 'BATHROOM RENOVATION', ['FLOORING', 'PAINTING', 'WINDOW']);
  return {
    paintingSf: findQty(paint || raw, [
      /(?:approximately|approx\.?)\s*([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square\s*feet)\s+(?:of\s+)?paintable/i,
      /paintable(?:\s+surface)?[^\d]{0,30}([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square\s*feet)/i,
      /([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square\s*feet)[^|\n]{0,35}(?:paintable|painting)/i
    ]),
    flooringSf: findQty(floor || raw, [
      /total\s*(?:approximately|approx\.?)?\s*[:=-]?\s*([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square\s*feet)/i,
      /(?:approximately|approx\.?)\s*([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square\s*feet)/i
    ]),
    tileSf: findQty(bath || raw, [
      /(?:total\s+tile\s+installation|tile\s+installation)[^\d]{0,25}([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square\s*feet)/i,
      /approximately\s*([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square\s*feet)[^\n]{0,30}(?:shower|wall|floor|tile)/i
    ])
  };
}

function genericOperation(item) {
  const i = norm(item);
  if (!i) return false;
  const specific = /window|paint|primer|spackle|hardwood|flooring|quarter.?round|subfloor|transition|baseboard|bath|shower|vanity|toilet|plumb|waterproof|backer|thinset|grout|tile|glass|glaz|faucet/.test(i);
  if (specific) return false;
  return /project management|project coordination|coordination|supervision|general conditions|general labor|final project cleanup|final cleanup|walk[- ]?through|site protection|material haul|walk[- ]?up.*haul|debris removal|debris disposal|disposal haul|jobsite setup/.test(i);
}

function canonicalService(section, item, selected) {
  const i = norm(item), sec = norm(section);
  const sel = (selected || []).map(norm);
  const has = n => sel.some(x => x.includes(n));
  if (genericOperation(i)) return 'General';
  if (/window/.test(i)) return 'Windows';
  if (/paint|painter|primer|spackle|skim coat/.test(i) && has('paint')) return 'Painting';
  if (/engineered hardwood|hardwood floor|flooring|quarter.?round|subfloor|transition|baseboard/.test(i) && !/bath|tile|shower/.test(i)) return 'Flooring';
  if (/bath|shower|vanity|toilet|plumb|waterproof|backer|thinset|grout|tile|glass|glaz|faucet/.test(i)) return 'Bathroom';
  if (/window/.test(sec)) return 'Windows';
  if (/paint|painter|primer|spackle/.test(sec) && has('paint')) return 'Painting';
  if (/floor/.test(sec) && !/bath|tile|shower/.test(sec)) return 'Flooring';
  if (/bath|shower|plumb|tile|waterproof/.test(sec)) return 'Bathroom';
  if (/project management|supervision|coordination|general conditions|general labor|cleanup|site protection/.test(sec)) return 'General';
  return text(section) || 'General';
}

/* A line stamped sbcSharedSplit was placed deliberately by attributeSharedLines in
   generate-estimate-background.js: genuinely shared work - coordination, cleanup,
   protection, debris - divided across the customer's real services in proportion to
   their LABOUR, one line per service.

   canonicalService reads the item WORDING before it looks at the section, and
   "project coordination", "final cleanup" and "debris disposal" all read as generic.
   Without this guard the very next stage after the split sends every one of them back
   to General, and the fifth card the customer never asked for reappears on his quote.

   The stamp is precise - it marks only lines this pipeline created - so honouring it
   costs canonicalService nothing for any other line. The section is still checked
   against the selected services, so a stale or hand-edited stamp can never pin a line
   to a service that does not exist. */
function pinnedService(line, selected) {
  if (!line || !line.sbcSharedSplit) return '';
  const sec = text(line.section);
  if (!sec) return '';
  return (selected || []).some(x => norm(x) === norm(sec)) ? sec : '';
}

function classifyLabor(line) {
  const s = norm(`${line?.section || ''} ${line?.item || ''}`);
  if (/plumb|toilet|faucet|valve|drain|supply line|shower trim/.test(s)) return 'plumber';
  if (/electric|wiring|outlet|switch|light fixture|exhaust fan/.test(s)) return 'electrician';
  if (/glass|glaz|shower enclosure/.test(s)) return 'glazing';
  if (/window/.test(s)) return 'windows';
  if (/tile|grout|thinset/.test(s)) return 'tile';
  if (/waterproof|kerdi|membrane|shower pan/.test(s)) return 'waterproofing';
  if (/engineered hardwood|hardwood|flooring install|subfloor|transition/.test(s)) return 'flooring';
  if (/paint|primer|painter|spackle/.test(s)) return 'painter';
  if (/drywall|sheetrock|cement board|backer board|taping|mudding|sanding/.test(s)) return 'drywall';
  if (/carpent|framing|stud|blocking|door|trim|molding|baseboard/.test(s)) return 'carpenter';
  if (/demo|demolition|remove|debris|haul|disposal/.test(s)) return 'demo';
  if (/project management|project coordination|supervision|trade scheduling/.test(s)) return 'supervision';
  if (/helper|laborer|cleanup|protection|setup|material handling/.test(s)) return 'helper';
  return 'general';
}

function normalizeLaborRates(estimate, adjustments) {
  (estimate.labor || []).forEach(line => {
    const unit = norm(line.unit);
    if (!/hr|hour/.test(unit)) return;
    const cls = classifyLabor(line);
    const target = RULES.loadedCostRates[cls] || RULES.loadedCostRates.general;
    const ceiling = RULES.maxLoadedRates[cls] || RULES.maxLoadedRates.general;
    const old = num(line.rate);
    if (old > ceiling) {
      line.rate = target;
      adjustments.push({
        type: 'LABOR_RATE_NORMALIZED',
        item: text(line.item),
        laborClass: cls,
        fromRate: old,
        toLoadedCostRate: target,
        reason: 'AI returned a customer selling-rate-like hourly rate. Dashboard markup is applied separately.'
      });
    }
  });
}

function laborMatches(line, kind) {
  const s = norm(`${line.section || ''} ${line.item || ''}`);
  if (kind === 'painting') return /paint|painter|wall.*ceiling|ceiling.*wall/.test(s);
  if (kind === 'flooring') return /engineered hardwood|hardwood floor|flooring install|floor installer/.test(s) && !/bath|tile|shower/.test(s);
  if (kind === 'tile') return /tile setter|tile install|large[- ]format|24\s*[x×]\s*48/.test(s);
  return false;
}

function enforceProductionMinimum(estimate, kind, minHours, reason, adjustments) {
  if (!minHours) return;
  const matches = (estimate.labor || []).filter(l => laborMatches(l, kind));
  if (!matches.length) {
    adjustments.push({ type: 'MISSING_PRODUCTION_LINE', kind, minimumHours: Math.ceil(minHours), reason });
    return;
  }
  const current = matches.reduce((s, l) => s + num(l.qty), 0);
  if (current + 0.01 >= minHours) return;
  const target = matches.slice().sort((a, b) => num(b.qty) - num(a.qty))[0];
  target.qty = Math.ceil(num(target.qty) + (minHours - current));
  adjustments.push({
    type: 'PRODUCTION_HOURS_RAISED',
    kind,
    fromHours: current,
    toHours: matches.reduce((s, l) => s + num(l.qty), 0),
    changedLine: target.item,
    reason
  });
}

function removeOverlappingLabor(estimate, adjustments) {
  const lines = estimate.labor || [];
  const drop = new Set();
  function has(re) { return lines.findIndex(l => re.test(norm(l.item))); }
  function removeIfBoth(broadRe, narrowRe, label) {
    const bi = has(broadRe), ni = has(narrowRe);
    if (bi >= 0 && ni >= 0 && bi !== ni) {
      const broad = norm(lines[bi].item);
      if ((label === 'bath-demo' && /complete|full/.test(broad)) || (label === 'tile-finish' && /grout|caulk|seal/.test(broad))) {
        drop.add(ni);
        adjustments.push({
          type: 'OVERLAP_REMOVED',
          removedItem: lines[ni].item,
          coveredBy: lines[bi].item,
          reason: 'Avoid duplicate labor charge for the same operation.'
        });
      }
    }
  }
  removeIfBoth(/complete|full.*bathroom.*demolition|complete bathroom demolition/, /tub\/?shower removal|remove.*tub|bathtub removal/, 'bath-demo');
  removeIfBoth(/tile installation.*grout|tile.*grout.*caulk/, /tile grouting|grouting.*caulking|grout.*seal/, 'tile-finish');
  estimate.labor = lines.filter((_, i) => !drop.has(i));
}

function capGeneralConditions(estimate, adjustments) {
  const labor = estimate.labor || [];
  const generalIdx = [];
  let specificCost = 0, generalCost = 0;
  labor.forEach((l, i) => {
    const cost = num(l.qty) * num(l.rate);
    if (genericOperation(l.item) || classifyLabor(l) === 'supervision') {
      generalIdx.push(i);
      generalCost += cost;
    } else {
      specificCost += cost;
    }
  });
  if (!specificCost || !generalCost) return;
  const evidenceText = norm(estimate.notes || '');
  const exceptional = /no elevator|walk[- ]?up|restricted hours|night work|occupied.*protection/.test(evidenceText);
  const maxRatio = exceptional ? 0.18 : 0.12;
  const maxGeneral = specificCost * maxRatio;
  if (generalCost <= maxGeneral) return;
  const factor = maxGeneral / generalCost;
  generalIdx.forEach(i => {
    const l = labor[i];
    const oldQty = num(l.qty);
    if (!oldQty) return;
    l.qty = Math.max(1, Math.round(oldQty * factor * 2) / 2);
  });
  adjustments.push({
    type: 'GENERAL_CONDITIONS_NORMALIZED',
    fromCost: money(generalCost),
    targetMaxCost: money(maxGeneral),
    ratio: maxRatio,
    reason: 'Prevents protection/cleanup/coordination labor from stacking excessively on top of direct trade labor.'
  });
}

function normalizeOwnership(estimate, analysis, adjustments) {
  const selected = analysis?.selected_trades || [];
  ['labor', 'materials'].forEach(bucket => (estimate[bucket] || []).forEach(line => {
    /* Honour a deliberate split before re-deriving from the wording. */
    const next = pinnedService(line, selected) || canonicalService(line.section, line.item, selected);
    if (next && next !== line.section) {
      adjustments.push({ type: 'SERVICE_REASSIGNED', bucket, item: line.item, from: line.section, to: next });
      line.section = next;
    }
  }));
  (estimate.customerSupplied || []).forEach(x => {
    if (x && typeof x === 'object') x.section = canonicalService(x.section, x.item, selected);
  });
  (estimate.options || []).forEach(o => {
    o.section = canonicalService(o.section, `${o.label || ''} ${o.description || ''}`, selected);
  });
}

function altCode(line) {
  const s = norm(`${line.item || ''} ${line.description || ''} ${line.label || ''}`);
  const m = s.match(/\boption\s*([b-z])\b/);
  if (m) return `Option ${m[1].toUpperCase()}`;
  if (/\balternate\b|\balternative\b/.test(s)) return 'Alternate';
  return '';
}
function isAlt(line) { return !!altCode(line); }

function isolateAlternatives(estimate, adjustments) {
  estimate.options = Array.isArray(estimate.options) ? estimate.options : [];
  const grouped = {};
  ['labor', 'materials'].forEach(bucket => {
    const keep = [];
    (estimate[bucket] || []).forEach(line => {
      const code = altCode(line);
      if (!code) { keep.push(line); return; }
      const key = `${text(line.section) || 'General'}|${code}`;
      const base = num(line.qty) * num(line.rate);
      grouped[key] = grouped[key] || { section: line.section || 'General', label: `${code} — alternative`, raw: 0 };
      grouped[key].raw += base;
      adjustments.push({ type: 'ALTERNATIVE_REMOVED_FROM_BASE', bucket, item: line.item, baseCost: money(base) });
    });
    estimate[bucket] = keep;
  });
  const mm = 1 + num(estimate.markupPct || RULES.markupDefault) / 100;
  Object.values(grouped).forEach(o => {
    if (!estimate.options.some(x => norm(x.label) === norm(o.label))) {
      estimate.options.push({
        section: o.section,
        label: o.label,
        description: 'Mutually exclusive alternative; excluded from base Grand Total until selected.',
        price: money(o.raw * mm)
      });
    }
  });
}

function windowRequested(input, analysis) {
  const e = requestEvidence(input, analysis);
  return /window/.test(e) && (/replace|replacement|repair|option\s*a|option\s*b/.test(e));
}
function optionLetter(o) {
  const s = norm(`${o?.label || ''} ${o?.description || ''}`);
  const m = s.match(/\boption\s*([a-z])\b/);
  return m ? m[1].toUpperCase() : '';
}
function isWindowLine(line) {
  return canonicalService(line?.section, line?.item, []) === 'Windows' && !genericOperation(line?.item);
}
function parseWindowCount(input, analysis) {
  const raw = evidence(input, analysis);
  let total = 0, m;
  const re = /(\d+(?:\.\d+)?)\s*["”]?\s*[x×]\s*(\d+(?:\.\d+)?)\s*["”]?[^|\n]{0,45}?(?:quantity|qty)\s*[:#-]?\s*(\d+)/gi;
  while ((m = re.exec(raw))) total += Number(m[3]) || 0;
  const simple = raw.match(/(?:replace|replacement of|all)\s+(\d+)\s+(?:existing\s+)?windows?/i);
  if (!total && simple) total = Number(simple[1]) || 0;
  return total || 6;
}

function ensureWindowOptionEngine(estimate, analysis, input, adjustments) {
  if (!windowRequested(input, analysis)) return;
  estimate.options = Array.isArray(estimate.options) ? estimate.options : [];
  const mm = 1 + num(estimate.markupPct || RULES.markupDefault) / 100;
  let hasBase = [...(estimate.labor || []), ...(estimate.materials || [])].some(isWindowLine);
  const optionA = estimate.options.find(o =>
    canonicalService(o.section, `${o.label || ''} ${o.description || ''}`, []) === 'Windows' && optionLetter(o) === 'A'
  );
  if (!hasBase && optionA && num(optionA.price) > 0) {
    const preMarkup = money(num(optionA.price) / mm);
    estimate.materials.push({ section: 'Windows', item: `${text(optionA.label) || 'Window Option A'} — selected base allowance`, qty: 1, unit: 'allowance', rate: preMarkup });
    estimate.options = estimate.options.filter(o => o !== optionA);
    hasBase = true;
    adjustments.push({ type: 'BASE_OPTION_PROMOTED', service: 'Windows', option: 'A', customerPrice: money(optionA.price) });
  }
  if (!hasBase) {
    const count = parseWindowCount(input, analysis);
    const hours = Math.max(12, Math.ceil(count * 3.25));
    estimate.labor.push({ section: 'Windows', item: `Window Option A — remove existing windows, prepare openings, install and finish ${count} specified replacement windows`, qty: hours, unit: 'hrs', rate: RULES.loadedCostRates.windows });
    estimate.materials.push({ section: 'Windows', item: `Window Option A — ${count} specified replacement windows allowance`, qty: count, unit: 'ea', rate: 780 });
    adjustments.push({ type: 'WINDOW_BASE_SYNTHESIZED', option: 'A', windowCount: count });
  }
  estimate.options = estimate.options.filter(o => !(canonicalService(o.section, `${o.label || ''} ${o.description || ''}`, []) === 'Windows' && optionLetter(o) === 'A'));
  const hasB = estimate.options.some(o => canonicalService(o.section, `${o.label || ''} ${o.description || ''}`, []) === 'Windows' && optionLetter(o) === 'B');
  if (!hasB) {
    const count = parseWindowCount(input, analysis);
    const adjust = Math.max(0, count - 2);
    const raw = (8 + adjust * 1.25) * RULES.loadedCostRates.windows + 2200 + adjust * 85;
    estimate.options.push({
      section: 'Windows',
      label: 'Option B — Replace 2 premium acoustic windows + adjust remaining existing windows',
      description: 'Alternative requested by customer. Replace two bedroom windows with premium acoustic windows and repair/adjust the remaining existing windows. Excluded from base Grand Total until selected.',
      price: money(raw * mm)
    });
  }
  estimate.optionSelections = estimate.optionSelections || {};
  estimate.optionSelections.Windows = {
    selected: 'Option A',
    baseIncluded: true,
    alternatives: estimate.options.filter(o => canonicalService(o.section, `${o.label || ''} ${o.description || ''}`, []) === 'Windows').map(o => ({ label: o.label, description: o.description, price: money(o.price) }))
  };
}

function calculateTotals(estimate) {
  const labor = money(sumLines(estimate.labor));
  const materials = money(sumLines(estimate.materials));
  const subtotal = money(labor + materials);
  const markupPct = Number.isFinite(Number(estimate.markupPct)) ? Number(estimate.markupPct) : RULES.markupDefault;
  const markup = money(subtotal * markupPct / 100);
  return { labor, materials, subtotal, markupPct, markup, grandTotal: money(subtotal + markup) };
}

function buildHealth(estimate, analysis, q, adjustments, input) {
  const issues = [];
  if ((estimate.labor || []).some(isAlt) || (estimate.materials || []).some(isAlt)) {
    issues.push({ severity: 'BLOCK', code: 'ALTERNATIVE_IN_BASE_TOTAL', message: 'A mutually exclusive alternate is still inside base labor/materials.' });
  }
  if (windowRequested(input, analysis) && ![...(estimate.labor || []), ...(estimate.materials || [])].some(isWindowLine)) {
    issues.push({ severity: 'BLOCK', code: 'WINDOW_BASE_OPTION_MISSING', message: 'Windows were requested, but the selected base window option is not priced.' });
  }
  const normalized = adjustments.filter(a => a.type === 'LABOR_RATE_NORMALIZED').length;
  if (normalized) {
    issues.push({ severity: 'INFO', code: 'SELLING_RATES_CONVERTED_TO_COST', message: `${normalized} AI hourly rate(s) were converted to internal loaded-cost rates before markup.` });
  }
  return {
    status: issues.some(i => i.severity === 'BLOCK') ? 'BLOCKED' : 'PASS',
    issues,
    quantities: q,
    totals: calculateTotals(estimate),
    deterministicAdjustments: adjustments,
    checkedAt: new Date().toISOString(),
    version: 'deterministic-v2.0-cost-based'
  };
}

/* ── Rule: never bill a trade that the exclusions say is not included ──────────
   The estimator writes line items and exclusions independently, so an estimate can
   charge 25 hrs of plumbing while its own NOT INCLUDED list says plumbing rough-in
   is excluded. A customer who reads both loses trust immediately.
   Resolution: keep the WORK (it was priced deliberately) and drop the contradicting
   exclusion. Never silently delete revenue here. */
const EXCLUSION_TRADE_PATTERNS = [
  { kind: 'plumbing',    re: /\bplumb|\bpipe|\bdrain|\bwaste line|\bsupply line/i },
  { kind: 'electrical',  re: /\belectric|\bwiring|\boutlet|\bgfci|\bcircuit|\bpanel\b/i },
  { kind: 'tile',        re: /\btile|\bgrout|\bbacksplash/i },
  { kind: 'painting',    re: /\bpaint|\bprimer/i },
  { kind: 'flooring',    re: /\bflooring|\bhardwood|\blaminate|\bunderlayment/i },
  { kind: 'drywall',     re: /\bdrywall|\bsheetrock|\btaping/i },
  { kind: 'waterproofing', re: /\bwaterproof|\bkerdi|\bmembrane/i },
  { kind: 'windows',     re: /\bwindow/i },
  { kind: 'glazing',     re: /\bglass|\bshower door|\benclosure/i }
];

function billedTrades(estimate) {
  const set = {};
  (estimate.labor || []).forEach(l => {
    const t = norm(l.item);
    EXCLUSION_TRADE_PATTERNS.forEach(p => { if (p.re.test(t)) set[p.kind] = true; });
  });
  return set;
}

function reconcileExclusions(estimate, adjustments) {
  const billed = billedTrades(estimate);
  const kept = [];
  const dropped = [];
  (estimate.exclusions || []).forEach(x => {
    const t = norm(typeof x === 'string' ? x : (x && x.item) || '');
    /* An exclusion that carves out a LOCATION rather than a trade is legitimate even
       when we bill that trade ("flooring outside the bathroom", "work in other rooms"). */
    const locationCarveOut = /outside|other room|beyond|elsewhere|not in scope|another (room|area)/i.test(t);
    const conflict = !locationCarveOut && EXCLUSION_TRADE_PATTERNS.some(p => p.re.test(t) && billed[p.kind]);
    if (conflict) dropped.push(text(x)); else kept.push(x);
  });
  if (!dropped.length) return;
  estimate.exclusions = kept;
  adjustments.push({
    type: 'EXCLUSION_CONFLICT_REMOVED',
    removed: dropped,
    reason: 'These exclusions named trades that this estimate actually charges for. Charging for work the quote calls excluded is the fastest way to lose a customer.'
  });
}

/* ── Rule: no rough-in when the customer says fixtures stay put ────────────────
   "All plumbing keeps same locations" / "no relocation of plumbing or fixtures"
   means there is no rough-in to do. Connection, trim, set and test all remain. */
function capUnneededRoughIn(estimate, input, analysis, adjustments) {
  const ev = requestEvidence(input || {}, analysis || {});
  const staysPut = /(no|without)\s+(plumbing\s+)?(re-?rout|relocat)|same location|existing location|remain in (their|the) current location|keeps? same location/i.test(ev);
  if (!staysPut) return;
  const removed = [];
  estimate.labor = (estimate.labor || []).filter(l => {
    const t = norm(l.item);
    const isRoughIn = /rough[- ]?in/.test(t);
    const isTrade = /\bplumb|\belectric/.test(t);
    /* Keep anything that is connection / set / trim / test work. */
    const isConnection = /connect|trim|valve trim|set |install fixture|test|inspect/.test(t);
    if (isRoughIn && isTrade && !isConnection) { removed.push(text(l.item)); return false; }
    return true;
  });
  if (!removed.length) return;
  adjustments.push({
    type: 'ROUGH_IN_REMOVED_FIXTURES_STAY',
    removed,
    reason: 'The customer stated fixtures remain in their existing locations, so there is no rough-in scope. Connections, trim and testing were kept.'
  });
}

/* ── Rule: one selected service means ONE customer-facing service card ────────
   The estimator sections lines by TRADE (framing, drywall, painting, waterproofing).
   That is right for internal costing and wrong for the customer, because a single
   bathroom job then renders as six cards - Bathroom $19,642 plus Framing $1,605 plus
   Drywall $3,477 and so on - while the Bathroom card's own scope list already names
   that same framing and drywall work. The totals are correct, but it reads as being
   billed twice, which loses a correctly priced job.
   When the customer selected exactly one service, every line is filed under it.
   Alternatives keep their own section so options still render separately. */
function serviceTitle(v) {
  return text(v).replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function collapseSingleServicePresentation(estimate, analysis, input, adjustments) {
  const selected = (analysis && Array.isArray(analysis.selected_trades) ? analysis.selected_trades : [])
    .map(text).filter(Boolean);
  const requested = (input && input.request && Array.isArray(input.request.selectedServices)
    ? input.request.selectedServices : []).map(text).filter(Boolean);
  const list = selected.length ? selected : requested;
  if (list.length !== 1) return;                       // multi-service jobs keep their trade cards
  const target = serviceTitle(list[0]);
  if (!target) return;
  const movedFrom = {};
  ['labor', 'materials'].forEach(kind => {
    (estimate[kind] || []).forEach(l => {
      if (isAlt(l)) return;                            // alternatives stay separate
      const was = text(l.section);
      if (was === target) return;
      if (was) movedFrom[was] = (movedFrom[was] || 0) + 1;
      l.section = target;
    });
  });
  const names = Object.keys(movedFrom);
  if (!names.length) return;
  adjustments.push({
    type: 'SERVICE_CARDS_COLLAPSED',
    into: target,
    mergedSections: names,
    reason: 'The customer selected one service. Splitting it into trade cards duplicates the same work in the quote and reads as double billing.'
  });
}

/* ── Rule: never list the same supplied item twice ────────────────────────────
   "Vanity and sink" and "Vanity & sink" are the same thing to a customer. */
function dedupeCustomerSupplied(estimate, adjustments) {
  const key = v => norm(text(typeof v === 'string' ? v : (v && v.item) || ''))
    .replace(/\s*&\s*/g, ' and ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const seen = {};
  const out = [];
  let dropped = 0;
  (estimate.customerSupplied || []).forEach(x => {
    const k = key(x);
    if (!k) return;
    if (seen[k]) { dropped++; return; }
    seen[k] = true;
    out.push(x);
  });
  if (!dropped) return;
  estimate.customerSupplied = out;
  adjustments.push({ type: 'CUSTOMER_SUPPLIED_DEDUPED', dropped, reason: 'Same item listed more than once under different wording.' });
}

/* ══════════════════════════════════════════════════════════════════════════════
   CUSTOMER SCOPE LANGUAGE

   A homeowner does not read "Debris bagging, carrying to street level" and learn
   anything. They want to know: is the old bathroom taken out and taken away, is the
   shower waterproofed properly, who is buying the tile, and what could still cost
   extra. Internal task names are for the contractor's line items; the customer gets
   outcomes.

   This is deliberately deterministic - a fixed phrase per phase of work, chosen by
   what the estimate ACTUALLY prices. Not model prose, so it reads the same on every
   estimate and can never invent work that is not in the price.
   ═════════════════════════════════════════════════════════════════════════════ */
const SCOPE_PHASES = [
  { key: 'protect',    re: /protect|setup|floor covering|dust barrier|masking/i,
    say: 'Protect your floors, hallways and adjacent finishes before any work starts' },
  { key: 'demo',       re: /demolition|demo\b|remove existing|tear ?out|strip/i,
    say: 'Remove the existing bathroom down to the substrate' },
  { key: 'disposal',   re: /debris|dumpster|disposal|haul|carry|dump fee/i,
    say: 'Bag, carry out and legally dispose of all construction debris' },
  { key: 'framing',    re: /framing|metal stud|blocking|stud repair/i,
    say: 'Repair framing and add blocking where fixtures and grab bars will mount' },
  { key: 'substrate',  re: /drywall|cement board|backer|durock|sheetrock|substrate/i,
    say: 'Install new moisture-resistant wall and ceiling substrate' },
  { key: 'waterproof', re: /waterproof|kerdi|membrane|schluter|redgard/i,
    say: 'Install a full waterproofing system in the shower and wet areas' },
  { key: 'plumbing',   re: /plumb|valve|rough-?in|supply line|drain|wax ring/i,
    say: 'Connect all plumbing and set your fixtures in their existing locations' },
  { key: 'electrical', re: /electric|wiring|gfci|outlet|light fixture|exhaust fan/i,
    say: 'Complete electrical connections for lighting, ventilation and outlets' },
  { key: 'tile',       re: /tile|grout|thinset|mortar/i,
    say: 'Install wall and floor tile with full grouting, sealing and finish work' },
  { key: 'fixtures',   re: /vanity|toilet|faucet|shower trim|sink|shower kit|shower pan/i,
    say: 'Install and connect the vanity, toilet, faucet and shower fittings' },
  { key: 'accessories',re: /grab bar|mirror|curtain bar|toilet paper|accessor|towel/i,
    say: 'Mount all bathroom accessories and hardware' },
  { key: 'door',       re: /door|privacy lock|door stop|frame install/i,
    say: 'Install the new door, frame and hardware' },
  { key: 'paint',      re: /paint|primer|prime\b/i,
    say: 'Prime and paint all new wall and ceiling surfaces' },
  { key: 'cleanup',    re: /cleanup|clean-?up|final clean|touch-?up|protection removal/i,
    say: 'Clean the space daily and leave it finished, protected and ready to use' },
  { key: 'management', re: /coordination|supervision|project management|scheduling/i,
    say: 'Coordinate and supervise every trade, inspection and delivery' }
];

/* Exclusions a homeowner genuinely needs to see. Real risks and real money, in plain
   words - never boundary lines invented to separate one internal section from another. */
const STANDARD_EXCLUSIONS = [
  'Permits, filing and inspection fees, if your building or the city requires them',
  'Hidden conditions found behind walls or under the floor once demolition starts',
  'Mold, asbestos or lead remediation, if any is discovered',
  'Structural work beyond ordinary framing repair',
  'Heating, cooling or ventilation changes not listed above'
];

/* On a single-room job there is no "outside", so an exclusion that carves out a
   location is meaningless and reads as though work is being taken away. */
const LOCATION_CARVE_OUT = /outside|other room|another (room|area)|beyond (this|the) (room|bathroom|kitchen)|elsewhere/i;

function phasesPresent(estimate, sectionName) {
  const hits = {};
  ['labor', 'materials'].forEach(kind => {
    (estimate[kind] || []).forEach(l => {
      if (sectionName && text(l.section) !== sectionName) return;
      if (isAlt(l)) return;
      const t = text(l.item);
      SCOPE_PHASES.forEach(p => { if (p.re.test(t)) hits[p.key] = true; });
    });
  });
  return SCOPE_PHASES.filter(p => hits[p.key]).map(p => p.say);
}

function suppliedNames(estimate) {
  return (estimate.customerSupplied || [])
    .map(x => text(typeof x === 'string' ? x : (x && x.item) || ''))
    .filter(Boolean);
}

/* Rewrites the customer-facing scope into outcomes. Line items, quantities and
   prices are untouched - this only changes what the customer reads. */
function buildCustomerScope(estimate, analysis, adjustments) {
  const sections = [];
  const seen = {};
  ['labor', 'materials'].forEach(kind => {
    (estimate[kind] || []).forEach(l => {
      if (isAlt(l)) return;
      const sec = text(l.section) || 'General';
      if (!seen[sec]) { seen[sec] = true; sections.push(sec); }
    });
  });
  if (!sections.length) return;

  const single = sections.length === 1;
  const supplied = suppliedNames(estimate);

  /* Exclusions: keep the customer's own carve-outs and real risks, drop the
     internal boundary lines, then guarantee the standard risk list is present. */
  const keptExclusions = [];
  const droppedExclusions = [];
  (estimate.exclusions || []).forEach(x => {
    const t = text(typeof x === 'string' ? x : (x && x.item) || '');
    if (!t) return;
    if (single && LOCATION_CARVE_OUT.test(t)) { droppedExclusions.push(t); return; }
    if (/insurance|certificate of insurance|\bcoi\b/i.test(t)) { droppedExclusions.push(t); return; }
    keptExclusions.push(t);
  });
  /* Match by TOPIC, not by wording. "Structural modifications beyond minor metal stud
     framing repairs" and "Structural work beyond ordinary framing repair" are the same
     exclusion said twice, and a customer reading both assumes sloppiness. */
  const EXCLUSION_TOPICS = [
    { key: 'permit',     re: /permit|filing|expedit|inspection fee/i },
    { key: 'concealed',  re: /hidden|conceal|behind (the )?wall|under (the )?floor|unforeseen/i },
    { key: 'hazmat',     re: /mold|asbestos|lead\b|remediation/i },
    { key: 'structural', re: /structural/i },
    { key: 'hvac',       re: /hvac|ventilation|ductwork|heating|cooling/i }
  ];
  const topicOf = v => (EXCLUSION_TOPICS.find(t => t.re.test(text(v))) || {}).key || '';
  const covered = {};
  keptExclusions.forEach(x => { const t = topicOf(x); if (t) covered[t] = true; });
  STANDARD_EXCLUSIONS.forEach(x => {
    const t = topicOf(x);
    if (t && covered[t]) return;      // customer already has this risk covered
    if (t) covered[t] = true;
    keptExclusions.push(x);
  });
  estimate.exclusions = keptExclusions;

  /* Supplied items are the customer's money, so say so plainly and never price them. */
  const suppliedLine = supplied.length
    ? `You are supplying: ${supplied.join(', ')}. Installation is included in the price above; the cost of these items is not.`
    : '';

  estimate.serviceBreakdown = sections.map(sec => {
    const included = phasesPresent(estimate, single ? '' : sec);
    return {
      title: sec,
      included,
      customerSupplies: supplied,
      notIncluded: keptExclusions,
      subtotal: 0,
      options: []
    };
  });
  if (suppliedLine) estimate.customerSuppliedNote = suppliedLine;

  adjustments.push({
    type: 'CUSTOMER_SCOPE_REWRITTEN',
    phases: estimate.serviceBreakdown[0] ? estimate.serviceBreakdown[0].included.length : 0,
    droppedExclusions,
    reason: 'Customer-facing scope now describes outcomes in plain language instead of internal task names. Location carve-outs removed on single-room jobs because there is no other location in scope.'
  });
}

function applyDeterministicPricing(estimate, analysis, input) {
  const out = JSON.parse(JSON.stringify(estimate || {}));
  out.labor = Array.isArray(out.labor) ? out.labor : [];
  out.materials = Array.isArray(out.materials) ? out.materials : [];
  out.customerSupplied = Array.isArray(out.customerSupplied) ? out.customerSupplied : [];
  out.exclusions = Array.isArray(out.exclusions) ? out.exclusions : [];
  out.options = Array.isArray(out.options) ? out.options : [];
  if (!Number.isFinite(Number(out.markupPct))) out.markupPct = RULES.markupDefault;
  const adjustments = [];
  const q = extractQuantities(input || {}, analysis || {});
  isolateAlternatives(out, adjustments);
  normalizeOwnership(out, analysis || {}, adjustments);
  normalizeLaborRates(out, adjustments);
  removeOverlappingLabor(out, adjustments);
  capGeneralConditions(out, adjustments);
  capUnneededRoughIn(out, input || {}, analysis || {}, adjustments);
  ensureWindowOptionEngine(out, analysis || {}, input || {}, adjustments);
  normalizeOwnership(out, analysis || {}, adjustments);
  enforceProductionMinimum(out, 'painting', q.paintingSf ? q.paintingSf / RULES.paintingSfPerHour : 0, `${q.paintingSf} paintable SF ÷ ${RULES.paintingSfPerHour} SF/labor-hour`, adjustments);
  enforceProductionMinimum(out, 'flooring', q.flooringSf ? q.flooringSf / RULES.engineeredHardwoodSfPerHour : 0, `${q.flooringSf} flooring SF ÷ ${RULES.engineeredHardwoodSfPerHour} SF/labor-hour`, adjustments);
  enforceProductionMinimum(out, 'tile', q.tileSf ? q.tileSf / RULES.largeFormatTileSfPerHour : 0, `${q.tileSf} tile SF ÷ ${RULES.largeFormatTileSfPerHour} SF/labor-hour`, adjustments);
  collapseSingleServicePresentation(out, analysis || {}, input || {}, adjustments);
  dedupeCustomerSupplied(out, adjustments);
  /* Last, so it sees the final labor list after every other rule has run. */
  reconcileExclusions(out, adjustments);
  out.deterministicPricing = {
    version: 'v2.0-cost-based',
    pricingBasis: 'Internal loaded labor cost + materials + one dashboard markup',
    quantities: q,
    adjustments
  };
  /* Runs last: the scope must describe the FINAL priced work, after every
     removal, collapse and reconciliation rule above has already run. */
  buildCustomerScope(out, analysis || {}, adjustments);
  out.estimateHealth = buildHealth(out, analysis || {}, q, adjustments, input || {});
  out.marketAudit = marketAudit(out, analysis || {}, input || {});
  return out;
}

function phraseKey(s) {
  return norm(s)
    .replace(/&/g, ' and ')
    .replace(/\b(sherwin\s*williams|sherwin-williams)\b/g, 'paintbrand')
    .replace(/\b(engineered\s+hardwood\s+flooring|engineered\s+hardwood|hardwood\s+flooring|flooring\s+material)\b/g, 'hardwood')
    .replace(/\b(sink\s*\/\s*vanity|vanity\s*\/\s*sink|vanity\s+and\s+sink|sink\s+and\s+vanity)\b/g, 'vanity sink')
    .replace(/\b(customer[- ]supplied|customer supplied|customer supplies|customer supply|by customer)\b/g, ' ')
    .replace(/\b(provide|provided|use|supply|supplied|install|installation|existing|new|all|the|for|with|work|item|materials?)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokenSet(s) { return new Set(phraseKey(s).split(' ').filter(x => x.length > 2)); }
function near(a, b) {
  const ka = phraseKey(a), kb = phraseKey(b);
  if (!ka || !kb) return ka === kb;
  if (ka === kb || ka.includes(kb) || kb.includes(ka)) return true;
  const A = tokenSet(a), B = tokenSet(b);
  if (!A.size || !B.size) return false;
  let common = 0;
  A.forEach(x => { if (B.has(x)) common++; });
  return common / Math.min(A.size, B.size) >= .68;
}
function dedupe(list) {
  const out = [];
  (list || []).map(x => text(typeof x === 'string' ? x : (x?.item || x?.label || x?.description || ''))).filter(Boolean).forEach(x => { if (!out.some(y => near(x, y))) out.push(x); });
  return out;
}

function isSingleBathroomProject(input) {
  const req = input?.request || {};
  const service = norm(req.service || '');
  const desc = norm(req.description || '');
  const bathroomPrimary = /bathroom/.test(service) || /full\s+gut\s+bathroom|bathroom\s+(?:renovation|remodel|upgrade)/.test(desc);
  if (!bathroomPrimary) return false;
  const outside = /(?:whole|entire|full)\s+(?:apartment|home|house).*paint|paint(?:ing)?\s+(?:the\s+)?(?:whole|entire|full)\s+(?:apartment|home|house)|bedroom|living\s+room|dining\s+room|engineered\s+hardwood|hardwood\s+floor|window\s+replacement|replace\s+windows|separate\s+pricing\s+for\s+(?:flooring|painting|windows?)/.test(desc);
  return !outside;
}

function selectedCustomerServices(analysis, estimate, input) {
  if (isSingleBathroomProject(input)) return ['Bathroom'];
  const preferred = ['Bathroom', 'Flooring', 'Painting', 'Windows'];
  const e = requestEvidence(input, analysis);
  const selected = (analysis?.selected_trades || []).map(x => canonicalService(x, x, analysis?.selected_trades || []));
  const lines = [...(estimate.labor || []), ...(estimate.materials || [])].map(x => canonicalService(x.section, x.item, analysis?.selected_trades || []));
  return preferred.filter(x => selected.includes(x) || lines.includes(x) || (x === 'Windows' && /window/.test(e)));
}
function exclusionOwner(x) {
  const s = norm(x);
  if (/window|scaffold|rigging|exterior/.test(s)) return 'Windows';
  if (/paint|kitchen.*paint|tiled shower|skim coat|plaster/.test(s)) return 'Painting';
  if (/floor|underlayment|transition|baseboard|subfloor/.test(s)) return 'Flooring';
  if (/bath|shower|plumb|fixture|vanity|toilet|glass|tile|waterproof|faucet/.test(s)) return 'Bathroom';
  return 'Project';
}
function supplyText(x) { return text(typeof x === 'string' ? x : (x?.item || x?.label || x?.description || '')); }
function supplySection(x, analysis) { return x && typeof x === 'object' ? canonicalService(x.section, x.item || x.label || x.description, analysis?.selected_trades || []) : ''; }

function consolidateCustomerPresentation(estimate, analysis, input) {
  const out = estimate;
  const singleBath = isSingleBathroomProject(input);
  const services = selectedCustomerServices(analysis, out, input);
  if (!services.length) return out;
  const mm = 1 + (Number(out.markupPct) || RULES.markupDefault) / 100;
  const map = {};
  services.forEach(s => map[s] = { title: s, included: [], customerSupplies: [], notIncluded: [], subtotal: 0, options: [] });
  let generalBase = 0;
  const projectExclusions = [];
  (out.labor || []).forEach(l => {
    const s = singleBath ? 'Bathroom' : (pinnedService(l, analysis?.selected_trades) || canonicalService(l.section, l.item, analysis?.selected_trades || []));
    const cost = num(l.qty) * num(l.rate);
    if (map[s]) { map[s].subtotal += cost; map[s].included.push(text(l.item)); } else { generalBase += cost; }
  });
  (out.materials || []).forEach(m => {
    const s = singleBath ? 'Bathroom' : (pinnedService(m, analysis?.selected_trades) || canonicalService(m.section, m.item, analysis?.selected_trades || []));
    const cost = num(m.qty) * num(m.rate);
    if (map[s]) { map[s].subtotal += cost; map[s].included.push(text(m.item)); } else { generalBase += cost; }
  });
  const direct = services.reduce((a, s) => a + map[s].subtotal, 0);
  if (generalBase > 0) {
    services.forEach(s => {
      const share = direct > 0 ? map[s].subtotal / direct : 1 / services.length;
      map[s].subtotal += generalBase * share;
    });
  }
  (out.customerSupplied || []).forEach(x => {
    const t = supplyText(x);
    if (!t) return;
    let s = singleBath ? 'Bathroom' : supplySection(x, analysis);
    if (!map[s]) {
      const low = norm(t);
      if (/paint/.test(low)) s = 'Painting';
      else if (/hardwood|flooring/.test(low)) s = 'Flooring';
      else if (/window/.test(low)) s = 'Windows';
      else s = 'Bathroom';
    }
    if (map[s]) map[s].customerSupplies.push(t);
  });
  (out.exclusions || []).forEach(x => {
    const t = supplyText(x);
    if (!t) return;
    const owner = singleBath ? 'Bathroom' : exclusionOwner(t);
    if (map[owner]) map[owner].notIncluded.push(t); else projectExclusions.push(t);
  });
  (out.options || []).forEach(o => {
    const s = singleBath ? 'Bathroom' : canonicalService(o.section, `${o.label || ''} ${o.description || ''}`, analysis?.selected_trades || []);
    if (!map[s]) return;
    const opt = { label: text(o.label) || 'Alternative', description: text(o.description), price: money(o.price) };
    map[s].options.push(opt);
    if (s === 'Windows') map[s].notIncluded.push(`${opt.label}${opt.price ? ` — $${opt.price.toFixed(2)}` : ''} alternative (not included in current total)`);
  });
  services.forEach(s => {
    const v = map[s];
    v.included = dedupe(v.included);
    v.customerSupplies = dedupe(v.customerSupplies);
    v.notIncluded = dedupe(v.notIncluded).filter(x => !v.customerSupplies.some(y => near(x, y)));
    if (s === 'Windows') v.included = v.included.filter(x => /window/.test(norm(x)));
    v.subtotal = money(v.subtotal * mm);
  });
  out.serviceBreakdown = services.map(s => map[s]);
  out.projectExclusions = dedupe([...(out.projectExclusions || []), ...projectExclusions]);
  out.scopeSections = [];
  out.customerPresentationVersion = 'v8.3-deterministic-four-service-cost-based';
  return out;
}

module.exports = { applyDeterministicPricing, consolidateCustomerPresentation };
