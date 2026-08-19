# Flow plate generation prompts

Prompts for generating the **blank-garment video plates** the mockup pipeline prints onto. Same
role for video that `scratch/BACK-VIEW-PROMPTS.md` plays for flat-lays, and the constraints come
from the same place: the downstream pipeline, not taste.

Never generate a mockup. Generate a blank. The seller's artwork is composited afterwards by
`render_mockup.py` and must never pass through a video model — diffusion re-synthesises every
pixel every frame, which melts typography, and typography is most of what print-on-demand sells.

## Why the constraints are what they are

- **Saturated violet or magenta blank, never white.** `garment_matte()` in `build_plate.py` keys
  the garment on a hue window. Hue is stable frame to frame where a learned mask crawls, and it
  separates cleanly from skin, denim, foliage and sky. It also matches `violetBase` in
  `public/assets/on-model/templates.json`, so the still and video pipelines recolour
  identically, and it leaves maximum headroom to relight into any garment colour.
- **No print, logo, text, brand mark, neck label, pocket, seam tape or contrast trim.** Anything
  on the blank is permanent, sits inside the print area, and no recolour removes it.
- **Visible fabric folds and directional light.** `shade_layer()` derives the print's shading
  from the garment's own luminance. A garment lit perfectly flat carries no fold information, so
  the print sits on the fabric like a sticker however well it tracks.
- **No blown highlights, no crushed shadows.** The shade layer is a ratio; clipped pixels carry
  nothing recoverable.
- **Chest unobstructed and facing camera for most of the clip.** Hair, hands and crossed arms
  over the chest cost trackers exactly where the mesh needs them.
- **Slow continuous motion, one shot, no cuts.** A cut resets every track. Whip pans and heavy
  motion blur destroy the features the tracker needs.
- **Matte cotton, not satin.** Strong specularity breaks the multiply-shading assumption.

## Shared style block

Append to every prompt below, kept identical so every plate keys and relights consistently.

> She wears a plain, completely blank saturated violet cotton t-shirt with absolutely no print,
> no logo, no text, no graphic, no brand mark, no chest pocket, no neck label and no contrast
> trim of any kind. Matte cotton with natural soft fabric folds and gentle directional daylight
> so the folds are clearly visible; no blown-out highlights and no crushed black shadows. The
> shirt is fully in frame from shoulders to hem, the chest faces camera and stays unobstructed
> by hands, hair or crossed arms. One single continuous shot, no cuts, slow natural motion,
> steady camera, sharp focus, shot on a full-frame camera with an 85mm lens. Vertical 9:16.

## Archetypes

Ten plates is enough to launch. Generate each in batches and keep what survives screening.

1. **Street walk.** *A young woman walking slowly toward the camera along a sunlit city
   sidewalk, shopfronts and traffic softly blurred behind her, relaxed natural stride.*
   — the format that verified this pipeline end to end.
2. **Laughing turn.** *A woman standing in a park, turning her head toward the camera and
   laughing naturally, hair moving slightly in the breeze.*
3. **Café sit.** *A woman sitting at an outdoor café table, leaning back slightly and smiling at
   the camera, warm afternoon light.*
4. **Mirror pose.** *A woman standing in front of a full-length mirror in a bright minimal room,
   shifting her weight and adjusting her posture.*
5. **Rooftop breeze.** *A woman standing on a rooftop at golden hour, city skyline behind her,
   turning slowly toward the camera.*
6. **Studio turn.** *A woman on a seamless light grey studio backdrop, turning slowly from
   three-quarter to face camera under soft key light.*
7. **Doorway lean.** *A woman leaning against a painted brick doorway, arms relaxed at her
   sides, smiling and shifting her weight.*
8. **Male street walk.** *A young man walking slowly toward the camera along a sunlit city
   sidewalk, relaxed natural stride.*
9. **Male studio turn.** *A man on a seamless light grey studio backdrop, turning slowly toward
   camera under soft key light, arms relaxed.*
10. **Group of two.** *Two friends standing side by side on a sunny street, both facing camera,
    laughing and shifting naturally.* — both blanks the same violet; bake one plate per person.

## Workflow

```sh
# 1. screen the batch - seconds per clip, names the failing gate
python3 scratch/video/screen_plates.py candidates/*.mp4

# 2. bake the survivors
python3 scratch/video/build_plate.py candidates/street-01.mp4 \
    --out scratch/video/plates/street-01 --print-rect 235 545 260 280 --key-hue 157

# 3. render a test design and judge it as a shopper would
python3 scratch/video/render_mockup.py scratch/video/plates/street-01 \
    scratch/video/test-design.png --color '#f0efec' --out test.mp4
```

`--print-rect` is the print area on frame 0 in plate pixels. A centred 11in print on a 20in
chest is roughly 55% of the garment's width, starting about 3in below the collar.

## What rejection looks like

- `boil` over 1.5 — fabric shimmering rather than moving. Regenerate; no setting fixes it.
- `survival` under 0.35 — too smooth or too fast. Ask for more visible folds and slower motion.
- `occlusion` over 0.25 — arms or hair across the chest. Re-prompt the pose.
- `hue_drift` over 4 — the garment changes colour through the clip. Regenerate.
- `matte_cv` over 0.18 — the silhouette is morphing; the tee is growing details. Regenerate.
