// Assemble the QA contact sheet from the renders and the measured numbers.
const fs = require('fs');
const path = require('path');
const SP = process.env.QA_DIR || __dirname;

const data = JSON.parse(fs.readFileSync(path.join(SP, 'sheet-data.json'), 'utf8'));
const log = fs.readFileSync(path.join(SP, 'qa.log'), 'utf8').trim().split('\n');

// The log is in build order and the manifest is written in the same pass, so
// they align row for row. Parse every key=value on the line.
const qa = log.map((line) => {
  const o = {};
  for (const m of line.matchAll(/([a-zA-Z]+)=([0-9.]+)%?/g)) o[m[1]] = parseFloat(m[2]);
  return o;
});
if (qa.length !== data.templates.length) {
  console.error(`mismatch: ${qa.length} log lines vs ${data.templates.length} templates`);
  process.exit(1);
}
data.templates.forEach((t, i) => { t.qa = qa[i]; });

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The calibration this whole exercise produced: a real photographic edge reads
// 68-85 on this scale, so a template inside that band is as smooth as the
// photograph it came from and the number has nothing more to say about it.
const band = (r) => (r <= 85 ? ['inside', 'inside the photographic band'] : ['above', 'above the photographic band']);

const rows = data.templates.map((t, i) => {
  const [cls, title] = band(t.qa.edgeRough);
  const frames = t.cells.map((src, c) => `
        <button class="frame" data-t="${i}" data-c="${c}" aria-label="${esc(t.label)} in ${esc(data.colours[c][0])}">
          <img src="${src}" alt="${esc(t.label)} rendered in ${esc(data.colours[c][0])}" loading="lazy">
        </button>`).join('');
  return `
      <div class="row">
        <div class="rail">
          <h3>${esc(t.label)}</h3>
          <p class="scene">${esc(t.scene)}</p>
          <dl class="metrics">
            <div><dt>edge</dt><dd class="${cls}" title="${title}">${t.qa.edgeRough}</dd></div>
            <div><dt>width</dt><dd>${t.qa.edgeWidth}<span class="unit">px</span></dd></div>
            <div><dt>bg paint</dt><dd>${t.qa.bgPaint}</dd></div>
            <div><dt>violet</dt><dd>${t.qa.keyMiss}</dd></div>
          </dl>
        </div>
        <div class="frames">${frames}
        </div>
      </div>`;
}).join('');

const swatches = data.colours.map(([name, hex], c) => `
        <button class="swatch" data-c="${c}" style="--chip:${hex}" title="Show every template in ${esc(name)}">
          <span class="chip"></span>
          <span class="sw-name">${esc(name)}</span>
          <span class="sw-hex">${esc(hex)}</span>
        </button>`).join('');

const meanRough = (data.templates.reduce((a, t) => a + t.qa.edgeRough, 0) / data.templates.length).toFixed(1);
const above = data.templates.filter((t) => t.qa.edgeRough > 85).length;

