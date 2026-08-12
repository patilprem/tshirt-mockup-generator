// Calibrate print areas for the four scaffolded back-view garments, the same
// way calibrate_print_areas.cjs does for the fronts: measure the alpha
// silhouette, propose a printArea rect, and render an overlay for visual
// verification. Kept separate rather than folded into the front script
// because the back set is a different asset list (garmentConfigs[x].back)
// and a one-off run, not a fixture to keep in sync going forward.
//
// Usage: node scratch/calibrate_back_areas.cjs [outDir]

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BACKS = {
  crewneck:   { file: 'tshirt_flatlay_back.png' },
  longsleeve: { file: 'tshirt_longsleeve_back.png' },
  hoodie:     { file: 'tshirt_hoodie_back.png' },
  sweatshirt: { file: 'tshirt_sweatshirt_back.png' },
};

const ASSET_DIR = path.join(__dirname, '..', 'public', 'assets', 'processed');
const OUT_DIR = process.argv[2] || path.join(__dirname, 'calibration-out-back');

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium
    .launch({ headless: true })
    .catch(() => chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' }));
  const page = await browser.newPage();
  await page.goto('about:blank');

  const results = {};

  for (const [garment, hints] of Object.entries(BACKS)) {
    const b64 = fs.readFileSync(path.join(ASSET_DIR, hints.file)).toString('base64');

    const out = await page.evaluate(async ({ b64, garment }) => {
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

      // Collar top: first row where the center column is opaque. On a back
      // view this is the collar seam / hood base, same landmark the front
      // script uses.
      let collarY = minY;
      for (let y = minY; y <= maxY; y++) {
        if (opaque(bboxCx, y)) { collarY = y; break; }
      }

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

      const profile = [];
      for (let y = minY; y <= maxY; y += 20) {
        const run = torsoRunAt(y);
        profile.push({ y, w: run ? run.w : 0 });
      }

      // A back print runs bigger than a front chest print and has no collar
      // dip, V, placket or kangaroo pocket to dodge — so the proposal takes
      // more of the torso width and runs further down: 84% of hem width
      // (vs. the front script's 76%), from just under the collar/hood base
      // down to just above the hem ribbing.
      const pw = Math.round(torso.w * 0.84);
      const px = Math.round(torsoCx - pw / 2);
      const py = Math.round(collarY + bboxH * 0.10);
      const pBottom = Math.round(maxY - bboxH * 0.08);
      const printArea = { x: px, y: py, w: pw, h: pBottom - py };

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
      octx.fillStyle = '#111';
      octx.font = 'bold 28px sans-serif';
      octx.fillText(garment + ' back', 12, 36);
      octx.font = 'bold 20px sans-serif';
      octx.fillText(`collarY ${collarY}  bbox ${minY}-${maxY}`, 12, H - 16);

      return { W, H, bbox: { minX, maxX, minY, maxY }, collarY, hemRow, torso, torsoCx, profile, printArea, overlay: ov.toDataURL('image/png') };
    }, { b64, garment });

    const overlay = out.overlay;
    delete out.overlay;
    fs.writeFileSync(path.join(OUT_DIR, `${garment}_back_overlay.png`), Buffer.from(overlay.split(',')[1], 'base64'));
    results[garment] = out;
    console.log(garment, JSON.stringify({ W: out.W, H: out.H, collarY: out.collarY, bbox: out.bbox, printArea: out.printArea }));
  }

  fs.writeFileSync(path.join(OUT_DIR, 'calibration.json'), JSON.stringify(results, null, 2));
  console.log('\nWrote overlays + calibration.json to', OUT_DIR);
  await browser.close();
})();
