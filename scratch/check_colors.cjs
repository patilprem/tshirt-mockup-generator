const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:4321/');

  const props = ['prop_hat', 'prop_jeans'];
  
  for (const name of props) {
    const url = `http://localhost:4321/assets/props/${name}.png?v=${Date.now()}`;
    const colors = await page.evaluate(async (src) => {
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
          
          // Get corner pixel (0, 0)
          const r = pixels[0];
          const g = pixels[1];
          const b = pixels[2];
          const a = pixels[3];
          
          // Get center pixel
          const cx = Math.floor(img.width / 2);
          const cy = Math.floor(img.height / 2);
          const cIdx = (cy * img.width + cx) * 4;
          const cr = pixels[cIdx];
          const cg = pixels[cIdx+1];
          const cb = pixels[cIdx+2];
          const ca = pixels[cIdx+3];
          
          resolve({
            corner: { r, g, b, a },
            center: { r: cr, g: cg, b: cb, a: ca }
          });
        };
        img.onerror = (err) => {
          resolve({ error: 'Image failed to load: ' + src });
        };
        img.src = src;
      });
    }, url);
    
    console.log(`${name}:`, colors);
  }
  
  await browser.close();
})();
