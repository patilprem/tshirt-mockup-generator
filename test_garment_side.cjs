// Exercises the front/back print-side toggle in the editor.
//
// The back assets for crewneck, hoodie, sweatshirt and long sleeve are real,
// shipped PNGs (ready: true in garmentConfigs) — this hits them directly
// rather than standing in for anything. Ladies tee and polo carry a `back`
// entry too, but ready: false (no photo yet) — their config shape and
// placement maths are checked the same way, but the UI toggle is expected to
// stay hidden for them until a photo lands and flips the flag.
//
// What it checks: the toggle appears only where a back view is ready, flipping
// it changes the pixels, each side keeps its own placement across a flip, and
// a garment with no back view (tank top) falls back to the front instead of
// blanking.
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

  await p.goto(BASE + '/editor', { waitUntil: 'networkidle' });
  await sleep(1200);

  console.log('\nside toggle visibility');
  // crewneck, longsleeve, hoodie and sweatshirt ship real back assets; the
  // other four garments have no `back` entry at all.
  const readyCount = await p.evaluate(async () => {
    const m = await import('/src/scripts/flatlay-engine.js');
    return Object.keys(m.garmentConfigs).filter(k => m.hasBackView(k)).length;
  });
  // The default garment on load is the crewneck, which has a ready back view,
  // so the toggle should already be showing.
  const toggleShown = await p.evaluate(() =>
    getComputedStyle(document.getElementById('garment-side-group')).display !== 'none');
  if (readyCount !== 4) fail(`expected 4 ready back views, got ${readyCount}`);
  else if (!toggleShown) fail('toggle hidden for the crewneck, which has a ready back view');
  else ok(`toggle shown with ${readyCount} ready back assets (default garment is crewneck)`);

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
      // The hoodie's back photo measures wider in its 1000x1000 frame than the
      // front (hood spreads out laid flat), so it deliberately overrides
      // pxPerIn rather than inheriting it — every other garment still inherits.
      if (id === 'hoodie') {
        if (view.pxPerIn === front.pxPerIn) out.bad.push(`${id}: back should override pxPerIn but matches the front`);
      } else if (view.pxPerIn !== front.pxPerIn) {
        out.bad.push(`${id}: back did not inherit pxPerIn`);
      }
      if (view.label !== front.label) out.bad.push(`${id}: back did not inherit label`);
      // The back print area has to sit inside the artboard or the design gets
      // clamped against a rect that is partly off-canvas.
      const pa = view.printArea;
      if (pa.x < 0 || pa.y < 0 || pa.x + pa.w > 1000 || pa.y + pa.h > 1000) out.bad.push(`${id}: back print area leaves the 1000x1000 artboard`);
    }
    return out;
  });
  if (cfgCheck.scaffolded.length !== 6) fail(`expected 6 garments with a back entry, got ${cfgCheck.scaffolded.length}: ${cfgCheck.scaffolded}`);
  else ok(`6 garments carry a back entry: ${cfgCheck.scaffolded.join(', ')}`);
  cfgCheck.bad.forEach(fail);
  if (!cfgCheck.bad.length) ok('back views resolve cleanly and inherit the shared fields');

  console.log('\nplacement defaults per side');
  const placeCheck = await p.evaluate(async () => {
    const m = await import('/src/scripts/flatlay-engine.js');
    const out = [];
    // Includes ladies/polo even though their back isn't ready yet — the
    // placement maths only reads garmentConfigs[x].back, not the ready flag,
    // so their provisional numbers should already behave correctly.
    for (const id of ['crewneck', 'hoodie', 'sweatshirt', 'longsleeve', 'ladies', 'polo']) {
      const f = m.centerChestPlacement(id, 'front');
      const b = m.centerChestPlacement(id, 'back');
      const fView = m.garmentView(id, 'front');
      const bView = m.garmentView(id, 'back');
      // A back print is the larger of the two; if they come out identical the
      // side argument is not reaching the maths.
      if (b.scale <= f.scale) out.push(`${id}: back print is not wider than the front (${b.scale} vs ${f.scale})`);
      // A back print area reaches further down the garment than the front's —
      // there's no hem/pocket clearance the way a front chest print has, and
      // it's a bigger design. Its default CENTER isn't reliably lower than the
      // front's, though: unlike a chest logo, a back print area starts right
      // under the collar with no chest-height offset to clear, so a tall back
      // area can have a higher top edge than the front's despite extending
      // further down overall — the bottom edge is the invariant that holds.
      const fBottom = fView.printArea.y + fView.printArea.h;
      const bBottom = bView.printArea.y + bView.printArea.h;
      if (bBottom <= fBottom) out.push(`${id}: back print area does not extend further down the garment than the front's (${bBottom} vs ${fBottom})`);
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

  console.log('\nnot-ready back entries stay hidden');
  // Ladies tee has a `back` entry (provisional printArea, for the placement
  // maths above) but ready: false — no photo yet. The toggle must not appear
  // for it, the same as a garment with no `back` entry at all, or clicking it
  // would 404.
  await p.click('[data-garment="ladies"]');
  await sleep(900);
  const ladiesToggleShown = await p.evaluate(() =>
    getComputedStyle(document.getElementById('garment-side-group')).display !== 'none');
  if (ladiesToggleShown) fail('toggle shown for ladies tee, whose back entry is not ready');
  else ok('toggle stays hidden for a scaffolded-but-not-ready back entry (ladies tee)');

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
