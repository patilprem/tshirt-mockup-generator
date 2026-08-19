# Video mockup tooling

Offline studio tooling for the plate architecture described in
[../../VIDEO-MOCKUP-PLAN.md](../../VIDEO-MOCKUP-PLAN.md). Not shipped to the browser — this is
the bake side, the equivalent of `scratch/calibrate_print_areas.cjs` for still templates.

Python rather than `.cjs` like the rest of `scratch/`, because the optical-flow tracking has no
practical Node equivalent. The runtime renderer that ships to users is JS/canvas and reuses
`src/scripts/onmodel-engine.js`.

## Setup

```sh
pip install opencv-python-headless numpy    # plus ffmpeg on PATH
```

## Bake a plate

```sh
python3 scratch/video/build_plate.py plate.mp4 \
    --out scratch/video/plates/park-f \
    --print-rect 776 904 168 168 \
    --seed-rect 180 780 830 1050 \
    --key-hue 145
```

`--print-rect` is the print area on frame 0 in plate pixels. `--seed-rect` limits where trackers
are seeded; omit it to seed from the chroma-keyed garment. `--key-hue` is the OpenCV hue (0–179)
of the blank — 145 is the violet blank the still pipeline already uses.

The bake refuses a clip that leaves fewer than 120 trackers alive end to end. That gate is the
quality control on generated plates: treat a rejection as "generate another clip", not as
something to tune around.

## Render a mockup

```sh
python3 scratch/video/render_mockup.py scratch/video/plates/park-f design.png \
    --color '#1c2a5c' --out mockup.mp4
```

Omit `--color` to keep the plate's own garment colour.

## Status

Both scripts have been run end to end on a 201-frame 1080x1920 clip: ~74 s to bake, ~95 s to
render, 862 trackers surviving the full clip, no visible print drift. Plate colour, fold shading
and silhouette masking all hold. What is not built yet is the browser-side renderer and the
plate library itself.
