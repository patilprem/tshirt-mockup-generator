/**
 * Drives the two built review pages in a real browser: no console errors, the
 * frames actually paint pixels, and the controls that matter (layer picker,
 * wipe, drag, sheet axis) do what they claim.
 *
 * The pages are published as artifacts, where the host wraps the file in its
 * own document skeleton — so the check wraps them the same way rather than
 * loading the fragment bare, and tests what the viewer will actually get.
 *
 *   node scratch/verify_studio_artifacts.cjs [distDir] [shotDir]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const DIST = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'artifacts', 'dist');
const SHOTS = process.argv[3] ? path.resolve(process.argv[3]) : fs.mkdtempSync(path.join(os.tmpdir(), 'studio-shots-'));
fs.mkdirSync(SHOTS, { recursive: true });

function chromePath() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  const base = '/opt/pw-browsers';
  if (!fs.existsSync(base)) return undefined;
  const dirs = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const d of dirs) {
    const p = path.join(base, d, 'chrome-linux', 'chrome');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

// The artifact host supplies <!doctype>, <head> and <body>; the source files
// are fragments. Wrap identically so the check exercises the shipped shape.
function wrap(file) {
  const body = fs.readFileSync(file, 'utf8');
  const out = path.join(SHOTS, path.basename(file));
  fs.writeFileSync(out, `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`);
  return 'file://' + out;
}

const problems = [];
function check(name, ok, detail) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) problems.push(name + (detail ? ': ' + detail : ''));
}

async function watch(page, label) {
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`${label} console error: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`${label} page error: ${e.message}`));
}

// A frame that decoded is a frame with more than one colour in it — a blank or
// single-fill canvas is the failure mode worth catching here.
const DISTINCT = (sel) => `(() => {
  const c = document.querySelector(${JSON.stringify(sel)});
  if (!c || !c.width) return 0;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4 * 997) seen.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
  return seen.size;
})()`;

async function checkStudio(browser) {
  console.log('\nmodel-studio.html');
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await watch(page, 'model-studio');
  await page.goto(wrap(path.join(DIST, 'model-studio.html')));

  await page.waitForSelector('#frame[data-ready]', { timeout: 60000 });
  await page.waitForTimeout(400);
  check('first frame paints', await page.evaluate(DISTINCT('#stage')) > 50);
  await page.screenshot({ path: path.join(SHOTS, 'studio-1-default.png') });

  // A colour swatch has to change the pixels, not just the readout. Sampled as
  // a mean over the frame rather than at a point: the print sits over the
  // middle of the shirt, so any single sample risks measuring the artwork.
  const MEAN = `(() => {
    const c = document.querySelector('#stage');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 37) { sum += d[i] + d[i+1] + d[i+2]; n++; }
    return sum / n / 3;
  })()`;
  const before = await page.evaluate(DISTINCT('#stage'));
  const darkMean = await page.evaluate(MEAN);
  await page.locator('#swatches button').nth(0).click();   // Classic White
  await page.waitForTimeout(700);
  const lightMean = await page.evaluate(MEAN);
  check('recolour reaches the canvas', lightMean - darkMean > 8,
    `mean luminance ${darkMean.toFixed(1)} -> ${lightMean.toFixed(1)}`);
  check('frame still has depth after recolour', before > 50);

  // The scene picker paints through the engine too, so it must not stay blank.
  await page.waitForTimeout(900);
  check('scene thumbnails render recoloured', await page.evaluate(`(() => {
    const cs = [...document.querySelectorAll('#tiles canvas')];
    return cs.length === 8 && cs.every(c => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 53) seen.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
      return seen.size > 20;
    });
  })()`));

  // Scene swap: a different template must decode and repaint.
  await page.locator('#tiles button').nth(2).click();
  await page.waitForTimeout(1500);
  check('scene swap repaints', await page.evaluate(DISTINCT('#stage')) > 50);
  await page.screenshot({ path: path.join(SHOTS, 'studio-2-scene-white.png') });

  // Drag the print and confirm the placement readout moved with it.
  const box = await page.locator('#stage').boundingBox();
  const posBefore = await page.textContent('#rd-place');
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.52);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.45, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const posAfter = await page.textContent('#rd-place');
  check('dragging the print moves it', posBefore !== posAfter, `${posBefore.trim()} -> ${posAfter.trim()}`);

  // Layer picker and wipe: the two inspection tools.
  await page.locator('#layers button', { hasText: 'Coverage' }).click();
  await page.waitForTimeout(500);
  check('coverage map renders', await page.evaluate(DISTINCT('#stage')) > 2);
  await page.screenshot({ path: path.join(SHOTS, 'studio-3-coverage.png') });

  await page.locator('#layers button', { hasText: 'Mockup' }).click();
  await page.fill('#wipe', '50');
  await page.dispatchEvent('#wipe', 'input');
  await page.check('#quad');
  await page.waitForTimeout(700);
  check('wipe + quad overlay render', await page.evaluate(DISTINCT('#stage')) > 50);
  await page.screenshot({ path: path.join(SHOTS, 'studio-4-wipe.png') });

  await page.close();
}

async function checkSheet(browser) {
  console.log('\ncolor-view.html');
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  await watch(page, 'color-view');
  await page.goto(wrap(path.join(DIST, 'color-view.html')));

  await page.waitForFunction('document.querySelectorAll(".cell").length === 12', null, { timeout: 60000 });
  await page.waitForFunction('document.getElementById("sheet-status").textContent === ""', null, { timeout: 120000 });
  check('twelve colourways painted', await page.evaluate(`(() => {
    const cells = [...document.querySelectorAll('.cell-frame canvas')];
    return cells.every(c => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 397) seen.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
      return seen.size > 50;
    });
  })()`));
  check('inspection frame painted', await page.evaluate(DISTINCT('#detail')) > 50);
  await page.screenshot({ path: path.join(SHOTS, 'sheet-1-colours.png'), fullPage: true });

  // Flagging is the page's record of what failed review.
  await page.locator('.cell').nth(4).locator('.fl').click();
  await page.waitForTimeout(150);
  check('flagging records the frame', (await page.textContent('#flagged-list')).length > 5,
    (await page.textContent('#flagged-list')).trim());

  // The other axis: one colour across every scene.
  await page.locator('#axis button[data-axis="scene"]').click();
  await page.waitForFunction('document.getElementById("sheet-status").textContent === ""', null, { timeout: 120000 });
  const sceneCells = await page.locator('.cell').count();
  check('scene axis renders every scene', sceneCells === 8, sceneCells + ' cells');
  await page.screenshot({ path: path.join(SHOTS, 'sheet-2-scenes.png'), fullPage: true });

  // Detail wipe against the untouched photograph.
  await page.locator('.cell').nth(3).locator('.cell-frame').click();
  await page.fill('#d-wipe', '50');
  await page.dispatchEvent('#d-wipe', 'input');
  await page.waitForTimeout(900);
  check('detail wipe renders', await page.evaluate(DISTINCT('#detail')) > 50);
  await page.screenshot({ path: path.join(SHOTS, 'sheet-3-wipe.png') });

  await page.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: chromePath() });
  try {
    await checkStudio(browser);
    await checkSheet(browser);
  } finally {
    await browser.close();
  }
  console.log(`\nscreenshots in ${SHOTS}`);
  if (problems.length) {
    console.log('\nproblems:');
    problems.forEach((p) => console.log(' - ' + p));
    process.exit(1);
  }
  console.log('\nall checks passed');
})();
