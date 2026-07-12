const fs = require('fs');
const path = require('path');
const ROOT = 'G:/MY PROJECTS/Coding Projects/Tshirt mockup generator';
const { chromium } = require('playwright');

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

    // ---- background: white wood, cover-cropped horizontally ----
    // wood is square; crop a horizontal band from the middle
    ctx.drawImage(wood, 0, (wood.height - wood.height * (H / W)) / 2, wood.width, wood.height * (H / W), 0, 0, W, H);
    // gentle vignette so edges recede behind card text overlays
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(40,30,20,0.14)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // ---- build the tinted tee with the design printed on it (offscreen) ----
    const S = 1000;
    const off = document.createElement('canvas');
    off.width = S; off.height = S;
    const octx = off.getContext('2d');

    // 1. base garment
    octx.drawImage(shirt, 0, 0, S, S);
    // 2. tint deep teal-navy (multiply keeps fabric shading), then restore alpha
    octx.globalCompositeOperation = 'multiply';
    octx.fillStyle = '#1d3a4a';
    octx.fillRect(0, 0, S, S);
    octx.globalCompositeOperation = 'destination-in';
    octx.drawImage(shirt, 0, 0, S, S);
    // 3. print the design on the chest
    octx.globalCompositeOperation = 'source-over';
    const dw = 330;
    const dh = dw * (design.height / design.width);
    const dx = (S - dw) / 2 + 6; // shirt leans slightly right
    const dy = 320;
    octx.globalAlpha = 0.96;
    octx.drawImage(design, dx, dy, dw, dh);
    octx.globalAlpha = 1;
    // 4. fabric folds over the print: re-multiply the (light) shirt photo on the print area
    octx.save();
    octx.beginPath();
    octx.rect(dx, dy, dw, dh);
    octx.clip();
    octx.globalCompositeOperation = 'multiply';
    octx.globalAlpha = 0.5;
    octx.drawImage(shirt, 0, 0, S, S);
    octx.restore();
    octx.globalAlpha = 1;
    octx.globalCompositeOperation = 'source-over';

    // ---- right: the finished mockup ----
    ctx.save();
    ctx.shadowColor = 'rgba(30,20,10,0.35)';
    ctx.shadowBlur = 50;
    ctx.shadowOffsetY = 24;
    const teeSize = 640;
    ctx.drawImage(off, 570, 10, teeSize, teeSize);
    ctx.restore();

    // ---- left: the "design file" card ----
    const cardX = 105, cardY = 105, cardW = 320, cardH = 420, pad = 18;
    ctx.save();
    ctx.translate(cardX + cardW / 2, cardY + cardH / 2);
    ctx.rotate(-0.055);
    ctx.translate(-(cardX + cardW / 2), -(cardY + cardH / 2));
    // card
    ctx.shadowColor = 'rgba(30,20,10,0.3)';
    ctx.shadowBlur = 36;
    ctx.shadowOffsetY = 16;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 18);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    // checkerboard = transparency
    const chX = cardX + pad, chY = cardY + pad, chW = cardW - pad * 2, chH = cardH - pad * 2 - 58;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(chX, chY, chW, chH, 10);
    ctx.clip();
    const sq = 16;
    for (let yy = 0; yy < chH; yy += sq) {
      for (let xx = 0; xx < chW; xx += sq) {
        ctx.fillStyle = ((xx / sq + yy / sq) % 2 === 0) ? '#ffffff' : '#e6e8eb';
        ctx.fillRect(chX + xx, chY + yy, sq, sq);
      }
    }
    // the design artwork on the transparent card
    const adW = chW - 36;
    const adH = adW * (design.height / design.width);
    ctx.drawImage(design, chX + 18, chY + (chH - adH) / 2, adW, adH);
    ctx.restore();
    // filename row
    ctx.fillStyle = '#f1f3f5';
    ctx.beginPath();
    ctx.roundRect(chX, chY + chH + 12, chW, 46, 12);
    ctx.fill();
    // little PNG badge
    ctx.fillStyle = '#06aef5';
    ctx.beginPath();
    ctx.roundRect(chX + 10, chY + chH + 21, 52, 28, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 15px Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('PNG', chX + 22, chY + chH + 36);
    ctx.fillStyle = '#3d4653';
    ctx.font = '600 17px Arial, sans-serif';
    ctx.fillText('my-design.png', chX + 74, chY + chH + 36);
    ctx.restore();

    // ---- center: brand-cyan arrow from card to tee ----
    const ax0 = 465, ax1 = 590, ay = 315;
    ctx.save();
    ctx.strokeStyle = '#06aef5';
    ctx.fillStyle = '#06aef5';
    ctx.lineWidth = 13;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(6,174,245,0.45)';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(ax0, ay);
    ctx.quadraticCurveTo((ax0 + ax1) / 2, ay - 34, ax1, ay);
    ctx.stroke();
    // arrow head
    ctx.beginPath();
    ctx.moveTo(ax1 + 16, ay + 7);
    ctx.lineTo(ax1 - 26, ay + 12);
    ctx.lineTo(ax1 - 12, ay - 26);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    return canvas.toDataURL('image/jpeg', 0.88);
  }, { woodUri, shirtUri, designUri });

  await browser.close();

  const out = path.join(ROOT, 'public/assets/banner/blog_howto_mockup.jpg');
  fs.writeFileSync(out, Buffer.from(jpegBase64.replace(/^data:image\/jpeg;base64,/, ''), 'base64'));
  console.log('written:', out, fs.statSync(out).size, 'bytes');
})();
