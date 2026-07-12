const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');

function dataUri(p) {
  return 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
}

(async () => {
  const woodUri = dataUri(path.join(ROOT, 'public/assets/wood_white.png'));
  const shirtUri = dataUri(path.join(ROOT, 'public/assets/processed/tshirt_flatlay.png'));
  const designUri = dataUri(path.join(ROOT, 'public/assets/designs/minimal_mountain.png'));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.goto('about:blank');

  const jpegBase64 = await page.evaluate(async ({ woodUri, shirtUri, designUri }) => {
    const load = (src) =>
      new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = src;
      });
    const [wood, shirt, designRaw] = await Promise.all([load(woodUri), load(shirtUri), load(designUri)]);

    // strip the faint semi-transparent haze in the design's background
    const dClean = document.createElement('canvas');
    dClean.width = designRaw.width; dClean.height = designRaw.height;
    const dctx = dClean.getContext('2d');
    dctx.drawImage(designRaw, 0, 0);
    const idata = dctx.getImageData(0, 0, dClean.width, dClean.height);
    const px = idata.data;
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] < 60) px[i] = 0;
    }
    dctx.putImageData(idata, 0, 0);
    const design = dClean;

    const W = 1200, H = 630;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // ---- background: white wood band + soft vignette ----
    ctx.drawImage(wood, 0, (wood.height - wood.height * (H / W)) / 2, wood.width, wood.height * (H / W), 0, 0, W, H);
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(40,30,20,0.14)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // ---- offscreen: light-heather tee with the design at correct placement ----
    const S = 1000;
    const off = document.createElement('canvas');
    off.width = S; off.height = S;
    const octx = off.getContext('2d');
    octx.drawImage(shirt, 0, 0, S, S);
    octx.globalCompositeOperation = 'multiply';
    octx.fillStyle = '#e2e6e9'; // soft heather so guides and print pop
    octx.fillRect(0, 0, S, S);
    octx.globalCompositeOperation = 'destination-in';
    octx.drawImage(shirt, 0, 0, S, S);
    octx.globalCompositeOperation = 'source-over';
    // print area (in 1000-space) — matches the labels drawn later
    const pa = { x: 330, y: 300, w: 348, h: 430 };
    // design centered in print area, drawn like a real print
    const dw = 310;
    const dh = dw * (design.height / design.width);
    const dx = pa.x + (pa.w - dw) / 2;
    const dy = pa.y + 26;
    // multiply lets the fabric shading show through the print (classic light-garment technique)
    octx.globalCompositeOperation = 'multiply';
    octx.drawImage(design, dx, dy, dw, dh);
    octx.globalCompositeOperation = 'source-over';

    // ---- place the tee center-stage ----
    const teeSize = 640;
    const teeX = (W - teeSize) / 2 + 40; // nudge right to leave room for the vertical dimension
    const teeY = -6;
    ctx.save();
    ctx.shadowColor = 'rgba(30,20,10,0.35)';
    ctx.shadowBlur = 50;
    ctx.shadowOffsetY = 24;
    ctx.drawImage(off, teeX, teeY, teeSize, teeSize);
    ctx.restore();

    // helper: map offscreen (1000-space) coords onto the banner
    const k = teeSize / S;
    const mx = (v) => teeX + v * k;
    const my = (v) => teeY + v * k;

    const CYAN = '#06aef5';
    const INK = '#123243';

    // ---- editor-style selection box around the print area ----
    const rx = mx(pa.x), ry = my(pa.y), rw = pa.w * k, rh = pa.h * k;
    ctx.save();
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 3;
    ctx.setLineDash([11, 8]);
    ctx.shadowColor = 'rgba(6,174,245,0.5)';
    ctx.shadowBlur = 10;
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.restore();
    // drag handles on the corners (like the editor)
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 3;
    [[rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh]].forEach(([hx, hy]) => {
      ctx.beginPath();
      ctx.arc(hx, hy, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();

    // ---- dimension helpers ----
    const pill = (text, cx, cy) => {
      ctx.font = '700 21px Arial, sans-serif';
      const tw = ctx.measureText(text).width;
      const pw = tw + 28, ph = 38;
      ctx.save();
      ctx.shadowColor = 'rgba(30,20,10,0.25)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 5;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(cx - pw / 2, cy - ph / 2, pw, ph, 19);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = INK;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(text, cx, cy + 1);
      ctx.textAlign = 'left';
    };
    const arrowHead = (x, y, angle) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-13, -6);
      ctx.lineTo(-13, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = 3;

    // ---- vertical dimension: collar seam -> top of print area ("3 in below collar") ----
    const collarY = my(215); // bottom of collar seam in shirt space
    const vx = mx(pa.x) - 52;
    ctx.beginPath();
    ctx.moveTo(vx, collarY);
    ctx.lineTo(vx, ry);
    ctx.stroke();
    // ticks
    ctx.beginPath();
    ctx.moveTo(vx - 12, collarY); ctx.lineTo(mx(430), collarY);
    ctx.moveTo(vx - 12, ry); ctx.lineTo(rx, ry);
    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    arrowHead(vx, collarY, -Math.PI / 2);
    arrowHead(vx, ry, Math.PI / 2);
    pill('3″ below collar', vx - 118, (collarY + ry) / 2);

    // ---- horizontal dimension: print-area width ("12 in max width") ----
    const hy = ry + rh + 44;
    ctx.beginPath();
    ctx.moveTo(rx, hy);
    ctx.lineTo(rx + rw, hy);
    ctx.stroke();
    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(rx, ry + rh); ctx.lineTo(rx, hy + 10);
    ctx.moveTo(rx + rw, ry + rh); ctx.lineTo(rx + rw, hy + 10);
    ctx.stroke();
    ctx.restore();
    arrowHead(rx, hy, Math.PI);
    arrowHead(rx + rw, hy, 0);
    pill('12″ max print width', rx + rw / 2, hy + 40);

    return canvas.toDataURL('image/jpeg', 0.88);
  }, { woodUri, shirtUri, designUri });

  await browser.close();

  const out = path.join(ROOT, 'public/assets/banner/blog_placement_guide.jpg');
  fs.writeFileSync(out, Buffer.from(jpegBase64.replace(/^data:image\/jpeg;base64,/, ''), 'base64'));
  console.log('written:', out, fs.statSync(out).size, 'bytes');
})();
