const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:4321/');

  const data = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = 'http://localhost:4321/media_flowers.png';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        // Sample left border of the flower crop (x: 350, y: 120 to 560)
        const samples = [];
        for (let y = 120; y < 560; y += 20) {
          const r = ctx.getImageData(350, y, 1, 1).data;
          samples.push({ y, r: r[0], g: r[1], b: r[2] });
        }
        resolve(samples);
      };
    });
  });

  console.log('Left border colors of flower crop:', data);
  await browser.close();
})();
