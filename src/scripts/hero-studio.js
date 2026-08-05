// The homepage hero, running the real engines — both of them.
//
// On model is the default because it is the half of the product competitors
// cannot show. Flat lay is the second tab, fully staged rather than empty:
// plant, shoes and a straw hat arranged like the gallery's youtube mockup, so
// the tab shows what the product makes rather than what it starts from.
//
// Neither mode reimplements anything. On model draws through
// onmodel-engine.js and flat lay through flatlay-engine.js, the same modules
// the editor draws through, so a change to either lands in both places at once.
//
// Everything is deliberately cheap on the LCP path: nothing runs until the
// browser is idle, the canvas stays hidden behind a static poster until it has
// a full frame to show, and the flat-lay assets — a garment, three props and a
// wood backdrop, some 4.5MB of PNG — are not fetched at all until the visitor
// shows intent to switch. Someone who never leaves on model never pays for it.

import {
  onModelCache, loadOnModelTemplate, buildOnModelComposed,
  onModelHighlightCanvas, onModelClipCanvas, onModelShadeCanvas, buildDesignBuffer,
} from './onmodel-engine.js';

import {
  garmentConfigs, defaultPropConfigs, loadProp, buildShirtLayers,
  drawFlatlayScene, designBoxSize,
  hitProps, hitPropHandles, drawPropChrome,
} from './flatlay-engine.js';

import {
  SEL_HANDLE_R, SEL_ROT_R, SEL_ROT_GAP, drawSelectionChrome,
} from './selection-chrome.js';

// Matches the editor's palette; the second entry is the shirt the poster was
// rendered in, so the swap from poster to canvas is invisible.
const COLOURS = ['#f4f4f4', '#212121', '#4b53b5', '#7a2733', '#3f4a35', '#c9a227'];
const START_COLOUR = 1;
// The poster is gallery-f, so that template leads and the canvas can take over
// without the scene changing under the visitor.
const ORDER = ['gallery-f', 'street-m', 'miami-f', 'park-m'];
const DESIGN_SRC = '/assets/designs/cat.png';

// Four silhouettes chosen because they stay distinct at 46px — sleeve length
// and neckline are the only cues that survive that size, so this is a tee, a
// long sleeve, a hoodie and a tank rather than four tees.
//
// Drawn as inline SVG rather than as the garment PNGs: those are ~700KB each,
// and four of them as thumbnails would cost more to fetch than the mode they
// advertise. The editor's own picker sidesteps this by captioning one shared
// shirt icon, which a 46px column has no room for.
const GARMENTS = [
  { id: 'crewneck', label: 'Crewneck tee',
    path: 'M8.5 2 2 5.2l1.4 4.2L6 8.6V22h12V8.6l2.6.8L22 5.2 15.5 2a3.5 3.5 0 0 1-7 0z' },
  { id: 'longsleeve', label: 'Long sleeve tee',
    path: 'M8.5 2 2 5.2V16h4V22h12V16h4V5.2L15.5 2a3.5 3.5 0 0 1-7 0z' },
  { id: 'hoodie', label: 'Hoodie',
    path: 'M8.5 2.4 2 5.6l1.4 4.2L6 9V22h12V9l2.6.8L22 5.6 15.5 2.4M8.5 2.4a3.5 3.5 0 0 0 7 0M8.5 2.4C8.5 6 10 8 12 8s3.5-2 3.5-5.6M9 15h6' },
  { id: 'tanktop', label: 'Tank top',
    path: 'M9 2 6 4.2V22h12V4.2L15 2a3 3 0 0 1-6 0z' },
];
const START_GARMENT = 'crewneck';

// Staged like public/assets/gallery/mockup_youtube.jpg — plant top-left, shoes
// bottom-left, straw hat bottom-right. The editor's hat default is TOP-right,
// which the reference does not have and which would collide with the model
// picker besides, so it moves to the bottom. The extra 60 units to the left of
// where the reference actually puts it buy clearance from the picker column,
// which hangs over the right edge of the frame.
const HAT_REFERENCE_X = 610;
const PROP_STAGE = {
  plant: { x: 40, y: 40 },
  shoes: { x: 50, y: 600 },
  hat: { x: HAT_REFERENCE_X - 60, y: 600 },
};

// The editor's flat-lay defaults, so the hero's fabric reads identically.
const FLAT_SHADOW_DEPTH = 0.60;
const FLAT_HIGHLIGHT = 0.15;
const WOOD_SRC = '/assets/wood_white.png';

