#!/usr/bin/env node
/**
 * Assemble the self-contained video bench page from the template, a bench
 * pack and a default design.
 *
 * The page has to hold everything inline — an artifact is served under a CSP
 * that blocks every external host, so a frame pack fetched at runtime would
 * simply never arrive.
 *
 * Usage: node scratch/build_video_bench.cjs <pack.json> <design.png> <out.html>
 */
const fs = require('fs');
const path = require('path');

const [packArg, designArg, outArg, reportArg] = process.argv.slice(2);
if (!packArg || !designArg || !outArg) {
  console.error('usage: node scratch/build_video_bench.cjs <pack.json> <design.png> <out.html> [report.json]');
  process.exit(1);
}
// The verdict figures on the page are the ones render_video_mockup.cjs
// actually measured, not numbers typed into the markup. If the report is
// missing the page should say so rather than quietly showing a zero it has
// no evidence for.
const report = reportArg && fs.existsSync(reportArg)
  ? JSON.parse(fs.readFileSync(path.resolve(reportArg), 'utf8')) : null;
const tpl = fs.readFileSync(path.join(__dirname, 'video_bench_template.html'), 'utf8');
const pack = fs.readFileSync(path.resolve(packArg), 'utf8');
const design = 'data:image/png;base64,' + fs.readFileSync(path.resolve(designArg)).toString('base64');

// The pack lands inside a <script type="application/json"> block, so the only
// sequence that can break out of it is a literal </script>. Base64 payloads
// cannot produce one, but the escape costs nothing and means a future pack
// carrying arbitrary text can't silently truncate the page.
const safePack = pack.replace(/<\/script/gi, '<\\/script');

const html = tpl
  .replace('__PACK__', () => safePack)
  .replace('__DESIGN__', () => design)
  .replace('__VIOLET__', () => (report ? String(report.violetPerFrameAvg) : 'n/a'))
  .replace('__HAIR__', () => (report ? report.hairBandVioletPct.toFixed(1) : 'n/a'));
fs.writeFileSync(path.resolve(outArg), html);
console.log(`${outArg}  ${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB`);