const html = `<title>Recolour Contact Sheet</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  /* Light is the base set. Every colour below is a token so both themes
     resolve as a whole, and none is declared only inside a media block. */
  :root {
    --ground:#f4f3f6; --surface:#ffffff; --sunk:#eceaf1;
    --ink:#191821; --muted:#6d6a7c; --rule:#e2e0e9; --rule-soft:#eeecf3;
    --accent:#7546c9; --accent-soft:#efe8fb;
    --inside:#2e7d5b; --inside-soft:#e3f2ea;
    --above:#a8571c; --above-soft:#faeddf;
    --shadow:0 1px 2px rgba(25,24,33,.05), 0 10px 28px -14px rgba(25,24,33,.28);
    --frame-ground:#e7e5ec;
    --mono:ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    --sans:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground:#141319; --surface:#1c1b23; --sunk:#191821;
      --ink:#e9e8ef; --muted:#928fa3; --rule:#2b2934; --rule-soft:#232230;
      --accent:#a97ef5; --accent-soft:#28203c;
      --inside:#57c795; --inside-soft:#152a21;
      --above:#dcae5c; --above-soft:#2c2415;
      --shadow:0 1px 2px rgba(0,0,0,.5), 0 12px 32px -16px rgba(0,0,0,.8);
      --frame-ground:#262530;
    }
  }
  :root[data-theme="dark"] {
    --ground:#141319; --surface:#1c1b23; --sunk:#191821;
    --ink:#e9e8ef; --muted:#928fa3; --rule:#2b2934; --rule-soft:#232230;
    --accent:#a97ef5; --accent-soft:#28203c;
    --inside:#57c795; --inside-soft:#152a21;
    --above:#dcae5c; --above-soft:#2c2415;
    --shadow:0 1px 2px rgba(0,0,0,.5), 0 12px 32px -16px rgba(0,0,0,.8);
    --frame-ground:#262530;
  }

  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--ground); color:var(--ink);
    font-family:var(--sans); font-size:15px; line-height:1.55;
    -webkit-font-smoothing:antialiased;
  }
  .wrap { max-width:1500px; margin:0 auto; padding:38px 24px 90px; }

  header { display:flex; flex-direction:column; gap:10px; margin-bottom:26px; }
  .eyebrow {
    font-family:var(--mono); font-size:11px; letter-spacing:.15em;
    text-transform:uppercase; color:var(--accent); font-weight:600;
  }
  h1 {
    margin:0; font-size:clamp(1.6rem,3.4vw,2.3rem); letter-spacing:-.025em;
    text-wrap:balance; font-weight:650;
  }
  .lede { margin:0; color:var(--muted); max-width:66ch; }

  .summary { display:flex; flex-wrap:wrap; gap:10px; margin-top:6px; }
  .stat {
    background:var(--surface); border:1px solid var(--rule); border-radius:10px;
    padding:9px 14px; display:flex; align-items:baseline; gap:9px;
  }
  .stat b { font-family:var(--mono); font-size:15px; font-variant-numeric:tabular-nums; }
  .stat span { font-size:12.5px; color:var(--muted); }

  .controls {
    position:sticky; top:0; z-index:20; margin:26px -24px 0; padding:14px 24px;
    background:color-mix(in srgb, var(--ground) 92%, transparent);
    backdrop-filter:blur(10px); border-bottom:1px solid var(--rule);
    display:flex; gap:10px; align-items:center; flex-wrap:wrap;
  }
  .swatch {
    font:inherit; cursor:pointer; display:flex; align-items:center; gap:8px;
    background:var(--surface); border:1px solid var(--rule); border-radius:9px;
    padding:6px 12px 6px 8px; color:var(--ink);
  }
  .swatch:hover { border-color:var(--accent); }
  .swatch[aria-pressed="true"] { border-color:var(--accent); background:var(--accent-soft); }
  .chip {
    width:20px; height:20px; border-radius:50%; background:var(--chip);
    border:1px solid rgba(128,128,128,.42); flex:0 0 auto;
  }
  .sw-name { font-size:12.5px; font-weight:600; }
  .sw-hex { font-family:var(--mono); font-size:10.5px; color:var(--muted); }
  .reset {
    font:inherit; font-size:12.5px; font-weight:600; cursor:pointer; margin-left:auto;
    background:none; border:1px solid var(--rule); border-radius:9px;
    padding:8px 14px; color:var(--muted);
  }
  .reset:hover { border-color:var(--accent); color:var(--ink); }

  .sheet { display:flex; flex-direction:column; gap:0; margin-top:22px; }
  .row {
    display:grid; grid-template-columns:190px minmax(0,1fr); gap:22px;
    padding:22px 0; border-top:1px solid var(--rule-soft); align-items:start;
  }
  .row:first-child { border-top:none; }
  .rail { position:sticky; top:82px; }
  .rail h3 { margin:0 0 3px; font-size:15px; letter-spacing:-.01em; }
  .scene { margin:0 0 12px; font-size:12.5px; color:var(--muted); line-height:1.45; }

  .metrics { margin:0; display:flex; flex-direction:column; gap:4px; }
  .metrics > div { display:flex; align-items:baseline; gap:8px; }
  .metrics dt {
    font-family:var(--mono); font-size:10px; letter-spacing:.08em;
    text-transform:uppercase; color:var(--muted); width:66px; flex:0 0 auto;
  }
  .metrics dd {
    margin:0; font-family:var(--mono); font-size:12.5px;
    font-variant-numeric:tabular-nums; font-weight:600;
  }
  .metrics .unit { font-weight:400; color:var(--muted); margin-left:2px; }
  .metrics dd.inside { color:var(--inside); background:var(--inside-soft); padding:1px 7px; border-radius:5px; }
  .metrics dd.above  { color:var(--above);  background:var(--above-soft);  padding:1px 7px; border-radius:5px; }

  .frames { display:grid; grid-template-columns:repeat(6, minmax(0,1fr)); gap:10px; }
  .frame {
    padding:0; border:1px solid var(--rule); border-radius:8px; overflow:hidden;
    background:var(--frame-ground); cursor:zoom-in; display:block; line-height:0;
  }
  .frame:hover { border-color:var(--accent); }
  .frame img { width:100%; height:auto; display:block; }

  /* One colour, every template — the view for spotting a systematic fault. */
  body.solo .row { grid-template-columns:minmax(0,1fr); gap:12px; padding:18px 0; }
  body.solo .rail { position:static; display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; }
  body.solo .rail h3 { margin:0; }
  body.solo .scene { display:none; }
  body.solo .metrics { flex-direction:row; gap:14px; }
  body.solo .metrics dt { width:auto; }
  body.solo .sheet { display:grid; grid-template-columns:repeat(auto-fill, minmax(230px,1fr)); gap:8px 18px; }
  body.solo .row { border-top:none; }
  body.solo .frame[hidden] { display:none; }
  body.solo .frames { grid-template-columns:minmax(0,1fr); }

  dialog {
    border:none; padding:0; background:transparent; max-width:96vw; max-height:96vh;
  }
  dialog::backdrop { background:rgba(10,9,14,.86); }
  .viewer { display:flex; flex-direction:column; gap:10px; align-items:center; }
  .viewer img {
    max-width:min(92vw, 620px); max-height:78vh; width:auto; border-radius:10px;
    box-shadow:var(--shadow); background:var(--frame-ground);
  }
  .viewer-bar {
    display:flex; gap:14px; align-items:center; color:#eceaf2;
    font-family:var(--mono); font-size:12.5px; letter-spacing:.03em;
  }
  .viewer-bar b { font-weight:600; }
  .viewer-bar .hint { color:#9a97a8; }

  footer {
    margin-top:44px; padding-top:20px; border-top:1px solid var(--rule);
    color:var(--muted); font-size:13px; max-width:72ch;
  }
  footer code { font-family:var(--mono); font-size:12px; }

  button:focus-visible, .frame:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  @media (prefers-reduced-motion: reduce) { * { transition:none !important; } }

  @media (max-width: 1080px) {
    .row { grid-template-columns:minmax(0,1fr); gap:12px; }
    .rail { position:static; }
    .frames { grid-template-columns:repeat(3, minmax(0,1fr)); }
  }
  @media (max-width: 560px) {
    .frames { grid-template-columns:repeat(2, minmax(0,1fr)); }
    .wrap { padding:26px 16px 70px; }
  }
</style>

<div class="wrap">
  <header>
    <span class="eyebrow">FreeTeeMockup · recolour QA · ${new Date().toISOString().slice(0, 10)}</span>
    <h1>Every template, every colour</h1>
    <p class="lede">
      All ${data.templates.length} shipped templates rendered through the live site's own recolour
      maths, against the six garment colours that stress it hardest. This exists because the
      measured gates have stopped tracking what is actually visible — so from here the pictures
      decide, and the numbers are context beside them rather than the verdict.
    </p>
    <div class="summary">
      <div class="stat"><b>${meanRough}</b><span>mean edge roughness, from 172</span></div>
      <div class="stat"><b>68&ndash;85</b><span>what a real photograph reads</span></div>
      <div class="stat"><b>${data.templates.length - above}/${data.templates.length}</b><span>inside that band</span></div>
    </div>
  </header>

  <div class="controls">
${swatches}
    <button class="reset" id="reset" hidden>Show all six</button>
  </div>

  <div class="sheet" id="sheet">${rows}
  </div>

  <footer>
    <p><b>Reading the edge number.</b> It counts staircase in the garment's outline. A
    mathematically perfect edge through this pipeline reads 12&ndash;24; a real photographic
    edge, measured with no pipeline in between, reads 68&ndash;85. Anything inside that band is
    already as smooth as the photograph it came from, which is why it is marked green rather
    than treated as headroom. <b>bg paint</b> counts background pixels wrongly recoloured;
    <b>violet left</b> counts fabric the key missed, which shows up first on pink.</p>
    <p>Click any frame to open it large; arrow keys move through the sheet. Click a colour to
    see that one across every template &mdash; the view for telling a fault in one photograph
    from a fault in the pipeline. Rebuild with <code>node scratch/build_on_model_templates.cjs</code>.</p>
  </footer>
</div>

<dialog id="viewer">
  <div class="viewer">
    <img id="vimg" alt="">
    <div class="viewer-bar">
      <b id="vname"></b><span id="vcolour"></span><span class="hint">&larr; &rarr; to move &middot; Esc to close</span>
    </div>
  </div>
</dialog>

<script>
  const COLOURS = ${JSON.stringify(data.colours)};
  const NAMES = ${JSON.stringify(data.templates.map((t) => t.label))};
  const frames = [...document.querySelectorAll('.frame')];
  const swatchEls = [...document.querySelectorAll('.swatch')];
  const reset = document.getElementById('reset');
  let solo = null;

  function applySolo(c) {
    solo = c;
    document.body.classList.toggle('solo', c !== null);
    frames.forEach((f) => { f.hidden = c !== null && +f.dataset.c !== c; });
    swatchEls.forEach((s) => s.setAttribute('aria-pressed', String(+s.dataset.c === c)));
    reset.hidden = c === null;
  }
  swatchEls.forEach((s) => s.addEventListener('click', () => {
    applySolo(solo === +s.dataset.c ? null : +s.dataset.c);
  }));
  reset.addEventListener('click', () => applySolo(null));

  const viewer = document.getElementById('viewer');
  const vimg = document.getElementById('vimg');
  const vname = document.getElementById('vname');
  const vcolour = document.getElementById('vcolour');
  let at = 0;

  function show(i) {
    const visible = frames.filter((f) => !f.hidden);
    if (!visible.length) return;
    at = (i + visible.length) % visible.length;
    const f = visible[at];
    vimg.src = f.querySelector('img').src;
    vimg.alt = f.getAttribute('aria-label');
    vname.textContent = NAMES[+f.dataset.t];
    vcolour.textContent = COLOURS[+f.dataset.c][0] + '  ' + COLOURS[+f.dataset.c][1];
  }
  frames.forEach((f) => f.addEventListener('click', () => {
    show(frames.filter((x) => !x.hidden).indexOf(f));
    viewer.showModal();
  }));
  document.addEventListener('keydown', (e) => {
    if (!viewer.open) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); show(at + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(at - 1); }
  });
  viewer.addEventListener('click', (e) => { if (e.target === viewer) viewer.close(); });
</script>
`;

const outPath = path.join(SP, 'qa-sheet.html');
fs.writeFileSync(outPath, html);
console.log(`${outPath}  ${(html.length / 1024 / 1024).toFixed(2)} MB`);
