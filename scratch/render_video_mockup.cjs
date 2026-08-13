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
      const { photo, weight, shade, meta, quad, hex, designB64 } = args;
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
        const aspect = dImg.width / dImg.height;
        let dW = quadW, dH = dW / aspect;
        if (aspect <= 1) { dH = quadH; dW = dH * aspect; }

        const layer = document.createElement('canvas');
        layer.width = w; layer.height = h;
        const lc = layer.getContext('2d');
        lc.drawImage(buffer, qcx - dW / 2, qcy - dH / 2, dW, dH);
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
