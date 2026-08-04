// Props must be draggable into every part of the canvas the preset creates.
//
// Props live in a 1000x1000 artboard, but only 1:1 renders that square alone.
// Every other preset letterboxes it inside a taller or wider frame, so there is
// canvas the artboard does not cover — on a 9:16 story, the top and bottom ~290
// units, which is exactly the band that preset exists to give you. Clamping a
// prop to the artboard made that band unreachable: a hat dragged at the top of
// an Instagram Story stopped ~6% short of the edge and would go no further.
//
// Measured with the background TRANSPARENT, no design loaded and nothing
// selected, so the only opaque pixels are the shirt and the prop, and no
// selection chrome is in the frame. That matters: the rotate button hangs a
// long way below the box, so any measurement that includes chrome reads as
// "reached the bottom" whether the prop got there or not.
//
// Needs the dev server: npm run dev, then node test_prop_bounds.cjs
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:4321';
const PRESETS = ['1:1', '4:3', '4:5', '9:16'];
const ZOOM = { '4:3': 1.12, '9:16': 1.12 };
// Sunglasses prop defaults, in artboard units. A SMALL prop is deliberate:
// the old clamp let a prop's centre reach the artboard edge, so half of a tall
// prop already hung over the frame and the bug barely showed. 72 units tall,
// only 36 of it could overhang, leaving the failure plain — a blocked drag
// stops ~16% short of the edge rather than ~1%.
const PROP = { name: 'sunglasses', x: 740, y: 400, w: 180, h: 72 };

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Topmost and bottommost opaque rows, as a fraction of canvas height.
const opaqueExtent = () => {
  const c = document.getElementById('editor-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let top = -1, bot = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 8) { if (top < 0) top = y; bot = y; break; }
    }
  }
  return top < 0 ? null : { top: top / c.height, bot: bot / c.height };
};

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });

  let failures = 0;
  const fail = msg => { failures++; console.log(`  FAIL ${msg}`); };

  for (const preset of PRESETS) {
    for (const dir of ['up', 'down']) {
      // Fresh page per case: a prop flung off one edge is no longer under the
      // grab point for the next one.
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(`${BASE}/editor`, { waitUntil: 'networkidle' });
      await sleep(2000);
      await page.click('[data-bg="transparent"]');
      await page.click(`#canvas-size-selector [data-aspect="${preset}"]`);
      await sleep(1200);
      // Shirt-only baseline, so the assertion below is about the PROP and not
      // about whatever happens to be outermost. Without it a prop dragged
      // clean off the canvas reads the same as one that never moved: the
      // measurement falls back to the shirt either way.
      const base = await page.evaluate(opaqueExtent);
      await page.click(`[data-prop="${PROP.name}"]`);
      await sleep(1500);

      const box = await page.evaluate(() => {
        const r = document.getElementById('editor-canvas').getBoundingClientRect();
        return { l: r.left, t: r.top, w: r.width, h: r.height };
      });
      const cd = await page.evaluate(() => {
        const c = document.getElementById('editor-canvas');
        return { w: c.width, h: c.height };
      });

      // Grab the prop at its centre, mapped through the same offset + zoom the
      // renderer uses to place the artboard inside the frame.
      const zoom = ZOOM[preset] || 1;
      const offX = (cd.w - 1000 * zoom) / 2, offY = (cd.h - 1000 * zoom) / 2;
      const start = {
        x: box.l + box.w * ((offX + (PROP.x + PROP.w / 2) * zoom) / cd.w),
        y: box.t + box.h * ((offY + (PROP.y + PROP.h / 2) * zoom) / cd.h),
      };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x, dir === 'up' ? box.t - 600 : box.t + box.h + 600, { steps: 15 });
      await page.mouse.up();
      await sleep(300);

      // Drop the selection so no chrome is measured.
      await page.click('.sidebar-left .panel-title');
      await sleep(300);

      const e = await page.evaluate(opaqueExtent);
      const edge = !e ? null : (dir === 'up' ? e.top : e.bot);
      const baseEdge = dir === 'up' ? base.top : base.bot;
      // Two conditions, and both matter: the prop has to touch the canvas edge,
      // AND it has to be the thing touching it. Beyond the baseline means the
      // prop is genuinely out there and still visible, not dragged off-canvas.
      const atEdge = edge !== null && (dir === 'up' ? edge <= 0.005 : edge >= 0.995);
      const isProp = edge !== null && (dir === 'up' ? edge < baseEdge - 0.005 : edge > baseEdge + 0.005);
      const reached = atEdge && isProp;
      const why = atEdge ? (isProp ? 'reaches the edge' : 'BLOCKED (prop not visible there — only the shirt)') : 'BLOCKED';
      console.log(`${preset.padEnd(5)} ${dir.padEnd(4)}: outermost opaque pixel at ${edge === null ? 'n/a' : (edge * 100).toFixed(1) + '%'} (shirt alone: ${(baseEdge * 100).toFixed(1)}%)  ${why}`);
      if (!reached) {
        fail(`${preset} ${dir}: the prop cannot be dragged to the ${dir === 'up' ? 'top' : 'bottom'} of the canvas and stay visible`);
      }
      await page.close();
    }
  }

  await browser.close();
  console.log(failures ? `\n${failures} failure(s)` : '\nevery preset reaches both edges');
  process.exit(failures ? 1 : 0);
})();
