const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Load the saved prop_plant.png
  await page.goto('http://localhost:4321/assets/props/prop_plant.png');

  const alphas = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = 'http://localhost:4321/assets/props/prop_plant.png';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        const imgData = ctx.getImageData(0, 0, img.width, img.height);
        const pixels = imgData.data;
        
        // Return first 10 pixel values (r, g, b, a)
        const sample = [];
        for (let i = 0; i < 10; i++) {
          sample.push({
            r: pixels[i*4],
            g: pixels[i*4+1],
            b: pixels[i*4+2],
            a: pixels[i*4+3]
          });
        }
        resolve(sample);
      };
    });
  });

  console.log('Saved image first 10 pixels:', alphas);
  await browser.close();
})();
