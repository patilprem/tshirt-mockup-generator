#!/usr/bin/env node
/**
 * Precompute on-model mockup templates.
 *
 * Each source photo is a model wearing a plain vivid-violet crewneck (see
 * MODEL-TEMPLATE-GUIDE for how they're generated). The violet is a chroma key:
 * this script isolates the garment once, offline, and emits three flat images
 * plus metadata so the browser never has to run the keying work.
 *
 *   <id>-plate.jpg   background plate — the photo with the garment's colour
 *                    contamination divided back out of the soft edge pixels
 *   <id>-matte.png   garment alpha (greyscale)
 *   <id>-shade.jpg   normalised illumination across the garment (greyscale),
 *                    0 = deepest fold, 255 = brightest lit area
 *
 * At runtime the editor recolours with
 *   rgb = target * lerp(LO, HI, shade) * lerp(ambientTint, 1, shade)
 * composited over the plate through the matte — cheap per-pixel work with no
 * hue analysis, and the same maths this was validated against offline.
 *
 * Usage: node scratch/build_on_model_templates.cjs
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SRC_DIR = process.env.ON_MODEL_SRC || path.join(__dirname, 'on-model-src');
const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'on-model');
const META_OUT = path.join(OUT_DIR, 'templates.json');

// Longest edge of the emitted assets. The source photos are ~1333x2000; keeping
// them near that preserves print-area detail without bloating the payload.
const MAX_EDGE = 1600;

const TEMPLATES = [
  { id: 'plaster-f', file: 'plaster-f.webp', label: 'Plaster Wall', model: 'female', scene: 'Warm plaster wall, daylight' },
  { id: 'window-f', file: 'window-f.webp', label: 'Window Light', model: 'female', scene: 'Tall window, sheer curtain' },
  { id: 'gallery-f', file: 'gallery-f.webp', label: 'Gallery Interior', model: 'female', scene: 'Minimal off-white interior' },
  { id: 'livingroom-m', file: 'livingroom-m.webp', label: 'Living Room', model: 'male', scene: 'Bright airy living room' },
  { id: 'street-m', file: 'street-m.webp', label: 'Urban Street', model: 'male', scene: 'Sunlit pavement outside a cafe' },
  { id: 'park-m', file: 'park-m.webp', label: 'Park Path', model: 'male', scene: 'Green park path, open shade' },
];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(META_OUT), { recursive: true });

  const manifest = [];

  for (const tpl of TEMPLATES) {
    const srcPath = path.join(SRC_DIR, tpl.file);
    if (!fs.existsSync(srcPath)) {
      console.error(`  ! missing source ${srcPath} — skipping ${tpl.id}`);
      continue;
    }
    const b64 = fs.readFileSync(srcPath).toString('base64');
    process.stdout.write(`${tpl.id} ... `);

    const r = await page.evaluate(async ({ b64, MAX_EDGE }) => {
      const load = s => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = s; });
      const img = await load('data:image/webp;base64,' + b64);

      // downscale to MAX_EDGE on the long side
      const k = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
      const W = Math.round(img.width * k), H = Math.round(img.height * k), N = W * H;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, W, H);
      const src = ctx.getImageData(0, 0, W, H).data;

      function hsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const M = Math.max(r, g, b), m = Math.min(r, g, b), d = M - m;
        let h = 0;
        if (d) { if (M === r) h = ((g - b) / d) % 6; else if (M === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
        return [h, M ? d / M : 0, M];
      }
      const ad = (a, b) => { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

      // 1. dominant saturated hue = the garment's key colour
      const bins = new Float64Array(36);
      for (let i = 0; i < N; i++) {
        const o = i * 4; const [h, s, v] = hsv(src[o], src[o + 1], src[o + 2]);
        if (s > 0.25 && v > 0.15) bins[Math.floor(h / 10) % 36] += s * v;
      }
      let bb = 0, bv = -1;
      for (let i = 0; i < 36; i++) if (bins[i] > bv) { bv = bins[i]; bb = i; }
      const shirtHue = bb * 10 + 5;

      // 2. soft hue-distance key
      const a0 = new Float32Array(N), hA = new Float32Array(N), sA = new Float32Array(N), vA = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const o = i * 4; const [h, s, v] = hsv(src[o], src[o + 1], src[o + 2]);
        hA[i] = h; sA[i] = s; vA[i] = v;
        const hd = ad(h, shirtHue);
        let a = 0;
        if (s >= 0.12 && v >= 0.08) { if (hd <= 22) a = 1; else if (hd < 40) a = 1 - (hd - 22) / 18; }
        a0[i] = a;
      }

      // 3. connected components; keep every meaningful fragment near the main
      //    body, because a raised arm can split the garment into separate pieces
      const vis = new Uint8Array(N), blobs = [];
      let best = null, bestN = 0;
      const qx = new Int32Array(N), qy = new Int32Array(N);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i0 = y * W + x;
        if (vis[i0] || a0[i0] < 0.5) continue;
        let qh = 0, qt = 0; qx[qt] = x; qy[qt] = y; qt++; vis[i0] = 1;
        const mem = [i0];
        while (qh < qt) {
          const cx = qx[qh], cy = qy[qh]; qh++;
          for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const ni = ny * W + nx;
            if (vis[ni] || a0[ni] < 0.5) continue;
            vis[ni] = 1; qx[qt] = nx; qy[qt] = ny; qt++; mem.push(ni);
          }
        }
        blobs.push(mem);
        if (mem.length > bestN) { bestN = mem.length; best = mem; }
      }
      if (!best) throw new Error('no garment found');
      let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
      for (const i of best) { const x = i % W, y = (i / W) | 0; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
      const PAD = Math.round(Math.max(bx1 - bx0, by1 - by0) * 0.25), FMIN = bestN * 0.002;
      const kept = [];
      for (const m of blobs) {
        if (m === best) { kept.push(m); continue; }
        if (m.length < FMIN) continue;
        let cx = 0, cy = 0;
        for (const i of m) { cx += i % W; cy += (i / W) | 0; }
        cx /= m.length; cy /= m.length;
        if (cx >= bx0 - PAD && cx <= bx1 + PAD && cy >= by0 - PAD && cy <= by1 + PAD) kept.push(m);
      }
      const fragments = kept.length;
      let blob = kept.flat();

      // 4. morphological close bridges dark creases that break hue connectivity
      let core = new Uint8Array(N);
      for (const i of blob) core[i] = 1;
      const dil = m => { const o = new Uint8Array(N); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (m[i] || (x + 1 < W && m[i + 1]) || (x > 0 && m[i - 1]) || (y + 1 < H && m[i + W]) || (y > 0 && m[i - W])) o[i] = 1; } return o; };
      const ero = m => { const o = new Uint8Array(N); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; const l = x > 0 ? m[i - 1] : 0, rr = x + 1 < W ? m[i + 1] : 0, u = y > 0 ? m[i - W] : 0, d = y + 1 < H ? m[i + W] : 0; o[i] = (m[i] && l && rr && u && d) ? 1 : 0; } return o; };
      const CR = Math.max(8, Math.round(W / 66));
      let cl = core;
      for (let i = 0; i < CR; i++) cl = dil(cl);
      for (let i = 0; i < CR; i++) cl = ero(cl);
      core = cl;
      blob = []; for (let i = 0; i < N; i++) if (core[i]) blob.push(i);

      // 5. bounded-distance soft edge. Near-black pixels adjacent to the garment
      //    are treated as fold shadow, but only if their hue is still plausibly
      //    the shirt's — that hue gate is what stops dark hair being swallowed.
      const DM = Math.max(30, Math.round(W / 16)), dist = new Int16Array(N).fill(-1);
      let fh = 0, ft = 0;
      const fx = new Int32Array(N * 4), fy = new Int32Array(N * 4);
      for (const i of blob) { dist[i] = 0; fx[ft] = i % W; fy[ft] = (i / W) | 0; ft++; }
      const isDark = i => { const v = vA[i]; if (v >= 0.32) return false; if (v < 0.12 && sA[i] < 0.15) return true; return ad(hA[i], shirtHue) < 100; };
      while (fh < ft) {
        const cx = fx[fh], cy = fy[fh]; fh++;
        const d = dist[cy * W + cx];
        if (d >= DM) continue;
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1], [cx + 1, cy + 1], [cx - 1, cy - 1], [cx + 1, cy - 1], [cx - 1, cy + 1]]) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (dist[ni] !== -1) continue;
          if (a0[ni] <= 0.02 && !isDark(ni)) continue;
          dist[ni] = d + 1; fx[ft] = nx; fy[ft] = ny; ft++;
        }
      }
      const a1 = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        if (core[i]) { a1[i] = 1; continue; }
        if (dist[i] === -1) { a1[i] = 0; continue; }
        a1[i] = Math.max(0, Math.min(1, ((vA[i] < 0.22 && isDark(i)) ? 1 : a0[i]) * (1 - dist[i] / DM)));
      }

      // 6. patch small enclosed holes (noise specks inside deep shadow)
      let mnX = W, mnY = H, mxX = 0, mxY = 0;
      for (const i of blob) { const x = i % W, y = (i / W) | 0; if (x < mnX) mnX = x; if (x > mxX) mxX = x; if (y < mnY) mnY = y; if (y > mxY) mxY = y; }
      let a2 = a1.slice();
      for (let p = 0; p < 4; p++) {
        const n2 = a2.slice(); let ch = false;
        for (let y = mnY + 1; y < mxY; y++) for (let x = mnX + 1; x < mxX; x++) {
          const i = y * W + x;
          if (a2[i] > 0.1) continue;
          const l = a2[i - 1], rr = a2[i + 1], u = a2[i - W], d = a2[i + W];
          if (l > 0.6 && rr > 0.6 && u > 0.6 && d > 0.6) { n2[i] = (l + rr + u + d) / 4; ch = true; }
        }
        a2 = n2; if (!ch) break;
      }
      const alpha = new Float32Array(N);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let s = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          s += a2[ny * W + nx]; c++;
        }
        alpha[y * W + x] = s / c;
      }

      // 7. illumination normalisation + scene ambient
      const cV = [], cR = [], cG = [], cB = [];
      for (const i of blob) { const o = i * 4; cV.push(vA[i]); cR.push(src[o]); cG.push(src[o + 1]); cB.push(src[o + 2]); }
      cV.sort((x, y) => x - y);
      const pct = p => cV[Math.min(cV.length - 1, Math.floor(cV.length * p))];
      const vLo = pct(0.02), vHi = pct(0.97);
      const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
      const shirtRGB = [med(cR), med(cG), med(cB)];

      const aR = [], aG = [], aB = [];
      for (let i = 0; i < N; i += 5) {
        if (alpha[i] > 0.02) continue;
        const o = i * 4; const [h, s, v] = hsv(src[o], src[o + 1], src[o + 2]);
        if (s < 0.18 && v > 0.55) { aR.push(src[o]); aG.push(src[o + 1]); aB.push(src[o + 2]); }
      }
      const amb = aR.length > 500 ? [med(aR), med(aG), med(aB)] : [200, 198, 194];
      const aM = Math.max(...amb);
      const ambientTint = amb.map(c => +(c / aM).toFixed(4));

      // 8. background plate: divide the garment's colour back out of soft edges
      const plate = document.createElement('canvas'); plate.width = W; plate.height = H;
      const pctx = plate.getContext('2d');
      const pd = pctx.createImageData(W, H);
      for (let i = 0; i < N; i++) {
        const o = i * 4, a = alpha[i];
        if (a > 0.02 && a < 0.60) {
          const den = Math.max(0.15, 1 - a * 0.9);
          pd.data[o] = Math.max(0, Math.min(255, (src[o] - a * 0.9 * shirtRGB[0]) / den));
          pd.data[o + 1] = Math.max(0, Math.min(255, (src[o + 1] - a * 0.9 * shirtRGB[1]) / den));
          pd.data[o + 2] = Math.max(0, Math.min(255, (src[o + 2] - a * 0.9 * shirtRGB[2]) / den));
        } else { pd.data[o] = src[o]; pd.data[o + 1] = src[o + 1]; pd.data[o + 2] = src[o + 2]; }
        pd.data[o + 3] = 255;
      }
      pctx.putImageData(pd, 0, 0);

      // 9. matte + shade maps
      const matte = document.createElement('canvas'); matte.width = W; matte.height = H;
      const mctx = matte.getContext('2d');
      const md = mctx.createImageData(W, H);
      const shade = document.createElement('canvas'); shade.width = W; shade.height = H;
      const sctx = shade.getContext('2d');
      const sd = sctx.createImageData(W, H);
      for (let i = 0; i < N; i++) {
        const o = i * 4;
        const av = Math.round(alpha[i] * 255);
        md.data[o] = av; md.data[o + 1] = av; md.data[o + 2] = av; md.data[o + 3] = 255;
        let t = (vA[i] - vLo) / Math.max(1e-6, vHi - vLo);
        t = Math.pow(Math.max(0, Math.min(1, t)), 0.78);
        const tv = Math.round(t * 255);
        sd.data[o] = tv; sd.data[o + 1] = tv; sd.data[o + 2] = tv; sd.data[o + 3] = 255;
      }
      mctx.putImageData(md, 0, 0);
      sctx.putImageData(sd, 0, 0);

      // 10. print-area quad, as a fraction of the garment bounding box
      const bw = mxX - mnX, bh = mxY - mnY;
      const quad = {
        tl: [mnX + bw * 0.30, mnY + bh * 0.22], tr: [mnX + bw * 0.70, mnY + bh * 0.22],
        br: [mnX + bw * 0.68, mnY + bh * 0.62], bl: [mnX + bw * 0.32, mnY + bh * 0.62],
      };

      // QA metrics
      let missed = 0, skin = 0;
      for (let i = 0; i < N; i++) {
        const o = i * 4; const [h, s, v] = hsv(src[o], src[o + 1], src[o + 2]);
        if (s > 0.20 && v > 0.10 && ad(h, shirtHue) < 35 && alpha[i] < 0.3) missed++;
        if (s > 0.15 && s < 0.55 && v > 0.30 && ad(h, 25) < 25 && alpha[i] > 0.7) skin++;
      }

      return {
        W, H, shirtHue, fragments, ambientTint, quad,
        bbox: { x: mnX, y: mnY, w: bw, h: bh },
        qa: { missedViolet: missed, skinGrabbed: skin },
        plate: plate.toDataURL('image/jpeg', 0.92),
        // Matte stays PNG — its hard silhouette edge is exactly what JPEG ringing
        // would wreck. Shade is a smooth gradient that PNG compresses badly and
        // JPEG handles well, and a little ringing there is invisible.
        matte: matte.toDataURL('image/png'),
        shade: shade.toDataURL('image/jpeg', 0.92),
      };
    }, { b64, MAX_EDGE });

    fs.writeFileSync(path.join(OUT_DIR, `${tpl.id}-plate.jpg`), Buffer.from(r.plate.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT_DIR, `${tpl.id}-matte.png`), Buffer.from(r.matte.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT_DIR, `${tpl.id}-shade.jpg`), Buffer.from(r.shade.split(',')[1], 'base64'));

    manifest.push({
      id: tpl.id, label: tpl.label, model: tpl.model, scene: tpl.scene,
      width: r.W, height: r.H,
      plate: `/assets/on-model/${tpl.id}-plate.jpg`,
      matte: `/assets/on-model/${tpl.id}-matte.png`,
      shade: `/assets/on-model/${tpl.id}-shade.jpg`,
      ambientTint: r.ambientTint,
      quad: r.quad,
      bbox: r.bbox,
    });

    console.log(`${r.W}x${r.H} frags=${r.fragments} missed=${r.qa.missedViolet} skin=${r.qa.skinGrabbed}`);
  }

  fs.writeFileSync(META_OUT, JSON.stringify(manifest, null, 2) + '\n');
  await browser.close();
  console.log(`\n${manifest.length} templates -> ${path.relative(process.cwd(), META_OUT)}`);
})().catch(e => { console.error(e); process.exit(1); });
