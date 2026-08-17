// What does edgeRough read on a REAL photographic edge?
//
// The 12-24 floor came from a noiseless analytic curve. A photograph is not
// noiseless and a garment's outline is not analytic, so that number is a
// lower bound on the lower bound. Here the coverage is taken straight from
// the photograph with no pipeline in between: in a patch where flat cloth
// meets a plain background, F and B are two constants and the standard
// known-endpoints estimate applies —
//
//   alpha = dot(I - B, F - B) / |F - B|^2
//
// which is the exact solution of I = aF + (1-a)B projected onto the line
// between them. Whatever that scores IS what a photograph can support, grain,
// fabric weave, stray fibres and all.
//
//   node realfloor.cjs <sourceImage> <x> <y> <w> <h>
const fs = require('fs');
const { chromium } = require('playwright');
const [IMG, X, Y, PW, PH] = process.argv.slice(2);

const measureEdge = (A, W2, H2) => {
  let n = 0, wsum = 0, rsum = 0;
  for (let i = 0; i < W2 * H2; i++) {
    const x = i % W2, y = (i / W2) | 0;
    if (x < 3 || y < 3 || x >= W2 - 3 || y >= H2 - 3) continue;
    const a = A[i];
    if (a < 0.2 || a > 0.8) continue;
    const gx = (A[i + 1] - A[i - 1]) / 2, gy = (A[i + W2] - A[i - W2]) / 2;
    const g = Math.hypot(gx, gy);
    if (g < 0.02) continue;
    const wid = 1 / g;
    if (wid > 24) continue;
    let res = 0, m = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (!dx && !dy) continue;
      const v = A[i + dy * W2 + dx];
      const pred = a + gx * dx + gy * dy;
      if (pred < 0.05 || pred > 0.95) continue;
      res += Math.abs(v - pred); m++;
    }
    if (m < 6) continue;
    rsum += res / m; wsum += wid; n++;
  }
  return n ? { edgeWidth: +(wsum / n).toFixed(2), edgeRough: +((rsum / n) * 1000).toFixed(1), n } : null;
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const b64 = fs.readFileSync(IMG).toString('base64');
  const mime = IMG.endsWith('.png') ? 'png' : IMG.endsWith('.webp') ? 'webp' : 'jpeg';
  const r = await page.evaluate(async ({ b64, mime, X, Y, PW, PH }) => {
    const img = new Image();
    img.src = `data:image/${mime};base64,` + b64;
    await img.decode();
    // The pipeline decides at 2100 px on the long side; match it so the
    // numbers are comparable.
    const k = Math.min(1, 2100 / Math.max(img.width, img.height));
    const W = Math.round(img.width * k), H = Math.round(img.height * k);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, W, H);
    const d = cx.getImageData(0, 0, W, H).data;
    const px = (x, y, c) => d[(y * W + x) * 4 + c];

    // Endpoints: the darkest-violet and the brightest cluster in the patch,
    // each as the mean of its decile, so a single hot pixel cannot set them.
    const vals = [];
    for (let y = Y; y < Y + PH; y++) for (let x = X; x < X + PW; x++)
      vals.push({ l: 0.299 * px(x, y, 0) + 0.587 * px(x, y, 1) + 0.114 * px(x, y, 2), x, y });
    vals.sort((a, b) => a.l - b.l);
    const dec = Math.max(1, Math.floor(vals.length / 10));
    const mean = (arr) => {
      const o = [0, 0, 0];
      for (const p of arr) for (let c = 0; c < 3; c++) o[c] += px(p.x, p.y, c) / arr.length;
      return o;
    };
    const F = mean(vals.slice(0, dec));            // cloth (dark violet)
    const B = mean(vals.slice(vals.length - dec)); // background (bright)
    const dr = F[0] - B[0], dg = F[1] - B[1], db = F[2] - B[2];
    const dd = dr * dr + dg * dg + db * db;

    // alpha at the ANALYSIS grid, from the photograph alone
    const A = new Float32Array(PW * PH);
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
      const r2 = px(X + x, Y + y, 0) - B[0], g2 = px(X + x, Y + y, 1) - B[1], b2 = px(X + x, Y + y, 2) - B[2];
      A[y * PW + x] = Math.max(0, Math.min(1, (r2 * dr + g2 * dg + b2 * db) / dd));
    }
    // ...and the same area-average down to the shipped grid the pipeline uses
    const s = 1600 / 2100;
    const OW = Math.round(PW * s), OH = Math.round(PH * s);
    const down = new Float32Array(OW * OH);
    for (let oy = 0; oy < OH; oy++) for (let ox = 0; ox < OW; ox++) {
      const x0 = ox / s, x1 = (ox + 1) / s, y0 = oy / s, y1 = (oy + 1) / s;
      let acc = 0, wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.min(PH, Math.ceil(y1)); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        for (let xx = Math.floor(x0); xx < Math.min(PW, Math.ceil(x1)); xx++) {
          const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
          acc += A[yy * PW + xx] * wx * wy; wsum += wx * wy;
        }
      }
      down[oy * OW + ox] = wsum > 0 ? Math.round((acc / wsum) * 255) / 255 : 0;
    }
    return { W, H, F, B, A: Array.from(A), PW, PH, down: Array.from(down), OW, OH };
  }, { b64, mime, X: +X, Y: +Y, PW: +PW, PH: +PH });

  const at = measureEdge(Float32Array.from(r.A), r.PW, r.PH);
  const dn = measureEdge(Float32Array.from(r.down), r.OW, r.OH);
  console.log(`${IMG.split('/').pop()}  patch ${X},${Y} ${PW}x${PH}  (image ${r.W}x${r.H})`);
  console.log(`  cloth  rgb(${r.F.map(v => v.toFixed(0)).join(',')})   scene rgb(${r.B.map(v => v.toFixed(0)).join(',')})`);
  console.log(`  analysis grid : ${at ? `width=${at.edgeWidth} rough=${at.edgeRough} (n=${at.n})` : 'no edge found'}`);
  console.log(`  shipped grid  : ${dn ? `width=${dn.edgeWidth} rough=${dn.edgeRough} (n=${dn.n})` : 'no edge found'}`);
  await browser.close();
})();
