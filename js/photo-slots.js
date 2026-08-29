/* js/photo-slots.js — the shots that make a job estimable.
 *
 * THE COMPLAINT THIS EXISTS FOR:
 *
 *   "The customers many times sends photos where shows just damage very close
 *    which is very difficult to identify areas or figure dimensions."
 *
 * A tight close-up of a cracked tile is a photograph of a crack. It is not a
 * photograph of a JOB. It cannot say whether the room is 30 square feet or 300,
 * whether the wall is eight feet or eighteen, or where the water is coming from.
 * Every one of those is a number in the estimate, so a folder full of close-ups
 * turns pricing into guessing — and a guess that comes back as $3,700 or $20,000
 * depending on which way it fell is the thing this whole system keeps fighting.
 *
 * WHY THE FIX IS SLOTS AND NOT A CLEVERER CAMERA.
 *
 * The instinct is to do what a bank does when you photograph a check: watch the
 * live preview and say "move closer", "hold steady". A web page cannot. When a
 * customer taps "Take Photo" on a file input, iOS hands off to its OWN camera
 * app — a separate program, sealed off. The page never sees that preview and
 * cannot draw a single pixel on it. Banks manage it because they are native apps
 * holding the camera directly. (An in-page camera via getUserMedia can do it, and
 * is the next step, but it needs a permission prompt and dies in the Instagram
 * and Facebook in-app browsers a lot of customers arrive through.)
 *
 * So instead of guiding the shot, ASK FOR THE RIGHT SHOTS BY NAME. Four labelled
 * slots, each saying plainly where to stand. This beats live guidance on the part
 * that actually matters anyway: it works in every browser, needs no permission,
 * and it hands the estimator something no overlay could — it knows WHICH photo is
 * the wide one. A picture labelled "the whole room from the doorway" is evidence
 * about size. The same picture unlabelled is just another image.
 *
 * Nothing here is mandatory. Zura's standing rule holds — many customers do not
 * know what they are looking at, and a form that refuses them is a lead lost. The
 * slots guide; the "anything else" bucket takes whatever they have; and if the
 * wide shot is missing they get one sentence about it, not a locked button.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  /* Browser: hang everything off the window so contact.html and estimate.html
     read from ONE definition. Two pages with their own copy of this list is two
     pages that quietly disagree about what "wide" means. */
  if (root) Object.keys(api).forEach(function (k) { root[k] = api[k]; });
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  /* Ordered as a person would actually shoot them: stand back, step in, lean
     close, then put something next to it. */
  var PHOTO_SLOTS = [
    {
      id: "wide",
      icon: "🚪",
      label: "The whole room",
      /* The 0.5x tip is the actionable half. In a small bathroom there is nowhere
         to step back to, and the phone's ultra-wide is the only thing that fits
         the room in one frame. */
      hint: "From the doorway — use 0.5× if the room is small",
      /* The one shot the estimate genuinely cannot be built without. It is what
         turns "a cracked tile" into "a 40 sq ft bathroom with a cracked tile". */
      essential: true,
    },
    {
      id: "area",
      icon: "📐",
      label: "The area to work on",
      hint: "The whole wall, floor or section — not just the bad part",
      essential: false,
    },
    {
      id: "close",
      icon: "🔍",
      label: "Close-up",
      hint: "The damage, crack or stain itself",
      essential: false,
    },
    {
      id: "scale",
      icon: "📏",
      label: "Something for size",
      /* A tape measure is ideal, but almost nobody is holding one. The point is
         any object whose size is already known, so the photo can be measured
         afterwards instead of estimated by eye. */
      hint: "Lay a tape measure, a dollar bill or your shoe in the shot",
      essential: false,
    },
  ];

  /* Anything that does not belong to a named shot. Deliberately last, and
     deliberately unlimited-ish: a customer who ignores the slots entirely and
     just sends eight pictures must still be able to. */
  var OTHER_SLOT = {
    id: "other",
    icon: "📎",
    label: "Anything else",
    hint: "Other photos, PDFs or drawings",
    essential: false,
  };

  var ALL_SLOTS = PHOTO_SLOTS.concat([OTHER_SLOT]);

  function slotById(id) {
    var key = String(id == null ? "" : id);
    for (var i = 0; i < ALL_SLOTS.length; i++) if (ALL_SLOTS[i].id === key) return ALL_SLOTS[i];
    return null;
  }

  /* The human name for a slot id, for anywhere a label is shown next to a photo
     — the dashboard lead card, the estimator's input, an email. An id that is not
     one of ours returns "", never "undefined" in front of a customer. */
  function slotLabel(id) {
    var s = slotById(id);
    return s ? s.label : "";
  }

  /* Count the photos held against each slot. Accepts the shape both forms use:
     a flat list of objects carrying a `slot`. Anything with no slot, or an
     unrecognised one, counts as "other" rather than being dropped. */
  function countBySlot(photos) {
    var out = {};
    ALL_SLOTS.forEach(function (s) { out[s.id] = 0; });
    (Array.isArray(photos) ? photos : []).forEach(function (p) {
      if (!p) return;
      var id = slotById(p.slot) ? String(p.slot) : "other";
      out[id]++;
    });
    return out;
  }

  function missingEssential(photos) {
    var counts = countBySlot(photos);
    return PHOTO_SLOTS.filter(function (s) { return s.essential && !counts[s.id]; });
  }

  /* THE NUDGE. One sentence, shown next to the upload zone — never a block on
     submitting, never a popup. It appears only once the customer has actually
     started sending photos, because telling somebody who has sent nothing that
     their nothing is the wrong shape is just noise.
     Returns "" when there is nothing worth saying. */
  function photoNudge(photos) {
    var list = Array.isArray(photos) ? photos : [];
    if (!list.length) return "";
    var missing = missingEssential(list);
    if (!missing.length) return "";
    var counts = countBySlot(list);
    /* If every single thing they sent is a close-up, say the specific thing.
       This is Zura's complaint word for word, so it gets the plain answer. */
    if (counts.close && counts.close === list.length) {
      return "These are all close-ups. One photo from the doorway, showing the whole room, is what lets us work out the size — without it we are guessing at the area.";
    }
    return "One more from the doorway, showing the whole room, would let us size the job properly.";
  }

  return {
    PHOTO_SLOTS: PHOTO_SLOTS,
    OTHER_SLOT: OTHER_SLOT,
    ALL_SLOTS: ALL_SLOTS,
    slotById: slotById,
    slotLabel: slotLabel,
    countBySlot: countBySlot,
    missingEssential: missingEssential,
    photoNudge: photoNudge,
  };
});
