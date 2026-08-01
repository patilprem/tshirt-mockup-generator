// Renders each template white and measures near-black pixels in the underarm
// band — the "black underarm on a light shirt" defect.
const { chromium } = require('playwright');
const fs = require('fs');
const SC = '/tmp/claude-0/-home-user-tshirt-mockup-generator/d14b0f1f-efeb-57ec-83f8-784087780ebf/scratchpad/diag';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage();
  const manifest = JSON.parse(fs.readFileSync('public/assets/on-model/templates.json', 'utf8'));
  const du = f => 'data:image/' + (f.endsWith('png') ? 'png' : 'jpeg') + ';base64,' + fs.readFileSync('public/assets/on-model/' + f).toString('base64');
  for (const meta of manifest) {
    const id = meta.id;
    const out = await p.evaluate(async ({ meta, photo, weight, shade }) => {
      const load = async u => { const i = new Image(); i.src = u; await i.decode(); return i; };
      const [ph, wt, sh] = await Promise.all([load(photo), load(weight), load(shade)]);
      const W = meta.width, H = meta.height;
      const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
      const cph = mk(), cwt = mk(), csh = mk();
      cph.getContext('2d').drawImage(ph, 0, 0, W, H); cwt.getContext('2d').drawImage(wt, 0, 0, W, H); csh.getContext('2d').drawImage(sh, 0, 0, W, H);
      const dp = cph.getContext('2d').getImageData(0, 0, W, H);
      const dw = cwt.getContext('2d').getImageData(0, 0, W, H).data;
      const ds = csh.getContext('2d').getImageData(0, 0, W, H).data;
      function lut(rgb) {
        const [ar, ag, ab] = meta.ambientTint, rm = meta.relMax || 1.45;
        const tL = (rgb[0] + rgb[1] + rgb[2]) / 765, GA = 1 - 0.55 * tL, TI = 0.35 * tL, SP = 0.28;
        const L = new Float32Array(768);
        for (let s = 0; s < 256; s++) {
          const rel = (s / 255) * rm;
          const diff = Math.pow(Math.min(rel, 1), GA);
          const w = (1 - diff) * TI;
          let r = rgb[0] * diff * (1 - w + w * ar), g = rgb[1] * diff * (1 - w + w * ag), b2 = rgb[2] * diff * (1 - w + w * ab);
          if (rel > 1) { const sp = Math.min(1, (rel - 1) / (rm - 1)) * SP; r += (255 - r) * sp; g += (255 - g) * sp; b2 += (255 - b2) * sp; }
          L[s * 3] = r; L[s * 3 + 1] = g; L[s * 3 + 2] = b2;
        }
        return L;
      }
      const lT = lut([255, 255, 255]), lV = lut(meta.violetBase);
      const d = dp.data, N = W * H;
      for (let i = 0; i < N; i++) {
        const wv = dw[i * 4]; if (!wv) continue;
        const ww = wv / 255, cl = dw[i * 4 + 1] / 255, sb = ds[i * 4] * 3, o = i * 4;
        d[o] += ww * (lT[sb] - cl * d[o] - (1 - cl) * lV[sb]);
        d[o + 1] += ww * (lT[sb + 1] - cl * d[o + 1] - (1 - cl) * lV[sb + 1]);
        d[o + 2] += ww * (lT[sb + 2] - cl * d[o + 2] - (1 - cl) * lV[sb + 2]);
      }
      cph.getContext('2d').putImageData(dp, 0, 0);
      const bb = meta.bbox;
      // Precise defect metric: near-black pixels EMBEDDED in bright recoloured
      // fabric — a dark speck surrounded by white shirt. Background darkness
      // (hair, scenery) has no bright surround and is not counted.
      let specks = 0;
      {
        const dd = cph.getContext('2d').getImageData(0, 0, W, H).data;
        const L = k => 0.299 * dd[k * 4] + 0.587 * dd[k * 4 + 1] + 0.114 * dd[k * 4 + 2];
        const R = 7;
        for (let y = bb.y; y < bb.y + bb.h; y++) for (let x = bb.x; x < bb.x + bb.w; x++) {
          const i = y * W + x;
          if (L(i) > 80) continue;
          let bright = 0;
          for (const [dx, dy] of [[R,0],[-R,0],[0,R],[0,-R],[R,R],[R,-R],[-R,R],[-R,-R]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            if (L(ny * W + nx) > 150) bright++;
          }
          if (bright >= 5) specks++;
        }
      }
      let dark = 0;
      const bands = [
        [Math.max(0, bb.x - 20), bb.y + Math.round(bb.h * 0.15), Math.round(bb.w * 0.38), Math.round(bb.h * 0.3)],
        [bb.x + Math.round(bb.w * 0.62), bb.y + Math.round(bb.h * 0.15), Math.round(bb.w * 0.38), Math.round(bb.h * 0.3)],
      ];
      const crops = [];
      for (const [rx, ry, rw, rh] of bands) {
        const dd = cph.getContext('2d').getImageData(rx, ry, rw, rh).data;
        for (let k = 0; k < rw * rh; k++) { const o = k * 4; if (0.299 * dd[o] + 0.587 * dd[o + 1] + 0.114 * dd[o + 2] < 70) dark++; }
        const Z = 3, c2 = document.createElement('canvas'); c2.width = rw * Z; c2.height = rh * Z;
        const g2 = c2.getContext('2d'); g2.imageSmoothingEnabled = false;
        g2.drawImage(cph, rx, ry, rw, rh, 0, 0, rw * Z, rh * Z);
        crops.push(c2.toDataURL('image/png'));
      }
      return { dark, specks, crops };
    }, { meta, photo: du(id + '-photo.jpg'), weight: du(id + '-weight.png'), shade: du(id + '-shade.jpg') });
    out.crops.forEach((c, k) => fs.writeFileSync(`${SC}/ua-${id}-${k}.png`, Buffer.from(c.split(',')[1], 'base64')));
    console.log(id, 'dark specks embedded in bright fabric:', out.specks, '| underarm-band near-black:', out.dark);
  }
  await b.close();
})();
