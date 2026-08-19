# Video mockups — the plate architecture

Companion to [PRODUCT-PLAN.md](PRODUCT-PLAN.md) item 7, which scoped video mockups as a
client-side zoom/pan or colour-cycle over a still. That scope is too small. What sells on
Instagram and TikTok is a **person moving in the garment**, and that is a different pipeline.

This document records how the reference product actually works, why the obvious AI approach
fails, the architecture that does work, and what has been measured rather than assumed.

## The thesis, sharpened

AI image generation has already collapsed the cost of a static mockup, so a library of static
mockups stops being defensible. Motion is the next moat.

But the moat is *not* "generate video with AI". Anyone can call a video model. The moat is:

> a library of **baked garment plates** plus a **deterministic compositor** that prints a
> seller's artwork onto them without a generative model ever touching the artwork.

Plates are expensive once and free forever. The compositor is a few seconds of CPU per seller.
That asymmetry — high fixed cost, near-zero marginal cost — is the thing competitors have to
rebuild from scratch, and it is the same asymmetry that already makes
`public/assets/on-model/templates.json` valuable.

## What the reference clips actually are

Three Placeit exports were measured frame by frame (1080x1920, 24fps, 7–10s, H.264). The
findings:

- **The footage is real, filmed once, and reused.** Backgrounds show consistent parallax and
  natural motion blur. These are stock clips of models in blank garments, not per-customer
  renders.
- **The artwork is composited, not generated.** Print edges stay vector-crisp at native
  resolution across every frame, and flat colour fills stay flat. No diffusion model holds
  typography that stable over 200 frames.
- **The print deforms non-rigidly.** Between two frames of the same clip the graphic shears and
  bends with the chest — it is a mesh warp, not a rigid paste.
- **The print is lit by the garment.** On the light-shirt clip the graphic visibly darkens
  where fabric folds and lifts where it catches sun. Multiply against the plate's own
  luminance.
- **The print is masked to the silhouette.** It cuts off exactly at the shirt edge when an arm
  crosses it.
- **Fabric colour is a recolour, not a second shoot.** Two of the three clips are the same
  garment tone under different lighting.

That is precisely the still pipeline in `src/scripts/onmodel-engine.js`, run per frame, with
one layer added: a mesh saying where the print area moved.

## The trap: image-to-video on a finished mockup

The obvious move with Flow or any image-to-video model is to render a finished mockup still and
animate it. **Do not build on this.** Diffusion models re-synthesise every pixel every frame, so
the artwork is regenerated 200 times. Text warps, letterforms melt and merge, thin linework
breaks up, and flat fills develop drift. Print-on-demand designs are overwhelmingly typographic,
which is the exact failure mode.

This is good news. Everyone reaching for the obvious tool lands on unusable output, which is
why the moat holds for a while.

The rule that follows: **the seller's pixels must never pass through a generative model.** AI
generates the garment plate. Classical compositing prints the design.

## Architecture

Two programs, split on the cost asymmetry.

**Bake once per plate** — `scratch/video/build_plate.py`

1. Track the garment with forward-backward validated Lucas-Kanade optical flow. Points that
   fail a sub-pixel round trip are dropped rather than smoothed; a tracker that slides onto the
   background is worse than a missing one.
2. Deform a grid over the print area with moving-least-squares (Schaefer et al. 2006), so a
   vertex over the sternum follows sternum trackers and one over the hem follows the hem.
3. Chroma-key the garment matte per frame.
4. Extract illumination as a ratio against the garment's own low-pass, which cancels the base
   colour of the blank so one layer drives every garment colour.

Output is a plate package: frames, per-frame matte and shade, a mesh array, and a `plate.json`
that deliberately mirrors a `templates.json` row (`printRect`, `relMax`, `ambientTint`).

**Render per seller** — `scratch/video/render_mockup.py`

1. Recolour the garment through `relight_lut()`, a numerically identical port of
   `onModelRelightLut()` in `src/scripts/onmodel-engine.js`. Identical on purpose: a seller who
   puts a video and a still in one Etsy listing will see any hue drift between them.
2. Mip the artwork down to roughly 2.5x its on-screen size with area averaging before warping.
   Skipping this is what makes a composite read as jagged clip-art instead of ink.
