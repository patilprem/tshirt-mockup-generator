// The flat-lay rendering engine, shared by the editor and the homepage hero.
//
// It lives here for the same reason onmodel-engine.js does: two places now
// draw a garment lying flat with a print blended into its folds, and a second
// copy of this maths would drift from the first the moment either was touched.
// The fold extraction in particular is calibrated per garment — Y_FLAT is the
// fabric's diffuse baseline, and a garment relit against the wrong one comes
// out either washed flat or crushed to black.
//
// Everything here is DOM-dependent (canvas, Image) but framework-free, and
// state-free: every function takes what it needs as an argument rather than
// reading editor globals, which is what lets the hero drive the identical code
// from a completely different set of variables.

// printArea: printable rect in the 1000×1000 asset frame, calibrated with
// scratch/calibrate_print_areas.cjs (clears collars, the polo placket, the
// hoodie hood, and the hoodie/sweatshirt kangaroo pockets).
// pxPerIn: pixels per real-world inch, from torso width ÷ chest width of a
// standard size M — lets placements be expressed in inches per garment.
export const garmentConfigs = {
  'crewneck': { chestY: 420, centerY: 480, bellyY: 570, defaultScale: 0.35, path: '/assets/processed/tshirt_flatlay.png', yFlat: 230, label: 'Crewneck Tee', printArea: { x: 310, y: 265, w: 384, h: 365 }, pxPerIn: 25.5 },
  'ladies': { chestY: 380, centerY: 460, bellyY: 540, defaultScale: 0.33, path: '/assets/processed/tshirt_ladies.png', yFlat: 225, label: 'Ladies Tee', printArea: { x: 302, y: 225, w: 396, h: 375 }, pxPerIn: 30.8 },
  'polo': { chestY: 430, centerY: 500, bellyY: 580, defaultScale: 0.32, path: '/assets/processed/tshirt_polo.png', yFlat: 225, label: 'Polo Shirt', printArea: { x: 306, y: 400, w: 402, h: 245 }, pxPerIn: 25.3 },
  'longsleeve': { chestY: 420, centerY: 490, bellyY: 580, defaultScale: 0.33, path: '/assets/processed/tshirt_longsleeve.png', yFlat: 230, label: 'Long Sleeve', printArea: { x: 327, y: 265, w: 353, h: 375 }, pxPerIn: 23.3 },
  'hoodie': { chestY: 440, centerY: 510, bellyY: 600, defaultScale: 0.30, path: '/assets/processed/tshirt_hoodie.png', yFlat: 230, label: 'Hoodie', printArea: { x: 346, y: 340, w: 312, h: 310 }, pxPerIn: 18.7 },
  'sweatshirt': { chestY: 410, centerY: 480, bellyY: 570, defaultScale: 0.33, path: '/assets/processed/tshirt_sweatshirt.png', yFlat: 235, label: 'Sweatshirt', printArea: { x: 333, y: 265, w: 334, h: 305 }, pxPerIn: 20.0 },
  'vneck': { chestY: 430, centerY: 500, bellyY: 580, defaultScale: 0.35, path: '/assets/processed/tshirt_vneck.png', yFlat: 225, label: 'V-Neck Tee', printArea: { x: 296, y: 270, w: 409, h: 370 }, pxPerIn: 26.9 },
  'tanktop': { chestY: 380, centerY: 460, bellyY: 550, defaultScale: 0.35, path: '/assets/processed/tshirt_tanktop.png', yFlat: 235, label: 'Tank Top', printArea: { x: 310, y: 330, w: 380, h: 310 }, pxPerIn: 33.5 }
};

// A fresh object per caller rather than one shared literal: these entries are
// mutated in place as props are dragged, scaled and rotated, so the editor and
// the hero each need their own — otherwise arranging the hero's scene would
// move the props in a second copy of the editor open in the same tab.
export function defaultPropConfigs() {
  return {
    'plant': { path: '/assets/props/prop_plant.png', x: 40, y: 40, w: 200, h: 200, rotation: 0, loaded: false, img: null },
    'hat': { path: '/assets/props/prop_hat.png', x: 610, y: 100, w: 330, h: 330, rotation: 0, loaded: false, img: null },
    'shoes': { path: '/assets/props/prop_shoes.png', x: 50, y: 600, w: 330, h: 330, rotation: 0, loaded: false, img: null },
    'sunglasses': { path: '/assets/props/prop_sunglasses.png', x: 740, y: 400, w: 180, h: 72, rotation: 0, loaded: false, img: null },
    'jeans': { path: '/assets/props/prop_jeans.png', x: 630, y: 520, w: 300, h: 375, rotation: 0, loaded: false, img: null },
    'bag': { path: '/assets/props/prop_bag.png', x: 255, y: 6, w: 500, h: 256, rotation: 0, loaded: false, img: null },
    'distressedshorts': { path: '/assets/props/prop_shorts_distressed.png', x: 250, y: 247, w: 520, h: 412, rotation: 0, loaded: false, img: null },
    'leaf': { path: '/assets/props/prop_leaf.png', x: 610, y: 0, w: 380, h: 380, rotation: 0, loaded: false, img: null }
  };
}

