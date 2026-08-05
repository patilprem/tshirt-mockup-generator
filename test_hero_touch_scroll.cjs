// A phone must always be able to scroll past the hero, even with a thumb on
// the studio. touch-action:none made the studio a dead zone: the page simply
// would not move. This drives REAL touch input through CDP rather than
// synthetic TouchEvents, because synthetic ones never consult touch-action
// and would pass whatever the CSS said.
//
// Needs the dev server: npm run dev, then node test_hero_touch_scroll.cjs
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = process.env.BASE_URL || 'http://localhost:4321';
let bad = 0;
const fail = m => { bad++; console.log('  FAIL: ' + m); };
const ok = m => console.log('  ok: ' + m);

(async () => {
  const br = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const ctx = await br.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on('pageerror', e => fail('PAGE ERROR: ' + e.message));
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.waitForFunction(() => document.getElementById('hero-studio')?.hasAttribute('data-ready'), null, { timeout: 25000 });
  await sleep(1200);

  const cdp = await ctx.newCDPSession(p);
  const touch = async (type, x, y) => {
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 12, radiusY: 12, force: 1 }],
    });
  };
  const swipe = async (from, dx, dy, steps = 12) => {
    await touch('touchStart', from.x, from.y);
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', from.x + (dx * i) / steps, from.y + (dy * i) / steps);
      await sleep(16);
    }
    await touch('touchEnd', from.x + dx, from.y + dy);
    await sleep(400);
  };

  const centre = async () => p.evaluate(() => {
    const r = document.getElementById('hs-canvas').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const snap = () => p.evaluate(() => {
    const c = document.getElementById('hs-canvas');
    return [...c.getContext('2d').getImageData(0, 0, c.width, c.height).data].filter((_, i) => i % 97 === 0).join(',');
  });

  // Put the studio on screen, then swipe UP from its middle — the exact
  // gesture a visitor makes to read past the hero.
  await p.evaluate(() => document.getElementById('hero-studio').scrollIntoView({ block: 'center' }));
  await sleep(600);
  const y0 = await p.evaluate(() => Math.round(scrollY));
  const before = await snap();
  await swipe(await centre(), 0, -260);
  const y1 = await p.evaluate(() => Math.round(scrollY));
  const afterV = await snap();
  console.log(`\nvertical swipe on the studio: scrollY ${y0} -> ${y1}`);
  y1 > y0 + 100 ? ok('the page scrolled') : fail(`the page did not scroll (${y0} -> ${y1}) — the studio is a dead zone`);
  afterV === before ? ok('the design stayed put while scrolling') : fail('the design moved while the page scrolled');

  // A sideways drag is still the studio's own gesture.
  await p.evaluate(() => document.getElementById('hero-studio').scrollIntoView({ block: 'center' }));
  await sleep(600);
  const y2 = await p.evaluate(() => Math.round(scrollY));
  const beforeH = await snap();
  await swipe(await centre(), 90, 0);
  const y3 = await p.evaluate(() => Math.round(scrollY));
  const afterH = await snap();
  console.log(`horizontal drag on the design: scrollY ${y2} -> ${y3}`);
  Math.abs(y3 - y2) < 20 ? ok('the page held still') : fail(`the page scrolled during a sideways drag (${y2} -> ${y3})`);
  afterH !== beforeH ? ok('the design moved') : fail('the design did not move — dragging is broken on touch');

  await br.close();
  console.log(bad ? `\n${bad} failure(s)` : '\nthe hero scrolls and still drags');
  process.exit(bad ? 1 : 0);
})();
