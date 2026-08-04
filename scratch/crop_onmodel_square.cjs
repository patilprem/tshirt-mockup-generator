// Crop on-model mockup renders to 1:1, exactly as the editor's 1:1 preset does.
//
// The preset is not a centre crop. It takes the largest square that fits the
// template photo and centres it on that template's PRINT QUAD, then clamps it
// inside the image — so the design sits where a listing wants it and the crop
// lands differently for every model. Reproducing that here means knowing which
// template a render came from, so each input is matched against the template
// photos by pixel comparison rather than by filename, which cannot be trusted
// to say where an exported image came from.
//
// Rendering goes through headless Chromium's canvas: same drawImage the editor
// uses, and no image library to add to the project for a one-off asset step.
//
//   node scratch/crop_onmodel_square.cjs <in-dir> <out-dir>
//
// Writes <out-dir>/<template-id>-<n>.jpg, square, at the source's own pixels.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const inDir = process.argv[2];
const outDir = process.argv[3] || 'public/assets/gallery';
if (!inDir) {
  console.error('usage: node scratch/crop_onmodel_square.cjs <in-dir> [out-dir]');
  process.exit(1);
}

const templates = JSON.parse(fs.readFileSync('public/assets/on-model/templates.json', 'utf8'));

// The 1:1 crop rect for a template, in its own pixel space. Mirrors
// onModelCropRect in Editor.astro for a 1:1 ratio: largest square that fits,
// centred on the quad, clamped so it stays inside the photo.
function squareCrop(t) {
  const q = t.quad;
  const qcy = (q.tl[1] + q.tr[1] + q.br[1] + q.bl[1]) / 4;
  const qcx = (q.tl[0] + q.tr[0] + q.br[0] + q.bl[0]) / 4;
  const side = Math.min(t.width, t.height);
  const clamp = (v, hi) => Math.max(0, Math.min(v, hi));
  return {
    x: clamp(qcx - side / 2, t.width - side),
    y: clamp(qcy - side / 2, t.height - side),
    side,
  };
}

const dataUri = (p) => {
  const ext = path.extname(p).slice(1).toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
};

(async () => {
  const files = fs.readdirSync(inDir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
  if (!files.length) {
    console.error(`no images in ${inDir}`);
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  const page = await browser.newPage();
  await page.goto('about:blank');

  // Reference thumbnails of every template photo, for matching.
  const refs = [];
  for (const t of templates) {
    refs.push({ id: t.id, uri: dataUri(path.join('public', t.photo)) });
  }

  const seen = {};
  for (const file of files) {
    const src = path.join(inDir, file);
    const result = await page.evaluate(async ([uri, refs]) => {
      const load = (u) => new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('load failed'));
        i.src = u;
      });
      // Everything compared at one small size, so a render and its template
      // line up regardless of what resolution either happens to be.
      const N = 48;
      const grid = (img) => {
        const c = document.createElement('canvas');
        c.width = N; c.height = N;
        const cx = c.getContext('2d');
        cx.drawImage(img, 0, 0, N, N);
        return cx.getImageData(0, 0, N, N).data;
      };
      const img = await load(uri);
      const a = grid(img);
      let best = null;
      for (const r of refs) {
        const b = grid(await load(r.uri));
        let diff = 0;
        for (let i = 0; i < N * N; i++) {
          for (let ch = 0; ch < 3; ch++) diff += Math.abs(a[i * 4 + ch] - b[i * 4 + ch]);
        }
        const score = diff / (N * N * 3);
        if (!best || score < best.score) best = { id: r.id, score };
      }
      return { w: img.width, h: img.height, best };
    }, [dataUri(src), refs]);

    const t = templates.find((x) => x.id === result.best.id);
    const crop = squareCrop(t);
    // The render may be a different size to the template it came from; the
    // crop is expressed as a fraction so it survives that.
    const sx = result.w / t.width, sy = result.h / t.height;
    const rect = {
      x: Math.round(crop.x * sx),
      y: Math.round(crop.y * sy),
      w: Math.round(crop.side * sx),
      h: Math.round(crop.side * sy),
    };
    // Square in the OUTPUT even if the source aspect drifted a little from the
    // template's: the preset's promise is a 1:1 file.
    const side = Math.min(rect.w, rect.h);

    const out = await page.evaluate(async ([uri, rect, side]) => {
      const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = uri; });
      const c = document.createElement('canvas');
      c.width = side; c.height = side;
      const cx = c.getContext('2d');
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(img, rect.x, rect.y, side, side, 0, 0, side, side);
      return c.toDataURL('image/jpeg', 0.9);
    }, [dataUri(src), rect, side]);

    seen[t.id] = (seen[t.id] || 0) + 1;
    const name = seen[t.id] > 1 ? `onmodel_${t.id}_${seen[t.id]}.jpg` : `onmodel_${t.id}.jpg`;
    fs.writeFileSync(path.join(outDir, name), Buffer.from(out.split(',')[1], 'base64'));
    const flag = result.best.score > 40 ? '  <-- WEAK MATCH, check this one' : '';
    console.log(
      `${file}  ${result.w}x${result.h}  ->  ${t.id} (diff ${result.best.score.toFixed(1)})` +
      `  crop y=${rect.y} ${side}x${side}  ->  ${name}${flag}`
    );
  }

  await browser.close();
})();