export function loadProp(config) {
  if (!config || config.loaded) return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = config.path;
    img.onload = () => {
      config.img = img;
      config.loaded = true;
      resolve();
    };
    img.onerror = () => resolve();
  });
}

// --- fold shading -----------------------------------------------------------
// Splits a garment photograph into the three layers the compositor needs: the
// silhouette (recoloured by masking), the creases (multiplied down) and the
// sheen (screened up). The garment assets are pre-cropped and already carry
// their own alpha, so there is no background removal to do here.
export function buildShirtLayers(shirtImage, yFlatBaseline) {
  const w = shirtImage.width;
  const h = shirtImage.height;

  const mask = document.createElement('canvas');
  mask.width = w;
  mask.height = h;
  const maskCtx = mask.getContext('2d');
  maskCtx.drawImage(shirtImage, 0, 0);

  const shadows = document.createElement('canvas');
  shadows.width = w;
  shadows.height = h;
  const shadowCtx = shadows.getContext('2d');

  const highlights = document.createElement('canvas');
  highlights.width = w;
  highlights.height = h;
  const highlightCtx = highlights.getContext('2d');

  const maskData = maskCtx.getImageData(0, 0, w, h);
  const mPixels = maskData.data;

  const shadowData = shadowCtx.createImageData(w, h);
  const sPixels = shadowData.data;

  const highlightData = highlightCtx.createImageData(w, h);
  const hPixels = highlightData.data;

  const Y_FLAT = yFlatBaseline || 215; // flat fabric baseline for white shirt

  for (let idx = 0; idx < w * h; idx++) {
    const rIdx = idx * 4;
    const alpha = mPixels[rIdx + 3];

    if (alpha === 0) {
      // background
      sPixels[rIdx] = 255;
      sPixels[rIdx + 1] = 255;
      sPixels[rIdx + 2] = 255;
      sPixels[rIdx + 3] = 0;

      hPixels[rIdx] = 0;
      hPixels[rIdx + 1] = 0;
      hPixels[rIdx + 2] = 0;
      hPixels[rIdx + 3] = 0;
      continue;
    }

    const r = mPixels[rIdx];
    const g = mPixels[rIdx + 1];
    const b = mPixels[rIdx + 2];

    const Y = 0.299 * r + 0.587 * g + 0.114 * b;

    // A. Shadow (creases): values below Y_FLAT represent folds with contrast-enhancing gamma curve
    let sVal = 255;
    if (Y < Y_FLAT) {
      sVal = Math.max(0, Math.min(255, Math.round(255 * Math.pow(Y / Y_FLAT, 1.8))));
    }

    // FADE OUT SHADOWS ON SEMI-TRANSPARENT EDGES TO PREVENT JAGGED DARK OUTLINES
    if (alpha < 255) {
      const factor = alpha / 255;
      sVal = Math.round(sVal * factor + 255 * (1 - factor));
    }

    sPixels[rIdx] = sVal;
    sPixels[rIdx + 1] = sVal;
    sPixels[rIdx + 2] = sVal;
    sPixels[rIdx + 3] = alpha;

    // B. Highlights (sheen): values above Y_FLAT represent shines
    let hVal = 0;
    if (Y > Y_FLAT) {
      hVal = Math.max(0, Math.min(255, Math.round(255 * ((Y - Y_FLAT) / (255 - Y_FLAT)))));
    }
    hPixels[rIdx] = 255;
    hPixels[rIdx + 1] = 255;
    hPixels[rIdx + 2] = 255;
    hPixels[rIdx + 3] = Math.round(hVal * (alpha / 255));
  }

  maskCtx.putImageData(maskData, 0, 0);
  shadowCtx.putImageData(shadowData, 0, 0);
  highlightCtx.putImageData(highlightData, 0, 0);

  return { mask, shadows, highlights };
}

