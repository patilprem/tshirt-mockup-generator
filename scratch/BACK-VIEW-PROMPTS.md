# Back-view flat-lay generation prompts

Prompts for generating the **back-side** flat-lay garment photos, matching the
existing front assets in `public/assets/processed/tshirt_*.png`.

These are for the flat-lay pipeline only. `scratch/template-studio.html` is the
on-model prompt builder and is unrelated to these.

## Why the constraints are what they are

The downstream pipeline, not taste, sets most of these rules:

- **Pure black background.** `scratch/crop_garment.cjs` keys the background with
  a border flood fill that treats any pixel under RGB 110 as background. A grey,
  gradient or vignetted backdrop survives the key and lands in the cutout.
- **Pure white garment, evenly lit.** `buildShirtLayers()` in
  `src/scripts/flatlay-engine.js` splits the photo at a luminance baseline
  (`yFlat`, ~225-235 for existing garments): everything below becomes multiplied
  creases, everything above becomes screened sheen. A garment shot grey, warm or
  unevenly lit recolours wrong for every colour the user picks.
- **No shadow crushing to near-black.** Fold shadows darker than the key
  threshold get flood-filled away as background, punching holes in the garment.
- **Straight-on, symmetric, centred.** The crop script scales the detected
  bounding box into a 1000x1000 frame; a tilted or off-centre garment bakes that
  tilt into the artboard and the print area no longer sits square on the back.
- **No labels, tags, prints or trim.** Anything non-white is a permanent mark no
  recolour can remove, and it sits inside the print area.

## Shared style block

Every prompt below ends with this same block, kept identical so all four
garments key and relight consistently:

> Shot straight down from directly overhead, perfectly flat and symmetric, laid
> on a seamless pure black background. The garment is pure white matte cotton,
> evenly and softly lit with no hard shadow line, no colour cast and no hotspot;
> fold shadows stay soft mid-grey and never darken toward black. Gentle natural
> fabric folds only, no heavy wrinkles or creases. Absolutely no print, logo,
> text, graphic, brand mark, neck label, care tag, hanger, pins, props or
> background objects of any kind. Sharp focus edge to edge, garment centred with
> even margin on all four sides, square 1:1 framing, highest available
> resolution.

---

## 1. Crewneck tee — back

```
A plain white crew-neck t-shirt photographed from the BACK, laid flat.
The back panel is one broad unbroken rectangle of fabric from the shoulder
seams down to the straight hem, with no neckline dip — the back collar is a
narrow, shallow, evenly curved ribbed band sitting high across the top, much
higher and flatter than a front neckline. Short set-in sleeves lie flat and
symmetric, angled slightly down and away from the body. Classic regular fit,
straight body, not oversized or boxy.

Shot straight down from directly overhead, perfectly flat and symmetric, laid
on a seamless pure black background. The garment is pure white matte cotton,
evenly and softly lit with no hard shadow line, no colour cast and no hotspot;
fold shadows stay soft mid-grey and never darken toward black. Gentle natural
fabric folds only, no heavy wrinkles or creases. Absolutely no print, logo,
text, graphic, brand mark, neck label, care tag, hanger, pins, props or
background objects of any kind. Sharp focus edge to edge, garment centred with
even margin on all four sides, square 1:1 framing, highest available
resolution.
```

**Watch for:** the generator drifting back to a front view — the giveaway is a
deep scooped neckline. The back collar must read as a shallow band. Also reject
any centre-back neck label, which sits right at the top of the print area.

---

## 2. Long sleeve tee — back

```
A plain white long-sleeve t-shirt photographed from the BACK, laid flat.
The back panel is one broad unbroken rectangle of fabric from the shoulder
seams down to the straight hem, with no neckline dip — the back collar is a
narrow, shallow, evenly curved ribbed band sitting high across the top. Both
full-length sleeves lie flat, straight and symmetric, angled down and away from
the body with the cuffs fully visible and clear of the body. Classic regular
fit, straight body, not oversized or boxy.

Shot straight down from directly overhead, perfectly flat and symmetric, laid
on a seamless pure black background. The garment is pure white matte cotton,
evenly and softly lit with no hard shadow line, no colour cast and no hotspot;
fold shadows stay soft mid-grey and never darken toward black. Gentle natural
fabric folds only, no heavy wrinkles or creases. Absolutely no print, logo,
text, graphic, brand mark, neck label, care tag, hanger, pins, props or
background objects of any kind. Sharp focus edge to edge, garment centred with
even margin on all four sides, square 1:1 framing, highest available
resolution.
```

**Watch for:** sleeves crossing over the body panel. They must stay clear of the
back panel or they intrude on the print area and the fold shading reads a sleeve
edge as a crease. Keep both cuffs symmetric — the crop centres on the bounding
box, so an asymmetric sleeve spread shifts the body off centre.

---

## 3. Sweatshirt — back

