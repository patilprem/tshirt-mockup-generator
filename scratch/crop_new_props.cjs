const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const propDir = path.join(__dirname, '..', 'public', 'assets', 'props');
if (!fs.existsSync(propDir)) {
  fs.mkdirSync(propDir, { recursive: true });
}

const newProps = [
  {
    name: 'prop_sunglasses',
    src: 'C:\\Users\\Hello\\.gemini\\antigravity\\brain\\17679472-da3c-4030-8378-492eb539a079\\media__1782046958833.png'
  },
  {
    name: 'prop_shoes',
    src: 'C:\\Users\\Hello\\.gemini\\antigravity\\brain\\17679472-da3c-4030-8378-492eb539a079\\media__1782046958925.png'
  },
  {
    name: 'prop_hat',
    src: 'C:\\Users\\Hello\\.gemini\\antigravity\\brain\\17679472-da3c-4030-8378-492eb539a079\\media__1782046958941.jpg'
  },
  {
    name: 'prop_plant',
    src: 'C:\\Users\\Hello\\.gemini\\antigravity\\brain\\17679472-da3c-4030-8378-492eb539a079\\media__1782046959059.png'
  },
  {
    name: 'prop_jeans',
    src: 'C:\\Users\\Hello\\.gemini\\antigravity\\brain\\17679472-da3c-4030-8378-492eb539a079\\media__1782046959113.jpg'
  }
];

