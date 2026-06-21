const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  console.log('Launching browser to debug crop colors...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('http://localhost:4321/');

  const cfg = {
    name: 'prop_plant',
    src: 'http://localhost:4321/media_flatlay.png',
    x: 60, y: 70, w: 120, h: 130
  };

  const colors = await page.evaluate(async (cfg) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = cfg.src;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = cfg.w;
        canvas.height = cfg.h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, cfg.x, cfg.y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
        
        const w = canvas.width;
        const h = canvas.height;
        const imgData = ctx.getImageData(0, 0, w, h);
        const pixels = imgData.data;

        // Collect colors at some border points
        const borderColors = [];
        for (let x = 0; x < w; x += 20) {
          const rIdx = (0 * w + x) * 4;
          borderColors.push({ x, y: 0, r: pixels[rIdx], g: pixels[rIdx+1], b: pixels[rIdx+2] });
        }
        
        resolve(borderColors);
      };
    });
  }, cfg);

  console.log('Top border colors:', colors);

  await browser.close();
})();
