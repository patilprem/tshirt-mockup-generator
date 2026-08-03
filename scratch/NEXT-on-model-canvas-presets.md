# Next: canvas-size presets for on-model

Agreed spec, not yet implemented. Written down at the end of a session
rather than started half-finished.

## What

Let the canvas-size presets apply in on-model mode by CROPPING the template
photo. Not zooming — the templates are already capped at 1600px, so scaling
past the source pixels would only soften the print.

## Presets

Templates are 1066x1600 (2:3). Each preset is a crop of that:

| preset | crop        | keeps            |
|--------|-------------|------------------|
| 4:5    | 1066x1332   | 83% of height    |
| 9:16   | 900x1600    | 84% of width     |
| 1:1    | 1066x1066   | 67% of height    |
| 4:3    | —           | DROPPED on-model |

**4:3 is dropped for on-model.** Turning a portrait photo landscape throws
away half the frame; on a hips-up shot that leaves chest-to-waist with no
head. Hide it in on-model the way the whole section is hidden today, rather
than shipping a preset that produces a torso.

## Where to centre — decided

Centre the crop on the print horizontally, and **clamp vertically so the head
stays in frame**. The print then sits slightly below centre rather than dead
centre.

The alternative — print dead centre — was rejected: the print sits low on the
chest, so a 1066-tall window centred on a print at y~900 spans y 367..1433 and
cuts the face off. The model is half the value of an on-model mockup.

So: clamp the crop rect inside the image, and bias the top edge up far enough
to keep the head. Simplest rule that holds for any template is to clamp the
crop's top to 0 whenever centring on the print would push it below 0 — for a
1:1 crop that alone keeps the head, since the head is at the top of frame.

## Touch points

1. `setMockupStyle` — stop hiding `#canvas-size-section` on-model, and hide
   only the 4:3 button there.
2. Crop rect helper: from the active template's `quad` centre and the target
   aspect, clamped to the image.
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
- The QA gates and the builder are untouched by this — it is a render-time
  crop, not a template change. No rebuild needed.
