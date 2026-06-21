const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const artifactDir = 'C:\\Users\\Hello\\.gemini\\antigravity\\brain\\17679472-da3c-4030-8378-492eb539a079';
  const newFiles = [
    'media__1782036748199.png',
    'media__1782036748253.png',
    'media__1782036748298.png',
    'media__1782036748337.png',
    'media__1782036748382.png'
  ];

  // We need to copy them to the public directory so the dev server can serve them for canvas loading
  const destDir = path.join(__dirname, '..', 'public', 'assets', 'temp');
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  for (const file of newFiles) {
    const srcPath = path.join(artifactDir, file);
    const destPath = path.join(destDir, file);
    fs.copyFileSync(srcPath, destPath);
    console.log(`Copied ${file} to public/assets/temp/`);
  }

  // Navigate to dev server
  await page.goto('http://localhost:4323/');

  for (const file of newFiles) {
    const url = `http://localhost:4323/assets/temp/${file}`;
    const stats = await page.evaluate(async (src) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const pixels = imgData.data;

          // Check corner pixel colors
          const corners = [
            { x: 0, y: 0 },
            { x: img.width - 1, y: 0 },
            { x: 0, y: img.height - 1 },
            { x: img.width - 1, y: img.height - 1 }
          ];

          const cornerColors = corners.map(c => {
            const idx = (c.y * img.width + c.x) * 4;
            return {
              x: c.x, y: c.y,
              r: pixels[idx], g: pixels[idx+1], b: pixels[idx+2], a: pixels[idx+3]
            };
          });

          // Let's count exact white pixels (r === 255 && g === 255 && b === 255)
          let exactWhite = 0;
          let nearWhite = 0; // r,g,b > 250
          let other = 0;

          for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i];
            const g = pixels[i+1];
            const b = pixels[i+2];
            if (r === 255 && g === 255 && b === 255) {
              exactWhite++;
            } else if (r > 250 && g > 250 && b > 250) {
              nearWhite++;
            } else {
              other++;
            }
          }

          resolve({
            width: img.width,
            height: img.height,
            corners: cornerColors,
            exactWhite,
            nearWhite,
            other
          });
        };
        img.src = src;
      });
    }, url);

    console.log(`${file}:`, JSON.stringify(stats, null, 2));
  }

  await browser.close();
})();