3. Warp through the mesh, cell by cell, so shared cell edges agree and the print shows no seams.
4. Multiply by the shade layer, feather the alpha sub-pixel to stand in for ink wicking into
   the weave, and clip to the matte.

## Measured, not assumed

Run against one of the reference clips (1080x1920, 201 frames), on CPU, no GPU:

| Quantity | Result |
|---|---|
| Trackers surviving all 201 frames | 862 of 1470 (59%) at full res; 83% at half res |
| Bake time, whole clip | ~74 s |
| Render time per seller design | ~95 s single-threaded, trivially parallel per frame |
| Print stability | no visible drift, swim or edge crawl across the clip |
| Recolour | folds, weave and existing ink preserved |

Tracking was never the bottleneck. Resampling quality was: the first pass looked wrong purely
because the artwork was undersampled, not because the geometry was off.

## Where Grok and Flow fit

They generate **plates**, never mockups.

- **Flow / Veo** — the blank-garment clips. This is safe generative work: there is no fine
  detail to preserve, so the failure mode above never arises. Target 5–8 s, 1080x1920, one
  continuous shot.
- **Grok** — scene and pose ideation, and reference stills to seed a clip.

### Plate generation spec

The downstream pipeline sets these rules, not taste — the same logic as
[scratch/BACK-VIEW-PROMPTS.md](scratch/BACK-VIEW-PROMPTS.md) for flat-lays.

- **Blank garment in saturated violet.** Not white. `violetBase` in `templates.json` is already
  `[118.2, 74.2, 153]`, and the whole relight path is built around it. Violet chroma-keys
  cleanly against skin, foliage and sky, and hue is stable frame to frame where a learned mask
  crawls. It also leaves maximum headroom to recolour into any garment colour.
- **Absolutely no print, logo, text, seam tape, brand mark or neck label** anywhere on the
  garment. Anything on the blank is permanent and sits inside the print area.
- **Torso in frame, chest unobstructed** for at least 80% of the clip. Hair, hands and crossed
  arms over the chest cost trackers exactly where the mesh needs them most.
- **Even, soft key light; no blown highlights and no crushed shadows.** The shade layer is a
  ratio, so clipped fabric carries no recoverable fold information.
- **Slow, continuous motion.** Gentle turns, walking, laughing. No whip pans, no cuts, no motion
  blur heavy enough to destroy features — LK needs texture to hold onto.
- **Matte cotton, visible weave, natural folds.** Satin or heavy specularity breaks the
  multiply-shading assumption.
- **One continuous shot.** A cut resets every track; a plate spanning a cut must be baked as two.

Not every generation will pass. Bake is the gate: if fewer than ~150 trackers survive the clip,
`build_plate.py` rejects it. Budget for a hit rate well below 1 and generate in batches.

## Roadmap

1. **Prove the plate library.** Ten plates covering the formats that travel on TikTok: walking,
   laughing, mirror, café, street, flat-lay-to-body. Bake, eyeball, keep what holds.
2. **Port the renderer to the browser.** The maths is already framework-free canvas work in
   `onmodel-engine.js`; the mesh is a small typed array per frame and WebCodecs or
   MediaRecorder handles encoding. Keeps the "files never leave the browser" wedge intact,
   which is the entire positioning in PRODUCT-PLAN.
3. **Ship colour + design together.** The colour-cycle video is a native TikTok format and falls
   straight out of the relight path.
4. **Seed the plates with Flow** once the ten filmed-or-generated plates prove the bake gate.

## Risks

- **Plate supply is the real cost.** The compositor is solved; sourcing clips that survive the
  bake gate is the work. Filming one afternoon with one model may beat generating.
- **Browser render time.** ~95 s of CPU per clip is fine on a laptop and painful on a phone.
  Offer a lower-resolution preview and a full-resolution export.
- **Uncanny-valley plates.** A generated model that reads as AI undercuts a product whose pitch
  is realism. Judge plates on whether they pass as filmed, not on prompt adherence.
- **Likeness and licensing.** Filmed models need a release covering commercial reuse; generated
  people avoid that but carry their own platform terms. Settle this before the library grows.
