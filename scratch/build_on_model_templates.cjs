#!/usr/bin/env node
/**
 * Precompute on-model mockup templates.
 *
 * Each source photo is a model wearing a plain vivid-violet crewneck (see
 * MODEL-TEMPLATE-GUIDE for how they're generated). This script analyses each
 * photo once, offline, and emits three flat images plus metadata:
 *
 *   <id>-photo.jpg   the photograph itself, untouched except that violet
 *                    residue in deep dark creases is pre-neutralised toward
 *                    grey (their final look shouldn't depend on the target
 *                    colour anyway, and it stops a violet cast surviving there)
 *   <id>-weight.png  R: per-pixel shirt weight w — how much of this pixel's
 *                       light came from the violet fabric (soft, 0..1)
 *                    G: solid garment coverage, used only to clip the printed
 *                       design so it doesn't spill onto skin or background
 *                    B: own-value blend — which violet the runtime subtracts
 *                       here, the modelled violet (0) or this pixel's own
 *                       value (1). Driven by how much colour information the
 *                       pixel carries, so an information-free crease blends
 *                       between itself and the target instead of having
 *                       saturated modelled violet subtracted out of it.
 *                       Kept separate from G on purpose: coverage and
 *                       information content are unrelated questions, and
 *                       conflating them is what put green blotches in
 *                       underarm creases.
 *   <id>-shade.jpg   illumination relative to the fabric's diffuse white
 *                    point, encoded as rel/REL_MAX
 *
 * The runtime never cuts the garment out. It recolours in place:
 *
 *   out = photo + w * (T(shade) - V(shade))
 *
 * where T relights the target colour and V relights the shirt's own violet
 * through the same model. On pure fabric photo ≈ V, so out ≈ T with the
 * photograph's grain riding along as detail. On a boundary pixel that holds
 * half shirt and half background, only the shirt half moves and the real
 * background half stays untouched — which is why the failure modes of
 * cut-and-composite (dark rims, pale halos, alpha steps, matte holes showing
 * a reconstructed plate) cannot occur here: there is no matte and no plate.
 *
 * Usage: node scratch/build_on_model_templates.cjs
 */
// playwright proper is the repo dependency; a checkout without an npm install
// can still reach the same chromium launcher through playwright-core.
const { chromium } = (() => {
  try { return require('playwright'); } catch { return require('playwright-core'); }
})();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Everything under public/ is copied to the site verbatim, so an asset keeps
// its filename forever and only its bytes change between builds. A browser or
// CDN holding the old copy has nothing to tell it otherwise, and serves it —
// which is how a fix that is merged, deployed and correct still shows the old
// picture on someone's phone. Tagging each URL with a hash of its content makes
// the URL change whenever the bytes do, so a stale copy can never be selected.
const version = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 8);

const SRC_DIR = process.env.ON_MODEL_SRC || path.join(__dirname, 'on-model-src');
const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'on-model');
const META_OUT = path.join(OUT_DIR, 'templates.json');
const MAX_EDGE = 1600;

