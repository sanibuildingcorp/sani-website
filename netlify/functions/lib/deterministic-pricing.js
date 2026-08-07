// Sani Building Corp — deterministic estimator guardrails v1
// AI interprets scope. This module constrains labor production, alternatives,
// customer-facing service ownership, and estimate-health reconciliation.

const RULES = {
  paintingSfPerHour: 30,
  engineeredHardwoodSfPerHour: 14,
  largeFormatTileSfPerHour: 4,
  markupDefault: 25,
};

function num(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; }
function money(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function text(v) { return String(v == null ? '' : v).trim(); }
function norm(v) { return text(v).toLowerCase(); }
function sumLines(lines) { return (lines || []).reduce((s, l) => s + num(l.qty) * num(l.rate), 0); }

function allEvidence(input, analysis) {
  return [
    input && input.request && input.request.description,
    input && input.request && input.request.sqft,
    JSON.stringify(input && input.request && input.request.groupedAnswers || {}),
    JSON.stringify(analysis && analysis.quantities || {}),
    JSON.stringify(analysis && analysis.confirmed_scope || []),
  ].filter(Boolean).join(' | ');
}

function findQuantity(evidence, patterns) {
  for (const re of patterns) {
    const m = evidence.match(re);
    if (m) return num(String(m[1]).replace(/,/g, ''));
  }
  return 0;
}

function extractQuantities(input, analysis) {
  const e = allEvidence(input, analysis);
  const paintingSf = findQuantity(e, [
    /(?:paint(?:ing|able)?|walls?\s*(?:and|\+|,)\s*ceilings?|walls?)[^\d]{0,80}([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square\s*feet)/i,
    /([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square\s*feet)[^|]{0,80}(?:paint(?:ing|able)?|walls?\s*(?:and|\+|,)\s*ceilings?)/i,
  ]);
  const flooringSf = findQuantity(e, [
    /(?:engineered\s+hardwood|hardwood\s+floor(?:ing)?|flooring)[^\d]{0,80}([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square\s*feet)/i,
    /([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square\s*feet)[^|]{0,80}(?:engineered\s+hardwood|hardwood\s+floor(?:ing)?|flooring)/i,
  ]);
  const tileSf = findQuantity(e, [
    /(?:24\s*[x×]\s*48|large[- ]format|tile)[^\d]{0,80}([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square\s*feet)/i,
    /([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s*ft|square\s*feet)[^|]{0,80}(?:24\s*[x×]\s*48|large[- ]format\s+tile)/i,
  ]);
  return { paintingSf, flooringSf, tileSf };
}

function laborMatches(line, kind) {
  const s = norm(`${line.section || ''} ${line.item || ''}`);
  if (kind === 'painting') return /paint|painter|wall.*ceiling|ceiling.*wall/.test(s);
  if (kind === 'flooring') return /engineered hardwood|hardwood floor|flooring install|floor installer/.test(s) && !/bath|tile|shower/.test(s);
  if (kind === 'tile') return /tile setter|tile install|large[- ]format|24\s*[x×]\s*48/.test(s);
  return false;
}

function enforceMinimumHours(estimate, kind, minimumHours, reason, adjustments) {
  if (!minimumHours) return;
  const matches = (estimate.labor || []).filter(l => laborMatches(l, kind));
  if (!matches.length) {
    adjustments.push({ type: 'MISSING_PRODUCTION_LINE', kind, minimumHours: Math.ceil(minimumHours), reason });
    return;
  }
  const current = matches.reduce((s, l) => s + num(l.qty), 0);
  if (current + 0.01 >= minimumHours) return;
  const target = matches.slice().sort((a,b) => num(b.qty) - num(a.qty))[0];
  const before = num(target.qty);
  target.qty = Math.ceil(before + (minimumHours - current));
  adjustments.push({ type: 'PRODUCTION_HOURS_RAISED', kind, fromHours: current, toHours: matches.reduce((s,l)=>s+num(l.qty),0), changedLine: target.item, reason });
}

function isAlternativeLine(line) {
  const s = norm(`${line.item || ''} ${line.description || ''}`);
  return /\boption\s*[b-z]\b|\balternate\b|\balternative\b/.test(s);
}

function isolateAlternatives(estimate, adjustments) {
  estimate.options = Array.isArray(estimate.options) ? estimate.options : [];
  ['labor','materials'].forEach(bucket => {
    const keep = [];
    (estimate[bucket] || []).forEach(line => {
      if (!isAlternativeLine(line)) return keep.push(line);
      const price = money(num(line.qty) * num(line.rate) * (1 + num(estimate.markupPct || RULES.markupDefault) / 100));
      estimate.options.push({ section: line.section || 'General', label: line.item || 'Alternate option', description: `Alternate ${bucket} line; excluded from base Grand Total`, price });
      adjustments.push({ type: 'ALTERNATIVE_REMOVED_FROM_BASE', bucket, item: line.item, price });
    });
    estimate[bucket] = keep;
  });
}

function canonicalService(section, item, selected) {
  const s = norm(`${section || ''} ${item || ''}`);
  const selectedText = (selected || []).map(norm);
  const has = name => selectedText.some(x => x.includes(name));
  if (/window/.test(s)) return 'Windows';
  if (/paint|painter/.test(s) && has('paint')) return 'Painting';
  if (/engineered hardwood|hardwood floor|flooring|quarter.?round|subfloor|transition/.test(s) && !/bath|tile|shower/.test(s)) return 'Flooring';
  if (/bath|shower|vanity|toilet|plumb|waterproof|backer|thinset|grout|tile|glass|glaz|bathroom.*electric|bathroom.*drywall/.test(s)) return 'Bathroom';
  if (/project management|supervision|coordination|general conditions/.test(s)) return 'General';
  return text(section) || 'General';
}

function normalizeServiceOwnership(estimate, analysis, adjustments) {
  const selected = analysis && analysis.selected_trades || [];
  ['labor','materials'].forEach(bucket => {
    (estimate[bucket] || []).forEach(line => {
      const next = canonicalService(line.section, line.item, selected);
      if (next && next !== line.section) {
        adjustments.push({ type: 'SERVICE_REASSIGNED', bucket, item: line.item, from: line.section, to: next });
        line.section = next;
      }
    });
  });
  (estimate.customerSupplied || []).forEach(line => {
    if (typeof line !== 'object') return;
    line.section = canonicalService(line.section, line.item, selected);
  });
  (estimate.options || []).forEach(o => { o.section = canonicalService(o.section, `${o.label || ''} ${o.description || ''}`, selected); });
}

function calculateTotals(estimate) {
  const labor = money(sumLines(estimate.labor));
  const materials = money(sumLines(estimate.materials));
  const subtotal = money(labor + materials);
  const markupPct = Number.isFinite(Number(estimate.markupPct)) ? Number(estimate.markupPct) : RULES.markupDefault;
  const markup = money(subtotal * markupPct / 100);
  return { labor, materials, subtotal, markupPct, markup, grandTotal: money(subtotal + markup) };
}

function buildHealth(estimate, analysis, quantities, adjustments) {
  const issues = [];
  const totals = calculateTotals(estimate);
  const selected = (analysis && analysis.selected_trades || []).map(text).filter(Boolean);
  selected.forEach(trade => {
    const canonical = canonicalService(trade, trade, selected);
    const covered = (estimate.labor || []).some(l => canonicalService(l.section, l.item, selected) === canonical);
    if (!covered) issues.push({ severity: 'BLOCK', code: 'MISSING_LABOR_COVERAGE', message: `${trade} has no labor coverage.` });
  });
  if ((estimate.labor || []).some(isAlternativeLine) || (estimate.materials || []).some(isAlternativeLine)) {
    issues.push({ severity: 'BLOCK', code: 'ALTERNATIVE_IN_BASE_TOTAL', message: 'A mutually exclusive alternate is still inside base labor/materials.' });
  }
  if (quantities.paintingSf && !(estimate.labor || []).some(l => laborMatches(l,'painting'))) issues.push({ severity:'REVIEW', code:'PAINTING_RATE_NOT_APPLIED', message:'Painting quantity was found but no painting production line was recognized.' });
  if (quantities.flooringSf && !(estimate.labor || []).some(l => laborMatches(l,'flooring'))) issues.push({ severity:'REVIEW', code:'FLOORING_RATE_NOT_APPLIED', message:'Flooring quantity was found but no flooring production line was recognized.' });
  if (quantities.tileSf && !(estimate.labor || []).some(l => laborMatches(l,'tile'))) issues.push({ severity:'REVIEW', code:'TILE_RATE_NOT_APPLIED', message:'Large-format tile quantity was found but no tile production line was recognized.' });
  const status = issues.some(i=>i.severity==='BLOCK') ? 'BLOCKED' : issues.length ? 'REVIEW' : 'PASS';
  return { status, issues, quantities, totals, deterministicAdjustments: adjustments, checkedAt: new Date().toISOString(), version: 'deterministic-v1' };
}

function applyDeterministicPricing(estimate, analysis, input) {
  const out = JSON.parse(JSON.stringify(estimate || {}));
  out.labor = Array.isArray(out.labor) ? out.labor : [];
  out.materials = Array.isArray(out.materials) ? out.materials : [];
  const adjustments = [];
  const q = extractQuantities(input || {}, analysis || {});

  isolateAlternatives(out, adjustments);
  normalizeServiceOwnership(out, analysis || {}, adjustments);

  enforceMinimumHours(out, 'painting', q.paintingSf ? q.paintingSf / RULES.paintingSfPerHour : 0, `${q.paintingSf} paintable SF ÷ ${RULES.paintingSfPerHour} SF/labor-hour`, adjustments);
  enforceMinimumHours(out, 'flooring', q.flooringSf ? q.flooringSf / RULES.engineeredHardwoodSfPerHour : 0, `${q.flooringSf} flooring SF ÷ ${RULES.engineeredHardwoodSfPerHour} SF/labor-hour`, adjustments);
  enforceMinimumHours(out, 'tile', q.tileSf ? q.tileSf / RULES.largeFormatTileSfPerHour : 0, `${q.tileSf} large-format tile SF ÷ ${RULES.largeFormatTileSfPerHour} SF/labor-hour`, adjustments);

  out.deterministicPricing = { version: 'v1', quantities: q, adjustments };
  out.estimateHealth = buildHealth(out, analysis || {}, q, adjustments);
  return out;
}

module.exports = { RULES, applyDeterministicPricing, extractQuantities, calculateTotals, canonicalService };
