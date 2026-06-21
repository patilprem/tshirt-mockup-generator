const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:4321/');

  await page.waitForTimeout(2000);

  const templates = [
    'tshirt_flatlay.png',
    'tshirt_ladies.png',
    'tshirt_polo.png',
    'tshirt_longsleeve.png',
    'tshirt_hoodie.png',
    'tshirt_sweatshirt.png',
    'tshirt_vneck.png',
    'tshirt_tanktop.png'
  ];

  const results = {};

  for (const template of templates) {
    const stats = await page.evaluate((tpl) => {
      const canvas = document.createElement('canvas');
      return new Promise((resolve) => {
        const testImg = new Image();
        testImg.crossOrigin = 'anonymous';
        testImg.src = '/assets/processed/' + tpl;
        testImg.onload = () => {
          canvas.width = testImg.width;
          canvas.height = testImg.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(testImg, 0, 0);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imgData.data;

          let maxLuminance = 0;
          let sumLuminance = 0;
          let count = 0;
          let histogram = {};

          for (let i = 0; i < data.length; i += 4) {
            const a = data[i + 3];
            if (a > 10) {
              const r = data[i];
              const g = data[i + 1];
              const b = data[i + 2];
              const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
              
              if (y > maxLuminance) maxLuminance = y;
              sumLuminance += y;
              count++;

              const bucket = Math.floor(y / 5) * 5;
              histogram[bucket] = (histogram[bucket] || 0) + 1;
            }
          }

          resolve({
            maxLuminance,
            avgLuminance: Math.round(sumLuminance / count),
            peakLuminance: Object.entries(histogram).sort((a,b) => b[1] - a[1])[0][0]
          });
        };
      });
    }, template);
    results[template] = stats;
  }

  console.log('All 8 templates stats:', results);
  await browser.close();
})();
