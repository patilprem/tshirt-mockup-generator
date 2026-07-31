#!/usr/bin/env node
/**
 * Precompute on-model mockup templates.
 *
 * Each source photo is a model wearing a plain vivid-violet crewneck (see
 * MODEL-TEMPLATE-GUIDE for how they're generated). This script analyses each
 * photo once, offline, and emits three flat images plus metadata:
 *
 *   <id>-photo.jpg   the photograph itself, untouched except that violet
 *                    residue in deep dark creases is pre-neutralised toward
 *                    grey (their final look shouldn't depend on the target
 *                    colour anyway, and it stops a violet cast surviving there)
 *   <id>-weight.png  R: per-pixel shirt weight w — how much of this pixel's
 *                       light came from the violet fabric (soft, 0..1)
 *                    G: solid garment coverage, used only to clip the printed
 *                       design so it doesn't spill onto skin or background
 *   <id>-shade.jpg   illumination relative to the fabric's diffuse white
 *                    point, encoded as rel/REL_MAX
 *
 * The runtime never cuts the garment out. It recolours in place:
 *
 *   out = photo + w * (T(shade) - V(shade))
 *
 * where T relights the target colour and V relights the shirt's own violet
 * through the same model. On pure fabric photo ≈ V, so out ≈ T with the
 * photograph's grain riding along as detail. On a boundary pixel that holds
 * half shirt and half background, only the shirt half moves and the real
 * background half stays untouched — which is why the failure modes of
 * cut-and-composite (dark rims, pale halos, alpha steps, matte holes showing
 * a reconstructed plate) cannot occur here: there is no matte and no plate.
 *
 * Usage: node scratch/build_on_model_templates.cjs
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SRC_DIR = process.env.ON_MODEL_SRC || path.join(__dirname, 'on-model-src');
const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'on-model');
const META_OUT = path.join(OUT_DIR, 'templates.json');
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

  const manifest = [];

  for (const tpl of TEMPLATES) {
    const srcPath = path.join(SRC_DIR, tpl.file);
    if (!fs.existsSync(srcPath)) { console.error(`  ! missing ${srcPath}`); continue; }
    const b64 = fs.readFileSync(srcPath).toString('base64');
    process.stdout.write(`${tpl.id} ... `);

    const r = await page.evaluate(async ({ b64, MAX_EDGE }) => {
      const load = s => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = s; });
      const img = await load('data:image/webp;base64,' + b64);
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
      const smooth = (x, a, b) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

      // dominant saturated hue = the shirt's key colour
      const bins = new Float64Array(36);
      for (let i = 0; i < N; i++) {
        const o = i * 4; const [h, s, v] = hsv(src[o], src[o + 1], src[o + 2]);
        if (s > 0.25 && v > 0.15) bins[Math.floor(h / 10) % 36] += s * v;
      }
      let bb = 0, bv = -1;
      for (let i = 0; i < 36; i++) if (bins[i] > bv) { bv = bins[i]; bb = i; }
      const shirtHue = bb * 10 + 5;

      // per-pixel shirt weight: hue proximity gated by saturation and value.
      // Deliberately soft — the runtime uses it as a linear mixing fraction,
      // so smoothness here is smoothness in the final image.
      const hA = new Float32Array(N), sA = new Float32Array(N), vA = new Float32Array(N);
      const wRaw = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const o = i * 4; const [h, s, v] = hsv(src[o], src[o + 1], src[o + 2]);
        hA[i] = h; sA[i] = s; vA[i] = v;
        const hd = ad(h, shirtHue);
        const wh = hd <= 22 ? 1 : hd >= 40 ? 0 : 0.5 + 0.5 * Math.cos((hd - 22) / 18 * Math.PI);
        wRaw[i] = wh * smooth(s, 0.08, 0.22) * smooth(v, 0.05, 0.12);
      }

      // connected components over confident pixels; keep fragments near the
      // main body (a raised arm can split the garment)
      const vis = new Uint8Array(N), blobs = [];
      let best = null, bestN = 0;
      const qx = new Int32Array(N), qy = new Int32Array(N);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i0 = y * W + x;
        if (vis[i0] || wRaw[i0] < 0.5) continue;
        let qh = 0, qt = 0; qx[qt] = x; qy[qt] = y; qt++; vis[i0] = 1;
        const mem = [i0];
        while (qh < qt) {
          const cx = qx[qh], cy = qy[qh]; qh++;
          for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const ni = ny * W + nx;
            if (vis[ni] || wRaw[ni] < 0.5) continue;
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
        let ccx = 0, ccy = 0;
        for (const i of m) { ccx += i % W; ccy += (i / W) | 0; }
        ccx /= m.length; ccy /= m.length;
        if (ccx >= bx0 - PAD && ccx <= bx1 + PAD && ccy >= by0 - PAD && ccy <= by1 + PAD) kept.push(m);
      }
      const fragments = kept.length;
      const blob = kept.flat();

      const dil = m => { const o = new Uint8Array(N); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (m[i] || (x + 1 < W && m[i + 1]) || (x > 0 && m[i - 1]) || (y + 1 < H && m[i + W]) || (y > 0 && m[i - W])) o[i] = 1; } return o; };
      const ero = m => { const o = new Uint8Array(N); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; const l = x > 0 ? m[i - 1] : 0, rr = x + 1 < W ? m[i + 1] : 0, u = y > 0 ? m[i - W] : 0, d = y + 1 < H ? m[i + W] : 0; o[i] = (m[i] && l && rr && u && d) ? 1 : 0; } return o; };

      // solid coverage: close small dark creases, but only over pixels that are
      // at least plausibly shirt so the closing can't bridge onto skin across
      // the narrow arm-to-torso gap
      const isDarkShadow = i => { const v = vA[i]; if (v >= 0.32) return false; if (v < 0.12 && sA[i] < 0.15) return true; return ad(hA[i], shirtHue) < 100; };
      const plausible = new Uint8Array(N);
      for (let i = 0; i < N; i++) plausible[i] = (wRaw[i] > 0.02 || isDarkShadow(i)) ? 1 : 0;
      let core = new Uint8Array(N);
      for (const i of blob) core[i] = 1;
      const CR = Math.max(3, Math.round(W / 220));
      let cl = core;
      for (let i = 0; i < CR; i++) cl = dil(cl);
      for (let i = 0; i < CR; i++) cl = ero(cl);
      for (let i = 0; i < N; i++) core[i] = (cl[i] && plausible[i]) ? 1 : 0;

      const FEATHER = Math.max(1, Math.round(W / 1000));
      function boxBlur(srcArr, R) {
        const tmp = new Float32Array(N), dst = new Float32Array(N);
        for (let y = 0; y < H; y++) {
          let acc = 0;
          for (let x = -R; x <= R; x++) acc += srcArr[y * W + Math.min(W - 1, Math.max(0, x))];
          for (let x = 0; x < W; x++) {
            tmp[y * W + x] = acc / (R * 2 + 1);
            const out = Math.min(W - 1, Math.max(0, x - R));
            const inn = Math.min(W - 1, Math.max(0, x + R + 1));
            acc += srcArr[y * W + inn] - srcArr[y * W + out];
          }
        }
        for (let x = 0; x < W; x++) {
          let acc = 0;
          for (let y = -R; y <= R; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
          for (let y = 0; y < H; y++) {
            dst[y * W + x] = acc / (R * 2 + 1);
            const out = Math.min(H - 1, Math.max(0, y - R));
            const inn = Math.min(H - 1, Math.max(0, y + R + 1));
            acc += tmp[inn * W + x] - tmp[out * W + x];
          }
        }
        return dst;
      }

      // design-clip mask: binary coverage blurred into a smooth sigmoid —
      // reaches 1 by construction, no splice, no step
      let clip = new Float32Array(N);
      for (let i = 0; i < N; i++) clip[i] = core[i] ? 1 : 0;
      for (let p = 0; p < 3; p++) clip = boxBlur(clip, FEATHER);

      // recolour weight. Inside the solid coverage every pixel is 100% shirt no
      // matter what the hue key thinks — a blown highlight desaturates until the
      // hue signal collapses, and trusting the hue there leaves original violet
      // speckle in bright areas. So the weight is the union: solid coverage
      // carries the interior, the soft hue weight carries the boundary band and
      // any spill fringe, and a dilated gate keeps stray violet elsewhere in
      // the frame from ever shifting colour.
      // The gate floods outward from the core through plausibly-shirt pixels,
      // then dilates a little. Fixed dilation alone can't reach the middle of a
      // wide deep-shadow fold at the hem, and anything the gate misses keeps
      // its original violet under every recolour.
      const gate = new Uint8Array(N);
      {
        const DMX = Math.max(30, Math.round(W / 8));
        const dist = new Int16Array(N).fill(-1);
        let fh = 0, ft = 0;
        const fx2 = new Int32Array(N), fy2 = new Int32Array(N);
        for (let i = 0; i < N; i++) if (core[i]) { dist[i] = 0; fx2[ft] = i % W; fy2[ft] = (i / W) | 0; ft++; }
        while (fh < ft) {
          const cx2 = fx2[fh], cy2 = fy2[fh]; fh++;
          const dd = dist[cy2 * W + cx2];
          if (dd >= DMX) continue;
          for (const [nx, ny] of [[cx2 + 1, cy2], [cx2 - 1, cy2], [cx2, cy2 + 1], [cx2, cy2 - 1]]) {
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const ni = ny * W + nx;
            if (dist[ni] !== -1 || !plausible[ni]) continue;
            dist[ni] = dd + 1; fx2[ft] = nx; fy2[ft] = ny; ft++;
          }
        }
        let gm = new Uint8Array(N);
        for (let i = 0; i < N; i++) gm[i] = dist[i] !== -1 ? 1 : 0;
        const GR = Math.max(3, Math.round(W / 150));
        for (let i = 0; i < GR; i++) gm = dil(gm);
        gate.set(gm);
      }

      // In-gate recolour weight, the union of four signals:
      //  - clip: solid coverage carries the interior regardless of hue
      //  - wRaw: the strict key, shapes the true boundary band
      //  - wide: an asymmetric hue window. Violet may drift magenta-ward under
      //    warm bounce (+65° is safe, nothing in any scene is magenta) but only
      //    modestly blue-ward (-45°), because denim sits 62° blue of violet.
      //  - dark: deep fold shadows keep a violet-family hue but lose sat and
      //    value below the strict key's floor; anything hue-vaguely violet,
      //    still saturated, and dark inside the gate is fold shadow.
      const sgn = h => { let d = ((h - shirtHue + 540) % 360) - 180; return d; };
      let wMap = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        if (!gate[i]) continue;
        const d = sgn(hA[i]);
        const lim = d >= 0 ? 65 : 45;
        const a = Math.abs(d);
        const wide = (a <= 30 ? 1 : a >= lim ? 0 : 0.5 + 0.5 * Math.cos((a - 30) / (lim - 30) * Math.PI))
          * smooth(sA[i], 0.05, 0.15) * smooth(vA[i], 0.03, 0.08);
        const dark = (a < 80 ? 1 : 0)
          * smooth(sA[i], 0.08, 0.18) * (1 - smooth(vA[i], 0.26, 0.34));
        wMap[i] = Math.max(clip[i], wRaw[i], wide, dark);
      }
      wMap = boxBlur(wMap, 1);

      // illumination reference over confident fabric
      const cV = [], cR = [], cG = [], cB = [];
      for (let i = 0; i < N; i++) if (core[i]) { const o = i * 4; cV.push(vA[i]); cR.push(src[o]); cG.push(src[o + 1]); cB.push(src[o + 2]); }
      cV.sort((x, y) => x - y);
      const pct = p => cV[Math.min(cV.length - 1, Math.floor(cV.length * p))];
      const vRef = pct(0.88);
      const REL_MAX = 1.45;
      const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
      const shirtRGB = [med(cR), med(cG), med(cB)];
      const chromaMax = Math.max(...shirtRGB);
      // the violet the relight model must reproduce at rel = 1
      const violetBase = shirtRGB.map(c => +(c / chromaMax * vRef * 255).toFixed(1));

      // scene ambient from low-sat bright pixels outside the garment's gate
      const aR = [], aG = [], aB = [];
      for (let i = 0; i < N; i += 5) {
        if (gate[i]) continue;
        const o = i * 4; const [h, s, v] = hsv(src[o], src[o + 1], src[o + 2]);
        if (s < 0.18 && v > 0.55) { aR.push(src[o]); aG.push(src[o + 1]); aB.push(src[o + 2]); }
      }
      const amb = aR.length > 500 ? [med(aR), med(aG), med(aB)] : [200, 198, 194];
      const aM = Math.max(...amb);
      const ambientTint = amb.map(c => +(c / aM).toFixed(4));

      // photo, with violet residue in deep low-weight creases neutralised —
      // those pixels keep their photographic darkness under every target
      // colour, and a violet cast there would read as a defect on pale shirts
      const photo = document.createElement('canvas'); photo.width = W; photo.height = H;
      const pctx = photo.getContext('2d');
      const pd = pctx.createImageData(W, H);
      for (let i = 0; i < N; i++) {
        const o = i * 4;
        let r = src[o], g = src[o + 1], b = src[o + 2];
        if (gate[i]) {
          const dark = 1 - smooth(vA[i], 0.22, 0.42);
          const kk = Math.min(1, (1 - wMap[i]) * dark);
          if (kk > 0) {
            const L = 0.299 * r + 0.587 * g + 0.114 * b;
            r = r + (L - r) * kk; g = g + (L - g) * kk; b = b + (L - b) * kk;
          }
        }
        pd.data[o] = r; pd.data[o + 1] = g; pd.data[o + 2] = b; pd.data[o + 3] = 255;
      }
      pctx.putImageData(pd, 0, 0);

      // weight map: R = recolour weight, G = design clip
      const wpng = document.createElement('canvas'); wpng.width = W; wpng.height = H;
      const wctx = wpng.getContext('2d');
      const wd = wctx.createImageData(W, H);
      for (let i = 0; i < N; i++) {
        const o = i * 4;
        wd.data[o] = Math.round(Math.max(0, Math.min(1, wMap[i])) * 255);
        wd.data[o + 1] = Math.round(Math.max(0, Math.min(1, clip[i])) * 255);
        wd.data[o + 2] = 0; wd.data[o + 3] = 255;
      }
      wctx.putImageData(wd, 0, 0);

      // shade map
      const shadeCv = document.createElement('canvas'); shadeCv.width = W; shadeCv.height = H;
      const sctx = shadeCv.getContext('2d');
      const sd = sctx.createImageData(W, H);
      for (let i = 0; i < N; i++) {
        const o = i * 4;
        const rel = vA[i] / Math.max(1e-6, vRef);
        const tv = Math.round(Math.max(0, Math.min(1, rel / REL_MAX)) * 255);
        sd.data[o] = tv; sd.data[o + 1] = tv; sd.data[o + 2] = tv; sd.data[o + 3] = 255;
      }
      sctx.putImageData(sd, 0, 0);

      // print-area quad measured from the torso: width from the sleeve-free
      // band, centre tracked upward with bounded drift
      let mnX = W, mnY = H, mxX = 0, mxY = 0;
      for (let i = 0; i < N; i++) if (core[i]) { const x = i % W, y = (i / W) | 0; if (x < mnX) mnX = x; if (x > mxX) mxX = x; if (y < mnY) mnY = y; if (y > mxY) mxY = y; }
      const bw = mxX - mnX, bh = mxY - mnY;
      const rowRuns = y => {
        const runs = []; let start = -1;
        for (let x = mnX; x <= mxX; x++) {
          const on = core[y * W + x] > 0;
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
        let bestR = runs[0];
        for (const rr of runs) if (rr[1] - rr[0] > bestR[1] - bestR[0]) bestR = rr;
        widths.push(bestR[1] - bestR[0]);
      }
      widths.sort((a, b) => a - b);
      const torsoW = widths.length ? widths[Math.floor(widths.length / 2)] : bw * 0.55;
      let cx = null;
      for (let y = Math.round(mnY + bh * 0.80); y >= Math.round(mnY + bh * 0.66); y--) {
        const runs = rowRuns(y);
        if (!runs.length) continue;
        let bestR = runs[0];
        for (const rr of runs) if (rr[1] - rr[0] > bestR[1] - bestR[0]) bestR = rr;
        cx = (bestR[0] + bestR[1]) / 2; break;
      }
      if (cx === null) cx = mnX + bw / 2;
      const centreAt = {};
      for (let y = Math.round(mnY + bh * 0.80); y >= mnY; y--) {
        const runs = rowRuns(y);
        if (runs.length) {
          let pick = null;
          for (const rr of runs) if (cx >= rr[0] - 2 && cx <= rr[1] + 2) { pick = rr; break; }
          if (!pick) { let bd = Infinity; for (const rr of runs) { const d = Math.abs((rr[0] + rr[1]) / 2 - cx); if (d < bd) { bd = d; pick = rr; } } }
          const target = (pick[0] + pick[1]) / 2;
          cx += Math.max(-1.5, Math.min(1.5, target - cx));
        }
        centreAt[y] = cx;
      }
      const topY = Math.round(mnY + bh * 0.21), botY = Math.round(mnY + bh * 0.60);
      const hw = torsoW * 0.30;
      const cTop = centreAt[topY] != null ? centreAt[topY] : mnX + bw / 2;
      const cBot = centreAt[botY] != null ? centreAt[botY] : mnX + bw / 2;
      const quad = { tl: [cTop - hw, topY], tr: [cTop + hw, topY], br: [cBot + hw, botY], bl: [cBot - hw, botY] };

      // QA. modelFit: mean |photo - V(shade)| over confident fabric — the
      // relight model's reproduction error, which the runtime carries over as
      // preserved grain. Small and tight is what we want.
      const tLumV = (violetBase[0] + violetBase[1] + violetBase[2]) / 765;
      const GAV = 1 - 0.55 * tLumV, TIV = 0.35 * tLumV, SPV = 0.28;
      let fitSum = 0, fitCnt = 0;
      for (let i = 0; i < N; i += 3) {
        if (wMap[i] < 0.9) continue;
        const rel = Math.min(REL_MAX, vA[i] / Math.max(1e-6, vRef));
        const diff = Math.pow(Math.min(rel, 1), GAV);
        const wgt = (1 - diff) * TIV;
        let vr = violetBase[0] * diff * (1 - wgt + wgt * ambientTint[0]);
        let vg = violetBase[1] * diff * (1 - wgt + wgt * ambientTint[1]);
        let vb = violetBase[2] * diff * (1 - wgt + wgt * ambientTint[2]);
        if (rel > 1) { const sp = Math.min(1, (rel - 1) / (REL_MAX - 1)) * SPV; vr += (255 - vr) * sp; vg += (255 - vg) * sp; vb += (255 - vb) * sp; }
        const o = i * 4;
        fitSum += (Math.abs(src[o] - vr) + Math.abs(src[o + 1] - vg) + Math.abs(src[o + 2] - vb)) / 3;
        fitCnt++;
      }
      let missed = 0, skin = 0;
      for (let i = 0; i < N; i++) {
        if (sA[i] > 0.25 && vA[i] > 0.15 && ad(hA[i], shirtHue) < 30 && wMap[i] < 0.3) missed++;
        if (sA[i] > 0.15 && sA[i] < 0.55 && vA[i] > 0.30 && ad(hA[i], 25) < 25 && wMap[i] > 0.7) skin++;
      }

      return {
        W, H, shirtHue, fragments, ambientTint, quad,
        bbox: { x: mnX, y: mnY, w: bw, h: bh },
        vRef: +vRef.toFixed(4), relMax: REL_MAX, violetBase,
        qa: { missed, skin, modelFit: +(fitSum / Math.max(1, fitCnt)).toFixed(2) },
        photo: photo.toDataURL('image/jpeg', 0.92),
        weight: wpng.toDataURL('image/png'),
        shade: shadeCv.toDataURL('image/jpeg', 0.92),
      };
    }, { b64, MAX_EDGE });

    fs.writeFileSync(path.join(OUT_DIR, `${tpl.id}-photo.jpg`), Buffer.from(r.photo.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT_DIR, `${tpl.id}-weight.png`), Buffer.from(r.weight.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT_DIR, `${tpl.id}-shade.jpg`), Buffer.from(r.shade.split(',')[1], 'base64'));

    manifest.push({
      id: tpl.id, label: tpl.label, model: tpl.model, scene: tpl.scene,
      width: r.W, height: r.H,
      photo: `/assets/on-model/${tpl.id}-photo.jpg`,
      weight: `/assets/on-model/${tpl.id}-weight.png`,
      shade: `/assets/on-model/${tpl.id}-shade.jpg`,
      ambientTint: r.ambientTint, relMax: r.relMax, violetBase: r.violetBase,
      quad: r.quad, bbox: r.bbox,
    });

    console.log(`${r.W}x${r.H} frags=${r.fragments} missed=${r.qa.missed} skin=${r.qa.skin} modelFit=${r.qa.modelFit}`);
  }

  fs.writeFileSync(META_OUT, JSON.stringify(manifest, null, 2) + '\n');
  await browser.close();
  console.log(`\n${manifest.length} templates -> ${path.relative(process.cwd(), META_OUT)}`);
})().catch(e => { console.error(e); process.exit(1); });
