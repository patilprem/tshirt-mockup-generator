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

export function onModelShadeCanvas(entry) {
  if (entry._shadeCanvas) return entry._shadeCanvas;
  const { shade, w, h } = entry;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d');
  const img = cx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    // Lift toward white so the multiply darkens folds without dimming the
    // whole print — mid illumination should read as roughly neutral.
    const v = 150 + (shade[i] / 255) * 105;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  entry._shadeCanvas = c;
  return c;
}

// Keys a design for printing: an upload with real alpha is left alone, an
// opaque one has its flat background removed. The hero needs the identical
// treatment — the sample cat is a fully opaque PNG on black, and drawing it
// raw puts a black card on a white shirt.
export function buildDesignBuffer(img) {
  const w = img.width;
  const h = img.height;

  const buffer = document.createElement('canvas');
  buffer.width = w;
  buffer.height = h;
  const dCtx = buffer.getContext('2d');
  dCtx.drawImage(img, 0, 0);

  // Check if image already has transparent pixels.
  // If it does, we skip keying to avoid corrupting professional transparent PNGs.
  const dData = dCtx.getImageData(0, 0, w, h);
  const pixels = dData.data;

  let hasTransparency = false;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 240) {
      hasTransparency = true;
      break;
    }
  }

  if (hasTransparency) {
    // Just keep the original design as is
    return { buffer, isTransparent: true };
  }

  // Run Flood-Fill keyer starting from borders to extract outer black background
  const visited = new Uint8Array(w * h);
  const queue = [];

  function enqueue(x, y) {
    if (x >= 0 && x < w && y >= 0 && y < h) {
      const idx = y * w + x;
      if (!visited[idx]) {
        visited[idx] = 1;
        queue.push(idx);
      }
    }
  }

  // Enqueue all boundary pixels
  for (let x = 0; x < w; x++) {
    enqueue(x, 0);
    enqueue(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    enqueue(0, y);
    enqueue(w - 1, y);
  }

  while (queue.length > 0) {
    const idx = queue.shift();
    const px = idx % w;
    const py = Math.floor(idx / w);
    const rIdx = idx * 4;
    
    const r = pixels[rIdx];
    const g = pixels[rIdx + 1];
    const b = pixels[rIdx + 2];

    // Key threshold: pixel is dark (r,g,b < 35)
    if (r < 35 && g < 35 && b < 35) {
      pixels[rIdx + 3] = 0; // Make transparent

      // Add 4-connected neighbors
      enqueue(px + 1, py);
      enqueue(px - 1, py);
      enqueue(px, py + 1);
      enqueue(px, py - 1);
    }
  }

  // Smooth transition edges of keyed image
  for (let idx = 0; idx < w * h; idx++) {
    if (visited[idx]) continue;
    
    const rIdx = idx * 4;
    const px = idx % w;
    const py = Math.floor(idx / w);
    
    // If not background, check if adjacent to transparent background
    const r = pixels[rIdx];
    const g = pixels[rIdx + 1];
    const b = pixels[rIdx + 2];
    const isDark = (r < 60 && g < 60 && b < 60);

    if (isDark) {
      let hasBgNeighbor = false;
      // check 4 directions
      const neighbors = [
        (py > 0) ? (py - 1) * w + px : -1,
        (py < h - 1) ? (py + 1) * w + px : -1,
        (px > 0) ? py * w + (px - 1) : -1,
        (px < w - 1) ? py * w + (px + 1) : -1
      ];
      
      for (let n of neighbors) {
        if (n !== -1 && visited[n]) {
          hasBgNeighbor = true;
          break;
        }
      }

      if (hasBgNeighbor) {
        // Anti-alias edge
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
        pixels[rIdx + 3] = Math.round(255 * (brightness / 60));
      }
    }
  }

  dCtx.putImageData(dData, 0, 0);
  return { buffer, isTransparent: false };
}
