#!/usr/bin/env node
/**
 * Regression check for the analysis extraction.
 *
 * scratch/lib/onmodel-analyze.js was lifted verbatim out of
 * build_on_model_templates.cjs so the video baker could share it. "Verbatim"
 * is a claim, and the way to test it is to re-run the analysis on sources
 * that are already in the manifest and confirm the numbers land where the
 * committed templates.json says they landed.
 *
 * Usage: node scratch/verify_analyze_extraction.cjs [id ...]
 */
const { chromium } = (() => {
  try { return require('playwright'); } catch { return require('playwright-core'); }
})();
const path = require('path');
const fs = require('fs');

const SRC_DIR = path.join(__dirname, 'on-model-src');
const MANIFEST = path.join(__dirname, '..', 'public', 'assets', 'on-model', 'templates.json');
const MAX_EDGE = 1600;
const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const FILES = {
  'gallery-f': 'gallery-f.webp', 'window-f': 'window-f.webp', 'miami-f': 'miami-f.webp',
  'beach-m': 'beach-m.webp', 'park-m': 'park-m.webp', 'street-m': 'street-m.webp',
  'home-f': 'home-f.webp', 'cafe-f': 'cafe-f.webp', 'sky-f': 'sky-f.png',
  'marina-m': 'marina-m.png', 'livingroom-m': 'livingroom-m.webp',
  'bright-airy-f': 'bright-airy-f.webp', 'bright-minimal-m': 'bright-minimal-m.webp',
  'rooftop-hoodie-f': 'rooftop-hoodie-f.png', 'sunbeam-wall-f': 'sunbeam-wall-f.png',
  'tree-lined-f': 'tree-lined-f.png', 'stadium-hoodie-m': 'stadium-hoodie-m.png',
  'garden-path-longsleeve-f': 'garden-path-longsleeve-f.png',
};

const close = (a, b, tol) => Math.abs(a - b) <= tol;

(async () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const want = process.argv.slice(2);
  const targets = manifest.filter(m => !want.length || want.includes(m.id));
  if (!targets.length) { console.error('no matching templates'); process.exit(1); }

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
  await page.addScriptTag({ path: path.join(__dirname, 'lib', 'onmodel-analyze.js') });

  let failures = 0;
  for (const m of targets) {
    const file = FILES[m.id];
    const srcPath = file && path.join(SRC_DIR, file);
    if (!srcPath || !fs.existsSync(srcPath)) { console.log(`${m.id}: no source, skipped`); continue; }
    const b64 = fs.readFileSync(srcPath).toString('base64');
    const srcMime = MIME[path.extname(srcPath).toLowerCase()];
    const r = await page.evaluate(
      args => window.__analyzeOnModel(args),
      { b64, srcMime, MAX_EDGE, dbgPx: [] },
    );
    const bad = [];
    if (r.W !== m.width || r.H !== m.height) bad.push(`size ${r.W}x${r.H} != ${m.width}x${m.height}`);
    for (let i = 0; i < 3; i++) {
      if (!close(r.violetBase[i], m.violetBase[i], 0.05)) bad.push(`violetBase[${i}] ${r.violetBase[i]} != ${m.violetBase[i]}`);
      if (!close(r.ambientTint[i], m.ambientTint[i], 0.0005)) bad.push(`ambientTint[${i}] ${r.ambientTint[i]} != ${m.ambientTint[i]}`);
    }
    for (const corner of ['tl', 'tr', 'br', 'bl']) {
      for (let i = 0; i < 2; i++) {
        if (!close(r.quad[corner][i], m.quad[corner][i], 0.05)) {
          bad.push(`quad.${corner}[${i}] ${r.quad[corner][i]} != ${m.quad[corner][i]}`);
        }
      }
    }
    for (const k of ['x', 'y', 'w', 'h']) {
      if (r.bbox[k] !== m.bbox[k]) bad.push(`bbox.${k} ${r.bbox[k]} != ${m.bbox[k]}`);
    }
    if (bad.length) { failures++; console.log(`${m.id}: MISMATCH\n    ${bad.join('\n    ')}`); }
    else console.log(`${m.id}: match (violetBase ${r.violetBase.join(',')}, quad tl ${r.quad.tl.join(',')})`);
  }
  await browser.close();
  console.log(failures ? `\n${failures} template(s) diverged` : '\nall checked templates reproduce the committed manifest');
  process.exit(failures ? 1 : 0);
})();
