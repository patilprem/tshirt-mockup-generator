#!/usr/bin/env node
/**
 * Decode a source clip into individual frames, at the clip's own frame rate
 * and at the scale the mask analysis is tuned for.
 *
 * This used to decode through Chromium. The ffmpeg that ships with Playwright
 * is built --disable-everything and carries only mjpeg and vp8, so it could
 * decode neither the h264 mp4 nor the vp9 webm these clips arrive as, and the
 * open-source Chromium build has no h264 either — which meant every clip had
 * to be transcoded to webm by hand before it could enter the pipeline, and
 * then read out of a <video> element one presented frame at a time with
 * playbackRate dropped so the encode of each frame fit inside a frame
 * interval. A real ffmpeg (devDependency: ffmpeg-static) decodes the mp4
 * directly, in one pass, in a couple of seconds.
 *
 * It also removes the reason the first cut of this feature looked like a GIF.
 * Reading frames back through a <video> element is slow enough that it
 * invited subsampling — the clip was pulled at 12fps and delivered at 6 —
 * and 6fps of a walking model is a slideshow. The default here is now the
 * clip's OWN rate, and dropping frames is something you have to ask for.
 *
 * Frames are resampled up to `longEdge` on the way out, because the analysis
 * carries a lot of constants denominated in pixels — matte ring widths, blur
 * radii, how far a BFS may hop before it stops believing itself — and those
 * were chosen against still templates capped at 1600px. A 720x1280 clip frame
 * is a little over half that in area, so every one of those constants covers
 * ~1.5x more of the subject than it was tuned to, and the machinery that
 * resolves hair against fabric degrades first: the boundary comes back
 * stair-stepped in 2-4px blocks instead of following strands. Doing it here
 * with lanczos rather than in a second canvas pass keeps it to one decode and
 * one resample of an already-compressed frame.
 *
 * Usage: node scratch/extract_video_frames.cjs <clip> <outDir> [fps] [longEdge=1600]
 *        fps omitted or 0 = the clip's own rate
 */
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ffmpeg = require('ffmpeg-static');

// ffprobe is a separate binary and ffmpeg-static does not ship it, so the
// stream facts come from ffmpeg's own stderr banner. Fragile-looking, but the
// alternative is a second dependency for three numbers.
function probe(clip) {
  let out = '';
  try {
    execFileSync(ffmpeg, ['-hide_banner', '-i', clip], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    out = (e.stderr || '').toString();
  }
  const dur = out.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const dim = out.match(/Video:.*?,\s*(\d+)x(\d+)/);
  const fps = out.match(/([\d.]+)\s*fps/);
  if (!dim) throw new Error(`could not read a video stream from ${clip}\n${out}`);
  return {
    width: +dim[1], height: +dim[2],
    fps: fps ? +fps[1] : 0,
    duration: dur ? (+dur[1] * 3600 + +dur[2] * 60 + +dur[3]) : 0,
  };
}

// Generated clips arrive PADDED more often than not: the model renders at one
// aspect and letterboxes it into the container the request asked for. The clip
// this was written against is a 720x1088 image inside a 720x1280 file, with a
// 192px black bar across the top — and a mockup video cannot ship with a black
// band on it, so the bar has to come off before anything else looks at the
// frames. It also throws the mask off: a hard black edge is a strong gradient
// that the boundary machinery has no reason to expect.
//
// ffmpeg's cropdetect is exactly this tool. It is run over the opening seconds
// and the MODAL suggestion wins rather than the last one, because a dark scene
// can make a single frame propose a crop that no other frame agrees with. If
// the winner covers the whole frame there was no padding and nothing is done.
function detectCrop(clip, width, height) {
  // spawnSync, not execFileSync: cropdetect writes its findings to stderr and
  // then EXITS ZERO, so the catch-the-error trick probe() uses above reads
  // nothing at all here. That failure is silent — no crop is reported and the
  // padding ships — which is exactly the kind of no-op worth naming.
  const res = spawnSync(ffmpeg, [
    '-hide_banner', '-i', clip,
    '-vf', 'cropdetect=limit=24:round=2:reset=0',
    '-frames:v', '120', '-f', 'null', '-',
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const out = (res.stderr || '') + (res.stdout || '');
  if (!out) return null;
  const counts = new Map();
  for (const mt of out.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)) {
    const k = mt[0];
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  if (!counts.size) return null;
  const [bestK] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const m = bestK.match(/crop=(\d+):(\d+):(\d+):(\d+)/);
  const c = { w: +m[1], h: +m[2], x: +m[3], y: +m[4] };
  if (c.w >= width && c.h >= height) return null;
  // A crop that keeps less than half the frame is cropdetect misreading a dark
  // scene, not a letterbox. Refuse it rather than silently shipping a sliver.
  if (c.w * c.h < width * height * 0.5) return null;
  return c;
}

(async () => {
  const [clipArg, outArg, fpsArg, edgeArg] = process.argv.slice(2);
  if (!clipArg || !outArg) {
    console.error('usage: node scratch/extract_video_frames.cjs <clip> <outDir> [fps] [longEdge=1600]');
    process.exit(1);
  }
  const clip = path.resolve(clipArg);
  const outDir = path.resolve(outArg);
  const longEdge = Number(edgeArg) || 1600;
  const info = probe(clip);
  const wantFps = Number(fpsArg) || info.fps;

  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (/^f_\d+\.png$/.test(f)) fs.unlinkSync(path.join(outDir, f));

  const crop = detectCrop(clip, info.width, info.height);
  const srcW = crop ? crop.w : info.width, srcH = crop ? crop.h : info.height;
  const k = longEdge / Math.max(srcW, srcH);
  // Even dimensions: the frames are re-encoded to h264 at the end of the
  // pipeline and yuv420p cannot represent an odd one.
  const W = Math.round(srcW * k / 2) * 2, H = Math.round(srcH * k / 2) * 2;

  const filters = [];
  if (Math.abs(wantFps - info.fps) > 0.01) filters.push(`fps=${wantFps}`);
  if (crop) filters.push(`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`);
  filters.push(`scale=${W}:${H}:flags=lanczos`);

  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-i', clip,
    '-vf', filters.join(','),
    '-vsync', '0',
    // -start_number 0 so the file index IS the frame index; every later stage
    // indexes frames by number and an off-by-one here is silent.
    '-start_number', '0',
    path.join(outDir, 'f_%04d.png'),
  ], { stdio: ['ignore', 'inherit', 'inherit'] });

  const written = fs.readdirSync(outDir).filter(f => /^f_\d+\.png$/.test(f)).length;
  fs.writeFileSync(path.join(outDir, 'clip.json'), JSON.stringify({
    source: path.basename(clip),
    width: W, height: H,
    srcWidth: srcW, srcHeight: srcH,
    containerWidth: info.width, containerHeight: info.height,
    letterboxCrop: crop || null,
    analysisScale: +(W / srcW).toFixed(4),
    duration: info.duration,
    fps: wantFps,
    frames: written,
  }, null, 2));
  console.log(`${path.basename(clip)}: ${info.width}x${info.height} @${info.fps}fps, ${info.duration.toFixed(2)}s`);
  if (crop) console.log(`  letterbox removed: ${crop.w}x${crop.h}+${crop.x}+${crop.y} (${(100 * (1 - (crop.w * crop.h) / (info.width * info.height))).toFixed(0)}% of the container was padding)`);
  console.log(`  -> ${written} frames at ${W}x${H} @${wantFps}fps in ${outDir}`);
})();
