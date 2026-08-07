/**
 * Packages the two internal review pages for publishing as artifacts.
 *
 *   template-studio.html  the full add-a-template workflow — build the prompt,
 *                         paste the generated image, validate it against the
 *                         gates the build runs, try recolours, hand it over
 *   try-colors.html       paste an image and see it in every shipping colour
 *
 * The artifact host supplies <!doctype>, <head> and <body>, so a page published
 * there is a FRAGMENT: this strips the document wrapper off the Studio, which
 * still opens on its own from scratch/ exactly as before.
 *
 * The Colour View is not a second copy of the pipeline. Its analysis and its
 * relight are sliced out of template-studio.html at build time, so there is one
 * implementation of that maths in the repo and the two pages cannot drift.
 *
 * Usage:
 *   node scratch/build_studio_artifacts.cjs [outDir]      # default scratch/artifacts/dist
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(__dirname, 'artifacts');
const STUDIO = path.join(__dirname, 'template-studio.html');
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(SRC, 'dist');

const kb = (n) => `${Math.round(n / 1024)} KB`;

// Slices between two literal markers, both kept out of the result. Throws
// rather than returning something plausible: these markers are section banners
// in a file this script does not own, and a silent miss would ship a page whose
// recolour is subtly not the pipeline's.
function slice(src, from, to, what) {
  const a = src.indexOf(from);
  if (a === -1) throw new Error(`template-studio.html no longer contains the ${what} start marker: ${from}`);
  const b = src.indexOf(to, a + from.length);
  if (b === -1) throw new Error(`template-studio.html no longer contains the ${what} end marker: ${to}`);
  return src.slice(a + from.length, b).trim();
}

function studioFragment(src) {
  // <title> is what names the artifact, so it is kept and moved to the front;
  // everything else in <head> is document scaffolding the host provides.
  const title = (src.match(/<title>([^<]*)<\/title>/) || [null, 'Template Studio'])[1];
  const styleAt = src.indexOf('<style>');
  const bodyOpen = src.indexOf('<body>');
  const bodyClose = src.lastIndexOf('</body>');
  if (styleAt === -1 || bodyOpen === -1 || bodyClose === -1) {
    throw new Error('template-studio.html is not the expected single-document shape');
  }
  const head = src.slice(styleAt, src.indexOf('</head>'));   // the <style> block
  const body = src.slice(bodyOpen + '<body>'.length, bodyClose);
  return `<title>${title}</title>\n\n${head.trim()}\n${body.trim()}\n`;
}

function main() {
  const studioSrc = fs.readFileSync(STUDIO, 'utf8');

  // The Studio's stylesheet and its two pieces of pipeline maths, lifted whole.
  const style = slice(studioSrc, '<style>', '</style>', 'stylesheet');
  const analysis = slice(
    studioSrc,
    '/* ============ SHARED ANALYSIS (port of the build pipeline) ============ */',
    '/* ============ STEP 2 — VALIDATOR UI ============ */',
    'shared analysis',
  );
  const relight = slice(
    studioSrc,
    '/* ============ STEP 3 — TRY RECOLOURS ============ */',
    'function renderTry()',
    'relight',
  ).replace(/^const TRY_COLOURS[^\n]*\n/m, '').replace(/^let tryColour[^\n]*\n/m, '').trim();
  if (!/function relightLut/.test(relight)) {
    throw new Error('the relight slice no longer contains relightLut');
  }

  fs.mkdirSync(OUT, { recursive: true });

  const studioOut = path.join(OUT, 'template-studio.html');
  fs.writeFileSync(studioOut, studioFragment(studioSrc));
  console.log(`wrote ${path.relative(ROOT, studioOut)} (${kb(fs.statSync(studioOut).size)})`);

  let tryHtml = fs.readFileSync(path.join(SRC, 'try-colors.html'), 'utf8');
  for (const [marker, body] of [['/*__STYLE__*/', style], ['/*__ANALYSIS__*/', `${analysis}\n\n${relight}`]]) {
    if (!tryHtml.includes(marker)) throw new Error(`try-colors.html is missing ${marker}`);
    tryHtml = tryHtml.replace(marker, () => body);
  }
  const tryOut = path.join(OUT, 'try-colors.html');
  fs.writeFileSync(tryOut, tryHtml);
  console.log(`wrote ${path.relative(ROOT, tryOut)} (${kb(fs.statSync(tryOut).size)})`);
}

main();