// --- background -------------------------------------------------------------
// bg: { type, customColor, woodWhite, woodBrown } — the wood images are passed
// in rather than loaded here so a caller that never shows wood never fetches
// it, and so both callers share one decode when they do.
export function drawFlatlayBackground(ctxTarget, w, h, bg) {
  const type = bg && bg.type;
  const custom = (bg && bg.customColor) || '#121318';
  switch (type) {
    case 'transparent':
      ctxTarget.clearRect(0, 0, w, h);
      break;

    case 'solid-picker':
      ctxTarget.fillStyle = custom;
      ctxTarget.fillRect(0, 0, w, h);
      break;

    case 'wood-white':
      if (bg.woodWhite) {
        ctxTarget.drawImage(bg.woodWhite, 0, 0, w, h);
      } else {
        ctxTarget.fillStyle = '#e8e8e6';
        ctxTarget.fillRect(0, 0, w, h);
      }
      break;

    case 'wood-brown':
      if (bg.woodBrown) {
        ctxTarget.drawImage(bg.woodBrown, 0, 0, w, h);
      } else {
        ctxTarget.fillStyle = '#563e2a';
        ctxTarget.fillRect(0, 0, w, h);
      }
      break;

    default:
      ctxTarget.fillStyle = custom;
      ctxTarget.fillRect(0, 0, w, h);
      break;
  }
}

// --- prop compositing -------------------------------------------------------
export function drawProps(ctxTarget, propConfigs, activeProps, scale = 1) {
  Object.keys(activeProps).forEach(type => {
    if (!activeProps[type]) return;
    const config = propConfigs[type];
    if (!config || !config.loaded || !config.img) return;

    ctxTarget.save();

    // Translate to center of prop in scaled space
    const cx = (config.x + config.w / 2) * scale;
    const cy = (config.y + config.h / 2) * scale;
    ctxTarget.translate(cx, cy);

    const rot = config.rotation || 0;
    ctxTarget.rotate(rot);

    // Fixed screen shadow offset (down & right) — soft contact shadow, not a hard drop shadow
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const shadowX = 3 * cos + 5 * sin;
    const shadowY = 5 * cos - 3 * sin;

    ctxTarget.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctxTarget.shadowBlur = 26 * scale;
    ctxTarget.shadowOffsetX = shadowX * scale;
    ctxTarget.shadowOffsetY = shadowY * scale;

    ctxTarget.drawImage(
      config.img,
      -config.w / 2 * scale,
      -config.h / 2 * scale,
      config.w * scale,
      config.h * scale
    );
    ctxTarget.restore();
  });
}

