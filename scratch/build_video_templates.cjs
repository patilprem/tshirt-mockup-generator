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
 *   2. A print quad PER FRAME, tracked from that frame's own garment core.
 *      This is what makes the design sit on the shirt and move with it. A
 *      single quad measured once is pinned to the canvas, not to the body:
 *      the model shifts, the print stays where it was, and the mockup reads
 *      as a sticker on the lens.
 *
 *   3. Temporal smoothing of that quad. Per-frame measurement jitters by a
 *      pixel or two as the core mask's edge flickers, and a print that
 *      trembles against fabric that doesn't looks worse than one that lags.
 *      Position is smoothed harder than size, since the eye reads translation
 *      jitter first.
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

const MAX_EDGE = 1600;

// Position drifts are smoothed over a wider window than width: a print that
// swims sideways is obvious, a print whose scale wobbles half a pixel is not.
const SMOOTH_POS = 5;
const SMOOTH_SIZE = 9;

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
    { b64, srcMime: 'image/png', MAX_EDGE, dbgPx: [], calib },
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

  // ---- smooth the tracked quad ----
  const cxTop = per.map(r => (r.quad.tl[0] + r.quad.tr[0]) / 2);
  const cxBot = per.map(r => (r.quad.bl[0] + r.quad.br[0]) / 2);
  const topY = per.map(r => r.quad.tl[1]);
  const botY = per.map(r => r.quad.bl[1]);
  const hwTop = per.map(r => (r.quad.tr[0] - r.quad.tl[0]) / 2);
  const hwBot = per.map(r => (r.quad.br[0] - r.quad.bl[0]) / 2);

  const sCxTop = movingAverage(cxTop, SMOOTH_POS);
  const sCxBot = movingAverage(cxBot, SMOOTH_POS);
  const sTopY = movingAverage(topY, SMOOTH_POS);
  const sBotY = movingAverage(botY, SMOOTH_POS);
  const sHwTop = movingAverage(hwTop, SMOOTH_SIZE);
  const sHwBot = movingAverage(hwBot, SMOOTH_SIZE);

  const round2 = v => +v.toFixed(2);
  const quads = per.map((_, i) => ({
    tl: [round2(sCxTop[i] - sHwTop[i]), round2(sTopY[i])],
    tr: [round2(sCxTop[i] + sHwTop[i]), round2(sTopY[i])],
    br: [round2(sCxBot[i] + sHwBot[i]), round2(sBotY[i])],
    bl: [round2(sCxBot[i] - sHwBot[i]), round2(sBotY[i])],
  }));

  // How far the print actually travels over the clip. If this is ~0 the
  // tracking is not doing anything and a static quad would have done, which
  // is the bug this whole stage exists to fix — so it is reported, not
  // assumed.
  const travel = Math.max(...cxTop) - Math.min(...cxTop);
  const jitterRaw = cxTop.reduce((a, v, i) => i ? a + Math.abs(v - cxTop[i - 1]) : a, 0) / Math.max(1, cxTop.length - 1);
  const jitterSm = sCxTop.reduce((a, v, i) => i ? a + Math.abs(v - sCxTop[i - 1]) : a, 0) / Math.max(1, sCxTop.length - 1);

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
    qa: {
      keyMissMax: Math.max(...per.map(r => r.qa.keyMiss)),
      chromaPctMax: Math.max(...per.map(r => r.qa.chromaPct)),
      deepShadowPctMax: Math.max(...per.map(r => r.qa.deepShadowPct)),
      printTravelPx: round2(travel),
      quadJitterRawPx: round2(jitterRaw),
      quadJitterSmoothedPx: round2(jitterSm),
    },
  };
  fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify(manifest, null, 2));
  console.log(`\n${id}: ${per.length} frames -> ${outDir}`);
  console.log(`  print travel over clip: ${round2(travel)}px  (jitter ${round2(jitterRaw)} -> ${round2(jitterSm)}px/frame after smoothing)`);
  console.log(`  worst keyMiss=${manifest.qa.keyMissMax} chroma=${manifest.qa.chromaPctMax}% deepShadow=${manifest.qa.deepShadowPctMax}%`);
  await browser.close();
})();
