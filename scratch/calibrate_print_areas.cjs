// Calibrate per-garment print areas for batch export / placement presets.
//
// For each processed garment PNG this measures the alpha silhouette in headless
// Chromium, proposes a printArea rect {x,y,w,h} in the 1000×1000 asset frame,
// and renders an overlay PNG (garment + proposed rect + existing chestY /
// centerY / bellyY guide lines) for visual verification.
//
// Usage: node scratch/calibrate_print_areas.cjs [outDir]
//   outDir defaults to scratch/calibration-out
//
// The proposals are a starting point — verify each overlay and hand-tune the
// final table in Editor.astro (hoodie pocket/drawstrings and polo plackets are
// invisible to the alpha channel).

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// Existing hand-tuned guide values from Editor.astro's garmentConfigs, used to
// sanity-check proposals against what the editor already believes about each garment.
const EDITOR_HINTS = {
  crewneck:   { chestY: 420, centerY: 480, bellyY: 570, file: 'tshirt_flatlay.png' },
  ladies:     { chestY: 380, centerY: 460, bellyY: 540, file: 'tshirt_ladies.png' },
  polo:       { chestY: 430, centerY: 500, bellyY: 580, file: 'tshirt_polo.png' },
  longsleeve: { chestY: 420, centerY: 490, bellyY: 580, file: 'tshirt_longsleeve.png' },
  hoodie:     { chestY: 440, centerY: 510, bellyY: 600, file: 'tshirt_hoodie.png' },
  sweatshirt: { chestY: 410, centerY: 480, bellyY: 570, file: 'tshirt_sweatshirt.png' },
  vneck:      { chestY: 430, centerY: 500, bellyY: 580, file: 'tshirt_vneck.png' },
  tanktop:    { chestY: 380, centerY: 460, bellyY: 550, file: 'tshirt_tanktop.png' },
};

// Hand-tuned final print areas (blue in the overlays), adjusted from the
// automatic proposals after visual review: tops moved below collars / V-necks /
// polo plackets / hoodie hood+drawstrings, bottoms raised above kangaroo
// pockets (hoodie AND sweatshirt both have one).
const TUNED = {
  crewneck:   { x: 310, y: 265, w: 384, h: 365 },
  ladies:     { x: 302, y: 225, w: 396, h: 375 },
  polo:       { x: 306, y: 400, w: 402, h: 245 },
  longsleeve: { x: 327, y: 265, w: 353, h: 375 },
  hoodie:     { x: 346, y: 340, w: 312, h: 310 },
  sweatshirt: { x: 333, y: 265, w: 334, h: 305 },
  vneck:      { x: 296, y: 270, w: 409, h: 370 },
  tanktop:    { x: 310, y: 330, w: 380, h: 310 },
};

