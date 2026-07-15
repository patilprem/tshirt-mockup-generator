// Generate real batch-export mockups for the homepage showcase strip and the
// blog banner, by driving the built editor's batch feature end-to-end.
//
// Prereq: `npx astro build && npx astro preview --port 4322`
// Usage:  node scratch/generate_batch_showcase.cjs
//
// Outputs:
//   public/assets/batch/batch_crewneck_navy.jpg   (640×640 strip cards)
//   public/assets/batch/batch_hoodie_sand.jpg
//   public/assets/batch/batch_tank_white.jpg
//   public/assets/banner/blog_batch_export.jpg    (1200×630 blog banner)

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const JSZip = require('jszip');

const ROOT = path.join(__dirname, '..');
const BATCH_DIR = path.join(ROOT, 'public', 'assets', 'batch');
const BANNER_DIR = path.join(ROOT, 'public', 'assets', 'banner');

(async () => {
  fs.mkdirSync(BATCH_DIR, { recursive: true });
  const browser = await chromium
    .launch({ headless: true })
    .catch(() => chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' }));
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('PAGE EXCEPTION:', e.message));

  await page.goto('http://127.0.0.1:4322/editor', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Use the surf design — the most poster-like of the bundled artworks.
  // It isn't a preset thumb, so go through the normal upload path.
  await page.setInputFiles('#file-input', path.join(ROOT, 'public', 'assets', 'designs', 'surf.png'));
  await page.waitForTimeout(1200);

  // Batch: crewneck + hoodie + tanktop × navy + sand + white, center chest.
  await page.click('#batch-export-btn');
  await page.waitForSelector('#batch-modal', { state: 'visible' });
  for (const g of ['hoodie', 'tanktop']) await page.check(`#batch-garments input[value="${g}"]`);
  // Deselect the pre-checked current color (black), pick navy/sand/white.
  await page.click('#batch-colors label:has(input[value="#212121"])');
  for (const c of ['#1b2230', '#d2c6af', '#ffffff']) {
    await page.click(`#batch-colors label:has(input[value="${c}"])`);
  }
  await page.click('label:has(input[name="batch-placement"][value="center-chest"])');

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 180000 }),
    page.click('#batch-start-btn'),
  ]);
  const zipPath = path.join(BATCH_DIR, '_tmp.zip');
  await download.saveAs(zipPath);
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  console.log('batch produced:', Object.keys(zip.files).join(', '));

  const pngB64 = async (name) => (await zip.files[name].async('nodebuffer')).toString('base64');

  // Downscale helper (runs in the page: canvas → JPEG)
  const toJpeg = async (b64, w, h, quality) =>
    page.evaluate(async ({ b64, w, h, quality }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await new Promise((res) => (img.onload = res));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      return cv.toDataURL('image/jpeg', quality).split(',')[1];
    }, { b64, w, h, quality });

  // 1. Homepage strip cards (640×640 JPEG)
  const cards = [
    ['crewneck-tee-classic-navy-blue.png', 'batch_crewneck_navy.jpg'],
    ['hoodie-sand-beige.png', 'batch_hoodie_sand.jpg'],
    ['tank-top-classic-white.png', 'batch_tank_white.jpg'],
  ];
  for (const [src, out] of cards) {
    const jpeg = await toJpeg(await pngB64(src), 640, 640, 0.85);
    fs.writeFileSync(path.join(BATCH_DIR, out), Buffer.from(jpeg, 'base64'));
    console.log('wrote', out);
  }

  // 2. Blog banner (1200×630): fanned 3×3 grid of all nine variants
  const names = Object.keys(zip.files).sort();
  const b64s = [];
  for (const n of names) b64s.push(await pngB64(n));
  const bannerB64 = await page.evaluate(async ({ b64s }) => {
    const imgs = await Promise.all(b64s.map((b) => new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.src = 'data:image/png;base64,' + b;
    })));
    const W = 1200, H = 630;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    // Soft studio background
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#f4f1ec');
    bg.addColorStop(1, '#e7e2d9');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // 3×3 grid of mockup cards
    const cols = 3, rows = 3, cell = 196, gap = 14;
    const gridW = cols * cell + (cols - 1) * gap;
    const gridH = rows * cell + (rows - 1) * gap;
    const ox = (W - gridW) / 2, oy = (H - gridH) / 2;
    ctx.imageSmoothingQuality = 'high';
    imgs.forEach((im, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const x = ox + c * (cell + gap), y = oy + r * (cell + gap);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.18)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 6;
      ctx.beginPath();
      ctx.roundRect(x, y, cell, cell, 14);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, cell, cell, 14);
      ctx.clip();
      ctx.drawImage(im, x, y, cell, cell);
      ctx.restore();
    });
    return cv.toDataURL('image/jpeg', 0.85).split(',')[1];
  }, { b64s });
  fs.writeFileSync(path.join(BANNER_DIR, 'blog_batch_export.jpg'), Buffer.from(bannerB64, 'base64'));
  console.log('wrote blog_batch_export.jpg');

  // 3. Bulk landing page hero (680×680): square 3×3 grid, matches the other
  //    landing pages' square hb-right banners.
  const squareB64 = await page.evaluate(async ({ b64s }) => {
    const imgs = await Promise.all(b64s.map((b) => new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.src = 'data:image/png;base64,' + b;
    })));
    const W = 680, H = 680;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#f4f1ec');
    bg.addColorStop(1, '#e7e2d9');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const cols = 3, rows = 3, gap = 14, pad = 26;
    const cell = (W - 2 * pad - (cols - 1) * gap) / cols;
    ctx.imageSmoothingQuality = 'high';
    imgs.forEach((im, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const x = pad + c * (cell + gap), y = pad + r * (cell + gap);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.18)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 5;
      ctx.beginPath();
      ctx.roundRect(x, y, cell, cell, 12);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, cell, cell, 12);
      ctx.clip();
      ctx.drawImage(im, x, y, cell, cell);
      ctx.restore();
    });
    return cv.toDataURL('image/jpeg', 0.85).split(',')[1];
  }, { b64s });
  fs.writeFileSync(path.join(BANNER_DIR, 'bulk_mock.jpg'), Buffer.from(squareB64, 'base64'));
  console.log('wrote bulk_mock.jpg');

  fs.unlinkSync(zipPath);
  await browser.close();
})();
