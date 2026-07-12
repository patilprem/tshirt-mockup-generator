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

    const W = 1200, H = 630, MID = 600;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    const CYAN = '#06aef5';
    const INK = '#20303c';

    // ---- tee builder ----
    const S = 1000;
    const makeTee = (tint, dark = false) => {
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
      const dw = 330, dh = dw * (design.height / design.width);
      const dx = (S - dw) / 2 + 6, dy = 320;
      if (dark) {
        o.globalAlpha = 0.96;
        o.drawImage(design, dx, dy, dw, dh);
        o.globalAlpha = 1;
        o.save();
        o.beginPath(); o.rect(dx, dy, dw, dh); o.clip();
        o.globalCompositeOperation = 'multiply';
        o.globalAlpha = 0.5;
        o.drawImage(shirt, 0, 0, S, S);
        o.restore();
        o.globalAlpha = 1;
        o.globalCompositeOperation = 'source-over';
      } else {
        o.globalCompositeOperation = 'multiply';
        o.drawImage(design, dx, dy, dw, dh);
        o.globalCompositeOperation = 'source-over';
      }
      return off;
    };
    const teeNavy = makeTee('#1d3a4a', true);
    const teeCream = makeTee('#efe9dc');

    // ---- LEFT: the mockup world (wood flatlay + editor chrome) ----
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, MID, H);
    ctx.clip();
    ctx.drawImage(wood, 0, (wood.height - wood.height * (H / W)) / 2, wood.width * 0.5, wood.height * (H / W), 0, 0, MID, H);
    ctx.fillStyle = 'rgba(40,30,20,0.08)';
    ctx.fillRect(0, 0, MID, H);
    ctx.restore();

    const teeL = { x: 85, y: 60, size: 440 };
    ctx.save();
    ctx.shadowColor = 'rgba(30,20,10,0.35)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 18;
    ctx.drawImage(teeNavy, teeL.x, teeL.y, teeL.size, teeL.size);
    ctx.restore();
    // editor selection box + handles around the print (in tee space: 330x340 at ~336,320 of 1000)
    const k = teeL.size / S;
    const rx = teeL.x + 336 * k, ry = teeL.y + 315 * k, rw = 336 * k, rh = 330 * k;
    ctx.save();
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([9, 7]);
    ctx.shadowColor = 'rgba(6,174,245,0.5)';
    ctx.shadowBlur = 8;
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.restore();
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 2.5;
    [[rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh]].forEach(([hx, hy]) => {
      ctx.beginPath();
      ctx.arc(hx, hy, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    // cursor arrow near the bottom-right handle
    ctx.translate(rx + rw + 10, ry + rh + 12);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, 22); ctx.lineTo(5.5, 16.5); ctx.lineTo(10, 25); ctx.lineTo(13.5, 23); ctx.lineTo(9, 15); ctx.lineTo(16, 14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // ---- RIGHT: the photo-shoot world (studio sweep + camera) ----
    ctx.save();
    ctx.beginPath();
    ctx.rect(MID, 0, W - MID, H);
    ctx.clip();
    const sg = ctx.createLinearGradient(0, 0, 0, H);
    sg.addColorStop(0, '#3c434b');
    sg.addColorStop(0.55, '#565e66');
    sg.addColorStop(1, '#7b838b');
    ctx.fillStyle = sg;
    ctx.fillRect(MID, 0, W - MID, H);
    // spotlight
    const sp = ctx.createRadialGradient(900, 240, 40, 900, 240, 420);
    sp.addColorStop(0, 'rgba(255,255,255,0.28)');
    sp.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sp;
    ctx.fillRect(MID, 0, W - MID, H);
    ctx.restore();

    const teeR = { x: 682, y: 62, size: 436 };
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 20;
    ctx.drawImage(teeCream, teeR.x, teeR.y, teeR.size, teeR.size);
    ctx.restore();

    // camera icon, top right
    ctx.save();
    ctx.translate(1072, 62);
    ctx.rotate(0.06);
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#252b31';
    ctx.beginPath();
    ctx.roundRect(-52, -8, 104, 72, 12); // body
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(-20, -20, 40, 16, 5); // viewfinder hump
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#3a424a';
    ctx.beginPath();
    ctx.arc(0, 28, 26, 0, Math.PI * 2); // lens outer
    ctx.fill();
    ctx.strokeStyle = '#98a2ab';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#11151a';
    ctx.beginPath();
    ctx.arc(0, 28, 16, 0, Math.PI * 2); // lens inner
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.arc(-5, 22, 5, 0, Math.PI * 2); // glint
    ctx.fill();
    ctx.fillStyle = '#f2b40e';
    ctx.beginPath();
    ctx.roundRect(30, 2, 14, 10, 3); // shutter button
    ctx.fill();
    ctx.restore();

    // ---- divider + VS badge ----
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 12;
    ctx.fillRect(MID - 3, 0, 6, H);
    ctx.beginPath();
    ctx.arc(MID, 300, 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#e6e8eb';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(MID, 300, 44, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = '900 40px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('VS', MID, 302);
    ctx.restore();

    // ---- bottom pills ----
    const pill = (text, cx, bg, fg) => {
      ctx.save();
      ctx.font = '800 24px Arial, sans-serif';
      const pw = ctx.measureText(text).width + 48;
      ctx.shadowColor = 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect(cx - pw / 2, 552, pw, 52, 26);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, cx, 579);
      ctx.restore();
    };
    pill('MOCKUP · $0 · 60 SEC', 300, CYAN, '#ffffff');
    pill('PHOTO SHOOT · $$$ · DAYS', 900, '#ffffff', INK);

    return canvas.toDataURL('image/jpeg', 0.88);
  }, { woodUri, shirtUri, designUri });

  await browser.close();

  const out = path.join(ROOT, 'public/assets/banner/blog_mockup_vs_photo.jpg');
  fs.writeFileSync(out, Buffer.from(jpegBase64.replace(/^data:image\/jpeg;base64,/, ''), 'base64'));
  console.log('written:', out, fs.statSync(out).size, 'bytes');
})();
