// The hero is a dead end unless what a visitor arranges there survives the
// click into the editor. Two cases, one per mode, because they carry different
// things: on model carries a template, flat lay carries a garment AND the prop
// arrangement, and the prop half is the part with nothing else watching it.
//
// Both also check the hand-off is CLEARED on read: leaving it behind would
// resurrect a stale arrangement on a later visit to /editor.
//
// Needs the dev server: npm run dev, then node test_hero_handoff.cjs
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = process.env.BASE_URL || 'http://localhost:4321';

let bad = 0;
const fail = msg => { bad++; console.log(`  FAIL: ${msg}`); };

const openHero = async (browser) => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('pageerror', e => console.log('  PAGE ERROR:', e.message));
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.waitForFunction(() => document.getElementById('hero-studio')?.hasAttribute('data-ready'), null, { timeout: 20000 });
  await sleep(900);
  return p;
};

const handOver = p => p.evaluate(() => {
  document.getElementById('hero-cta-btn').click();
  return sessionStorage.getItem('teemockup_handoff');
});

// --- on model ---------------------------------------------------------------
async function onModelCase(browser) {
  console.log('\n=== on model ===');
  const p = await openHero(browser);

  // pick a distinctive arrangement: maroon shirt, park-m model, design moved
  await p.click('#hs-swatches button[data-c="#7a2733"]'); await sleep(900);
  await p.click('#hs-tiles img[data-id="park-m"]'); await sleep(2500);
  const c = await p.evaluate(() => {
    const r = document.getElementById('hs-canvas').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.52 };
  });
  await p.mouse.move(c.x, c.y); await p.mouse.down();
  await p.mouse.move(c.x + 46, c.y - 30, { steps: 8 }); await p.mouse.up();
  await sleep(500);

  const sent = await handOver(p);
  console.log('handed over:', sent);

  await p.goto(BASE + '/editor', { waitUntil: 'networkidle' });
  await sleep(5000);
  const got = await p.evaluate(() => ({
    style: document.querySelector('.app-container')?.dataset.mockupStyle,
    model: document.querySelector('#on-model-selector .on-model-card[aria-pressed="true"]')?.dataset.template,
    hex: document.getElementById('color-hex-label')?.innerText,
    left: sessionStorage.getItem('teemockup_handoff'),
    size: document.getElementById('scale-manual')?.value,
  }));
  console.log('editor opened as:', JSON.stringify(got));

  const want = JSON.parse(sent);
  if (got.style !== 'onmodel') fail('editor is not in on-model mode');
  if (got.model !== want.template) fail(`model ${got.model} != ${want.template}`);
  if ((got.hex || '').toLowerCase() !== want.colour.toLowerCase()) fail(`colour ${got.hex} != ${want.colour}`);
  if (got.left !== null) fail('handoff not cleared, a later visit would resurrect it');
  const wantPct = String(Math.round(want.scale * 100));
  if (got.size !== wantPct) fail(`size ${got.size} != ${wantPct}`);
  await p.screenshot({ path: process.env.SHOT || 'hero-handoff.png' });
  await p.close();
}

