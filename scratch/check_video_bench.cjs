#!/usr/bin/env node
/**
 * Drive the assembled bench page in a real browser before it is published.
 *
 * The page decodes every frame and its maps at load, then recolours in a
 * hand-written pixel loop — plenty of room for a failure that only shows up
 * at runtime. This clicks through the controls and screenshots the result, so
 * a broken page is caught here rather than by the person it was sent to.
 *
 * Usage: node scratch/check_video_bench.cjs <bench.html> <outDir>
 */
const { chromium } = (() => {
  try { return require('playwright'); } catch { return require('playwright-core'); }
})();
const path = require('path');
const fs = require('fs');

(async () => {
  const [htmlArg, outArg] = process.argv.slice(2);
  if (!htmlArg || !outArg) {
    console.error('usage: node scratch/check_video_bench.cjs <bench.html> <outDir>');
    process.exit(1);
  }
  const html = path.resolve(htmlArg);
  const outDir = path.resolve(outArg);
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file://' + html, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const el = document.getElementById('loading');
    return el && el.style.display === 'none';
  }, { timeout: 180000 });

  // A canvas that decoded but never drew is still a failure; check that the
  // stage actually carries a range of values rather than one flat fill.
  const canvasStats = await page.evaluate(() => {
    const c = document.getElementById('out');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let min = 255, max = 0, sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    return { w: c.width, h: c.height, min, max, mean: +(sum / (d.length / 4)).toFixed(1) };
  });
  console.log('canvas:', JSON.stringify(canvasStats));
  if (canvasStats.max - canvasStats.min < 40) errors.push('canvas looks flat — nothing rendered');

  await page.screenshot({ path: path.join(outDir, 'bench_default.png'), fullPage: true });

  await page.click('#playBtn');           // pause so shots are deterministic
  await page.fill('#colorHex', '#FFFFFF');
  await page.dispatchEvent('#colorHex', 'change');
  await page.screenshot({ path: path.join(outDir, 'bench_white.png'), fullPage: true });

  await page.check('#pinPrint');
  await page.screenshot({ path: path.join(outDir, 'bench_pinned.png'), fullPage: true });
  await page.uncheck('#pinPrint');

  const tick = await page.textContent('#tick');
  console.log('tick:', tick.trim());

  if (errors.length) {
    console.error('\nERRORS:\n  ' + errors.join('\n  '));
    await browser.close();
    process.exit(1);
  }
  console.log(`\nok — shots in ${outDir}`);
  await browser.close();
})();