const SEL = { colour: '#3b82f6', line: 1.5, handle: 6.5 };

export function initHeroStudio() {
  const root = document.getElementById('hero-studio');
  if (!root) return;
  const canvas = document.getElementById('hs-canvas');
  const tilesEl = document.getElementById('hs-tiles');
  const swEl = document.getElementById('hs-swatches');
  const modeEl = document.getElementById('hs-mode');
  if (!canvas) return;

  // A phone that never scrolls to the hero should not pay for any of this.
  const start = () => boot({ root, canvas, tilesEl, swEl, modeEl }).catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 2500 });
  else setTimeout(start, 1200);
}

async function boot(el) {
  const { root, canvas, tilesEl, swEl, modeEl } = el;

  let templates = [];
  try {
    const res = await fetch('/assets/on-model/templates.json');
    if (!res.ok) return;
    templates = await res.json();
  } catch { return; }

  const byId = new Map(templates.map((t) => [t.id, t]));
  const metas = ORDER.map((id) => byId.get(id)).filter(Boolean);
  if (!metas.length) return;

  // Keyed through the editor's own routine: the sample cat is a fully opaque
  // PNG on black, so drawing it raw lays a black card across a white shirt.
  const rawDesign = await loadImage(DESIGN_SRC).catch(() => null);
  const design = rawDesign ? buildDesignBuffer(rawDesign).buffer : null;

  const state = {
    mode: 'onmodel',
    id: metas[0].id,
    garment: START_GARMENT,
    colour: COLOURS[START_COLOUR],
    // Artboard-space transform, the same units and defaults the editor uses,
    // so a design carried into the editor lands exactly where it looked — and
    // so the two modes share one arrangement, which is also what the editor
    // does. Flat lay reads these as plain artboard coordinates; on model maps
    // them onto the template's print quad.
    pos: { x: 500, y: 420 },
    scale: 0.52,
    rot: 0,
    // The controls start on the design, not on a prop: the design is what the
    // hero is inviting you to move.
    selected: 'design',
    composed: null,
    composedKey: '',
    view: { k: 1, ox: 0, oy: 0 },
    drag: null,
  };

  // Flat-lay resources, built on first intent rather than at boot.
  const flat = {
    // The in-flight load, not a boolean: the warm-up on pointerenter and the
    // click that follows it are two calls to the same work, and the second has
    // to WAIT for the first rather than see "already started" and return to a
    // caller that then finds nothing loaded.
    promise: null,
    ready: false,
    wood: null,
    layers: new Map(),          // garment id -> { mask, shadows, highlights }
    props: defaultPropConfigs(),
    active: { plant: true, shoes: true, hat: true },
  };
  for (const [type, at] of Object.entries(PROP_STAGE)) {
    flat.props[type].x = at.x;
    flat.props[type].y = at.y;
  }

  const ctx = canvas.getContext('2d');

  await useTemplate(metas[0]);
  buildModeToggle();
  buildTiles();
  wireTiles();
  buildSwatches();
  wirePointer();
  wireHandoff();

  root.setAttribute('data-ready', '');
  render();

  // --- flat-lay resources -------------------------------------------------
  // Kicked off by the first pointerenter on the toggle or by the click itself,
  // whichever lands first, so on a desktop the assets are usually in flight
  // before the visitor has finished deciding.
  function prepareFlat() {
    if (flat.promise) return flat.promise;
    root.setAttribute('data-loading', '');
    flat.promise = Promise.all([
      loadImage(WOOD_SRC).catch(() => null),
      loadGarmentLayers(state.garment),
      ...Object.keys(flat.active).map((t) => loadProp(flat.props[t])),
    ]).then(([wood]) => {
      flat.wood = wood;
      flat.ready = flat.layers.has(state.garment);
    }).catch(() => {
      flat.ready = false;
    }).finally(() => {
      root.removeAttribute('data-loading');
    });
    return flat.promise;
  }

  async function loadGarmentLayers(id) {
    if (flat.layers.has(id)) return flat.layers.get(id);
    const cfg = garmentConfigs[id];
    if (!cfg) return null;
    const img = await loadImage(cfg.path).catch(() => null);
    if (!img) return null;
    const layers = buildShirtLayers(img, cfg.yFlat || 215);
    flat.layers.set(id, layers);
    return layers;
  }

  // --- template -----------------------------------------------------------
  async function useTemplate(meta) {
    const entry = await loadOnModelTemplate(meta);
    state.id = meta.id;
    state.composedKey = '';
    sizeCanvas();
    return entry;
  }

  // Both modes render into a square, so the frame never reflows on toggle:
  // on model to the 1:1 crop the editor's 1:1 preset uses, flat lay to the
  // 1000-unit artboard itself, which makes artboard units and canvas pixels
  // the same thing and keeps the pointer maths trivial.
  function sizeCanvas() {
    if (state.mode === 'flatlay') {
      if (canvas.width !== 1000) { canvas.width = 1000; canvas.height = 1000; }
      return;
    }
    const entry = onModelCache.get(state.id);
    if (!entry) return;
    const crop = cropRect(entry);
    const side = Math.round(Math.min(crop.w, crop.h) * 0.75);
    if (canvas.width !== side) { canvas.width = side; canvas.height = side; }
  }

  // The 1:1 crop: largest square that fits, centred on the print quad, clamped
  // inside the photo. Mirrors onModelCropRect in the editor.
  function cropRect(entry) {
    const q = entry.meta.quad;
    const qcx = (q.tl[0] + q.tr[0] + q.br[0] + q.bl[0]) / 4;
    const qcy = (q.tl[1] + q.tr[1] + q.br[1] + q.bl[1]) / 4;
    const side = Math.min(entry.w, entry.h);
    const clamp = (v, hi) => Math.max(0, Math.min(v, hi));
    return { x: clamp(qcx - side / 2, entry.w - side), y: clamp(qcy - side / 2, entry.h - side), w: side, h: side };
  }

  function designBox(entry) {
    const q = entry.meta.quad;
    const qcx = (q.tl[0] + q.tr[0] + q.br[0] + q.bl[0]) / 4;
    const qcy = (q.tl[1] + q.tr[1] + q.br[1] + q.bl[1]) / 4;
    const quadW = Math.hypot(q.tr[0] - q.tl[0], q.tr[1] - q.tl[1]);
    const quadH = Math.hypot(q.bl[0] - q.tl[0], q.bl[1] - q.tl[1]);
    const aspect = design ? design.width / design.height : 1;
    let w = quadW * (state.scale / 0.35);
    let h = w / aspect;
    if (aspect <= 1) { h = quadH * (state.scale / 0.35); w = h * aspect; }
    return {
      cx: qcx + (state.pos.x - 500) / 1000 * quadW,
      cy: qcy + (state.pos.y - 420) / 1000 * quadH,
      w, h, qcx, qcy, quadW, quadH,
    };
  }

  // --- render -------------------------------------------------------------
  function render() {
    if (state.mode === 'flatlay') return renderFlat();
    return renderOnModel();
  }

  function renderOnModel() {
    const entry = onModelCache.get(state.id);
    if (!entry) return;

    const key = state.id + '|' + state.colour;
    if (state.composedKey !== key) {
      state.composed = buildOnModelComposed(entry, state.colour);
      state.composedKey = key;
    }

    const crop = cropRect(entry);
    const k = Math.min(canvas.width / crop.w, canvas.height / crop.h);
    const ox = (canvas.width - crop.w * k) / 2 - crop.x * k;
    const oy = (canvas.height - crop.h * k) / 2 - crop.y * k;
    state.view = { k, ox, oy };

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(k, k);
    ctx.drawImage(state.composed, 0, 0);
    drawDesign(entry);
    ctx.restore();
    drawChrome(entry);
  }

  // Artboard units per CSS pixel on screen. The shared chrome is specified in
  // CSS pixels, so this is what converts it into the space being drawn in.
  function flatUnits() {
    return canvas.clientWidth ? canvas.width / canvas.clientWidth : 1;
  }

  function renderFlat() {
    const layers = flat.layers.get(state.garment);
    if (!layers || !design) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawFlatlayScene(ctx, canvas.width, canvas.height, {
      shirtMask: layers.mask,
      shirtShadows: layers.shadows,
      shirtHighlights: layers.highlights,
      shirtColor: state.colour,
      // The keyed buffer already carries real alpha, so it is handed over as
      // the transparent source and no second keying pass happens.
      designImage: design,
      designBuffer: design,
      isDesignTransparent: true,
      designPos: state.pos,
      designScale: state.scale,
      designRotation: state.rot,
      designOpacity: 1,
      useRealisticBlending: true,
      shadowDepth: FLAT_SHADOW_DEPTH,
      highlightShine: FLAT_HIGHLIGHT,
    }, {
      scale: 1,
      shirtZoom: 1,
      bg: { type: 'wood-white', woodWhite: flat.wood },
      propConfigs: flat.props,
      activeProps: flat.active,
    });

    const u = flatUnits();
    if (state.selected === 'design') drawFlatDesignChrome(u);
    drawPropChrome(ctx, {
      propConfigs: flat.props,
      activeProps: flat.active,
      selected: state.selected,
      hovered: null,
      dragged: state.drag && state.drag.prop ? state.drag.prop : null,
      units: u,
    });
  }

  function drawFlatDesignChrome(u) {
    const b = designBoxSize(design, state.scale);
    ctx.save();
    ctx.translate(state.pos.x, state.pos.y);
    ctx.rotate(state.rot);
    drawSelectionChrome(ctx, [
      { x: -b.w / 2, y: -b.h / 2 },
      { x: b.w / 2, y: -b.h / 2 },
      { x: b.w / 2, y: b.h / 2 },
      { x: -b.w / 2, y: b.h / 2 },
    ], { x: 0, y: b.h / 2 + SEL_ROT_GAP * u }, u);
    ctx.restore();
  }

  // The editor's two shading passes, in the same order and clipped the same
  // way: multiply the creases down, screen the lit crests back up, so the
  // print sits INTO the fabric instead of on top of it.
  //
  // Each pass paints across the whole layer, not just where the design is, so
  // each is re-clipped to the print's own alpha immediately afterwards. Doing
  // that with the GARMENT mask instead — as this first did — leaves the shade
  // and highlight painted over the entire shirt, which reads as a black
  // garment that ignores the colour swatches. Two bugs, one wrong mask.
  function drawDesign(entry) {
    if (!design) return;
    const b = designBox(entry);
    const layer = document.createElement('canvas');
    layer.width = entry.w; layer.height = entry.h;
    const lc = layer.getContext('2d');

    lc.save();
    lc.translate(b.cx, b.cy);
    lc.drawImage(design, -b.w / 2, -b.h / 2, b.w, b.h);
    lc.restore();

    // Snapshot the print's alpha once rather than redrawing it per pass.
    const printAlpha = document.createElement('canvas');
    printAlpha.width = entry.w; printAlpha.height = entry.h;
    printAlpha.getContext('2d').drawImage(layer, 0, 0);

    lc.globalCompositeOperation = 'multiply';
    lc.globalAlpha = 0.85;                 // editor default shadowDepth + 0.25
    lc.drawImage(onModelShadeCanvas(entry), 0, 0);
    lc.globalAlpha = 1;
    lc.globalCompositeOperation = 'destination-in';
    lc.drawImage(printAlpha, 0, 0);

    lc.globalCompositeOperation = 'screen';
    lc.globalAlpha = 0.15;                 // editor default highlightShine
    lc.drawImage(onModelHighlightCanvas(entry), 0, 0);
    lc.globalAlpha = 1;
    lc.globalCompositeOperation = 'destination-in';
    lc.drawImage(printAlpha, 0, 0);

    // Only now clip to the garment, so the print cannot spill off the shirt.
    lc.globalCompositeOperation = 'destination-in';
    lc.drawImage(onModelClipCanvas(entry), 0, 0);

    ctx.drawImage(layer, 0, 0);
  }

  function toCanvas(p) {
    return { x: state.view.ox + p.x * state.view.k, y: state.view.oy + p.y * state.view.k };
  }

  function corners(b) {
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => ({ x: b.cx + sx * b.w / 2, y: b.cy + sy * b.h / 2 }));
  }

  // Selection chrome is drawn in canvas pixels after the transform is
  // restored, so handles stay a constant size however the template scales.
  function drawChrome(entry) {
    if (!design) return;
    const b = designBox(entry);
    const pts = corners(b).map(toCanvas);
    const u = canvas.clientWidth ? canvas.width / canvas.clientWidth : 1;

    ctx.save();
    ctx.strokeStyle = SEL.colour;
    ctx.lineWidth = SEL.line * u;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = '#fff';
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, SEL.handle * u, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  // --- interaction --------------------------------------------------------
  function toTemplate(e) {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width, sy = canvas.height / r.height;
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    if (state.mode === 'flatlay') {
      // Canvas pixels ARE artboard units here — sizeCanvas made them so.
      return { x: (cx - r.left) * sx, y: (cy - r.top) * sy };
    }
    return { x: ((cx - r.left) * sx - state.view.ox) / state.view.k, y: ((cy - r.top) * sy - state.view.oy) / state.view.k };
  }

  function wirePointer() {
    const down = (e) => {
      if (state.mode === 'flatlay') return flatDown(e);
      return onModelDown(e);
    };

    const move = (e) => {
      if (!state.drag) return;
      e.preventDefault();
      if (state.mode === 'flatlay') return flatMove(e);
      return onModelMove(e);
    };

    const up = () => { state.drag = null; };

    canvas.addEventListener('mousedown', down);
    canvas.addEventListener('touchstart', down, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
  }

  function onModelDown(e) {
    const entry = onModelCache.get(state.id);
    if (!entry || !design) return;
    const pt = toTemplate(e);
    const b = designBox(entry);
    const tol = 26 / state.view.k;
    const pts = corners(b);
    for (let i = 0; i < 4; i++) {
      if (Math.hypot(pt.x - pts[i].x, pt.y - pts[i].y) <= tol) {
        e.preventDefault();
        state.drag = { mode: 'scale', anchor: pts[(i + 2) % 4], scale0: state.scale, d0: Math.hypot(b.w, b.h) };
        return;
      }
    }
    if (Math.abs(pt.x - b.cx) <= b.w / 2 && Math.abs(pt.y - b.cy) <= b.h / 2) {
      e.preventDefault();
      state.drag = { mode: 'move', start: pt, cx0: b.cx, cy0: b.cy };
    }
  }

  function onModelMove(e) {
    const entry = onModelCache.get(state.id);
    if (!entry) return;
    const pt = toTemplate(e);
    const b = designBox(entry);
    if (state.drag.mode === 'move') {
      const nx = state.drag.cx0 + (pt.x - state.drag.start.x);
      const ny = state.drag.cy0 + (pt.y - state.drag.start.y);
      state.pos.x = 500 + (nx - b.qcx) / b.quadW * 1000;
      state.pos.y = 420 + (ny - b.qcy) / b.quadH * 1000;
    } else {
      const d = Math.hypot(pt.x - state.drag.anchor.x, pt.y - state.drag.anchor.y);
      state.scale = Math.max(0.12, Math.min(1.1, state.drag.scale0 * (d / state.drag.d0)));
    }
    render();
  }

  // Hit order mirrors the editor's handleStart: the selected thing's own
  // handles first, so a handle you can see is always grabbable; then props,
  // which are drawn on top of the garment and so must be grabbable there; then
  // the design.
  function flatDown(e) {
    if (!flat.ready || !design) return;
    const pt = toTemplate(e);
    const u = flatUnits();
    const grab = 26 * u;

    if (state.selected === 'design') {
      const b = designBoxSize(design, state.scale);
      const pts = flatDesignCorners(b);
      const rot = flatDesignRotHandle(b, u);
      if (Math.hypot(pt.x - rot.x, pt.y - rot.y) <= SEL_ROT_R * u + grab / 2) {
        e.preventDefault();
        state.drag = { what: 'design', mode: 'rotate', rot0: state.rot, a0: Math.atan2(pt.y - state.pos.y, pt.x - state.pos.x) };
        return;
      }
      for (let i = 0; i < 4; i++) {
        if (Math.hypot(pt.x - pts[i].x, pt.y - pts[i].y) <= SEL_HANDLE_R * u + grab / 2) {
          e.preventDefault();
          state.drag = { what: 'design', mode: 'scale', anchor: pts[(i + 2) % 4], scale0: state.scale, d0: Math.hypot(b.w, b.h) };
          return;
        }
      }
    } else if (state.selected && flat.active[state.selected]) {
      const cfg = flat.props[state.selected];
      const hit = hitPropHandles(cfg, pt.x, pt.y, u, grab);
      if (hit) {
        e.preventDefault();
        const cx = cfg.x + cfg.w / 2, cy = cfg.y + cfg.h / 2;
        if (hit.type === 'rotate') {
          state.drag = { what: 'prop', prop: state.selected, mode: 'rotate', rot0: cfg.rotation || 0, a0: Math.atan2(pt.y - cy, pt.x - cx) };
        } else {
          state.drag = { what: 'prop', prop: state.selected, mode: 'scale', w0: cfg.w, h0: cfg.h, cx0: cx, cy0: cy, d0: Math.hypot(pt.x - cx, pt.y - cy) };
        }
        return;
      }
    }

    const prop = hitProps(flat.props, flat.active, pt.x, pt.y);
    if (prop) {
      e.preventDefault();
      state.selected = prop;
      const cfg = flat.props[prop];
      state.drag = { what: 'prop', prop, mode: 'move', dx: pt.x - cfg.x, dy: pt.y - cfg.y };
      render();
      return;
    }

    const b = designBoxSize(design, state.scale);
    const local = rotatePoint(pt.x - state.pos.x, pt.y - state.pos.y, -state.rot);
    if (Math.abs(local.x) <= b.w / 2 && Math.abs(local.y) <= b.h / 2) {
      e.preventDefault();
      state.selected = 'design';
      state.drag = { what: 'design', mode: 'move', dx: pt.x - state.pos.x, dy: pt.y - state.pos.y };
      render();
      return;
    }

    // Clicking bare backdrop hands the controls back to the design rather than
    // clearing them — a hero with no visible control reads as broken.
    if (state.selected !== 'design') {
      state.selected = 'design';
      render();
    }
  }

  function flatMove(e) {
    const pt = toTemplate(e);
    const d = state.drag;

    if (d.what === 'design') {
      if (d.mode === 'move') {
        state.pos.x = pt.x - d.dx;
        state.pos.y = pt.y - d.dy;
      } else if (d.mode === 'rotate') {
        state.rot = d.rot0 + (Math.atan2(pt.y - state.pos.y, pt.x - state.pos.x) - d.a0);
      } else {
        const dist = Math.hypot(pt.x - d.anchor.x, pt.y - d.anchor.y);
        state.scale = Math.max(0.12, Math.min(1.1, d.scale0 * (dist / d.d0)));
      }
    } else {
      const cfg = flat.props[d.prop];
      if (d.mode === 'move') {
        cfg.x = pt.x - d.dx;
        cfg.y = pt.y - d.dy;
      } else if (d.mode === 'rotate') {
        cfg.rotation = d.rot0 + (Math.atan2(pt.y - (cfg.y + cfg.h / 2), pt.x - (cfg.x + cfg.w / 2)) - d.a0);
      } else {
        const dist = Math.hypot(pt.x - d.cx0, pt.y - d.cy0);
        const f = Math.max(0.25, Math.min(3, dist / d.d0));
        const nw = d.w0 * f, nh = d.h0 * f;
        // Resize about the centre so the prop stays where it was staged.
        cfg.x = d.cx0 - nw / 2;
        cfg.y = d.cy0 - nh / 2;
        cfg.w = nw;
        cfg.h = nh;
      }
    }
    render();
  }

  function flatDesignCorners(b) {
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
      const p = rotatePoint(sx * b.w / 2, sy * b.h / 2, state.rot);
      return { x: state.pos.x + p.x, y: state.pos.y + p.y };
    });
  }

  function flatDesignRotHandle(b, u) {
    const p = rotatePoint(0, b.h / 2 + SEL_ROT_GAP * u, state.rot);
    return { x: state.pos.x + p.x, y: state.pos.y + p.y };
  }

  function rotatePoint(x, y, rot) {
    const c = Math.cos(rot), s = Math.sin(rot);
    return { x: x * c - y * s, y: x * s + y * c };
  }

  // --- mode toggle --------------------------------------------------------
  function buildModeToggle() {
    if (!modeEl) return;
    modeEl.innerHTML = [
      { id: 'onmodel', label: 'On model' },
      { id: 'flatlay', label: 'Flat lay' },
    ].map((m) => `<button type="button" role="tab" data-mode="${m.id}"
        aria-selected="${m.id === state.mode}">${m.label}</button>`).join('');

    // Start the 4.5MB flat-lay fetch on intent, not on click, so the toggle
    // usually lands on assets that are already in flight.
    const warm = (e) => { if (e.target.closest('button[data-mode="flatlay"]')) prepareFlat(); };
    modeEl.addEventListener('pointerenter', warm, true);
    modeEl.addEventListener('pointerdown', warm, true);

    modeEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-mode]');
      if (!btn || btn.dataset.mode === state.mode) return;
      await setMode(btn.dataset.mode);
    });
  }

  async function setMode(mode) {
    if (mode === 'flatlay') {
      await prepareFlat();
      if (!flat.ready) return;   // assets failed; stay where we are
    }
    state.mode = mode;
    state.selected = 'design';
    modeEl.querySelectorAll('button').forEach((n) =>
      n.setAttribute('aria-selected', n.dataset.mode === mode));
    root.setAttribute('data-mode', mode);
    sizeCanvas();
    buildTiles();
    render();
  }

  // --- pickers ------------------------------------------------------------
  // One slot, two contents: models on model, garment types in flat lay. Both
  // render into the same 46px box in the same column, so toggling swaps what
  // the column offers without moving anything.
  function buildTiles() {
    if (!tilesEl) return;
    if (state.mode === 'flatlay') {
      tilesEl.setAttribute('aria-label', 'Choose a garment');
      tilesEl.innerHTML = GARMENTS.map((g) => `<button type="button" role="option"
        aria-selected="${g.id === state.garment}" data-garment="${g.id}" title="${g.label}"
        aria-label="${g.label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        ><path d="${g.path}"/></svg></button>`).join('');
    } else {
      tilesEl.setAttribute('aria-label', 'Choose a scene');
      tilesEl.innerHTML = metas
        .map((m) => `<img src="/assets/gallery/onmodel_${m.id}.jpg" alt="${m.label}" role="option"
          aria-selected="${m.id === state.id}" data-id="${m.id}" loading="lazy" width="46" height="46" />`)
        .join('');
    }
  }

  function wireTiles() {
    if (!tilesEl) return;
    tilesEl.addEventListener('click', async (e) => {
      const img = e.target.closest('img[data-id]');
      if (img) {
        if (img.dataset.id === state.id) return;
        const meta = byId.get(img.dataset.id);
        if (!meta) return;
        tilesEl.querySelectorAll('img').forEach((n) => n.setAttribute('aria-selected', n === img));
        await useTemplate(meta);
        render();
        return;
      }
      const btn = e.target.closest('button[data-garment]');
      if (!btn || btn.dataset.garment === state.garment) return;
      const id = btn.dataset.garment;
      root.setAttribute('data-loading', '');
      const layers = await loadGarmentLayers(id).catch(() => null);
      root.removeAttribute('data-loading');
      if (!layers) return;
      state.garment = id;
      tilesEl.querySelectorAll('button[data-garment]').forEach((n) =>
        n.setAttribute('aria-selected', n === btn));
      render();
    });
  }

  // The hero is a dead end without this: a visitor arranges a design, clicks
  // through, and arrives at a fresh editor with none of it. sessionStorage
  // rather than a query string because the transform is four numbers, a colour
  // and a prop arrangement, and none of it belongs in a shareable URL.
  function wireHandoff() {
    const cta = document.getElementById('hero-cta-btn');
    if (!cta) return;
    cta.addEventListener('click', () => {
      try {
        const payload = {
          style: state.mode,
          colour: state.colour,
          design: DESIGN_SRC,
          pos: state.pos,
          scale: state.scale,
        };
        if (state.mode === 'flatlay') {
          payload.garment = state.garment;
          payload.rotation = state.rot;
          // Only the staged props, and only what the editor needs to put them
          // back: which are on, and where each one ended up.
          payload.props = Object.keys(flat.active)
            .filter((t) => flat.active[t])
            .map((t) => {
              const c = flat.props[t];
              return { type: t, x: c.x, y: c.y, w: c.w, h: c.h, rotation: c.rotation || 0 };
            });
        } else {
          payload.template = state.id;
        }
        sessionStorage.setItem('teemockup_handoff', JSON.stringify(payload));
      } catch { /* private mode: the editor just opens on its defaults */ }
    });
  }

  function buildSwatches() {
    if (!swEl) return;
    swEl.innerHTML = COLOURS
      .map((c, i) => `<button type="button" role="option" aria-selected="${i === START_COLOUR}"
        aria-label="Shirt colour ${c}" data-c="${c}" style="background:${c}"></button>`)
      .join('');
    swEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-c]');
      if (!btn) return;
      swEl.querySelectorAll('button').forEach((n) => n.setAttribute('aria-selected', n === btn));
      state.colour = btn.dataset.c;
      render();
    });
  }

}

function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('load failed: ' + src));
    i.src = src;
  });
}
