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

const SRC_DIR = process.env.ON_MODEL_SRC || path.join(__dirname, 'on-model-src');
const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'on-model');
const META_OUT = path.join(OUT_DIR, 'templates.json');
const MAX_EDGE = 1600;

const TEMPLATES = [
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
    const r = await page.evaluate(async ({ b64, srcMime, MAX_EDGE, dbgPx }) => {
      const load = s => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = s; });
      const img = await load('data:' + srcMime + ';base64,' + b64);
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
      const mConfS = new Float32Array(N);
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
        mAlpha[i] = a2; mConf[i] = conf; mConfS[i] = confS;
        // Weight assignment and photo bake stay confined to the inner ring
        // and to the STRICT confidence; the outer half of the ring and the
        // relaxed confidence are measurement for the cap only.
        if (crevice[i] || distC[i] > RING) continue;
        alphaA[i] = a2; confA[i] = confS;
        wMap[i] = confS * a2 + (1 - confS) * wMap[i];
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
          const cE = new Float32Array(N), cS = new Float32Array(N);
          for (let i = 0; i < N; i++) {
            const x = i % W;
            cE[i] = x + 1 < W ? 1 - smooth(Math.abs(vA[i] - vA[i + 1]), 0.055, 0.14) : 0;
            cS[i] = i + W < N ? 1 - smooth(Math.abs(vA[i] - vA[i + W]), 0.055, 0.14) : 0;
          }
          const base = new Float32Array(wMap);
          for (let pass = 0; pass < 700; pass++) {
            for (let k = 0; k < idx.length; k++) {
              const i = idx[k], x = i % W;
              if (x < 1 || x >= W - 1 || i < W || i >= N - W) continue;
              const gw = cE[i - 1], ge = cE[i], gn = cS[i - W], gs = cS[i];
              const gsum = gw + ge + gn + gs;
              if (gsum < 1e-4) continue;
              const avg = (gw * wMap[i - 1] + ge * wMap[i + 1] + gn * wMap[i - W] + gs * wMap[i + W]) / gsum;
              wMap[i] = (1 - unrel[i]) * base[i] + unrel[i] * avg;
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
        const fl = mAlpha[i] * Math.max(0, Math.min(1, mConfS[i])) * smooth(bgL, 60, 110);
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
      for (let i = 0; i < N; i++) {
        if (!outside[i]) continue;
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
      return {
        dbg, W, H, shirtHue, fragments, ambientTint, quad,
        bbox: { x: mnX, y: mnY, w: bw, h: bh },
        vRef: +vRef.toFixed(4), relMax: REL_MAX, violetBase,
        qa: { missed, skin, bgPaint, edgeDark, edgeBright, wedgePx, modelFit: +(fitSum / Math.max(1, fitCnt)).toFixed(2), deepShadowPct, hairShadowPct,
          chromaPct, chromaWorst: +chromaWorst.toFixed(1), chromaPx, chromaMaskPx, keyMiss, coolPaint, occPaint },
        photo: photo.toDataURL('image/jpeg', 1.0),
        weight: wpng.toDataURL('image/png'),
        shade: shadeCv.toDataURL('image/jpeg', 0.92),
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
            thumbPhoto: small(photo, 'image/jpeg', 0.86),
            thumbWeight: small(wpng, 'image/png'),
            thumbShade: small(shadeCv, 'image/jpeg', 0.84),
          };
        })(),
      };
    }, { b64, srcMime, MAX_EDGE, dbgPx });
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

    console.log(`${r.W}x${r.H} frags=${r.fragments} missed=${r.qa.missed} skin=${r.qa.skin} bgPaint=${r.qa.bgPaint} edgeDark=${r.qa.edgeDark} edgeBright=${r.qa.edgeBright} wedge=${r.qa.wedgePx} modelFit=${r.qa.modelFit} deepShadow=${r.qa.deepShadowPct}% hairShadow=${r.qa.hairShadowPct}% chroma=${r.qa.chromaPct}% keyMiss=${r.qa.keyMiss} coolPaint=${r.qa.coolPaint} occPaint=${r.qa.occPaint}`);
  }

  fs.writeFileSync(META_OUT, JSON.stringify(manifest, null, 2) + '\n');
  await browser.close();
  console.log(`\n${manifest.length} templates -> ${path.relative(process.cwd(), META_OUT)}`);
})().catch(e => { console.error(e); process.exit(1); });