const ASSET_DIR = path.join(__dirname, '..', 'public', 'assets', 'processed');
const OUT_DIR = process.argv[2] || path.join(__dirname, 'calibration-out');

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // The pinned playwright version may not match the pre-installed browsers;
  // fall back to the stable chromium binary at /opt/pw-browsers/chromium.
  const browser = await chromium
    .launch({ headless: true })
    .catch(() => chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' }));
  const page = await browser.newPage();
  await page.goto('about:blank');

  const results = {};

  for (const [garment, hints] of Object.entries(EDITOR_HINTS)) {
    const b64 = fs.readFileSync(path.join(ASSET_DIR, hints.file)).toString('base64');

    const tuned = TUNED[garment] || null;
    const out = await page.evaluate(async ({ b64, hints, garment, tuned }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await new Promise((res) => (img.onload = res));

      const W = img.width, H = img.height;
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const a = ctx.getImageData(0, 0, W, H).data;
      const opaque = (x, y) => a[(y * W + x) * 4 + 3] > 20;

      // Silhouette bounding box
      let minX = W, maxX = 0, minY = H, maxY = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (opaque(x, y)) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      const bboxCx = Math.round((minX + maxX) / 2);
      const bboxH = maxY - minY;

      // Collar top: first row where the center column is opaque
      let collarY = minY;
      for (let y = minY; y <= maxY; y++) {
        if (opaque(bboxCx, y)) { collarY = y; break; }
      }

      // Torso run (contiguous opaque run containing the center) at a row near
      // the hem, safely below the sleeves.
      const torsoRunAt = (y) => {
        if (!opaque(bboxCx, y)) return null;
        let l = bboxCx, r = bboxCx;
        while (l > 0 && opaque(l - 1, y)) l--;
        while (r < W - 1 && opaque(r + 1, y)) r++;
        return { l, r, w: r - l };
      };
      const hemRow = Math.round(maxY - bboxH * 0.06);
      const torso = torsoRunAt(hemRow) || { l: minX, r: maxX, w: maxX - minX };
      const torsoCx = Math.round((torso.l + torso.r) / 2);

      // Torso width profile every 20px (for eyeballing where sleeves start/end)
      const profile = [];
      for (let y = minY; y <= maxY; y += 20) {
        const run = torsoRunAt(y);
        profile.push({ y, w: run ? run.w : 0 });
      }

      // Proposal: 76% of hem torso width, from a bit below the collar down to
      // just above the editor's bellyY hint (keeps clear of hoodie pockets).
      const pw = Math.round(torso.w * 0.76);
      const px = Math.round(torsoCx - pw / 2);
      const py = Math.round(collarY + bboxH * 0.11);
      const pBottom = Math.min(hints.bellyY + 60, Math.round(maxY - bboxH * 0.1));
      const printArea = { x: px, y: py, w: pw, h: pBottom - py };

      // Overlay render for visual verification
      const ov = document.createElement('canvas');
      ov.width = W; ov.height = H;
      const octx = ov.getContext('2d');
      octx.fillStyle = '#ffffff';
      octx.fillRect(0, 0, W, H);
      octx.drawImage(img, 0, 0);
      octx.fillStyle = 'rgba(0, 200, 80, 0.28)';
      octx.fillRect(printArea.x, printArea.y, printArea.w, printArea.h);
      octx.strokeStyle = 'rgba(0, 150, 60, 0.9)';
      octx.lineWidth = 3;
      octx.strokeRect(printArea.x, printArea.y, printArea.w, printArea.h);
      // Editor guide lines: chestY (red), centerY (orange), bellyY (purple)
      const line = (y, color, label) => {
        octx.strokeStyle = color;
        octx.lineWidth = 2;
        octx.beginPath();
        octx.moveTo(120, y);
        octx.lineTo(W - 120, y);
        octx.stroke();
        octx.fillStyle = color;
        octx.font = 'bold 22px sans-serif';
        octx.fillText(label + ' ' + y, 8, y + 7);
      };
      line(hints.chestY, '#e02020', 'chest');
      line(hints.centerY, '#e08a00', 'center');
      line(hints.bellyY, '#8020c0', 'belly');
      if (tuned) {
        octx.fillStyle = 'rgba(30, 90, 220, 0.25)';
        octx.fillRect(tuned.x, tuned.y, tuned.w, tuned.h);
        octx.strokeStyle = 'rgba(20, 60, 200, 0.95)';
        octx.lineWidth = 4;
        octx.strokeRect(tuned.x, tuned.y, tuned.w, tuned.h);
      }
      octx.fillStyle = '#111';
      octx.font = 'bold 28px sans-serif';
      octx.fillText(garment + (tuned ? ' (blue = tuned)' : ''), 12, 36);

      return { W, H, bbox: { minX, maxX, minY, maxY }, collarY, hemRow, torso, torsoCx, profile, printArea, overlay: ov.toDataURL('image/png') };
    }, { b64, hints, garment, tuned });

    const overlay = out.overlay;
    delete out.overlay;
    fs.writeFileSync(path.join(OUT_DIR, `${garment}_overlay.png`), Buffer.from(overlay.split(',')[1], 'base64'));
    results[garment] = out;
    console.log(garment, JSON.stringify({ collarY: out.collarY, torso: out.torso, printArea: out.printArea }));
  }

  fs.writeFileSync(path.join(OUT_DIR, 'calibration.json'), JSON.stringify(results, null, 2));
  console.log('\nWrote overlays + calibration.json to', OUT_DIR);
  await browser.close();
})();
