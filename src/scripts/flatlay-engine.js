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

import { SEL_ROT_GAP, SEL_LINE, SEL_COLOUR, drawSelectionChrome } from './selection-chrome.js';

// printArea: printable rect in the 1000×1000 asset frame, calibrated with
// scratch/calibrate_print_areas.cjs (clears collars, the polo placket, the
// hoodie hood, and the hoodie/sweatshirt kangaroo pockets).
// pxPerIn: pixels per real-world inch, from torso width ÷ chest width of a
// standard size M — lets placements be expressed in inches per garment.
//
// `back` is an optional override layer, not a second config: a back view is the
// same garment in the same size under the same lights, so it inherits yFlat,
// pxPerIn, label and the rest, and states only what genuinely differs — its own
// photograph and its own printable rect. Reading it through garmentView() below
// rather than spreading it here keeps one source for what a side is.
//
// `ready: false` means the asset has not been produced yet. The entry is still
// carried so the print areas have somewhere to live and the UI has something to
// disable, rather than the side being invisible until someone remembers to add
// it. Flip it to true in the same commit that adds the PNG.
export const garmentConfigs = {
  'crewneck': { chestY: 420, centerY: 480, bellyY: 570, defaultScale: 0.35, path: '/assets/processed/tshirt_flatlay.png', yFlat: 230, label: 'Crewneck Tee', printArea: { x: 310, y: 265, w: 384, h: 365 }, pxPerIn: 25.5,
    back: { ready: true, path: '/assets/processed/tshirt_flatlay_back.png', chestY: 406, printArea: { x: 290, y: 180, w: 420, h: 645 } } },
  'ladies': { chestY: 380, centerY: 460, bellyY: 540, defaultScale: 0.33, path: '/assets/processed/tshirt_ladies.png', yFlat: 225, label: 'Ladies Tee', printArea: { x: 302, y: 225, w: 396, h: 375 }, pxPerIn: 30.8,
    // Provisional, same as the other four were before their photos landed:
    // reasoned from the front rect (a back print starts closer to the collar
    // and runs further down, with no chest-height offset to clear), not
    // measured. Replace with scratch/calibrate_back_areas.cjs once the photo
    // exists, per scratch/BACK-VIEW-PROMPTS.md.
    back: { ready: false, path: '/assets/processed/tshirt_ladies_back.png', chestY: 397, printArea: { x: 302, y: 190, w: 396, h: 590 } } },
  'polo': { chestY: 430, centerY: 500, bellyY: 580, defaultScale: 0.32, path: '/assets/processed/tshirt_polo.png', yFlat: 225, label: 'Polo Shirt', printArea: { x: 306, y: 400, w: 402, h: 245 }, pxPerIn: 25.3,
    // Also provisional. The front print area is short and low (306,400,402,245)
    // because it has to clear the placket and collar; the back has neither, so
    // this is NOT the front rect nudged down — it is sized like a full back
    // print (closer to the crewneck/sweatshirt back shape) rather than the
    // front polo's shape.
    back: { ready: false, path: '/assets/processed/tshirt_polo_back.png', chestY: 403, printArea: { x: 306, y: 200, w: 402, h: 580 } } },
  'longsleeve': { chestY: 420, centerY: 490, bellyY: 580, defaultScale: 0.33, path: '/assets/processed/tshirt_longsleeve.png', yFlat: 230, label: 'Long Sleeve', printArea: { x: 327, y: 265, w: 353, h: 375 }, pxPerIn: 23.3,
    back: { ready: true, path: '/assets/processed/tshirt_longsleeve_back.png', chestY: 412, printArea: { x: 340, y: 230, w: 320, h: 520 } } },
  'hoodie': { chestY: 440, centerY: 510, bellyY: 600, defaultScale: 0.30, path: '/assets/processed/tshirt_hoodie.png', yFlat: 230, label: 'Hoodie', printArea: { x: 346, y: 340, w: 312, h: 310 }, pxPerIn: 18.7,
    // The back photo's garment fills more of its 1000x1000 frame than the
    // front's does (bounding-box width 834px vs 797px — the hood spreads
    // wider laid flat behind the shoulders than it does from the front), so
    // pxPerIn is restated here rather than inherited: the same physical
    // inches now span more pixels.
    back: { ready: true, path: '/assets/processed/tshirt_hoodie_back.png', chestY: 494, printArea: { x: 296, y: 340, w: 410, h: 440 }, pxPerIn: 19.6 } },
  'sweatshirt': { chestY: 410, centerY: 480, bellyY: 570, defaultScale: 0.33, path: '/assets/processed/tshirt_sweatshirt.png', yFlat: 235, label: 'Sweatshirt', printArea: { x: 333, y: 265, w: 334, h: 305 }, pxPerIn: 20.0,
    back: { ready: true, path: '/assets/processed/tshirt_sweatshirt_back.png', chestY: 398, printArea: { x: 280, y: 195, w: 440, h: 580 } } },
  'vneck': { chestY: 430, centerY: 500, bellyY: 580, defaultScale: 0.35, path: '/assets/processed/tshirt_vneck.png', yFlat: 225, label: 'V-Neck Tee', printArea: { x: 296, y: 270, w: 409, h: 370 }, pxPerIn: 26.9 },
  'tanktop': { chestY: 380, centerY: 460, bellyY: 550, defaultScale: 0.35, path: '/assets/processed/tshirt_tanktop.png', yFlat: 235, label: 'Tank Top', printArea: { x: 310, y: 330, w: 380, h: 310 }, pxPerIn: 33.5 }
};

