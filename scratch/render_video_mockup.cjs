#!/usr/bin/env node
/**
 * Render a baked video template into finished mockup frames, and measure the
 * three defects that were reported against the first cut of this feature:
 *
 *   violet  — residual garment hue anywhere in the FRAME, not merely inside
 *             some torso box. The first version recoloured a fixed rectangle,
 *             so a sleeve that swung outside it stayed violet; a whole-frame
 *             count is the only measurement that can see that.
 *   travel  — how far the print box moves over the clip. A print that is
 *             actually on the shirt moves with it; one pinned to the canvas
 *             does not.
 *   hair    — violet survival specifically in the band where the mask's
 *             coverage is partial, which is where hair crosses the garment.
 *
 * The composite is run through the SHIPPED runtime (src/scripts/onmodel-engine.js)
 * rather than a reimplementation of it, so what is measured is what the site
 * would draw.
 *
 * Usage: node scratch/render_video_mockup.cjs <bakeDir> <id> <#RRGGBB> <outDir> [designPng]
 */
const { chromium } = (() => {
  try { return require('playwright'); } catch { return require('playwright-core'); }
})();
const path = require('path');
const fs = require('fs');

(async () => {
  const [bakeArg, id, hex, outArg, designArg] = process.argv.slice(2);
  if (!bakeArg || !id || !hex || !outArg) {
    console.error('usage: node scratch/render_video_mockup.cjs <bakeDir> <id> <#RRGGBB> <outDir> [designPng]');
    process.exit(1);
  }
  const bakeDir = path.resolve(bakeArg);
  const outDir = path.resolve(outArg);
  const manifest = JSON.parse(fs.readFileSync(path.join(bakeDir, `${id}.json`), 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on('console', m => { if (m.type() === 'error') console.error('  page:', m.text()); });
  page.on('pageerror', e => console.error('  pageerror:', e.message));

  // The runtime is an ES module; load it as one and hand its exports to the
  // page scope so the render below calls the same functions the editor calls.
  const engineSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'scripts', 'onmodel-engine.js'), 'utf8');
  await page.setContent('<!doctype html><body></body>');
  await page.addScriptTag({ content: engineSrc.replace(/^export /gm, ''), type: 'module' });
  await page.addScriptTag({
    content: engineSrc.replace(/^export /gm, '') + '\nwindow.__engine = { onModelRelightLut, buildOnModelComposed, onModelHighlightCanvas, onModelClipCanvas, onModelShadeCanvas, buildDesignBuffer };',
    type: 'module',
  });
  await page.waitForFunction(() => !!window.__engine);

  const designB64 = designArg && fs.existsSync(designArg)
    ? fs.readFileSync(designArg).toString('base64') : null;

  const stats = [];
  for (let i = 0; i < manifest.frames; i++) {
    const files = manifest.frameFiles[i];
    const b64 = k => fs.readFileSync(path.join(bakeDir, files[k])).toString('base64');
    const r = await page.evaluate(async (args) => {
      const { photo, weight, shade, meta, quad, hex, designB64, trunkW } = args;
      const E = window.__engine;
      const load = s => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = s; });
      const [photoImg, weightImg, shadeImg] = await Promise.all([
        load('data:image/jpeg;base64,' + photo),
        load('data:image/png;base64,' + weight),
        load('data:image/jpeg;base64,' + shade),
      ]);
      const w = meta.width, h = meta.height, n = w * h;
      const tmp = document.createElement('canvas');
      tmp.width = w; tmp.height = h;
      const tctx = tmp.getContext('2d', { willReadFrequently: true });
      tctx.drawImage(photoImg, 0, 0, w, h);
      const photoData = new Uint8ClampedArray(tctx.getImageData(0, 0, w, h).data);
      tctx.clearRect(0, 0, w, h); tctx.drawImage(weightImg, 0, 0, w, h);
      const wRGBA = tctx.getImageData(0, 0, w, h).data;
      tctx.clearRect(0, 0, w, h); tctx.drawImage(shadeImg, 0, 0, w, h);
      const sRGBA = tctx.getImageData(0, 0, w, h).data;
      const wArr = new Uint8ClampedArray(n), clipArr = new Uint8ClampedArray(n);
      const ownArr = new Uint8ClampedArray(n), shadeArr = new Uint8ClampedArray(n);
      for (let p = 0; p < n; p++) {
        wArr[p] = wRGBA[p * 4]; clipArr[p] = wRGBA[p * 4 + 1];
        ownArr[p] = wRGBA[p * 4 + 2]; shadeArr[p] = sRGBA[p * 4];
      }
      const entry = {
        photo: photoImg, photoData, wArr, clipArr, ownArr, shade: shadeArr, w, h,
        meta: { ...meta, quad },
        lutV: E.onModelRelightLut(meta.violetBase, meta),
      };

      // --- recolour, exactly as the editor does ---
      const composed = E.buildOnModelComposed(entry, hex);

      // --- print the design into THIS frame's quad ---
      const out = document.createElement('canvas');
      out.width = w; out.height = h;
      const octx = out.getContext('2d', { willReadFrequently: true });
      octx.drawImage(composed, 0, 0);

      let printedAlpha = null;
      if (designB64) {
        const dImg = await load('data:image/png;base64,' + designB64);
        const { buffer } = E.buildDesignBuffer(dImg);
        const q = quad;
        const qcx = (q.tl[0] + q.tr[0] + q.br[0] + q.bl[0]) / 4;
        const qcy = (q.tl[1] + q.tr[1] + q.br[1] + q.bl[1]) / 4;
        const quadW = Math.hypot(q.tr[0] - q.tl[0], q.tr[1] - q.tl[1]);
        const quadH = Math.hypot(q.bl[0] - q.tl[0], q.bl[1] - q.tl[1]);
        // CONTAIN, not fit-by-one-axis. The old rule picked the axis from the
        // design's aspect alone — landscape fits width, anything else fits
        // height — which ignores the quad's own aspect and overflows whenever
        // the design is squarer than the print area. This print area is 264x320,
        // so a square design was scaled to 320x320: 21% wider than the area it
        // is supposed to sit inside, which is most of why the graphic read as
        // too big for the chest.
        const scale = Math.min(quadW / dImg.width, quadH / dImg.height);
        const dW = dImg.width * scale, dH = dImg.height * scale;

        // Drawn in the QUAD's axes, not the canvas's. The tracked quad now
        // carries the torso's lean, and an axis-aligned drawImage would throw
        // that away and leave the print upright on a body that is not — the
        // rotation being tracked has to reach the pixels to be worth tracking.
        const ux = [(q.tr[0] - q.tl[0]) / quadW, (q.tr[1] - q.tl[1]) / quadW];
        const uy = [(q.bl[0] - q.tl[0]) / quadH, (q.bl[1] - q.tl[1]) / quadH];

        // ---- the print is SAMPLED onto the fabric, not pasted onto it ----
        //
        // A single drawImage into a parallelogram is geometrically flat, and
        // flat is what reads as a sticker. Two things a real print does that
        // one drawImage cannot:
        //
        //   1. It wraps a torso, which is a cylinder seen from the front. A
        //      point at angle t off the centre line sits at R*sin(t) in the
        //      image, so equal steps of PRINTED distance are unequal steps of
        //      IMAGE distance, compressing toward the sides. The radius is not
        //      guessed: it comes from the trunk width the tracker already
        //      measures each frame.
        //
        //   2. It rides over folds. The shade map is the garment's own
        //      shading, so its gradient points across every crease; offsetting
        //      the sample position along that gradient makes the graphic dip
        //      into the folds the fabric actually has. The map is blurred
        //      first, hard, because the wanted signal is the fold and not the
        //      weave — displacing by unblurred shading modulates the print at
        //      pixel scale and reads as noise, not cloth.
        //
        // Both are inverse maps, so the design is sampled per output pixel
        // rather than transformed as a bitmap.
        const dW2 = dW / 2, dH2 = dH / 2;
        const R = Math.max(dW2 * 1.05, (trunkW || quadW * 1.7) / 2);
        const kMax = Math.min(0.97, dW2 / R);
        const sMax = Math.asin(kMax);
        // Fold displacement scales with the print, so it is the same physical
        // effect whatever size the design is placed at.
        // Magnitude AND blur width, swept together, because they are not
        // independent: the blur sets the SCALE of the deformation and the
        // magnitude only its depth. A narrow blur leaves fold structure at
        // 20px, and displacing by that bends the straight edges of a framed
        // design into visible waves — the graphic reads as warped rather than
        // draped, which is the failure that came back from review. Widening the
        // blur to 3% of frame width keeps only the chest's large-scale form, so
        // a straight border stays straight while still bending gently across
        // the body.
        //
        // With that scale, 0.006 of print width is enough. The cylinder
        // provides the main "this is on a body" cue; the folds are a secondary
        // effect and should read as one.
        const DISP = dW * 0.006;
        const BLUR = Math.max(2, Math.round(w * 0.030));

        const shadeCv = E.onModelShadeCanvas(entry);
        const sctx2 = shadeCv.getContext('2d', { willReadFrequently: true });
        const sdata = sctx2.getImageData(0, 0, w, h).data;
        // separable box blur of the shade channel, twice for a near-gaussian
        let sh = new Float32Array(n);
        for (let p = 0; p < n; p++) sh[p] = sdata[p * 4];
        const blurPass = (src2) => {
          const tmp2 = new Float32Array(n), out2 = new Float32Array(n);
          for (let y = 0; y < h; y++) {
            let acc = 0;
            for (let x = -BLUR; x <= BLUR; x++) acc += src2[y * w + Math.max(0, Math.min(w - 1, x))];
            for (let x = 0; x < w; x++) {
              tmp2[y * w + x] = acc / (2 * BLUR + 1);
              acc -= src2[y * w + Math.max(0, Math.min(w - 1, x - BLUR))];
              acc += src2[y * w + Math.max(0, Math.min(w - 1, x + BLUR + 1))];
            }
          }
          for (let x = 0; x < w; x++) {
            let acc = 0;
            for (let y = -BLUR; y <= BLUR; y++) acc += tmp2[Math.max(0, Math.min(h - 1, y)) * w + x];
            for (let y = 0; y < h; y++) {
              out2[y * w + x] = acc / (2 * BLUR + 1);
              acc -= tmp2[Math.max(0, Math.min(h - 1, y - BLUR)) * w + x];
              acc += tmp2[Math.max(0, Math.min(h - 1, y + BLUR + 1)) * w + x];
            }
          }
          return out2;
        };
        sh = blurPass(blurPass(sh));

        // NORMALISE the gradient field before using it as a displacement.
        //
        // The first version multiplied (gradient / 255) by the displacement
        // budget, treating the gradient as if it were a 0-1 fraction. It is
        // not: it is levels PER PIXEL, and after a blur wide enough to see
        // folds rather than weave, a fold spanning 40px and swinging 30 levels
        // gives 0.75 levels/px. Divided by 255 that is 0.003, times a 10px
        // budget it is three hundredths of a pixel. Measured on the delivered
        // clip: 0.01px mean, 0.06px max, against a 10.8px budget — the code
        // ran, every number was finite, and the print was flat anyway.
        //
        // What the budget should mean is "the strongest fold in the print area
        // moves the graphic this far", so the field is divided by its own
        // strength there — a high percentile rather than the maximum, so one
        // bright seam cannot define the scale for everything else.
        let gScale = 1;
        {
          const qcx0 = (q.tl[0] + q.tr[0] + q.br[0] + q.bl[0]) / 4;
          const qcy0 = (q.tl[1] + q.tr[1] + q.br[1] + q.bl[1]) / 4;
          const mags = [];
          for (let y = Math.max(1, Math.round(qcy0 - quadH / 2)); y < Math.min(h - 1, Math.round(qcy0 + quadH / 2)); y += 2) {
            for (let x = Math.max(1, Math.round(qcx0 - quadW / 2)); x < Math.min(w - 1, Math.round(qcx0 + quadW / 2)); x += 2) {
              const p = y * w + x;
              mags.push(Math.hypot((sh[p + 1] - sh[p - 1]) * 0.5, (sh[p + w] - sh[p - w]) * 0.5));
            }
          }
          if (mags.length > 32) {
            mags.sort((a2, b2) => a2 - b2);
            gScale = Math.max(1e-3, mags[Math.floor(mags.length * 0.9)]);
          }
        }

        // ---- prefilter the design to the scale it will actually be printed at ----
        //
        // The sampling loop below reads the design with bilinear interpolation,
        // which is correct for magnification and WRONG for minification: it
        // reads four texels and ignores everything in between. A 1066x1600
        // design printed into a 264x320 area is a 4x reduction, so bilinear
        // samples one pixel in sixteen and the fifteen it skips are simply
        // lost. On flat artwork nothing shows. On anything with fine detail —
        // a halftone, hatching, a photographic screenprint — the detail turns
        // into sampling noise that crawls from frame to frame as the print
        // moves, which is worse than losing it cleanly.
        //
        // The drawImage this replaced never had the problem because the
        // browser filters properly on its own downscale. So the design is
        // reduced first, by successive halving (each step averages 2x2, which
        // is what the sampler cannot do for itself), to about twice the printed
        // size — enough headroom for the bilinear read and the displacement,
        // without carrying detail the print area cannot hold.
        let dsrc = buffer;
        {
          const wantW = Math.max(8, Math.ceil(dW * 2)), wantH = Math.max(8, Math.ceil(dH * 2));
          while (dsrc.width > wantW * 2 && dsrc.height > wantH * 2) {
            const half = document.createElement('canvas');
            half.width = Math.max(1, dsrc.width >> 1); half.height = Math.max(1, dsrc.height >> 1);
            const hx = half.getContext('2d');
            hx.imageSmoothingEnabled = true; hx.imageSmoothingQuality = 'high';
            hx.drawImage(dsrc, 0, 0, half.width, half.height);
            dsrc = half;
          }
          if (dsrc.width > wantW) {
            const fin = document.createElement('canvas');
            fin.width = wantW; fin.height = Math.max(1, Math.round(dsrc.height * wantW / dsrc.width));
            const fx = fin.getContext('2d');
            fx.imageSmoothingEnabled = true; fx.imageSmoothingQuality = 'high';
            fx.drawImage(dsrc, 0, 0, fin.width, fin.height);
            dsrc = fin;
          }
        }
        const dcv = document.createElement('canvas');
        dcv.width = dsrc.width; dcv.height = dsrc.height;
        const dcx = dcv.getContext('2d', { willReadFrequently: true });
        dcx.drawImage(dsrc, 0, 0);
        const dPix = dcx.getImageData(0, 0, dsrc.width, dsrc.height).data;
        const dw = dsrc.width, dh = dsrc.height;

        const layer = document.createElement('canvas');
        layer.width = w; layer.height = h;
        const lc = layer.getContext('2d');
        const lay = lc.createImageData(w, h);

        // bounding box of the quad, padded for the displacement
        const xs = [q.tl[0], q.tr[0], q.br[0], q.bl[0]], ys = [q.tl[1], q.tr[1], q.br[1], q.bl[1]];
        const pad = DISP + 4;
        const x0 = Math.max(0, Math.floor(Math.min(...xs) - pad)), x1 = Math.min(w - 1, Math.ceil(Math.max(...xs) + pad));
        const y0 = Math.max(0, Math.floor(Math.min(...ys) - pad)), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys) + pad));

        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const p = y * w + x;
            const ddx = x - qcx, ddy = y - qcy;
            // into the quad's own axes
            let a = ddx * ux[0] + ddy * ux[1];
            let b = ddx * uy[0] + ddy * uy[1];

            // fold displacement: gradient of the blurred shading, taken in the
            // same axes so it survives the garment's lean
            const gx = (sh[p + 1] - sh[p - 1]) * 0.5;
            const gy = (sh[p + w] - sh[p - w]) * 0.5;
            const ga = gx * ux[0] + gy * ux[1];
            const gb = gx * uy[0] + gy * uy[1];
            a += (ga / gScale) * DISP;
            b += (gb / gScale) * DISP;

            if (Math.abs(a) > dW2 || Math.abs(b) > dH2) continue;
            // cylinder: image offset -> printed offset
            const t = Math.asin(Math.max(-1, Math.min(1, (a / dW2) * kMax))) / sMax;
            const su = (t * 0.5 + 0.5) * dw;
            const sv = (b / dH2 * 0.5 + 0.5) * dh;
            // bilinear sample of the design
            const iu = Math.floor(su), iv = Math.floor(sv);
            if (iu < 0 || iv < 0 || iu >= dw - 1 || iv >= dh - 1) continue;
            const fu = su - iu, fv = sv - iv;
            const o00 = (iv * dw + iu) * 4, o10 = o00 + 4, o01 = o00 + dw * 4, o11 = o01 + 4;
            const wq = [(1 - fu) * (1 - fv), fu * (1 - fv), (1 - fu) * fv, fu * fv];
            const o = p * 4;
            for (let ch = 0; ch < 4; ch++) {
              lay.data[o + ch] = dPix[o00 + ch] * wq[0] + dPix[o10 + ch] * wq[1]
                + dPix[o01 + ch] * wq[2] + dPix[o11 + ch] * wq[3];
            }
          }
        }
        // ---- make it INK, not a decal ----
        //
        // Measured against the reference clip, both a light graphic on a black
        // tee: a print edge there goes 10% to 90% over 5 pixels, ours over 1.
        // A one-pixel step is the signature of vector art laid on a photograph.
        // Ink on a knit cannot produce one — it wicks along the yarn before it
        // sets, and the camera has finite resolution besides — so the edge is
        // always a short ramp. Scaled to print width the reference is ~1.25%;
        // this radius puts us in the same place rather than matching a pixel
        // count measured at their resolution.
        //
        // Blurred PREMULTIPLIED. The design buffer's fully transparent pixels
        // carry arbitrary colour, and blurring straight RGBA drags that colour
        // into the ramp as a fringe around every letter.
        // 0.005 and not 0.008. The reference's 5px rise is measured on a print
        // ~400px wide; ours is 264px and is downscaled again on the way out, so
        // matching their pixel count over-softens ours by half. Scaled to print
        // width this lands at roughly their 1.25%, and it is the level at which
        // 1px line art in a design still holds its contrast — the failure on
        // the other side of this dial is a graphic that looks washed into the
        // shirt rather than printed on it.
        const INK = Math.max(1, Math.round(dW * 0.005));
        {
          const px = lay.data;
          for (let p = 0; p < n; p++) {
            const o = p * 4, a = px[o + 3] / 255;
            px[o] *= a; px[o + 1] *= a; px[o + 2] *= a;
          }
          const tmpA = new Float32Array(n * 4);
          const passH = (src2, dst2) => {
            for (let y = y0; y <= y1; y++) {
              for (let ch = 0; ch < 4; ch++) {
                let acc = 0;
                for (let k = -INK; k <= INK; k++) acc += src2[(y * w + Math.max(x0, Math.min(x1, x0 + k))) * 4 + ch];
                for (let x = x0; x <= x1; x++) {
                  dst2[(y * w + x) * 4 + ch] = acc / (2 * INK + 1);
                  acc -= src2[(y * w + Math.max(x0, Math.min(x1, x - INK))) * 4 + ch];
                  acc += src2[(y * w + Math.max(x0, Math.min(x1, x + INK + 1))) * 4 + ch];
                }
              }
            }
          };
          const passV = (src2, dst2) => {
            for (let x = x0; x <= x1; x++) {
              for (let ch = 0; ch < 4; ch++) {
                let acc = 0;
                for (let k = -INK; k <= INK; k++) acc += src2[(Math.max(y0, Math.min(y1, y0 + k)) * w + x) * 4 + ch];
                for (let y = y0; y <= y1; y++) {
                  dst2[(y * w + x) * 4 + ch] = acc / (2 * INK + 1);
                  acc -= src2[(Math.max(y0, Math.min(y1, y - INK)) * w + x) * 4 + ch];
                  acc += src2[(Math.max(y0, Math.min(y1, y + INK + 1)) * w + x) * 4 + ch];
                }
              }
            }
          };
          const srcF = Float32Array.from(px);
          passH(srcF, tmpA); passV(tmpA, srcF);
          for (let p = 0; p < n; p++) {
            const o = p * 4;
            const a = srcF[o + 3];
            px[o + 3] = a;
            if (a > 0.5) { px[o] = srcF[o] / (a / 255); px[o + 1] = srcF[o + 1] / (a / 255); px[o + 2] = srcF[o + 2] / (a / 255); }
            else { px[o] = px[o + 1] = px[o + 2] = 0; }
          }

          // The printed surface is still the fabric's surface, so it carries
          // the same weave and the same micro-shading. A graphic whose flat
          // areas are perfectly uniform sits on the cloth like a clean layer
          // over a grainy one, and the eye reads that as a paste-up even when
          // it cannot name it. The garment's own high-frequency residual —
          // what is left of the recoloured pixel after a small blur — is
          // exactly that texture, so it is carried into the ink.
          const gc = octx.getImageData(0, 0, w, h).data;
          const lum = new Float32Array(n);
          for (let p = 0; p < n; p++) lum[p] = gc[p * 4] * .299 + gc[p * 4 + 1] * .587 + gc[p * 4 + 2] * .114;
          const GR = 2;
          const lb = new Float32Array(n);
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            let s = 0, c3 = 0;
            for (let dy = -GR; dy <= GR; dy++) for (let dx = -GR; dx <= GR; dx++) {
              const yy = y + dy, xx = x + dx;
              if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
              s += lum[yy * w + xx]; c3++;
            }
            lb[y * w + x] = s / c3;
          }
          // 0.55 rather than 1.0: ink does flatten the weave it sits on, it
          // does not vanish into it.
          const GRAIN = 0.55;
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const p = y * w + x, o = p * 4;
            if (px[o + 3] < 8) continue;
            const hf = (lum[p] - lb[p]) * GRAIN;
            px[o] = Math.max(0, Math.min(255, px[o] + hf));
            px[o + 1] = Math.max(0, Math.min(255, px[o + 1] + hf));
            px[o + 2] = Math.max(0, Math.min(255, px[o + 2] + hf));
          }
        }
        lc.putImageData(lay, 0, 0);
        const printAlpha = document.createElement('canvas');
        printAlpha.width = w; printAlpha.height = h;
        printAlpha.getContext('2d').drawImage(layer, 0, 0);
        lc.globalCompositeOperation = 'multiply';
        lc.globalAlpha = 0.65;
        lc.drawImage(E.onModelShadeCanvas(entry), 0, 0);
        lc.globalAlpha = 1;
        lc.globalCompositeOperation = 'destination-in';
        lc.drawImage(printAlpha, 0, 0);
        lc.globalCompositeOperation = 'screen';
        lc.globalAlpha = 0.35;
        lc.drawImage(E.onModelHighlightCanvas(entry), 0, 0);
        lc.globalAlpha = 1;
        lc.globalCompositeOperation = 'destination-in';
        lc.drawImage(printAlpha, 0, 0);
        lc.globalCompositeOperation = 'destination-in';
        lc.drawImage(E.onModelClipCanvas(entry), 0, 0);
        printedAlpha = lc.getImageData(0, 0, w, h).data;
        octx.drawImage(layer, 0, 0);
      }

      // --- diagnostics over the WHOLE frame ---
      const od = octx.getImageData(0, 0, w, h).data;
      const hueOf = (r, g, b) => {
        const M = Math.max(r, g, b), m = Math.min(r, g, b), d = M - m;
        if (d < 1e-6) return [0, 0, M / 255];
        let hh;
        if (M === r) hh = ((g - b) / d) % 6;
        else if (M === g) hh = (b - r) / d + 2;
        else hh = (r - g) / d + 4;
        hh *= 60; if (hh < 0) hh += 360;
        return [hh, d / M, M / 255];
      };
      const hueDist = (a, t) => { const dd = Math.abs(a - t) % 360; return Math.min(dd, 360 - dd); };
      // Where the design printed, this measurement has to stand down. A
      // design is free to contain the garment's own hue — the sample cat is
      // full of magenta — and counting those pixels as residual violet says
      // the key failed on the one part of the frame it never touched. The
      // first run of this check reported 1450 violet pixels a frame and a
      // tidy 193x195 hotspot, which was the cat.
      const printed = printedAlpha;
      let violet = 0, violetEdge = 0, edgePx = 0, skipped = 0;
      let greenEdge = 0, greenWorst = 0;
      let vminX = w, vminY = h, vmaxX = -1, vmaxY = -1;
      const heat = octx.createImageData(w, h);
      for (let p = 0; p < n; p++) {
        const o = p * 4;
        if (printed && printed[o + 3] > 8) { skipped++; heat.data[o + 3] = 255; continue; }
        const [hh, ss, vv] = hueOf(od[o], od[o + 1], od[o + 2]);
        const isViolet = ss > 0.25 && vv > 0.15 && hueDist(hh, meta.shirtHue) < 25;
        // "edge" = the mask is neither clearly in nor clearly out. Hair
        // crossing the garment is the dominant occupant of that band.
        const partial = wArr[p] > 20 && wArr[p] < 235;
        if (partial) edgePx++;
        // Green excess in the boundary band: the mint fringe left when
        // modelled violet is subtracted from a pixel that is mostly
        // background. Restricted to pixels the mask actually touched —
        // counted over the whole frame it is dominated by the potted plant
        // and the foliage through the window, which are supposed to be green.
        if (partial) {
          const exc = od[o + 1] - Math.max(od[o], od[o + 2]);
          if (exc > 6) { greenEdge++; if (exc > greenWorst) greenWorst = exc; }
        }
        if (isViolet) {
          violet++;
          if (partial) violetEdge++;
          const x = p % w, y = (p / w) | 0;
          if (x < vminX) vminX = x; if (x > vmaxX) vmaxX = x;
          if (y < vminY) vminY = y; if (y > vmaxY) vmaxY = y;
          heat.data[o] = 255; heat.data[o + 1] = 0; heat.data[o + 2] = 255; heat.data[o + 3] = 255;
        } else {
          const g = (od[o] * 0.299 + od[o + 1] * 0.587 + od[o + 2] * 0.114) * 0.35;
          heat.data[o] = g; heat.data[o + 1] = g; heat.data[o + 2] = g; heat.data[o + 3] = 255;
        }
      }
      const heatCv = document.createElement('canvas');
      heatCv.width = w; heatCv.height = h;
      heatCv.getContext('2d').putImageData(heat, 0, 0);
      return {
        png: out.toDataURL('image/png'),
        heat: heatCv.toDataURL('image/png'),
        violet, violetEdge, edgePx, n, skipped, greenEdge, greenWorst,
        violetBox: vmaxX < 0 ? null : { x: vminX, y: vminY, w: vmaxX - vminX, h: vmaxY - vminY },
        printCx: (q => (q.tl[0] + q.tr[0] + q.br[0] + q.bl[0]) / 4)(quad),
        printCy: (q => (q.tl[1] + q.tr[1] + q.br[1] + q.bl[1]) / 4)(quad),
      };
    }, {
      photo: b64('photo'), weight: b64('weight'), shade: b64('shade'),
      meta: {
        width: manifest.width, height: manifest.height, violetBase: manifest.violetBase,
        ambientTint: manifest.ambientTint, relMax: manifest.relMax, shirtHue: manifest.shirtHue,
      },
      quad: manifest.quads[i], hex, designB64,
      // the tracker already measures the trunk each frame; the cylinder the
      // print wraps has that width, so its radius is not a tuned constant
      trunkW: manifest.torso && manifest.torso[i] ? manifest.torso[i].w : null,
    });

    fs.writeFileSync(path.join(outDir, `out_${String(i).padStart(4, '0')}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
    if (i % 6 === 0) {
      fs.writeFileSync(path.join(outDir, `heat_${String(i).padStart(4, '0')}.png`), Buffer.from(r.heat.split(',')[1], 'base64'));
    }
    stats.push(r);
    process.stdout.write(`  frame ${i + 1}/${manifest.frames} violet=${r.violet}\r`);
  }

  const totalViolet = stats.reduce((a, s) => a + s.violet, 0);
  const worst = stats.reduce((a, s) => s.violet > a.violet ? s : a, stats[0]);
  const edgeViolet = stats.reduce((a, s) => a + s.violetEdge, 0);
  const edgeTotal = stats.reduce((a, s) => a + s.edgePx, 0);
  const cxs = stats.map(s => s.printCx), cys = stats.map(s => s.printCy);
  const report = {
    id, hex, frames: stats.length,
    violetPerFrameAvg: +(totalViolet / stats.length).toFixed(1),
    violetWorstFrame: worst.violet,
    violetWorstBox: worst.violetBox,
    violetPctOfFrame: +(100 * totalViolet / (stats.length * stats[0].n)).toFixed(4),
    pixelsUnderPrintExcluded: stats.reduce((a, s) => a + s.skipped, 0),
    hairBandVioletPct: +(100 * edgeViolet / Math.max(1, edgeTotal)).toFixed(3),
    greenFringePctOfBand: +(100 * stats.reduce((a, s) => a + s.greenEdge, 0) / Math.max(1, edgeTotal)).toFixed(3),
    greenFringeWorstExcess: Math.max(...stats.map(s => s.greenWorst)),
    printTravelXpx: +(Math.max(...cxs) - Math.min(...cxs)).toFixed(1),
    printTravelYpx: +(Math.max(...cys) - Math.min(...cys)).toFixed(1),
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\n' + JSON.stringify(report, null, 2));
  await browser.close();
})();
