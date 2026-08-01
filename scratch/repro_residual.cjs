// Reproduce residual violet seam pixels after recolour, using the exact
// editor LUT + compose maths against the built assets.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const SC = '/tmp/claude-0/-home-user-tshirt-mockup-generator/d14b0f1f-efeb-57ec-83f8-784087780ebf/scratchpad/diag';

const HEX = process.argv[2] || '#d8c8a8';
const IDS = process.argv.slice(3);

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage();
  const manifest = JSON.parse(fs.readFileSync('public/assets/on-model/templates.json', 'utf8'));
  const du = f => 'data:image/' + (f.endsWith('png') ? 'png' : 'jpeg') + ';base64,' +
    fs.readFileSync('public/assets/on-model/' + f).toString('base64');
  const ids = IDS.length ? IDS : manifest.map(t => t.id);
  for (const id of ids) {
    const meta = manifest.find(t => t.id === id);
    const out = await p.evaluate(async ({ meta, photo, weight, shade, hex }) => {
      const load = async (u) => { const i = new Image(); i.src = u; await i.decode(); return i; };
      const [ph, wt, sh] = await Promise.all([load(photo), load(weight), load(shade)]);
      const W = meta.width, H = meta.height;
      const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
      const cph = mk(), cwt = mk(), csh = mk();
      cph.getContext('2d').drawImage(ph, 0, 0, W, H);
      cwt.getContext('2d').drawImage(wt, 0, 0, W, H);
      csh.getContext('2d').drawImage(sh, 0, 0, W, H);
      const dp = cph.getContext('2d').getImageData(0, 0, W, H);
      const dw = cwt.getContext('2d').getImageData(0, 0, W, H).data;
      const ds = csh.getContext('2d').getImageData(0, 0, W, H).data;

      function relightLut(rgb) {
        const [ar, ag, ab] = meta.ambientTint;
        const relMax = meta.relMax || 1.45;
        const tLum = (rgb[0] + rgb[1] + rgb[2]) / 765;
        const GAMMA = 1 - 0.55 * tLum;
        const TINT = 0.35 * tLum;
        const SPEC = 0.28;
        const lut = new Float32Array(256 * 3);
        for (let sb = 0; sb < 256; sb++) {
          const rel = (sb / 255) * relMax;
          const lfT = Math.max(0, Math.min(1, (Math.min(rel, 1) - 0.08) / 0.22)), lf = lfT * lfT * (3 - 2 * lfT); const diff = Math.pow(Math.min(rel, 1), 1 - (1 - GAMMA) * lf);
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
      const lutT = relightLut([parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]);
      const lutV = relightLut(meta.violetBase);
      const d = dp.data, N = W * H;
      for (let i = 0; i < N; i++) {
        const wv = dw[i * 4];
        if (wv === 0) continue;
        const ww = wv / 255;
        const cl = dw[i * 4 + 1] / 255;
        const sb = ds[i * 4] * 3;
        const o = i * 4;
        d[o] = d[o] + ww * (lutT[sb] - cl * d[o] - (1 - cl) * lutV[sb]);
        d[o + 1] = d[o + 1] + ww * (lutT[sb + 1] - cl * d[o + 1] - (1 - cl) * lutV[sb + 1]);
        d[o + 2] = d[o + 2] + ww * (lutT[sb + 2] - cl * d[o + 2] - (1 - cl) * lutV[sb + 2]);
      }
      cph.getContext('2d').putImageData(dp, 0, 0);

      // Residual violet detector: pixels still reading violet after recolour.
      let resid = 0; const pts = []; const marks = new Uint8Array(N);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, r = d[i], g = d[i + 1], bl = d[i + 2];
        const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
        if (mx === mn) continue;
        const sat = (mx - mn) / mx;
        if (sat < 0.10 || (mx - mn) < 12 || mx < 40) continue;
        let h;
        if (mx === r) h = ((g - bl) / (mx - mn)) % 6;
        else if (mx === g) h = (bl - r) / (mx - mn) + 2;
        else h = (r - g) / (mx - mn) + 4;
        h *= 60; if (h < 0) h += 360;
        if (h >= 240 && h <= 320) {
          resid++; marks[y * W + x] = 1;
          if (pts.length < 4000) pts.push([x, y, r, g, bl, dw[(y * W + x) * 4], dw[(y * W + x) * 4 + 1]]);
        }
      }
      // Overlay: mark residuals red on composed
      const ov = mk(); const og = ov.getContext('2d');
      og.drawImage(cph, 0, 0);
      const od = og.getImageData(0, 0, W, H);
      for (let i = 0; i < N; i++) if (marks[i]) { od.data[i * 4] = 255; od.data[i * 4 + 1] = 0; od.data[i * 4 + 2] = 0; }
      og.putImageData(od, 0, 0);
      return { resid, pts: pts.slice(0, 24), overlay: ov.toDataURL('image/jpeg', 0.85), composed: cph.toDataURL('image/jpeg', 0.9) };
    }, { meta, photo: du(id + '-photo.jpg'), weight: du(id + '-weight.png'), shade: du(id + '-shade.jpg'), hex: HEX });
    fs.writeFileSync(path.join(SC, `resid-${id}-overlay.jpg`), Buffer.from(out.overlay.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(SC, `resid-${id}-composed.jpg`), Buffer.from(out.composed.split(',')[1], 'base64'));
    console.log(id, 'residual:', out.resid, 'samples(x,y,r,g,b,wR,wG):', JSON.stringify(out.pts.slice(0, 10)));
  }
  await b.close();
})();
