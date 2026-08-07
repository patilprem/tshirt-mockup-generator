/**
 * Drives both built review pages in a real browser: the prompt builds, a real
 * violet-shirt photograph runs the validator end to end, the recolours paint,
 * the hand-over block fills in, and the Colour View shows twelve colourways of
 * a pasted image.
 *
 * The pages are published as artifacts, where the host wraps the file in its
 * own document skeleton — so this wraps them the same way rather than loading
 * the fragment bare, and tests what a viewer will actually get.
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

// A shipped template's own photograph: a model in the vivid-violet crewneck,
// which is exactly what both pages expect to be handed.
const SAMPLE = path.join(ROOT, 'public/assets/on-model/gallery-f-photo.jpg');

// The shipped template whose hem rests on light-wash denim — the shape that drew
// a comb of teeth along the bottom edge of the shirt in every colour, while every
// gate passed it.
const HEM_SAMPLE = path.join(ROOT, 'scratch/on-model-src/bright-airy-f.webp');

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

// A canvas that rendered is a canvas with more than one colour in it.
const DISTINCT = (sel) => `(() => {
  const c = document.querySelector(${JSON.stringify(sel)});
  if (!c || !c.width) return 0;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4 * 997) seen.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
  return seen.size;
})()`;

const MEAN = (sel) => `(() => {
  const c = document.querySelector(${JSON.stringify(sel)});
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4 * 37) { sum += d[i] + d[i+1] + d[i+2]; n++; }
  return sum / n / 3;
})()`;

async function checkStudio(browser) {
  console.log('\ntemplate-studio.html');
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  await watch(page, 'template-studio');
  await page.goto(wrap(path.join(DIST, 'template-studio.html')));

  // Step 1 — the prompt.
  await page.click('#pBuild');
  const prompt = await page.inputValue('#pOut');
  check('prompt builds', prompt.length > 400, prompt.length + ' chars');
  check('prompt keeps the violet rule', /violet/i.test(prompt));
  await page.screenshot({ path: path.join(SHOTS, 'studio-1-prompt.png') });

  // Step 2 — validate a real template photograph.
  await page.setInputFiles('#file', SAMPLE);
  await page.waitForSelector('#valResults:not(.hidden)', { timeout: 120000 });
  await page.waitForTimeout(500);
  const rows = await page.locator('#checks .check').count();
  check('validator runs every gate', rows > 8, rows + ' checks');
  check('verdict is stated', (await page.textContent('#verdict')).trim().length > 3,
    (await page.textContent('#verdict')).trim().split('\n')[0]);
  check('weight map painted', await page.evaluate(DISTINCT('#mapWeight')) > 2);
  check('shade map painted', await page.evaluate(DISTINCT('#mapShade')) > 2);
  await page.screenshot({ path: path.join(SHOTS, 'studio-2-validate.png'), fullPage: true });

  // Step 3 — recolours, which only appear once the image analysed.
  await page.waitForSelector('#tryStep:not(.hidden)', { timeout: 30000 });
  const beforeMean = await page.evaluate(MEAN('#tryCanvas'));
  await page.locator('#trySwatches .sw').nth(1).click();   // near-black
  await page.waitForTimeout(400);
  const afterMean = await page.evaluate(MEAN('#tryCanvas'));
  check('recolour reaches the canvas', beforeMean - afterMean > 8,
    `mean luminance ${beforeMean.toFixed(1)} -> ${afterMean.toFixed(1)}`);

  // Step 4 — the hand-over block.
  await page.click('#mBuild');
  await page.waitForTimeout(300);
  const handover = (await page.textContent('#mOut')).trim();
  check('hand-over instruction fills in', /Add this on-model template/.test(handover));
  check('hand-over carries the measurements', /shirt hue/.test(handover) && /coverage/.test(handover));
  check('hand-over carries the prompt', /photograph|violet/i.test(handover.split('Prompt used:')[1] || ''));
  await page.screenshot({ path: path.join(SHOTS, 'studio-3-ship.png') });

  await page.close();
}

async function checkColourView(browser) {
  console.log('\ntry-colors.html');
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  await watch(page, 'try-colors');
  await page.goto(wrap(path.join(DIST, 'try-colors.html')));

  await page.setInputFiles('#file', SAMPLE);
  await page.waitForSelector('#viewStep:not(.hidden)', { timeout: 120000 });
  await page.waitForTimeout(600);
  check('main frame paints', await page.evaluate(DISTINCT('#mainCanvas')) > 50);
  check('maps paint', await page.evaluate(DISTINCT('#mapClip')) > 2);
  check('measurements listed', (await page.locator('#stats dt').count()) >= 8);

  const cells = await page.locator('.grid-cell').count();
  check('twelve colourways on the sheet', cells === 12, cells + ' cells');
  check('every sheet frame painted', await page.evaluate(`(() => {
    const cs = [...document.querySelectorAll('.grid-cell canvas')];
    return cs.length === 12 && cs.every(c => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 97) seen.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
      return seen.size > 30;
    });
  })()`));
  await page.screenshot({ path: path.join(SHOTS, 'colour-1-sheet.png'), fullPage: true });

  const light = await page.evaluate(MEAN('#mainCanvas'));
  await page.locator('#swatches .sw').nth(1).click();      // Vintage Black
  await page.waitForTimeout(400);
  const dark = await page.evaluate(MEAN('#mainCanvas'));
  check('swatch changes the frame', light - dark > 8,
    `mean luminance ${light.toFixed(1)} -> ${dark.toFixed(1)}`);

  await page.click('#toggleOriginal');
  await page.waitForTimeout(400);
  check('original comparison renders', await page.evaluate(DISTINCT('#mainCanvas')) > 50);
  await page.screenshot({ path: path.join(SHOTS, 'colour-2-original.png') });

  await page.close();
}

// A hem resting on trousers is where this pipeline breaks, and it breaks
// quietly: the shadow the shirt casts drops the violet onto nearly the colour of
// what is under it, the matte reads that shading as coverage, and the recolour
// paints a comb of teeth along the hem in every colour. bright-airy-f is the
// shipped template that exercises it — hem over light-wash denim — and it scored
// 224 px of below-the-hem paint before the matte was taught to tell coverage
// from shading, against 0 after.
//
// Asserted on the CAUSE, not on a picture of the symptom. Boundary roughness and
// phantom-coverage fraction were both tried as detectors and both rank a
// legitimately busy silhouette (a park path, a cluttered room) above a visibly
// broken hem, so neither can carry a threshold. What is checkable is whether
// weight lands on the trousers at all, which is what the defect does.
async function checkHemPaint(browser) {
  console.log('\nhem over trousers (template-studio.html)');
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  await watch(page, 'hem-paint');
  await page.goto(wrap(path.join(DIST, 'template-studio.html')));
  await page.setInputFiles('#file', HEM_SAMPLE);
  await page.waitForSelector('#valResults:not(.hidden)', { timeout: 120000 });
  await page.waitForTimeout(400);

  const row = await page.evaluate(`(() => {
    const el = [...document.querySelectorAll('#checks .check')]
      .find(e => /below the hem/.test(e.textContent));
    return el ? { cls: el.className, num: el.querySelector('.num').textContent.trim() } : null;
  })()`);

  check('the below-the-hem row is present', !!row, row ? row.num : 'row missing');
  if (row) {
    const px = parseInt(row.num, 10);
    check('no weight lands on the trousers under the hem', px < 60, row.num);
  }
  await page.screenshot({ path: path.join(SHOTS, 'hem-paint.png'), fullPage: true });
  await page.close();
}

(async () => {
  for (const f of [SAMPLE, HEM_SAMPLE]) {
    if (!fs.existsSync(f)) {
      console.error('missing sample photograph: ' + f);
      process.exit(1);
    }
  }
  const browser = await chromium.launch({ executablePath: chromePath() });
  try {
    await checkStudio(browser);
    await checkColourView(browser);
    await checkHemPaint(browser);
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
