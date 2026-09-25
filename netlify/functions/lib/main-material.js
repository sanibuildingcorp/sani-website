/* lib/main-material.js — the product the job is for must be on the materials list
   ----------------------------------------------------------------------------
   "It has not been calculated epoxy too, I can't found main material most
    expensive product epoxy not in material list"

   Joshua Inasuen's kitchen floor resurfacing came back with the degreaser,
   the grinding segments, the self-leveler, the aggregate - and "Epoxy bonding
   primer" - but no epoxy coating: the most expensive product on the job. No
   code removed it; the estimator never wrote the line, and a primer that
   happens to say "epoxy" looked like it was there.

   The analyst lists what Sani buys as the finish in
   contractor_supplied_finish_materials. Each one must be matched by a material
   line that is NOT a prep product. A miss is a validation failure, so the
   repair pass (generate-estimate-background.js) is told to add it.

   Matching is deliberately loose - one distinctive word of the product on one
   non-prep line - so a real line worded differently ("Engineered oak plank
   flooring" for "engineered hardwood") still counts. Only a product with no
   line at all, or only prep lines, is reported. */
'use strict';

/* Words that say nothing about which product it is. */
const STOP = new Set(['and', 'the', 'with', 'for', 'from', 'material', 'materials', 'floor', 'floors', 'flooring', 'wall', 'walls',
  'system', 'systems', 'kit', 'kits', 'coat', 'coats', 'type', 'grade', 'product', 'products', 'supply', 'supplies', 'finish',
  'finishes', 'color', 'colour', 'commercial', 'residential', 'standard', 'premium', 'quality', 'new', 'existing', 'area',
  'contractor', 'supplied', 'install', 'installation', 'high', 'heavy', 'duty', 'part', 'grade']);
/* Products that prepare for the finish, and the tools that put it down. A line
   like this never stands in for the finish itself. */
const PREP = /\b(primer|priming|bonding|bond coat|crack|filler|patch|repair mortar|degreas|cleaner|etch|grind|segment|abrasive|tape|masking|roller|squeegee|brush|spike|mixing|paddle|sandpaper|leveler|leveller|self-level|underlayment|moisture barrier|vapor barrier)/i;

const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d/.test(w));

function missingMainMaterials(estimate, analysis) {
  const finishes = Array.isArray(analysis && analysis.contractor_supplied_finish_materials) ? analysis.contractor_supplied_finish_materials : [];
  const lines = ((estimate && estimate.materials) || []).map((m) => String((m && m.item) || '').toLowerCase());
  const supplied = ((estimate && estimate.customerSupplied) || []).map((x) => String((x && x.item) || x || '').toLowerCase());
  const missing = [];
  finishes.forEach((f) => {
    const name = String(f && typeof f === 'object' ? (f.item || f.name || '') : f || '').trim();
    const keys = words(name);
    if (!keys.length) return;
    /* the finish is itself a prep product (a primer job): any line naming it counts */
    const prepJob = PREP.test(name);
    const has = (l) => keys.some((k) => l.indexOf(k) !== -1);
    if (supplied.some(has)) return;           /* the customer buys it */
    if (lines.some((l) => has(l) && (prepJob || !PREP.test(l)))) return;
    missing.push(name);
  });
  return missing;
}

module.exports = { missingMainMaterials };
