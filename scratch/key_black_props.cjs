const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  console.log('Launching browser to key black background from props...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Navigate to dev server
  await page.goto('http://localhost:4321/');

  const targets = [
    {
      name: 'prop_hat',
      src: 'http://localhost:4321/assets/props/prop_hat.png', // Currently raw JPG renamed to .png
      threshold: 15,
      dilation: 2,
      feather: 2
    },
    {
      name: 'prop_jeans',
      src: 'http://localhost:4321/assets/props/prop_jeans.png', // Currently raw JPG renamed to .png
      threshold: 15,
      dilation: 2,
      feather: 2
    }
  ];

  const destDir = path.join(__dirname, '..', 'public', 'assets', 'props');

  for (const target of targets) {
    console.log(`Processing ${target.name}...`);
    
    const dataUrl = await page.evaluate(async (cfg) => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = cfg.src + '?v=' + Date.now();
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
          
          // BFS flood fill starting from all 4 borders
          const visited = new Uint8Array(w * h);
          const queue = [];
          
          function checkBg(r, g, b) {
            // Check if pixel is close to black
            return r <= cfg.threshold && g <= cfg.threshold && b <= cfg.threshold;
          }

          function enqueue(x, y) {
            if (x >= 0 && x < w && y >= 0 && y < h) {
              const idx = y * w + x;
              if (!visited[idx]) {
                visited[idx] = 1;
                queue.push(idx);
              }
            }
          }
          
          // Enqueue all boundary pixels
          for (let x = 0; x < w; x++) {
            enqueue(x, 0);
            enqueue(x, h - 1);
          }
          for (let y = 0; y < h; y++) {
            enqueue(0, y);
            enqueue(w - 1, y);
          }
          
          while (queue.length > 0) {
            const idx = queue.shift();
            const px = idx % w;
            const py = Math.floor(idx / w);
            const rIdx = idx * 4;
            
            const r = pixels[rIdx];
            const g = pixels[rIdx + 1];
            const b = pixels[rIdx + 2];
            
            if (checkBg(r, g, b)) {
              pixels[rIdx + 3] = 0; // Make transparent
              
              // 4-connected neighbors
              enqueue(px + 1, py);
              enqueue(px - 1, py);
              enqueue(px, py + 1);
              enqueue(px, py - 1);
            }
          }
          
          // Erode/dilate boundary slightly to remove edge fringe
          const rad = cfg.dilation;
          if (rad > 0) {
            const tempVisited = new Uint8Array(visited);
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                const idx = y * w + x;
                if (tempVisited[idx] === 1) {
                  // If background, bleed transparency to neighbors if they are dark-ish
                  for (let dy = -rad; dy <= rad; dy++) {
                    for (let dx = -rad; dx <= rad; dx++) {
                      const nx = x + dx;
                      const ny = y + dy;
                      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                        const nIdx = ny * w + nx;
                        if (tempVisited[nIdx] === 0) {
                          const nrIdx = nIdx * 4;
                          const nr = pixels[nrIdx];
                          const ng = pixels[nrIdx + 1];
                          const nb = pixels[nrIdx + 2];
                          if (nr < 40 && ng < 40 && nb < 40) {
                            pixels[nrIdx + 3] = 0;
                            visited[nIdx] = 1;
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
          
          // Feather edges
          const featherPasses = cfg.feather;
          for (let pass = 0; pass < featherPasses; pass++) {
            const tempAlphas = new Uint8Array(w * h);
            for (let i = 0; i < w * h; i++) {
              tempAlphas[i] = pixels[i * 4 + 3];
            }
            for (let y = 1; y < h - 1; y++) {
              for (let x = 1; x < w - 1; x++) {
                const idx = y * w + x;
                if (tempAlphas[idx] > 0) {
                  const hasBgNeighbor = 
                    tempAlphas[idx - 1] === 0 || 
                    tempAlphas[idx + 1] === 0 || 
                    tempAlphas[idx - w] === 0 || 
                    tempAlphas[idx + w] === 0;
                    
                  if (hasBgNeighbor) {
                    let sum = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                      for (let dx = -1; dx <= 1; dx++) {
                        sum += tempAlphas[(y + dy) * w + (x + dx)];
                      }
                    }
                    pixels[idx * 4 + 3] = Math.round(sum / 9);
                  }
                }
              }
            }
          }
          
          ctx.putImageData(imgData, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = (err) => {
          reject('Failed to load image: ' + img.src);
        };
      });
    }, target);

    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
    const destPath = path.join(destDir, `${target.name}.png`);
    fs.writeFileSync(destPath, base64Data, 'base64');
    console.log(`Saved keyed transparent ${target.name}.png successfully!`);
  }

  await browser.close();
  console.log('All black backgrounds keyed out from props!');
})();
