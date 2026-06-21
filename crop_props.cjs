const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  console.log('Launching browser to crop props...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Create public/assets/props directory if it doesn't exist
  const destDir = path.join(__dirname, 'public', 'assets', 'props');
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // Navigate to dev server
  await page.goto('http://localhost:4322/');

  // Define crop configurations (plant, sneakers, and jeans from high-res media_jeans.png)
  const crops = [
    {
      name: 'prop_plant',
      src: 'http://localhost:4322/media_jeans.png',
      x: 100, y: 130, w: 200, h: 220,
      threshold: 180,
      dilation: 3,
      holeFill: 8
    },
    {
      name: 'prop_shoes', // Canvas Shoes
      src: 'http://localhost:4322/media_jeans.png',
      x: 180, y: 360, w: 280, h: 270,
      threshold: 180,
      dilation: 3,
      holeFill: 8
    },
    {
      name: 'prop_hat',
      src: 'http://localhost:4322/media_flatlay.png',
      x: 330, y: 150, w: 155, h: 150,
      threshold: 180,
      dilation: 6,
      holeFill: 15
    },
    {
      name: 'prop_shorts',
      src: 'http://localhost:4322/media_flatlay.png',
      x: 260, y: 220, w: 240, h: 155,
      threshold: 180,
      dilation: 6,
      holeFill: 15
    },
    {
      name: 'prop_jeans', // Folded Jeans
      src: 'http://localhost:4322/media_jeans.png',
      x: 470, y: 400, w: 250, h: 280,
      threshold: 180,
      dilation: 6,
      holeFill: 15
    }
  ];

  for (const crop of crops) {
    console.log(`Cropping ${crop.name}...`);
    
    // Evaluate script inside browser to crop and key out background
    const dataUrl = await page.evaluate(async (cfg) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = cfg.src;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = cfg.w;
          canvas.height = cfg.h;
          const ctx = canvas.getContext('2d');
          
          // Draw cropped section
          ctx.drawImage(img, cfg.x, cfg.y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
          
          // Key out background using dilated BFS border flood fill
          const w = canvas.width;
          const h = canvas.height;
          const imgData = ctx.getImageData(0, 0, w, h);
          const pixels = imgData.data;
          
          const visited = new Uint8Array(w * h);
          const queue = [];
          
          // Helper to check if a pixel color is background (white wood or black border)
          function checkBg(rVal, gVal, bVal) {
            const isBlack = (rVal < 45 && gVal < 45 && bVal < 45);
            if (cfg.name === 'prop_shoes') {
              // Canvas shoes: white canvas, prevent leaking
              return (rVal > cfg.threshold && rVal < 237 && gVal > cfg.threshold && gVal < 237 && bVal > cfg.threshold && bVal < 237) || isBlack;
            } else {
              return (rVal > cfg.threshold && gVal > cfg.threshold && bVal > cfg.threshold) || isBlack;
            }
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
          
          // Enqueue borders
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
              
              // Dilated queueing: look within cfg.dilation radius
              const rad = cfg.dilation;
              for (let dy = -rad; dy <= rad; dy++) {
                for (let dx = -rad; dx <= rad; dx++) {
                  if (Math.abs(dx) + Math.abs(dy) <= rad) {
                    const nx = px + dx;
                    const ny = py + dy;
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                      const nIdx = ny * w + nx;
                      if (!visited[nIdx]) {
                        const nrIdx = nIdx * 4;
                        const nr = pixels[nrIdx];
                        const ng = pixels[nrIdx + 1];
                        const nb = pixels[nrIdx + 2];
                        
                        if (checkBg(nr, ng, nb)) {
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
          
          // Specialized sleeve/fabric removal pass for flatlay props (remove neutral charcoal fabric from the borders)
          if (cfg.name === 'prop_hat' || cfg.name === 'prop_shorts') {
            const sleeveQueue = [];
            const sleeveVisited = new Uint8Array(w * h);
            
            function isNeutralCharcoal(rVal, gVal, bVal) {
              return rVal < 125 && gVal < 125 && bVal < 125 && 
                     Math.abs(rVal - gVal) < 18 && Math.abs(gVal - bVal) < 18;
            }

            function enqueueSleeve(x, y) {
              if (x >= 0 && x < w && y >= 0 && y < h) {
                const idx = y * w + x;
                if (!sleeveVisited[idx]) {
                  const rIdx = idx * 4;
                  const r = pixels[rIdx];
                  const g = pixels[rIdx + 1];
                  const b = pixels[rIdx + 2];
                  if (isNeutralCharcoal(r, g, b)) {
                    sleeveVisited[idx] = 1;
                    sleeveQueue.push(idx);
                  }
                }
              }
            }

            for (let x = 0; x < w; x++) {
              enqueueSleeve(x, 0);
              enqueueSleeve(x, h - 1);
            }
            for (let y = 0; y < h; y++) {
              enqueueSleeve(0, y);
              enqueueSleeve(w - 1, y);
            }
            
            while (sleeveQueue.length > 0) {
              const idx = sleeveQueue.shift();
              const px = idx % w;
              const py = Math.floor(idx / w);
              const rIdx = idx * 4;
              
              pixels[rIdx + 3] = 0;
              
              const dirs = [
                { x: px + 1, y: py },
                { x: px - 1, y: py },
                { x: px, y: py + 1 },
                { x: px, y: py - 1 }
              ];
              
              for (const dir of dirs) {
                if (dir.x >= 0 && dir.x < w && dir.y >= 0 && dir.y < h) {
                  const nIdx = dir.y * w + dir.x;
                  if (!sleeveVisited[nIdx]) {
                    const nrIdx = nIdx * 4;
                    const nr = pixels[nrIdx];
                    const ng = pixels[nrIdx + 1];
                    const nb = pixels[nrIdx + 2];
                    
                    if (isNeutralCharcoal(nr, ng, nb)) {
                      sleeveVisited[nIdx] = 1;
                      sleeveQueue.push(nIdx);
                    }
                  }
                }
              }
            }
          }

          // Specialized green t-shirt removal pass for jeans prop (remove green fabric from the borders)
          if (cfg.name === 'prop_jeans') {
            const greenQueue = [];
            const greenVisited = new Uint8Array(w * h);
            
            function isGreenShirt(rVal, gVal, bVal) {
              return gVal > rVal + 15 && gVal > bVal + 15 && gVal < 150;
            }

            function enqueueGreen(x, y) {
              if (x >= 0 && x < w && y >= 0 && y < h) {
                const idx = y * w + x;
                if (!greenVisited[idx]) {
                  const rIdx = idx * 4;
                  const r = pixels[rIdx];
                  const g = pixels[rIdx + 1];
                  const b = pixels[rIdx + 2];
                  if (isGreenShirt(r, g, b)) {
                    greenVisited[idx] = 1;
                    greenQueue.push(idx);
                  }
                }
              }
            }

            // Green t-shirt overlaps from the top-left area
            for (let x = 0; x < w; x++) {
              enqueueGreen(x, 0);
            }
            for (let y = 0; y < h; y++) {
              enqueueGreen(0, y);
            }
            
            while (greenQueue.length > 0) {
              const idx = greenQueue.shift();
              const px = idx % w;
              const py = Math.floor(idx / w);
              const rIdx = idx * 4;
              
              pixels[rIdx + 3] = 0;
              
              const dirs = [
                { x: px + 1, y: py },
                { x: px - 1, y: py },
                { x: px, y: py + 1 },
                { x: px, y: py - 1 }
              ];
              
              for (const dir of dirs) {
                if (dir.x >= 0 && dir.x < w && dir.y >= 0 && dir.y < h) {
                  const nIdx = dir.y * w + dir.x;
                  if (!greenVisited[nIdx]) {
                    const nrIdx = nIdx * 4;
                    const nr = pixels[nrIdx];
                    const ng = pixels[nrIdx + 1];
                    const nb = pixels[nrIdx + 2];
                    
                    if (isGreenShirt(nr, ng, nb)) {
                      greenVisited[nIdx] = 1;
                      greenQueue.push(nIdx);
                    }
                  }
                }
              }
            }
          }

          // Hole filling pass
          const maxGap = cfg.holeFill;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const idx = y * w + x;
              if (visited[idx] === 0) {
                let hasLeft = false;
                for (let dx = 1; dx <= maxGap; dx++) {
                  if (x - dx >= 0 && visited[y * w + (x - dx)] === 1) {
                    hasLeft = true;
                    break;
                  }
                }
                let hasRight = false;
                for (let dx = 1; dx <= maxGap; dx++) {
                  if (x + dx < w && visited[y * w + (x + dx)] === 1) {
                    hasRight = true;
                    break;
                  }
                }
                let hasUp = false;
                for (let dy = 1; dy <= maxGap; dy++) {
                  if (y - dy >= 0 && visited[(y - dy) * w + x] === 1) {
                    hasUp = true;
                    break;
                  }
                }
                let hasDown = false;
                for (let dy = 1; dy <= maxGap; dy++) {
                  if (y + dy < h && visited[(y + dy) * w + x] === 1) {
                    hasDown = true;
                    break;
                  }
                }
                
                if ((hasLeft && hasRight) || (hasUp && hasDown)) {
                  pixels[idx * 4 + 3] = 0;
                  visited[idx] = 1;
                }
              }
            }
          }
          
          // Feather edges
          for (let pass = 0; pass < 2; pass++) {
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
      });
    }, crop);

    // Save data URL to destination file
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
    const destPath = path.join(destDir, `${crop.name}.png`);
    fs.writeFileSync(destPath, base64Data, 'base64');
    console.log(`Saved ${crop.name}.png to public/assets/props/`);
  }

  await browser.close();
  console.log('Done cropping all props!');
})();
