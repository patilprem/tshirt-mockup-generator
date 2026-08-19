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

**Screen the batch** — `scratch/video/screen_plates.py`

Point it at a directory of fresh generations. A few seconds per clip, seven gates, PASS/FAIL
with the failing metric named. It exists because baking costs ~40-75 s per clip and the batch
is mostly rejects. The gate that matters most is **boil** — the signature artifact of video
diffusion, where fabric shimmers and re-forms rather than moving. Trackers stay alive through
boil, so survival counts look healthy while the mesh jitters. Measuring temporal *jerk* rather
than speed separates the two: a walking model has high displacement and low jerk, a boiling one
has the reverse.

**Bake once per plate** — `scratch/video/build_plate.py`

1. Track the garment. Two paths, because generated and filmed plates fail differently:
   forward-backward validated Lucas-Kanade where the fabric has corners, dense DIS optical flow
   where it does not. `--tracker auto` tries corners first and falls back.
2. Fit one RANSAC affine per frame across the whole tracker cloud, then blend back a damped
   fraction of a moving-least-squares local fit (`--bend`, default 0.35).
3. Chroma-key the garment matte per frame.
4. Extract illumination as a ratio against the garment's own low-pass, which cancels the base
   colour of the blank so one layer drives every garment colour.

Step 2 is the one that is easy to get wrong. Advecting mesh vertices straight through per-frame
flow lets every vertex accumulate its own drift, and the errors are *differential*, not common —
so they do not cancel, they shear. Measured at 0.33 px median round-trip error per hop, the
free-running mesh still tore the artwork into illegible fragments inside a hundred frames. The
global affine is a consensus over hundreds of trackers, so that noise averages away. It also
matches the reference clips, whose prints deform close to affine with a slight bend rather than
as freely deforming sheets.

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

Two clips, both end to end, on CPU with no GPU. A filmed Placeit reference (1080x1920, 201
frames) and a generated Flow clip (720x1280, 144 frames, magenta blank, street walk):

| Quantity | Filmed plate | Generated plate |
|---|---|---|
| Sparse corner trackers surviving the clip | 862 of 1470 | **79 — below the gate** |
| Dense virtual trackers surviving the clip | n/a | 554 |
| Screening time | ~7 s | ~7 s |
| Bake time | ~74 s | ~39 s |
| Render time per seller design | ~95 s | ~29 s |
| Print stability | no drift, swim or edge crawl | same, after affine regularisation |

Three things were wrong on the first attempt, and none of them were the geometry:

1. **Resampling.** The artwork was undersampled before warping, so edges read as jagged
   clip-art. Fixed by mipping to ~2.5x on-screen size with area averaging.
2. **Tracker choice.** Generated cotton is smooth — video models render fabric as broad soft
   gradients — so corner detection found 79 usable points where filmed cotton gave 862. Fixed
   by the dense fallback.
3. **Regularisation.** See above. This is the failure that looks like the whole approach is
   broken, and is actually four lines of consensus fitting.

## Where Grok and Flow fit

They generate **plates**, never mockups. The plate library is generated end to end; no camera is
involved at any point.

- **Flow / Veo** — the blank-garment clips. This is safe generative work: there is no fine
  detail to preserve, so the typography failure mode never arises. Target 5–8 s, one continuous
  shot, the highest resolution the model will give.
- **Grok** — scene and pose ideation, and reference stills to seed a clip.

Copy-paste prompts per archetype are in
[scratch/video/FLOW-PLATE-PROMPTS.md](scratch/video/FLOW-PLATE-PROMPTS.md).

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

Not every generation will pass, and that is the design. Screen the batch, bake the survivors,
keep what looks filmed. `build_plate.py` rejects a clip that leaves fewer than 120 trackers even
on the dense path. Treat a rejection as "generate another", not as something to tune around.

Resolution is the one constraint worth watching: the tested Flow clip came out at 720x1280 where
the filmed references are 1080x1920. That is usable for social but it is the ceiling on export
quality, so take the largest output the model offers.

## Roadmap

1. **Prove the plate library.** Ten plates covering the formats that travel on TikTok: walking,
   laughing, mirror, café, street, flat-lay-to-body. Generate in batches, screen, bake the
   survivors, keep what reads as filmed.
2. **Port the renderer to the browser.** The maths is already framework-free canvas work in
   `onmodel-engine.js`; the mesh is a small typed array per frame and WebCodecs or
   MediaRecorder handles encoding. Keeps the "files never leave the browser" wedge intact,
   which is the entire positioning in PRODUCT-PLAN.
3. **Ship colour + design together.** The colour-cycle video is a native TikTok format and falls
   straight out of the relight path.
4. **Grow the library** once the first ten hold. Plate count is the moat; nothing else about
   this compounds.

## Risks

- **Plate supply is the real cost.** The compositor is solved; generating clips that survive the
  gates is the work. Budget for a low hit rate rather than for prompt-tuning to a high one.
- **Generated fabric is texture-poor.** It cost the sparse tracker outright, and the dense path
  is the mitigation rather than a cure — a plate with no fold detail at all also carries no
  usable shade layer, so the print will sit flat however well it tracks. Prefer generations with
  visible folds and directional light.
- **Browser render time.** ~95 s of CPU per clip is fine on a laptop and painful on a phone.
  Offer a lower-resolution preview and a full-resolution export.
- **Uncanny-valley plates.** A generated model that reads as AI undercuts a product whose pitch
  is realism. Judge plates on whether they pass as filmed, not on prompt adherence.
- **Likeness and licensing.** Generated people avoid model releases but carry the video model's
  own terms on commercial use. Settle this before the library grows.
