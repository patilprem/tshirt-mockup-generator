/**
 * Builds the two standalone review pages in scratch/artifacts:
 *
 *   model-studio.html   one scene at a time, with the maps behind it
 *   color-view.html     a contact sheet of every colourway / every scene
 *
 * Both exist to VALIDATE on-model renders, which is why they run the shipping
 * engine rather than pictures of it: a recolour that goes violet in the
 * shadows, a weight map that bleeds past the garment, a print quad calibrated
 * a few pixels high — none of that shows in a screenshot, and all of it shows
 * here. They are published as artifacts, so they have to be single files with
 * no network access at all: every photograph, map and design below is inlined
 * as a data URI, and the pages work with the tab offline.
 *
 * Usage:
 *   node scratch/build_studio_artifacts.cjs [outDir]
 *
 * Outputs to scratch/artifacts/dist by default. Nothing under dist/ or cache/
 * is committed — the sources here are, and rebuilding is one command.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(__dirname, 'artifacts');
const CACHE = path.join(SRC, 'cache');
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(SRC, 'dist');

// All eight shipped scenes. Validation is exactly the case where the set
// matters more than any one of them: a relight constant that suits a bright
// interior can be wrong outdoors, and only the sheet shows that.
const TEMPLATE_ORDER = [
  'gallery-f', 'street-m', 'miami-f', 'park-m',
  'livingroom-m', 'home-f', 'bright-airy-f', 'bright-minimal-m',
];

// The editor's twelve fabric presets, in the editor's order.
const COLOURS = [
  { hex: '#ffffff', name: 'Classic White' },
  { hex: '#212121', name: 'Vintage Black' },
  { hex: '#afb0b1', name: 'Athletic Heather' },
  { hex: '#373a3c', name: 'Charcoal Grey' },
  { hex: '#1b2230', name: 'Classic Navy' },
  { hex: '#1e3b8a', name: 'Royal Blue' },
  { hex: '#4b533f', name: 'Olive Green' },
  { hex: '#1e3328', name: 'Forest Green' },
  { hex: '#521c22', name: 'Maroon Burgundy' },
  { hex: '#d2c6af', name: 'Sand Beige' },
  { hex: '#f5d5db', name: 'Baby Pink' },
  { hex: '#6b7c85', name: 'Dusty Blue' },
];

// Three prints that fail in three different ways, which is why these three:
// a full-colour raster that arrives opaque and has to be keyed, a solid light
// wordmark that disappears on a pale shirt if the shading passes are too
// strong, and fine line art whose strokes are the first thing a bad multiply
// eats.
const DESIGNS = [
  { id: 'cat', label: 'Full-colour raster', file: 'public/assets/hero/cat.webp' },
  { id: 'wordmark', label: 'Light wordmark', file: 'public/assets/designs/minimal_rose.png' },
  { id: 'lineart', label: 'Fine line art', file: 'public/assets/designs/minimal_mountain.png' },
];

const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

function dataUri(file) {
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
  const mime = MIME[path.extname(abs).toLowerCase()];
  if (!mime) throw new Error('unknown image type: ' + abs);
  return `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
}

function exists(file) {
  return fs.existsSync(path.isAbsolute(file) ? file : path.join(ROOT, file));
}

function chromePath() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  const base = '/opt/pw-browsers';
  if (!fs.existsSync(base)) return undefined;
  const dirs = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort();
  for (const d of dirs.reverse()) {
    const p = path.join(base, d, 'chrome-linux', 'chrome');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

// Four of the eight scenes already have a hero-sized WebP photograph built by
// build_hero_assets.cjs; the other four only exist as ~800 KB JPEGs, which is
// most of a megabyte each inlined. Re-encoding those to WebP through a headless
// Chromium keeps the pages to a few megabytes without touching the maps — the
// photograph is what a viewer looks at, the maps are what the maths reads, and
// only the first can afford lossy treatment.
async function ensurePhotoVariants(metas) {
  const jobs = [];
  for (const meta of metas) {
    const hero = `public/assets/hero/onmodel/${meta.id}-photo.webp`;
    if (exists(hero)) { meta._photoFile = hero; continue; }
    const cached = path.join(CACHE, `${meta.id}-photo.webp`);
    meta._photoFile = cached;
    if (!fs.existsSync(cached)) jobs.push({ from: path.join(ROOT, meta.photo.replace(/^\//, 'public/')), to: cached });
  }
  if (!jobs.length) return;

  fs.mkdirSync(CACHE, { recursive: true });
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: chromePath() });
  const page = await browser.newPage();
  for (const job of jobs) {
    const src = `data:image/jpeg;base64,${fs.readFileSync(job.from).toString('base64')}`;
    const out = await page.evaluate(async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/webp', 0.86);
    }, src);
    fs.writeFileSync(job.to, Buffer.from(out.split(',')[1], 'base64'));
    console.log(`  re-encoded ${path.basename(job.from)} -> ${path.basename(job.to)} ` +
      `(${kb(fs.statSync(job.from).size)} -> ${kb(fs.statSync(job.to).size)})`);
  }
  await browser.close();
}

const kb = (n) => `${Math.round(n / 1024)} KB`;

// A template in miniature: the same three maps at thumbnail size, with the
// print quad scaled to match, so the engine can recolour it exactly as it
// recolours the full frame.
function thumbTemplate(meta) {
  const s = meta.thumbWidth / meta.width;
  const q = meta.quad;
  const pt = (p) => [p[0] * s, p[1] * s];
  return {
    id: meta.id + '@thumb',
    width: meta.thumbWidth,
    height: meta.thumbHeight,
    ambientTint: meta.ambientTint,
    relMax: meta.relMax,
    violetBase: meta.violetBase,
    quad: { tl: pt(q.tl), tr: pt(q.tr), br: pt(q.br), bl: pt(q.bl) },
    photo: dataUri(meta.thumbPhoto.replace(/^\//, 'public/')),
    weight: dataUri(meta.thumbWeight.replace(/^\//, 'public/')),
    shade: dataUri(meta.thumbShade.replace(/^\//, 'public/')),
  };
}

async function main() {
  const templates = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/assets/on-model/templates.json'), 'utf8'));
  const byId = new Map(templates.map((t) => [t.id, t]));
  const metas = TEMPLATE_ORDER.map((id) => {
    const t = byId.get(id);
    if (!t) throw new Error('no such template: ' + id);
    return t;
  });

  console.log('preparing photographs…');
  await ensurePhotoVariants(metas);

  // The weight map is never re-encoded lossily. R, G and B are three separate
  // masks whose exact byte values the relight indexes into; the hero's WebP
  // copy is lossless and asserted sample-identical by its own build script,
  // and where that does not exist the original PNG is inlined untouched.
  const assets = {
    templates: metas.map((meta) => ({
      id: meta.id,
      label: meta.label,
      scene: meta.scene,
      model: meta.model,
      width: meta.width,
      height: meta.height,
      ambientTint: meta.ambientTint,
      relMax: meta.relMax,
      violetBase: meta.violetBase,
      quad: meta.quad,
      photo: dataUri(meta._photoFile),
      weight: dataUri(exists(`public/assets/hero/onmodel/${meta.id}-weight.webp`)
        ? `public/assets/hero/onmodel/${meta.id}-weight.webp`
        : meta.weight.replace(/^\//, 'public/')),
      shade: dataUri(meta.shade.replace(/^\//, 'public/')),
      // The picker's thumbnails are rendered rather than photographed: the
      // shipped thumb maps are a whole template in miniature, so the scene
      // list can show every scene in the colour currently under review, and
      // a thumbnail that comes out wrong is itself a finding.
      thumbTpl: thumbTemplate(meta),
    })),
    colours: COLOURS,
    designs: DESIGNS.map((d) => ({ id: d.id, label: d.label, src: dataUri(d.file) })),
  };

  const bundle = 'window.STUDIO_ASSETS = ' + JSON.stringify(assets) + ';';
  const style = fs.readFileSync(path.join(SRC, 'studio.css'), 'utf8');
  const engine = fs.readFileSync(path.join(SRC, 'onmodel-inline.js'), 'utf8');

  fs.mkdirSync(OUT, { recursive: true });
  for (const page of ['model-studio.html', 'color-view.html']) {
    let html = fs.readFileSync(path.join(SRC, page), 'utf8');
    for (const [marker, body] of [['/*__STYLE__*/', style], ['/*__ENGINE__*/', engine], ['/*__ASSETS__*/', bundle]]) {
      if (!html.includes(marker)) throw new Error(`${page} is missing ${marker}`);
      html = html.replace(marker, () => body);
    }
    const dest = path.join(OUT, page);
    fs.writeFileSync(dest, html);
    console.log(`wrote ${path.relative(ROOT, dest)} (${kb(Buffer.byteLength(html))})`);
  }

  console.log(`\n${assets.templates.length} scenes · ${assets.colours.length} colourways · ${assets.designs.length} designs`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
