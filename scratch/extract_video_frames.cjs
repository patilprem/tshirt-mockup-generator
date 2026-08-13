#!/usr/bin/env node
/**
 * Decode a source clip into individual frames.
 *
 * The ffmpeg that ships with playwright is built --disable-everything and
 * only carries mjpeg/vp8; it can decode neither the h264 mp4 nor the vp9
 * webm these clips arrive as. Chromium decodes vp9 (h264 is absent from the
 * open-source build, so clips must reach this script as webm), so the frames
 * come out of a <video> element.
 *
 * Frames are captured during PLAYBACK rather than by seeking. Seeking a
 * data: URL video in headless chromium costs about a minute a frame: nothing
 * is being composited, so the presentation callback a correct grab has to
 * wait on only arrives when something else forces a repaint. Playing the
 * clip presents frames on a steady cadence and requestVideoFrameCallback
 * fires per presented frame, which is also exactly the signal that says "a
 * new frame is up, read it now". playbackRate is dropped so that encoding a
 * frame comfortably fits inside one frame interval and none are skipped.
 *
 * Usage: node scratch/extract_video_frames.cjs <clip.webm> <outDir> [fps]
 */
// playwright proper is the repo dependency, but a bare checkout without an
// npm install still has playwright-core available through NODE_PATH; either
// exposes the same chromium launcher this needs.
const { chromium } = (() => {
  try { return require('playwright'); } catch { return require('playwright-core'); }
})();
const path = require('path');
const fs = require('fs');

const MIME = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
const RATE = 0.25;

(async () => {
  const [clipArg, outArg, fpsArg] = process.argv.slice(2);
  if (!clipArg || !outArg) {
    console.error('usage: node scratch/extract_video_frames.cjs <clip.webm> <outDir> [fps]');
    process.exit(1);
  }
  const clip = path.resolve(clipArg);
  const outDir = path.resolve(outArg);
  const wantFps = Number(fpsArg) || 0; // 0 = keep every presented frame
  const mime = MIME[path.extname(clip).toLowerCase()];
  if (!mime) { console.error(`unsupported clip type: ${clip}`); process.exit(1); }

  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  page.on('console', m => { if (m.type() === 'error') console.error('  page:', m.text()); });

  // Frames stream out one at a time. Holding 145 full-size PNGs in page
  // memory to hand back in one array is hundreds of megabytes for no reason.
  let written = 0;
  await page.exposeBinding('__emitFrame', async (_src, { index, dataUrl }) => {
    const file = path.join(outDir, `f_${String(index).padStart(4, '0')}.png`);
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    written++;
    process.stdout.write(`  frame ${written}\r`);
  });

  const b64 = fs.readFileSync(clip).toString('base64');
  const info = await page.evaluate(async ({ b64, mime, wantFps, RATE }) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.src = 'data:' + mime + ';base64,' + b64;
    document.body.appendChild(v);
    await new Promise((res, rej) => {
      v.onloadeddata = res;
      v.onerror = () => rej(new Error('video failed to decode — is it vp8/vp9 webm?'));
    });
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!v.requestVideoFrameCallback) throw new Error('requestVideoFrameCallback unavailable');

    const step = wantFps ? 1 / wantFps : 0;
    let index = 0, nextT = 0, kept = 0;
    v.playbackRate = RATE;
    await new Promise(resolve => {
      const onFrame = async (_now, meta) => {
        const t = meta.mediaTime;
        // Subsampling is decided by media time, not by counting presented
        // frames: a dropped or repeated presentation would otherwise slide
        // every later frame's timestamp.
        if (!step || t + 1e-4 >= nextT) {
          if (step) nextT += step;
          ctx.drawImage(v, 0, 0);
          await window.__emitFrame({ index: index++, dataUrl: c.toDataURL('image/png') });
          kept++;
        }
        if (v.ended) { resolve(); return; }
        v.requestVideoFrameCallback(onFrame);
      };
      v.requestVideoFrameCallback(onFrame);
      v.onended = () => resolve();
      v.play();
    });
    return { w: v.videoWidth, h: v.videoHeight, duration: v.duration, kept };
  }, { b64, mime, wantFps, RATE });

  console.log(`\n${path.basename(clip)}: ${info.w}x${info.h}, ${info.duration.toFixed(2)}s -> ${written} frames`);
  fs.writeFileSync(path.join(outDir, 'clip.json'), JSON.stringify({
    source: path.basename(clip), width: info.w, height: info.h,
    duration: info.duration, fps: wantFps || null, frames: written,
  }, null, 2));
  await browser.close();
})();
