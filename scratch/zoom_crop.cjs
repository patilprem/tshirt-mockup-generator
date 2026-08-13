#!/usr/bin/env node
/**
 * Magnify a region of an image with nearest-neighbour sampling, so mask
 * artefacts are inspected as the pixels they actually are rather than as
 * whatever a smooth resampler makes of them.
 *
 * Usage: node scratch/zoom_crop.cjs <img> <x> <y> <w> <h> <scale> <out.png>
 */
const { chromium } = (() => {
  try { return require('playwright'); } catch { return require('playwright-core'); }
})();
const fs = require('fs');
const path = require('path');

(async () => {
  const [img, x, y, w, h, scale, out] = process.argv.slice(2);
  if (!out) { console.error('usage: node scratch/zoom_crop.cjs <img> <x> <y> <w> <h> <scale> <out.png>'); process.exit(1); }
  const b64 = fs.readFileSync(path.resolve(img)).toString('base64');
  const ext = path.extname(img).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const url = await page.evaluate(async ({ b64, ext, x, y, w, h, s }) => {
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:' + ext + ';base64,' + b64; });
    const c = document.createElement('canvas');
    c.width = w * s; c.height = h * s;
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = false;
    cx.drawImage(im, x, y, w, h, 0, 0, w * s, h * s);
    return c.toDataURL('image/png');
  }, { b64, ext, x: +x, y: +y, w: +w, h: +h, s: +scale });
  fs.writeFileSync(path.resolve(out), Buffer.from(url.split(',')[1], 'base64'));
  console.log(`wrote ${out}`);
  await browser.close();
})();
