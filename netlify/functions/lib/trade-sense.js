/* ============================================================================
   lib/trade-sense.js — what every experienced contractor knows, written once
   and given to BOTH brains: the estimator chat and the generator (Regenerate).
   ----------------------------------------------------------------------------
   Why this file exists (Oct 2026, 130 Jackson St): the owner told the chat
   "demo only around the bathtub, outside the shower is painted sheetrock". The
   chat agreed. Regenerate still wrote "Bathroom demolition to studs", grew it
   to 90 sf and put the standard full-bathroom scope in front of the customer.
   The two brains did not share the same trade knowledge and the book had no
   tub-only line. Now they read the same rules, and code enforces the big one.
   ============================================================================ */
'use strict';

const TRADE_SENSE = `TRADE KNOWLEDGE (same in the chat and in the generator; always use it):
A. STANDARD SIZES - US co-op / apartment bathrooms. Do not ask for dimensions these already answer.
   - A bathtub is 60 x 30 inches. A tub that runs wall to wall means the bathroom is 5 ft wide.
   - Bathroom length is 6, 7, 8 or at most 9 ft. Ceiling is 8 to 9 ft. +/- 1 ft does not change the estimate.
   - Tub alcove = back wall 60 in + two end walls 30 in = 10 linear ft of wet wall.
     Cement board / tile floor to ceiling (8 ft) = 80 sf. Tub top to ceiling (about 6 ft) = 60 sf.
   - Walk-in shower floor in the old tub footprint = 60 x 30 in = about 13 sf.
B. TUB TO WALK-IN SHOWER IS NOT A FULL BATHROOM RENOVATION.
   - Unless the owner says full gut / whole bathroom / down to the studs everywhere, demolition is
     ONLY the tub and the walls around it (the tub alcove). We cut a clean straight line in the
     sheetrock and stop there. Every other wall, the bathroom floor, toilet, vanity and door stay untouched.
   - Use tub_alcove_demo (never bath_demo_gut) and wet_backer on the alcove walls only (never bath_backer).
   - Typical order: demo tub + alcove walls -> plumbing (valve) -> sloped mortar shower base with curb and
     drain -> cement board on the wet walls, floor to ceiling -> waterproofing walls and shower floor ->
     wall tile and shower floor tile -> glass door -> caulk, patch/paint as he asked.
C. SCOPE OF WORK = HIS WORDS. The customer reads and signs it.
   - Write the steps from his description and chat, in his order, as he described them.
   - If he says a wall, floor or fixture is not touched, it is not in any step, line or included item.
   - Never add work he did not describe. Never fall back to a "standard" bathroom scope.
D. READ EVERYTHING before answering: the request, the customer messages, his notes and the whole chat.
   His newest message wins.`;

/* Code check for rule B: the owner (notes/chat) limited the demo to the tub area
   and never asked for a full gut. Customer text alone does not count. */
function tubOnly(ownerText) {
  const t = String(ownerText || '').toLowerCase();
  const limited = /(demo|demolition|remove|open|tear)[^.]{0,40}\b(only|just)\b[^.]{0,30}\b(around|tub|alcove|shower area|wet area)|\b(only|just)\b[^.]{0,30}\baround\b[^.]{0,15}\b(bath)?tub|\btub alcove\b|\bnothing else\b[^.]{0,40}\b(opened|touched|demo)|\boutside (the )?(shower|wet area)[^.]{0,30}\b(sheetrock|painted|stays|untouched)/.test(t);
  const gut = /\b(full|complete|whole)[- ](bathroom )?(gut|demo|demolition|renovation|remodel)\b|\bgut (the )?(whole|entire|full)\b|\bdown to (the )?studs everywhere\b|\bwhole bathroom\b[^.]{0,20}\b(demo|gut|renovat)/.test(t);
  return limited && !gut;
}

module.exports = { TRADE_SENSE, tubOnly };
