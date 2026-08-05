#!/usr/bin/env node
/**
 * Build WebP copies of the homepage gallery strip.
 *
 * These files are the product's own output — the shop window for what the tool
 * makes — so they are the last place to be careless with quality. But they were
 * also 83% of the homepage's weight: thirteen 1024px JPEGs displayed in a
 * 320px marquee tile, which is 3.2x more pixels than any screen shows.
 *
 * One size, 768px, chosen to cover the widest real requirement rather than the
 * average one: 318 CSS px on desktop needs 636px at DPR 2, and 248 CSS px on a
 * phone needs 744px at DPR 3. 768 clears both. The originals stay on disk and
 * stay in the <img>, so the WebP is an upgrade a browser takes or leaves.
 *
 * Also emits the hero's picker tiles. Those draw the SAME photographs at 46 CSS
 * px, where even 768px is ~8x oversized, so they get their own 144px copies
 * under /assets/hero/tiles.
 *
 * Run: node scratch/build_gallery_assets.cjs   (npm run build:gallery-assets)
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const GALLERY = path.join(ROOT, 'public', 'assets', 'gallery');
const OUT = path.join(GALLERY, 'webp');
const TILES = path.join(ROOT, 'public', 'assets', 'hero', 'tiles');

// Widest real requirement: DPR 3 on a phone showing them at 248 CSS px.
const GALLERY_PX = 768;
// The hero's picker: 46 CSS px at DPR 3.
const TILE_PX = 144;
// The four templates the hero's picker offers.
const HERO_TILES = ['gallery-f', 'street-m', 'miami-f', 'park-m'];

const kb = (n) => (n / 1024).toFixed(0).padStart(6) + 'KB';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(TILES, { recursive: true });

  const files = fs.readdirSync(GALLERY)
    .filter((f) => /^(mockup_|onmodel_).*\.(jpe?g|png)$/i.test(f))
    .sort();

  let before = 0;
  let after = 0;
  console.log(`\ngallery strip -> ${GALLERY_PX}px WebP`);
  for (const f of files) {
    const src = path.join(GALLERY, f);
    const orig = fs.statSync(src).size;
    const meta = await sharp(src).metadata();
    let img = sharp(src);
    if (GALLERY_PX < meta.width) img = img.resize(GALLERY_PX);
    const buf = await img.webp({ quality: 82, effort: 6 }).toBuffer();
    fs.writeFileSync(path.join(OUT, f.replace(/\.(jpe?g|png)$/i, '.webp')), buf);
    before += orig;
    after += buf.length;
    console.log(`  ${f.padEnd(30)} ${kb(orig)} -> ${kb(buf.length)}  ${meta.width}px -> ${Math.min(GALLERY_PX, meta.width)}px`);
  }

  console.log(`\nhero picker tiles -> ${TILE_PX}px WebP`);
  let tBefore = 0;
  let tAfter = 0;
  for (const id of HERO_TILES) {
    const src = path.join(GALLERY, `onmodel_${id}.jpg`);
    if (!fs.existsSync(src)) { console.log(`  (skipping ${id}: no source)`); continue; }
    const orig = fs.statSync(src).size;
    const buf = await sharp(src).resize(TILE_PX).webp({ quality: 80, effort: 6 }).toBuffer();
    fs.writeFileSync(path.join(TILES, `${id}.webp`), buf);
    tBefore += orig;
    tAfter += buf.length;
    console.log(`  ${('onmodel_' + id + '.jpg').padEnd(30)} ${kb(orig)} -> ${kb(buf.length)}`);
  }

  console.log('\n' + '-'.repeat(72));
  console.log(`  gallery  ${kb(before)} -> ${kb(after)}   (-${Math.round(100 * (1 - after / before))}%)`);
  console.log(`  tiles    ${kb(tBefore)} -> ${kb(tAfter)}   (-${Math.round(100 * (1 - tAfter / tBefore))}%)`);
  console.log();
})();
