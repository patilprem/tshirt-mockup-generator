// First-party export tracking endpoint.
//
// The editor sends a small metadata-only beacon here on each export
// (navigator.sendBeacon → text/plain JSON). Counts are rolled up per UTC day
// into Cloudflare D1. No cookies, no IPs, no user identifiers, no design
// content — just which garment/mode/quality got exported, how many times.
//
// Requires a D1 binding named `DB` on the Pages project. Until that binding
// exists this endpoint silently no-ops, so it can ship ahead of the database.

const ALLOWED_EVENTS = new Set(['mockup_download', 'batch_export']);
const ALLOWED_GARMENTS = new Set([
  '', 'crewneck', 'ladies', 'polo', 'longsleeve', 'hoodie', 'sweatshirt', 'vneck', 'tanktop',
]);
const ALLOWED_MODES = new Set(['', 'variants', 'designs']);
const ALLOWED_QUALITIES = new Set(['', '1000x1000', '2000x2000']);

const SCHEMA = `CREATE TABLE IF NOT EXISTS export_stats (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  garment TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT '',
  quality TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  images INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event, garment, mode, quality)
)`;

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
  const garment = String(payload.garment || '');
  const mode = String(payload.mode || '');
  const quality = String(payload.quality || '');
  let images = Number(payload.images) || 0;
  images = Math.max(0, Math.min(1000, Math.round(images)));

  if (
    !ALLOWED_EVENTS.has(event) ||
    !ALLOWED_GARMENTS.has(garment) ||
    !ALLOWED_MODES.has(mode) ||
    !ALLOWED_QUALITIES.has(quality)
  ) {
    return new Response(null, { status: 400 });
  }

  const day = new Date().toISOString().slice(0, 10);

  try {
    // Self-bootstrapping schema: no manual migration step to run.
    await db.batch([
      db.prepare(SCHEMA),
      db
        .prepare(
          `INSERT INTO export_stats (day, event, garment, mode, quality, count, images)
           VALUES (?, ?, ?, ?, ?, 1, ?)
           ON CONFLICT (day, event, garment, mode, quality)
           DO UPDATE SET count = count + 1, images = images + excluded.images`
        )
        .bind(day, event, garment, mode, quality, images),
    ]);
  } catch (e) {
    // Tracking must never surface errors to the client.
    return new Response(null, { status: 204 });
  }

  return new Response(null, { status: 204 });
}

export function onRequestGet() {
  return new Response('Method Not Allowed', { status: 405 });
}