// --- flat lay ---------------------------------------------------------------
async function flatLayCase(browser) {
  console.log('\n=== flat lay ===');
  const p = await openHero(browser);

  await p.click('#hs-mode button[data-mode="flatlay"]');
  await p.waitForFunction(() => !document.getElementById('hero-studio').hasAttribute('data-loading'), null, { timeout: 90000 });
  await sleep(1200);

  // A distinctive arrangement the defaults could not produce by accident:
  // olive shirt, tank top, and the plant dragged well off its staged corner.
  await p.click('#hs-swatches button[data-c="#3f4a35"]'); await sleep(700);
  await p.click('#hs-tiles button[data-garment="tanktop"]'); await sleep(4000);

  const box = await p.evaluate(() => {
    const r = document.getElementById('hs-canvas').getBoundingClientRect();
    return { l: r.left, t: r.top, w: r.width, h: r.height };
  });
  // Canvas pixels are artboard units in flat lay, so a point maps straight
  // through the element's own box. The plant is staged at 40,40 at 200x200.
  const at = (x, y) => ({ x: box.l + box.w * (x / 1000), y: box.t + box.h * (y / 1000) });
  const grab = at(140, 140);
  const drop = at(300, 260);
  await p.mouse.move(grab.x, grab.y); await p.mouse.down();
  await p.mouse.move(drop.x, drop.y, { steps: 10 }); await p.mouse.up();
  await sleep(500);

  const sent = await handOver(p);
  console.log('handed over:', sent);
  const want = JSON.parse(sent);

  if (want.style !== 'flatlay') fail(`style ${want.style} != flatlay`);
  if (want.garment !== 'tanktop') fail(`garment ${want.garment} != tanktop`);
  if (!Array.isArray(want.props)) fail('no props in the hand-off');
  const wantPlant = (want.props || []).find(x => x.type === 'plant');
  if (!wantPlant) fail('plant missing from the hand-off');
  for (const t of ['plant', 'shoes', 'hat']) {
    if (!(want.props || []).some(x => x.type === t)) fail(`${t} missing from the hand-off`);
  }
  // The drag has to have actually moved it, or the rest of this proves nothing:
  // a payload that still reads 40,40 would pass a naive equality check against
  // an editor that simply applied its own defaults.
  if (wantPlant && Math.hypot(wantPlant.x - 40, wantPlant.y - 40) < 60) {
    fail(`plant did not move (${wantPlant.x},${wantPlant.y}) — the rest of this case proves nothing`);
  }

  await p.goto(BASE + '/editor', { waitUntil: 'networkidle' });
  await sleep(7000);
  const got = await p.evaluate(() => {
    const active = [...document.querySelectorAll('#props-selector .prop-card.active')].map(c => c.dataset.prop);
    return {
      style: document.querySelector('.app-container')?.dataset.mockupStyle,
      garment: document.querySelector('#garment-selector .garment-card.active')?.dataset.garment,
      hex: document.getElementById('color-hex-label')?.innerText,
      left: sessionStorage.getItem('teemockup_handoff'),
      size: document.getElementById('scale-manual')?.value,
      activeProps: active,
    };
  });
  console.log('editor opened as:', JSON.stringify(got));

  if (got.style !== 'flatlay') fail(`editor is not in flat-lay mode (${got.style})`);
  if (got.garment !== want.garment) fail(`garment ${got.garment} != ${want.garment}`);
  if ((got.hex || '').toLowerCase() !== want.colour.toLowerCase()) fail(`colour ${got.hex} != ${want.colour}`);
  if (got.left !== null) fail('handoff not cleared, a later visit would resurrect it');
  const wantPct = String(Math.round(want.scale * 100));
  if (got.size !== wantPct) fail(`size ${got.size} != ${wantPct}`);
  for (const t of ['plant', 'shoes', 'hat']) {
    if (!got.activeProps.includes(t)) fail(`${t} is not active in the editor`);
  }

  // Positions are not exposed in the DOM, so they are measured off the canvas
  // instead: the prop is where the hero left it only if the editor draws it
  // there. Reading state would not prove that.
  const drawn = await p.evaluate((plant) => {
    const c = document.getElementById('editor-canvas');
    const k = c.width / 1000;
    const x = Math.round((plant.x + plant.w / 2) * k);
    const y = Math.round((plant.y + plant.h / 2) * k);
    const d = c.getContext('2d').getImageData(x - 6, y - 6, 12, 12).data;
    // The plant is strongly green; the backdrop is white wood and the tank is
    // olive, so a green-dominant patch at the handed-over centre is the prop.
    let green = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 1] > d[i] + 18 && d[i + 1] > d[i + 2] + 18) green++;
    }
    return { x, y, green, of: (12 * 12) };
  }, wantPlant);
  console.log(`plant at handed-over centre (${drawn.x},${drawn.y}): ${drawn.green}/${drawn.of} green px`);
  if (drawn.green < drawn.of * 0.5) {
    fail(`the editor did not draw the plant where the hero left it (${drawn.green}/${drawn.of} green)`);
  }

  await p.screenshot({ path: process.env.SHOT_FLAT || 'hero-handoff-flatlay.png' });
  await p.close();
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  await onModelCase(browser);
  await flatLayCase(browser);
  await browser.close();
  console.log(bad ? `\n${bad} failure(s)` : '\nhand-off carries across in both modes');
  process.exit(bad ? 1 : 0);
})();
