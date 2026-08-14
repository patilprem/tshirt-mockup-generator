#!/usr/bin/env node
/**
 * Encode rendered mockup frames into a real video file.
 *
 * The first cut of this feature delivered its result as a folder of PNGs
 * flipped by a timer in the page. That is why it read as a GIF and not as
 * video: a frame flipper has no frame pacing (a timer fires when the main
 * thread is free, not on the display's cadence), the frames it can afford to
 * carry are few and large, and the size of them is what forced the rate down
 * to 6fps in the first place. One h264 file at the clip's own 24fps is both
 * smaller and smooth, and the browser paces it on the compositor.
 *
 * Rendered frames come in at analysis scale (1600px long edge, deliberately
 * above the source). They are encoded back down to the clip's native size, so
 * the extra resolution is spent as supersampling on the mask boundary rather
 * than shipped.
 *
 * Usage: node scratch/encode_video_mockup.cjs <framesDir> <out.mp4> [fps] [longEdge]
 *        framesDir holds out_%04d.png as written by render_video_mockup.cjs
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('ffmpeg-static');

(async () => {
  const [dirArg, outArg, fpsArg, edgeArg] = process.argv.slice(2);
  if (!dirArg || !outArg) {
    console.error('usage: node scratch/encode_video_mockup.cjs <framesDir> <out.mp4> [fps] [longEdge]');
    process.exit(1);
  }
  const dir = path.resolve(dirArg);
  const out = path.resolve(outArg);
  const fps = Number(fpsArg) || 24;
  const longEdge = Number(edgeArg) || 1280;
  const frames = fs.readdirSync(dir).filter(f => /^out_\d+\.png$/.test(f)).sort();
  if (!frames.length) { console.error(`no out_NNNN.png frames in ${dir}`); process.exit(1); }
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-framerate', String(fps),
    '-start_number', '0',
    '-i', path.join(dir, 'out_%04d.png'),
    // force_original_aspect_ratio with -2 on the free axis keeps both
    // dimensions even, which yuv420p requires and which an odd source height
    // would otherwise violate.
    '-vf', `scale=-2:${longEdge}:flags=lanczos`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    // 18 rather than the default 23: this is a product mockup whose whole
    // selling point is a clean garment edge, and h264 spends its error budget
    // exactly there — on the high-frequency boundary between shirt and
    // background. The file is still smaller than the frames it replaces by
    // two orders of magnitude.
    '-crf', '18',
    '-preset', 'slow',
    // Keyframe every second: the bench (and any product UI) loops this, and a
    // loop that has to decode from a distant keyframe stutters on restart.
    '-g', String(fps),
    '-movflags', '+faststart',
    '-an',
    out,
  ];
  execFileSync(ffmpeg, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  const srcKb = frames.reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0) / 1024;
  console.log(`${frames.length} frames @${fps}fps -> ${out} (${kb} KB, from ${(srcKb / 1024).toFixed(1)} MB of PNG)`);
})();