// --- garment sides ----------------------------------------------------------
// Every read of a garment's photograph or print area goes through here, so the
// side is resolved in exactly one place. Callers that never had a side pass
// nothing and get the front, which is what the whole app meant before back
// views existed.
export function garmentView(garmentType, side = 'front') {
  const cfg = garmentConfigs[garmentType];
  if (!cfg) return null;
  if (side !== 'back' || !cfg.back) return cfg;
  // The override wins over the shared base, and `back`/`ready` are dropped so a
  // resolved view is a plain garment config and nothing downstream can ask a
  // side for its own sides.
  const { back, ...base } = cfg;
  const { ready, ...override } = back;
  return { ...base, ...override };
}

// Whether a garment can currently be shown from the back. False both for
// garments that will never have a back view and for those whose asset has not
// landed yet — the caller wants to know if it can render one, and those two
// cases are the same answer to that question.
export function hasBackView(garmentType) {
  const cfg = garmentConfigs[garmentType];
  return !!(cfg && cfg.back && cfg.back.ready);
}

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

// --- prop drag / select layer -----------------------------------------------
// All of this works in artboard units. `u` throughout is how many artboard
// units make one CSS pixel on screen (the caller's shirtZoom divided out), so
// the chrome and its grab targets come out the same physical size whatever
// preset or zoom the artboard is being drawn at.

export function propTransformMetrics(config, u = 1) {
  if (!config) return null;

  const w = config.w;
  const h = config.h;
  const rotation = config.rotation || 0;
  const centerX = config.x + w / 2;
  const centerY = config.y + h / 2;

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  function localToGlobal(lx, ly) {
    return {
      x: lx * cos - ly * sin + centerX,
      y: lx * sin + ly * cos + centerY
    };
  }

  return {
    width: w,
    height: h,
    center: { x: centerX, y: centerY },
    corners: {
      tl: localToGlobal(-w / 2, -h / 2),
      tr: localToGlobal(w / 2, -h / 2),
      br: localToGlobal(w / 2, h / 2),
      bl: localToGlobal(-w / 2, h / 2)
    },
    // Below the box, through the same constant the design uses, so the two
    // controls put the rotate button in the same place relative to what is
    // being rotated. Hit-testing reads this too, so the grab follows the
    // drawing by construction.
    rot: localToGlobal(0, h / 2 + SEL_ROT_GAP * u)
  };
}

export function isPointInsidePropBox(config, cx, cy) {
  if (!config) return false;

  const centerX = config.x + config.w / 2;
  const centerY = config.y + config.h / 2;
  const rotation = config.rotation || 0;

  const tx = cx - centerX;
  const ty = cy - centerY;

  const ux = tx * Math.cos(-rotation) - ty * Math.sin(-rotation);
  const uy = tx * Math.sin(-rotation) + ty * Math.cos(-rotation);

  return (
    ux >= -config.w / 2 &&
    ux <= config.w / 2 &&
    uy >= -config.h / 2 &&
    uy <= config.h / 2
  );
}

// Topmost prop under the point, matching the draw order back to front.
export function hitProps(propConfigs, activeProps, cx, cy) {
  const propTypes = Object.keys(activeProps);
  for (let i = propTypes.length - 1; i >= 0; i--) {
    const type = propTypes[i];
    if (!activeProps[type]) continue;
    const config = propConfigs[type];
    if (config && config.loaded && config.img && isPointInsidePropBox(config, cx, cy)) {
      return type;
    }
  }
  return null;
}

export function hitPropHandles(config, cx, cy, u = 1, clickRadius = 30) {
  const metrics = propTransformMetrics(config, u);
  if (!metrics) return null;

  if (Math.hypot(metrics.rot.x - cx, metrics.rot.y - cy) < clickRadius) {
    return { type: 'rotate' };
  }

  for (const [corner, pt] of Object.entries(metrics.corners)) {
    if (Math.hypot(pt.x - cx, pt.y - cy) < clickRadius) {
      return { type: 'scale', corner: corner };
    }
  }
  return null;
}

