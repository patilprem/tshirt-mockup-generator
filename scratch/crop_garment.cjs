const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const srcFile = process.argv[2];
  const destFile = process.argv[3];

  if (!srcFile || !destFile) {
    console.error('Usage: node crop_garment.cjs <src_path> <dest_path>');
    process.exit(1);
  }

  // Copy srcFile to public/temp_garment.png
  const tempPath = path.join(__dirname, '..', 'public', 'temp_garment.png');
  fs.copyFileSync(srcFile, tempPath);

  console.log(`Copying temporary image to: ${tempPath}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:4321/temp_garment.png');

  // Let browser process the image
  const dataUrl = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = '/temp_garment.png';
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

        // 1. Detect Bounding Box of the shirt (non-black pixels)
        // Background check: pixels where R, G, B are all very dark (e.g. < 45)
        let minX = w, maxX = 0, minY = h, maxY = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const r = pixels[idx];
            const g = pixels[idx + 1];
            const b = pixels[idx + 2];
            
            // If not black background
            if (r > 45 || g > 45 || b > 45) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        console.log(`Bounding box: X [${minX}, ${maxX}], Y [${minY}, ${maxY}]`);

        // Width and height of the shirt
        const sW = (maxX - minX) + 1;
        const sH = (maxY - minY) + 1;

        // Create a new centered canvas (1000x1000px)
        const targetCanvas = document.createElement('canvas');
        targetCanvas.width = 1000;
        targetCanvas.height = 1000;
        const targetCtx = targetCanvas.getContext('2d');

        // Scale shirt to fit within 1000x1000 with padding
        const maxDim = 840; // Max shirt width/height to leave margin
        const scale = Math.min(maxDim / sW, maxDim / sH);
        const dW = sW * scale;
        const dH = sH * scale;
        const dx = (1000 - dW) / 2;
        const dy = (1000 - dH) / 2;

        // Draw cropped & scaled T-shirt onto target canvas
        targetCtx.drawImage(
          img,
          minX, minY, sW, sH, // source crop
          dx, dy, dW, dH      // target dest
        );

        // Get target pixels for background keying
        const targetData = targetCtx.getImageData(0, 0, 1000, 1000);
        const tPixels = targetData.data;

        // 2. BFS border flood fill to key out black background
        const visited = new Uint8Array(1000 * 1000);
        const queue = [];

        // Increase threshold to 110 to capture all background shadow artifacts
        function isBgColor(rVal, gVal, bVal) {
          return rVal < 110 && gVal < 110 && bVal < 110;
        }

        function enqueue(tx, ty) {
          if (tx >= 0 && tx < 1000 && ty >= 0 && ty < 1000) {
            const idx = ty * 1000 + tx;
            if (!visited[idx]) {
              visited[idx] = 1;
              queue.push(idx);
            }
          }
        }

        // Enqueue all borders of the 1000x1000 target canvas
        for (let x = 0; x < 1000; x++) {
          enqueue(x, 0);
          enqueue(x, 999);
        }
        for (let y = 0; y < 1000; y++) {
          enqueue(0, y);
          enqueue(999, y);
        }

        while (queue.length > 0) {
          const idx = queue.shift();
          const px = idx % 1000;
          const py = Math.floor(idx / 1000);
          const rIdx = idx * 4;

          const r = tPixels[rIdx];
          const g = tPixels[rIdx + 1];
          const b = tPixels[rIdx + 2];

          if (isBgColor(r, g, b)) {
            tPixels[rIdx + 3] = 0; // make transparent

            // Dilated queueing: look within 3px radius
            const rad = 3;
            for (let dy = -rad; dy <= rad; dy++) {
              for (let dx = -rad; dx <= rad; dx++) {
                if (Math.abs(dx) + Math.abs(dy) <= rad) {
                  const nx = px + dx;
                  const ny = py + dy;
                  if (nx >= 0 && nx < 1000 && ny >= 0 && ny < 1000) {
                    const nIdx = ny * 1000 + nx;
                    if (!visited[nIdx]) {
                      const nrIdx = nIdx * 4;
                      if (isBgColor(tPixels[nrIdx], tPixels[nrIdx + 1], tPixels[nrIdx + 2])) {
                        visited[nIdx] = 1;
                        queue.push(nIdx);
                      }
                    }
                  }
                }
              }
            }
          }
        }

        // 3. Mask Erosion: Erode the outline by 2 pixels to completely discard transitional dark edge pixels
        const erodedAlphas = new Uint8Array(1000 * 1000);
        const tempAlphas = new Uint8Array(1000 * 1000);
        for (let i = 0; i < 1000 * 1000; i++) {
          tempAlphas[i] = tPixels[i * 4 + 3];
          erodedAlphas[i] = tPixels[i * 4 + 3];
        }

        const erosionRadius = 2;
        for (let y = 0; y < 1000; y++) {
          for (let x = 0; x < 1000; x++) {
            const idx = y * 1000 + x;
            if (tempAlphas[idx] > 0) {
              let nearBg = false;
              for (let dy = -erosionRadius; dy <= erosionRadius; dy++) {
                for (let dx = -erosionRadius; dx <= erosionRadius; dx++) {
                  const nx = x + dx;
                  const ny = y + dy;
                  if (nx >= 0 && nx < 1000 && ny >= 0 && ny < 1000) {
                    if (tempAlphas[ny * 1000 + nx] === 0) {
                      nearBg = true;
                      break;
                    }
                  } else {
                    nearBg = true;
                    break;
                  }
                }
                if (nearBg) break;
              }
              if (nearBg) {
                erodedAlphas[idx] = 0;
              }
            }
          }
        }

        for (let i = 0; i < 1000 * 1000; i++) {
          tPixels[i * 4 + 3] = erodedAlphas[i];
        }

        // 4. Color Dilation / Bleeding
        // For any pixel with alpha < 255, replace its color with the nearest fully opaque pixel's color
        // to prevent any remaining dark/grey border pixels from blending
        const finalAlphas = new Uint8Array(1000 * 1000);
        for (let i = 0; i < 1000 * 1000; i++) {
          finalAlphas[i] = tPixels[i * 4 + 3];
        }

        for (let y = 0; y < 1000; y++) {
          for (let x = 0; x < 1000; x++) {
            const idx = y * 1000 + x;
            const rIdx = idx * 4;
            if (finalAlphas[idx] < 255) {
              let found = false;
              let bestR = 255, bestG = 255, bestB = 255;
              
              for (let d = 1; d <= 6; d++) {
                for (let dy = -d; dy <= d; dy++) {
                  for (let dx = -d; dx <= d; dx++) {
                    if (Math.abs(dx) === d || Math.abs(dy) === d) {
                      const nx = x + dx;
                      const ny = y + dy;
                      if (nx >= 0 && nx < 1000 && ny >= 0 && ny < 1000) {
                        const nIdx = ny * 1000 + nx;
                        if (finalAlphas[nIdx] === 255) {
                          const nrIdx = nIdx * 4;
                          bestR = tPixels[nrIdx];
                          bestG = tPixels[nrIdx + 1];
                          bestB = tPixels[nrIdx + 2];
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
                tPixels[rIdx] = bestR;
                tPixels[rIdx + 1] = bestG;
                tPixels[rIdx + 2] = bestB;
              }
            }
          }
        }

        // 5. Feather edges (3-pass Box Blur on alpha channel)
        for (let pass = 0; pass < 3; pass++) {
          const tempAlphas2 = new Uint8Array(1000 * 1000);
          for (let i = 0; i < 1000 * 1000; i++) {
            tempAlphas2[i] = tPixels[i * 4 + 3];
          }

          for (let y = 1; y < 999; y++) {
            for (let x = 1; x < 999; x++) {
              const idx = y * 1000 + x;
              if (tempAlphas2[idx] > 0) {
                const isBorder = 
                  tempAlphas2[idx - 1] === 0 || 
                  tempAlphas2[idx + 1] === 0 || 
                  tempAlphas2[idx - 1000] === 0 || 
                  tempAlphas2[idx + 1000] === 0;

                if (isBorder) {
                  let sum = 0;
                  for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                      sum += tempAlphas2[(y + dy) * 1000 + (x + dx)];
                    }
                  }
                  tPixels[idx * 4 + 3] = Math.round(sum / 9);
                }
              }
            }
          }
        }

        targetCtx.putImageData(targetData, 0, 0);
        resolve(targetCanvas.toDataURL('image/png'));
      };
    });
  });

  const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(destFile, base64Data, 'base64');
  
  // Clean up temp file
  try {
    fs.unlinkSync(tempPath);
  } catch (e) {}

  console.log(`Successfully cropped and saved transparent mockup to: ${destFile}`);
  await browser.close();
})();
