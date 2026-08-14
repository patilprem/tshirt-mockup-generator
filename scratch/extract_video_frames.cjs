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
const { execFileSync } = require('child_process');
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

  const k = longEdge / Math.max(info.width, info.height);
  // Even dimensions: the frames are re-encoded to h264 at the end of the
  // pipeline and yuv420p cannot represent an odd one.
  const W = Math.round(info.width * k / 2) * 2, H = Math.round(info.height * k / 2) * 2;

  const filters = [];
  if (Math.abs(wantFps - info.fps) > 0.01) filters.push(`fps=${wantFps}`);
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
    srcWidth: info.width, srcHeight: info.height,
    analysisScale: +(W / info.width).toFixed(4),
    duration: info.duration,
    fps: wantFps,
    frames: written,
  }, null, 2));
  console.log(`${path.basename(clip)}: ${info.width}x${info.height} @${info.fps}fps, ${info.duration.toFixed(2)}s`);
  console.log(`  -> ${written} frames at ${W}x${H} @${wantFps}fps in ${outDir}`);
})();
