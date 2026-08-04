// First-party export tracking endpoint.
//
// The editor sends a small metadata-only beacon here on each export
// (navigator.sendBeacon → text/plain JSON). Counts are rolled up per UTC day
// into Cloudflare D1. No cookies, no IPs, no user identifiers, no design
// content — just which garment/model/mode/quality got exported, how many times.
//
// Requires a D1 binding named `DB` on the Pages project. Until that binding
// exists this endpoint silently no-ops, so it can ship ahead of the database.

const ALLOWED_EVENTS = new Set(['mockup_download', 'batch_export']);
// Which side of the editor the export came from. Blank is history: rows
// recorded before the editor sent this at all.
const ALLOWED_STYLES = new Set(['', 'flatlay', 'onmodel']);
const ALLOWED_GARMENTS = new Set([
  '', 'crewneck', 'ladies', 'polo', 'longsleeve', 'hoodie', 'sweatshirt', 'vneck', 'tanktop',
]);
const ALLOWED_MODES = new Set(['', 'variants', 'designs']);

// Checked by SHAPE rather than against a list of sizes. The list used to name
// three exact resolutions — 1000x1000, 2000x2000 and blank — and the canvas
// presets moved past every one of them: a plain 1:1 download is 1080x1080, an
// Etsy listing 2700x2025. So the endpoint rejected every real export with a
// 400 and the dashboard counted none of them. A pattern cannot go stale the
// same way, and it still keeps junk out of the table.
const QUALITY_RE = /^(\d{2,5}x\d{2,5})?$/;

// On-model template id. Also a pattern and for the same reason: templates.json
// gains entries over time, and an allowlist here would silently drop every
// export from a newly added model until someone remembered to update it. The
// charset and length are tight, which is what bounds how many distinct rows a
// client can create.
const TEMPLATE_RE = /^[a-z0-9-]{0,24}$/;

// style and template are part of the KEY, not just columns: a flat-lay and an
// on-model export that agree on day/event/quality are different facts and must
// not collapse into one row. SQLite cannot widen a primary key in place, hence
// a new table rather than ALTER TABLE on the original.
const SCHEMA = `CREATE TABLE IF NOT EXISTS export_stats_v2 (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  style TEXT NOT NULL DEFAULT '',
  garment TEXT NOT NULL DEFAULT '',
  template TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT '',
  quality TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  images INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event, style, garment, template, mode, quality)
)`;

// Carries the original table's rows across so the dashboard keeps its history.
// They predate the style/template split, so both are left blank and read as
// "not recorded" rather than being guessed at.
const COPY_FORWARD = `INSERT OR IGNORE INTO export_stats_v2
  (day, event, style, garment, template, mode, quality, count, images)
  SELECT day, event, '', garment, '', mode, quality, count, images FROM export_stats`;

// Once per isolate. The copy is idempotent, so the worst case of a fresh
// isolate repeating it is one wasted scan of a small table.
let historyCopied = false;

export async function onRequestPost(context) {
  const db = context.env.DB;
  if (!db) return new Response(null, { status: 204 }); // binding not set up yet

  let payload;
  try {
    const text = await context.request.text();
    if (text.length > 512) throw new Error('too large');
    payload = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }

  const event = String(payload.event || '');
  const style = String(payload.style || '');
  const garment = String(payload.garment || '');
  const template = String(payload.template || '');
  const mode = String(payload.mode || '');
  const quality = String(payload.quality || '');
  let images = Number(payload.images) || 0;
  images = Math.max(0, Math.min(1000, Math.round(images)));

  if (
    !ALLOWED_EVENTS.has(event) ||
    !ALLOWED_STYLES.has(style) ||
    !ALLOWED_GARMENTS.has(garment) ||
    !ALLOWED_MODES.has(mode) ||
    !TEMPLATE_RE.test(template) ||
    !QUALITY_RE.test(quality)
  ) {
    return new Response(null, { status: 400 });
  }

  const day = new Date().toISOString().slice(0, 10);

  try {
    // Self-bootstrapping schema: no manual migration step to run.
    await db.prepare(SCHEMA).run();

    if (!historyCopied) {
      // Set before the attempt, so a permanently absent v1 table costs one try
      // per isolate rather than one per request.
      historyCopied = true;
      // Ahead of this request's own upsert: INSERT OR IGNORE yields to a row
      // that is already there, so copying after writing could drop history.
      try { await db.prepare(COPY_FORWARD).run(); } catch { /* no v1 table */ }
    }

    await db
      .prepare(
        `INSERT INTO export_stats_v2 (day, event, style, garment, template, mode, quality, count, images)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT (day, event, style, garment, template, mode, quality)
         DO UPDATE SET count = count + 1, images = images + excluded.images`
      )
      .bind(day, event, style, garment, template, mode, quality, images)
      .run();
  } catch (e) {
    // Tracking must never surface errors to the client.
    return new Response(null, { status: 204 });
  }

  return new Response(null, { status: 204 });
}

export function onRequestGet() {
  return new Response('Method Not Allowed', { status: 405 });
}
