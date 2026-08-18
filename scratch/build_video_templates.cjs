#!/usr/bin/env node
/**
 * Precompute an on-model VIDEO template: the still pipeline, per frame.
 *
 * A clip is a sequence of the same problem the still baker already solves, so
 * it runs the same analysis (scratch/lib/onmodel-analyze.js) on every frame
 * and emits the same three maps per frame. What a clip adds is everything
 * that only exists once there is a time axis:
 *
 *   1. ONE calibration for the whole clip. The still baker derives the violet
 *      reference from the image in front of it; doing that per frame lets the
 *      reference chase the model's movement, and the garment's recoloured hue
 *      and brightness then breathe over the loop. The clip calibrates on its
 *      best-covered frame and passes that back into every frame.
 *
 *   2. A print quad PER FRAME, carried by a tracked torso frame. The quad is
 *      measured ONCE, on the calibration frame, by the same code the still
 *      baker uses — so a clip prints where a still would — and then moved
 *      through the clip by the similarity transform between that frame's
 *      torso and each later frame's. A single quad measured once and left
 *      alone is pinned to the canvas rather than the body: the model shifts,
 *      the print stays, and the mockup reads as a sticker on the lens.
 *
 *      Re-measuring the quad per frame, which is what this did first, is the
 *      opposite failure. Every number that quad is built from is a silhouette
 *      extent — topmost pixel, hem, widest row — so a swinging sleeve or a
 *      swaying hem changes the print's size and height even though the chest
 *      it sits on has not moved. That is the "unnatural tracking": the design
 *      breathing against fabric that is not breathing with it. The torso frame
 *      is built from the mask's mass instead (quantiles and moments, ~10^5
 *      pixels rather than ~10), and it carries a rotation, which an
 *      axis-aligned quad had no way to express.
 *
 *   3. Temporal smoothing of that transform — five scalars, not four corners.
 *      Position is smoothed harder than size, since the eye reads translation
 *      jitter first. Windows are specified in SECONDS and converted, so the
 *      same clip at 12 and 24fps gets the same amount of smoothing rather than
 *      twice as much.
 *
 * Emits, per frame: <id>-NNNN-photo.jpg, -weight.png, -shade.jpg, matching
 * the still template layout exactly so the runtime treats a frame as a
 * template. Plus <id>.json carrying the shared calibration and the per-frame
 * quads.
 *
 * Frames come from scratch/extract_video_frames.cjs, not from this script:
 * decoding is slow and worth doing once while the analysis is iterated on.
 *
 * Usage: node scratch/build_video_templates.cjs <framesDir> <id> [outDir]
 */
const { chromium } = (() => {
  try { return require('playwright'); } catch { return require('playwright-core'); }
})();
const path = require('path');
const fs = require('fs');

// Analysis runs at ANALYSIS_EDGE and the maps are emitted at OUT_EDGE. The gap
// between them is supersampling, and it exists because the boundary this
// machinery draws wanders: the 50% crossing moves in and out by a pixel from
// scanline to scanline, so a contour that should be a clean curve arrives as a
// staircase. Averaging back down turns the staircase into a slope — measured
// down the sleeve edge, rms boundary wander goes 1.68px to 0.89px — and unlike
// blurring the map it cannot move coverage off the fabric, because the mean
// over each output pixel is preserved exactly.
//
// It costs about 3x the analysis time per frame. Frames must actually BE at the
// analysis edge for any of this to happen; extract them with the same number.
const ANALYSIS_EDGE = 2560;
const OUT_EDGE = 1600;

// Smoothing windows in SECONDS, converted to frames against the clip's own
// rate. As frame counts these were 5 and 9, which meant the same clip pulled
// at 24fps instead of 12 got half the smoothing in time — the constants
// silently tracked the sampling rate rather than the motion.
//
// Position drifts are smoothed over a wider window than size: a print that
// swims sideways is obvious, a print whose scale wobbles half a pixel is not.
// Lean is smoothed hardest of the three. It is the noisiest measurement here
// (a ratio of second moments, where the numerator is small by construction on
// an upright body) and also the one whose error is most visible, since a
// rotation error grows with distance from the centre of the print.
const SMOOTH_POS_SEC = 0.42;
const SMOOTH_SIZE_SEC = 0.75;
const SMOOTH_LEAN_SEC = 1.0;

