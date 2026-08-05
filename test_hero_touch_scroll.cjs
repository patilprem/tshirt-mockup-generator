// Two things have to be true at once on a phone, and they pull against each
// other:
//
//   1. The page must scroll when a thumb lands on the studio. touch-action:none
//      made it a dead zone — the page simply would not move.
//   2. The design must drag in EVERY direction, including straight down, which
//      is the one the browser claims the moment you hand scrolling back to it.
//
// The resolution is that only the selected element takes touch outright, via a
// grab surface tracking its box; everything else on the studio scrolls. So this
// drives real touch through CDP — synthetic TouchEvents never consult
// touch-action and would pass whatever the CSS happened to say — and it
// resolves the grab point from the live geometry rather than assuming the
// design is still wherever it started.
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
  const cdp = await ctx.newCDPSession(p);

  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 12, radiusY: 12, force: 1 }],
  });
  const swipe = async (from, dx, dy, steps = 14) => {
    await touch('touchStart', from.x, from.y);
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', from.x + (dx * i) / steps, from.y + (dy * i) / steps);
      await sleep(16);
    }
    await touch('touchEnd', from.x + dx, from.y + dy);
    await sleep(400);
  };

  // Fresh page per case: a design dragged 120px in one case is no longer under
  // the grab point for the next, and that drift would silently turn later
  // cases into swipes on bare backdrop that pass for the wrong reason.
  const fresh = async () => {
    // domcontentloaded, not networkidle: this reloads six times, and waiting
    // for the network to fall quiet on a busy dev server timed out on one run
    // of six. data-ready below is the signal that actually matters — it fires
    // when the studio has a frame — so networkidle was only ever adding flake.
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => document.getElementById('hero-studio')?.hasAttribute('data-ready'), null, { timeout: 25000 });
    await sleep(1200);
    await p.evaluate(() => document.getElementById('hero-studio').scrollIntoView({ block: 'center' }));
    await sleep(500);
  };
  // Where the design actually is, read off the grab surface the code sizes.
  const onDesign = () => p.evaluate(() => {
    const r = document.getElementById('hs-grab').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width), h: Math.round(r.height) };
  });
  // A point on the studio that is NOT the design: the frame's top-left corner.
  const offDesign = () => p.evaluate(() => {
    const r = document.getElementById('hs-canvas').getBoundingClientRect();
    return { x: r.left + r.width * 0.1, y: r.top + r.height * 0.1 };
  });
  const scrollY = () => p.evaluate(() => Math.round(window.scrollY));
  const snap = () => p.evaluate(() => {
    const c = document.getElementById('hs-canvas');
    return [...c.getContext('2d').getImageData(0, 0, c.width, c.height).data].filter((_, i) => i % 97 === 0).join(',');
  });

  // --- 1. the page still scrolls -------------------------------------------
  await fresh();
  const g = await onDesign();
  const frame = await p.evaluate(() => Math.round(document.getElementById('hs-canvas').getBoundingClientRect().width));
  console.log(`\ngrab surface ${g.w}x${g.h}px inside a ${frame}px studio`);
  const y0 = await scrollY();
  const s0 = await snap();
  await swipe(await offDesign(), 0, -260);
  const y1 = await scrollY();
  console.log(`\nswipe off the design: scrollY ${y0} -> ${y1}`);
  y1 > y0 + 100 ? ok('the page scrolled') : fail(`the page did not scroll (${y0} -> ${y1}) — the studio is a dead zone`);
  (await snap()) === s0 ? ok('the design stayed put') : fail('the design moved during a scroll');

  // --- 2. the design drags every direction ---------------------------------
  for (const [name, dx, dy] of [['down', 0, 120], ['up', 0, -120], ['left', -120, 0], ['right', 120, 0], ['diagonal', 85, 85]]) {
    await fresh();
    const from = await onDesign();
    const sy = await scrollY();
    const before = await snap();
    await swipe(from, dx, dy);
    const moved = (await snap()) !== before;
    const drift = Math.abs((await scrollY()) - sy);
    console.log(`drag ${name.padEnd(9)}: design ${moved ? 'moved' : 'DID NOT MOVE'}, page ${drift < 20 ? 'held' : 'SCROLLED ' + drift + 'px'}`);
    if (!moved) fail(`dragging ${name} did not move the design`);
    if (drift >= 20) fail(`dragging ${name} scrolled the page instead`);
  }

  await br.close();
  console.log(bad ? `\n${bad} failure(s)` : '\nthe page scrolls, and the design drags every direction');
  process.exit(bad ? 1 : 0);
})();
