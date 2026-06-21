const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // HTML page to load font and render canvas
  const content = `
    <!DOCTYPE html>
    <html>
    <head>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Paytone+One&display=swap" rel="stylesheet">
      <style>
        body {
          margin: 0;
          background: transparent;
          font-family: 'Paytone One', sans-serif;
        }
      </style>
    </head>
    <body>
      <canvas id="renderCanvas" width="1200" height="800"></canvas>
    </body>
    </html>
  `;

  await page.setContent(content);
  
  // Wait for Google Fonts to load
  await page.evaluate(() => document.fonts.ready);

  // Render text on canvas with black border
  const dataUrl = await page.evaluate(() => {
    const canvas = document.getElementById('renderCanvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Style parameters
    const textFill = '#fcfaf2'; // Warm cream/off-white fill
    const textStroke = '#111111'; // Crisp bold black outline
    const strokeWidth = 24; // Bold border width

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Draw Line 1: "CREATIVE"
    ctx.font = '160px "Paytone One"';
    ctx.strokeStyle = textStroke;
    ctx.lineWidth = strokeWidth;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

    // Line 1 Coordinates
    const x1 = w / 2;
    const y1 = 280;

    // Stroke first, then fill (so stroke is drawn behind the fill!)
    ctx.strokeText('CREATIVE', x1, y1);
    ctx.fillStyle = textFill;
    ctx.fillText('CREATIVE', x1, y1);

    // Draw Line 2: "STUDIO"
    ctx.font = '160px "Paytone One"';
    const x2 = w / 2;
    const y2 = 460;

    ctx.strokeText('STUDIO', x2, y2);
    ctx.fillStyle = textFill;
    ctx.fillText('STUDIO', x2, y2);

    // Draw a small decorative minimal star/accent ✦ below
    ctx.font = '60px "Paytone One"';
    ctx.lineWidth = 10;
    const x3 = w / 2;
    const y3 = 590;
    ctx.strokeText('✦ ✦ ✦', x3, y3);
    ctx.fillText('✦ ✦ ✦', x3, y3);

    // Tightly crop the bounding box
    const imgData = ctx.getImageData(0, 0, w, h);
    const pixels = imgData.data;

    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    let hasPixels = false;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const alpha = pixels[idx + 3];
        if (alpha > 10) {
          hasPixels = true;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (!hasPixels) {
      return canvas.toDataURL('image/png');
    }

    const padding = 12;
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(w - 1, maxX + padding);
    maxY = Math.min(h - 1, maxY + padding);

    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext('2d');

    cropCtx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
    return cropCanvas.toDataURL('image/png');
  });

  const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
  const destDir = path.join(__dirname, '..', 'public', 'assets', 'designs');
  const destPath = path.join(destDir, 'minimal_rose.png'); // Replace first preset
  
  fs.writeFileSync(destPath, base64Data, 'base64');
  console.log('Saved transparent, bold filled text design successfully!');

  await browser.close();
})();