const oddFrames = (sec, fps) => Math.max(1, Math.round(sec * fps / 2) * 2 + 1);

function movingAverage(values, window) {
  const half = (window - 1) / 2;
  const out = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let sum = 0, n = 0;
    for (let j = i - half; j <= i + half; j++) {
      // Clamp at the ends rather than wrapping. These clips are not
      // guaranteed to loop seamlessly, and averaging the last frames with
      // the first would drag the print toward a pose that never happens.
      const k = Math.max(0, Math.min(values.length - 1, Math.round(j)));
      sum += values[k]; n++;
    }
    out[i] = sum / n;
  }
  return out;
}

(async () => {
  const [framesArg, idArg, outArg] = process.argv.slice(2);
  if (!framesArg || !idArg) {
    console.error('usage: node scratch/build_video_templates.cjs <framesDir> <id> [outDir]');
    process.exit(1);
  }
  const framesDir = path.resolve(framesArg);
  const id = idArg;
  const outDir = path.resolve(outArg || path.join(__dirname, '..', 'public', 'assets', 'on-model-video'));
  const clipInfo = JSON.parse(fs.readFileSync(path.join(framesDir, 'clip.json'), 'utf8'));
  const frames = fs.readdirSync(framesDir).filter(f => /^f_\d+\.png$/.test(f)).sort();
  if (!frames.length) { console.error('no frames found'); process.exit(1); }
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
  await page.addScriptTag({ path: path.join(__dirname, 'lib', 'onmodel-analyze.js') });

  const analyze = (b64, calib) => page.evaluate(
    args => window.__analyzeOnModel(args),
    { b64, srcMime: 'image/png', MAX_EDGE: ANALYSIS_EDGE, OUT_EDGE, dbgPx: [], calib },
  );
  const readFrame = i => fs.readFileSync(path.join(framesDir, frames[i])).toString('base64');

  // ---- calibrate once ----
  //
  // Not necessarily on frame 0. The first frame of a generated clip is often
  // the weakest one to measure: these clips tend to open on the model turning
  // into position, with the garment partly off-axis and its lit face small.
  // Calibration wants the frame showing the most fabric, so a few candidates
  // spread across the clip are analysed and the widest-coverage one wins.
  const probeIdx = [0, Math.floor(frames.length * 0.25), Math.floor(frames.length * 0.5), Math.floor(frames.length * 0.75)];
  let best = null;
  for (const i of probeIdx) {
    const r = await analyze(readFrame(i), null);
    const cover = r.bbox.w * r.bbox.h;
    process.stdout.write(`  probe frame ${i}: hue=${r.shirtHue} vRef=${r.vRef} cover=${cover}\n`);
    if (!best || cover > best.cover) best = { i, cover, r };
  }
  const calib = {
    shirtHue: best.r.shirtHue,
    vRef: best.r.vRef,
    violetBase: best.r.violetBase,
    ambientTint: best.r.ambientTint,
  };
  console.log(`calibrated on frame ${best.i}: hue=${calib.shirtHue} vRef=${calib.vRef} violetBase=[${calib.violetBase}]`);

  // ---- analyse every frame against that one calibration ----
  const per = [];
  for (let i = 0; i < frames.length; i++) {
    const r = await analyze(readFrame(i), calib);
    per.push(r);
    const w = ['photo', 'weight', 'shade'];
    const ext = { photo: 'jpg', weight: 'png', shade: 'jpg' };
    for (const k of w) {
      const file = path.join(outDir, `${id}-${String(i).padStart(4, '0')}-${k}.${ext[k]}`);
      fs.writeFileSync(file, Buffer.from(r[k].split(',')[1], 'base64'));
    }
    process.stdout.write(`  frame ${i + 1}/${frames.length} keyMiss=${r.qa.keyMiss} chroma=${r.qa.chromaPct}%\r`);
  }
  console.log('');

  // ---- carry the reference quad through the tracked torso frame ----
  if (per.some(r => !r.torso)) {
    console.error('some frames produced no torso measurement; cannot track');
    process.exit(1);
  }
  const fps = clipInfo.fps || 24;
  const round2 = v => +v.toFixed(2);

  const T = per.map(r => r.torso);
  // Position comes from the TRUNK CENTROID, and this is worth recording
  // because the obvious alternative is wrong and measures better against the
  // wrong yardstick.
  //
  // A print is registered from the shoulders in reality, so anchoring to the
  // shoulder line looks correct, and measured against the shoulder midpoint it
  // cut drift from 27.2px to 7px. That measurement is circular: anchor to a
  // landmark and the offset to that landmark is constant by construction.
  // Measured against what the eye actually judges — the print's centre against
  // the chest's own centre AT THE PRINT'S HEIGHT — the shoulder anchor was
  // three times worse, 23.9px of range against 8.1px. The shoulder span is
  // bounded by the sleeves, so it swings when an arm does, and in this clip the
  // model is carrying a mug. The trunk columns exclude the sleeves by
  // construction and the centroid averages ~10^5 pixels, so it stays put.
  const sCx = movingAverage(T.map(t => t.cx), oddFrames(SMOOTH_POS_SEC, fps));
  const sCy = movingAverage(T.map(t => t.cy), oddFrames(SMOOTH_POS_SEC, fps));
  const sW = movingAverage(T.map(t => t.w), oddFrames(SMOOTH_SIZE_SEC, fps));
  const sH = movingAverage(T.map(t => t.h), oddFrames(SMOOTH_SIZE_SEC, fps));
  const sLean = movingAverage(T.map(t => t.lean), oddFrames(SMOOTH_LEAN_SEC, fps));

  // The reference: the calibration frame's own quad and torso, both smoothed
  // values so the transform is the identity there rather than off by whatever
  // that frame's noise was.
  const ref = {
    quad: per[best.i].quad,
    cx: sCx[best.i], cy: sCy[best.i], w: sW[best.i], h: sH[best.i], lean: sLean[best.i],
  };

  // A point is taken into the reference torso's own axes, scaled along them —
  // width and height independently, because turning narrows a body without
  // shortening it — and put back down in the target frame's axes.
  function carry(pt, i) {
    const ux0 = [Math.cos(ref.lean), -Math.sin(ref.lean)];
    const uy0 = [Math.sin(ref.lean), Math.cos(ref.lean)];
    const dx = pt[0] - ref.cx, dy = pt[1] - ref.cy;
    const a = dx * ux0[0] + dy * ux0[1];
    const b = dx * uy0[0] + dy * uy0[1];
    const a2 = a * (sW[i] / ref.w), b2 = b * (sH[i] / ref.h);
    const ux = [Math.cos(sLean[i]), -Math.sin(sLean[i])];
    const uy = [Math.sin(sLean[i]), Math.cos(sLean[i])];
    return [
      round2(sCx[i] + a2 * ux[0] + b2 * uy[0]),
      round2(sCy[i] + a2 * ux[1] + b2 * uy[1]),
    ];
  }
  const quads = per.map((_, i) => ({
    tl: carry(ref.quad.tl, i), tr: carry(ref.quad.tr, i),
    br: carry(ref.quad.br, i), bl: carry(ref.quad.bl, i),
  }));

  // How far the print actually travels over the clip. If this is ~0 the
  // tracking is not doing anything and a static quad would have done, which
  // is the bug this whole stage exists to fix — so it is reported, not
  // assumed.
  //
  // Jitter is reported for BOTH estimators on the same frames, because the
  // claim being made is that mass beats extents, and a claim like that should
  // arrive with the losing number next to it. `oldRaw` is what the per-frame
  // silhouette quad measured; `raw` is the torso centroid. Both are
  // mean |frame-to-frame delta| of the print centre in x.
  const centreX = quads.map(q => (q.tl[0] + q.tr[0] + q.br[0] + q.bl[0]) / 4);
  const centreY = quads.map(q => (q.tl[1] + q.tr[1] + q.br[1] + q.bl[1]) / 4);
  const meanStep = a => a.reduce((s, v, i) => i ? s + Math.abs(v - a[i - 1]) : s, 0) / Math.max(1, a.length - 1);
  const oldCx = per.map(r => (r.quad.tl[0] + r.quad.tr[0]) / 2);
  // How far the print slides across the chest over the clip — measured the
  // way the eye judges it, against the chest's own centre AT THE PRINT'S
  // HEIGHT, not against whatever landmark the quad happens to be anchored to.
  // An anchor always looks perfect measured against itself; this cannot be
  // gamed by changing the anchor, which is the entire point of it.
  const anchorDrift = (() => {
    const off = quads.map((q, i) => {
      const t = per[i].torso;
      if (!t || !t.chestCx) return null;
      return (q.tl[0] + q.tr[0] + q.br[0] + q.bl[0]) / 4 - t.chestCx;
    }).filter(v => v != null);
    return off.length ? Math.max(...off) - Math.min(...off) : 0;
  })();
  const travel = Math.max(...centreX) - Math.min(...centreX);
  const travelY = Math.max(...centreY) - Math.min(...centreY);
  const jitterOldRaw = meanStep(oldCx);
  const jitterRaw = meanStep(T.map(t => t.cx));
  const jitterSm = meanStep(sCx);
  const leanDeg = sLean.map(v => v * 180 / Math.PI);

  const manifest = {
    id,
    width: per[0].W,
    height: per[0].H,
    frames: per.length,
    fps: clipInfo.fps || 12,
    duration: clipInfo.duration,
    source: clipInfo.source,
    calibratedOnFrame: best.i,
    shirtHue: calib.shirtHue,
    vRef: calib.vRef,
    violetBase: calib.violetBase,
    ambientTint: calib.ambientTint,
    relMax: per[0].relMax,
    frameFiles: per.map((_, i) => ({
      photo: `${id}-${String(i).padStart(4, '0')}-photo.jpg`,
      weight: `${id}-${String(i).padStart(4, '0')}-weight.png`,
      shade: `${id}-${String(i).padStart(4, '0')}-shade.jpg`,
    })),
    quads,
    bboxes: per.map(r => r.bbox),
    torso: per.map((r, i) => ({
      // cx/cy here are the ANCHOR the quads were carried by (the shoulder
      // line), not the trunk centroid, so a consumer reading this back gets
      // the frame the print is actually in.
      cx: round2(sCx[i]), cy: round2(sCy[i]),
      w: round2(sW[i]), h: round2(sH[i]), lean: +sLean[i].toFixed(5),
    })),
    referenceFrame: best.i,
    qa: {
      keyMissMax: Math.max(...per.map(r => r.qa.keyMiss)),
      chromaPctMax: Math.max(...per.map(r => r.qa.chromaPct)),
      deepShadowPctMax: Math.max(...per.map(r => r.qa.deepShadowPct)),
      printTravelPx: round2(travel),
      printTravelYpx: round2(travelY),
      quadJitterSilhouettePx: round2(jitterOldRaw),
      quadJitterRawPx: round2(jitterRaw),
      quadJitterSmoothedPx: round2(jitterSm),
      leanRangeDeg: round2(Math.max(...leanDeg) - Math.min(...leanDeg)),
      printDriftAcrossChestPx: round2(anchorDrift),
    },
  };
  fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify(manifest, null, 2));
  console.log(`\n${id}: ${per.length} frames -> ${outDir}`);
  console.log(`  print travel over clip: ${round2(travel)}px across, ${round2(travelY)}px down; lean range ${round2(Math.max(...leanDeg) - Math.min(...leanDeg))} deg`);
  console.log(`  centre jitter px/frame: silhouette ${round2(jitterOldRaw)} -> torso ${round2(jitterRaw)} -> smoothed ${round2(jitterSm)}`);
  console.log(`  print drift across the chest over the clip: ${round2(anchorDrift)}px`);
  console.log(`  worst keyMiss=${manifest.qa.keyMissMax} chroma=${manifest.qa.chromaPctMax}% deepShadow=${manifest.qa.deepShadowPctMax}%`);
  await browser.close();
})();
