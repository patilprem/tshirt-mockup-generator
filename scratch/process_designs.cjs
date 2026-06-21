const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:4321/');

  const brainDir = 'C:\\Users\\Hello\\.gemini\\antigravity\\brain\\17679472-da3c-4030-8378-492eb539a079';
  const destDir = path.join(__dirname, '..', 'public', 'assets', 'designs');

  const targets = [
    {
      name: 'minimal_rose.png',
      srcPath: path.join(brainDir, 'design_minimal_rose_1782048531842.png')
    },
    {
      name: 'minimal_mountain.png',
      srcPath: path.join(brainDir, 'design_minimal_mountain_1782048548446.png')
    }
  ];

  for (const target of targets) {
    console.log(`Processing and tightly cropping ${target.name}...`);
    
    // Read the file buffer and encode to base64 to load in page
    const buffer = fs.readFileSync(target.srcPath);
    const base64Image = buffer.toString('base64');
    const dataUrlSrc = `data:image/png;base64,${base64Image}`;

    const dataUrlResult = await page.evaluate(async (src) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);

          const w = canvas.width;
          const h = canvas.height;
          const imgData = ctx.getImageData(0, 0, w, h);
          const pixels = imgData.data;

          // 1. Key out black background (pixels close to black)
          for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            // If very dark, make fully transparent
            if (r < 40 && g < 40 && b < 40) {
              pixels[i + 3] = 0;
            }
          }

          // 2. Find bounding box of non-transparent pixels
          let minX = w;
          let minY = h;
          let maxX = 0;
          let maxY = 0;
          let hasPixels = false;

          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const idx = (y * w + x) * 4;
              const alpha = pixels[idx + 3];
              if (alpha > 10) { // check if visible
                hasPixels = true;
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
              }
            }
          }

          if (!hasPixels) {
            // Fallback to original image if no non-black pixels found
            ctx.putImageData(imgData, 0, 0);
            resolve(canvas.toDataURL('image/png'));
            return;
          }

          // Add padding of 5 pixels around the bounding box
          const padding = 8;
          minX = Math.max(0, minX - padding);
          minY = Math.max(0, minY - padding);
          maxX = Math.min(w - 1, maxX + padding);
          maxY = Math.min(h - 1, maxY + padding);

          const cropW = maxX - minX + 1;
          const cropH = maxY - minY + 1;

          // 3. Create a cropped canvas
          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = cropW;
          cropCanvas.height = cropH;
          const cropCtx = cropCanvas.getContext('2d');

          // Put keyed image data back onto original canvas
          ctx.putImageData(imgData, 0, 0);

          // Draw cropped section
          cropCtx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
          resolve(cropCanvas.toDataURL('image/png'));
        };
        img.src = src;
      });
    }, dataUrlSrc);

    const base64Data = dataUrlResult.replace(/^data:image\/png;base64,/, '');
    const destPath = path.join(destDir, target.name);
    fs.writeFileSync(destPath, base64Data, 'base64');
    console.log(`Saved transparent, tightly cropped ${target.name} successfully!`);
  }

  await browser.close();
  console.log('Finished processing designs!');
})();
