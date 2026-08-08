// Private export-stats dashboard, token protected.
//
// Auth: set a STATS_KEY environment variable (secret) on the Pages project.
// Visit /stats?key=<STATS_KEY> once; a session cookie keeps you signed in for
// 30 days so bookmarking plain /stats works afterwards. Wrong/missing key
// returns 401 with no hints. The page is noindexed and disallowed in robots.txt.
//
// Data comes from the D1 binding `DB`, written by /api/track.
//
// The page is built around ONE unit — an exported image — because that is the
// only thing the two events have in common and the only number that can be
// added up. A single download is one image; a batch run is one click that
// produces many. The old layout put "single downloads", "on-model downloads"
// (a subset of the first), a flat-lay/on-model percentage, "batch exports"
// (runs, not images) and "batch images" side by side as five equal cards, so
// nothing summed to anything and the same downloads were counted in three
// places. Here the total leads, everything under it is a breakdown of that
// total, and the full grid of raw figures is kept at the bottom.
import { ensureExportStats } from './_export-stats.js';

const COOKIE = 'teemockup_stats';

const GARMENT_LABELS = {
  crewneck: 'Crewneck Tee',
  ladies: 'Ladies Tee',
  polo: 'Polo Shirt',
  longsleeve: 'Long Sleeve',
  hoodie: 'Hoodie',
  sweatshirt: 'Sweatshirt',
  vneck: 'V-Neck Tee',
  tanktop: 'Tank Top',
};

