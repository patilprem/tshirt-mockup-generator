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
    vg.addColorStop(1, 'rgba(40,30,20,0.18)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // ---- tee builder (same pipeline as the other banners) ----
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
    const teeGray = makeTee('#ccd2d7');
    const teeCream = makeTee('#efe9dc');

    const INK = '#20303c';
    const MUTED = '#e4e7ea';
    const GOLD = '#f2a90e';

    // 5-point star
    const star = (cx, cy, r, fill) => {
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        const a2 = a + Math.PI / 5;
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.lineTo(cx + Math.cos(a2) * r * 0.45, cy + Math.sin(a2) * r * 0.45);
      }
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();
    };

    // listing card: photo area + stars + skeleton title + price
    const card = (x, y, w, h, tee, { hero = false } = {}) => {
      const r = 16;
      ctx.save();
      ctx.shadowColor = 'rgba(30,20,10,0.32)';
      ctx.shadowBlur = hero ? 40 : 26;
      ctx.shadowOffsetY = hero ? 18 : 12;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fill();
      ctx.restore();

      // photo area (light warm background so the tee reads as a product photo)
      const pad = 12;
      const ph = w - pad * 2; // square photo
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x + pad, y + pad, w - pad * 2, ph, 10);
      ctx.clip();
      const g = ctx.createLinearGradient(x, y, x, y + ph);
      g.addColorStop(0, '#f6f4f0');
      g.addColorStop(1, '#ebe7e0');
      ctx.fillStyle = g;
      ctx.fillRect(x + pad, y + pad, w - pad * 2, ph);
      const teeSize = ph * 1.16;
      ctx.drawImage(tee, x + pad + (w - pad * 2 - teeSize) / 2, y + pad + ph * 0.02, teeSize, teeSize);
      ctx.restore();

      // stars row
      let sy = y + pad + ph + 26;
      const starR = hero ? 11 : 9;
      for (let i = 0; i < 5; i++) star(x + pad + 10 + i * (starR * 2.5), sy, starR, GOLD);
      ctx.fillStyle = '#8a949c';
      ctx.font = `600 ${hero ? 16 : 13}px Arial, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText(hero ? '(1,024)' : '(312)', x + pad + 10 + 5 * (starR * 2.5) + 6, sy + 1);

      // skeleton title lines
      sy += hero ? 26 : 20;
      ctx.fillStyle = MUTED;
      ctx.beginPath();
      ctx.roundRect(x + pad + 4, sy, (w - pad * 2) * 0.86, hero ? 13 : 10, 6);
      ctx.roundRect(x + pad + 4, sy + (hero ? 22 : 17), (w - pad * 2) * 0.55, hero ? 13 : 10, 6);
      ctx.fill();

      // price
      ctx.fillStyle = INK;
      ctx.font = `800 ${hero ? 27 : 20}px Arial, sans-serif`;
      ctx.fillText(hero ? '$24.99' : '$21.50', x + pad + 4, sy + (hero ? 62 : 48));
      return { priceY: sy + (hero ? 62 : 48) };
    };

    // side cards (peeking, like a search-results row)
    card(38, 128, 300, 420, teeGray);
    card(862, 128, 300, 420, teeCream);
    // hero card
    const heroX = 405, heroY = 42, heroW = 390, heroH = 540;
    const { priceY } = card(heroX, heroY, heroW, heroH, teeNavy, { hero: true });

    // "Bestseller" pill on the hero card's photo corner
    ctx.save();
    ctx.shadowColor = 'rgba(30,20,10,0.3)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = '#06aef5';
    ctx.font = '800 19px Arial, sans-serif';
    const bl = 'BESTSELLER';
    const blw = ctx.measureText(bl).width + 34;
    ctx.beginPath();
    ctx.roundRect(heroX + 26, heroY + 28, blw, 40, 20);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(bl, heroX + 43, heroY + 49);
    ctx.restore();

    // "FREE shipping" tag beside hero price
    ctx.fillStyle = '#1e9e5a';
    ctx.font = '700 17px Arial, sans-serif';
    ctx.fillText('FREE shipping', heroX + 145, priceY);

    return canvas.toDataURL('image/jpeg', 0.88);
  }, { woodUri, shirtUri, designUri });

  await browser.close();

  const out = path.join(ROOT, 'public/assets/banner/blog_etsy_photos.jpg');
  fs.writeFileSync(out, Buffer.from(jpegBase64.replace(/^data:image\/jpeg;base64,/, ''), 'base64'));
  console.log('written:', out, fs.statSync(out).size, 'bytes');
})();
