# Next: canvas-size presets for on-model

Agreed spec, not yet implemented. Written down at the end of a session
rather than started half-finished.

## What

Let the canvas-size presets apply in on-model mode by CROPPING the template
photo. Not zooming — the templates are already capped at 1600px, so scaling
past the source pixels would only soften the print.

ONE mechanism. Every preset crops. No padding, no special case.

## Presets

Templates are 1066x1600 (2:3). Each preset is a crop of that:

| preset      | crop from 1066x1600 | keeps           |
|-------------|---------------------|-----------------|
| 4:5         | 1066x1332           | 83% of height   |
| 9:16        | 900x1600            | 84% of width    |
| 1:1         | 1066x1066           | 67% of height   |
| 4:3 (Etsy)  | 1066x800            | 50% of height   |

All four ship, including 4:3 — it is the Etsy Listing preset
(`exportShort: 2025`, exports 2700x2025), the last size to give up on a
t-shirt mockup tool.

## Where to centre — decided

Centre the crop on the print, clamped only so the rect stays inside the
image. Nothing else.

**The head being cropped is expected, not a defect.** Two earlier positions
were both wrong and are recorded so they are not re-argued:

1. "Drop 4:3, it produces a torso" — a torso is what an Etsy listing image
   usually is.
2. "Clamp vertically to keep the head in frame, the model is half the value"
   — reference listings supplied by the owner are tight torso crops, one with
   no face at all. On a listing the design is the product. Centre on the
   print and let the frame fall where it falls.

## Touch points

1. `setMockupStyle` — stop hiding `#canvas-size-section` on-model. All four
   presets stay visible; nothing to special-case.
2. Crop rect helper: from the active template's `quad` centre and the target
   aspect, clamped to the image bounds.
3. Fold the crop offset into `onModelView.ox/oy`. That already carries a
   translation, so handles, hit-testing and the pointer transform come along
   for free — do NOT add a second offset anywhere.
4. `applyCanvasSizing` sizes the canvas to the crop; the export path in
   `runDownload` must use the same rect, or the download will not match the
   screen. That mismatch is exactly the bug fixed in #19 (wood panels beside
   the model), so it is worth a test.

## Watch out for

- `drawOnModelScene` clears any letterbox margin rather than painting it.
  With a crop there should be no margin at all; if one appears the crop rect
  is wrong.
- 4:3 keeps only half the height, so the crop rect will often clamp against
  the top or bottom of the image. Clamping must move the rect, not shrink it,
  or the output aspect will be wrong.
- The QA gates and the builder are untouched by this — it is a render-time
  crop, not a template change. No rebuild needed.
