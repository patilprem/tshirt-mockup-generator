// Private export-stats dashboard, token protected.
//
// Auth: set a STATS_KEY environment variable (secret) on the Pages project.
// Visit /stats?key=<STATS_KEY> once; a session cookie keeps you signed in for
// 30 days so bookmarking plain /stats works afterwards. Wrong/missing key
// returns 401 with no hints. The page is noindexed and disallowed in robots.txt.
//
// Data comes from the D1 binding `DB`, written by /api/track.

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

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

  let rows;
  try {
    rows = (await db
      .prepare('SELECT day, event, style, garment, template, mode, quality, count, images FROM export_stats_v2 ORDER BY day')
      .all()).results || [];
  } catch {
    rows = []; // table not created yet — no exports tracked so far
  }

  const today = new Date().toISOString().slice(0, 10);
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const d7 = daysAgo(6);
  const d30 = daysAgo(29);

  const sum = (filter, field) => rows.filter(filter).reduce((a, r) => a + r[field], 0);

  const totals = {};
  for (const event of ['mockup_download', 'batch_export']) {
    totals[event] = {
      today: sum((r) => r.event === event && r.day === today, 'count'),
      week: sum((r) => r.event === event && r.day >= d7, 'count'),
      month: sum((r) => r.event === event && r.day >= d30, 'count'),
      all: sum((r) => r.event === event, 'count'),
    };
  }
  const batchImages = {
    month: sum((r) => r.event === 'batch_export' && r.day >= d30, 'images'),
    all: sum((r) => r.event === 'batch_export', 'images'),
  };

  // Daily series, last 30 days
  const series = [];
  for (let i = 29; i >= 0; i--) {
    const day = daysAgo(i);
    series.push({
      day,
      downloads: sum((r) => r.day === day && r.event === 'mockup_download', 'count'),
      batches: sum((r) => r.day === day && r.event === 'batch_export', 'count'),
    });
  }
  const maxDaily = Math.max(1, ...series.map((s) => s.downloads + s.batches));

  // Garment breakdown (single downloads, all time). Flat lay only: an
  // on-model export reports no garment, because the template fixes it.
  const byGarment = Object.keys(GARMENT_LABELS)
    .map((g) => ({ g, n: sum((r) => r.event === 'mockup_download' && r.garment === g, 'count') }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const maxGarment = Math.max(1, ...byGarment.map((x) => x.n));

  // Flat lay vs on model, single downloads. Rows carrying neither predate the
  // split and are counted as "not recorded" rather than folded into flat lay,
  // which would overstate it for as long as that history is in the table.
  const styleTotals = {
    flatlay: {
      today: sum((r) => r.event === 'mockup_download' && r.style === 'flatlay' && r.day === today, 'count'),
      week: sum((r) => r.event === 'mockup_download' && r.style === 'flatlay' && r.day >= d7, 'count'),
      month: sum((r) => r.event === 'mockup_download' && r.style === 'flatlay' && r.day >= d30, 'count'),
      all: sum((r) => r.event === 'mockup_download' && r.style === 'flatlay', 'count'),
    },
    onmodel: {
      today: sum((r) => r.event === 'mockup_download' && r.style === 'onmodel' && r.day === today, 'count'),
      week: sum((r) => r.event === 'mockup_download' && r.style === 'onmodel' && r.day >= d7, 'count'),
      month: sum((r) => r.event === 'mockup_download' && r.style === 'onmodel' && r.day >= d30, 'count'),
      all: sum((r) => r.event === 'mockup_download' && r.style === 'onmodel', 'count'),
    },
  };
  const unattributed = sum((r) => r.event === 'mockup_download' && r.style === '', 'count');
  const attributed = styleTotals.flatlay.all + styleTotals.onmodel.all;
  const onModelShare = attributed ? Math.round((styleTotals.onmodel.all / attributed) * 100) : 0;

  // Model breakdown, built from the ids present in the data rather than from
  // the label map, so a template added to the editor still appears here.
  const templateIds = [...new Set(rows.filter((r) => r.template).map((r) => r.template))];
  const byTemplate = templateIds
    .map((t) => ({ t, n: sum((r) => r.event === 'mockup_download' && r.template === t, 'count') }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const maxTemplate = Math.max(1, ...byTemplate.map((x) => x.n));

  // Batch mode split (all time)
  const modeSplit = ['variants', 'designs'].map((m) => ({
    m,
    n: sum((r) => r.event === 'batch_export' && r.mode === m, 'count'),
  }));

  const statCard = (label, t) => `
    <div class="card">
      <h2>${esc(label)}</h2>
      <div class="big">${t.all.toLocaleString()}</div>
      <div class="row"><span>Today</span><b>${t.today.toLocaleString()}</b></div>
      <div class="row"><span>Last 7 days</span><b>${t.week.toLocaleString()}</b></div>
      <div class="row"><span>Last 30 days</span><b>${t.month.toLocaleString()}</b></div>
    </div>`;

  const bars = series
    .map((s) => {
      const total = s.downloads + s.batches;
      const hD = Math.round((s.downloads / maxDaily) * 100);
      const hB = Math.round((s.batches / maxDaily) * 100);
      return `<div class="bar" title="${s.day}: ${s.downloads} downloads, ${s.batches} batch exports">
        <i style="height:${hB}%" class="b"></i><i style="height:${hD}%" class="d"></i>
        ${total ? `<em>${total}</em>` : ''}
      </div>`;
    })
    .join('');

  const garmentRows = byGarment.length
    ? byGarment
        .map(
          (x) => `<div class="hrow"><span class="hlabel">${esc(GARMENT_LABELS[x.g])}</span>
            <span class="htrack"><span class="hfill" style="width:${Math.round((x.n / maxGarment) * 100)}%"></span></span>
            <b>${x.n.toLocaleString()}</b></div>`
        )
        .join('')
    : '<p class="empty">No downloads tracked yet.</p>';

  const templateRows = byTemplate.length
    ? byTemplate
        .map(
          (x) => `<div class="hrow"><span class="hlabel">${esc(TEMPLATE_LABELS[x.t] || x.t)}</span>
            <span class="htrack"><span class="hfill m" style="width:${Math.round((x.n / maxTemplate) * 100)}%"></span></span>
            <b>${x.n.toLocaleString()}</b></div>`
        )
        .join('')
    : '<p class="empty">No on-model downloads tracked yet.</p>';

  const body = `
    <header><h1>TeeMockup — Export Stats</h1><p>First-party counts (ad-blocker-proof), rolled up per UTC day. Updated live.</p></header>
    <div class="cards">
      ${statCard('Single Downloads', totals.mockup_download)}
      ${statCard('On-Model Downloads', styleTotals.onmodel)}
      <div class="card">
        <h2>Flat Lay vs On Model</h2>
        <div class="big">${onModelShare}%<span class="unit"> on model</span></div>
        <div class="row"><span>Flat lay</span><b>${styleTotals.flatlay.all.toLocaleString()}</b></div>
        <div class="row"><span>On model</span><b>${styleTotals.onmodel.all.toLocaleString()}</b></div>
        ${unattributed ? `<div class="row"><span>Before this was recorded</span><b>${unattributed.toLocaleString()}</b></div>` : ''}
      </div>
      ${statCard('Batch Exports', totals.batch_export)}
      <div class="card">
        <h2>Batch Images Delivered</h2>
        <div class="big">${batchImages.all.toLocaleString()}</div>
        <div class="row"><span>Last 30 days</span><b>${batchImages.month.toLocaleString()}</b></div>
        <div class="row"><span>Variants mode runs</span><b>${modeSplit[0].n.toLocaleString()}</b></div>
        <div class="row"><span>Designs mode runs</span><b>${modeSplit[1].n.toLocaleString()}</b></div>
      </div>
    </div>
    <section class="card wide">
      <h2>Last 30 days <span class="legend"><i class="d"></i> downloads <i class="b"></i> batch runs</span></h2>
      <div class="chart">${bars}</div>
    </section>
    <section class="card wide">
      <h2>Downloads by garment (all time) <span class="legend note">flat lay only — an on-model export has no garment</span></h2>
      ${garmentRows}
    </section>
    <section class="card wide">
      <h2>Downloads by model (all time)</h2>
      ${templateRows}
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
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  body { background: #0b0d12; color: #e8eaf0; font: 15px/1.5 system-ui, sans-serif; padding: 32px 20px 60px; max-width: 980px; margin: 0 auto; }
  header { margin-bottom: 28px; }
  h1 { font-size: 1.5rem; letter-spacing: -0.4px; }
  header p { color: #8a90a0; font-size: 0.85rem; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 16px; }
  .card { background: #12151d; border: 1px solid rgba(255,255,255,0.07); border-radius: 14px; padding: 20px; }
  .card.wide { margin-bottom: 16px; }
  .card h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.6px; color: #8a90a0; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
  .big { font-size: 2.2rem; font-weight: 700; margin-bottom: 10px; }
  .row { display: flex; justify-content: space-between; font-size: 0.85rem; color: #aab0c0; padding: 3px 0; }
  .row b { color: #e8eaf0; }
  .chart { display: flex; align-items: flex-end; gap: 3px; height: 160px; }
  .bar { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; height: 100%; position: relative; min-width: 0; }
  .bar i { display: block; border-radius: 3px 3px 0 0; min-height: 0; }
  .bar i.d { background: #1aa7ec; }
  .bar i.b { background: #8b5cf6; }
  .bar em { position: absolute; top: -18px; left: 50%; transform: translateX(-50%); font-size: 0.6rem; font-style: normal; color: #8a90a0; }
  .legend { font-size: 0.7rem; text-transform: none; letter-spacing: 0; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin: 0 4px 0 10px; vertical-align: -1px; }
  .legend i.d { background: #1aa7ec; } .legend i.b { background: #8b5cf6; }
  .hrow { display: flex; align-items: center; gap: 12px; padding: 5px 0; font-size: 0.88rem; }
  .hlabel { width: 120px; color: #aab0c0; flex-shrink: 0; }
  .htrack { flex: 1; background: rgba(255,255,255,0.05); border-radius: 99px; height: 10px; overflow: hidden; }
  .hfill { display: block; height: 100%; background: #1aa7ec; border-radius: 99px; }
  .hfill.m { background: #22c55e; }
  .unit { font-size: 0.9rem; font-weight: 500; color: #8a90a0; }
  .legend.note { color: #8a90a0; font-weight: 400; }
  .hrow b { width: 60px; text-align: right; }
  .empty { color: #8a90a0; font-size: 0.9rem; }
  code { background: rgba(255,255,255,0.08); padding: 1px 6px; border-radius: 6px; }
</style>
</head><body>${body}</body></html>`;
}
