// The hero is a dead end unless what a visitor arranges there survives the
// click into the editor. This arranges a distinctive state — maroon shirt,
// park-m model, design dragged and resized — hands over, and checks the
// editor continues it rather than opening on its own defaults.
//
// It also checks the hand-off is CLEARED on read: leaving it behind would
// resurrect a stale arrangement on a later visit to /editor.
//
// Needs the dev server: npm run dev, then node test_hero_handoff.cjs
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = process.env.BASE_URL || 'http://localhost:4321';
(async () => {
  const b = await chromium.launch({ headless:true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const p = await b.newPage({ viewport:{width:1440,height:900} });
  p.on('pageerror', e => console.log('  PAGE ERROR:', e.message));
  await p.goto(BASE + '/', { waitUntil:'networkidle' });
  await p.waitForFunction(() => document.getElementById('hero-studio')?.hasAttribute('data-ready'), null, {timeout:20000});
  await sleep(900);

  // pick a distinctive arrangement: maroon shirt, park-m model, design moved
  await p.click('#hs-swatches button[data-c="#7a2733"]'); await sleep(900);
  await p.click('#hs-tiles img[data-id="park-m"]'); await sleep(2500);
  const c = await p.evaluate(() => { const r=document.getElementById('hs-canvas').getBoundingClientRect();
    return {x:r.left+r.width/2, y:r.top+r.height*0.52}; });
  await p.mouse.move(c.x, c.y); await p.mouse.down();
  await p.mouse.move(c.x+46, c.y-30, {steps:8}); await p.mouse.up();
  await sleep(500);

  const sent = await p.evaluate(() => {
    document.getElementById('hero-cta-btn').click();
    return sessionStorage.getItem('teemockup_handoff');
  });
  console.log('handed over:', sent);

  await p.goto(BASE + '/editor', { waitUntil:'networkidle' });
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
  let bad = 0;
  if (got.style !== 'onmodel') { console.log('  FAIL: editor is not in on-model mode'); bad++; }
  if (got.model !== want.template) { console.log(`  FAIL: model ${got.model} != ${want.template}`); bad++; }
  if ((got.hex||'').toLowerCase() !== want.colour.toLowerCase()) { console.log(`  FAIL: colour ${got.hex} != ${want.colour}`); bad++; }
  if (got.left !== null) { console.log('  FAIL: handoff not cleared, a later visit would resurrect it'); bad++; }
  const wantPct = String(Math.round(want.scale*100));
  if (got.size !== wantPct) { console.log(`  FAIL: size ${got.size} != ${wantPct}`); bad++; }
  await p.screenshot({ path: process.env.SHOT || 'hero-handoff.png' });
  await b.close();
  console.log(bad ? `\n${bad} failure(s)` : '\nhand-off carries across');
  process.exit(bad?1:0);
})();
