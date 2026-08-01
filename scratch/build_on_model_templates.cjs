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
 *                    B: own-value blend — which violet the runtime subtracts
 *                       here, the modelled violet (0) or this pixel's own
 *                       value (1). Driven by how much colour information the
 *                       pixel carries, so an information-free crease blends
 *                       between itself and the target instead of having
 *                       saturated modelled violet subtracted out of it.
 *                       Kept separate from G on purpose: coverage and
 *                       information content are unrelated questions, and
 *                       conflating them is what put green blotches in
 *                       underarm creases.
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

    const dbgPx = (tpl.id === process.env.DBG_ID && process.env.DBG_PX)
      ? process.env.DBG_PX.split(';').map(t => t.split(',').map(Number)) : [];
    const r = await page.evaluate(async ({ b64, MAX_EDGE, dbgPx }) => {
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
      // Interior holes: non-core pixels that cannot reach the image border
      // without crossing fabric. A deep fold's neutral-black centre is enclosed
      // this way; background, hair and skin always connect outward. Enclosed
      // neutral-dark pixels are fold shadow by construction, so recolouring
      // them is safe for every target — and necessary for pale ones, where the
      // photograph's near-black fold core would otherwise sit untouched next to
      // a lifted penumbra and read as a painted black streak.
      const outside = new Uint8Array(N);
      {
        let fh2 = 0, ft2 = 0;
        const ox = new Int32Array(N), oy = new Int32Array(N);
        const push = (x, y) => { const i = y * W + x; if (!outside[i] && !core[i]) { outside[i] = 1; ox[ft2] = x; oy[ft2] = y; ft2++; } };
        for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
        for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
        while (fh2 < ft2) {
          const cx2 = ox[fh2], cy2 = oy[fh2]; fh2++;
          for (const [nx, ny] of [[cx2 + 1, cy2], [cx2 - 1, cy2], [cx2, cy2 + 1], [cx2, cy2 - 1]]) {
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            push(nx, ny);
          }
        }
      }

      const sgn = h => { let d = ((h - shirtHue + 540) % 360) - 180; return d; };
      let wMap = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        if (!gate[i]) continue;
        const d = sgn(hA[i]);
        // Shadows shift blue-ward: in a deep fold the ambient sky/room bounce
        // dominates over the direct light, so violet fabric reads up to ~70deg
        // bluer than in full light. A fixed limit clips exactly those pixels and
        // leaves half-recoloured specks in creases. Denim stays excluded because
        // the widening only applies to dark pixels and denim is bright.
        const lim = d >= 0 ? 65 : 45 + 25 * (1 - smooth(vA[i], 0.10, 0.30));
        const a = Math.abs(d);
        const wide = (a <= 30 ? 1 : a >= lim ? 0 : 0.5 + 0.5 * Math.cos((a - 30) / (lim - 30) * Math.PI))
          * smooth(sA[i], 0.05, 0.15) * smooth(vA[i], 0.03, 0.08);
        const dark = (a < 80 ? 1 : 0)
          * smooth(sA[i], 0.08, 0.18) * (1 - smooth(vA[i], 0.26, 0.34));
        const enclosed = (!core[i] && !outside[i])
          ? (1 - smooth(sA[i], 0.10, 0.20)) * (1 - smooth(vA[i], 0.16, 0.28))
          : 0;
        // clip's sigmoid deliberately reaches a few pixels past the core so the
        // printed design gets a soft edge — but those outer pixels are pure
        // background, and letting clip feed the recolour weight there paints
        // the target colour onto the wall as a bright rim around the whole
        // silhouette. Border-connected background never takes the clip floor;
        // genuine boundary pixels keep their weight through wRaw, which
        // measures the violet actually present in them.
        const clipIn = outside[i] ? 0 : clip[i];
        wMap[i] = Math.max(clipIn, wRaw[i], wide, dark, enclosed);
      }
      wMap = boxBlur(wMap, 1);
      // On the background side of the silhouette, RECOLOUR weight follows the
      // strict key only, smoothly tapered — a hard cutoff makes a jagged
      // edge, and painting anything further out risks a glowing target-
      // coloured rim on pale shirts (the delta being added is target-vs-
      // violet, which is bright for pale targets no matter how violet-tinted
      // the pixel was). Everything else violet on the background side —
      // light bloom scattered off the fabric, compression bleed baked into
      // the source, seam pixels mixed with skin (which drift into a mauve
      // corridor: hue up to +80 magenta-ward, violet content showing as
      // blue exceeding green, a signature skin/foliage/warm walls never
      // have) — is NEUTRALISED IN THE PHOTO instead: chroma pulled toward
      // the pixel's own luminance in proportion to the violet evidence. That
      // is target-independent, so it can never glow and never paint; the
      // seam ring just becomes achromatic anti-aliasing under every colour.
      const evAny = new Float32Array(N);
      const neut = new Float32Array(N);
      for (let i = 0; i < N; i++) if (outside[i]) {
        const d2 = sgn(hA[i]);
        const lim2 = d2 >= 0 ? 65 : 45 + 25 * (1 - smooth(vA[i], 0.10, 0.30));
        const a2 = Math.abs(d2);
        const hueClose = a2 <= 30 ? 1 : a2 >= lim2 ? 0 : 0.5 + 0.5 * Math.cos((a2 - 30) / (lim2 - 30) * Math.PI);
        const evChroma = hueClose * smooth(sA[i], 0.05, 0.18);
        const o = i * 4;
        // green-deficit: violet content pushes both R and B above G; skin,
        // foliage and warm walls never do. Catches mauve seam mixes whose
        // blue-excess alone is masked by the skin's red dominance.
        const gd = Math.max(0, (src[o] + src[o + 2]) / 2 - src[o + 1]) / 255;
        const hueMix = d2 >= -10 && d2 <= 70 ? 1
          : d2 > 70 && d2 < 90 ? 0.5 + 0.5 * Math.cos((d2 - 70) / 20 * Math.PI)
          : d2 < -10 && d2 > -25 ? 0.5 + 0.5 * Math.cos((-10 - d2) / 15 * Math.PI)
          : 0;
        const evMix = hueMix * smooth(gd, 0.015, 0.07) * smooth(clip[i], 0.01, 0.12);
        const tap = smooth(wRaw[i], 0.008, 0.05);
        // A deep underarm or hem crevice is GARMENT in shadow, not an edge
        // mix: the strict key drops it (hue drifts and the value floor
        // cuts it) but it is still strongly saturated violet, which a
        // fabric/background mixture never is — a mixed pixel's saturation
        // is diluted by the background. High saturation inside the violet
        // hue corridor therefore means fabric, and it keeps full weight so
        // the crevice recolours to a dark tone of the target instead of
        // staying black under a white shirt.
        const fabricEv = hueClose * smooth(sA[i], 0.18, 0.32);
        wMap[i] *= Math.max(tap, fabricEv);
        neut[i] = Math.max(evChroma, evMix);
        evAny[i] = Math.max(tap, fabricEv, evChroma, evMix);
      }

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

      // an isolated painted pixel inside dark background-side shadow reads
      // as speckle; give it its darkest neighbour's weight so crevices are
      // treated uniformly (photographic penumbra, not dots)
      {
        const wm2 = new Float32Array(wMap);
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          if (!outside[i] || vA[i] > 0.34 || evAny[i] > 0.25) continue;
          let mn = wMap[i];
          for (const ni of [i - 1, i + 1, i - W, i + W, i - W - 1, i - W + 1, i + W - 1, i + W + 1])
            if (wMap[ni] < mn) mn = wMap[ni];
          wm2[i] = mn;
        }
        wMap = wm2;
      }

      // Illumination per pixel, needed by the matting bake below and written
      // out as the shade map later. On the background side of the silhouette
      // the shade is propagated outward from the nearest fabric: a boundary
      // pixel's own brightness is contaminated by whatever is behind it.
      const shadeVal = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const rel = vA[i] / Math.max(1e-6, vRef);
        shadeVal[i] = Math.max(0, Math.min(1, rel / REL_MAX));
      }
      {
        const have = new Uint8Array(N);
        for (let i = 0; i < N; i++) have[i] = outside[i] ? 0 : 1;
        for (let pass = 0; pass < 8; pass++) {
          const nh = new Uint8Array(have);
          for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
            const i = y * W + x;
            if (have[i] || !gate[i] || !outside[i]) continue;
            let sum = 0, c = 0;
            for (const ni of [i - 1, i + 1, i - W, i + W]) if (have[ni]) { sum += shadeVal[ni]; c++; }
            // min(): a boundary pixel takes the fabric shade only when its own
            // reading is BRIGHTER (background contamination). A dark crevice
            // pixel keeps its own darkness — assigning it the lit fabric shade
            // makes the runtime add a lit-target-minus-lit-violet delta to a
            // dark pixel: green flecks on white. Safe now that the matting bake
            // keeps subtraction self-consistent at any shade.
            if (c) { shadeVal[i] = Math.min(shadeVal[i], sum / c); nh[i] = 1; }
          }
          have.set(nh);
        }
      }

      // The same relight model the runtime uses — the bake must cancel against
      // the runtime's own violet reference exactly.
      const mkRelight = (rgb) => {
        const [ar, ag, ab] = ambientTint;
        const tLum = (rgb[0] + rgb[1] + rgb[2]) / 765;
        const GAMMA = 1 - 0.55 * tLum, TINT = 0.35 * tLum, SPEC = 0.28;
        const lut = new Float32Array(256 * 3);
        for (let s2 = 0; s2 < 256; s2++) {
          const rel = (s2 / 255) * REL_MAX;
          const diff = Math.pow(Math.min(rel, 1), GAMMA);
          const wgt = (1 - diff) * TINT;
          let r = rgb[0] * diff * (1 - wgt + wgt * ar);
          let g = rgb[1] * diff * (1 - wgt + wgt * ag);
          let b = rgb[2] * diff * (1 - wgt + wgt * ab);
          if (rel > 1) { const sp = Math.min(1, (rel - 1) / (REL_MAX - 1)) * SPEC; r += (255 - r) * sp; g += (255 - g) * sp; b += (255 - b) * sp; }
          lut[s2 * 3] = r; lut[s2 * 3 + 1] = g; lut[s2 * 3 + 2] = b;
        }
        return lut;
      };
      const lutVm = mkRelight(violetBase);

      // ---- boundary alpha matting: the definitive edge treatment ----
      // Every silhouette pixel is a physical mix a*fabric + (1-a)*background.
      // The builder knows both endpoints (fabric colour diffused from the
      // garment side, background colour diffused from beyond the ring), so a
      // is SOLVED per pixel, not guessed from hue heuristics. The photo is
      // then baked to a*V(shade) + (1-a)*background — the model's own violet —
      // and the runtime, with weight a and clip 0, reconstructs
      //   out = (1-a)*background + a*T(shade)
      // — a convex combination of two correct endpoints. A dark outline, a
      // pale halo, a glow, or leftover violet are all outside that hull and
      // therefore impossible, for every target colour. Pixels the mix model
      // cannot explain (hair strands crossing the edge, real seam shadows)
      // fall back to the taper + neutralise path via a residual-based
      // confidence, keeping their photographic reality.
      const RING = Math.max(4, Math.round(W / 220));
      const distC = new Int16Array(N).fill(-1);
      {
        let qh = 0, qt = 0;
        const qxx = new Int32Array(N), qyy = new Int32Array(N);
        for (let i = 0; i < N; i++) if (core[i]) { distC[i] = 0; qxx[qt] = i % W; qyy[qt] = (i / W) | 0; qt++; }
        while (qh < qt) {
          const cx3 = qxx[qh], cy3 = qyy[qh]; qh++;
          const dd = distC[cy3 * W + cx3];
          if (dd >= RING) continue;
          for (const [nx, ny] of [[cx3 + 1, cy3], [cx3 - 1, cy3], [cx3, cy3 + 1], [cx3, cy3 - 1]]) {
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const ni = ny * W + nx;
            if (distC[ni] !== -1) continue;
            distC[ni] = dd + 1; qxx[qt] = nx; qyy[qt] = ny; qt++;
          }
        }
      }
      const ring = new Uint8Array(N);
      for (let i = 0; i < N; i++) if (outside[i] && distC[i] > 0) ring[i] = 1;

      const diffuseInto = (seedMask) => {
        const out = new Float32Array(N * 3);
        const fd = new Int16Array(N).fill(-1);
        const have = new Uint8Array(N);
        for (let i = 0; i < N; i++) if (seedMask(i)) {
          have[i] = 1; fd[i] = 0; const o = i * 4;
          out[i * 3] = src[o]; out[i * 3 + 1] = src[o + 1]; out[i * 3 + 2] = src[o + 2];
        }
        for (let pass = 0; pass < RING + 6; pass++) {
          const nh = new Uint8Array(have);
          for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
            const i = y * W + x;
            if (have[i] || !ring[i]) continue;
            let sr = 0, sg = 0, sb2 = 0, c = 0;
            for (const ni of [i - 1, i + 1, i - W, i + W]) if (have[ni]) { sr += out[ni * 3]; sg += out[ni * 3 + 1]; sb2 += out[ni * 3 + 2]; c++; }
            if (c) { out[i * 3] = sr / c; out[i * 3 + 1] = sg / c; out[i * 3 + 2] = sb2 / c; nh[i] = 1; fd[i] = pass + 1; }
          }
          have.set(nh);
        }
        return { c: out, fd };
      };
      const bgF = diffuseInto(i => outside[i] && !ring[i]);
      const fgF = diffuseInto(i => !outside[i]);
      const bgC = bgF.c, fgC = fgF.c;

      // A deep crevice (underarm gap, hem fold) is enclosed by garment: no
      // real background is reachable, yet the border flood labelled it
      // 'outside' by squeezing through the gap. Left alone it keeps the
      // photograph's near-black violet and reads as a black hole under a
      // white shirt. Dark pixels close to the garment whose background is
      // unreachable are therefore GARMENT shadow: full weight, and clip 1
      // so the runtime subtracts the pixel's own value (chroma-exact — no
      // green cast) and lands on the target's own shadow tone.
      const CREV = Math.max(RING + 2, Math.round(W / 18));
      const distX = new Int16Array(N).fill(-1);
      {
        let qh = 0, qt = 0;
        const ax = new Int32Array(N), ay = new Int32Array(N);
        for (let i = 0; i < N; i++) if (core[i]) { distX[i] = 0; ax[qt] = i % W; ay[qt] = (i / W) | 0; qt++; }
        while (qh < qt) {
          const cx4 = ax[qh], cy4 = ay[qh]; qh++;
          const dd = distX[cy4 * W + cx4];
          if (dd >= CREV) continue;
          for (const [nx, ny] of [[cx4 + 1, cy4], [cx4 - 1, cy4], [cx4, cy4 + 1], [cx4, cy4 - 1]]) {
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const ni = ny * W + nx;
            if (distX[ni] !== -1) continue;
            distX[ni] = dd + 1; ax[qt] = nx; ay[qt] = ny; qt++;
          }
        }
      }
      // Proximity alone is not enclosure — dark hair and dark scenery also
      // sit near the garment. A crevice is surrounded BY the garment, so
      // rays cast from it hit fabric in almost every direction; hair beside
      // a shoulder has open sky on most rays.
      // Enclosure and darkness are measured as CONTINUOUS quantities, not
      // used to make a yes/no call. A near-black pixel carries no usable hue
      // or saturation - it is codec noise - so any per-pixel decision there
      // flips neighbours differently and produces isolated specks. What is
      // recorded instead is how UNRELIABLE each pixel's own reading is.
      // Unreliability means one thing only: the pixel carries no information.
      // Below ~0.26 value both hue and saturation collapse into codec noise,
      // so nothing about such a pixel can be decided from its own colour --
      // and any threshold applied there flips neighbours differently, which
      // IS the speckle. No geometric test is used: where the value comes
      // from is settled by the Poisson solve's boundary conditions, which
      // pull a fabric-enclosed crevice to garment weight and a dark patch
      // open to the scene to zero, with no jump in between.
      const crevice = new Uint8Array(N);
      const unrel = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        // Measured for EVERY pixel, core included. How much colour information
        // a pixel carries is a property of the pixel, not of which label the
        // segmentation gave it — and a dark pixel just inside the core is as
        // information-free as one just outside. Skipping core here left those
        // pixels falling back to the blurred coverage ramp (~0.5) as their
        // own-value blend, so half the modelled violet was still subtracted
        // from a near-neutral hem shadow and it rendered green.
        // Bright core pixels are unaffected: high value drives u to 0.
        //
        // A warm or green cast IS information: it identifies hair, skin or
        // foliage, none of which are violet fabric. Only a dark pixel that is
        // also chromatically neutral tells us nothing at all.
        const o2 = i * 4;
        const chroma = Math.max(src[o2] - src[o2 + 2], src[o2 + 1] - Math.max(src[o2], src[o2 + 2]));
        const u = (1 - smooth(vA[i], 0.12, 0.36)) * (1 - smooth(chroma, 4, 14));
        unrel[i] = u;
        if (u > 0.5 && !core[i]) crevice[i] = 1;
      }

      const alphaA = new Float32Array(N), confA = new Float32Array(N);
      let wedgePx = 0;
      for (let i = 0; i < N; i++) if (ring[i]) {
        const o = i * 4;
        const fr = fgC[i * 3] - bgC[i * 3], fg2 = fgC[i * 3 + 1] - bgC[i * 3 + 1], fb = fgC[i * 3 + 2] - bgC[i * 3 + 2];
        const den = fr * fr + fg2 * fg2 + fb * fb;
        if (den < 100) continue;
        const dr = src[o] - bgC[i * 3], dg = src[o + 1] - bgC[i * 3 + 1], db = src[o + 2] - bgC[i * 3 + 2];
        let a2 = (dr * fr + dg * fg2 + db * fb) / den;
        a2 = Math.max(0, Math.min(1, a2));
        const er = dr - a2 * fr, eg = dg - a2 * fg2, eb = db - a2 * fb;
        const err = Math.sqrt((er * er + eg * eg + eb * eb) / 3);
        // In a narrow wedge (underarm gap, under hair) no clean background is
        // reachable — the diffused estimate is a guess from far away, and matting
        // against a wrong endpoint paints skin green or leaves speckle. Distance
        // the estimate had to travel is measured directly, and confidence dies
        // with it: wedge pixels stay uniformly photographic, a natural shadow.
        let conf = 1 - smooth(err, 14, 42);
        conf *= 1 - smooth(bgF.fd[i] < 0 ? 99 : bgF.fd[i], RING + 1, RING + 4);
        if (fgF.fd[i] < 0) conf = 0;
        if (vA[i] < 0.28 && (bgF.fd[i] < 0 || bgF.fd[i] > RING + 1)) wedgePx++;
        if (crevice[i]) continue;
        alphaA[i] = a2; confA[i] = conf;
        wMap[i] = conf * a2 + (1 - conf) * wMap[i];
        evAny[i] = Math.max(evAny[i], wMap[i]);
      }

      // ---- morphological closing: an image-independent guarantee ----
      // The harmonic solve fixes weights that are unreliable; this removes
      // any that are simply inconsistent. Grayscale closing (dilate then
      // erode) provably eliminates every low-weight island narrower than the
      // structuring element while leaving larger structures and their edges
      // untouched - so no speck can survive inside fabric, whatever the
      // scene, palette or resolution. It is confined to information-free
      // pixels, where no real structure can be resolved anyway, so genuine
      // narrow gaps that carry colour information are preserved.
      {
        const CR = Math.max(3, Math.round(W / 90));
        const dil = new Float32Array(wMap), tmp = new Float32Array(N);
        const sweep = (src2, dst, pick) => {
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            let v = src2[y * W + x];
            for (let t = -CR; t <= CR; t++) {
              const nx = x + t; if (nx < 0 || nx >= W) continue;
              v = pick(v, src2[y * W + nx]);
            }
            dst[y * W + x] = v;
          }
          const cp = new Float32Array(dst);
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            let v = cp[y * W + x];
            for (let t = -CR; t <= CR; t++) {
              const ny = y + t; if (ny < 0 || ny >= H) continue;
              v = pick(v, cp[ny * W + x]);
            }
            dst[y * W + x] = v;
          }
        };
        sweep(wMap, tmp, Math.max);
        sweep(tmp, dil, Math.min);
        for (let i = 0; i < N; i++) if (unrel[i] > 0.01 && dil[i] > wMap[i])
          wMap[i] += (dil[i] - wMap[i]) * unrel[i];
      }

      // ---- weight completion where the pixel's own reading is unreliable ----
      // Weight is relaxed toward the neighbour average in proportion to how
      // little colour information the pixel carries, with informative pixels
      // holding their own measurement. A crevice walled in by fabric is pulled
      // toward garment weight and a dark patch open to the scene toward zero,
      // from their boundaries rather than from any topological test.
      //
      // Read the limits honestly before relying on this:
      //
      //  - It is SCREENED, not harmonic. Every pixel stays anchored to base[i]
      //    with weight (1-unrel), so the maximum principle does NOT apply and
      //    an isolated speck is not impossible by construction. It is damped,
      //    not excluded. The morphological closing above is what actually
      //    removes isolated islands.
      //  - Gauss-Seidel propagates roughly one pixel per sweep, so 700 sweeps
      //    reach ~26px. A dark region wider than that never hears from its own
      //    boundary and keeps whatever the thresholded base put there.
      //
      // A converged multigrid version was built and measured against this one:
      // on all five templates the rendered output was identical (mean
      // |Laplacian(delta)| 2.88 either way), so it was not kept. If a future
      // template has a dark region wider than ~26px the difference would start
      // to matter, and that is the point to revisit this.
      {
        const idx = [];
        for (let i = 0; i < N; i++) if (unrel[i] > 0.01) idx.push(i);
        if (idx.length) {
          const base = new Float32Array(wMap);
          for (let pass = 0; pass < 700; pass++) {
            for (let k = 0; k < idx.length; k++) {
              const i = idx[k], x = i % W;
              if (x < 1 || x >= W - 1 || i < W || i >= N - W) continue;
              const avg = (wMap[i - 1] + wMap[i + 1] + wMap[i - W] + wMap[i + W]) * 0.25;
              wMap[i] = (1 - unrel[i]) * base[i] + unrel[i] * avg;
            }
          }
        }
      }

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
        if (neut[i] > 0) {
          const kk = Math.min(1, neut[i] * (1 - wMap[i]));
          const L = 0.299 * r + 0.587 * g + 0.114 * b;
          r = r + (L - r) * kk; g = g + (L - g) * kk; b = b + (L - b) * kk;
        }
        // matting bake: replace the pixel with the model's own mix so the
        // runtime subtraction cancels exactly, leaving (1-a)*bg + a*target
        if (ring[i] && confA[i] > 0) {
          const sbB = Math.round(shadeVal[i] * 255) * 3;
          const a2 = alphaA[i], cf = confA[i];
          const br2 = a2 * lutVm[sbB] + (1 - a2) * bgC[i * 3];
          const bg2 = a2 * lutVm[sbB + 1] + (1 - a2) * bgC[i * 3 + 1];
          const bb2 = a2 * lutVm[sbB + 2] + (1 - a2) * bgC[i * 3 + 2];
          r = r + (br2 - r) * cf; g = g + (bg2 - g) * cf; b = b + (bb2 - b) * cf;
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
        // G = design clip, and nothing else: how much of the printed graphic
        // survives here. Purely a coverage question.
        wd.data[o + 1] = Math.round(Math.max(0, Math.min(1, clip[i])) * 255);
        // B = own-value blend. What violet does the runtime subtract — the
        // MODEL's violet (b=0) or THIS PIXEL's own value (b=1)?
        //
        // It must be 1 wherever the pixel carries no colour information.
        // lutV at a dark shade is still saturated violet (G much lower than
        // R and B), but an information-free crease pixel is near-neutral
        // black. Subtracting modelled violet from neutral black over-
        // subtracts G and the pixel renders GREEN — the mint blotches in
        // underarm creases. Subtracting the pixel's own value instead makes
        // the output a convex blend of that pixel and T(shade): neutral by
        // construction, in gamut for every target colour.
        //
        // Crucially this is decided by information content alone, never by
        // topology. Previously the unrel guard applied only on the 'outside'
        // branch, so whether a crease pixel was protected depended on whether
        // the crease happened to squeeze through to the image border — which
        // is pose-dependent, and is why fixing one photo broke another.
        wd.data[o + 2] = Math.round(255 * Math.max(0, Math.min(1, Math.max(
          clip[i],
          unrel[i],
          outside[i] ? 1 - Math.max(0, Math.min(1, confA[i])) : 0,
        ))));
        wd.data[o + 3] = 255;
      }
      wctx.putImageData(wd, 0, 0);

      const shadeCv = document.createElement('canvas'); shadeCv.width = W; shadeCv.height = H;
      const sctx = shadeCv.getContext('2d');
      const sd = sctx.createImageData(W, H);
      for (let i = 0; i < N; i++) {
        const o = i * 4;
        const tv = Math.round(shadeVal[i] * 255);
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
      // edge audit: recolour the ring to WHITE via the exact runtime formula
      // and count matte-confident pixels landing outside the convex hull of
      // their two endpoints — the "dark outline / halo on light colours"
      // defect class. Non-zero here means the matting is broken.
      let edgeDark = 0, edgeBright = 0;
      {
        const lutW = mkRelight([255, 255, 255]);
        for (let i = 0; i < N; i++) {
          if (!ring[i] || confA[i] < 0.5) continue;
          const o = i * 4, ww = wMap[i];
          const sbB = Math.round(shadeVal[i] * 255) * 3;
          const lum = (r2, g2, b2) => 0.299 * r2 + 0.587 * g2 + 0.114 * b2;
          const outL = lum(
            pd.data[o] + ww * (lutW[sbB] - lutVm[sbB]),
            pd.data[o + 1] + ww * (lutW[sbB + 1] - lutVm[sbB + 1]),
            pd.data[o + 2] + ww * (lutW[sbB + 2] - lutVm[sbB + 2]));
          const bL = lum(bgC[i * 3], bgC[i * 3 + 1], bgC[i * 3 + 2]);
          const tL = lum(lutW[sbB], lutW[sbB + 1], lutW[sbB + 2]);
          if (outL < Math.min(bL, tL) - 18) edgeDark++;
          if (outL > Math.max(bL, tL) + 18) edgeBright++;
        }
      }
      let missed = 0, skin = 0, gN = 0, deepN = 0, bgPaint = 0;
      for (let i = 0; i < N; i++) {
        if (sA[i] > 0.25 && vA[i] > 0.15 && ad(hA[i], shirtHue) < 30 && wMap[i] < 0.3) missed++;
        if (sA[i] > 0.15 && sA[i] < 0.55 && vA[i] > 0.30 && ad(hA[i], 25) < 25 && wMap[i] > 0.7) skin++;
        if (wMap[i] > 0.04 || clip[i] > 0.04) { gN++; if (vA[i] < 0.16) deepN++; }
        // background pixels that would be recoloured with no violet evidence
        // of any kind — exactly the class that painted a bright rim around
        // the silhouette
        if (outside[i] && !crevice[i] && wMap[i] > 0.08 && evAny[i] < 0.05) bgPaint++;
      }
      const deepShadowPct = +(100 * deepN / Math.max(1, gN)).toFixed(2);

      const dbg = dbgPx.map(([x, y]) => {
        const i = y * W + x, o = i * 4;
        const d2 = sgn(hA[i]);
        const lim2 = d2 >= 0 ? 65 : 45 + 25 * (1 - smooth(vA[i], 0.10, 0.30));
        const a2 = Math.abs(d2);
        const hueClose = a2 <= 30 ? 1 : a2 >= lim2 ? 0 : 0.5 + 0.5 * Math.cos((a2 - 30) / (lim2 - 30) * Math.PI);
        return { x, y, rgb: [src[o], src[o+1], src[o+2]], h: +hA[i].toFixed(1), s: +sA[i].toFixed(3), v: +vA[i].toFixed(3),
          wRaw: +wRaw[i].toFixed(3), core: core[i], outside: outside[i], gate: gate[i],
          clip: +clip[i].toFixed(3), hueClose: +hueClose.toFixed(3),
          ev: +(hueClose * smooth(sA[i], 0.05, 0.18)).toFixed(3), wMap: +wMap[i].toFixed(3), shirtHue };
      });
      return {
        dbg, W, H, shirtHue, fragments, ambientTint, quad,
        bbox: { x: mnX, y: mnY, w: bw, h: bh },
        vRef: +vRef.toFixed(4), relMax: REL_MAX, violetBase,
        qa: { missed, skin, bgPaint, edgeDark, edgeBright, wedgePx, modelFit: +(fitSum / Math.max(1, fitCnt)).toFixed(2), deepShadowPct },
        photo: photo.toDataURL('image/jpeg', 1.0),
        weight: wpng.toDataURL('image/png'),
        shade: shadeCv.toDataURL('image/jpeg', 0.92),
      };
    }, { b64, MAX_EDGE, dbgPx });
    if (r.dbg && r.dbg.length) console.log('\nDBG', JSON.stringify(r.dbg, null, 1));

    // QA gate, mechanising the guide's "no hard shadow band" rule. A garment
    // whose deep-shadow fraction is this high has a broad near-black band that
    // no recolour can make look right on a pale target — the photo needs
    // regenerating with softer light, not more pipeline work.
    if (r.qa.deepShadowPct > 8) {
      console.log(`${r.W}x${r.H} deepShadow=${r.qa.deepShadowPct}% — FAILS QA (hard shadow band), excluded from manifest`);
      continue;
    }

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

    console.log(`${r.W}x${r.H} frags=${r.fragments} missed=${r.qa.missed} skin=${r.qa.skin} bgPaint=${r.qa.bgPaint} edgeDark=${r.qa.edgeDark} edgeBright=${r.qa.edgeBright} wedge=${r.qa.wedgePx} modelFit=${r.qa.modelFit} deepShadow=${r.qa.deepShadowPct}%`);
  }

  fs.writeFileSync(META_OUT, JSON.stringify(manifest, null, 2) + '\n');
  await browser.close();
  console.log(`\n${manifest.length} templates -> ${path.relative(process.cwd(), META_OUT)}`);
})().catch(e => { console.error(e); process.exit(1); });
