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
const crypto = require('crypto');

// Everything under public/ is copied to the site verbatim, so an asset keeps
// its filename forever and only its bytes change between builds. A browser or
// CDN holding the old copy has nothing to tell it otherwise, and serves it —
// which is how a fix that is merged, deployed and correct still shows the old
// picture on someone's phone. Tagging each URL with a hash of its content makes
// the URL change whenever the bytes do, so a stale copy can never be selected.
const version = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 8);

// The edge-smoothness floor. See the gate below for why it exists.
const EDGE_BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'edge-baseline.json'), 'utf8'));
const SRC_DIR = process.env.ON_MODEL_SRC || path.join(__dirname, 'on-model-src');
const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'on-model');
const META_OUT = path.join(OUT_DIR, 'templates.json');
// What ships, unchanged: the runtime, the manifest and the edge baseline are
// all calibrated to this.
const MAX_EDGE = 1600;
// What the pipeline THINKS at. Every source arrives 2000-3456 px tall and was
// being downscaled to 1600 before a single decision was taken, so a fifth to a
// half of the real resolution was thrown away and the mask then had to commit
// to whole pixels at the coarser grid — which is the staircase. Deciding at
// the native grid and area-averaging the answer down turns four real samples
// into one honest fraction of coverage, which is what an anti-aliased edge is.
const ANALYSIS_EDGE = 2100;
// Bounded deliberately. Sources arrive 2000-2048 px tall, so this decides at
// their native grid and no further: the band widths, seed distances and region
// minimums inside the analysis are written in absolute pixels, and a candidate
// upscaled to 2304 jumped 2.2x in linear scale, which broke them — 511 px of
// painted background on a photograph that measured 6. Deciding at the
// resolution the images actually carry is the whole gain; chasing an
// upscaler's invented pixels is not.

