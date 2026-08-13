#!/usr/bin/env node
/**
 * Resample decoded frames to the scale the analysis was tuned at.
 *
 * The mask analysis carries a lot of constants denominated in pixels — matte
 * ring widths, blur radii, how far a BFS may hop before it stops believing
 * itself. Those were all chosen against still templates, which the still
 * baker caps at 1600px on the long edge and which in practice arrive close
 * to it. A 720x1280 clip frame is a little over half that in area, so every
 * one of those constants silently covers ~1.5x more of the subject than it
 * was tuned to, and the machinery that resolves hair against fabric — the
 * part that needs the finest spatial discrimination there is — degrades
 * first: the boundary comes back stair-stepped in 2-4px blocks instead of
 * following individual strands.
 *
 * Resampling the frame up to the tuned scale before analysis costs an
 * upsample of an already-compressed frame, and buys back a mask computed
 * where its own constants mean what they were meant to mean. It is also
 * supersampling: the maps get measured at ~2x the delivery resolution and
 * downsampled after, so a boundary that lands hard at analysis scale still
 * arrives soft.
 *
 * Usage: node scratch/prep_video_frames.cjs <inDir> <outDir> [longEdge=1600]
 */
const { chromium } = (() => {
  try { return require('playwright'); } catch { return require('playwright-core'); }
})();
const path = require('path');
const fs = require('fs');

(async () => {
  const [inArg, outArg, edgeArg] = process.argv.slice(2);
  if (!inArg || !outArg) {
    console.error('usage: node scratch/prep_video_frames.cjs <inDir> <outDir> [longEdge=1600]');
    process.exit(1);
  }
  const inDir = path.resolve(inArg), outDir = path.resolve(outArg);
  const longEdge = Number(edgeArg) || 1600;
  const frames = fs.readdirSync(inDir).filter(f => /^f_\d+\.png$/.test(f)).sort();
  if (!frames.length) { console.error('no frames found'); process.exit(1); }
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });

  let dims = null;
  for (let i = 0; i < frames.length; i++) {
    const b64 = fs.readFileSync(path.join(inDir, frames[i])).toString('base64');
    const r = await page.evaluate(async ({ b64, longEdge }) => {
      const im = await new Promise((res, rej) => { const x = new Image(); x.onload = () => res(x); x.onerror = rej; x.src = 'data:image/png;base64,' + b64; });
      const k = longEdge / Math.max(im.width, im.height);
      const W = Math.round(im.width * k), H = Math.round(im.height * k);
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const cx = c.getContext('2d');
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(im, 0, 0, W, H);
      return { url: c.toDataURL('image/png'), W, H, srcW: im.width, srcH: im.height };
    }, { b64, longEdge });
    dims = r;
    fs.writeFileSync(path.join(outDir, frames[i]), Buffer.from(r.url.split(',')[1], 'base64'));
    process.stdout.write(`  ${i + 1}/${frames.length}\r`);
  }

  const clipPath = path.join(inDir, 'clip.json');
  if (fs.existsSync(clipPath)) {
    const clip = JSON.parse(fs.readFileSync(clipPath, 'utf8'));
    clip.width = dims.W; clip.height = dims.H;
    clip.analysisScale = dims.W / dims.srcW;
    fs.writeFileSync(path.join(outDir, 'clip.json'), JSON.stringify(clip, null, 2));
  }
  console.log(`\n${frames.length} frames -> ${dims.srcW}x${dims.srcH} to ${dims.W}x${dims.H} in ${outDir}`);
  await browser.close();
})();