const TEMPLATES = [
  { id: 'window-f', file: 'window-f.webp', label: 'Window Light', model: 'female', scene: 'Tall window, sheer curtain' },
  { id: 'gallery-f', file: 'gallery-f.webp', label: 'Gallery Interior', model: 'female', scene: 'Minimal off-white interior' },
  { id: 'livingroom-m', file: 'livingroom-m.webp', label: 'Living Room', model: 'male', scene: 'Bright airy living room' },
  { id: 'street-m', file: 'street-m.webp', label: 'Urban Street', model: 'male', scene: 'Sunlit pavement outside a cafe' },
  { id: 'park-m', file: 'park-m.webp', label: 'Park Path', model: 'male', scene: 'Green park path, open shade' },
  { id: 'home-f', file: 'home-f.webp', label: 'Cozy Home', model: 'female', scene: 'home indoor' },
  { id: 'bright-airy-f', file: 'bright-airy-f.webp', label: 'Bright Airy', model: 'female', scene: 'Bright airy coffee shop, pale wood' },
  { id: 'miami-f', file: 'miami-f.webp', label: 'Miami Street', model: 'female', scene: 'palm-lined street' },
  { id: 'bright-minimal-m', file: 'bright-minimal-m.webp', label: 'Bright Minimal', model: 'male', scene: 'Bright minimal grey walls, soft daylight' },
  { id: 'cafe-f', file: 'cafe-f.webp', label: 'Cafe Counter', model: 'female', scene: 'Bright cafe, window light, barista counter behind' },
  { id: 'beach-m', file: 'beach-m.webp', label: 'Beach', model: 'male', scene: 'Sandy beach, open sky, sea behind' },
  { id: 'marina-m', file: 'marina-m.png', label: 'Marina', model: 'male', scene: 'Marina railing, boats and open water' },
  { id: 'sky-f', file: 'sky-f.png', label: 'Open Sky', model: 'female', scene: 'Open pale sky, soft daylight' },
  { id: 'rooftop-hoodie-f', file: 'rooftop-hoodie-f.png', label: 'Rooftop Hoodie', model: 'female', scene: 'Rooftop skyline, overcast light' },
  { id: 'sunbeam-wall-f', file: 'sunbeam-wall-f.png', label: 'Sunbeam Wall', model: 'female', scene: 'Warm plaster wall, diagonal light beam' },
  { id: 'tree-lined-f', file: 'tree-lined-f.png', label: 'Tree-Lined Street', model: 'female', scene: 'Leafy residential street' },
  { id: 'stadium-hoodie-m', file: 'stadium-hoodie-m.png', label: 'Stadium Hoodie', model: 'male', scene: 'Empty stadium seating, pitch behind' },
  { id: 'garden-path-longsleeve-f', file: 'garden-path-longsleeve-f.png', label: 'Garden Path', model: 'female', scene: 'Leafy garden path, soft even light' },
];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
  // The analysis itself lives in scratch/lib/onmodel-analyze.js, shared with
  // the video baker so both run the identical mask maths.
  await page.addScriptTag({ path: path.join(__dirname, 'lib', 'onmodel-analyze.js') });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const manifest = [];

  for (const tpl of TEMPLATES) {
    const srcPath = path.join(SRC_DIR, tpl.file);
    if (!fs.existsSync(srcPath)) { console.error(`  ! missing ${srcPath}`); continue; }
    // The data: URL carries the MIME the decoder is handed, so it has to match
    // the bytes. Sources were all webp when this was written; a raw generation
    // arrives as png or jpg, and re-encoding one to webp to satisfy a hardcoded
    // string would resample the silhouette — the exact pixels the edge checks
    // measure. Read the type off the extension and leave the file alone.
    const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
    const srcMime = MIME[path.extname(srcPath).toLowerCase()];
    if (!srcMime) { console.error(`  ! ${tpl.file}: unsupported source type`); continue; }
    const b64 = fs.readFileSync(srcPath).toString('base64');
    process.stdout.write(`${tpl.id} ... `);

    const dbgPx = (tpl.id === process.env.DBG_ID && process.env.DBG_PX)
      ? process.env.DBG_PX.split(';').map(t => t.split(',').map(Number)) : [];
    const r = await page.evaluate(
      args => window.__analyzeOnModel(args),
      { b64, srcMime, MAX_EDGE, dbgPx },
    );
    if (r.dbg && r.dbg.length) console.log('\nDBG', JSON.stringify(r.dbg, null, 1));

    // QA gate, mechanising the guide's "no hard shadow band" rule. A garment
    // whose deep-shadow fraction is this high has a broad near-black band that
    // no recolour can make look right on a pale target — the photo needs
    // regenerating with softer light, not more pipeline work.
    if (r.qa.deepShadowPct > 8) {
      console.log(`${r.W}x${r.H} deepShadow=${r.qa.deepShadowPct}% — FAILS QA (hard shadow band), excluded from manifest`);
      continue;
    }
    // Chroma in an information-free crease means the modelled violet is not
    // cancelling — the defect class that shipped green underarms. It is a
    // build error rather than a bad photograph, so this fails loudly instead
    // of quietly dropping the template: a source that trips it will trip it
    // again next build, and silently shipping four templates instead of five
    // is how the last one went unnoticed.
    if (r.qa.chromaPct > 0.1) {
      console.error(`${r.W}x${r.H} chroma=${r.qa.chromaPct}% worst=${r.qa.chromaWorst} — FAILS QA`);
      console.error('  Information-free garment pixels are rendering chromatic under a white shirt.');
      console.error('  That is modelled violet failing to cancel, not a property of the photo.');
      console.error('  Check the own-value blend (weight map B channel) before shipping.');
      process.exitCode = 1;
      continue;
    }
    if (r.qa.chromaPct > 0.03) {
      console.log(`  ! chroma=${r.qa.chromaPct}% worst=${r.qa.chromaWorst} — above the warn line, inspect white before shipping`);
    }

    // Chroma key left unrecoloured. Unlike the deep-shadow gate this is not a
    // property of the photo to be reshot — it is the pipeline failing to key
    // fabric it had the evidence to key, and it shows as a coloured stripe of
    // the ORIGINAL violet wherever the garment is shadowed by something dark:
    // the collar under hair, the inside of an elbow. It is invisible on a
    // violet or navy target and obvious on pink or white, so a build cannot
    // be trusted without it. Measured against the same evidence the recolour
    // uses, so it fails only where the floor deliberately yields — a
    // confident matte against a bright background — which is the case worth
    // being told about. Every shipping template scores <= 42 with the
    // ordering backstop in place; with it removed bright-airy-f scores 848
    // and livingroom-m 144. The lines sit between those.
    if (r.qa.keyMiss > 120) {
      console.error(`${r.W}x${r.H} keyMiss=${r.qa.keyMiss} — FAILS QA`);
      console.error('  Saturated violet fabric next to the garment is staying unrecoloured.');
      console.error('  It will read as a coloured stripe on pink and white targets.');
      console.error('  Check the ordering floor and the matte confidence before shipping.');
      process.exitCode = 1;
      continue;
    }
    if (r.qa.keyMiss > 60) {
      console.log(`  ! keyMiss=${r.qa.keyMiss} — above the warn line, inspect pink at the collar and underarm`);
    }

    // The mirror of keyMiss: something that is not the garment being painted
    // with it. Dark denim under the hem is the case that motivated it — the
    // waistband came out white on a white shirt. The lines sit above a noise
    // floor rather than at zero: near-black pixels carry a few levels of
    // chroma noise, so a clean template still scores in the low hundreds
    // (bright-airy-f 222, whose two hem pixels are correct on inspection),
    // while miami-f scored 3174 with a genuinely painted waistband.
    if (r.qa.coolPaint > 600) {
      console.error(`${r.W}x${r.H} coolPaint=${r.qa.coolPaint} — FAILS QA`);
      console.error('  Dark blue or black pixels below the garment are being recoloured.');
      console.error('  Usually jeans or a waistband taking weight the shirt diffused into them.');
      console.error('  Check the unrel chroma directions and the harmonic completion.');
      process.exitCode = 1;
      continue;
    }
    if (r.qa.coolPaint > 250) {
      console.log(`  ! coolPaint=${r.qa.coolPaint} — above the warn line, inspect the hem and waistband on white`);
    }

    // The edge audit stays INFORMATIONAL. It was briefly gated, on the reasoning
    // that an unenforced number is how a broken hem reaches the manifest — but
    // the number it gated was mis-specified: it judged every pixel against the
    // background's luminance, including the ones the runtime blends from the
    // photograph, where a kept hem shadow reads as an excursion. Corrected (see
    // the audit itself), it is a true statement about a narrow class and reads
    // ~0 on every template here, so gating it would assure rather than protect.
    //
    // The defect it was reached for — a comb of teeth along a hem, from the
    // matte reading shaded trousers as coverage — has no global scalar that
    // separates it from a legitimately busy silhouette: boundary roughness and
    // phantom-coverage fraction were both tried and both rank clean templates
    // above a visibly broken one. That class is prevented at source instead, in
    // the matte's confidence, and checked by eye.

    fs.writeFileSync(path.join(OUT_DIR, `${tpl.id}-photo.jpg`), Buffer.from(r.photo.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT_DIR, `${tpl.id}-weight.png`), Buffer.from(r.weight.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT_DIR, `${tpl.id}-shade.jpg`), Buffer.from(r.shade.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT_DIR, `${tpl.id}-thumb-photo.jpg`), Buffer.from(r.thumbPhoto.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT_DIR, `${tpl.id}-thumb-weight.png`), Buffer.from(r.thumbWeight.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT_DIR, `${tpl.id}-thumb-shade.jpg`), Buffer.from(r.thumbShade.split(',')[1], 'base64'));

    // ?v= a hash of the file's own bytes: same content, same URL, so nothing is
    // re-downloaded needlessly; changed content, changed URL, so nothing stale
    // can be served.
    const asset = (name) =>
      `/assets/on-model/${name}?v=${version(path.join(OUT_DIR, name))}`;

    manifest.push({
      id: tpl.id, label: tpl.label, model: tpl.model, scene: tpl.scene,
      width: r.W, height: r.H,
      photo: asset(`${tpl.id}-photo.jpg`),
      weight: asset(`${tpl.id}-weight.png`),
      shade: asset(`${tpl.id}-shade.jpg`),
      thumbPhoto: asset(`${tpl.id}-thumb-photo.jpg`),
      thumbWeight: asset(`${tpl.id}-thumb-weight.png`),
      thumbShade: asset(`${tpl.id}-thumb-shade.jpg`),
      thumbWidth: 112, thumbHeight: 168,
      ambientTint: r.ambientTint, relMax: r.relMax, violetBase: r.violetBase,
      quad: r.quad, bbox: r.bbox,
    });

    console.log(`${r.W}x${r.H} frags=${r.fragments} missed=${r.qa.missed} skin=${r.qa.skin} bgPaint=${r.qa.bgPaint} edgeDark=${r.qa.edgeDark} edgeBright=${r.qa.edgeBright} wedge=${r.qa.wedgePx} modelFit=${r.qa.modelFit} deepShadow=${r.qa.deepShadowPct}% hairShadow=${r.qa.hairShadowPct}% chroma=${r.qa.chromaPct}% keyMiss=${r.qa.keyMiss} coolPaint=${r.qa.coolPaint} occPaint=${r.qa.occPaint}`);
  }

  fs.writeFileSync(META_OUT, JSON.stringify(manifest, null, 2) + '\n');
  await browser.close();
  console.log(`\n${manifest.length} templates -> ${path.relative(process.cwd(), META_OUT)}`);
})().catch(e => { console.error(e); process.exit(1); });
