// On-model canvas-size presets: the download must be the frame the user saw.
//
// In on-model mode the presets crop the template photo rather than letterbox an
// artboard, and the crop rect is computed twice — once to size the live canvas,
// once to size the export. When those two disagree the screen looks right and
// the downloaded file does not, which is the failure that put wood panels down
// both sides of the model in a download nobody could reproduce on screen. That
// bug is invisible to every check except one that renders both and compares.
//
// Per preset this asserts:
//   1. the live canvas carries the preset's aspect
//   2. the export carries the same aspect as the live canvas
//   3. neither has a transparent letterbox margin (a margin means the rect and
//      the frame it was drawn into disagree)
//   4. the exported pixels match the live canvas, coarsely downsampled — the
//      only check that catches a rect that is the right SHAPE in the wrong PLACE
//
// Needs the dev server: npm run dev, then node test_on_model_crop.cjs
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:4321';
// The templates are 1066x1600, so every preset is width-limited except 9:16.
const PRESETS = ['1:1', '4:3', '4:5', '9:16'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // CHROMIUM_PATH lets this run against a Chromium that is already on the
  // machine, for environments where `npx playwright install` is not the way
  // browsers arrive.
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => console.log('  page error:', e.message));
  await page.goto(`${BASE}/editor`, { waitUntil: 'networkidle' });

  // A design on the shirt gives the pixel comparison something with hard edges
  // to disagree about; an empty garment is far more forgiving of a wrong crop.
  await page.click('#sample-designs .design-thumb');
  await sleep(1200);

  await page.click('#mockup-style-toggle [data-style="onmodel"]');
  await sleep(3000);

  // toDataURL is the export's last step, so overriding it hands back exactly
  // the pixels that would have been written to the file — no download plumbing,
  // no PNG decoding, and no second implementation of the thing under test.
  await page.evaluate(() => {
    window.__lastExport = null;
    const real = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      const url = real.apply(this, args);
      if (this !== document.getElementById('editor-canvas')) window.__lastExport = url;
      return url;
    };
  });

  let failures = 0;
  const fail = msg => { failures++; console.log(`  FAIL ${msg}`); };

  for (const preset of PRESETS) {
    console.log(`\n${preset}`);
    await page.click(`#canvas-size-selector [data-aspect="${preset}"]`);
    await sleep(600);

    await page.evaluate(() => { window.__lastExport = null; });
    // Straight to the default-quality download, skipping the modal's radios.
    await page.click('#download-btn');
    await sleep(400);
    const modalBtn = await page.$('#modal-download-btn');
    if (modalBtn && await modalBtn.isVisible()) await modalBtn.click();
    await page.waitForFunction(() => window.__lastExport, null, { timeout: 15000 });

    const r = await page.evaluate(async ([w, h]) => {
      const live = document.getElementById('editor-canvas');
      const img = new Image();
      await new Promise(res => { img.onload = res; img.src = window.__lastExport; });

      // A fully transparent edge row/column is the signature of a letterbox
      // margin: drawOnModelScene clears the margin rather than painting it.
      const clearMargin = (src, sw, sh) => {
        const c = document.createElement('canvas');
        c.width = sw; c.height = sh;
        const cx = c.getContext('2d');
        cx.drawImage(src, 0, 0, sw, sh);
        const d = cx.getImageData(0, 0, sw, sh).data;
        const rowClear = y => { for (let x = 0; x < sw; x++) if (d[(y * sw + x) * 4 + 3] !== 0) return false; return true; };
        const colClear = x => { for (let y = 0; y < sh; y++) if (d[(y * sw + x) * 4 + 3] !== 0) return false; return true; };
        return rowClear(0) || rowClear(sh - 1) || colClear(0) || colClear(sw - 1);
      };

      // Both frames squashed to the same small grid, so the comparison is of
      // composition and not of resolution.
      const N = 64;
      const grid = src => {
        const c = document.createElement('canvas');
        c.width = N; c.height = N;
        const cx = c.getContext('2d');
        cx.drawImage(src, 0, 0, N, N);
        return cx.getImageData(0, 0, N, N).data;
      };
      const a = grid(live), b = grid(img);
      let diff = 0;
      for (let i = 0; i < N * N; i++) {
        for (let ch = 0; ch < 3; ch++) diff += Math.abs(a[i * 4 + ch] - b[i * 4 + ch]);
      }

      return {
        live: { w: live.width, h: live.height },
        exp: { w: img.width, h: img.height },
        liveMargin: clearMargin(live, live.width, live.height),
        expMargin: clearMargin(img, img.width, img.height),
        meanDiff: diff / (N * N * 3),
      };
    }, [0, 0]);

    const [pw, ph] = preset.split(':').map(Number);
    const want = pw / ph;
    const liveA = r.live.w / r.live.h;
    const expA = r.exp.w / r.exp.h;
    console.log(`  live ${r.live.w}x${r.live.h} (${liveA.toFixed(4)})  export ${r.exp.w}x${r.exp.h} (${expA.toFixed(4)})  want ${want.toFixed(4)}  meanDiff ${r.meanDiff.toFixed(2)}`);

    // 1% covers the integer rounding of a crop rect and a 0.75-scaled canvas.
    if (Math.abs(liveA - want) / want > 0.01) fail(`${preset}: live canvas aspect ${liveA.toFixed(4)} is not ${want.toFixed(4)}`);
    if (Math.abs(expA - liveA) / liveA > 0.01) fail(`${preset}: export aspect ${expA.toFixed(4)} does not match the screen's ${liveA.toFixed(4)}`);
    if (r.liveMargin) fail(`${preset}: live canvas has a transparent letterbox margin — crop rect is wrong`);
    if (r.expMargin) fail(`${preset}: export has a transparent letterbox margin — crop rect is wrong`);
    // Resampling two different rasters of the same scene never lands on zero;
    // a genuinely different crop moves the model and runs an order up from this.
    if (r.meanDiff > 12) fail(`${preset}: export does not match the screen (mean channel diff ${r.meanDiff.toFixed(2)})`);
  }

  await browser.close();
  console.log(failures ? `\n${failures} failure(s)` : '\nall presets OK');
  process.exit(failures ? 1 : 0);
})();
