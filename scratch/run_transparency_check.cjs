const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  console.log('Running transparency check on props...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:4321/');

  const props = ['prop_plant', 'prop_shoes', 'prop_hat', 'prop_sunglasses', 'prop_jeans'];
  
  for (const name of props) {
    const url = `http://localhost:4321/assets/props/${name}.png?v=${Date.now()}`;
    const stats = await page.evaluate(async (src) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const pixels = imgData.data;
          
          let transparent = 0;
          let opaque = 0;
          let semi = 0;
          
          for (let i = 3; i < pixels.length; i += 4) {
            if (pixels[i] === 0) transparent++;
            else if (pixels[i] === 255) opaque++;
            else semi++;
          }
          
          resolve({
            width: img.width,
            height: img.height,
            totalPixels: img.width * img.height,
            transparent,
            opaque,
            semi
          });
        };
        img.onerror = (err) => {
          resolve({ error: 'Image failed to load: ' + src });
        };
        img.src = src;
      });
    }, url);
    
    console.log(`${name}:`, stats);
  }
  
  await browser.close();
})();