const TEMPLATES = [
  // Kept in the list although it has never shipped, so every build re-confirms
  // the rejection rather than someone rediscovering it. The generation is
  // side-lit hard from the window: measured on the source, the lit side of the
  // garment is rgb(126,95,157) at value 0.62 and saturation 0.40, while the
  // shadow side is rgb(30,25,31) at value 0.13 and saturation 0.15. Red and
  // blue are equal there and green sits six below them — the violet has
  // collapsed to neutral dark grey, so there is nothing left to key on and no
  // fabric detail left to carry a new colour. Forced past the gates it ships a
  // hard-edged dark patch across the right hip on every target colour, which is
  // exactly what deepShadow 8.95% and keyMiss 424 are reporting. No pipeline
  // change reaches this: recolouring it would mean inventing the whole shadow
  // side. The scene is worth having, so the fix is a fresh generation with soft
  // even frontal light — drop the image into the studio and it writes that
  // corrected prompt.
  { id: 'window-f', file: 'window-f.webp', label: 'Window Light', model: 'female', scene: 'Tall window, sheer curtain' },
  { id: 'gallery-f', file: 'gallery-f.webp', label: 'Gallery Interior', model: 'female', scene: 'Minimal off-white interior' },
  { id: 'livingroom-m', file: 'livingroom-m.webp', label: 'Living Room', model: 'male', scene: 'Bright airy living room' },
  { id: 'street-m', file: 'street-m.webp', label: 'Urban Street', model: 'male', scene: 'Sunlit pavement outside a cafe' },
  { id: 'park-m', file: 'park-m.webp', label: 'Park Path', model: 'male', scene: 'Green park path, open shade' },
  { id: 'home-f', file: 'home-f.webp', label: 'Cozy Home', model: 'female', scene: 'home indoor' },
  { id: 'bright-airy-f', file: 'bright-airy-f.webp', label: 'Bright Airy', model: 'female', scene: 'Bright airy coffee shop, pale wood' },
  { id: 'miami-f', file: 'miami-f.webp', label: 'Miami Street', model: 'female', scene: 'palm-lined street' },
  { id: 'bright-minimal-m', file: 'bright-minimal-m.webp', label: 'Bright Minimal', model: 'male', scene: 'Bright minimal grey walls, soft daylight' },
  { id: 'cafe-f', file: 'cafe-f.webp', label: 'Cafe Counter', model: 'female', scene: 'Bright cafe, window light, barista counter behind' },
  { id: 'beach-m', file: 'beach-m.webp', label: 'Beach', model: 'male', scene: 'Sandy beach, open sky, sea behind' },
  { id: 'marina-m', file: 'marina-m.png', label: 'Marina', model: 'male', scene: 'Marina railing, boats and open water' },
  { id: 'sky-f', file: 'sky-f.png', label: 'Open Sky', model: 'female', scene: 'Open pale sky, soft daylight' },
  { id: 'rooftop-hoodie-f', file: 'rooftop-hoodie-f.png', label: 'Rooftop Hoodie', model: 'female', scene: 'Rooftop skyline, overcast light' },
  { id: 'sunbeam-wall-f', file: 'sunbeam-wall-f.png', label: 'Sunbeam Wall', model: 'female', scene: 'Warm plaster wall, diagonal light beam' },
  { id: 'tree-lined-f', file: 'tree-lined-f.png', label: 'Tree-Lined Street', model: 'female', scene: 'Leafy residential street' },
  { id: 'stadium-hoodie-m', file: 'stadium-hoodie-m.png', label: 'Stadium Hoodie', model: 'male', scene: 'Empty stadium seating, pitch behind' },
  { id: 'garden-path-longsleeve-f', file: 'garden-path-longsleeve-f.png', label: 'Garden Path', model: 'female', scene: 'Leafy garden path, soft even light' },
];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const manifest = [];

  for (const tpl of TEMPLATES) {
    const srcPath = path.join(SRC_DIR, tpl.file);
    if (!fs.existsSync(srcPath)) { console.error(`  ! missing ${srcPath}`); continue; }
    // The data: URL carries the MIME the decoder is handed, so it has to match
    // the bytes. Sources were all webp when this was written; a raw generation
    // arrives as png or jpg, and re-encoding one to webp to satisfy a hardcoded
    // string would resample the silhouette — the exact pixels the edge checks
    // measure. Read the type off the extension and leave the file alone.
    const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
    const srcMime = MIME[path.extname(srcPath).toLowerCase()];
    if (!srcMime) { console.error(`  ! ${tpl.file}: unsupported source type`); continue; }
    const b64 = fs.readFileSync(srcPath).toString('base64');
    process.stdout.write(`${tpl.id} ... `);

    const dbgPx = (tpl.id === process.env.DBG_ID && process.env.DBG_PX)
      ? process.env.DBG_PX.split(';').map(t => t.split(',').map(Number)) : [];
    const r = await page.evaluate(async ({ b64, srcMime, MAX_EDGE, ANALYSIS_EDGE, dbgPx }) => {
      const load = s => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = s; });
      const img = await load('data:' + srcMime + ';base64,' + b64);
      const k = Math.min(1, ANALYSIS_EDGE / Math.max(img.width, img.height));
      const W = Math.round(img.width * k), H = Math.round(img.height * k), N = W * H;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingQuality = 'high';
      // A source larger than the analysis grid has to come down to it, and HOW
      // it comes down decides everything after. drawImage, even at 'high'
      // quality, is a resampler and not an integrator: reducing by 0.6 it takes
      // a weighted sample near each destination centre rather than the average
      // over the destination pixel's full footprint, so detail finer than the
      // new grid folds back in as aliasing instead of averaging away. On a
      // silhouette that is a jagged edge, invented at load time, before a single
      // decision has been taken — and every stage downstream then faithfully
      // preserves it.
      //
      // The output side of this file has always integrated (see areaDown, and
      // the note there about coverage being an area). The input side did not.
      // stadium-hoodie-m is the only shipped source above the analysis grid
      // (2304x3456), and it was the worst template by a wide margin. Integrating
      // its downscale instead: edgeRough 116.7 to 90.9, missed 1553 to 594, skin
      // 21 to 0, keyMiss 57 to 16, coolPaint and occPaint to 0. Nothing else in
      // the set is affected — every other source is at or below 2100, so k is 1
      // and this branch never runs — but every future image larger than the grid
      // goes through it, which is where it earns its place.
      let src;
      if (k < 1) {
        const nv = document.createElement('canvas'); nv.width = img.width; nv.height = img.height;
        const nc = nv.getContext('2d', { willReadFrequently: true });
        nc.drawImage(img, 0, 0);
        const sd = nc.getImageData(0, 0, img.width, img.height).data;
        const SW = img.width, SH = img.height;
        const out = new Uint8ClampedArray(N * 4);
        const rx = SW / W, ry = SH / H;
        for (let oy = 0; oy < H; oy++) {
          const y0 = oy * ry, y1 = (oy + 1) * ry;
          for (let ox = 0; ox < W; ox++) {
            const x0 = ox * rx, x1 = (ox + 1) * rx;
            let ar = 0, ag = 0, ab = 0, ws = 0;
            for (let yy = Math.floor(y0); yy < Math.min(SH, Math.ceil(y1)); yy++) {
              const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
              for (let xx = Math.floor(x0); xx < Math.min(SW, Math.ceil(x1)); xx++) {
                const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
                const w2 = wx * wy, o2 = (yy * SW + xx) * 4;
                ar += sd[o2] * w2; ag += sd[o2 + 1] * w2; ab += sd[o2 + 2] * w2; ws += w2;
              }
            }
            const oo = (oy * W + ox) * 4, iv = ws > 0 ? 1 / ws : 0;
            out[oo] = ar * iv; out[oo + 1] = ag * iv; out[oo + 2] = ab * iv; out[oo + 3] = 255;
          }
        }
        src = out;
        // The canvas is read again further down, so it carries the same pixels.
        const idt = ctx.createImageData(W, H); idt.data.set(out); ctx.putImageData(idt, 0, 0);
      } else {
        ctx.drawImage(img, 0, 0, W, H);
        src = ctx.getImageData(0, 0, W, H).data;
      }

      function hsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const M = Math.max(r, g, b), m = Math.min(r, g, b), d = M - m;
        let h = 0;
        if (d) { if (M === r) h = ((g - b) / d) % 6; else if (M === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
        return [h, M ? d / M : 0, M];
      }
      const ad = (a, b) => { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
      const smooth = (x, a, b) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

      // Dominant saturated hue = the shirt's key colour — searched ONLY in
      // the violet corridor, because the garment is violet BY CONSTRUCTION
      // (the whole pipeline is a violet-key system) and an open argmax is
      // winner-take-one-bin: on a tight framing with lots of skin, the
      // shirt's violet spreads over several 10-degree bins as its shading
      // shifts hue while skin concentrates into one, and the key latched
      // onto the model's FACE — every downstream stage then masked skin as
      // garment. Bins are smoothed circularly so a split violet cannot
      // lose to a concentrated one, and the final hue is the centroid of
      // the winning neighbourhood rather than a bin centre.
      const bins = new Float64Array(36);
      for (let i = 0; i < N; i++) {
        const o = i * 4; const [h, s, v] = hsv(src[o], src[o + 1], src[o + 2]);
        if (s > 0.25 && v > 0.15) bins[Math.floor(h / 10) % 36] += s * v;
      }
      let bb = 23, bv = -1;
      for (let i = 0; i < 36; i++) {
        const h0 = i * 10 + 5;
        if (h0 < 235 || h0 > 325) continue;
        const sc = bins[(i + 35) % 36] * 0.5 + bins[i] + bins[(i + 1) % 36] * 0.5;
        if (sc > bv) { bv = sc; bb = i; }
      }
      let hMass = 0, hSum = 0;
      for (const k of [(bb + 35) % 36, bb, (bb + 1) % 36]) { hMass += bins[k]; hSum += bins[k] * (k * 10 + 5); }
      const shirtHue = Math.round(hMass > 0 ? hSum / hMass : bb * 10 + 5);

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
      // CHANNEL ORDERING, as a backstop for everything the hue angle loses.
      // Violet fabric keeps GREEN as its smallest channel under any
      // illuminant: dimming scales all three channels together, so the
      // ordering survives shadow that the angle does not. And the angle
      // really does not — it swings toward whatever light reaches the pixel,
      // in a direction set by the pose. A sky-lit fold reads BLUER (the
      // widened negative limit below is exactly that case); fabric shadowed
      // by hair or an arm loses the blue skylight and reads WARMER, up to
      // +60deg magenta-ward, where the cosine window has already collapsed
      // to near zero. Those pixels keep their original violet while the
      // fabric around them recolours — a navy stripe along a hair-shadowed
      // collar on a pink shirt. Widening the positive limit instead would
      // trade one pose for another, which is how this kept failing; the
      // ordering is pose-independent.
      //
      // Skin, hair and wood put BLUE lowest, foliage puts green highest and
      // neutrals have no strict minimum, so none are reachable. Saturation
      // carries the same argument fabricEv makes below — a fabric/background
      // mixture is diluted by the background, so high saturation inside the
      // key means fabric, not an edge mix — which keeps this off any violet
      // bounce on a nearby wall, where raising weight would paint a glowing
      // rim. Held away from full brightness, where the strict key wins on
      // its own, and contained by the gate.
      const orderEv = new Float32Array(N);
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
      for (let i = 0; i < N; i++) {
        if (!gate[i]) continue;
        const o = i * 4;
        const vMax = Math.max(src[o], src[o + 1], src[o + 2]) || 1;
        // > 0 only where green is the strict minimum, scaled by the pixel's
        // own value so the test means the same thing at any brightness
        const gMin = Math.min(src[o] - src[o + 1], src[o + 2] - src[o + 1]) / vMax;
        orderEv[i] = smooth(gMin, 0.06, 0.14)
          * smooth(sA[i], 0.20, 0.32)
          * (1 - smooth(vA[i], 0.55, 0.72));
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
        // Hue and saturation are RATIOS: at 13,13,15 a "saturation" of 0.46
        // is six levels of codec chroma noise wearing a hue angle. Both
        // terms below identify fabric from that angle, so both must be
        // gated by the chroma actually present — otherwise the pipeline
        // says unrel = 1 ("this pixel carries no information") and weight
        // = 1 ("this pixel is certainly fabric") about the same pixel, and
        // that contradiction is what renders hair beside a collar as a
        // grey band on a white shirt: near-black noise granted full
        // weight, then relit at shade 15. A genuine violet fold at value
        // 0.2 carries 20+ levels of chroma and is unaffected; below ~6
        // levels an 8-bit JPEG carries no colour at all. Weight there must
        // come from the spatial machinery (enclosure, the completion, the
        // matte), which is anchored to pixels that can actually be read.
        const chromaAbs = Math.max(src[i * 4], src[i * 4 + 1], src[i * 4 + 2])
          - Math.min(src[i * 4], src[i * 4 + 1], src[i * 4 + 2]);
        const chromaOK = smooth(chromaAbs, 6, 14);
        const wide = (a <= 30 ? 1 : a >= lim ? 0 : 0.5 + 0.5 * Math.cos((a - 30) / (lim - 30) * Math.PI))
          * smooth(sA[i], 0.05, 0.15) * smooth(vA[i], 0.03, 0.08) * chromaOK;
        const dark = (a < 80 ? 1 : 0)
          * smooth(sA[i], 0.08, 0.18) * (1 - smooth(vA[i], 0.26, 0.34)) * chromaOK;
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
        wMap[i] *= Math.max(tap, fabricEv, orderEv[i]);
        neut[i] = Math.max(evChroma, evMix);
        evAny[i] = Math.max(tap, fabricEv, orderEv[i], evChroma, evMix);
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
      // How far INSIDE the silhouette the border is allowed to be rebuilt. See
      // the inner band below the eligibility filter for why it is two.
      const INNER = 2;
      // The matte is SOLVED out to twice the bake ring. Within RING its
      // answer is acted on in full — weight and photo bake. In the outer
      // half it is measurement only: mAlpha/mConf are recorded so the cap
      // after the completion can hold invention down to what the matte saw
      // (dark hair lying on a collar solves confidently to alpha ~0 ten
      // pixels out, exactly where the completion otherwise invents), but
      // no bake touches the photograph there — rewriting hair texture to
      // a diffused mix would smear it.
      const RING2 = RING * 2;
      const distC = new Int16Array(N).fill(-1);
      {
        let qh = 0, qt = 0;
        const qxx = new Int32Array(N), qyy = new Int32Array(N);
        for (let i = 0; i < N; i++) if (core[i]) { distC[i] = 0; qxx[qt] = i % W; qyy[qt] = (i / W) | 0; qt++; }
        while (qh < qt) {
          const cx3 = qxx[qh], cy3 = qyy[qh]; qh++;
          const dd = distC[cy3 * W + cx3];
          if (dd >= RING2) continue;
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
        for (let pass = 0; pass < RING2 + 6; pass++) {
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
        // Three directions, one per thing that is not the garment. Warm
        // (red over blue) is skin, hair and wood; green over both is foliage;
        // and RED LOWEST is the blue-cyan family — black denim, a dark
        // waistband, deep sky. That third term was missing, so a near-black
        // pair of jeans directly under the hem scored as information-free,
        // the harmonic completion below averaged the shirt's weight straight
        // down into it, and the waistband recoloured with the shirt. It is
        // written as an ordering rather than a hue window for the same reason
        // orderEv is: red-lowest is a fact about dark denim that survives
        // however dark it gets, and violet can never satisfy it, because
        // violet's minimum channel is green.
        const chroma = Math.max(
          src[o2] - src[o2 + 2],
          src[o2 + 1] - Math.max(src[o2], src[o2 + 2]),
          Math.min(src[o2 + 1], src[o2 + 2]) - src[o2]);
        const u = (1 - smooth(vA[i], 0.12, 0.36)) * (1 - smooth(chroma, 4, 14));
        unrel[i] = u;
        if (u > 0.5 && !core[i]) crevice[i] = 1;
      }

      // ---- occluder regions: connectivity as the missing information ----
      // `unrel` calls a near-black neutral pixel information-free, and the
      // closing and completion below then INVENT weight there by diffusion
      // from whatever fabric it touches. For a fold enclosed by the garment
      // that is the right call. For dark hair lying over a collar, or a
      // shadowed hand resting beside a hem, it is exactly wrong — it is
      // what painted a soft recoloured plume up into the hair on every
      // dark-haired model: the pixel's own colour says nothing, so the
      // completion happily relaxed garment weight across it. But the
      // pixel's NEIGHBOURHOOD says everything: a hair mass is BOUNDED by
      // hair that still shows the warm ordering (R above G above B) — a
      // signature violet fabric can never produce, since violet's lowest
      // channel is green — while a shadow crease is bounded by fabric.
      //
      // The decision is by DISTANCE TO EVIDENCE, never a per-pixel wall.
      // A first version flooded pixel-by-pixel from warm seeds behind
      // per-pixel violet walls, and on a real generation those walls are
      // exactly as reliable as the codec: on a muted, noisier source the
      // violet signature in deep shadow drops below any fixed threshold,
      // single-pixel breaches let the flood pour into genuine fabric
      // shadow, and the mask grew black bites along sleeve edges and a
      // hole in the middle of a hoodie's side fold. A second version voted
      // once per connected region, and failed the other way: hair and dark
      // background merge into one huge region whose single verdict is
      // decided by a global ratio that any busy scene can tip.
      //
      // So each information-free pixel takes its identity from whichever
      // evidence is NEARER, measured through the dark region itself: a
      // two-source BFS from every boundary pixel showing warm evidence and
      // every boundary pixel showing fabric evidence. Frozen only where
      // warm is clearly nearer (twice as near, strictly), so the middle of
      // an ambiguous channel — between an arm and the torso, where the
      // completion's spatial interpolation is the right answer — stays
      // unfrozen, as does everything within reach of a crease's
      // violet-signature penumbra. A stray warm vote inside a crease
      // freezes nothing, because fabric evidence is just as near; a stray
      // fabric vote inside hair protects only its own little disc, which
      // the completion then pulls to the frozen weight around it.
      //
      // Frozen regions get unrel = 0 and nothing else. Nothing is ever
      // subtracted — weight the union's evidence terms already granted
      // survives untouched. The closing cannot lift a frozen pixel, and
      // the completion holds it as a fixed anchor instead of relaxing
      // garment weight across it — which kills the plume at its only
      // source, the invention. Confined to `outside` pixels, so an
      // enclosed fold can never be reached and every crevice guarantee
      // above is untouched.
      const occluder = new Uint8Array(N);
      {
        // Region membership: pixels the completion would act on (unrel),
        // outside the garment, carrying no violet evidence of any kind.
        // The two ordering tests are violet-family signatures at their
        // noise floor: green strictly lowest = violet at any brightness;
        // blue strictly above both = the same fabric once crease shadow
        // has shifted it blue-ward (beach-m's underarm reads 15,17,27).
        // Here they only shape the region — a breach costs one pixel's
        // vote, not a hole.
        const unk = new Uint8Array(N);
        for (let i = 0; i < N; i++) {
          if (!outside[i] || core[i]) continue;
          if (unrel[i] <= 0.05 || orderEv[i] >= 0.15 || wRaw[i] >= 0.30) continue;
          const o = i * 4;
          if (Math.min(src[o] - src[o + 1], src[o + 2] - src[o + 1]) >= 4) continue;
          if (src[o + 2] - Math.max(src[o], src[o + 1]) >= 3) continue;
          // the same ordering read RELATIVE to the pixel's own brightness:
          // a muted generation's shadowed fabric can hold green lowest by
          // only 2 levels at 30 brightness, under every absolute floor —
          // 6% of its own maximum is still unreachable for hair and skin,
          // whose green never sits strictly lowest at all
          const vm = Math.max(src[o], src[o + 1], src[o + 2]);
          if (vm >= 12 && Math.min(src[o] - src[o + 1], src[o + 2] - src[o + 1]) / vm >= 0.06) continue;
          unk[i] = 1;
        }
        // Boundary evidence classes. Fabric evidence is the core, real
        // recolour weight, or either violet ordering; warm evidence is the
        // skin/hair/wood ordering with enough margin to be no accident.
        // Bright background is evidence for no one — the taper owns it.
        const isFab = ni => {
          const o = ni * 4;
          const vm = Math.max(src[o], src[o + 1], src[o + 2]);
          return core[ni] || wMap[ni] > 0.45
            || Math.min(src[o] - src[o + 1], src[o + 2] - src[o + 1]) >= 4
            || src[o + 2] - Math.max(src[o], src[o + 1]) >= 3
            || (vm >= 12 && Math.min(src[o] - src[o + 1], src[o + 2] - src[o + 1]) / vm >= 0.06);
        };
        // Two margins for the warm ordering: the loose one (8 levels of
        // R over B) is evidence for the distance field — near-black hair
        // holds R over B by single digits, and demanding more left the
        // field so sparse that half a hair mass measured nearer to the
        // collar than to its own colour. The strict margin stays in
        // reserve for nothing: violet can never reach either (its R sits
        // below B), so the loose test is still unreachable from fabric.
        const isWarm = ni => {
          const o = ni * 4;
          return src[o] - src[o + 2] >= 8 && src[o] - src[o + 1] >= 3 && vA[ni] < 0.75;
        };
        const dwarm = new Int32Array(N).fill(-1);
        const dfab = new Int32Array(N).fill(-1);
        const bfs = (dist, isSeedClass) => {
          const q = new Int32Array(N);
          let qh = 0, qt = 0;
          for (let i = 0; i < N; i++) {
            if (!unk[i]) continue;
            const x = i % W;
            for (const ni of [x > 0 ? i - 1 : -1, x + 1 < W ? i + 1 : -1, i - W, i + W]) {
              if (ni < 0 || ni >= N || unk[ni]) continue;
              if (isSeedClass(ni)) { dist[i] = 0; q[qt++] = i; break; }
            }
          }
          while (qh < qt) {
            const i = q[qh++];
            const dd = dist[i], x = i % W;
            for (const ni of [x > 0 ? i - 1 : -1, x + 1 < W ? i + 1 : -1, i - W, i + W]) {
              if (ni < 0 || ni >= N || !unk[ni] || dist[ni] !== -1) continue;
              dist[ni] = dd + 1; q[qt++] = ni;
            }
          }
        };
        bfs(dwarm, isWarm);
        bfs(dfab, isFab);
        // Second signal: WHO SURROUNDS the region. The distance rule fails
        // exactly where the user keeps seeing shadow enter the mask — the
        // chin/neck shadow above a collar sits a few pixels from skin AND
        // a few pixels from fabric, so neither is decisively nearer. But
        // its boundary composition is unambiguous: skin on almost every
        // side, fabric only in the thin collar edge below. A crease is the
        // mirror image (fabric all around), and the arm-torso channel is
        // balanced — which correctly stays with the completion. Counted
        // per connected component; a component whose informative boundary
        // is overwhelmingly warm is an occluder-shadow, however its
        // distances measure.
        const comp = new Int32Array(N).fill(-1);
        const compVote = [];
        {
          const q2 = new Int32Array(N);
          for (let s0 = 0; s0 < N; s0++) {
            if (!unk[s0] || comp[s0] !== -1) continue;
            const id = compVote.length;
            let qh = 0, qt = 0, warmN = 0, fabN = 0;
            q2[qt++] = s0; comp[s0] = id;
            while (qh < qt) {
              const i = q2[qh++];
              const x = i % W;
              for (const ni of [x > 0 ? i - 1 : -1, x + 1 < W ? i + 1 : -1, i - W, i + W]) {
                if (ni < 0 || ni >= N) continue;
                if (unk[ni]) { if (comp[ni] === -1) { comp[ni] = id; q2[qt++] = ni; } continue; }
                if (isFab(ni)) fabN++;
                else if (isWarm(ni)) warmN++;
              }
            }
            const frac = warmN / Math.max(1, warmN + fabN);
            compVote.push(smooth(frac, 0.62, 0.82) * smooth(warmN, 8, 20));
          }
        }
        // Freeze STRENGTH, not a freeze verdict — a yes/no test on
        // integer hop counts printed its own contours into the weight as
        // a blocky staircase, so the rule is a smooth 0..1 term and the
        // pixel's unrel is SCALED by it, with the completion blending
        // whatever partial freeze remains. Only the DECISIVE rule
        // survives: warm evidence at most half as far as fabric evidence.
        // A second, looser rule (warm merely nearer while fabric sat
        // beyond the matte ring) was tried and reverted: on a muted
        // generation a shadowed sleeve against warm blurred trees put the
        // trees' evidence slightly nearer than its own washed-out violet,
        // and the rule bit a ragged notch out of the sleeve. When the two
        // distances are even comparable the pixel stays with the
        // completion, whose worst case is a faint haze at a hair seam —
        // the conservative failure, not a broken edge.
        for (let i = 0; i < N; i++) {
          if (!unk[i] || dwarm[i] === -1) continue;
          const df2 = dfab[i] === -1 ? 999 : dfab[i];
          const s = Math.max(smooth(df2 - 2 * dwarm[i], 0, 4), compVote[comp[i]] || 0);
          if (s > 0) {
            unrel[i] *= 1 - s;
            if (s > 0.5) occluder[i] = 1;
          }
        }
      }

      const alphaA = new Float32Array(N), confA = new Float32Array(N);
      // Two confidences per ring pixel. mConfS carries the SHIPPED gate:
      // the background estimate must come from within RING+4 hops, which
      // is the invariant that lets the matte PAINT (bake, weight blend,
      // floor) — a far-travelled background is a guess, and painting from
      // a guessed endpoint put a comb of white teeth in the torso-arm gap.
      // mConf carries the relaxed RING2 gate and feeds ONLY the cap, which
      // can lower weight but never add it — safe with a weaker endpoint.
      const mAlpha = new Float32Array(N), mConf = new Float32Array(N);
      const mConfS = new Float32Array(N), mAlphaE = new Float32Array(N);
      // brightness-corroborated coverage ceiling per ring pixel (see below)
      const mLumCap = new Float32Array(N).fill(1);
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
        // Alpha is a projection onto the line fg->bg, and two things can make it
        // meaningless while `err` still reports a good fit — because `err` measures
        // FIT, and when the two endpoints are close together EVERY alpha fits.
        //
        // Separation: the error in alpha scales as (image noise)/(endpoint
        // separation), so a few levels of codec noise swing it across its whole
        // range once fg and bg are within ~20 levels. The `den < 100` bail-out above
        // is this same idea with a hard edge at 10 levels, far below where the
        // estimate actually goes bad; this continues it smoothly.
        //
        // Identifiability: darkening slides a pixel along very nearly the same line
        // as mixing does. Shadowed denim sits between "dark thing" and "lit denim"
        // exactly where a half-covered pixel would, so alpha cannot separate
        // coverage from shading unless the fabric endpoint still shows what makes it
        // fabric — violet's green deficit, which dimming preserves because it scales
        // all three channels together. Where the fabric endpoint has itself gone
        // neutral, as it does in the shadow a hem casts on what it rests against,
        // "part fabric" and "shaded background" are the same measurement and alpha
        // is not a coverage fraction any more.
        //
        // Ungated, that read ~50% coverage on plain denim under a hem at confidence
        // 1, varying pixel by pixel with the denim's own weave: a comb of vertical
        // teeth along the whole hem, surviving into every colour.
        const sep = Math.sqrt(den);
        const fgGap = Math.min(fgC[i * 3] - fgC[i * 3 + 1], fgC[i * 3 + 2] - fgC[i * 3 + 1]);
        let conf = (1 - smooth(err, 14, 42)) * smooth(sep, 12, 45) * smooth(fgGap, 3, 14);
        if (fgF.fd[i] < 0) conf = 0;
        const fdB = bgF.fd[i] < 0 ? 99 : bgF.fd[i];
        const confS = conf * (1 - smooth(fdB, RING + 1, RING + 4));
        conf *= 1 - smooth(fdB, RING2 + 1, RING2 + 4);
        if (distC[i] <= RING && vA[i] < 0.28 && (bgF.fd[i] < 0 || bgF.fd[i] > RING2 + 1)) wedgePx++;
        // The matte's answer is recorded for EVERY ring pixel, before the
        // crevice veto below decides whether to act on it. Those are two
        // different questions. Acting on it means assigning the weight AND
        // baking the pixel to a*V(shade) + (1-a)*bg, which at alpha ~0 rewrites
        // a crevice to pure background and is exactly what the veto exists to
        // prevent. Merely reading it costs nothing, and at the other end of the
        // range it is the only stage that knows the answer: the shadow band
        // under a hem is dark and achromatic, so the veto catches it, but the
        // background there IS reachable and the matte solves it confidently at
        // alpha ~0.95. Vetoed, that band fell through to the completion, which
        // interpolated across it to mid weight — and mid weight over a dark
        // shade is the broken dark line that follows a hem in every colour.
        // Low-alpha coverage must show violet in the PIXEL ITSELF. The
        // wall in the garment's own cast shadow darkens along nearly the
        // same line as mixing violet in does, and the matte read it as
        // 10-30% fabric at good confidence — a glow band outside the
        // sleeve and a grey wedge above the shoulder on a white recolour.
        // A genuinely mixed pixel carries violet's green deficit in
        // proportion to its coverage; a shadowed wall carries none. So an
        // alpha below ~0.5 is honoured only as far as the pixel shows that
        // deficit; strong alphas keep their own authority (their identity
        // comes from sitting near the fabric endpoint, not from tint).
        const gdP = Math.max(0, (src[o] + src[o + 2]) / 2 - src[o + 1]);
        // Coverage must be corroborated by BRIGHTNESS. JPEG stores colour
        // at half resolution, so a background pixel touching a saturated
        // garment carries the garment's chroma while keeping its own
        // luminance — the codec put the violet there, not the camera. The
        // alpha solve runs in RGB and reads that tint as 10-30% coverage,
        // which is why a sleeve corner bleeds under EVERY target colour:
        // the delta painted is (target - violet), non-zero for all of
        // them. Luminance is stored at full resolution and cannot bleed,
        // so it is the honest witness: a genuinely part-fabric pixel is
        // pulled toward the fabric's brightness, a chroma-bled one is not.
        // Skipped where fabric and background are too close in brightness
        // for the test to mean anything, and given a noise allowance so a
        // real soft edge is never clipped. What remains tinted is handled
        // by the existing neutralisation, which is target-independent and
        // therefore cannot glow under any colour.
        const yF = 0.299 * fgC[i * 3] + 0.587 * fgC[i * 3 + 1] + 0.114 * fgC[i * 3 + 2];
        const yB = 0.299 * bgC[i * 3] + 0.587 * bgC[i * 3 + 1] + 0.114 * bgC[i * 3 + 2];
        const sepY = yF - yB;
        let lumCap = 1;
        if (Math.abs(sepY) >= 25) {
          const yP = 0.299 * src[o] + 0.587 * src[o + 1] + 0.114 * src[o + 2];
          lumCap = Math.max(0, Math.min(1, (yP - yB) / sepY + 0.12));
        }
        mLumCap[i] = lumCap;
        const aEff = Math.min(a2 * Math.max(smooth(a2, 0.45, 0.7), smooth(gdP, 1.5, 4.5)), lumCap);
        mAlpha[i] = a2; mConf[i] = conf; mConfS[i] = confS; mAlphaE[i] = aEff;
        // Weight assignment and photo bake stay confined to the inner ring
        // and to the STRICT confidence; the outer half of the ring and the
        // relaxed confidence are measurement for the cap only.
        if (crevice[i] || distC[i] > RING) continue;
        alphaA[i] = aEff; confA[i] = confS;
        wMap[i] = confS * aEff + (1 - confS) * wMap[i];
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

      // ---- the garment's envelope: the core closed over its own gaps ----
      // Closing bridges a gap only where fabric lies on BOTH sides of it,
      // which is precisely what separates the two dark regions no colour
      // rule can tell apart. The channel between a sleeve and the torso is
      // bridged, so it belongs to the garment: it must be filled and it
      // must survive the confinement, or a white recolour grows a black
      // notch through the underarm. Hair above a shoulder has fabric only
      // below it, is never bridged, and stays photographic. The radius
      // spans an underarm channel and stays well under the neck opening,
      // which must NOT be bridged.
      const ENV = Math.max(10, Math.round(W / 20));
      let envelope = new Uint8Array(N);
      for (let i = 0; i < N; i++) envelope[i] = core[i];
      for (let k = 0; k < ENV; k++) envelope = dil(envelope);
      for (let k = 0; k < ENV; k++) envelope = ero(envelope);

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
      // EDGE-AWARE: each neighbour's contribution is scaled by a
      // conductance that dies across a strong luminance step. The job is
      // to identify the garment, recolour it, and leave everything else
      // alone — and the one place the isotropic version broke that
      // contract is diffusion straight across the garment's own occlusion
      // edge: fabric at v=0.45 meets hair at v=0.10 in a two-pixel step,
      // and weight walked over it into the hair as a soft recoloured
      // plume. A crease has no such step — its shading changes by a
      // hundredth or two per pixel — so conductance ~1 leaves every
      // crevice completion exactly as it was, while the seam band's
      // conductance ~0 means a hair pixel simply never hears from the
      // fabric across the edge. Pixels sealed off on all four sides keep
      // their base weight.
      {
        const idx = [];
        for (let i = 0; i < N; i++) if (unrel[i] > 0.01) idx.push(i);
        if (idx.length) {
          // Conductance on the RELATIVE luminance step, not the absolute
          // one. Illumination is multiplicative: shading across fabric
          // changes by a few percent per pixel at any brightness, while an
          // occlusion boundary is a factor. Measured absolutely, the hair
          // edge above a collar (value 0.05 rising to 0.33 over five
          // pixels) reads as five small steps and weight walked straight
          // across it into the hair — the grey band on a white shirt. In
          // relative terms that same edge is a 100%-per-pixel jump and a
          // fold's shading is still a few percent, so one threshold
          // separates them at every brightness, which no absolute one can.
          // How far a genuine partial-coverage edge can reach: anti-aliasing
          // and lens softness span a pixel or two, so within EDGE_PX of
          // solid fabric a dark pixel is the garment's own edge and the
          // completion must be free to fill it — restricting it there ate
          // a black notch out of a shadowed sleeve. Beyond that distance a
          // dark region is a different object (hair above a shoulder sits
          // five to ten pixels out), and there the matte's answer stands.
          const EDGE_PX = Math.max(2, Math.round(RING * 0.5));
          const relStep = (u, v) => Math.abs(u - v) / (Math.min(u, v) + 0.02);
          const cE = new Float32Array(N), cS = new Float32Array(N);
          for (let i = 0; i < N; i++) {
            const x = i % W;
            cE[i] = x + 1 < W ? 1 - smooth(relStep(vA[i], vA[i + 1]), 0.30, 0.60) : 0;
            cS[i] = i + W < N ? 1 - smooth(relStep(vA[i], vA[i + W]), 0.30, 0.60) : 0;
          }
          const base = new Float32Array(wMap);
          for (let pass = 0; pass < 700; pass++) {
            for (let k = 0; k < idx.length; k++) {
              const i = idx[k], x = i % W;
              if (x < 1 || x >= W - 1 || i < W || i >= N - W) continue;
              const gw = cE[i - 1], ge = cE[i], gn = cS[i - W], gs = cS[i];
              const gsum = gw + ge + gn + gs;
              // A blocked direction pulls toward the pixel's OWN base, not
              // toward whatever else happens to be reachable. Normalising
              // by the conductance sum — the obvious way to write this —
              // silently defeats the barrier: a pixel walled off on three
              // sides still takes the full value of the fourth, because
              // dividing by that one conductance restores its full vote.
              // That is why weight kept walking across the hair edge even
              // with the conductance in place. Charging the blocked share
              // to base[i] makes the barrier real — where a pixel cannot
              // see, it keeps what it had — while a crevice with open
              // sides still equilibrates to the fabric around it.
              const avg = (gw * wMap[i - 1] + ge * wMap[i + 1] + gn * wMap[i - W] + gs * wMap[i + W]
                + (4 - gsum) * base[i]) / 4;
              const v = (1 - unrel[i]) * base[i] + unrel[i] * avg;
              // Inside the boundary band the MATTE is the authority: it
              // solved those pixels against the fabric and background it
              // measured either side, and the completion's job there is
              // only to remove speckle, never to invent coverage. Letting
              // it raise them is what put a grey band over the hair beside
              // a collar — the matte had already answered ~0 and the
              // completion overwrote it with 0.6 by averaging along the
              // band. So in the band the completion may only lower; the
              // garment's interior, where crevices genuinely need filling
              // from their surroundings, is untouched by this.
              wMap[i] = (!envelope[i] && distC[i] > EDGE_PX) ? Math.min(v, base[i]) : v;
            }
          }
        }
      }

      // The matte's answer as a CAP — the exact mirror of the matte floor
      // below, and the stage that finally owns the band the distance test
      // cannot call: hair lying ON the collar, nearer to fabric evidence
      // than to its own colour's. The matte solved that band directly —
      // a hair pixel matches its dark background endpoint at alpha ~0 with
      // real confidence, because the endpoints there are far apart and the
      // fabric endpoint keeps violet's green deficit. Where it is
      // confident, invention may not exceed its answer. Lowering-only, in
      // the same monotone form as the floors, and applied BEFORE them: the
      // ordering floor still raises any pixel carrying the key's own
      // signature back afterwards, so shadowed fabric the cap wrongly
      // grazes is restored, and true crevices are untouched because their
      // confidence is already zero (their background is unreachable, which
      // the fd gate turns into conf 0).
      for (let i = 0; i < N; i++) {
        if (!ring[i]) continue;
        const cf = Math.max(0, Math.min(1, mConf[i]));
        if (!cf) continue;
        if (wMap[i] > mAlpha[i]) wMap[i] = (1 - cf) * wMap[i] + cf * mAlpha[i];
      }

      // The ordering evidence again, now as a FLOOR — applied last, after
      // every stage that can lower a weight. The min filter, the matte, the
      // closing and the harmonic completion each disbelieve this band for
      // the same reason the hue window did: it lies against a dark occluder
      // with no clean background reachable behind it, so each one drags it
      // back toward zero and the multiply above alone recovers only a few
      // levels. A floor is monotone — it can lower nothing and so undoes
      // none of their work — it only refuses to let them zero a pixel that
      // carries the key's own signature.
      //
      // Yielded to the matte, but only as far as the matte can actually see.
      // A small matting residual normally means the pixel really is a
      // fabric/background mixture and its alpha is the correct weight —
      // overriding those lights the silhouette with a bright rim
      // (edgeBright 0 -> 75 on home-f), so confidence is respected by
      // default. It is not respected where the key signature is strong,
      // because there the matte is answering a question it cannot tell
      // apart: fabric DARKENED BY SHADOW and fabric MIXED WITH DARK HAIR lie
      // on the same line from near-black to lit fabric, so a small residual
      // does not distinguish them. The ordering does. Under the collar the
      // matte reports 28% fabric, which would put green at 41; the pixel
      // reads 36 — more violet than its own mixture explains, so the
      // darkening is shading and the fabric is fully there.
      //
      // And only where the background behind the pixel is DARK, which is the
      // whole of that ambiguity: shading takes fabric toward black, so only a
      // near-black background can imitate it. Against a bright background the
      // two are not confusable — mixing brightens, shading darkens — the
      // matte is answering a question it can see, and discounting it there is
      // what lit the rim.
      for (let i = 0; i < N; i++) {
        const cf = Math.max(0, Math.min(1, confA[i]));
        const bgL = 0.299 * bgC[i * 3] + 0.587 * bgC[i * 3 + 1] + 0.114 * bgC[i * 3 + 2];
        const ambig = 1 - smooth(bgL, 60, 110);
        const fl = orderEv[i] * (1 - cf * (1 - orderEv[i] * ambig));
        if (fl > wMap[i]) wMap[i] = fl;
      }

      // The matte's own answer, as a floor, in the same monotone form as the
      // ordering floor above and for the same reason. The completion exists to
      // invent a weight where the pixel cannot supply one, and along a hem it
      // does that by interpolating across a band with fabric on one side and
      // background on the other, landing near the middle. Mid weight over a
      // dark shade renders neither the fabric nor the background but something
      // between and below both: the broken dark line that follows a hem in
      // every colour. Where the matte is confident it has already measured that
      // band from the fabric and background either side and scored the answer
      // by how well it reproduces the pixel, which beats an interpolation.
      //
      // Read from mAlpha/mConf, so it sees crevice pixels the veto held back —
      // raising a weight is safe there, where baking is not. And a floor, never
      // an assignment: alpha near zero floors nothing, so a crevice the matte
      // calls background keeps whatever the completion gave it, and the
      // completion stays free to RAISE a pixel the matte under-called, which is
      // what the speckle guarantee rests on.
      //
      // Gated on a BRIGHT background, by the same `ambig` the ordering floor
      // uses and for the mirror-image reason. That comment explains where the
      // matte cannot see: shading takes fabric toward black, so against a
      // near-black background fabric-in-shadow and background-in-shadow lie on
      // top of each other and alpha is guesswork. The ordering floor overrides
      // the matte exactly there; this one defers to it exactly there. Ungated,
      // a hem over black denim picks up a ragged bright fringe where the matte
      // guessed fabric — the same guesswork, read the other way round. Against
      // a bright background mixing brightens and shading darkens, the two are
      // not confusable, and the matte's answer is the best one available.
      for (let i = 0; i < N; i++) {
        if (!ring[i] || distC[i] > RING) continue;
        const bgL = 0.299 * bgC[i * 3] + 0.587 * bgC[i * 3 + 1] + 0.114 * bgC[i * 3 + 2];
        const fl = mAlphaE[i] * Math.max(0, Math.min(1, mConfS[i])) * smooth(bgL, 60, 110);
        if (fl > wMap[i]) wMap[i] = fl;
      }

      // ---- silhouette confinement: the mask's universe, stated once ----
      // The garment is the violet region plus the narrow measured boundary
      // band around it (the matte ring, where edge pixels are physically
      // part fabric). EVERYTHING beyond that is not the garment and its
      // weight is hard zero — no completion, closing, floor or any future
      // stage can paint there, whatever it believes. This is a guarantee
      // about the OUTPUT, not another heuristic: speckle below a hem, a
      // smudge wandering past a collar, any invention that escapes the
      // stages above dies here by construction. Enclosed folds are not
      // `outside` and keep their full machinery; the underarm and hem
      // channels sit within the band by construction (they are bounded by
      // core on both sides, so no pixel in them is far from it).
      // The same brightness ceiling applied to the FINAL weight, so paint
      // arriving from the union or the floors is held to it too, not only
      // paint the matte assigned. Lowering-only, and confined to the ring.
      for (let i = 0; i < N; i++) {
        if (ring[i] && wMap[i] > mLumCap[i]) wMap[i] = mLumCap[i];
      }

      for (let i = 0; i < N; i++) {
        if (!outside[i] || envelope[i]) continue;
        if (distC[i] === -1) { wMap[i] = 0; continue; }
        // and inside the band, painting requires a REASON: violet evidence
        // of some kind, or a matte that actually solved the pixel, or the
        // crevice machinery (dark folds squeezing through to the border).
        // Band residue with none of those — thin low-weight films left on
        // collar-adjacent skin by the blur and the completion — is exactly
        // what the bgPaint audit counts as a defect, so it is removed by
        // construction rather than merely counted.
        if (!crevice[i] && evAny[i] < 0.05 && mConf[i] < 0.1) wMap[i] = 0;
      }

      // The own-value blend, computed once and shared by the weight map's B
      // channel and the chroma QA gate below. One array rather than the same
      // expression written twice: the gate exists to catch this value going
      // wrong, which it cannot do if it recomputes the value independently and
      // the two drift apart.
      const ownBlend = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const cf = Math.max(0, Math.min(1, confA[i]));
        ownBlend[i] = Math.max(0, Math.min(1, Math.max(
          clip[i],
          unrel[i],
          outside[i] ? 1 - cf : 0,
        )));
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
          // Only where there is violet to neutralise. `gate` is a geometric mask — a
          // dilation around the garment — so it takes in the model's own arm where it
          // rests against the sleeve, and this rule desaturated any dark pixel inside it
          // in proportion to its darkness. Skin in shadow is dark, so a warm brown arm
          // (81,51,40) was rewritten to a flat grey (69,55,50) and stayed that way under
          // every colour: a charcoal slab in the underarm gap, with the gate's own
          // boundary as its hard edge. On the violet original that reads as ordinary
          // shadow, which is how it survived; against a pale shirt it does not.
          //
          // A pixel is spared only when it carries REAL chroma pointing somewhere other
          // than violet — skin, hair and wood sit ~110 degrees away. A pixel with little
          // chroma is neutralised as before and nothing is lost by it: there is no
          // saturation there for the operation to move, so the crease residue this rule
          // exists to remove is still removed in full.
          const offHue = smooth(ad(hA[i], shirtHue), 45, 90);
          const dark = (1 - smooth(vA[i], 0.22, 0.42))
            * (1 - offHue * smooth(sA[i], 0.06, 0.16));
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
      // ---- the garment's border, defined once and rebuilt ----
      // Kept in step with template-studio.html.
      // Everything upstream decides, pixel by pixel, how much garment a pixel
      // holds. Nothing upstream has an opinion about the SHAPE those pixels make,
      // and that shape is what the eye reads. Measured on the shipped set, the
      // silhouette's sub-pixel position wanders 0.30 to 0.44 px from one scanline
      // to the next and the transition from cloth to scene spans 1.7 px, where a
      // photographed edge spends 2.7 to 6.3. A staircase, in other words, half as
      // wide as a camera's and wobbling by half a pixel — which is exactly what a
      // comb of ticks along a sleeve is.
      //
      // The generator cannot be asked for better, so the border is defined here
      // and rebuilt: smoothed ALONG itself to take the wobble out, widened ACROSS
      // itself to the width a lens would give, and each boundary pixel then
      // composed from the cloth and the scene actually beside it. No detail is
      // invented — the position and the two colours are all measured; only the
      // sub-pixel ordering between them is restored.
      {
        // Coverage as a field: 1 inside the garment, the measured weight through
        // the band, 0 beyond it. This is the thing whose shape is wrong.
        const A = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          A[i] = (!outside[i] || core[i]) ? 1 : (distC[i] < 0 ? 0 : Math.max(0, Math.min(1, wMap[i])));
        }

        // Who may be touched. Hair, hands and crevices keep their own machinery:
        // a strand is real structure crossing the border, not a rough edge, and
        // a curve fitted through it would erase it.
        //
        // A contact test used to sit here too — cloth and scene within fifty
        // units of each other, so the mixture cannot be measured, so leave it
        // alone. The premise is right and the conclusion was wrong. Where a
        // window holds no colour variation the guided filter does not guess:
        // its affine fit collapses, the colour coefficients go to zero and the
        // answer becomes the window's own mean coverage — a smoothing of the
        // input, which is the correct thing to do when the image has nothing
        // further to say. What the test did instead was hand those pixels back
        // to the raw colour-keyed coverage, and that is what was painting the
        // scene: across the seventeen templates bgPaint falls from 255 to 30
        // with the test gone, sunbeam-wall-f alone from 89 to 0. The case it
        // was written for, a hem lying on denim, is checked directly by the
        // studio's hem-over-trousers test rather than guarded by a proxy.
        // Skin cannot be a violet mixture at all.
        const elig = new Uint8Array(N);
        for (let i = 0; i < N; i++) {
          if (!ring[i] || crevice[i] || occluder[i]) continue;
          if (bgF.fd[i] < 0) continue;
          elig[i] = 1;
        }

        // The other half of the border. Everything above lives OUTSIDE the
        // silhouette: `ring` is `outside && distC > 0`, and inside it coverage
        // is asserted to be exactly 1. So the band was one-sided, and a
        // photographed edge is not — it ramps through the boundary, with as much
        // of the transition on the cloth side as on the scene side. Clamping the
        // inner half to a hard 1 chopped the matte's ramp in two and left a step
        // where the two halves met, which is a large part of what was left.
        //
        // Two pixels is the whole of it: measured, the substitution field drops
        // from 104/105/108/149 to 82/85/88/117 at one and two pixels in, and
        // four, eight and sixteen add nothing. That is the physical answer — a
        // lens spreads an edge over two or three pixels, not sixteen — and it is
        // why this is a fixed small depth rather than a tuned one.
        const distIn = new Int16Array(N);
        {
          const q = new Int32Array(N); let qh = 0, qt = 0;
          for (let i = 0; i < N; i++) {
            if (outside[i]) continue;
            const x = i % W, y = (i / W) | 0;
            if (x < 1 || y < 1 || x > W - 2 || y > H - 2) continue;
            if (outside[i - 1] || outside[i + 1] || outside[i - W] || outside[i + W]) { distIn[i] = 1; q[qt++] = i; }
          }
          while (qh < qt) {
            const i = q[qh++], d = distIn[i];
            if (d >= INNER) continue;
            for (const ni of [i - 1, i + 1, i - W, i + W]) {
              if (ni < 0 || ni >= N || outside[ni] || distIn[ni]) continue;
              distIn[ni] = d + 1; q[qt++] = ni;
            }
          }
        }
        // Hair and crevices are excluded for the same reason as outside: a
        // strand and a fold are structure, not a rough edge. The contrast test
        // cannot be applied here — bgC is only diffused into the ring, so a
        // pixel inside the garment has no background estimate yet — so it is
        // applied in the loop instead, against the background actually sampled.
        const inner = new Uint8Array(N);
        for (let i = 0; i < N; i++)
          if (distIn[i] && !crevice[i] && !occluder[i]) inner[i] = 1;

        // A pixel next to hair is eligible but must not be BUILT from hair, so
        // sampling below refuses occluded neighbours. Without that the fill drags
        // strand colour along the shoulder and paints it as cloth.
        const usable = (i) => i >= 0 && i < N && !occluder[i];

        const sample = (arr, stride, off, x, y) => {
          if (x < 0) x = 0; else if (x > W - 1) x = W - 1;
          if (y < 0) y = 0; else if (y > H - 1) y = H - 1;
          const x0 = Math.floor(x), y0 = Math.floor(y);
          const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
          const fx = x - x0, fy = y - y0;
          const a00 = arr[(y0 * W + x0) * stride + off], a10 = arr[(y0 * W + x1) * stride + off];
          const a01 = arr[(y1 * W + x0) * stride + off], a11 = arr[(y1 * W + x1) * stride + off];
          return (a00 * (1 - fx) + a10 * fx) * (1 - fy) + (a01 * (1 - fx) + a11 * fx) * fy;
        };

      // ---- the border, matted from the image instead of asserted from colour
      // Everything upstream decides coverage from the garment's VIOLET, and
      // violet is degenerate exactly where the border is hardest: strong light
      // washes saturation out of cloth, shadow takes its value away, and a
      // blurred background can sit twenty-nine levels from it. Every rule that
      // patches one of those cases mis-fires on another, which is the whole
      // history of this file.
      //
      // Alpha matting asks a different question, and one the photograph can
      // answer: inside any small window, the image is a blend of two colours, so
      // coverage must be an AFFINE function of the pixel's own colour — alpha =
      // a·I + b. Fitting that per window and averaging the overlapping fits is
      // the guided filter, and it is the closed-form matting Laplacian's answer
      // computed in linear time. It follows the picture's real edges: mask teeth
      // that correspond to nothing in the image are erased, a genuine edge is
      // followed to the sub-pixel, and a hair strand keeps its own partial
      // coverage because the window sees it. No hue is assumed anywhere, which
      // is why this generalises to garments and backgrounds not yet photographed.
      const matteAlpha = (cov) => {
        let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
        for (let i = 0; i < N; i++) {
          if (!ring[i] && !core[i]) continue;
          const x = i % W, y = (i / W) | 0;
          if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
          if (y < by0) by0 = y; if (y > by1) by1 = y;
        }
        if (bx1 < bx0) return null;
        // The window radius sets how far the filter looks for the two colours it
        // is separating. Padding by twice it keeps every window that touches the
        // band fully inside the working rectangle.
        const R = 6, EPS = 1e-4;
        bx0 = Math.max(0, bx0 - 2 * R - 2); by0 = Math.max(0, by0 - 2 * R - 2);
        bx1 = Math.min(W - 1, bx1 + 2 * R + 2); by1 = Math.min(H - 1, by1 + 2 * R + 2);
        const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1, M = bw * bh;
        const Ir = new Float32Array(M), Ig = new Float32Array(M), Ib = new Float32Array(M);
        const P = new Float32Array(M);
        for (let y = 0; y < bh; y++) {
          for (let x = 0; x < bw; x++) {
            const i = (y + by0) * W + (x + bx0), o = i * 4, m = y * bw + x;
            Ir[m] = src[o] / 255; Ig[m] = src[o + 1] / 255; Ib[m] = src[o + 2] / 255;
            P[m] = cov[i];
          }
        }
        // Separable moving average. Two passes of a running sum, so the cost is
        // independent of the radius and the whole filter stays linear.
        const box = (a) => {
          const t = new Float32Array(M), out = new Float32Array(M);
          for (let y = 0; y < bh; y++) {
            const row = y * bw;
            let acc = 0;
            for (let x = 0; x <= Math.min(R, bw - 1); x++) acc += a[row + x];
            for (let x = 0; x < bw; x++) {
              const lo = Math.max(0, x - R), hi = Math.min(bw - 1, x + R);
              t[row + x] = acc / (hi - lo + 1);
              const add = x + R + 1, rem = x - R;
              if (add < bw) acc += a[row + add];
              if (rem >= 0) acc -= a[row + rem];
            }
          }
          for (let x = 0; x < bw; x++) {
            let acc = 0;
            for (let y = 0; y <= Math.min(R, bh - 1); y++) acc += t[y * bw + x];
            for (let y = 0; y < bh; y++) {
              const lo = Math.max(0, y - R), hi = Math.min(bh - 1, y + R);
              out[y * bw + x] = acc / (hi - lo + 1);
              const add = y + R + 1, rem = y - R;
              if (add < bh) acc += t[add * bw + x];
              if (rem >= 0) acc -= t[rem * bw + x];
            }
          }
          return out;
        };
        const mul = (a, b) => { const o = new Float32Array(M); for (let m = 0; m < M; m++) o[m] = a[m] * b[m]; return o; };
        const mIr = box(Ir), mIg = box(Ig), mIb = box(Ib), mP = box(P);
        const mIrP = box(mul(Ir, P)), mIgP = box(mul(Ig, P)), mIbP = box(mul(Ib, P));
        const mrr = box(mul(Ir, Ir)), mrg = box(mul(Ir, Ig)), mrb = box(mul(Ir, Ib));
        const mgg = box(mul(Ig, Ig)), mgb = box(mul(Ig, Ib)), mbb = box(mul(Ib, Ib));
        const ar = new Float32Array(M), ag = new Float32Array(M), ab = new Float32Array(M), bb2 = new Float32Array(M);
        for (let m = 0; m < M; m++) {
          // The window's colour covariance, regularised. EPS is what decides
          // whether a faint difference counts as an edge or as noise: too large
          // and the matte blurs across the silhouette, too small and grain in
          // flat cloth is mistaken for structure.
          const rr = mrr[m] - mIr[m] * mIr[m] + EPS, rg = mrg[m] - mIr[m] * mIg[m], rb = mrb[m] - mIr[m] * mIb[m];
          const gg = mgg[m] - mIg[m] * mIg[m] + EPS, gb = mgb[m] - mIg[m] * mIb[m], b2 = mbb[m] - mIb[m] * mIb[m] + EPS;
          const c0 = gg * b2 - gb * gb, c1 = gb * rb - rg * b2, c2 = rg * gb - gg * rb;
          let det = rr * c0 + rg * c1 + rb * c2;
          if (Math.abs(det) < 1e-12) det = det < 0 ? -1e-12 : 1e-12;
          const i00 = c0 / det, i01 = c1 / det, i02 = c2 / det;
          const i11 = (rr * b2 - rb * rb) / det, i12 = (rb * rg - rr * gb) / det;
          const i22 = (rr * gg - rg * rg) / det;
          const cr = mIrP[m] - mIr[m] * mP[m], cg = mIgP[m] - mIg[m] * mP[m], cb = mIbP[m] - mIb[m] * mP[m];
          const Ar = i00 * cr + i01 * cg + i02 * cb;
          const Ag = i01 * cr + i11 * cg + i12 * cb;
          const Ab2 = i02 * cr + i12 * cg + i22 * cb;
          ar[m] = Ar; ag[m] = Ag; ab[m] = Ab2;
          bb2[m] = mP[m] - Ar * mIr[m] - Ag * mIg[m] - Ab2 * mIb[m];
        }
        // Every window that contains a pixel offers a fit for it; the filter's
        // answer is their average, which is what makes the result continuous.
        const mar = box(ar), mag = box(ag), mab = box(ab), mb = box(bb2);
        const q = new Float32Array(N);
        for (let i = 0; i < N; i++) q[i] = cov[i];
        for (let y = 0; y < bh; y++) {
          for (let x = 0; x < bw; x++) {
            const m = y * bw + x, i = (y + by0) * W + (x + bx0);
            let v = mar[m] * Ir[m] + mag[m] * Ig[m] + mab[m] * Ib[m] + mb[m];
            q[i] = v < 0 ? 0 : v > 1 ? 1 : v;
          }
        }
        return q;
      };

        // The border's own direction, still needed to reach the scene beside each
        // pixel when it is rebuilt. Taken from a blurred copy so one rough pixel
        // cannot set it.
        const blur = (inp) => {
          const t = new Float32Array(N), o = new Float32Array(N);
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const a2 = inp[y * W + Math.max(0, x - 1)], b2 = inp[y * W + x], c2 = inp[y * W + Math.min(W - 1, x + 1)];
            t[y * W + x] = (a2 + 2 * b2 + c2) / 4;
          }
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const a2 = t[Math.max(0, y - 1) * W + x], b2 = t[y * W + x], c2 = t[Math.min(H - 1, y + 1) * W + x];
            o[y * W + x] = (a2 + 2 * b2 + c2) / 4;
          }
          return o;
        };
        const Ab = blur(blur(A));
        const matted = matteAlpha(A);
        const wide = matted || A;

        // ---- rebuilt from what is actually beside it
        for (let i = 0; i < N; i++) {
          if (!elig[i] && !inner[i]) continue;
          let a = wide[i];
          // Inside the silhouette the matte is trusted to shape the ramp, not to
          // decide membership: this pixel is cloth, and the only question is what
          // fraction of it the lens shared with the scene. One pixel in may give
          // half of itself away, two pixels in a quarter, and no further — beyond
          // that a low answer is the filter reaching across the boundary for a
          // window's worth of background, not a real partial coverage.
          if (inner[i]) {
            const floor = 1 - 0.5 / distIn[i];
            if (a < floor) a = floor;
          }
          // The matte refines the border's SHAPE; it does not get to overrule direct
          // evidence that a pixel IS cloth. Where the ordering evidence is strong —
          // the same signal keyMiss counts, and the one that survives shadow because
          // dimming leaves a colour's ordering alone — coverage is held up. Without
          // this the filter pulled shadowed fabric below half on bright-airy-f and
          // sky-f, and their violet came through on pink at 122 and 147 px.
          //
          // What is held up is the INVARIANT, not the number. The guard used to copy
          // the raw coverage back in wherever it was higher, which reinstated the very
          // staircase the matte had just resolved — the raw field is quantised to whole
          // source pixels and the copy dragged that quantisation through. The evidence
          // says two things and only two: this neighbourhood is cloth, so coverage may
          // not fall below the neighbourhood's own smoothed value; and a pixel the raw
          // reading calls majority cloth stays majority cloth, which is exactly what
          // keyMiss asserts. Stating it that way took cafe-f from 112.5 to 98.7 and
          // livingroom-m from 91.2 to 84.1 with keyMiss unchanged on every template.
          if (orderEv[i] > 0.5) {
            if (a < Ab[i]) a = Ab[i];
            if (A[i] >= 0.5 && a < 0.5) a = 0.5;
          }
          // The border may be tidied, never marched. Half a pixel is the width of
          // the quantisation being removed; beyond that the outline would be
          // changing shape, which is a different thing and not wanted.
          const a0 = A[i];
          if (a > a0 + 1.0) a = a0 + 1.0; else if (a < a0 - 1.0) a = a0 - 1.0;
          if (a < 0) a = 0; else if (a > 1) a = 1;
          // Only where there is actually a transition. A pixel the matte calls
          // solid scene or solid cloth is not a boundary and has nothing to gain
          // here — and at a flat coverage the normal below is meaningless.
          if (a < 0.02 || a > 0.995) continue;
          const x = i % W, y = (i / W) | 0;
          const gx = (Ab[y * W + Math.min(W - 1, x + 1)] - Ab[y * W + Math.max(0, x - 1)]) / 2;
          const gy = (Ab[Math.min(H - 1, y + 1) * W + x] - Ab[Math.max(0, y - 1) * W + x]) / 2;
          const gl = Math.hypot(gx, gy);
          if (gl < 1e-4) continue;
          const nx = gx / gl, ny = gy / gl;
          // The scene behind this pixel, taken from the scene BESIDE it. Stepping
          // outward along the normal reaches real background a few pixels away —
          // its own colour, its own blur, its own leaf — where the global estimate
          // reaches for whatever is nearest and can fetch the road from behind a
          // narrow arm. Two distances, the further one preferred, so a thin band
          // still lands outside it.
          // Walk outward until the sample is genuinely OUTSIDE, and refuse it if it
          // never gets there. Sampling blind along the normal is how a light sky
          // pixel (220,213,231) came back as dark violet (75,40,125): where the
          // coverage field is flat its gradient is noise, the "outward" step landed
          // back inside the garment, and the fill wrote cloth into the sky. Weight
          // was zero there, so no paint gate could see it — the damage was in the
          // photograph, not in the mask.
          let Br = bgC[i * 3], Bg = bgC[i * 3 + 1], Bb = bgC[i * 3 + 2];
          let walked = false;
          for (const step of [4, 6, 9, 13]) {
            const bx = x - nx * step, by = y - ny * step;
            if (bx < 0 || bx > W - 1 || by < 0 || by > H - 1) break;
            if (sample(Ab, 1, 0, bx, by) > 0.12) continue;
            const bi = Math.round(by) * W + Math.round(bx);
            if (!usable(bi)) continue;
            Br = sample(pd.data, 4, 0, bx, by);
            Bg = sample(pd.data, 4, 1, bx, by);
            Bb = sample(pd.data, 4, 2, bx, by);
            walked = true;
            break;
          }
          const o = i * 4, sb = Math.round(shadeVal[i] * 255) * 3;
          if (inner[i]) {
            // Inside the garment there is no fallback: bgC is diffused into the
            // ring only, so it reads 0 here and composing against it would paint
            // a black line one pixel inside the hem. If the walk did not reach
            // real background, this pixel keeps its photograph.
            if (!walked) continue;
          }
          // No special case at low coverage. The composite below IS the answer at
          // every alpha — at a=0 it is exactly the scene — and carving out an
          // exception meant a pixel the matte called one-twentieth cloth kept its
          // photograph, which still holds that twentieth of violet with no weight
          // left to cancel it. Only true dust is dropped.
          // The cloth endpoint is the MODELLED violet at this pixel's own shade —
          // the one the runtime cancels exactly — so the rebuilt pixel recolours
          // to a*target + (1-a)*scene and carries no violet into any colour.
          pd.data[o] = a * lutVm[sb] + (1 - a) * Br;
          pd.data[o + 1] = a * lutVm[sb + 1] + (1 - a) * Bg;
          pd.data[o + 2] = a * lutVm[sb + 2] + (1 - a) * Bb;
          // The background this pixel was composed against is now a measurement,
          // not a guess, so it is recorded. Downstream — the edge audit above all —
          // reads bgC as "what is behind this pixel"; leaving the old diffused
          // value there had the audit judging the composite against a background
          // it was never made from, and reporting every honest edge as too dark.
          bgC[i * 3] = Br; bgC[i * 3 + 1] = Bg; bgC[i * 3 + 2] = Bb;
          wMap[i] = a < 0.02 ? 0 : a; alphaA[i] = a; confA[i] = 1;
          // clip is the design's own mask — where a print may land — and it is a
          // question about the garment's solid body, not about this pixel's share
          // of the lens. Clearing it outside the silhouette is right; clearing it
          // one pixel inside would shave the print area along every edge.
          if (!inner[i]) clip[i] = 0;
          unrel[i] = 0;
          mConf[i] = 1; mConfS[i] = 1; mAlphaE[i] = a;
          // ownBlend is computed before the bake here, so it is corrected too.
          ownBlend[i] = 0;
          evAny[i] = Math.max(evAny[i], a);
        }
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
        wd.data[o + 2] = Math.round(255 * ownBlend[i]);
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
      // edge audit: recolour the silhouette to WHITE via the exact runtime
      // formula and count pixels landing outside the convex hull of their two
      // endpoints — the "dark outline / halo on light colours" defect class.
      //
      // EVERY boundary pixel is audited. It used to skip everything the matte
      // was not confident about, which inverted the audit's purpose: the pixels
      // the matte gives up on are exactly the ones no later stage can guarantee,
      // so the one defect class able to reach a shipped template unseen was the
      // one hiding in them. A hem against trousers put its entire broken dark
      // line there and this counted single digits while it shipped.
      //
      // What made the confidence filter tempting is that a real shadow — a
      // crease, a fold, the shade a hem casts on what is under it — also sits
      // below the hull of background and fabric, and counting those would drown
      // the number in photographic truth. So the SOURCE is audited too, against
      // the violet it actually shows, and only the EXCESS counts: darkness
      // already in the photograph cancels, and what is left is darkness the
      // recolour introduced. That is the defect either way, whether or not the
      // matte understood the pixel.
      //
      // The runtime formula is used entire, ownBlend included — modelling it as
      // if own were 0 understates precisely the pixels where own decides the
      // result.

      // ---- what the eye reads: how smooth the silhouette is ----
      // Every gate in this file counts a CONTAMINATION — background painted,
      // skin keyed, violet surviving. None of them counts a rough edge, and a
      // rough edge is the thing an operator sees first. That blind spot let a
      // day of changes improve every number here while the silhouette got
      // visibly worse, so the property is measured directly and from the final
      // weight map, which is what actually ships.
      //
      // Two numbers, both taken over the half-covered contour and both free of
      // orientation, so a hem, a shoulder and an armhole are judged alike:
      //
      //   width  where coverage ramps from 0 to 1 across an edge, the gradient
      //          IS the reciprocal of the ramp's width. A photographed edge
      //          spends 2.7-6.3 px; a generator's hard step spends under two,
      //          and that is what reads as cut out.
      //   rough  a smooth edge is locally PLANAR in coverage — along it the
      //          value barely changes, across it the value climbs evenly. So
      //          the residual against the plane implied by the pixel's own
      //          gradient is a direct measure of the staircase, and it needs
      //          no fitted curve, no scanline, and no assumption about which
      //          way the border runs.
      // Measured on the map that SHIPS, never on the analysis grid: a finer grid
      // spreads the same physical edge over more pixels and would flatter both
      // numbers without a single pixel of the output improving.
      //
      // ---- what the number means, and where it stops meaning anything ----
      // Two calibrations, both run and both worth keeping, because between them
      // they say when to stop.
      //
      // A mathematically perfect silhouette — an analytic curve, no grain — put
      // through this same downsample and 8-bit map reads 24 at a 3.2 px edge and
      // 12 at 4.6 px. That is the arithmetic floor, and it is the right yardstick
      // for one question only: is the pipeline adding a staircase of its own? At
      // 172 it plainly was.
      //
      // It is the WRONG yardstick for how good a photograph of a cotton hem can
      // be, and reading it as headroom is a way to spend weeks removing real
      // detail. So the other calibration: take coverage straight from a source
      // photograph with no pipeline in between — flat cloth against a plain wall,
      // where F and B are two constants and alpha = dot(I-B, F-B)/|F-B|^2 is the
      // exact answer — and measure that. See scratch/measure_photo_edge.cjs.
      // Across bright-minimal-m and gallery-f, at the widths this pipeline ships:
      //
      //   gallery-f       wall edge, sharp    width  2.40   rough 84.6
      //   bright-minimal  sleeve vs wall      width  6.86   rough 84.3
      //   bright-minimal  sleeve, shaded      width 11.97   rough 67.8
      //
      // A real photographic edge reads 68 to 85. The shipped set means 77.7 and
      // fourteen of seventeen sit inside or below that band — the maps are
      // already smoother than the photographs they came from, because the matte
      // suppresses grain the photograph has. Below about 85 this number no longer
      // separates a defect from the picture; judge those by eye. Above it —
      // stadium-hoodie-m at 116.7 — something is genuinely wrong, and worth
      // chasing.
      const measureEdge = (A, W2, H2) => {
        let n = 0, wsum = 0, rsum = 0;
        for (let i = 0; i < W2 * H2; i++) {
          const x = i % W2, y = (i / W2) | 0;
          if (x < 3 || y < 3 || x >= W2 - 3 || y >= H2 - 3) continue;
          const a = A[i];
          if (a < 0.2 || a > 0.8) continue;
          const gx = (A[i + 1] - A[i - 1]) / 2, gy = (A[i + W2] - A[i - W2]) / 2;
          const g = Math.hypot(gx, gy);
          // Too flat to be an edge: coverage that is not going anywhere says
          // nothing about the silhouette's shape.
          if (g < 0.02) continue;
          const wid = 1 / g;
          if (wid > 24) continue;
          let res = 0, m = 0;
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              if (!dx && !dy) continue;
              const v = A[i + dy * W2 + dx];
              // Only where the plane's own prediction is inside the ramp; past
              // 0 and 1 the coverage is clamped and the residual would measure
              // the clamp rather than the edge.
              const pred = a + gx * dx + gy * dy;
              if (pred < 0.05 || pred > 0.95) continue;
              res += Math.abs(v - pred); m++;
            }
          }
          if (m < 6) continue;
          rsum += res / m; wsum += wid; n++;
        }
        return n > 0
          ? { edgeWidth: +(wsum / n).toFixed(2), edgeRough: +((rsum / n) * 1000).toFixed(1) }
          : { edgeWidth: 0, edgeRough: 0 };
      };

      // How much LIGHT AND SHADOW the garment carries. The shade map is
      // illumination relative to the fabric's own diffuse white point, so its
      // spread inside solid fabric is the modelling the recolour has to work
      // with — and modelling is what makes a garment read as cloth rather than
      // a flat shape. Nothing else in this file measures it: a garment lit dead
      // flat passes every gate, recolours correctly, and still looks lifeless.
      // On white that costs nothing, since white is nearly flat anyway; on a
      // dark colour it is the whole picture, because the shading is all there
      // is to see.
      //
      // Across the shipped set this runs 54 to 141. sky-f at 54 is the one that
      // reads as a black silhouette on Vintage Black; everything from 78 up
      // holds its folds. Reported, never gated: a flat garment is not a broken
      // one, and dropping a live template over it is a judgement about how the
      // mockup sells rather than whether it is correct. The studio warns on it
      // so the next candidate is caught before it ships instead of after.
      let modelling = 0;
      {
        const v = [];
        for (let i = 0; i < N; i++) if (wMap[i] >= 0.94) v.push(Math.round(shadeVal[i] * 255));
        if (v.length >= 500) {
          v.sort((a, b) => a - b);
          modelling = v[Math.floor(0.95 * (v.length - 1))] - v[Math.floor(0.05 * (v.length - 1))];
        }
      }

      let edgeDark = 0, edgeBright = 0;
      {
        const lutW = mkRelight([255, 255, 255]);
        const lum = (r2, g2, b2) => 0.299 * r2 + 0.587 * g2 + 0.114 * b2;
        const below = (v, lo) => Math.max(0, lo - v);
        const above = (v, hi) => Math.max(0, v - hi);
        for (let i = 0; i < N; i++) {
          if (!ring[i]) continue;
          const o = i * 4, ww = wMap[i], cl2 = ownBlend[i];
          const sbB = Math.round(shadeVal[i] * 255) * 3;
          const px = (c2) => pd.data[o + c2] +
            ww * (lutW[sbB + c2] - cl2 * pd.data[o + c2] - (1 - cl2) * lutVm[sbB + c2]);
          const outL = lum(px(0), px(1), px(2));
          // The endpoint the runtime actually blends FROM. With own=0 that is the
          // background, and the result is the convex blend (1-a)*bg + a*T(shade). With
          // own=1 it is the PHOTOGRAPH: out = (1-w)*photo + w*T(shade). Judging the
          // second case against the background's luminance flags every hem shadow the
          // pipeline is deliberately keeping — truth in the picture, not a broken edge.
          const rL = cl2 * lum(pd.data[o], pd.data[o + 1], pd.data[o + 2])
            + (1 - cl2) * lum(bgC[i * 3], bgC[i * 3 + 1], bgC[i * 3 + 2]);
          const tL = lum(lutW[sbB], lutW[sbB + 1], lutW[sbB + 2]);
          // the same question asked of the photograph, whose fabric endpoint is
          // the violet it was shot in — this is the shadow genuinely there
          const sL = lum(src[o], src[o + 1], src[o + 2]);
          const vL = lum(lutVm[sbB], lutVm[sbB + 1], lutVm[sbB + 2]);
          if (below(outL, Math.min(rL, tL)) - below(sL, Math.min(rL, vL)) > 18) edgeDark++;
          if (above(outL, Math.max(rL, tL)) - above(sL, Math.max(rL, vL)) > 18) edgeBright++;
        }
      }
      // chroma audit: recolour to WHITE via the exact runtime formula and count
      // information-free garment pixels that come out CHROMATIC. This is the
      // defect that actually shipped — modelled violet (G far below R and B)
      // subtracted from a near-neutral crease over-subtracts G and the pixel
      // renders green. White is the worst case: it has the largest delta of any
      // target, so a template clean here is clean for every colour.
      //
      // Reported as a fraction of the information-free garment mask, not a raw
      // count, so the gate means the same thing at any resolution or crop.
      // For reference, the build that shipped the defect measured 0.72% on
      // gallery-f and 1.57% on livingroom-m; the fixed build measures under
      // 0.01% on every template. The gate sits between those, far from both.
      let chromaPx = 0, chromaMaskPx = 0, chromaWorst = 0;
      {
        const lutW = mkRelight([255, 255, 255]);
        for (let i = 0; i < N; i++) {
          const o = i * 4;
          const ww = wMap[i];
          if (ww < 0.125) continue;                       // not meaningfully recoloured
          const pl = (0.299 * pd.data[o] + 0.587 * pd.data[o + 1] + 0.114 * pd.data[o + 2]) / 255;
          if (pl > 0.16) continue;                        // information-free only
          chromaMaskPx++;
          const cl = ownBlend[i];
          const sbB = Math.round(shadeVal[i] * 255) * 3;
          // clamped exactly as the runtime does — it writes into a
          // Uint8ClampedArray, so a channel that computes to 260 lands at 255.
          // Measuring the raw floats invents differences the viewer never sees
          // and fails clean templates.
          const cx8 = v => v < 0 ? 0 : v > 255 ? 255 : v;
          const r2 = cx8(pd.data[o] + ww * (lutW[sbB] - cl * pd.data[o] - (1 - cl) * lutVm[sbB]));
          const g2 = cx8(pd.data[o + 1] + ww * (lutW[sbB + 1] - cl * pd.data[o + 1] - (1 - cl) * lutVm[sbB + 1]));
          const b2 = cx8(pd.data[o + 2] + ww * (lutW[sbB + 2] - cl * pd.data[o + 2] - (1 - cl) * lutVm[sbB + 2]));
          // GREEN excess specifically, not any-channel. The defect has a
          // signature: violet's G sits far below its R and B, so subtracting
          // modelled violet from a near-neutral crease lifts G relative to the
          // others and the pixel goes mint. Measured any-channel this also
          // counts RED excess, which in this mask is warm skin or hair caught
          // by the weight — a different defect, already covered by the `skin`
          // metric, and it swamps the signal: on plaster-f the any-channel
          // figure is 0.070% of which 0.062% is red and only 0.008% green.
          const exc = g2 - Math.max(r2, b2);
          if (exc > chromaWorst) chromaWorst = exc;
          if (exc > 6) chromaPx++;
        }
      }
      const chromaPct = +(100 * chromaPx / Math.max(1, chromaMaskPx)).toFixed(3);

      // Chroma key left behind. `missed` above asks the hue question and so
      // shares the exact blind spot it would need to see: fabric shadowed by
      // a warm occluder rotates out of the +-30deg window and goes uncounted.
      // This asks the ordering question instead, and asks it of the same
      // orderEv the recolour uses — so it states an invariant rather than a
      // second opinion: wherever the key's signature is unambiguous, the
      // pixel must have been recoloured. It can still fail, and the way it
      // fails is the one case the floor yields on: a confident matte against
      // a bright background. Counting raw green-lowest pixels instead was
      // useless as a gate — it scored 738 on gallery-f, which renders
      // correctly, because dark hair lying over the shirt picks up enough
      // violet bleed to satisfy the ordering and SHOULD stay unrecoloured.
      // Saturation is what separates the two, and orderEv already applies it.
      let keyMiss = 0;
      for (let i = 0; i < N; i++) if (orderEv[i] > 0.5 && wMap[i] < 0.5) keyMiss++;

      // The same question about the OTHER kind of mistake: something that is
      // not the garment carrying garment weight. `skin` asks it of warm
      // objects only, so black denim under the hem went unmeasured — the
      // waistband recoloured with the shirt and nothing said so. Red lowest
      // by a clear margin is the blue-cyan family and never violet, whose
      // lowest channel is green. Restricted to dark pixels because that is
      // where the weight arrives by diffusion rather than by the key.
      let coolPaint = 0;
      for (let i = 0; i < N; i++) {
        if (wMap[i] <= 0.5 || vA[i] >= 0.30) continue;
        const o = i * 4;
        if (Math.min(src[o + 1], src[o + 2]) - src[o] > 6) coolPaint++;
      }

      // Occluder pixels that would still recolour. The flood froze them out
      // of the closing and the completion, but weight from the union's own
      // evidence terms (violet bleed on glossy hair) or the floors survives
      // by design — this counts what survived, so a candidate whose hair or
      // hands would visibly take the target colour is measured instead of
      // discovered by eye in Step 3.
      let occPaint = 0;
      for (let i = 0; i < N; i++) if (occluder[i] && wMap[i] > 0.5) occPaint++;

      // Deep shadow next to hair or skin is measured separately from deep
      // shadow in the open garment. The gate this feeds exists for crushed
      // shadow bands across the visible chest, which no recolour can carry
      // on a pale target. Shadow the model's hair casts on a shoulder is a
      // different animal now: the occluder machinery renders it (and the
      // hair) photographically, so it looks like what it is, and counting
      // it in the gate just rejects every long-haired model — which is a
      // rule about hairstyles, not about photo quality. `nearHair` marks
      // everything within ~W/60 of frozen occluder pixels or warm-dark
      // (hair/skin) evidence; deep pixels there are excluded from the
      // gated fraction and reported separately as hairShadowPct.
      const nearHair = new Uint8Array(N);
      {
        let m2 = new Uint8Array(N);
        for (let i = 0; i < N; i++) {
          if (occluder[i]) { m2[i] = 1; continue; }
          const o = i * 4;
          if (src[o] - src[o + 2] >= 8 && src[o] - src[o + 1] >= 3 && vA[i] < 0.5) m2[i] = 1;
        }
        const HR = Math.max(6, Math.round(W / 60));
        for (let k = 0; k < HR; k++) m2 = dil(m2);
        nearHair.set(m2);
      }
      let missed = 0, skin = 0, gN = 0, deepN = 0, deepHairN = 0, bgPaint = 0;
      for (let i = 0; i < N; i++) {
        if (sA[i] > 0.25 && vA[i] > 0.15 && ad(hA[i], shirtHue) < 30 && wMap[i] < 0.3) missed++;
        if (sA[i] > 0.15 && sA[i] < 0.55 && vA[i] > 0.30 && ad(hA[i], 25) < 25 && wMap[i] > 0.7) skin++;
        if (wMap[i] > 0.04 || clip[i] > 0.04) {
          gN++;
          if (vA[i] < 0.16) { if (nearHair[i]) deepHairN++; else deepN++; }
        }
        // background pixels that would be recoloured with no violet evidence
        // of any kind — exactly the class that painted a bright rim around
        // the silhouette
        if (outside[i] && !crevice[i] && wMap[i] > 0.08 && evAny[i] < 0.05) bgPaint++;
      }
      const deepShadowPct = +(100 * deepN / Math.max(1, gN)).toFixed(2);
      const hairShadowPct = +(100 * deepHairN / Math.max(1, gN)).toFixed(2);

      const dbg = dbgPx.map(([x, y]) => {
        const i = y * W + x, o = i * 4;
        const d2 = sgn(hA[i]);
        const lim2 = d2 >= 0 ? 65 : 45 + 25 * (1 - smooth(vA[i], 0.10, 0.30));
        const a2 = Math.abs(d2);
        const hueClose = a2 <= 30 ? 1 : a2 >= lim2 ? 0 : 0.5 + 0.5 * Math.cos((a2 - 30) / (lim2 - 30) * Math.PI);
        return { x, y, rgb: [src[o], src[o+1], src[o+2]], h: +hA[i].toFixed(1), s: +sA[i].toFixed(3), v: +vA[i].toFixed(3),
          wRaw: +wRaw[i].toFixed(3), core: core[i], outside: outside[i], gate: gate[i],
          clip: +clip[i].toFixed(3), hueClose: +hueClose.toFixed(3),
          ev: +(hueClose * smooth(sA[i], 0.05, 0.18)).toFixed(3), wMap: +wMap[i].toFixed(3), shirtHue, orderEv: +orderEv[i].toFixed(3), unrel: +unrel[i].toFixed(3), clip: +clip[i].toFixed(3), conf: +confA[i].toFixed(3) };
      });
      // ---- decided at the native grid, shipped at the old one ----
      // An exact area average: each output pixel is the mean of the input
      // rectangle it covers, weighted by overlap, so a border that fell between
      // samples upstairs arrives downstairs as a genuine fraction. Box, not
      // bilinear — bilinear samples points and would carry the staircase down
      // with it, while an area average integrates coverage, which is precisely
      // what alpha means.
      const areaDown = (cv, OW, OH) => {
        const sw = cv.width, sh = cv.height;
        if (sw === OW && sh === OH) return cv;
        const sd = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
        const out = document.createElement('canvas'); out.width = OW; out.height = OH;
        const octx = out.getContext('2d');
        const od = octx.createImageData(OW, OH);
        const rx = sw / OW, ry = sh / OH;
        for (let oy = 0; oy < OH; oy++) {
          const y0 = oy * ry, y1 = (oy + 1) * ry;
          const iy0 = Math.floor(y0), iy1 = Math.min(sh - 1, Math.ceil(y1) - 1);
          for (let ox = 0; ox < OW; ox++) {
            const x0 = ox * rx, x1 = (ox + 1) * rx;
            const ix0 = Math.floor(x0), ix1 = Math.min(sw - 1, Math.ceil(x1) - 1);
            let ar = 0, ag = 0, ab = 0, aa = 0, wsum = 0;
            for (let y = iy0; y <= iy1; y++) {
              const wy = Math.min(y + 1, y1) - Math.max(y, y0);
              if (wy <= 0) continue;
              for (let x = ix0; x <= ix1; x++) {
                const wx = Math.min(x + 1, x1) - Math.max(x, x0);
                if (wx <= 0) continue;
                const w2 = wx * wy, o = (y * sw + x) * 4;
                ar += sd[o] * w2; ag += sd[o + 1] * w2; ab += sd[o + 2] * w2; aa += sd[o + 3] * w2;
                wsum += w2;
              }
            }
            const oo = (oy * OW + ox) * 4, inv = wsum > 0 ? 1 / wsum : 0;
            od.data[oo] = ar * inv; od.data[oo + 1] = ag * inv;
            od.data[oo + 2] = ab * inv; od.data[oo + 3] = aa * inv;
          }
        }
        octx.putImageData(od, 0, 0);
        return out;
      };
      const oK = Math.min(1, MAX_EDGE / Math.max(W, H));
      const OW = Math.round(W * oK), OH = Math.round(H * oK);
      const photoOut = areaDown(photo, OW, OH);
      const wpngOut = areaDown(wpng, OW, OH);
      const shadeOut = areaDown(shadeCv, OW, OH);
      // The gate reads the map that ships, so the measure is taken from it.
      const wOutData = wpngOut.getContext('2d', { willReadFrequently: true })
        .getImageData(0, 0, OW, OH).data;
      const aOut = new Float32Array(OW * OH);
      for (let i = 0; i < OW * OH; i++) aOut[i] = wOutData[i * 4] / 255;
      const em = measureEdge(aOut, OW, OH);
      const edgeWidth = em.edgeWidth, edgeRough = em.edgeRough;
      // Geometry travels with the maps, or the print area lands somewhere else.
      const nrm = (v) => Math.round(v * (OW * OH) / (W * H));
      const sc = (p2) => [p2[0] * oK, p2[1] * oK];
      const quadOut = { tl: sc(quad.tl), tr: sc(quad.tr), br: sc(quad.br), bl: sc(quad.bl) };

      return {
        dbg, W: OW, H: OH, shirtHue, fragments, ambientTint, quad: quadOut,
        bbox: { x: mnX * oK, y: mnY * oK, w: bw * oK, h: bh * oK },
        vRef: +vRef.toFixed(4), relMax: REL_MAX, violetBase,
        // Counts are expressed PER SHIPPED PIXEL. Every threshold in this file
        // was calibrated when the analysis grid and the shipped grid were the
        // same size; now that the pipeline thinks at the native resolution, a
        // raw count would rise with the area alone and each limit would
        // silently tighten by the same 1.5x. rooftop's coolPaint went 428 to
        // 652 on exactly that arithmetic, with nothing about the image or the
        // mask changed. Ratios and the two edge numbers are already scale-free
        // and are left alone.
        qa: { missed: nrm(missed), skin: nrm(skin), bgPaint: nrm(bgPaint), edgeDark: nrm(edgeDark), edgeBright: nrm(edgeBright),
          edgeWidth, edgeRough, wedgePx: nrm(wedgePx), modelFit: +(fitSum / Math.max(1, fitCnt)).toFixed(2), deepShadowPct, hairShadowPct,
          chromaPct, chromaWorst: +chromaWorst.toFixed(1), chromaPx: nrm(chromaPx), chromaMaskPx: nrm(chromaMaskPx),
          keyMiss: nrm(keyMiss), coolPaint: nrm(coolPaint), occPaint: nrm(occPaint), modelling },
        photo: photoOut.toDataURL('image/jpeg', 1.0),
        weight: wpngOut.toDataURL('image/png'),
        shade: shadeOut.toDataURL('image/jpeg', 0.92),
        // Thumbnail-sized copies of the same three maps. The picker recolours
        // its thumbnails with the live shirt colour, which needs weight and
        // shade as well as the photo — and downloading three full-size maps per
        // template just to draw a 112px tile would cost megabytes on a page
        // that otherwise loads one template on demand. About 10KB each instead.
        ...(() => {
          const TW = 112, TH = 168;
          // Scaled to COVER the tile and centre-cropped, not stretched into it.
          // Every template was 2:3 when this was written, so drawing the whole
          // source into a fixed 112x168 box happened to be exact and the
          // distinction never came up. A template at any other aspect gets
          // squashed instead: cafe-f is 1285x1600, which is 17% narrower than
          // it should be in the picker, and the model reads visibly squeezed.
          //
          // Cover keeps the picker's grid uniform, which is what the fixed tile
          // is for, and keeps proportions, which is what it is showing. The
          // same transform is applied to all three layers — a weight or shade
          // map cropped differently from its photo would misalign the picker's
          // live recolour. A 2:3 source scales to exactly 112x168 with nothing
          // cropped, so the other templates are untouched.
          const small = (srcCv, type, q) => {
            const c = document.createElement('canvas');
            c.width = TW; c.height = TH;
            const x = c.getContext('2d');
            x.imageSmoothingQuality = 'high';
            const s = Math.max(TW / srcCv.width, TH / srcCv.height);
            const w = srcCv.width * s, h = srcCv.height * s;
            x.drawImage(srcCv, (TW - w) / 2, (TH - h) / 2, w, h);
            return c.toDataURL(type, q);
          };
          return {
            thumbPhoto: small(photoOut, 'image/jpeg', 0.86),
            thumbWeight: small(wpngOut, 'image/png'),
            thumbShade: small(shadeOut, 'image/jpeg', 0.84),
          };
        })(),
      };
    }, { b64, srcMime, MAX_EDGE, ANALYSIS_EDGE, dbgPx });
    if (r.dbg && r.dbg.length) console.log('\nDBG', JSON.stringify(r.dbg, null, 1));

    // QA gate, mechanising the guide's "no hard shadow band" rule. A garment
    // whose deep-shadow fraction is this high has a broad near-black band that
    // no recolour can make look right on a pale target — the photo needs
    // regenerating with softer light, not more pipeline work.
    if (r.qa.deepShadowPct > 8) {
      console.log(`${r.W}x${r.H} deepShadow=${r.qa.deepShadowPct}% — FAILS QA (hard shadow band), excluded from manifest`);
      continue;
    }
    // Chroma in an information-free crease means the modelled violet is not
    // cancelling — the defect class that shipped green underarms. It is a
    // build error rather than a bad photograph, so this fails loudly instead
    // of quietly dropping the template: a source that trips it will trip it
    // again next build, and silently shipping four templates instead of five
    // is how the last one went unnoticed.
    if (r.qa.chromaPct > 0.1) {
      console.error(`${r.W}x${r.H} chroma=${r.qa.chromaPct}% worst=${r.qa.chromaWorst} — FAILS QA`);
      console.error('  Information-free garment pixels are rendering chromatic under a white shirt.');
      console.error('  That is modelled violet failing to cancel, not a property of the photo.');
      console.error('  Check the own-value blend (weight map B channel) before shipping.');
      process.exitCode = 1;
      continue;
    }
    if (r.qa.chromaPct > 0.03) {
      console.log(`  ! chroma=${r.qa.chromaPct}% worst=${r.qa.chromaWorst} — above the warn line, inspect white before shipping`);
    }

    // Chroma key left unrecoloured. Unlike the deep-shadow gate this is not a
    // property of the photo to be reshot — it is the pipeline failing to key
    // fabric it had the evidence to key, and it shows as a coloured stripe of
    // the ORIGINAL violet wherever the garment is shadowed by something dark:
    // the collar under hair, the inside of an elbow. It is invisible on a
    // violet or navy target and obvious on pink or white, so a build cannot
    // be trusted without it. Measured against the same evidence the recolour
    // uses, so it fails only where the floor deliberately yields — a
    // confident matte against a bright background — which is the case worth
    // being told about. Every shipping template scores <= 42 with the
    // ordering backstop in place; with it removed bright-airy-f scores 848
    // and livingroom-m 144. The lines sit between those.
    if (r.qa.keyMiss > 120) {
      console.error(`${r.W}x${r.H} keyMiss=${r.qa.keyMiss} — FAILS QA`);
      console.error('  Saturated violet fabric next to the garment is staying unrecoloured.');
      console.error('  It will read as a coloured stripe on pink and white targets.');
      console.error('  Check the ordering floor and the matte confidence before shipping.');
      process.exitCode = 1;
      continue;
    }
    if (r.qa.keyMiss > 60) {
      console.log(`  ! keyMiss=${r.qa.keyMiss} — above the warn line, inspect pink at the collar and underarm`);
    }

    // The mirror of keyMiss: something that is not the garment being painted
    // with it. Dark denim under the hem is the case that motivated it — the
    // waistband came out white on a white shirt. The lines sit above a noise
    // floor rather than at zero: near-black pixels carry a few levels of
    // chroma noise, so a clean template still scores in the low hundreds
    // (bright-airy-f 222, whose two hem pixels are correct on inspection),
    // while miami-f scored 3174 with a genuinely painted waistband.
    if (r.qa.coolPaint > 600) {
      console.error(`${r.W}x${r.H} coolPaint=${r.qa.coolPaint} — FAILS QA`);
      console.error('  Dark blue or black pixels below the garment are being recoloured.');
      console.error('  Usually jeans or a waistband taking weight the shirt diffused into them.');
      console.error('  Check the unrel chroma directions and the harmonic completion.');
      process.exitCode = 1;
      continue;
    }
    if (r.qa.coolPaint > 250) {
      console.log(`  ! coolPaint=${r.qa.coolPaint} — above the warn line, inspect the hem and waistband on white`);
    }

    // ---- the edge may not get worse than it is today ----
    // This gate exists because of a specific failure. Over one session every
    // number in this file improved — background paint fell, the neutral-target
    // cast fell by a third, unkeyed violet fell from 62 px to 19 — while the
    // silhouette the operator actually looks at got visibly rougher, and three
    // builds shipped on that evidence. A measure that cannot see the failure
    // will certify it. So the shipped edge is frozen as a floor: a change may
    // make the border smoother or softer, never rougher or harder, and a build
    // that does is stopped here rather than discovered on a phone screen.
    //
    // The tolerances are the measure's own reproducibility, not a licence to
    // drift — a rebuild of unchanged code reproduces these to the decimal.
    if (EDGE_BASE[tpl.id]) {
      const b = EDGE_BASE[tpl.id];
      const roughMax = b.edgeRough * 1.06 + 2;
      // Roughness is the floor that matters and it never moves. Width is NOT
      // a floor against yesterday, and setting it as one was a mistake made
      // before the two were told apart: it treats "softer" as "better", so it
      // forbids the one thing that actually helps. Deciding on the native grid
      // and averaging down produces an edge that is both narrower AND far
      // smoother — gallery-f 8.06 px/120.5 to 6.86 px/98.2 — which is what a
      // properly resolved boundary looks like, and what the crops confirm.
      // What width must never do is collapse to a cut-out, so it is held to an
      // absolute floor drawn from photography rather than from the last build.
      const widthMin = 2.4;
      const bad = r.qa.edgeRough > roughMax || r.qa.edgeWidth < widthMin;
      // An escape hatch for LOOKING, never for shipping: it prints the verdict
      // and keeps building so the crops can be compared side by side. The
      // manifest it writes is not fit to publish.
      if (bad && process.env.EDGE_GATE === 'warn') {
        console.log(`  ! edgeRough=${r.qa.edgeRough} (floor ${b.edgeRough}) edgeWidth=${r.qa.edgeWidth} (floor ${b.edgeWidth}) — would FAIL`);
      } else if (bad) {
        console.error(`${r.W}x${r.H} edgeRough=${r.qa.edgeRough} (floor ${b.edgeRough}) edgeWidth=${r.qa.edgeWidth} (floor ${b.edgeWidth}) — FAILS QA`);
        console.error('  The silhouette is rougher or harder than the build this replaces.');
        console.error('  Every other gate here counts contamination; this one counts what the eye reads.');
        console.error('  Compare crops before editing scratch/edge-baseline.json.');
        process.exitCode = 1;
        continue;
      }
    }

    // The edge audit stays INFORMATIONAL. It was briefly gated, on the reasoning
    // that an unenforced number is how a broken hem reaches the manifest — but
    // the number it gated was mis-specified: it judged every pixel against the
    // background's luminance, including the ones the runtime blends from the
    // photograph, where a kept hem shadow reads as an excursion. Corrected (see
    // the audit itself), it is a true statement about a narrow class and reads
    // ~0 on every template here, so gating it would assure rather than protect.
    //
    // The defect it was reached for — a comb of teeth along a hem, from the
    // matte reading shaded trousers as coverage — has no global scalar that
    // separates it from a legitimately busy silhouette: boundary roughness and
    // phantom-coverage fraction were both tried and both rank clean templates
    // above a visibly broken one. That class is prevented at source instead, in
    // the matte's confidence, and checked by eye.

    fs.writeFileSync(path.join(OUT_DIR, `${tpl.id}-photo.jpg`), Buffer.from(r.photo.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT_DIR, `${tpl.id}-weight.png`), Buffer.from(r.weight.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT_DIR, `${tpl.id}-shade.jpg`), Buffer.from(r.shade.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT_DIR, `${tpl.id}-thumb-photo.jpg`), Buffer.from(r.thumbPhoto.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT_DIR, `${tpl.id}-thumb-weight.png`), Buffer.from(r.thumbWeight.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT_DIR, `${tpl.id}-thumb-shade.jpg`), Buffer.from(r.thumbShade.split(',')[1], 'base64'));

    // ?v= a hash of the file's own bytes: same content, same URL, so nothing is
    // re-downloaded needlessly; changed content, changed URL, so nothing stale
    // can be served.
    const asset = (name) =>
      `/assets/on-model/${name}?v=${version(path.join(OUT_DIR, name))}`;

    manifest.push({
      id: tpl.id, label: tpl.label, model: tpl.model, scene: tpl.scene,
      width: r.W, height: r.H,
      photo: asset(`${tpl.id}-photo.jpg`),
      weight: asset(`${tpl.id}-weight.png`),
      shade: asset(`${tpl.id}-shade.jpg`),
      thumbPhoto: asset(`${tpl.id}-thumb-photo.jpg`),
      thumbWeight: asset(`${tpl.id}-thumb-weight.png`),
      thumbShade: asset(`${tpl.id}-thumb-shade.jpg`),
      thumbWidth: 112, thumbHeight: 168,
      ambientTint: r.ambientTint, relMax: r.relMax, violetBase: r.violetBase,
      quad: r.quad, bbox: r.bbox,
    });

    console.log(`${r.W}x${r.H} frags=${r.fragments} missed=${r.qa.missed} skin=${r.qa.skin} bgPaint=${r.qa.bgPaint} edgeDark=${r.qa.edgeDark} edgeBright=${r.qa.edgeBright} wedge=${r.qa.wedgePx} modelFit=${r.qa.modelFit} deepShadow=${r.qa.deepShadowPct}% hairShadow=${r.qa.hairShadowPct}% chroma=${r.qa.chromaPct}% keyMiss=${r.qa.keyMiss} coolPaint=${r.qa.coolPaint} occPaint=${r.qa.occPaint} edgeWidth=${r.qa.edgeWidth} edgeRough=${r.qa.edgeRough} modelling=${r.qa.modelling}`);
  }

  fs.writeFileSync(META_OUT, JSON.stringify(manifest, null, 2) + '\n');
  await browser.close();
  console.log(`\n${manifest.length} templates -> ${path.relative(process.cwd(), META_OUT)}`);
})().catch(e => { console.error(e); process.exit(1); });
