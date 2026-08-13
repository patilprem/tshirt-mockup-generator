#!/usr/bin/env node
/**
 * Pack a baked video template down to something a single self-contained page
 * can carry, for the interactive bench.
 *
 * The bake is deliberately fat: photo at JPEG quality 1.0 and full-resolution
 * maps, ~1MB a frame, because it is an intermediate that later stages read.
 * A demo page has to hold the whole clip inline, so this subsamples frames,
 * halves the resolution and re-encodes.
 *
 * What is NOT allowed to degrade is the weight map's channel structure. R, G
 * and B carry three unrelated masks (recolour weight, design clip, own-value
 * blend) and a lossy codec's chroma handling mixes them into each other, so
 * the weight map stays PNG. The photo and shade map are ordinary images and
 * compress as such.
 *
 * Usage: node scratch/make_bench_pack.cjs <bakeDir> <id> <out.json> [width] [stride]
 */
const { chromium } = (() => {
  try { return require('playwright'); } catch { return require('playwright-core'); }
})();
const path = require('path');
const fs = require('fs');

(async () => {
  const [bakeArg, id, outArg, widthArg, strideArg] = process.argv.slice(2);
  if (!bakeArg || !id || !outArg) {
    console.error('usage: node scratch/make_bench_pack.cjs <bakeDir> <id> <out.json> [width] [stride]');
    process.exit(1);
  }
  const bakeDir = path.resolve(bakeArg);
  const outFile = path.resolve(outArg);
  const targetW = Number(widthArg) || 450;
  const stride = Number(strideArg) || 2;
  const manifest = JSON.parse(fs.readFileSync(path.join(bakeDir, `${id}.json`), 'utf8'));

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });

  const k = targetW / manifest.width;
  const targetH = Math.round(manifest.height * k);
  const idx = [];
  for (let i = 0; i < manifest.frames; i += stride) idx.push(i);

  const frames = [];
  for (const i of idx) {
    const f = manifest.frameFiles[i];
    const read = key => fs.readFileSync(path.join(bakeDir, f[key])).toString('base64');
    const r = await page.evaluate(async ({ photo, weight, shade, W, H }) => {
      const load = (mime, b) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = 'data:' + mime + ';base64,' + b; });
      const scale = async (mime, b, type, q) => {
        const im = await load(mime, b);
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const cx = c.getContext('2d');
        cx.imageSmoothingEnabled = true;
        cx.imageSmoothingQuality = 'high';
        cx.drawImage(im, 0, 0, W, H);
        return q ? c.toDataURL(type, q) : c.toDataURL(type);
      };
      return {
        photo: await scale('image/jpeg', photo, 'image/jpeg', 0.82),
        weight: await scale('image/png', weight, 'image/png'),
        shade: await scale('image/jpeg', shade, 'image/jpeg', 0.8),
      };
    }, { photo: read('photo'), weight: read('weight'), shade: read('shade'), W: targetW, H: targetH });

    const q = manifest.quads[i];
    frames.push({
      photo: r.photo, weight: r.weight, shade: r.shade,
      quad: {
        tl: [q.tl[0] * k, q.tl[1] * k], tr: [q.tr[0] * k, q.tr[1] * k],
        br: [q.br[0] * k, q.br[1] * k], bl: [q.bl[0] * k, q.bl[1] * k],
      },
    });
    process.stdout.write(`  ${frames.length}/${idx.length}\r`);
  }

  const pack = {
    id: manifest.id,
    width: targetW, height: targetH,
    fps: (manifest.fps || 12) / stride,
    violetBase: manifest.violetBase,
    ambientTint: manifest.ambientTint,
    relMax: manifest.relMax,
    shirtHue: manifest.shirtHue,
    vRef: manifest.vRef,
    calibratedOnFrame: manifest.calibratedOnFrame,
    qa: manifest.qa,
    frames,
  };
  fs.writeFileSync(outFile, JSON.stringify(pack));
  const mb = (fs.statSync(outFile).size / 1048576).toFixed(2);
  console.log(`\n${frames.length} frames at ${targetW}x${targetH} -> ${outFile} (${mb} MB)`);
  await browser.close();
})();
