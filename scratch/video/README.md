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

## Screen a batch of candidates

Generated plates are mostly rejects, and baking is far too slow to use as the filter. Screen
first:

```sh
python3 scratch/video/screen_plates.py candidates/*.mp4
```

Seven gates, a few seconds per clip, PASS/FAIL with the failing metric named. Prompts and the
meaning of each rejection are in [FLOW-PLATE-PROMPTS.md](FLOW-PLATE-PROMPTS.md).

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

## Pack a plate for the browser

```sh
python3 scratch/video/pack_plate.py scratch/video/plates/street-01
```

A baked plate is lossless PNGs — 220 MB for six seconds, fine for the studio and
unshippable. Packing gets it to a few megabytes: the garment footage and the matte and
shade layers as H.264, the mesh quantised to 1/16 px and gzipped. The despill has to
happen at bake time rather than here, because 4:2:0 chroma subsampling smears the
blank's colour across the silhouette and no render-time correction recovers it.

## Render a mockup

```sh
python3 scratch/video/render_mockup.py scratch/video/plates/park-f design.png \
    --color '#1c2a5c' --out mockup.mp4
```

Omit `--color` to keep the plate's own garment colour.

## Status

Run end to end on two clips. A filmed 201-frame 1080x1920 reference: ~74 s to bake, ~95 s to
render, 862 corner trackers surviving. A generated 144-frame 720x1280 Flow clip: 79 corners —
below the gate — falling back to 554 dense trackers, ~39 s to bake, ~29 s to render. Both hold
their print with no visible drift, and recolour, fold shading, despill and silhouette masking
all work.

What is not built yet is the browser-side renderer and the plate library itself.
