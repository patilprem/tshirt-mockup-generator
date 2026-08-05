// The on-model rendering engine, shared by the editor and the homepage hero.
//
// It lives here rather than inside the editor because two places now draw a
// photographed model with a recoloured shirt on it, and a second copy of this
// maths would drift from the first the moment either was touched. The relight
// in particular is not something to reimplement casually: it subtracts a
// blended violet reference so a recoloured shirt keeps the photograph's own
// shading, and the comments below record why each term is the way it is.
//
// Everything here is DOM-dependent (canvas, Image) but framework-free, so a
// plain <script> in any Astro page can import it.

// id -> { photo, photoData, wArr, clipArr, ownArr, shade, lutV, w, h, meta }
export const onModelCache = new Map();


export function onModelRelightLut(rgb, meta) {
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

export async function loadOnModelTemplate(meta) {
  if (onModelCache.has(meta.id)) return onModelCache.get(meta.id);
  const loadImg = src => new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('failed to load ' + src));
    i.src = src;
  });
  const [photoImg, weightImg, shadeImg] = await Promise.all([
    loadImg(meta.photo), loadImg(meta.weight), loadImg(meta.shade),
  ]);
  const w = meta.width, h = meta.height, n = w * h;
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
  const entry = {
    photo: photoImg, photoData, wArr, clipArr, ownArr, shade, w, h, meta,
    lutV: onModelRelightLut(meta.violetBase, meta),
  };
  onModelCache.set(meta.id, entry);
  return entry;
}

export function buildOnModelComposed(entry, hex) {
  const tr = parseInt(hex.slice(1, 3), 16);
  const tg = parseInt(hex.slice(3, 5), 16);
  const tb = parseInt(hex.slice(5, 7), 16);
  const lutT = onModelRelightLut([tr, tg, tb], entry.meta);
  const lutV = entry.lutV;
  const { photoData, wArr, ownArr, shade, w, h } = entry;
  const cnv = document.createElement('canvas');
  cnv.width = w; cnv.height = h;
  const c = cnv.getContext('2d');
  const out = c.createImageData(w, h);
  const d = out.data;
  d.set(photoData);
  const n = w * h;
  // The violet being subtracted blends between two references. Inside solid
  // coverage the pixel's own value IS the violet — subtracting it exactly
  // cancels every local chroma variation the fixed model can't track (the
  // shadow side of a window-lit shirt runs bluer than the median violet,
  // and using the model there leaves violet patches). At the boundary the
  // pixel is part background, so its own value must NOT be subtracted in
  // full; there the model reference takes over, faded in by the ramp.
  //
  // That blend factor is the weight map's B channel, decided by how much
  // colour information the pixel carries — NOT by the design clip in G,
  // which answers the unrelated question of where the graphic prints.
  // Where a pixel is information-free (a near-black underarm crease) B is
  // 1, so the output is a convex blend of the pixel and T(shade): it can
  // never leave the gamut spanned by those two, which is what stops
  // modelled violet being over-subtracted into green blotches.
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
  return cnv;
}

export function onModelHighlightCanvas(entry) {
  if (entry._hiCanvas) return entry._hiCanvas;
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
  entry._hiCanvas = c;
  return c;
}

export function onModelClipCanvas(entry) {
  if (entry._clipCanvas) return entry._clipCanvas;
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
  entry._clipCanvas = c;
  return c;
}
