// Selection chrome — one definition, every mode and every surface.
//
// Canva-style: round white handles at the corners and a rotate button standing
// off below the box. Sizes are CSS PIXELS ON SCREEN, converted at draw time,
// because the callers draw into different spaces — flat lay inside a shirtZoom
// transform on a 1000px artboard, on-model in raw canvas pixels on an 800x1200
// one, the hero on a square crop of its own — and a constant in any one of
// those comes out a different physical size in the others. Passing the
// conversion in (`u`: units of the current drawing space per CSS pixel) is what
// makes the control genuinely identical rather than merely similar.

export const SEL_HANDLE_R = 6.5;  // corner circle radius
export const SEL_ROT_R = 10;      // rotate button radius
export const SEL_ROT_GAP = 30;    // gap between box and rotate button
export const SEL_LINE = 1.5;      // outline width
export const SEL_COLOUR = '#3b82f6';

export function drawRotateIcon(c, cx, cy, r, u) {
  c.save();
  c.strokeStyle = SEL_COLOUR;
  c.fillStyle = SEL_COLOUR;
  c.lineWidth = Math.max(1.4 * u, r * 0.26);
  c.lineCap = 'round';
  const a0 = Math.PI * 0.72, a1 = Math.PI * 2.05;
  c.beginPath();
  c.arc(cx, cy, r, a0, a1);
  c.stroke();
  // Arrowhead on the open end, pointing along the tangent there.
  const hx = cx + r * Math.cos(a1), hy = cy + r * Math.sin(a1);
  const t = a1 + Math.PI / 2;
  const s = r * 0.9;
  c.beginPath();
  c.moveTo(hx + s * Math.cos(t), hy + s * Math.sin(t));
  c.lineTo(hx + s * 0.7 * Math.cos(t + 2.3), hy + s * 0.7 * Math.sin(t + 2.3));
  c.lineTo(hx + s * 0.7 * Math.cos(t - 2.3), hy + s * 0.7 * Math.sin(t - 2.3));
  c.closePath();
  c.fill();
  c.restore();
}

// corners: four points in the CURRENT drawing space, clockwise from
// top-left. rot: the rotate button's centre in the same space.
// u: how many units of that space make one CSS pixel on screen.
export function drawSelectionChrome(c, corners, rot, u) {
  c.save();
  c.strokeStyle = SEL_COLOUR;
  c.lineWidth = SEL_LINE * u;
  c.beginPath();
  c.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 4; i++) c.lineTo(corners[i].x, corners[i].y);
  c.closePath();
  c.stroke();

  const bottom = { x: (corners[2].x + corners[3].x) / 2, y: (corners[2].y + corners[3].y) / 2 };
  c.beginPath();
  c.moveTo(bottom.x, bottom.y);
  c.lineTo(rot.x, rot.y);
  c.stroke();

  c.fillStyle = '#ffffff';
  for (const p of corners) {
    c.beginPath();
    c.arc(p.x, p.y, SEL_HANDLE_R * u, 0, Math.PI * 2);
    c.fill(); c.stroke();
  }
  c.beginPath();
  c.arc(rot.x, rot.y, SEL_ROT_R * u, 0, Math.PI * 2);
  c.fill(); c.stroke();
  drawRotateIcon(c, rot.x, rot.y, SEL_ROT_R * u * 0.52, u);
  c.restore();
}

// Grab radius in CSS pixels: a fingertip needs far more than the handle
// shows, and that slack is invisible so it costs the artwork nothing.
export function selGrabCss() {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return coarse ? 24 : 16;
}