// Mirrors public/assets/on-model/templates.json. Only for display: the
// breakdown below is built from whatever template ids the data actually
// contains, so a model added to the editor and missing here still shows up —
// under its raw id rather than vanishing from the chart.
const TEMPLATE_LABELS = {
  'gallery-f': 'Gallery Interior',
  'livingroom-m': 'Living Room',
  'street-m': 'Urban Street',
  'park-m': 'Park Path',
  'home-f': 'Cozy Home',
  'bright-airy-f': 'Bright Airy',
  'miami-f': 'Miami Street',
  'bright-minimal-m': 'Bright Minimal',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const n = (v) => Number(v || 0).toLocaleString('en-US');
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

// "2026-08-08" -> "Aug 8". Parsed by hand rather than through Date so the
// label never slides a day when the worker's clock is behind UTC.
function shortDay(day) {
  const [, m, d] = day.split('-');
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

// A y-axis top that lands on a number worth printing. Small counts get an even
// number so the midpoint tick is a whole one too.
function niceMax(v) {
  if (v <= 10) return Math.max(2, Math.ceil(v / 2) * 2);
  const base = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (v <= m * base) return m * base;
  }
  return 10 * base;
}

const tick = (v) => (v % 1 === 0 ? n(v) : v.toFixed(1));

// "2700x2025" -> "4:3". Only when the reduced ratio is small enough to read as
// one; an odd export size is better left unlabelled than shown as 271:203.
function ratioOf(quality) {
  const m = /^(\d+)x(\d+)$/.exec(quality);
  if (!m) return '';
  let a = Number(m[1]);
  let b = Number(m[2]);
  let x = a;
  let y = b;
  while (y) [x, y] = [y, x % y];
  if (!x) return '';
  a /= x;
  b /= x;
  return a <= 20 && b <= 20 ? `${a}:${b}` : '';
}

// Period-over-period movement. The point of the dashboard is knowing whether a
// number is going anywhere, which a running total on its own never says.
function delta(cur, prev, label) {
  if (!prev && !cur) return { dir: 'flat', text: `nothing in this or the ${label}` };
  if (!prev) return { dir: 'up', text: `first activity — nothing in the ${label}` };
  const change = Math.round(((cur - prev) / prev) * 100);
  if (change === 0) return { dir: 'flat', text: `level with the ${label}` };
  const arrow = change > 0 ? '↑' : '↓';
  return { dir: change > 0 ? 'up' : 'down', text: `${arrow} ${Math.abs(change)}% vs the ${label}` };
}

function unauthorized() {
  return new Response('Not authorized', {
    status: 401,
    headers: { 'Content-Type': 'text/plain', 'X-Robots-Tag': 'noindex, nofollow' },
  });
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const secret = env.STATS_KEY;
  if (!secret) return unauthorized(); // not configured yet

  const url = new URL(request.url);
  const providedKey = url.searchParams.get('key');
  const cookies = request.headers.get('Cookie') || '';
  const cookieOk = cookies.split(/;\s*/).some((c) => c === `${COOKIE}=${secret}`);

  if (providedKey !== secret && !cookieOk) return unauthorized();

  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': 'no-store',
  };
  if (providedKey === secret && !cookieOk) {
    headers['Set-Cookie'] = `${COOKIE}=${secret}; Path=/stats; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict`;
  }

  const db = env.DB;
  if (!db) {
    return new Response(page('<p class="empty">Database binding <code>DB</code> is not configured yet.</p>'), { headers });
  }

  // Bring the table into existence and pull the original's rows across before
  // reading. The dashboard cannot rely on the beacon having done this: it is
  // perfectly normal to open /stats before the next export happens, and when
  // that was the only place it ran, the page queried a table that did not
  // exist yet and rendered every number as zero — a site with history looked
  // exactly like a site with none. Idempotent, so doing it on a read is safe.
  try {
    await ensureExportStats(db);
  } catch {
    /* read-only or unavailable DB — fall through and show what can be read */
  }

  let rows;
  try {
    rows = (await db
      .prepare('SELECT day, event, style, garment, template, mode, quality, count, images FROM export_stats_v2 ORDER BY day')
      .all()).results || [];
  } catch {
    rows = []; // table not created yet — no exports tracked so far
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const daysAgo = (i) => new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);

  // Each window is paired with the window of equal length just before it, so
  // every headline figure can be shown as a movement rather than a bare count.
  const WINDOWS = {
    today: { from: today, to: today },
    d7: { from: daysAgo(6), to: today },
    p7: { from: daysAgo(13), to: daysAgo(7) },
    d30: { from: daysAgo(29), to: today },
    p30: { from: daysAgo(59), to: daysAgo(30) },
    all: { from: '', to: '9999-99-99' },
  };
  const inWindow = (w) => (r) => r.day >= w.from && r.day <= w.to;

  // One measuring function for the whole page. `where` narrows to the slice of
  // exports being asked about; `w` narrows to a period; the field says whether
  // we are counting events or the images they produced.
  const sum = (where, w, field) =>
    rows.filter(where).filter(inWindow(w)).reduce((a, r) => a + (r[field] || 0), 0);

  // The four kinds of exported image. Batch is flat lay by definition (its axes
  // are garment and colour, which an on-model template fixes), so it stands as
  // its own source rather than being folded into flat lay — the interesting
  // split is one-at-a-time versus bulk. `legacy` is history: rows recorded
  // before the editor reported which side of the editor it came from. They are
  // shown as "not recorded" rather than assumed to be flat lay, which would
  // overstate it for as long as that history is in the table.
  const isSingle = (r) => r.event === 'mockup_download';
  const isBatch = (r) => r.event === 'batch_export';
  const SOURCES = [
    { key: 'flatlay', label: 'Flat lay', where: (r) => isSingle(r) && r.style === 'flatlay', field: 'count' },
    { key: 'onmodel', label: 'On model', where: (r) => isSingle(r) && r.style === 'onmodel', field: 'count' },
    { key: 'batch', label: 'Batch', where: isBatch, field: 'images' },
    { key: 'legacy', label: 'Not recorded', where: (r) => isSingle(r) && r.style === '', field: 'count' },
  ];

  const images = {}; // images[source][window]
  for (const s of SOURCES) {
    images[s.key] = {};
    for (const [name, w] of Object.entries(WINDOWS)) images[s.key][name] = sum(s.where, w, s.field);
  }
  const totalImages = {};
  for (const name of Object.keys(WINDOWS)) {
    totalImages[name] = SOURCES.reduce((a, s) => a + images[s.key][name], 0);
  }

  // Events, i.e. how many times someone hit export. Kept separate from images
  // on purpose: conflating "412 batch runs" with "9,204 downloads" as if they
  // were the same act was the old page's central confusion.
  const singleRuns = {};
  const batchRuns = {};
  const modeRuns = { variants: {}, designs: {} };
  for (const [name, w] of Object.entries(WINDOWS)) {
    singleRuns[name] = sum(isSingle, w, 'count');
    batchRuns[name] = sum(isBatch, w, 'count');
    modeRuns.variants[name] = sum((r) => isBatch(r) && r.mode === 'variants', w, 'count');
    modeRuns.designs[name] = sum((r) => isBatch(r) && r.mode === 'designs', w, 'count');
  }

  const hasLegacy = images.legacy.all > 0;
  const shownSources = SOURCES.filter((s) => s.key !== 'legacy' || hasLegacy);

  // Attributed = the exports that said which side of the editor they came from,
  // so the share is a share of what is actually known.
  const attributed = images.flatlay.all + images.onmodel.all + images.batch.all;
  const onModelShare = pct(images.onmodel.all, attributed);
  const perBatch = batchRuns.all ? images.batch.all / batchRuns.all : 0;

  // ---- daily series, last 30 days -----------------------------------------
  const series = [];
  for (let i = 29; i >= 0; i--) {
    const day = daysAgo(i);
    const dayWindow = { from: day, to: day };
    const parts = {};
    for (const s of SOURCES) parts[s.key] = sum(s.where, dayWindow, s.field);
    series.push({ day, parts, total: SOURCES.reduce((a, s) => a + parts[s.key], 0) });
  }
  const peak = series.reduce((best, s) => (s.total > best.total ? s : best), series[0]);
  const axisMax = niceMax(Math.max(1, peak.total));
  const activeDays = series.filter((s) => s.total > 0).length;

  // The chart's legend names only what is actually drawn in this window. The
  // "not recorded" history is months old, so listing it beside the last 30 days
  // advertises a colour that never appears.
  let chartSources = shownSources.filter((s) => series.some((d) => d.parts[s.key] > 0));
  if (!chartSources.length) chartSources = SOURCES.filter((s) => s.key !== 'legacy');

  const PLOT = 176; // px of plot area; the x-axis band sits below it, outside

  const columns = series
    .map((s, i) => {
      // Built bottom-up so the topmost drawn segment is the one that gets the
      // rounded data-end. Segments are separated by a gap in the surface
      // colour rather than a stroke.
      const drawn = chartSources
        .map((src) => ({ src, v: s.parts[src.key] }))
        .filter((x) => x.v > 0);
      const stack = drawn
        .map((x, j) => {
          const h = Math.max(2, Math.round((x.v / axisMax) * PLOT));
          const top = j === drawn.length - 1 ? ' top' : '';
          return `<i class="seg s-${x.src.key}${top}" style="height:${h}px"></i>`;
        })
        .reverse() // flex column paints top-first; we built bottom-first
        .join('');
      const detail = drawn.length
        ? drawn.map((x) => `${x.src.label} ${n(x.v)}`).reverse().join(' · ')
        : 'nothing exported';
      const edge = i < 3 ? ' left' : i > 26 ? ' right' : '';
      const isPeak = s.total > 0 && s.day === peak.day;
      return `<div class="col" tabindex="0" aria-label="${esc(shortDay(s.day))}: ${n(s.total)} images. ${esc(detail)}">
          ${isPeak ? `<em class="peak">${n(s.total)}</em>` : ''}
          <div class="stack">${stack}</div>
          <span class="tip${edge}"><b>${esc(shortDay(s.day))} — ${n(s.total)} images</b>${esc(detail)}</span>
        </div>`;
    })
    .join('');

  // Labelled every 7th day plus the last, so the axis stays readable at 30
  // columns instead of turning into a grey smear.
  const axisLabels = series
    .map((s, i) => {
      const show = (29 - i) % 7 === 0 || i === 29;
      return `<span class="xl">${show ? esc(shortDay(s.day)) : ''}</span>`;
    })
    .join('');

  const legend = chartSources
    .map((s) => `<span class="key"><i class="sw s-${s.key}"></i>${esc(s.label)}</span>`)
    .join('');

  const dailyTable = `
    <table class="tbl">
      <thead><tr><th scope="col">Day</th>${chartSources
        .map((s) => `<th scope="col">${esc(s.label)}</th>`)
        .join('')}<th scope="col">Total</th></tr></thead>
      <tbody>${series
        .map(
          (s) => `<tr><th scope="row">${esc(shortDay(s.day))}</th>${chartSources
            .map((src) => `<td>${n(s.parts[src.key])}</td>`)
            .join('')}<td><b>${n(s.total)}</b></td></tr>`
        )
        .join('')}</tbody>
    </table>`;

  // ---- composition bars ----------------------------------------------------
  // A part-to-whole read at a glance, with the counts spelled out beside it so
  // the bar never has to be measured by eye.
  const composition = (title, note, parts) => {
    const whole = parts.reduce((a, p) => a + p.v, 0);
    const drawn = parts.filter((p) => p.v > 0);
    return `<section class="card">
      <h2>${esc(title)}</h2>
      ${
        whole
          ? `<div class="comp">${drawn
              .map((p) => `<i class="seg s-${p.key}" style="flex:${p.v}" title="${esc(p.label)}: ${n(p.v)}"></i>`)
              .join('')}</div>
        <dl class="split">${drawn
          .map(
            (p) => `<div><dt><i class="sw s-${p.key}"></i>${esc(p.label)}</dt>
              <dd><b>${n(p.v)}</b><span class="share">${pct(p.v, whole)}%</span></dd></div>`
          )
          .join('')}</dl>`
          : '<p class="empty">Nothing tracked yet.</p>'
      }
      ${note ? `<p class="note">${note}</p>` : ''}
    </section>`;
  };

  // ---- ranked breakdowns ---------------------------------------------------
  const byGarment = Object.keys(GARMENT_LABELS)
    .map((g) => ({ label: GARMENT_LABELS[g], v: sum((r) => isSingle(r) && r.garment === g, WINDOWS.all, 'count') }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v);

  // Built from the ids present in the data rather than from the label map, so a
  // template added to the editor still appears here.
  const templateIds = [...new Set(rows.filter((r) => r.template).map((r) => r.template))];
  const byTemplate = templateIds
    .map((t) => ({ label: TEMPLATE_LABELS[t] || t, v: sum((r) => isSingle(r) && r.template === t, WINDOWS.all, 'count') }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v);

  // Export size was recorded from the start and never shown. It answers a
  // question the owner cannot answer any other way: which canvas presets are
  // actually worth keeping. Counted in images like everything else, so a batch
  // run contributes the pictures it produced rather than the one click.
  const qualities = [...new Set(rows.filter((r) => r.quality).map((r) => r.quality))];
  const bySize = qualities
    .map((q) => ({
      label: q,
      hint: ratioOf(q),
      v:
        sum((r) => isSingle(r) && r.quality === q, WINDOWS.all, 'count') +
        sum((r) => isBatch(r) && r.quality === q, WINDOWS.all, 'images'),
    }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 8);

  const ranked = (items, tone, emptyText) => {
    if (!items.length) return `<p class="empty">${esc(emptyText)}</p>`;
    const top = Math.max(1, ...items.map((x) => x.v));
    const whole = items.reduce((a, x) => a + x.v, 0);
    return items
      .map(
        (x) => `<div class="hrow">
          <span class="hlabel">${esc(x.label)}${x.hint ? `<span class="hint">${esc(x.hint)}</span>` : ''}</span>
          <span class="htrack"><span class="hfill s-${tone}" style="width:${Math.max(2, Math.round((x.v / top) * 100))}%"></span></span>
          <b>${n(x.v)}</b><span class="share">${pct(x.v, whole)}%</span>
        </div>`
      )
      .join('');
  };

  // ---- headline ------------------------------------------------------------
  const d7 = delta(totalImages.d7, totalImages.p7, '7 days before');
  const d30 = delta(totalImages.d30, totalImages.p30, '30 days before');

  const tile = (label, value, d) => `
    <div class="tile">
      <p class="tlabel">${esc(label)}</p>
      <p class="tvalue">${n(value)}</p>
      ${d ? `<p class="tdelta ${d.dir}">${esc(d.text)}</p>` : ''}
    </div>`;

  // ---- every number --------------------------------------------------------
  // Nothing the old dashboard showed is dropped; the figures it only had for
  // some periods are here for all four, and the chart's values live in the
  // table above, so no number on this page is reachable only by hovering.
  const METRIC_ROWS = [
    { label: 'Images exported', data: totalImages, strong: true },
    { label: 'Flat lay (single)', data: images.flatlay, indent: 1 },
    { label: 'On model (single)', data: images.onmodel, indent: 1 },
    ...(hasLegacy ? [{ label: 'Not recorded (single)', data: images.legacy, indent: 1 }] : []),
    { label: 'From batch runs', data: images.batch, indent: 1 },
    { label: 'Export clicks', data: null, spacer: true },
    { label: 'Single downloads', data: singleRuns, indent: 1 },
    { label: 'Batch runs', data: batchRuns, indent: 1 },
    { label: 'Batch — variants mode', data: modeRuns.variants, indent: 2 },
    { label: 'Batch — designs mode', data: modeRuns.designs, indent: 2 },
  ];

  const metricTable = `
    <table class="tbl metrics">
      <thead><tr><th scope="col">Metric</th><th scope="col">Today</th><th scope="col">Last 7 days</th><th scope="col">Last 30 days</th><th scope="col">All time</th></tr></thead>
      <tbody>${METRIC_ROWS.map((m) =>
        m.spacer
          ? `<tr class="spacer"><th scope="row" colspan="5">${esc(m.label)}</th></tr>`
          : `<tr${m.strong ? ' class="strong"' : ''}><th scope="row" class="i${m.indent || 0}">${esc(m.label)}</th>
              <td>${n(m.data.today)}</td><td>${n(m.data.d7)}</td><td>${n(m.data.d30)}</td><td>${n(m.data.all)}</td></tr>`
      ).join('')}</tbody>
    </table>`;

  const body = `
    <header>
      <h1>Export stats</h1>
      <p>First-party counts (ad-blocker-proof), rolled up per UTC day. Every figure is an exported image unless it says otherwise. Read at ${esc(
        now.toISOString().slice(0, 16).replace('T', ' ')
      )} UTC.</p>
    </header>

    <section class="card hero">
      <div class="hero-figure">
        <p class="tlabel">Images exported, all time</p>
        <p class="figure">${n(totalImages.all)}</p>
        <p class="note">${
          totalImages.all
            ? `${n(singleRuns.all)} one at a time${
                batchRuns.all
                  ? ` · ${n(images.batch.all)} from ${n(batchRuns.all)} batch ${
                      batchRuns.all === 1 ? 'run' : 'runs'
                    }, ${perBatch.toFixed(1)} images a run`
                  : ''
              }`
            : 'Nothing tracked yet — the first export will land here.'
        }</p>
      </div>
      <div class="tiles">
        ${tile('Today', totalImages.today, null)}
        ${tile('Last 7 days', totalImages.d7, d7)}
        ${tile('Last 30 days', totalImages.d30, d30)}
      </div>
    </section>

    <section class="card">
      <h2>Images a day <span class="sub">${
        peak.total
          ? `last 30 days · ${activeDays} of 30 days had an export · busiest was ${esc(shortDay(peak.day))} at ${n(peak.total)}`
          : 'last 30 days'
      }</span></h2>
      ${
        peak.total
          ? `<div class="legend">${legend}</div>
      <div class="plot">
        <div class="yaxis" aria-hidden="true">
          <span>${tick(axisMax)}</span><span>${tick(axisMax / 2)}</span><span>0</span>
        </div>
        <div class="plotarea">
          <div class="grid" aria-hidden="true"><i></i><i></i><i></i></div>
          <div class="cols" style="height:${PLOT}px">${columns}</div>
          <div class="xaxis">${axisLabels}</div>
        </div>
      </div>
      <details><summary>Show these 30 days as a table</summary>${dailyTable}</details>`
          : '<p class="empty">No exports in the last 30 days.</p>'
      }
    </section>

    <div class="two">
      ${composition('What people make', 'Batch is flat lay by definition — its axes are garment and colour, and an on-model template fixes the garment.', [
        { key: 'flatlay', label: 'Flat lay, one at a time', v: images.flatlay.all },
        { key: 'onmodel', label: 'On model', v: images.onmodel.all },
        { key: 'batch', label: 'Flat lay, batch', v: images.batch.all },
        ...(hasLegacy ? [{ key: 'legacy', label: 'Before this was recorded', v: images.legacy.all }] : []),
      ])}
      ${composition(
        'How they export',
        batchRuns.all
          ? `Batch is ${pct(batchRuns.all, singleRuns.all + batchRuns.all)}% of export clicks but ${pct(
              images.batch.all,
              totalImages.all
            )}% of the images. Variants ${n(modeRuns.variants.all)} · designs ${n(modeRuns.designs.all)}.`
          : 'No batch runs yet.',
        [
          { key: 'flatlay', label: 'Single downloads', v: singleRuns.all },
          { key: 'batch', label: 'Batch runs', v: batchRuns.all },
        ]
      )}
    </div>

    <div class="two">
      <section class="card">
        <h2>Flat lay garments <span class="sub">all time</span></h2>
        ${ranked(byGarment, 'flatlay', 'No flat-lay downloads tracked yet.')}
      </section>
      <section class="card">
        <h2>On-model backdrops <span class="sub">all time</span></h2>
        ${ranked(byTemplate, 'onmodel', 'No on-model downloads tracked yet.')}
      </section>
    </div>

    <section class="card">
      <h2>Export sizes <span class="sub">all time · every export, flat lay and on model${qualities.length > bySize.length ? ` · top ${bySize.length} of ${qualities.length}` : ''}</span></h2>
      ${ranked(bySize, 'neutral', 'No sizes recorded yet.')}
    </section>

    <section class="card">
      <h2>Every number</h2>
      ${metricTable}
      ${attributed ? `<p class="note">On model is ${onModelShare}% of every export whose side of the editor was recorded.</p>` : ''}
    </section>`;

  return new Response(page(body), { headers });
}

function page(body) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Export Stats — TeeMockup</title>
<style>
  :root {
    color-scheme: dark;
    --plane: #0b0d12;
    --surface: #12151d;
    --ink: #ffffff;
    --ink-2: #c3c2b7;
    --muted: #898781;
    --grid: #23262f;
    --hairline: rgba(255,255,255,0.09);
    /* Categorical slots 1, 3 and 2 of the reference palette, stepped for a
       dark surface. Validated as a set against this page's background: worst
       all-pairs CVD ΔE 9.4, normal-vision ΔE 20.9, all ≥ 3:1 on the surface.
       Colour follows the entity — flat lay is always blue, on model always
       aqua, batch always orange, on every chart on the page. */
    --flatlay: #3987e5;
    --onmodel: #199e70;
    --batch: #d95926;
    --legacy: #5b5f6b;
    --neutral: #8a90a0;
    --good: #0ca30c;
    --bad: #d03b3b;
  }
  * { box-sizing: border-box; margin: 0; }
  body { background: var(--plane); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 32px 20px 72px; max-width: 1040px; margin: 0 auto; }
  header { margin-bottom: 24px; }
  h1 { font-size: 1.45rem; letter-spacing: -0.4px; text-wrap: balance; }
  header p { color: var(--muted); font-size: 0.85rem; max-width: 68ch; }
  .card { background: var(--surface); border: 1px solid var(--hairline); border-radius: 14px; padding: 20px; margin-bottom: 14px; }
  .card h2 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.6px; color: var(--ink-2); margin-bottom: 14px; }
  .sub { text-transform: none; letter-spacing: 0; color: var(--muted); font-weight: 400; margin-left: 4px; }
  .note { color: var(--muted); font-size: 0.8rem; margin-top: 12px; max-width: 72ch; }
  .empty { color: var(--muted); font-size: 0.9rem; }
  code { background: rgba(255,255,255,0.08); padding: 1px 6px; border-radius: 6px; }
  .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }
  .two .card { margin-bottom: 14px; }

  /* Headline ------------------------------------------------------------- */
  .hero { display: flex; flex-wrap: wrap; gap: 28px; align-items: center; justify-content: space-between; }
  .figure { font-size: 3.4rem; line-height: 1.05; font-weight: 650; letter-spacing: -2px; }
  .tlabel { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.6px; color: var(--muted); margin-bottom: 4px; }
  .tiles { display: flex; gap: 26px; flex-wrap: wrap; }
  .tile { min-width: 128px; }
  .tvalue { font-size: 1.5rem; font-weight: 620; letter-spacing: -0.5px; }
  .tdelta { font-size: 0.76rem; color: var(--muted); margin-top: 2px; }
  .tdelta.up { color: var(--good); }
  .tdelta.down { color: var(--bad); }

  /* Series colours ------------------------------------------------------- */
  .s-flatlay { background: var(--flatlay); }
  .s-onmodel { background: var(--onmodel); }
  .s-batch { background: var(--batch); }
  .s-legacy { background: var(--legacy); }
  /* Charts that span every source get chart ink rather than a fourth hue: no
     fourth categorical step clears the CVD floors beside these three, and a
     series colour here would claim the bars belong to one of them. */
  .s-neutral { background: var(--neutral); }

  .legend { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 14px; }
  .key { font-size: 0.78rem; color: var(--ink-2); display: inline-flex; align-items: center; }
  .sw { width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; flex: none; }

  /* Column chart --------------------------------------------------------- */
  .plot { display: flex; gap: 10px; }
  .yaxis { display: flex; flex-direction: column; justify-content: space-between; height: 176px; text-align: right; font-size: 0.68rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .yaxis span { transform: translateY(-0.5em); }
  .plotarea { flex: 1; min-width: 0; position: relative; }
  .grid { position: absolute; inset: 0 0 auto 0; height: 176px; display: flex; flex-direction: column; justify-content: space-between; }
  .grid i { display: block; height: 1px; background: var(--grid); }
  .cols { display: flex; align-items: flex-end; gap: 3px; position: relative; }
  .col { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; position: relative; border-radius: 4px 4px 0 0; }
  .col:hover, .col:focus-visible { background: rgba(255,255,255,0.05); outline: none; }
  .col:focus-visible { box-shadow: 0 0 0 2px var(--flatlay); }
  .stack { display: flex; flex-direction: column; justify-content: flex-end; gap: 2px; max-width: 18px; width: 100%; margin: 0 auto; }
  .seg { display: block; width: 100%; }
  .seg.top { border-radius: 4px 4px 0 0; }
  /* Sits in flow directly above the stack, so it tracks the bar's height
     without being measured against the plot twice. Only the busiest day gets
     one — a number on every column is noise nobody reads. */
  .peak { font-size: 0.66rem; font-style: normal; color: var(--ink-2); text-align: center; margin-bottom: 3px; }
  .tip { position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); display: none; z-index: 5; background: #1b1f29; border: 1px solid var(--hairline); border-radius: 8px; padding: 7px 10px; font-size: 0.74rem; color: var(--ink-2); white-space: nowrap; box-shadow: 0 6px 18px rgba(0,0,0,0.45); }
  .tip.left { left: 0; transform: none; }
  .tip.right { left: auto; right: 0; transform: none; }
  .tip b { display: block; color: var(--ink); }
  .col:hover .tip, .col:focus-visible .tip { display: block; }
  .xaxis { display: flex; gap: 3px; margin-top: 8px; }
  .xl { flex: 1; min-width: 0; font-size: 0.66rem; color: var(--muted); text-align: center; white-space: nowrap; }

  /* Composition bar ------------------------------------------------------ */
  .comp { display: flex; gap: 2px; height: 14px; margin-bottom: 16px; }
  .comp .seg { border-radius: 3px; min-width: 3px; }
  .split { display: flex; flex-direction: column; gap: 7px; }
  .split div { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 0.86rem; }
  .split dt { color: var(--ink-2); display: flex; align-items: center; min-width: 0; }
  .split dd { display: flex; gap: 10px; align-items: baseline; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .share { color: var(--muted); font-size: 0.78rem; min-width: 34px; text-align: right; }

  /* Ranked bars ---------------------------------------------------------- */
  .hrow { display: flex; align-items: center; gap: 12px; padding: 5px 0; font-size: 0.86rem; }
  .hlabel { width: 132px; color: var(--ink-2); flex: none; display: flex; align-items: baseline; gap: 6px; min-width: 0; }
  .hlabel .hint { color: var(--muted); font-size: 0.72rem; }
  .htrack { flex: 1; background: rgba(255,255,255,0.05); border-radius: 99px; height: 8px; min-width: 0; }
  .hfill { display: block; height: 100%; border-radius: 99px; }
  .hrow b { width: 58px; text-align: right; font-variant-numeric: tabular-nums; }

  /* Tables --------------------------------------------------------------- */
  details { margin-top: 14px; }
  summary { color: var(--muted); font-size: 0.8rem; cursor: pointer; }
  summary:focus-visible { outline: 2px solid var(--flatlay); outline-offset: 3px; border-radius: 4px; }
  .tbl { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 0.82rem; font-variant-numeric: tabular-nums; }
  .tbl th, .tbl td { padding: 6px 8px; text-align: right; border-bottom: 1px solid var(--grid); white-space: nowrap; }
  .tbl thead th:first-child, .tbl tbody th[scope="row"] { text-align: left; }
  .tbl thead th { color: var(--muted); font-weight: 500; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.5px; }
  .tbl th[scope="row"] { text-align: left; color: var(--ink-2); font-weight: 400; }
  .tbl td { color: var(--ink-2); }
  .metrics tr.strong th, .metrics tr.strong td { color: var(--ink); font-weight: 600; }
  .metrics tr.spacer th { color: var(--muted); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.5px; padding-top: 16px; border-bottom: none; }
  .metrics .i1 { padding-left: 20px; }
  .metrics .i2 { padding-left: 36px; }
  .tbl tbody tr:last-child th, .tbl tbody tr:last-child td { border-bottom: none; }

  @media (max-width: 620px) {
    .figure { font-size: 2.6rem; }
    .hlabel { width: 96px; }
    .tbl { display: block; overflow-x: auto; }
  }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>
</head><body>${body}</body></html>`;
}
