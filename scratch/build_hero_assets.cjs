#!/usr/bin/env node
/**
 * Build the homepage hero's own copies of the assets it draws.
 *
 * The hero is a shop window at 452 CSS px. The editor is the product, and
 * exports at up to 2160px. They were sharing one set of files, sized for the
 * editor, which meant the homepage paid export resolution for a thumbnail:
 * 4.4MB to open flat lay, and 1.4MB of on-model template and design on a cold
 * visit before anyone had clicked anything.
 *
 * So the hero gets variants and the editor keeps the originals. That direction
 * is the whole rule here — nothing this script emits is ever read by an export
 * path, so no amount of compression chosen below can degrade a file a user
 * actually downloads.
 *
 * Three treatments, by what the file MEANS:
 *
 *   pictures  (props, wood, garments, the design, the model photograph)
 *             lossy WebP, and for the flat-lay set also resized to twice the
 *             size the hero paints them at, which is where most of the saving
 *             is: a 330-unit prop is ~150 CSS px on a 452px frame, and it was
 *             arriving as an 825px PNG.
 *
 *   data      (the on-model weight map) LOSSLESS WebP, no resize. R/G/B are
 *             three unrelated masks the engine reads exact byte values out of,
 *             not colour channels — lossy compression there is not a softer
 *             picture, it is wrong numbers, and it shows up as colour blotching
 *             in the relight. The script ASSERTS byte-equality and fails if a
 *             single sample moved.
 *
 *   untouched (the on-model shade map) already a small JPEG, and lossless WebP
 *             of it comes out twice the size. Left alone rather than made worse
 *             for the sake of consistency.
 *
 * Run: node scratch/build_hero_assets.cjs
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public', 'assets');
const OUT = path.join(PUB, 'hero');

// The hero's frame is 452 CSS px wide and the artboard is 1000 units, so one
// artboard unit is 0.452 px. Everything is generated at 2x for retina.
const UNIT_PX = 0.452;
const DPR = 2;
const heroPx = (units) => Math.round(units * UNIT_PX * DPR);

// Flat-lay pictures: source -> the artboard units the hero paints it across.
// The prop numbers are the staged sizes in src/scripts/hero-studio.js; the
// garments and the backdrop cover the whole 1000-unit artboard.
const FLAT = [
  ['props/prop_plant.png', 200],
  ['props/prop_shoes.png', 330],
  ['props/prop_hat.png', 330],
  ['wood_white.png', 1000],
  ['processed/tshirt_flatlay.png', 1000],
  ['processed/tshirt_longsleeve.png', 1000],
  ['processed/tshirt_hoodie.png', 1000],
  ['processed/tshirt_tanktop.png', 1000],
];

// The design the hero starts with. Painted at ~235 CSS px, shipped at 1024².
const DESIGN = ['designs/cat.png', 520];

// The on-model templates the hero's picker offers.
const TEMPLATES = ['gallery-f', 'street-m', 'miami-f', 'park-m'];

// The LCP element: the static poster shown until the canvas has a frame.
const POSTER = 'gallery/onmodel_gallery-f.jpg';

const kb = (n) => (n / 1024).toFixed(0).padStart(6) + 'KB';
let totalBefore = 0;
let totalAfter = 0;

function record(label, before, after, note = '') {
  totalBefore += before;
  totalAfter += after;
  const pct = before ? Math.round((1 - after / before) * 100) : 0;
  console.log(`  ${label.padEnd(34)} ${kb(before)} -> ${kb(after)}  ${String(pct).padStart(3)}%  ${note}`);
}

async function picture(rel, units, outName) {
  const src = path.join(PUB, rel);
  const before = fs.statSync(src).size;
  const meta = await sharp(src).metadata();
  const want = heroPx(units);
  let img = sharp(src);
  // Never upscale: if the source is already smaller than the hero needs, the
  // resize would only invent pixels and inflate the file.
  if (want < meta.width) img = img.resize(want);
  const buf = await img.webp({ quality: 82, alphaQuality: 90, effort: 6 }).toBuffer();
  const dst = path.join(OUT, outName);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, buf);
  record(outName, before, buf.length, `${meta.width}px -> ${Math.min(want, meta.width)}px`);
}

// Lossless, full resolution, and verified sample-for-sample against the source.
// This is the map whose bytes ARE the algorithm's inputs.
async function dataMap(rel, outName) {
  const src = path.join(PUB, rel);
  const before = fs.statSync(src).size;
  const buf = await sharp(src).webp({ lossless: true, effort: 6 }).toBuffer();
  const dst = path.join(OUT, outName);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, buf);

  const a = await sharp(src).raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
    throw new Error(`${outName}: dimensions changed, ${a.info.width}x${a.info.height} vs ${b.info.width}x${b.info.height}`);
  }
  // Compare only the channels the engine actually reads (R/G/B); a source
  // without an alpha channel and a WebP with one would otherwise "differ"
  // on a channel nothing looks at.
  const ca = a.info.channels, cb = b.info.channels;
  let worst = 0;
  for (let i = 0, j = 0; i < a.data.length; i += ca, j += cb) {
    for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(a.data[i + c] - b.data[j + c]));
  }
  if (worst !== 0) {
    throw new Error(`${outName}: NOT byte-exact, worst channel delta ${worst} — the relight reads these values directly, refusing to ship it`);
  }
  record(outName, before, buf.length, 'lossless, verified byte-exact');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('\nflat lay — resized to 2x the size the hero paints them at');
  for (const [rel, units] of FLAT) {
    await picture(rel, units, path.basename(rel).replace(/\.(png|jpe?g)$/, '.webp'));
  }

  console.log('\ndesign');
  await picture(DESIGN[0], DESIGN[1], path.basename(DESIGN[0]).replace(/\.png$/, '.webp'));

  console.log('\nposter — the LCP element');
  await picture(POSTER, 1000, 'poster-gallery-f.webp');

  console.log('\non model — photograph lossy, weight map lossless and verified');
  for (const id of TEMPLATES) {
    const photo = `on-model/${id}-photo.jpg`;
    const weight = `on-model/${id}-weight.png`;
    if (!fs.existsSync(path.join(PUB, photo))) {
      console.log(`  (skipping ${id}: no source)`);
      continue;
    }
    // Full resolution: the hero maps pointer events through the template's own
    // pixel geometry, so a resized photo would move the print quad under it.
    await picture(photo, 1e9, `onmodel/${id}-photo.webp`);
    await dataMap(weight, `onmodel/${id}-weight.webp`);
  }

  console.log('\n' + '-'.repeat(78));
  record('TOTAL', totalBefore, totalAfter);
  console.log('\nShade maps are deliberately not converted: already small JPEGs, and');
  console.log('lossless WebP of them comes out roughly twice the size.\n');
})();
