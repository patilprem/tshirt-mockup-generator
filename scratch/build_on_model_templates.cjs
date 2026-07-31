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
 *   <id>-shade.jpg   per-pixel illumination relative to the garment's own
 *                    diffuse white point, encoded as rel/REL_MAX. 255 is the
 *                    brightest lit fabric, ~182 (=1.0) the diffuse white point.
 *
 * Storing the true illumination ratio rather than a percentile-normalised
 * position is what lets the runtime relight physically: the diffuse part scales
 * the target colour directly, and anything above the white point becomes an
 * additive sheen. A normalised remap flattens every colour into the same narrow
 * band, which is what made recolours read as poster art rather than cotton.
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

      // A pixel may only ever be claimed as garment if it is at least plausibly
      // shirt — either it carries some hue confidence, or it is dark enough to
      // be fold shadow whose hue has collapsed. Without this the closing below
      // happily bridges the narrow arm-to-torso gap and paints the model's skin.
      const isDarkShadowEarly = i => {
        const v = vA[i];
        if (v >= 0.32) return false;
        if (v < 0.12 && sA[i] < 0.15) return true;
        return ad(hA[i], shirtHue) < 100;
      };
      const plausible = new Uint8Array(N);
      for (let i = 0; i < N; i++) plausible[i] = (a0[i] > 0.02 || isDarkShadowEarly(i)) ? 1 : 0;

      // 4. morphological close bridges dark creases that break hue connectivity
      let core = new Uint8Array(N);
      for (const i of blob) core[i] = 1;
      const dil = m => { const o = new Uint8Array(N); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (m[i] || (x + 1 < W && m[i + 1]) || (x > 0 && m[i - 1]) || (y + 1 < H && m[i + W]) || (y > 0 && m[i - W])) o[i] = 1; } return o; };
      const ero = m => { const o = new Uint8Array(N); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; const l = x > 0 ? m[i - 1] : 0, rr = x + 1 < W ? m[i + 1] : 0, u = y > 0 ? m[i - W] : 0, d = y + 1 < H ? m[i + W] : 0; o[i] = (m[i] && l && rr && u && d) ? 1 : 0; } return o; };
      // Radius is deliberately small. A wide close does span the underarm gap,
      // and once it does no later step can tell the bridged skin from fabric.
      const CR = Math.max(3, Math.round(W / 220));
      let cl = core;
      for (let i = 0; i < CR; i++) cl = dil(cl);
      for (let i = 0; i < CR; i++) cl = ero(cl);
      for (let i = 0; i < N; i++) core[i] = (cl[i] && plausible[i]) ? 1 : 0;
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
      // A 3x3 mean was never a feather — it left the hard staircase visible on
      // any hem. Three separable box passes approximate a gaussian closely
      // enough and stay O(n).
      // ~6px of ramp at template resolution. Wider than this and a garment edge
      // stops looking like cut cotton.
      const FEATHER = Math.max(1, Math.round(W / 1000));
      function boxBlur(srcArr) {
        const tmp = new Float32Array(N), dst = new Float32Array(N);
        for (let y = 0; y < H; y++) {
          let acc = 0;
          for (let x = -FEATHER; x <= FEATHER; x++) acc += srcArr[y * W + Math.min(W - 1, Math.max(0, x))];
          for (let x = 0; x < W; x++) {
            tmp[y * W + x] = acc / (FEATHER * 2 + 1);
            const out = Math.min(W - 1, Math.max(0, x - FEATHER));
            const inn = Math.min(W - 1, Math.max(0, x + FEATHER + 1));
            acc += srcArr[y * W + inn] - srcArr[y * W + out];
          }
        }
        for (let x = 0; x < W; x++) {
          let acc = 0;
          for (let y = -FEATHER; y <= FEATHER; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
          for (let y = 0; y < H; y++) {
            dst[y * W + x] = acc / (FEATHER * 2 + 1);
            const out = Math.min(H - 1, Math.max(0, y - FEATHER));
            const inn = Math.min(H - 1, Math.max(0, y + FEATHER + 1));
            acc += tmp[inn * W + x] - tmp[out * W + x];
          }
        }
        return dst;
      }
      // Cotton is opaque, so coverage is binary everywhere except the one pixel
      // the silhouette actually crosses; blurring that binary mask is what turns
      // it into a ramp. Forcing an eroded interior to 1 and keeping the blurred
      // value outside it seems equivalent but is not — the two meet at a value
      // like 0.79 and jump to 1.0 in a single pixel, and that discontinuity
      // draws a hard line just inside every sleeve and shoulder edge.
      let alpha = new Float32Array(N);
      for (let i = 0; i < N; i++) alpha[i] = a2[i] >= 0.5 ? 1 : 0;
      for (let pass = 0; pass < 3; pass++) alpha = boxBlur(alpha);

      // 7. illumination normalisation + scene ambient
      const cV = [], cR = [], cG = [], cB = [];
      for (const i of blob) { const o = i * 4; cV.push(vA[i]); cR.push(src[o]); cG.push(src[o + 1]); cB.push(src[o + 2]); }
      cV.sort((x, y) => x - y);
      const pct = p => cV[Math.min(cV.length - 1, Math.floor(cV.length * p))];
      // The diffuse white point: fabric at this brightness takes the target
      // colour at full strength, anything above it is sheen.
      const vRef = pct(0.88);
      const REL_MAX = 1.45;
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

      // 8. Background plate.
      //
      // Earlier revisions reconstructed the background by dividing the garment's
      // colour back out of the edge pixels. That reconstruction is where every
      // edge artifact came from: too little and violet bleeds through as a dark
      // rim, too much and clean background gets brightened into a pale one.
      // There is no setting that is right everywhere, because the operation is
      // guessing at information the photo does not contain.
      //
      // Instead, fill the whole garment region — plus a margin covering every
      // contaminated edge pixel — with plausible background, once, here. The
      // runtime composite then becomes an ordinary alpha blend over real pixels,
      // with nothing left to get wrong.
      //
      // The fill is a push-pull pyramid: colour is pulled into successively
      // coarser levels weighted by coverage, then pushed back down to fill holes.
      // Only the few pixels within the feather are ever visible, and those sit
      // directly against known background, so the interpolation there is close
      // to exact. Deeper into the hole it degrades to a smooth gradient, which
      // is fine — the garment covers it completely.
      // Just wide enough to swallow the violet-contaminated fringe and its JPEG
      // bleed. A fat margin looks harmless on open background but destroys real
      // pixels inside narrow gaps — the slot between an arm and the torso can be
      // only a few dozen pixels across, and once both sides are eaten there is
      // nothing left to interpolate from, so the fill invents a flat panel where
      // the photo had a soft shadow.
      const holeR = Math.max(2, Math.round(W / 400));
      let hole = new Uint8Array(N);
      for (let i = 0; i < N; i++) hole[i] = a2[i] > 0.02 ? 1 : 0;
      for (let i = 0; i < holeR; i++) hole = dil(hole);

      const lvR = [], lvG = [], lvB = [], lvW = [], lvDim = [];
      {
        const r0 = new Float32Array(N), g0 = new Float32Array(N), b0 = new Float32Array(N), w0 = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          if (hole[i]) continue;
          const o = i * 4;
          r0[i] = src[o]; g0[i] = src[o + 1]; b0[i] = src[o + 2]; w0[i] = 1;
        }
        lvR.push(r0); lvG.push(g0); lvB.push(b0); lvW.push(w0); lvDim.push([W, H]);
      }
      while (lvDim[lvDim.length - 1][0] > 2 && lvDim[lvDim.length - 1][1] > 2) {
        const [pw, ph] = lvDim[lvDim.length - 1];
        const pr = lvR[lvR.length - 1], pg = lvG[lvG.length - 1], pb = lvB[lvB.length - 1], pwt = lvW[lvW.length - 1];
        const cw = Math.ceil(pw / 2), chh = Math.ceil(ph / 2);
        const cr = new Float32Array(cw * chh), cg = new Float32Array(cw * chh),
              cb = new Float32Array(cw * chh), cwt = new Float32Array(cw * chh);
        for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
          let sr = 0, sg = 0, sb = 0, sw = 0;
          for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
            const fx2 = x * 2 + dx, fy2 = y * 2 + dy;
            if (fx2 >= pw || fy2 >= ph) continue;
            const fi = fy2 * pw + fx2, ww = pwt[fi];
            if (ww <= 0) continue;
            sr += pr[fi] * ww; sg += pg[fi] * ww; sb += pb[fi] * ww; sw += ww;
          }
          const ci = y * cw + x;
          if (sw > 0) { cr[ci] = sr / sw; cg[ci] = sg / sw; cb[ci] = sb / sw; cwt[ci] = Math.min(1, sw / 4); }
        }
        lvR.push(cr); lvG.push(cg); lvB.push(cb); lvW.push(cwt); lvDim.push([cw, chh]);
      }
      for (let L = lvDim.length - 2; L >= 0; L--) {
        const [fw, fh] = lvDim[L], [cw, chh] = lvDim[L + 1];
        const fr = lvR[L], fg = lvG[L], fb = lvB[L], fwt = lvW[L];
        const cr = lvR[L + 1], cg = lvG[L + 1], cb = lvB[L + 1], cwt = lvW[L + 1];
        // Bilinear rather than nearest — sampling the coarse level per 2x2 block
        // quantises the fill into visible squares, and those squares reach the
        // feather band where they would show along the silhouette.
        for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
          const fi = y * fw + x;
          if (fwt[fi] >= 1) continue;
          const gx = Math.min(cw - 1.001, Math.max(0, (x - 0.5) / 2));
          const gy = Math.min(chh - 1.001, Math.max(0, (y - 0.5) / 2));
          const x0 = Math.floor(gx), y0 = Math.floor(gy);
          const x1 = Math.min(cw - 1, x0 + 1), y1 = Math.min(chh - 1, y0 + 1);
          const tx = gx - x0, ty = gy - y0;
          let sr = 0, sg = 0, sb = 0, sw = 0;
          for (const [sx2, sy2, wq] of [[x0, y0, (1 - tx) * (1 - ty)], [x1, y0, tx * (1 - ty)],
                                        [x0, y1, (1 - tx) * ty], [x1, y1, tx * ty]]) {
            const ci = sy2 * cw + sx2, ww = cwt[ci] * wq;
            if (ww <= 0) continue;
            sr += cr[ci] * ww; sg += cg[ci] * ww; sb += cb[ci] * ww; sw += ww;
          }
          if (sw <= 0) continue;
          const a = fwt[fi];
          fr[fi] = fr[fi] * a + (sr / sw) * (1 - a);
          fg[fi] = fg[fi] * a + (sg / sw) * (1 - a);
          fb[fi] = fb[fi] * a + (sb / sw) * (1 - a);
          fwt[fi] = Math.max(a, Math.min(1, sw));
        }
      }

      const plate = document.createElement('canvas'); plate.width = W; plate.height = H;
      const pctx = plate.getContext('2d');
      const pd = pctx.createImageData(W, H);
      const fR = lvR[0], fG = lvG[0], fB = lvB[0];
      for (let i = 0; i < N; i++) {
        const o = i * 4;
        if (hole[i]) {
          pd.data[o] = Math.max(0, Math.min(255, fR[i]));
          pd.data[o + 1] = Math.max(0, Math.min(255, fG[i]));
          pd.data[o + 2] = Math.max(0, Math.min(255, fB[i]));
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
        const rel = vA[i] / Math.max(1e-6, vRef);
        const tv = Math.round(Math.max(0, Math.min(1, rel / REL_MAX)) * 255);
        sd.data[o] = tv; sd.data[o + 1] = tv; sd.data[o + 2] = tv; sd.data[o + 3] = 255;
      }
      mctx.putImageData(md, 0, 0);
      sctx.putImageData(sd, 0, 0);

      // 10. Print-area quad, measured from the garment itself.
      //
      // A fixed fraction of the bounding box cannot work: the box includes both
      // sleeves, so its centre is only the torso's centre when the model happens
      // to be square to camera, and its width has nothing to do with how wide the
      // chest actually is. On a turned pose that puts the print off the body's
      // centre line while still looking suspiciously centred in the frame.
      //
      // Instead, measure the torso directly. Below the sleeves the garment is
      // torso and nothing else, so its width there is a true chest reference.
      // Then walk upward row by row following the run of fabric under the last
      // known centre, limiting how far the centre may travel per row — when the
      // sleeves merge into the torso the run suddenly spans shoulder to shoulder,
      // and without that limit the centre lurches sideways.
      const bw = mxX - mnX, bh = mxY - mnY;
      const rowRuns = y => {
        const runs = []; let start = -1;
        for (let x = mnX; x <= mxX; x++) {
          const on = alpha[y * W + x] > 0.5;
          if (on && start < 0) start = x;
          else if (!on && start >= 0) { runs.push([start, x - 1]); start = -1; }
        }
        if (start >= 0) runs.push([start, mxX]);
        return runs;
      };
      const widths = [];
      for (let y = Math.round(mnY + bh * 0.66); y <= Math.round(mnY + bh * 0.92); y += 2) {
        const runs = rowRuns(y);
        if (!runs.length) continue;
        let best = runs[0];
        for (const r of runs) if (r[1] - r[0] > best[1] - best[0]) best = r;
        widths.push(best[1] - best[0]);
      }
      widths.sort((a, b) => a - b);
      const torsoW = widths.length ? widths[Math.floor(widths.length / 2)] : bw * 0.55;

      let cx = null;
      for (let y = Math.round(mnY + bh * 0.80); y >= Math.round(mnY + bh * 0.66); y--) {
        const runs = rowRuns(y);
        if (!runs.length) continue;
        let best = runs[0];
        for (const r of runs) if (r[1] - r[0] > best[1] - best[0]) best = r;
        cx = (best[0] + best[1]) / 2;
        break;
      }
      if (cx === null) cx = mnX + bw / 2;

      const centreAt = {};
      const MAX_DRIFT = 1.5;
      for (let y = Math.round(mnY + bh * 0.80); y >= mnY; y--) {
        const runs = rowRuns(y);
        if (runs.length) {
          let pick = null;
          for (const r of runs) if (cx >= r[0] - 2 && cx <= r[1] + 2) { pick = r; break; }
          if (!pick) {
            let bd = Infinity;
            for (const r of runs) {
              const d = Math.abs((r[0] + r[1]) / 2 - cx);
              if (d < bd) { bd = d; pick = r; }
            }
          }
          const target = (pick[0] + pick[1]) / 2;
          cx += Math.max(-MAX_DRIFT, Math.min(MAX_DRIFT, target - cx));
        }
        centreAt[y] = cx;
      }

      // A chest print runs roughly from just under the collar to mid-torso, and
      // about 60% of the chest's width — the same proportion the flat-lay print
      // areas use, so a design lands at a comparable size in both modes.
      const topY = Math.round(mnY + bh * 0.21);
      const botY = Math.round(mnY + bh * 0.60);
      const hw = torsoW * 0.30;
      const cTop = centreAt[topY] != null ? centreAt[topY] : mnX + bw / 2;
      const cBot = centreAt[botY] != null ? centreAt[botY] : mnX + bw / 2;
      const quad = {
        tl: [cTop - hw, topY], tr: [cTop + hw, topY],
        br: [cBot + hw, botY], bl: [cBot - hw, botY],
      };

      // QA metrics
      let missed = 0, skin = 0;
      for (let i = 0; i < N; i++) {
        const o = i * 4; const [h, s, v] = hsv(src[o], src[o + 1], src[o + 2]);
        if (s > 0.20 && v > 0.10 && ad(h, shirtHue) < 35 && alpha[i] < 0.3) missed++;
        if (s > 0.15 && s < 0.55 && v > 0.30 && ad(h, 25) < 25 && alpha[i] > 0.7) skin++;
      }

      return {
        W, H, shirtHue, fragments, ambientTint, quad, relMax: REL_MAX,
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
      relMax: r.relMax,
      quad: r.quad,
      bbox: r.bbox,
    });

    console.log(`${r.W}x${r.H} frags=${r.fragments} missed=${r.qa.missedViolet} skin=${r.qa.skinGrabbed}`);
  }

  fs.writeFileSync(META_OUT, JSON.stringify(manifest, null, 2) + '\n');
  await browser.close();
  console.log(`\n${manifest.length} templates -> ${path.relative(process.cwd(), META_OUT)}`);
})().catch(e => { console.error(e); process.exit(1); });
