const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const logoPath = 'C:\\Users\\Hello\\.gemini\\antigravity\\brain\\17679472-da3c-4030-8378-492eb539a079\\media__1782060965595.png';

  if (!fs.existsSync(logoPath)) {
    console.error(`Error: Source logo file not found at ${logoPath}`);
    process.exit(1);
  }

  console.log(`Reading source logo from: ${logoPath}`);
  const logoBuffer = fs.readFileSync(logoPath);
  const logoBase64 = logoBuffer.toString('base64');
  const dataUri = `data:image/png;base64,${logoBase64}`;

  console.log('Launching browser to process image...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('about:blank');

  const resizedImages = await page.evaluate(async (uri) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = uri;
      img.onload = () => {
        const sizes = {
          ico: 32,
          png96: 96,
          apple180: 180,
          manifest192: 192,
          manifest512: 512
        };

        const results = {};

        for (const [key, size] of Object.entries(sizes)) {
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          
          // Use image smoothing for high quality downscaling
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          ctx.drawImage(img, 0, 0, size, size);
          results[key] = canvas.toDataURL('image/png');
        }

        resolve(results);
      };
      img.onerror = (err) => {
        reject(new Error('Failed to load image in browser context.'));
      };
    });
  }, dataUri);

  await browser.close();
  console.log('Browser context finished. Writing files...');

  const outputDirs = [
    path.join(__dirname, '..', 'favicon'),
    path.join(__dirname, '..', 'public')
  ];

  // Make sure output directories exist
  outputDirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  const fileMap = {
    ico: 'favicon.ico',
    png96: 'favicon-96x96.png',
    apple180: 'apple-touch-icon.png',
    manifest192: 'web-app-manifest-192x192.png',
    manifest512: 'web-app-manifest-512x512.png'
  };

  // 1. Write the PNG and ICO files
  for (const [key, filename] of Object.entries(fileMap)) {
    const base64Data = resizedImages[key].replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    outputDirs.forEach(dir => {
      const destPath = path.join(dir, filename);
      fs.writeFileSync(destPath, buffer);
      console.log(`Wrote: ${destPath}`);
    });
  }

  // 2. Generate and write favicon.svg (embedding the 512x512 base64 PNG)
  const base64_512 = resizedImages.manifest512;
  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" xmlns:xlink="http://www.w3.org/1999/xlink" width="512" height="512" viewBox="0 0 512 512">
  <image width="512" height="512" xlink:href="${base64_512}" x="0" y="0" width="512" height="512" />
</svg>`;

  outputDirs.forEach(dir => {
    const destPath = path.join(dir, 'favicon.svg');
    fs.writeFileSync(destPath, svgContent, 'utf8');
    console.log(`Wrote SVG: ${destPath}`);
  });

  console.log('All favicon assets generated and deployed successfully.');
})();