(async () => {
  console.log('Launching browser to process new props...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  for (const prop of newProps) {
    console.log(`Processing ${prop.name}...`);
    // Copy to public folder temporarily
    const tempFile = path.join(__dirname, '..', 'public', 'temp_prop.png');
    fs.copyFileSync(prop.src, tempFile);

    await page.goto('http://localhost:4321/temp_prop.png');

    const dataUrl = await page.evaluate(async (name) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.src = '/temp_prop.png';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);

          const w = img.width;
          const h = img.height;
          const imgData = ctx.getImageData(0, 0, w, h);
          const pixels = imgData.data;

          // 1. Detect background type by sampling corners (top-left, top-right, bottom-left, bottom-right)
          const corners = [
            { x: 0, y: 0 },
            { x: w - 1, y: 0 },
            { x: 0, y: h - 1 },
            { x: w - 1, y: h - 1 }
          ];

          let blackCount = 0;
          let whiteCount = 0;
          let transparentCount = 0;

          corners.forEach(pt => {
            const idx = (pt.y * w + pt.x) * 4;
            const r = pixels[idx];
            const g = pixels[idx + 1];
            const b = pixels[idx + 2];
            const a = pixels[idx + 3];

            if (a < 50) {
              transparentCount++;
            } else if (r < 110 && g < 110 && b < 110) {
              blackCount++;
            } else {
              whiteCount++;
            }
          });

          let bgType = 'transparent';
          if (transparentCount < 3) {
            if (blackCount >= whiteCount) {
              bgType = 'black';
            } else {
              bgType = 'white';
            }
          }

          console.log(`Prop ${name} background type detected: ${bgType}`);

          // Bounding box detection function
          function isBackgroundPixel(r, g, b, a) {
            if (bgType === 'transparent') return a < 10;
            if (bgType === 'black') return r < 40 && g < 40 && b < 40;
            if (bgType === 'white') return r > 240 && g > 240 && b > 240;
            return false;
          }

          // 2. Find bounding box of prop
          let minX = w, maxX = 0, minY = h, maxY = 0;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const idx = (y * w + x) * 4;
              const r = pixels[idx];
              const g = pixels[idx + 1];
              const b = pixels[idx + 2];
              const a = pixels[idx + 3];

              if (!isBackgroundPixel(r, g, b, a)) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }

          // If no bounding box found, use full size
          if (maxX < minX) {
            minX = 0; maxX = w - 1; minY = 0; maxY = h - 1;
          }

          const sW = (maxX - minX) + 1;
          const sH = (maxY - minY) + 1;

          // Create crop canvas
          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = sW;
          cropCanvas.height = sH;
          const cropCtx = cropCanvas.getContext('2d');

          // Draw crop
          cropCtx.drawImage(img, minX, minY, sW, sH, 0, 0, sW, sH);

          // Get cropped pixels for keying
          const cData = cropCtx.getImageData(0, 0, sW, sH);
          const cPixels = cData.data;

          // 3. BFS border keying
          const visited = new Uint8Array(sW * sH);
          const queue = [];

          function checkBg(rVal, gVal, bVal, aVal) {
            if (bgType === 'transparent') return aVal < 10;
            if (bgType === 'black') return rVal < 120 && gVal < 120 && bVal < 120;
            if (bgType === 'white') return rVal > 220 && gVal > 220 && bVal > 220;
            return false;
          }

          function enqueue(tx, ty) {
            if (tx >= 0 && tx < sW && ty >= 0 && ty < sH) {
              const idx = ty * sW + tx;
              if (!visited[idx]) {
                visited[idx] = 1;
                queue.push(idx);
              }
            }
          }

          for (let x = 0; x < sW; x++) {
            enqueue(x, 0);
            enqueue(x, sH - 1);
          }
          for (let y = 0; y < sH; y++) {
            enqueue(0, y);
            enqueue(sW - 1, y);
          }

          while (queue.length > 0) {
            const idx = queue.shift();
            const px = idx % sW;
            const py = Math.floor(idx / sW);
            const rIdx = idx * 4;

            if (checkBg(cPixels[rIdx], cPixels[rIdx + 1], cPixels[rIdx + 2], cPixels[rIdx + 3])) {
              cPixels[rIdx + 3] = 0; // Transparent

              const rad = 2;
              for (let dy = -rad; dy <= rad; dy++) {
                for (let dx = -rad; dx <= rad; dx++) {
                  const nx = px + dx;
                  const ny = py + dy;
                  if (nx >= 0 && nx < sW && ny >= 0 && ny < sH) {
                    const nIdx = ny * sW + nx;
                    if (!visited[nIdx]) {
                      const nrIdx = nIdx * 4;
                      if (checkBg(cPixels[nrIdx], cPixels[nrIdx + 1], cPixels[nrIdx + 2], cPixels[nrIdx + 3])) {
                        visited[nIdx] = 1;
                        queue.push(nIdx);
                      }
                    }
                  }
                }
              }
            }
          }

          // 4. Color dilation to prevent halos (except if originally transparent)
          if (bgType !== 'transparent') {
            const origAlphas = new Uint8Array(sW * sH);
            for (let i = 0; i < sW * sH; i++) {
              origAlphas[i] = cPixels[i * 4 + 3];
            }

            for (let y = 0; y < sH; y++) {
              for (let x = 0; x < sW; x++) {
                const idx = y * sW + x;
                const rIdx = idx * 4;
                if (origAlphas[idx] < 255) {
                  let found = false;
                  let bestR = 255, bestG = 255, bestB = 255;
                  for (let d = 1; d <= 5; d++) {
                    for (let dy = -d; dy <= d; dy++) {
                      for (let dx = -d; dx <= d; dx++) {
                        if (Math.abs(dx) === d || Math.abs(dy) === d) {
                          const nx = x + dx;
                          const ny = y + dy;
                          if (nx >= 0 && nx < sW && ny >= 0 && ny < sH) {
                            const nIdx = ny * sW + nx;
                            if (origAlphas[nIdx] === 255) {
                              const nrIdx = nIdx * 4;
                              bestR = cPixels[nrIdx];
                              bestG = cPixels[nrIdx + 1];
                              bestB = cPixels[nrIdx + 2];
                              found = true;
                              break;
                            }
                          }
                        }
                      }
                      if (found) break;
                    }
                    if (found) break;
                  }
                  if (found) {
                    cPixels[rIdx] = bestR;
                    cPixels[rIdx + 1] = bestG;
                    cPixels[rIdx + 2] = bestB;
                  }
                }
              }
            }
          }

          // 5. Feather edges
          for (let pass = 0; pass < 2; pass++) {
            const tempAlphas = new Uint8Array(sW * sH);
            for (let i = 0; i < sW * sH; i++) {
              tempAlphas[i] = cPixels[i * 4 + 3];
            }

            for (let y = 1; y < sH - 1; y++) {
              for (let x = 1; x < sW - 1; x++) {
                const idx = y * sW + x;
                if (tempAlphas[idx] > 0) {
                  const isBorder = 
                    tempAlphas[idx - 1] === 0 || 
                    tempAlphas[idx + 1] === 0 || 
                    tempAlphas[idx - sW] === 0 || 
                    tempAlphas[idx + sW] === 0;

                  if (isBorder) {
                    let sum = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                      for (let dx = -1; dx <= 1; dx++) {
                        sum += tempAlphas[(y + dy) * sW + (x + dx)];
                      }
                    }
                    cPixels[idx * 4 + 3] = Math.round(sum / 9);
                  }
                }
              }
            }
          }

          cropCtx.putImageData(cData, 0, 0);
          resolve(cropCanvas.toDataURL('image/png'));
        };
      });
    }, prop.name);

    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
    const destPath = path.join(propDir, `${prop.name}.png`);
    fs.writeFileSync(destPath, base64Data, 'base64');
    console.log(`Saved transparent prop: ${destPath}`);

    // Clean up temp file
    try {
      fs.unlinkSync(tempFile);
    } catch (e) {}
  }

  await browser.close();
  console.log('Finished processing all new props!');
})();
