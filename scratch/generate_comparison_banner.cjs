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
    const [wood, shirt, design] = await Promise.all([load(woodUri), load(shirtUri), load(designUri)]);

    const W = 1200, H = 630;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // ---- background ----
    ctx.drawImage(wood, 0, (wood.height - wood.height * (H / W)) / 2, wood.width, wood.height * (H / W), 0, 0, W, H);
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(40,30,20,0.16)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    const S = 1000;
    // builds a tee canvas: tinted garment + the design printed on the chest
    const makeTee = (tint, { dark = false, watermark = false } = {}) => {
      const off = document.createElement('canvas');
      off.width = S; off.height = S;
      const o = off.getContext('2d');
      o.drawImage(shirt, 0, 0, S, S);
      o.globalCompositeOperation = 'multiply';
      o.fillStyle = tint;
      o.fillRect(0, 0, S, S);
      o.globalCompositeOperation = 'destination-in';
      o.drawImage(shirt, 0, 0, S, S);
      o.globalCompositeOperation = 'source-over';
      const dw = 330;
      const dh = dw * (design.height / design.width);
      const dx = (S - dw) / 2 + 6;
      const dy = 320;
      if (dark) {
        // dark garment: draw print normally, then re-multiply folds (renders fine on dark)
        o.globalAlpha = 0.96;
        o.drawImage(design, dx, dy, dw, dh);
        o.globalAlpha = 1;
        o.save();
        o.beginPath();
        o.rect(dx, dy, dw, dh);
        o.clip();
        o.globalCompositeOperation = 'multiply';
        o.globalAlpha = 0.5;
        o.drawImage(shirt, 0, 0, S, S);
        o.restore();
        o.globalAlpha = 1;
        o.globalCompositeOperation = 'source-over';
      } else {
        // light garment: multiply keeps fabric texture through the ink
        o.globalCompositeOperation = 'multiply';
        o.drawImage(design, dx, dy, dw, dh);
        o.globalCompositeOperation = 'source-over';
      }
      if (watermark) {
        // diagonal PREVIEW watermarks clipped to the garment
        o.save();
        o.globalCompositeOperation = 'source-atop';
        o.translate(S / 2, S / 2);
        o.rotate(-0.45);
        o.font = '800 74px Arial, sans-serif';
        o.textAlign = 'center';
        o.fillStyle = 'rgba(255,255,255,0.55)';
        for (let row = -2; row <= 2; row++) {
          o.fillText('PREVIEW', (row % 2) * 160, row * 170);
        }
        o.restore();
      }
      return off;
    };

    const teeLeft = makeTee('#ccd2d7', { watermark: true });
    const teeRight = makeTee('#efe9dc');
    const teeCenter = makeTee('#1d3a4a', { dark: true });

    const drawTee = (tee, x, y, size) => {
      ctx.save();
      ctx.shadowColor = 'rgba(30,20,10,0.35)';
      ctx.shadowBlur = 44;
      ctx.shadowOffsetY = 20;
      ctx.drawImage(tee, x, y, size, size);
      ctx.restore();
    };

    // side tees behind, winner front and center
    drawTee(teeLeft, 18, 120, 430);
    drawTee(teeRight, 752, 120, 430);
    drawTee(teeCenter, 318, 4, 570);

    // ---- price tag hanging on the right tee's shoulder ----
    const tagX = 1020, tagY = 176;
    ctx.save();
    ctx.translate(tagX, tagY);
    ctx.rotate(0.32);
    ctx.shadowColor = 'rgba(30,20,10,0.3)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#f7f4ec';
    ctx.beginPath();
    ctx.roundRect(-62, 0, 124, 66, 10);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#d9d2c2';
    ctx.lineWidth = 2;
    ctx.stroke();
    // string hole
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#b9b1a0';
    ctx.beginPath();
    ctx.arc(0, 14, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#8a4b2d';
    ctx.font = '800 26px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$ / mo', 0, 44);
    ctx.restore();
    // string from tag hole to the collar
    ctx.save();
    ctx.strokeStyle = 'rgba(120,105,85,0.8)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(tagX - 4, tagY + 12);
    ctx.quadraticCurveTo(tagX - 40, tagY - 26, tagX - 62, tagY - 20);
    ctx.stroke();
    ctx.restore();

    // ---- gold #1 rosette on the center tee ----
    const bx = 836, by = 96, R = 56;
    ctx.save();
    ctx.shadowColor = 'rgba(30,20,10,0.35)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    // ribbon tails
    ctx.fillStyle = '#0e8fc7';
    const tail = (angle) => {
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(-16, R * 0.55);
      ctx.lineTo(-16, R * 0.55 + 62);
      ctx.lineTo(0, R * 0.55 + 46);
      ctx.lineTo(16, R * 0.55 + 62);
      ctx.lineTo(16, R * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    tail(-0.35);
    tail(0.35);
    // scalloped rosette
    ctx.fillStyle = '#f2b40e';
    ctx.beginPath();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      ctx.arc(bx + Math.cos(a) * (R - 12), by + Math.sin(a) * (R - 12), 16, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.beginPath();
    ctx.arc(bx, by, R - 10, 0, Math.PI * 2);
    ctx.fillStyle = '#ffcf3f';
    ctx.fill();
    ctx.strokeStyle = '#e0a400';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(bx, by, R - 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#5b4300';
    ctx.font = '900 44px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('#1', bx, by + 2);
    ctx.restore();

    // ---- FREE pill under the winner ----
    ctx.save();
    ctx.shadowColor = 'rgba(30,20,10,0.3)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#06aef5';
    ctx.font = '800 27px Arial, sans-serif';
    const label = '100% FREE · NO WATERMARK';
    const lw = ctx.measureText(label).width + 52;
    ctx.beginPath();
    ctx.roundRect((W - lw) / 2, 548, lw, 54, 27);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, W / 2, 576);
    ctx.restore();

    return canvas.toDataURL('image/jpeg', 0.88);
  }, { woodUri, shirtUri, designUri });

  await browser.close();

  const out = path.join(ROOT, 'public/assets/banner/blog_comparison.jpg');
  fs.writeFileSync(out, Buffer.from(jpegBase64.replace(/^data:image\/jpeg;base64,/, ''), 'base64'));
  console.log('written:', out, fs.statSync(out).size, 'bytes');
})();
