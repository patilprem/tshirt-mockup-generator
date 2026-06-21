const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:4321/');

  // Analyze sneaker crop area (x: 105 to 255, y: 205 to 350)
  // Let's sample colors in a grid to find sneaker colors vs background colors
  const data = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = 'http://localhost:4321/media_flatlay.png';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        // Sample points in the sneaker area
        // Sneakers are roughly in x: 105..255, y: 205..350
        const samples = [];
        for (let y = 205; y < 350; y += 15) {
          for (let x = 105; x < 255; x += 15) {
            const idx = (y * img.width + x) * 4;
            const r = canvas.getContext('2d').getImageData(x, y, 1, 1).data;
            samples.push({ x, y, r: r[0], g: r[1], b: r[2] });
          }
        }
        resolve(samples);
      };
    });
  });

  // Filter and show some samples
  // Brightest samples (potential sneakers)
  const bright = data.filter(s => s.r > 235 && s.g > 235 && s.b > 235);
  // Neutral wood samples (potential background)
  const wood = data.filter(s => s.r >= 210 && s.r <= 235 && s.g >= 210 && s.g <= 235 && s.b >= 210 && s.b <= 235);
  
  console.log('Bright samples (sneakers):', bright.slice(0, 10));
  console.log('Wood samples (background):', wood.slice(0, 10));

  await browser.close();
})();