// opts: { propConfigs, activeProps, selected, hovered, dragged, units }
// `selected` is the prop type currently selected, or 'design'/null when the
// selection is not a prop — this only ever draws prop chrome.
export function drawPropChrome(ctx, opts) {
  const { propConfigs, activeProps, selected, hovered, dragged } = opts;
  const u = opts.units || 1;

  // 1. Selection box & handles for the selected prop.
  if (selected && selected !== 'design' && activeProps[selected]) {
    const config = propConfigs[selected];
    if (config && config.loaded && config.img) {
      const metrics = propTransformMetrics(config, u);
      if (metrics) {
        // The same drawSelectionChrome the design uses, through the same
        // units, rather than a second control that merely resembles it.
        // A prop used to be a dashed box with square corners, a centre dot
        // and the rotate button above, while the print in the middle of the
        // same canvas had a solid box, round corners and rotate below — two
        // gestures to learn for one canvas, and the handles drawn at a fixed
        // pixel size so they grew and shrank with the preset.
        ctx.save();
        ctx.translate(metrics.center.x, metrics.center.y);
        ctx.rotate(config.rotation || 0);
        drawSelectionChrome(ctx, [
          { x: -metrics.width / 2, y: -metrics.height / 2 },
          { x: metrics.width / 2, y: -metrics.height / 2 },
          { x: metrics.width / 2, y: metrics.height / 2 },
          { x: -metrics.width / 2, y: metrics.height / 2 },
        ], { x: 0, y: metrics.height / 2 + SEL_ROT_GAP * u }, u);
        ctx.restore();
      }
    }
  }

  // 2. Hover outline for the hovered prop (only if it's not the selected one).
  if (hovered && hovered !== selected && activeProps[hovered]) {
    const config = propConfigs[hovered];
    if (config && config.loaded && config.img) {
      const metrics = propTransformMetrics(config, u);
      if (metrics) {
        ctx.save();
        ctx.translate(metrics.center.x, metrics.center.y);
        ctx.rotate(config.rotation || 0);
        // Hover stays a faint dashed outline — it is a hint, not a control,
        // and must not read as a selection. Same hue as the chrome it
        // precedes, so the two belong to one palette.
        ctx.strokeStyle = SEL_COLOUR;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = SEL_LINE * u;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(-metrics.width / 2, -metrics.height / 2, metrics.width, metrics.height);
        ctx.restore();
      }
    }
  }

  // 3. Dragged prop indicator.
  if (dragged) {
    const config = propConfigs[dragged];
    const metrics = propTransformMetrics(config, u);
    if (metrics) {
      ctx.save();
      ctx.translate(metrics.center.x, metrics.center.y);
      ctx.rotate(config.rotation || 0);
      ctx.strokeStyle = '#008ab3';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(-metrics.width / 2, -metrics.height / 2, metrics.width, metrics.height);
      ctx.restore();
    }
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
// coordinates happened to land. Sides are the same problem one step in: a back
// print area is taller and higher than its front, so the same relative
// placement carries across a side flip too.
export function placementToRelative(pos, scaleVal, garmentType, side = 'front') {
  const pa = garmentView(garmentType, side).printArea;
  return {
    u: (pos.x - pa.x) / pa.w,
    v: (pos.y - pa.y) / pa.h,
    size: (500 * scaleVal) / pa.w,
  };
}

export function placementFromRelative(rel, garmentType, side = 'front') {
  const pa = garmentView(garmentType, side).printArea;
  const size = Math.min(rel.size, 1); // never wider than the print area
  const half = (size * pa.w) / 2;
  const x = clampVal(pa.x + rel.u * pa.w, pa.x + half, pa.x + pa.w - half);
  const y = clampVal(pa.y + rel.v * pa.h, pa.y + half, pa.y + pa.h - half);
  return { pos: { x, y }, scale: (size * pa.w) / 500 };
}

// Standards-accurate center chest: 11″ wide print (clamped to the print
// area), top edge ~0.75″ below the top of the printable area.
//
// The back's default is a different standard, not the same one measured from a
// different rect: a full back print runs wider than a chest print and hangs
// further below the collar, which is why the numbers are named per side rather
// than shared. Both still clamp into the print area, so a garment whose back
// area is narrow gets a print that fits instead of one that is nominally 12″.
const SIDE_DEFAULTS = {
  front: { widthIn: 11, topGapIn: 0.75 },
  back: { widthIn: 12, topGapIn: 3 },
};

export function centerChestPlacement(garmentType, side = 'front') {
  const cfg = garmentView(garmentType, side);
  const std = SIDE_DEFAULTS[side] || SIDE_DEFAULTS.front;
  const pa = cfg.printArea;
  const wPx = Math.min(std.widthIn * cfg.pxPerIn, pa.w);
  const half = wPx / 2;
  const y = clampVal(pa.y + std.topGapIn * cfg.pxPerIn + half, pa.y + half, pa.y + pa.h - half);
  return { pos: { x: pa.x + pa.w / 2, y }, scale: wPx / 500 };
}
