const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:4321/');

  // Toggle sneakers prop
  await page.evaluate(async () => {
    const card = document.querySelector('[data-prop="sneakers"]');
    card.click();
    // Wait for it to load and draw
    await new Promise(resolve => setTimeout(resolve, 1500));
  });

  // Check pixel colors at specific canvas coordinates
  // Sneakers prop is drawn at x: 120, y: 720, w: 220, h: 215 on a 1000x1000 canvas.
  // The black block was around x: 130, y: 730 or similar.
  const pixelColors = await page.evaluate(() => {
    const canvas = document.getElementById('editor-canvas');
    const ctx = canvas.getContext('2d');
    
    // Sample a few points around the sneakers prop bounding box
    const points = [
      { lx: 10, ly: 10, x: 120 + 10, y: 720 + 10 },
      { lx: 50, ly: 50, x: 120 + 50, y: 720 + 50 },
      { lx: 200, ly: 10, x: 120 + 200, y: 720 + 10 },
      { lx: 200, ly: 200, x: 120 + 200, y: 720 + 200 }
    ];
    
    return points.map(pt => {
      const data = ctx.getImageData(pt.x, pt.y, 1, 1).data;
      return { ...pt, r: data[0], g: data[1], b: data[2], a: data[3] };
    });
  });

  console.log('Canvas pixel colors around sneakers:', pixelColors);
  await browser.close();
})();
