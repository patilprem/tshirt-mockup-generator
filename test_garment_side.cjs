// Exercises the front/back print-side toggle in the editor.
//
// The back assets are not in the repo yet, so this test manufactures one: it
// mirrors a front PNG vertically and writes it to the path the config expects,
// then flips the config's `ready` flag in the built bundle is NOT possible, so
// instead it drives the toggle through the module's own exports via the page.
//
// What it is actually checking is the wiring, not the artwork — that the
// toggle appears only where a back view exists, that flipping it changes the
// pixels, that each side keeps its own placement across a flip, and that a
// garment with no back view falls back to the front instead of blanking.
//
// Needs the dev server: npm run dev, then node test_garment_side.cjs
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = process.env.BASE_URL || 'http://localhost:4321';
let bad = 0;
const fail = m => { bad++; console.log('  FAIL: ' + m); };
const ok = m => console.log('  ok: ' + m);

const shot = p => p.evaluate(() => {
  const c = document.getElementById('editor-canvas');
  return [...c.getContext('2d').getImageData(0, 0, c.width, c.height).data];
});
const diff = (a, b) => {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++;
  }
  return n;
};

(async () => {
  const br = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const p = await br.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('pageerror', e => fail('PAGE ERROR: ' + e.message));

  // Serve a stand-in back asset for the four scaffolded garments by mirroring
  // the front one. Route interception rather than files on disk, so the repo
  // stays free of placeholder art that could be mistaken for the real thing.
  const BACKS = {
    '/assets/processed/tshirt_flatlay_back.png': '/assets/processed/tshirt_flatlay.png',
    '/assets/processed/tshirt_hoodie_back.png': '/assets/processed/tshirt_hoodie.png',
    '/assets/processed/tshirt_sweatshirt_back.png': '/assets/processed/tshirt_sweatshirt.png',
    '/assets/processed/tshirt_longsleeve_back.png': '/assets/processed/tshirt_longsleeve.png',
  };
  for (const [backPath, frontPath] of Object.entries(BACKS)) {
    await p.route(BASE + backPath, async route => {
      const res = await p.request.get(BASE + frontPath);
      route.fulfill({ status: 200, contentType: 'image/png', body: await res.body() });
    });
  }

  await p.goto(BASE + '/editor', { waitUntil: 'networkidle' });
  await sleep(1200);

  console.log('\nside toggle visibility');
  // Every garment ships with `ready: false` today, so the toggle is hidden.
  // That IS the shipped behaviour and worth asserting: a visible toggle with no
  // asset behind it would 404 on click.
  const readyCount = await p.evaluate(async () => {
    const m = await import('/src/scripts/flatlay-engine.js');
    return Object.keys(m.garmentConfigs).filter(k => m.hasBackView(k)).length;
  });
  const toggleShown = await p.evaluate(() =>
    getComputedStyle(document.getElementById('garment-side-group')).display !== 'none');
  if (readyCount === 0 && toggleShown) fail('toggle visible while no garment has a ready back asset');
  else ok(`toggle hidden with ${readyCount} ready back assets`);

  console.log('\nconfig shape');
  const cfgCheck = await p.evaluate(async () => {
    const m = await import('/src/scripts/flatlay-engine.js');
    const out = { scaffolded: [], bad: [] };
    for (const [id, cfg] of Object.entries(m.garmentConfigs)) {
      if (!cfg.back) continue;
      out.scaffolded.push(id);
      const view = m.garmentView(id, 'back');
      const front = m.garmentView(id, 'front');
      // A resolved view must be a plain garment config: no nested sides left on
      // it, the back's own photograph and rect, and everything it did not
      // override inherited from the base rather than dropped.
      if (view.back || view.ready) out.bad.push(`${id}: resolved view still carries side keys`);
      if (view.path === front.path) out.bad.push(`${id}: back view reuses the front photograph`);
      if (JSON.stringify(view.printArea) === JSON.stringify(front.printArea)) out.bad.push(`${id}: back reuses the front print area`);
      if (view.yFlat !== front.yFlat) out.bad.push(`${id}: back did not inherit yFlat`);
      if (view.pxPerIn !== front.pxPerIn) out.bad.push(`${id}: back did not inherit pxPerIn`);
      if (view.label !== front.label) out.bad.push(`${id}: back did not inherit label`);
      // The back print area has to sit inside the artboard or the design gets
      // clamped against a rect that is partly off-canvas.
      const pa = view.printArea;
      if (pa.x < 0 || pa.y < 0 || pa.x + pa.w > 1000 || pa.y + pa.h > 1000) out.bad.push(`${id}: back print area leaves the 1000x1000 artboard`);
    }
    return out;
  });
  if (cfgCheck.scaffolded.length !== 4) fail(`expected 4 scaffolded garments, got ${cfgCheck.scaffolded.length}: ${cfgCheck.scaffolded}`);
  else ok(`4 garments scaffolded: ${cfgCheck.scaffolded.join(', ')}`);
  cfgCheck.bad.forEach(fail);
  if (!cfgCheck.bad.length) ok('back views resolve cleanly and inherit the shared fields');

  console.log('\nplacement defaults per side');
  const placeCheck = await p.evaluate(async () => {
    const m = await import('/src/scripts/flatlay-engine.js');
    const out = [];
    for (const id of ['crewneck', 'hoodie', 'sweatshirt', 'longsleeve']) {
      const f = m.centerChestPlacement(id, 'front');
      const b = m.centerChestPlacement(id, 'back');
      // A back print is the larger of the two and hangs lower; if they come out
      // identical the side argument is not reaching the maths.
      if (b.scale <= f.scale) out.push(`${id}: back print is not wider than the front (${b.scale} vs ${f.scale})`);
      if (b.pos.y <= f.pos.y) out.push(`${id}: back print does not sit below the front (${b.pos.y} vs ${f.pos.y})`);
      // And a placement must survive the round trip through relative space.
      const rel = m.placementToRelative(b.pos, b.scale, id, 'back');
      const rt = m.placementFromRelative(rel, id, 'back');
      if (Math.abs(rt.pos.x - b.pos.x) > 0.5 || Math.abs(rt.pos.y - b.pos.y) > 0.5) {
        out.push(`${id}: back placement does not survive the relative round trip`);
      }
    }
    return out;
  });
  placeCheck.forEach(fail);
  if (!placeCheck.length) ok('back defaults are wider, lower, and round-trip through relative space');

  console.log('\nlive toggle behaviour');
  // Force the four scaffolded garments ready so the toggle can actually be
  // driven, standing in for the commit that lands the real PNGs.
  await p.evaluate(async () => {
    const m = await import('/src/scripts/flatlay-engine.js');
    for (const cfg of Object.values(m.garmentConfigs)) if (cfg.back) cfg.back.ready = true;
  });

  // Re-select the crewneck so syncSideToggle runs with the flags now set.
  await p.click('[data-garment="hoodie"]');
  await sleep(900);
  const shownForHoodie = await p.evaluate(() =>
    getComputedStyle(document.getElementById('garment-side-group')).display !== 'none');
  if (!shownForHoodie) fail('toggle stayed hidden for a garment with a ready back view');
  else ok('toggle appears for a garment with a ready back view');

  const frontShot = await shot(p);
  await p.click('#garment-side-toggle [data-side="back"]');
  await sleep(1200);

  const activeIsBack = await p.evaluate(() =>
    document.querySelector('#garment-side-toggle .style-btn.active')?.dataset.side);
  if (activeIsBack !== 'back') fail(`toggle did not move to back (active=${activeIsBack})`);
  else ok('toggle reports back as active');

  const backShot = await shot(p);
  const changed = diff(frontShot, backShot);
  if (changed < 500) fail(`flipping to back barely changed the canvas (${changed} px)`);
  else ok(`flipping to back redrew the canvas (${changed} px changed)`);

  console.log('\nper-side placement memory');
  // Move the back design somewhere distinctive, flip away, flip back.
  await p.evaluate(() => {
    const s = document.getElementById('scale-slider');
    s.value = 62;
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(500);
  const backScale = await p.evaluate(() => +document.getElementById('scale-slider').value);

  await p.click('#garment-side-toggle [data-side="front"]');
  await sleep(1000);
  const frontScale = await p.evaluate(() => +document.getElementById('scale-slider').value);
  if (frontScale === backScale) fail('front inherited the back size instead of keeping its own');
  else ok(`front kept its own size (${frontScale}) after the back was set to ${backScale}`);

  await p.click('#garment-side-toggle [data-side="back"]');
  await sleep(1000);
  const backScaleAgain = await p.evaluate(() => +document.getElementById('scale-slider').value);
  if (backScaleAgain !== backScale) fail(`back lost its placement across a flip (${backScaleAgain}, expected ${backScale})`);
  else ok('back placement survived a round trip through the front');

  console.log('\nfallback for garments with no back view');
  // Tank top has no back entry at all. Selecting it while the back is showing
  // must land on its front, not on a 404 or an empty artboard.
  await p.click('[data-garment="tanktop"]');
  await sleep(1200);
  const afterTank = await p.evaluate(() => ({
    toggleShown: getComputedStyle(document.getElementById('garment-side-group')).display !== 'none',
    active: document.querySelector('#garment-side-toggle .style-btn.active')?.dataset.side,
  }));
  if (afterTank.toggleShown) fail('toggle shown for tank top, which has no back view');
  else ok('toggle hidden again for a garment with no back view');
  if (afterTank.active !== 'front') fail(`tank top did not fall back to the front (active=${afterTank.active})`);
  else ok('tank top fell back to the front');

  const tankShot = await shot(p);
  const tankNonEmpty = tankShot.some((v, i) => i % 4 === 3 && v > 0);
  if (!tankNonEmpty) fail('tank top rendered an empty artboard after the fallback');
  else ok('tank top rendered a garment after the fallback');

  console.log(bad ? `\n${bad} FAILURE(S)` : '\nall passed');
  await br.close();
  process.exit(bad ? 1 : 0);
})();