```
A plain white crew-neck sweatshirt photographed from the BACK, laid flat.
The back panel is one completely smooth unbroken rectangle of fabric from the
shoulder seams down to the ribbed waistband, with NO pocket of any kind — the
kangaroo pocket exists only on the front and must not appear. The back collar
is a narrow ribbed band sitting high and flat across the top with no neckline
dip. Both long set-in sleeves lie flat and symmetric with ribbed cuffs. Matte
brushed-fleece cotton, classic regular fit, straight body, not oversized. The
ribbed collar, cuffs and waistband are the same pure white as the body with no
contrast trim or panel.

Shot straight down from directly overhead, perfectly flat and symmetric, laid
on a seamless pure black background. The garment is pure white matte cotton,
evenly and softly lit with no hard shadow line, no colour cast and no hotspot;
fold shadows stay soft mid-grey and never darken toward black. Gentle natural
fabric folds only, no heavy wrinkles or creases. Absolutely no print, logo,
text, graphic, brand mark, neck label, care tag, hanger, pins, props or
background objects of any kind. Sharp focus edge to edge, garment centred with
even margin on all four sides, square 1:1 framing, highest available
resolution.
```

**Watch for:** two things. A pocket appearing on the back is the most common
failure and disqualifies the image outright. And fleece folds far deeper than
jersey, so this is the garment most likely to produce shadows dark enough to be
keyed out as background — ask for flatter light and re-roll rather than accept
a deep-shadowed take.

---

## 4. Hoodie — back

```
A plain white pullover hoodie photographed from the BACK, laid flat.
The hood lies flat and spread out at the top of the garment, seen from behind
and lying across the upper back, with no drawstring cords, no toggles, no
eyelets and no contrast lining visible. Below the hood, the back panel is one
completely smooth unbroken rectangle of fabric down to the ribbed waistband,
with NO pocket of any kind — the kangaroo pocket exists only on the front and
must not appear. Both long set-in sleeves lie flat and symmetric with ribbed
cuffs. Matte brushed-fleece cotton, classic regular fit, straight body, not
oversized. The hood, ribbed cuffs and waistband are the same pure white as the
body with no contrast trim.

Shot straight down from directly overhead, perfectly flat and symmetric, laid
on a seamless pure black background. The garment is pure white matte cotton,
evenly and softly lit with no hard shadow line, no colour cast and no hotspot;
fold shadows stay soft mid-grey and never darken toward black. Gentle natural
fabric folds only, no heavy wrinkles or creases. Absolutely no print, logo,
text, graphic, brand mark, neck label, care tag, hanger, pins, props or
background objects of any kind. Sharp focus edge to edge, garment centred with
even margin on all four sides, square 1:1 framing, highest available
resolution.
```

**Watch for:** the hood is the whole difficulty here. It must lie flat and
spread, not bunched into a dark mound — a bunched hood both crushes to
near-black and eats vertical space the print area needs. It also sets the top of
the back print area, so its lower edge should sit high, around a third of the
way down the garment. Drawstrings are front-only and must not appear.

---

## After generating

The code side is already in place — `garmentConfigs` in
`src/scripts/flatlay-engine.js` carries a `back` entry for all four garments,
and the editor toggle, per-side placement and batch naming all read it. Each
entry is gated behind `ready: false` until its photograph exists, so the
remaining work per garment is:

1. Save the generation as a PNG and run it through the existing crop/key step,
   using exactly the filename the config already expects:
   `node scratch/crop_garment.cjs <src.png> public/assets/processed/tshirt_<name>_back.png`
   — `tshirt_flatlay_back.png` (crewneck), `tshirt_longsleeve_back.png`,
   `tshirt_hoodie_back.png`, `tshirt_sweatshirt_back.png`.
2. Check the keyed result has no holes in deep folds and no grey halo at the
   edges. Holes mean the fold shadows went darker than the RGB 110 key
   threshold — regenerate with flatter light rather than patching the PNG.
3. Recalibrate `printArea` with `scratch/calibrate_print_areas.cjs`. **The
   numbers currently in the `back` entries are provisional estimates, not
   measurements** — they were reasoned from the front rects (back areas run
   taller and start higher, with no collar dip or pocket to clear) so the
   feature had something to render against, and every one of them needs
   replacing with a measured value.
4. Check `pxPerIn` for the side. It is inherited from the front and usually
   correct, since it is the same garment in the same size — but `crop_garment.cjs`
   scales to the detected bounding box, so a back view with a different spread
   (the hoodie's flattened hood especially) can land at a different scale and
   needs its own value in the `back` entry.
5. Flip `ready: true` in that garment's `back` entry. The toggle appears for
   that garment on the next load; nothing else needs changing.

`test_garment_side.cjs` covers the wiring end to end and stands in a mirrored
front asset to do it, so it passes before the real art lands and keeps passing
after.
