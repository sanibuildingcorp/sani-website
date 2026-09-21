// netlify/functions/lib/job-size.js
//
// THE SIZE OF THE JOB IS THE SIZE OF THE REQUEST.
//
//   "in the basement bathroom in one small area was floor tile little down
//    and cracked and in the wall corner subway tile too ... so simple job
//    just lifting up add mortar and put it back down in level ... but this
//    AI write down like this: ohh my gosh it's need check plumbing ohh."
//
// The generator matched the size of the job to the TRADE, not to the
// request: a bathroom meant a bathroom renovation - leak diagnostics,
// demolition to the slab, waterproofing, a new subfloor, water-damage
// mapping, coordination lines - for a customer who asked to have a few
// tiles put back. The analysis already names a project_type; nothing used
// it. Now both prompts carry the rule below, the customer's own words are
// read for a repair up front, a repair's empty services get no lines, and
// the checks that demand renovation work (protection, cleanup, supervision)
// stand down for a repair.

"use strict";

function str(v) { return String(v == null ? "" : v).trim(); }

const REPAIR_WORDS = /\b(repair|fix|fixing|fixed|crack(?:ed|s|ing)?|loose|re-?set|re-?attach|re-?glue|re-?grout|regrout|patch(?:ing)?|caulk(?:ing)?|leak(?:ing|s)?|a few tiles?|one tile|some tiles|couple of tiles|small area|small section|small spot|broken|chip(?:ped|s)?|popped|lifted|came off|fell off|falling off|hole)\b/i;
const RENOVATION_WORDS = /\b(renovat\w*|remodel\w*|gut(?:ted|ting)?|full|entire|whole|complete|new bathroom|new kitchen|replace (?:the |all |entire )?(?:floor|flooring|tile|tiles|tub|shower|vanity|cabinets|countertop)|install new|tear out|demolition|demo\b)/i;

/* The customer's words, before any model reads them. */
function readsAsRepair(text) {
  const t = str(text);
  if (!t) return false;
  return REPAIR_WORDS.test(t) && !RENOVATION_WORDS.test(t);
}

/* The analyst's verdict. */
function isRepair(analysis) {
  return /^repair/i.test(str(analysis && analysis.project_type));
}

function sizeHint(input) {
  const req = (input && input.request) || {};
  const text = [req.description, req.extraRequest, Array.isArray(req.conversation) ? req.conversation.map(function (m) { return m && m.text; }).join(" ") : ""].filter(Boolean).join(" ");
  return readsAsRepair(text)
    ? "THE CUSTOMER'S WORDS READ AS A REPAIR (fix / cracked / loose / a few tiles, and nothing about renovating): project_type is \"repair\" unless the record clearly says otherwise, and the scope is the repair only.\n\n"
    : "";
}

const SIZE_RULE_ANALYSIS = "THE SIZE OF THE JOB IS THE SIZE OF THE REQUEST. First decide project_type from the customer's own words: \"repair\" = fix what is broken (a few cracked or loose tiles, a leak, a door, a patch - hours or a day or two); \"partial renovation\" = one area redone; \"full renovation\" = a room gutted and rebuilt. For a REPAIR, confirmed_scope holds ONLY the repair the customer described plus the one or two enabling steps that repair needs (a line of protection, cleanup). No leak diagnostics, no moisture mapping, no demolition beyond the damaged spot, no waterproofing system, no subfloor or underlayment rebuild, no new fixtures, no \"water damage\" work - unless the customer described that damage or asked for that work. A service ticked on the form that the description gives no work for stays in selected_trades with EMPTY scope_items and the assumption \"selected on the form, no work described\" - never invent work to fill it. Growing a repair into a renovation is the worst failure of this stage: the customer asked for a tile put back, not a floor rebuilt.";

const SIZE_RULE_ESTIMATOR = "THE SIZE OF THE JOB IS THE SIZE OF THE REQUEST. analysis.project_type says what this is. For a REPAIR: price only the repair itself - typically 2 to 6 labor lines and the few materials it needs (mortar, grout, a few tiles); one short protection line and one cleanup line at most; NO project coordination or supervision line; no diagnostics, no demolition beyond the damaged spot, no waterproofing membrane, no subfloor, no underlayment, no new fixtures unless confirmed_scope names them. A selected service with empty scope_items gets NO lines. Rules 6 to 11 describe renovations and do not apply to a repair. Never turn a repair into a rebuild.";

/* For a repair, a selected service the analyst gave no work is dropped
   from the trades the estimator prices and the cards the customer sees. */
function trimRepairTrades(analysis) {
  if (!analysis || !isRepair(analysis) || !Array.isArray(analysis.selected_trades)) return analysis;
  const withWork = {};
  (Array.isArray(analysis.confirmed_scope) ? analysis.confirmed_scope : []).forEach(function (c) {
    if (c && Array.isArray(c.scope_items) && c.scope_items.filter(function (x) { return str(typeof x === "string" ? x : (x && (x.item || x.text))); }).length) withWork[str(c.trade).toLowerCase()] = true;
  });
  const kept = analysis.selected_trades.filter(function (t) { return withWork[str(t).toLowerCase()]; });
  if (kept.length && kept.length < analysis.selected_trades.length) {
    const dropped = analysis.selected_trades.filter(function (t) { return !withWork[str(t).toLowerCase()]; });
    analysis.selected_trades = kept;
    analysis.assumptions = (Array.isArray(analysis.assumptions) ? analysis.assumptions : []).concat(["Selected on the form, no work described, not priced: " + dropped.join(", ")]);
  }
  return analysis;
}

module.exports = { readsAsRepair, isRepair, sizeHint, trimRepairTrades, SIZE_RULE_ANALYSIS, SIZE_RULE_ESTIMATOR };
