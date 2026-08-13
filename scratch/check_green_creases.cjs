#!/usr/bin/env node
/**
 * Look for the green-crease defect in finished frames.
 *
 * The analysis reports chromaPct — green excess in information-free garment
 * pixels once a white target is relit through it — and the still baker FAILS
 * a build above 0.1%. The video bake reports up to 5.5% per frame, so either
 * the clip carries that defect badly or the metric means something different
 * here. Both possibilities matter, and neither is settled by looking at the
 * metric again; this measures the rendered frames themselves.
 *
 * Usage: node scratch/check_green_creases.cjs <renderDir> [outDir]
 */
const { chromium } = (() => {
  try { return require('playwright'); } catch { return require('playwright-core'); }
})();
const path = require('path');
const fs = require('fs');

(async () => {
  const [dirArg, outArg] = process.argv.slice(2);
  if (!dirArg) { console.error('usage: node scratch/check_green_creases.cjs <renderDir> [outDir]'); process.exit(1); }
  const dir = path.resolve(dirArg);
  const outDir = outArg ? path.resolve(outArg) : dir;
  const files = fs.readdirSync(dir).filter(f => /^out_\d+\.png$/.test(f)).sort();
  if (!files.length) { console.error('no frames'); process.exit(1); }
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();

  let worst = { count: -1 };
  const perFrame = [];
  for (const f of files) {
    const b64 = fs.readFileSync(path.join(dir, f)).toString('base64');
    const r = await page.evaluate(async ({ b64 }) => {
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + b64; });
      const c = document.createElement('canvas');
      c.width = im.width; c.height = im.height;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(im, 0, 0);
      const d = cx.getImageData(0, 0, c.width, c.height).data;
      const heat = cx.createImageData(c.width, c.height);
      let count = 0, worstExc = 0, mnX = c.width, mnY = c.height, mxX = -1, mxY = -1;
      for (let p = 0; p < c.width * c.height; p++) {
        const o = p * 4;
        const exc = d[o + 1] - Math.max(d[o], d[o + 2]);
        // Same test the baker's gate uses: green above BOTH other channels by
        // more than 6/255 is the mint cast, not ordinary foliage or skin.
        const hit = exc > 6;
        if (hit) {
          count++;
          if (exc > worstExc) worstExc = exc;
          const x = p % c.width, y = (p / c.width) | 0;
          if (x < mnX) mnX = x; if (x > mxX) mxX = x;
          if (y < mnY) mnY = y; if (y > mxY) mxY = y;
          heat.data[o] = 0; heat.data[o + 1] = 255; heat.data[o + 2] = 0; heat.data[o + 3] = 255;
        } else {
          const g = (d[o] * 0.299 + d[o + 1] * 0.587 + d[o + 2] * 0.114) * 0.4;
          heat.data[o] = g; heat.data[o + 1] = g; heat.data[o + 2] = g; heat.data[o + 3] = 255;
        }
      }
      const hc = document.createElement('canvas');
      hc.width = c.width; hc.height = c.height;
      hc.getContext('2d').putImageData(heat, 0, 0);
      return { count, worstExc, total: c.width * c.height, heat: hc.toDataURL('image/png'),
        box: mxX < 0 ? null : { x: mnX, y: mnY, w: mxX - mnX, h: mxY - mnY } };
    }, { b64 });
    perFrame.push(r.count);
    if (r.count > worst.count) worst = { count: r.count, file: f, heat: r.heat, box: r.box, worstExc: r.worstExc, total: r.total };
    process.stdout.write(`  ${f} green=${r.count}\r`);
  }

  fs.writeFileSync(path.join(outDir, 'green_worst_heat.png'), Buffer.from(worst.heat.split(',')[1], 'base64'));
  const avg = perFrame.reduce((a, b) => a + b, 0) / perFrame.length;
  console.log(`\nframes: ${files.length}`);
  console.log(`green-excess px  avg ${avg.toFixed(1)}  worst ${worst.count} (${worst.file}, ${(100 * worst.count / worst.total).toFixed(4)}% of frame)`);
  console.log(`worst excess ${worst.worstExc}/255, region ${JSON.stringify(worst.box)}`);
  console.log(`heat map: ${path.join(outDir, 'green_worst_heat.png')}`);
  await browser.close();
})();
