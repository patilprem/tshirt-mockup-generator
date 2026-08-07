/**
 * Packages the two internal review pages for publishing as artifacts.
 *
 * Each page is written twice: as a fragment in dist/ for publishing, and as a
 * whole document in standalone/ that opens by double-clicking it.
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
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(__dirname, 'artifacts');
const STUDIO = path.join(__dirname, 'template-studio.html');
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(SRC, 'dist');
// Alongside the fragments, a copy of each page that opens on its own by
// double-clicking it — no build, no server, no network. The artifact host
// supplies <!doctype>, <head> and <body>, so what it wants is a FRAGMENT; a
// browser opening a file off disk wants a whole document. Both are written from
// the same source, so the local copy can never drift from the published one.
// Sibling of the fragment directory, so building into a temp target puts its
// standalone copies there too rather than overwriting the committed ones.
const LOCAL = path.join(path.dirname(OUT), 'standalone');

const kb = (n) => `${Math.round(n / 1024)} KB`;

// The skeleton the artifact host would otherwise provide. The <title> is lifted
// out of the fragment so the browser tab reads the same as the published page.
function standalone(fragment) {
  const title = (fragment.match(/<title>([^<]*)<\/title>/) || [null, 'Template Studio'])[1];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
</head>
<body>
${fragment}
</body>
</html>
`;
}

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

// Which revision of the pipeline this page carries. The published copies do not
// update themselves — the maths can move on in the repo while a browser tab is
// still showing a page from two changes ago, which looks perfectly plausible and
// is how a fixed defect gets reported as still broken. Stamping the build makes
// the two distinguishable at a glance, on the page itself.
function stamp() {
  const files = ['scratch/template-studio.html', 'scratch/build_on_model_templates.cjs'];
  try {
    const sha = execFileSync('git', ['log', '-1', '--format=%h', '--', ...files],
      { cwd: ROOT, encoding: 'utf8' }).trim();
    const when = execFileSync('git', ['log', '-1', '--format=%cs', '--', ...files],
      { cwd: ROOT, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--', ...files],
      { cwd: ROOT, encoding: 'utf8' }).trim();
    return `${when} ${sha}${dirty ? ' +local edits' : ''}`;
  } catch {
    return 'unversioned build';
  }
}

function main() {
  const studioSrc = fs.readFileSync(STUDIO, 'utf8');
  const built = stamp();

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
  fs.mkdirSync(LOCAL, { recursive: true });

  const write = (name, fragmentRaw) => {
    const fragment = fragmentRaw.replace('<span id="buildStamp"></span>',
      `<span id="buildStamp">· ${built}</span>`);
    const a = path.join(OUT, name);
    fs.writeFileSync(a, fragment);
    console.log(`wrote ${path.relative(ROOT, a)} (${kb(fs.statSync(a).size)})`);
    const b = path.join(LOCAL, name);
    fs.writeFileSync(b, standalone(fragment));
    console.log(`wrote ${path.relative(ROOT, b)} (${kb(fs.statSync(b).size)}) — opens on its own`);
  };

  write('template-studio.html', studioFragment(studioSrc));

  let tryHtml = fs.readFileSync(path.join(SRC, 'try-colors.html'), 'utf8');
  for (const [marker, body] of [['/*__STYLE__*/', style], ['/*__ANALYSIS__*/', `${analysis}\n\n${relight}`]]) {
    if (!tryHtml.includes(marker)) throw new Error(`try-colors.html is missing ${marker}`);
    tryHtml = tryHtml.replace(marker, () => body);
  }
  write('try-colors.html', tryHtml);
}

main();
