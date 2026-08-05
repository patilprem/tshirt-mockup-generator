// The homepage hero, running the real on-model engine.
//
// Scope note: on model only for now. Flat lay needs the editor's garment
// pipeline — fabric-fold shading, print-area mapping, prop compositing —
// extracted the same way the on-model engine was, and shipping a toggle whose
// second tab drew something that did not match the editor would be worse than
// shipping one tab that does.
//
// Everything here is deliberately cheap on the LCP path: nothing runs until
// the browser is idle, and the canvas stays hidden behind a static poster
// until it has a full frame to show.

import {
  onModelCache, loadOnModelTemplate, buildOnModelComposed,
  onModelHighlightCanvas, onModelClipCanvas, onModelShadeCanvas, buildDesignBuffer,
} from './onmodel-engine.js';

// Matches the editor's palette; the second entry is the shirt the poster was
// rendered in, so the swap from poster to canvas is invisible.
const COLOURS = ['#f4f4f4', '#212121', '#4b53b5', '#7a2733', '#3f4a35', '#c9a227'];
const START_COLOUR = 1;
// The poster is gallery-f, so that template leads and the canvas can take over
// without the scene changing under the visitor.
const ORDER = ['gallery-f', 'street-m', 'miami-f', 'park-m'];
const DESIGN_SRC = '/assets/designs/cat.png';

const SEL = { colour: '#3b82f6', line: 1.5, handle: 6.5, rotR: 10, rotGap: 30 };

export function initHeroStudio() {
  const root = document.getElementById('hero-studio');
  if (!root) return;
  const canvas = document.getElementById('hs-canvas');
  const tilesEl = document.getElementById('hs-tiles');
  const swEl = document.getElementById('hs-swatches');
  if (!canvas) return;

  // A phone that never scrolls to the hero should not pay for any of this.
  const start = () => boot({ root, canvas, tilesEl, swEl }).catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 2500 });
  else setTimeout(start, 1200);
}

async function boot(el) {
  const { root, canvas, tilesEl, swEl } = el;

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
    id: metas[0].id,
    colour: COLOURS[START_COLOUR],
    // Artboard-space transform, the same units and defaults the editor uses,
    // so a design carried into the editor lands exactly where it looked.
    pos: { x: 500, y: 420 },
    scale: 0.52,
    composed: null,
    composedKey: '',
    view: { k: 1, ox: 0, oy: 0 },
    drag: null,
  };

  const ctx = canvas.getContext('2d');

  await useTemplate(metas[0]);
  buildTiles();
  buildSwatches();
  wirePointer();
  wireHandoff();

  root.setAttribute('data-ready', '');
  render();

  // --- template -----------------------------------------------------------
  async function useTemplate(meta) {
    const entry = await loadOnModelTemplate(meta);
    state.id = meta.id;
    state.composedKey = '';
    // The canvas matches the 1:1 crop, so the hero frames the print the same
    // way the editor's 1:1 preset does.
    const crop = cropRect(entry);
    const side = Math.round(Math.min(crop.w, crop.h) * 0.75);
    canvas.width = side;
    canvas.height = side;
    return entry;
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
    return { x: ((cx - r.left) * sx - state.view.ox) / state.view.k, y: ((cy - r.top) * sy - state.view.oy) / state.view.k };
  }

  function wirePointer() {
    const down = (e) => {
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
    };

    const move = (e) => {
      if (!state.drag) return;
      const entry = onModelCache.get(state.id);
      if (!entry) return;
      e.preventDefault();
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
    };

    const up = () => { state.drag = null; };

    canvas.addEventListener('mousedown', down);
    canvas.addEventListener('touchstart', down, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
  }

  // --- pickers ------------------------------------------------------------
  function buildTiles() {
    if (!tilesEl) return;
    tilesEl.innerHTML = metas
      .map((m, i) => `<img src="/assets/gallery/onmodel_${m.id}.jpg" alt="${m.label}" role="option"
        aria-selected="${i === 0}" data-id="${m.id}" loading="lazy" width="46" height="46" />`)
      .join('');
    tilesEl.addEventListener('click', async (e) => {
      const img = e.target.closest('img[data-id]');
      if (!img || img.dataset.id === state.id) return;
      const meta = byId.get(img.dataset.id);
      if (!meta) return;
      tilesEl.querySelectorAll('img').forEach((n) => n.setAttribute('aria-selected', n === img));
      await useTemplate(meta);
      render();
    });
  }

  // The hero is a dead end without this: a visitor arranges a design, clicks
  // through, and arrives at a fresh editor with none of it. sessionStorage
  // rather than a query string because the transform is four numbers and a
  // colour, and none of it belongs in a shareable URL.
  function wireHandoff() {
    const cta = document.getElementById('hero-cta-btn');
    if (!cta) return;
    cta.addEventListener('click', () => {
      try {
        sessionStorage.setItem('teemockup_handoff', JSON.stringify({
          style: 'onmodel',
          template: state.id,
          colour: state.colour,
          design: DESIGN_SRC,
          pos: state.pos,
          scale: state.scale,
        }));
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
