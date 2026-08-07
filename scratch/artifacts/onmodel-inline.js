// The on-model engine, packaged for a standalone page.
//
// This is src/scripts/onmodel-engine.js with three changes and no maths
// touched: it hangs off `window` instead of using ES exports (the artifact
// pages are single files with no bundler), it can build a template at a
// fraction of full resolution (the colourway sheet paints twelve frames at
// once and does not need 1066x1600 for any of them), and the print layer takes
// a rotation, which the hero never asked of it.
//
// The relight is deliberately a copy rather than a rewrite: the violet
// subtraction below is the one part of this product that is genuinely subtle,
// and a paraphrase of it would drift from the shipping version silently.
window.OM = (function () {
  'use strict';

  function relightLut(rgb, meta) {
    const [ar, ag, ab] = meta.ambientTint;
    const relMax = meta.relMax || 1.45;
    const tLum = (rgb[0] + rgb[1] + rgb[2]) / 765;
    const GAMMA = 1 - 0.55 * tLum;
    const TINT = 0.35 * tLum;
    const SPEC = 0.28;
    const lut = new Float32Array(256 * 3);
    for (let sb = 0; sb < 256; sb++) {
      const rel = (sb / 255) * relMax;
      const diff = Math.pow(Math.min(rel, 1), GAMMA);
      const wgt = (1 - diff) * TINT;
      let r = rgb[0] * diff * (1 - wgt + wgt * ar);
      let g = rgb[1] * diff * (1 - wgt + wgt * ag);
      let b = rgb[2] * diff * (1 - wgt + wgt * ab);
      if (rel > 1) {
        const sp = Math.min(1, (rel - 1) / (relMax - 1)) * SPEC;
        r += (255 - r) * sp; g += (255 - g) * sp; b += (255 - b) * sp;
      }
      lut[sb * 3] = r; lut[sb * 3 + 1] = g; lut[sb * 3 + 2] = b;
    }
    return lut;
  }

  function loadImage(src) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('failed to load image'));
      i.src = src;
    });
  }

  const cache = new Map();

  // scale < 1 rasterises the whole template smaller. The photo and shade maps
  // are continuous and downsample cleanly; the weight map's three channels are
  // masks, and interpolating them softens the garment edge by a pixel or two —
  // invisible at sheet size, which is the only place a reduced template is
  // used. Anything exported goes through a scale of 1.
  async function loadTemplate(meta, scale) {
    const s = scale || 1;
    const key = meta.id + '@' + s;
    if (cache.has(key)) return cache.get(key);

    const [photoImg, weightImg, shadeImg] = await Promise.all([
      loadImage(meta.photo), loadImage(meta.weight), loadImage(meta.shade),
    ]);

    const w = Math.max(1, Math.round(meta.width * s));
    const h = Math.max(1, Math.round(meta.height * s));
    const n = w * h;

    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    tctx.drawImage(photoImg, 0, 0, w, h);
    const photoData = new Uint8ClampedArray(tctx.getImageData(0, 0, w, h).data);
    tctx.clearRect(0, 0, w, h);
    tctx.drawImage(weightImg, 0, 0, w, h);
    const weightRGBA = tctx.getImageData(0, 0, w, h).data;
    tctx.clearRect(0, 0, w, h);
    tctx.drawImage(shadeImg, 0, 0, w, h);
    const shadeRGBA = tctx.getImageData(0, 0, w, h).data;

    const wArr = new Uint8ClampedArray(n);
    const clipArr = new Uint8ClampedArray(n);
    const ownArr = new Uint8ClampedArray(n);
    const shade = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) {
      wArr[i] = weightRGBA[i * 4];
      clipArr[i] = weightRGBA[i * 4 + 1];
      ownArr[i] = weightRGBA[i * 4 + 2];
      shade[i] = shadeRGBA[i * 4];
    }

    const q = meta.quad;
    const scaled = {
      ...meta,
      width: w,
      height: h,
      quad: {
        tl: [q.tl[0] * s, q.tl[1] * s], tr: [q.tr[0] * s, q.tr[1] * s],
        br: [q.br[0] * s, q.br[1] * s], bl: [q.bl[0] * s, q.bl[1] * s],
      },
    };

    const entry = {
      photoData, wArr, clipArr, ownArr, shade, w, h, meta: scaled,
      lutV: relightLut(meta.violetBase, meta),
      composed: null, composedKey: '',
    };
    cache.set(key, entry);
    return entry;
  }

  // Recolours the whole frame. The violet being subtracted blends between the
  // pixel's own value (exact inside solid coverage, where it cancels every
  // local chroma variation the fixed model cannot track) and the modelled
  // violet (at the boundary, where the pixel is part background and its own
  // value must not be subtracted in full). The blend factor is the weight
  // map's B channel.
  function composedFrame(entry, hex) {
    if (entry.composedKey === hex) return entry.composed;
    const tr = parseInt(hex.slice(1, 3), 16);
    const tg = parseInt(hex.slice(3, 5), 16);
    const tb = parseInt(hex.slice(5, 7), 16);
    const lutT = relightLut([tr, tg, tb], entry.meta);
    const lutV = entry.lutV;
    const { photoData, wArr, ownArr, shade, w, h } = entry;

    const cnv = document.createElement('canvas');
    cnv.width = w; cnv.height = h;
    const c = cnv.getContext('2d');
    const out = c.createImageData(w, h);
    const d = out.data;
    d.set(photoData);
    const n = w * h;
    for (let i = 0; i < n; i++) {
      const wv = wArr[i];
      if (wv === 0) continue;
      const ww = wv / 255;
      const cl = ownArr[i] / 255;
      const sb = shade[i] * 3;
      const o = i * 4;
      d[o] = d[o] + ww * (lutT[sb] - cl * d[o] - (1 - cl) * lutV[sb]);
      d[o + 1] = d[o + 1] + ww * (lutT[sb + 1] - cl * d[o + 1] - (1 - cl) * lutV[sb + 1]);
      d[o + 2] = d[o + 2] + ww * (lutT[sb + 2] - cl * d[o + 2] - (1 - cl) * lutV[sb + 2]);
    }
    c.putImageData(out, 0, 0);
    entry.composed = cnv;
    entry.composedKey = hex;
    return cnv;
  }

  function highlightCanvas(entry) {
    if (entry._hi) return entry._hi;
    const { shade, w, h, meta } = entry;
    const relMax = meta.relMax || 1.45;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d');
    const img = cx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const rel = (shade[i] / 255) * relMax;
      const t = Math.max(0, Math.min(1, (rel - 1) / Math.max(1e-6, relMax - 1)));
      const v = Math.round(t * 255);
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    entry._hi = c;
    return c;
  }

  function clipCanvas(entry) {
    if (entry._clip) return entry._clip;
    const { clipArr, w, h } = entry;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d');
    const img = cx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      img.data[i * 4] = 255; img.data[i * 4 + 1] = 255; img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = clipArr[i];
    }
    cx.putImageData(img, 0, 0);
    entry._clip = c;
    return c;
  }

  function shadeCanvas(entry) {
    if (entry._shade) return entry._shade;
    const { shade, w, h } = entry;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d');
    const img = cx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      // Lifted toward white so the multiply darkens folds without dimming the
      // whole print — mid illumination reads as roughly neutral.
      const v = 150 + (shade[i] / 255) * 105;
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    entry._shade = c;
    return c;
  }

  // The untouched photograph, as a canvas, so a page can put the render and
  // its own source side by side. Nothing else in the pipeline needs this —
  // it exists so a recolour can be checked against what was photographed.
  function photoCanvas(entry) {
    if (entry._photo) return entry._photo;
    const c = document.createElement('canvas');
    c.width = entry.w; c.height = entry.h;
    const img = c.getContext('2d').createImageData(entry.w, entry.h);
    img.data.set(entry.photoData);
    c.getContext('2d').putImageData(img, 0, 0);
    entry._photo = c;
    return c;
  }

  // The maps the relight reads, rendered as pictures. A recolour that comes
  // out wrong is nearly always a map that is wrong — coverage bleeding past
  // the garment, the print area sitting off the chest, the shade map flat
  // where the fabric folds — and none of that is visible in the composite.
  const CHANNELS = {
    coverage: (e) => e.wArr,     // R: how much of this pixel is shirt
    print: (e) => e.clipArr,     // G: where the graphic may print
    blend: (e) => e.ownArr,      // B: own-value vs modelled violet reference
    shade: (e) => e.shade,       // illumination, drives the relight LUT
  };

  function channelCanvas(entry, name) {
    const key = '_ch_' + name;
    if (entry[key]) return entry[key];
    const src = CHANNELS[name](entry);
    const c = document.createElement('canvas');
    c.width = entry.w; c.height = entry.h;
    const cx = c.getContext('2d');
    const img = cx.createImageData(entry.w, entry.h);
    for (let i = 0; i < entry.w * entry.h; i++) {
      const v = src[i];
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    entry[key] = c;
    return c;
  }

  // An upload with real alpha is left alone; an opaque one has its flat
  // background flood-keyed away. The sample designs are opaque PNGs on black,
  // and drawing one raw puts a black card on a white shirt.
  function keyDesign(img) {
    const w = img.width;
    const h = img.height;
    const buffer = document.createElement('canvas');
    buffer.width = w; buffer.height = h;
    const dCtx = buffer.getContext('2d', { willReadFrequently: true });
    dCtx.drawImage(img, 0, 0);

    const dData = dCtx.getImageData(0, 0, w, h);
    const pixels = dData.data;

    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] < 240) return buffer;
    }

    const visited = new Uint8Array(w * h);
    const queue = [];
    let head = 0;
    function enqueue(x, y) {
      if (x >= 0 && x < w && y >= 0 && y < h) {
        const idx = y * w + x;
        if (!visited[idx]) { visited[idx] = 1; queue.push(idx); }
      }
    }
    for (let x = 0; x < w; x++) { enqueue(x, 0); enqueue(x, h - 1); }
    for (let y = 0; y < h; y++) { enqueue(0, y); enqueue(w - 1, y); }

    while (head < queue.length) {
      const idx = queue[head++];
      const px = idx % w;
      const py = (idx - px) / w;
      const rIdx = idx * 4;
      if (pixels[rIdx] < 35 && pixels[rIdx + 1] < 35 && pixels[rIdx + 2] < 35) {
        pixels[rIdx + 3] = 0;
        enqueue(px + 1, py); enqueue(px - 1, py);
        enqueue(px, py + 1); enqueue(px, py - 1);
      }
    }

    for (let idx = 0; idx < w * h; idx++) {
      if (visited[idx]) continue;
      const rIdx = idx * 4;
      const px = idx % w;
      const py = (idx - px) / w;
      const r = pixels[rIdx], g = pixels[rIdx + 1], b = pixels[rIdx + 2];
      if (r < 60 && g < 60 && b < 60) {
        const neighbours = [
          py > 0 ? (py - 1) * w + px : -1,
          py < h - 1 ? (py + 1) * w + px : -1,
          px > 0 ? py * w + (px - 1) : -1,
          px < w - 1 ? py * w + (px + 1) : -1,
        ];
        for (const nb of neighbours) {
          if (nb !== -1 && visited[nb]) {
            pixels[rIdx + 3] = Math.round(255 * ((0.299 * r + 0.587 * g + 0.114 * b) / 60));
            break;
          }
        }
      }
    }
    dCtx.putImageData(dData, 0, 0);
    return buffer;
  }

  // The 1:1 crop: largest square that fits, centred on the print quad, clamped
  // inside the photo. Same rect the editor's 1:1 export preset uses.
  function cropRect(entry) {
    const q = entry.meta.quad;
    const qcx = (q.tl[0] + q.tr[0] + q.br[0] + q.bl[0]) / 4;
    const qcy = (q.tl[1] + q.tr[1] + q.br[1] + q.bl[1]) / 4;
    const side = Math.min(entry.w, entry.h);
    const clamp = (v, hi) => Math.max(0, Math.min(v, hi));
    return { x: clamp(qcx - side / 2, entry.w - side), y: clamp(qcy - side / 2, entry.h - side), w: side, h: side };
  }

  // Placement is carried in the hero's artboard units — pos 500/420 and scale
  // 0.35 mean "centred on the quad, as wide as the quad" — so a layout set
  // here means the same thing in the editor.
  function designBox(entry, design, st) {
    const q = entry.meta.quad;
    const qcx = (q.tl[0] + q.tr[0] + q.br[0] + q.bl[0]) / 4;
    const qcy = (q.tl[1] + q.tr[1] + q.br[1] + q.bl[1]) / 4;
    const quadW = Math.hypot(q.tr[0] - q.tl[0], q.tr[1] - q.tl[1]);
    const quadH = Math.hypot(q.bl[0] - q.tl[0], q.bl[1] - q.tl[1]);
    const aspect = design ? design.width / design.height : 1;
    let w = quadW * (st.scale / 0.35);
    let h = w / aspect;
    if (aspect <= 1) { h = quadH * (st.scale / 0.35); w = h * aspect; }
    return {
      cx: qcx + (st.pos.x - 500) / 1000 * quadW,
      cy: qcy + (st.pos.y - 420) / 1000 * quadH,
      w, h, quadW, quadH,
    };
  }

  function designCorners(entry, design, st) {
    const b = designBox(entry, design, st);
    const c = Math.cos(st.rot || 0), s = Math.sin(st.rot || 0);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
      const x = sx * b.w / 2, y = sy * b.h / 2;
      return { x: b.cx + x * c - y * s, y: b.cy + x * s + y * c };
    });
  }

  // The editor's two shading passes, in the same order and clipped the same
  // way: multiply the creases down, screen the lit crests back up, so the
  // print sits INTO the fabric instead of on top of it. Each pass paints
  // across the whole layer, so each is re-clipped to the print's own alpha
  // immediately afterwards — clipping to the garment mask instead leaves the
  // shading painted over the entire shirt.
  function printLayer(entry, design, st) {
    const b = designBox(entry, design, st);
    const layer = document.createElement('canvas');
    layer.width = entry.w; layer.height = entry.h;
    const lc = layer.getContext('2d');

    lc.save();
    lc.translate(b.cx, b.cy);
    if (st.rot) lc.rotate(st.rot);
    lc.drawImage(design, -b.w / 2, -b.h / 2, b.w, b.h);
    lc.restore();

    const printAlpha = document.createElement('canvas');
    printAlpha.width = entry.w; printAlpha.height = entry.h;
    printAlpha.getContext('2d').drawImage(layer, 0, 0);

    lc.globalCompositeOperation = 'multiply';
    lc.globalAlpha = 0.85;
    lc.drawImage(shadeCanvas(entry), 0, 0);
    lc.globalAlpha = 1;
    lc.globalCompositeOperation = 'destination-in';
    lc.drawImage(printAlpha, 0, 0);

    lc.globalCompositeOperation = 'screen';
    lc.globalAlpha = 0.15;
    lc.drawImage(highlightCanvas(entry), 0, 0);
    lc.globalAlpha = 1;
    lc.globalCompositeOperation = 'destination-in';
    lc.drawImage(printAlpha, 0, 0);

    // Only now clip to the garment, so the print cannot spill off the shirt.
    lc.globalCompositeOperation = 'destination-in';
    lc.drawImage(clipCanvas(entry), 0, 0);
    return layer;
  }

  // Template pixels -> canvas pixels for a square render of `size`.
  function viewFor(entry, size) {
    const crop = cropRect(entry);
    const k = size / crop.w;
    return { k, ox: -crop.x * k, oy: -crop.y * k };
  }

  // Draws the finished square frame into `target` (created if absent).
  //
  // opts.layer picks what the frame shows: the finished mockup, the untouched
  // photograph, or one of the maps behind it. opts.wipe reveals the original
  // photograph across the left fraction of the frame, which is the fastest way
  // to see whether a recolour has moved anything it should not have. opts.quad
  // outlines the print area the template declares.
  function renderInto(target, entry, opts) {
    const size = opts.size;
    const layer = opts.layer || 'composite';
    const cnv = target || document.createElement('canvas');
    if (cnv.width !== size || cnv.height !== size) { cnv.width = size; cnv.height = size; }
    const ctx = cnv.getContext('2d');
    const view = viewFor(entry, size);

    const place = (fn) => {
      ctx.save();
      ctx.translate(view.ox, view.oy);
      ctx.scale(view.k, view.k);
      fn();
      ctx.restore();
    };

    ctx.clearRect(0, 0, size, size);
    place(() => {
      if (layer === 'composite') {
        ctx.drawImage(composedFrame(entry, opts.hex), 0, 0);
        if (opts.design) ctx.drawImage(printLayer(entry, opts.design, opts.state), 0, 0);
      } else if (layer === 'photo') {
        ctx.drawImage(photoCanvas(entry), 0, 0);
      } else if (layer === 'highlight') {
        ctx.drawImage(highlightCanvas(entry), 0, 0);
      } else {
        ctx.drawImage(channelCanvas(entry, layer), 0, 0);
      }
    });

    if (opts.wipe > 0 && layer === 'composite') {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, size * opts.wipe, size);
      ctx.clip();
      place(() => ctx.drawImage(photoCanvas(entry), 0, 0));
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = 'hsl(186, 100%, 55%)';
      ctx.lineWidth = Math.max(1, size / 500);
      ctx.beginPath();
      ctx.moveTo(size * opts.wipe, 0);
      ctx.lineTo(size * opts.wipe, size);
      ctx.stroke();
      ctx.restore();
    }

    if (opts.quad) {
      const q = entry.meta.quad;
      ctx.save();
      ctx.strokeStyle = 'hsl(38, 100%, 60%)';
      ctx.setLineDash([size / 90, size / 90]);
      ctx.lineWidth = Math.max(1, size / 600);
      place(() => {
        ctx.beginPath();
        ctx.moveTo(q.tl[0], q.tl[1]);
        ctx.lineTo(q.tr[0], q.tr[1]);
        ctx.lineTo(q.br[0], q.br[1]);
        ctx.lineTo(q.bl[0], q.bl[1]);
        ctx.closePath();
      });
      ctx.stroke();
      ctx.restore();
    }

    return cnv;
  }

  return {
    loadImage, loadTemplate, keyDesign, composedFrame,
    photoCanvas, channelCanvas, highlightCanvas,
    cropRect, designBox, designCorners, viewFor, renderInto,
  };
})();
