// Render every shipped template against the colours the site actually sells,
// through the real runtime, and emit the thumbnails as JSON for the QA sheet.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = '/home/user/tshirt-mockup-generator';
const DIR = path.join(ROOT, 'public/assets/on-model');
const ENGINE = fs.readFileSync(path.join(ROOT, 'src/scripts/onmodel-engine.js'), 'utf8')
  .replace(/^export /gm, '');

const COLOURS = [
  ['Classic White', '#ffffff'],
  ['Vintage Black', '#212121'],
  ['Athletic Heather', '#afb0b1'],
  ['Classic Navy', '#1b2230'],
  ['Baby Pink', '#f5d5db'],
  ['Sand Beige', '#d2c6af'],
];
const THUMB_W = 300;

(async () => {
  const metas = JSON.parse(fs.readFileSync(path.join(DIR, 'templates.json'), 'utf8'));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await page.setContent(`<script>${ENGINE}<` + `/script>`);

  const out = [];
  for (const m of metas) {
    const b64 = (f) => fs.readFileSync(path.join(DIR, f)).toString('base64');
    const cells = await page.evaluate(async ({ meta, photo, weight, shade, colours, TW }) => {
      meta = JSON.parse(JSON.stringify(meta));
      meta.photo = 'data:image/jpeg;base64,' + photo;
      meta.weight = 'data:image/png;base64,' + weight;
      meta.shade = 'data:image/jpeg;base64,' + shade;
      onModelCache.clear();
      const e = await loadOnModelTemplate(meta);
      const res = [];
      for (const [, hex] of colours) {
        const c = buildOnModelComposed(e, hex);
        const o = document.createElement('canvas');
        o.width = TW; o.height = Math.round(c.height * TW / c.width);
        const g = o.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(c, 0, 0, o.width, o.height);
        res.push(o.toDataURL('image/jpeg', 0.78));
      }
      return res;
    }, { meta: m, photo: b64(`${m.id}-photo.jpg`), weight: b64(`${m.id}-weight.png`),
         shade: b64(`${m.id}-shade.jpg`), colours: COLOURS, TW: THUMB_W });
    out.push({ id: m.id, label: m.label, scene: m.scene, model: m.model, cells });
    console.log(`${m.id} ${cells.length} cells  ${(cells.reduce((a, c) => a + c.length, 0) / 1024).toFixed(0)}KB`);
  }
  fs.writeFileSync(path.join(__dirname, 'sheet-data.json'),
    JSON.stringify({ colours: COLOURS, templates: out }));
  console.log(`\n${out.length} templates x ${COLOURS.length} colours -> sheet-data.json`);
  await browser.close();
})();