// --- the scene --------------------------------------------------------------
// opts: { scale, shirtZoom, bg, propConfigs, activeProps }
//
// The garment/design composition always renders into a fixed square "artboard"
// (1000 units * scale); for non-1:1 canvas aspects the frame (w,h) is larger in
// one dimension, so the artboard is centered within it (letterboxed) rather
// than stretching the garment to fill the frame. Some presets (Etsy/Instagram
// Story) also apply a slight zoom so the garment doesn't look small against all
// the extra letterboxed space.
export function drawFlatlayScene(targetCtx, w, h, s, opts = {}) {
  const scale = opts.scale || 1;
  const shirtZoom = opts.shirtZoom || 1;
  const bg = opts.bg || { type: 'transparent' };
  const artboardSize = 1000 * scale;
  const zoomedArtboardSize = artboardSize * shirtZoom;
  const offsetX = (w - zoomedArtboardSize) / 2;
  const offsetY = (h - zoomedArtboardSize) / 2;

  // 1. Draw Backdrop (fills the full frame, including any letterbox margin)
  drawFlatlayBackground(targetCtx, w, h, bg);

  // 2. Render T-Shirt + Design offscreen to handle masking correctly
  const tshirtOffscreen = document.createElement('canvas');
  tshirtOffscreen.width = artboardSize;
  tshirtOffscreen.height = artboardSize;
  const offCtx = tshirtOffscreen.getContext('2d');

  // A. Draw the transparent silhouette mask
  offCtx.drawImage(s.shirtMask, 0, 0, artboardSize, artboardSize);

  // B. Mask with T-shirt base color
  offCtx.globalCompositeOperation = 'source-in';
  offCtx.fillStyle = s.shirtColor;
  offCtx.fillRect(0, 0, artboardSize, artboardSize);

  // C. Draw graphic design layer on top
  if (s.designImage) {
    offCtx.globalCompositeOperation = 'source-atop';
    offCtx.save();
    offCtx.translate(s.designPos.x * scale, s.designPos.y * scale);
    offCtx.rotate(s.designRotation);

    const { w: dW, h: dH } = designBoxSize(s.designImage, s.designScale, scale);

    offCtx.globalAlpha = s.designOpacity;

    const sourceGraphic = s.isDesignTransparent ? s.designImage : s.designBuffer;
    offCtx.drawImage(sourceGraphic, -dW / 2, -dH / 2, dW, dH);
    offCtx.restore();
  }

  // D. Apply fabric shadow and highlight overlays
  if (s.useRealisticBlending) {
    // Multiply creases on top of colored shirt + logo
    offCtx.globalCompositeOperation = 'source-atop';
    offCtx.save();
    offCtx.globalAlpha = s.shadowDepth;
    offCtx.globalCompositeOperation = 'multiply';
    offCtx.drawImage(s.shirtShadows, 0, 0, artboardSize, artboardSize);
    offCtx.restore();

    // Screen/Overlay highlights on top
    offCtx.globalCompositeOperation = 'source-atop';
    offCtx.save();
    offCtx.globalAlpha = s.highlightShine;
    offCtx.globalCompositeOperation = 'screen';
    offCtx.drawImage(s.shirtHighlights, 0, 0, artboardSize, artboardSize);
    offCtx.restore();
  }

  // E. Draw finished offscreen mockup onto main viewport canvas, centered
  targetCtx.save();
  if (bg.type !== 'transparent') {
    targetCtx.shadowColor = 'rgba(0, 0, 0, 0.20)';
    targetCtx.shadowBlur = 32 * scale;
    targetCtx.shadowOffsetY = 16 * scale;
  }
  targetCtx.drawImage(tshirtOffscreen, offsetX, offsetY, zoomedArtboardSize, zoomedArtboardSize);
  targetCtx.restore();

  // F. Draw active aesthetic props with realistic drop shadows — same
  // offset + zoom as the shirt above, so props stay aligned to it.
  if (opts.propConfigs && opts.activeProps) {
    targetCtx.save();
    targetCtx.translate(offsetX, offsetY);
    targetCtx.scale(shirtZoom, shirtZoom);
    drawProps(targetCtx, opts.propConfigs, opts.activeProps, scale);
    targetCtx.restore();
  }
}

// --- print-area mapping -----------------------------------------------------
// The design's bounding box in artboard units. `scale` is the export scale;
// `designScale` the user-facing size multiplier.
export function designBoxSize(designImage, designScale, scale = 1) {
  const baseSize = 500 * scale; // base bounding size
  const dAspect = designImage.width / designImage.height;
  let dW = baseSize * designScale;
  let dH = baseSize * designScale;
  if (dAspect > 1) {
    dH = dW / dAspect;
  } else {
    dW = dH * dAspect;
  }
  return { w: dW, h: dH };
}

function clampVal(val, lo, hi) {
  if (lo > hi) return (lo + hi) / 2;
  return Math.min(Math.max(val, lo), hi);
}

// A placement expressed against the garment's own print area, so switching
// garment keeps the print where it looked rather than where its raw
// coordinates happened to land.
export function placementToRelative(pos, scaleVal, garmentType) {
  const pa = garmentConfigs[garmentType].printArea;
  return {
    u: (pos.x - pa.x) / pa.w,
    v: (pos.y - pa.y) / pa.h,
    size: (500 * scaleVal) / pa.w,
  };
}

export function placementFromRelative(rel, garmentType) {
  const pa = garmentConfigs[garmentType].printArea;
  const size = Math.min(rel.size, 1); // never wider than the print area
  const half = (size * pa.w) / 2;
  const x = clampVal(pa.x + rel.u * pa.w, pa.x + half, pa.x + pa.w - half);
  const y = clampVal(pa.y + rel.v * pa.h, pa.y + half, pa.y + pa.h - half);
  return { pos: { x, y }, scale: (size * pa.w) / 500 };
}

// Standards-accurate center chest: 11″ wide print (clamped to the print
// area), top edge ~0.75″ below the top of the printable area.
export function centerChestPlacement(garmentType) {
  const cfg = garmentConfigs[garmentType];
  const pa = cfg.printArea;
  const wPx = Math.min(11 * cfg.pxPerIn, pa.w);
  const half = wPx / 2;
  const y = clampVal(pa.y + 0.75 * cfg.pxPerIn + half, pa.y + half, pa.y + pa.h - half);
  return { pos: { x: pa.x + pa.w / 2, y }, scale: wPx / 500 };
}
