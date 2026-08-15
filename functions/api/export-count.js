// Public read of the site's all-time export total, for the homepage counter.
//
// This is the one number /stats calls totalImages.all — the same unit for
// the same reason: a single download is one image, a batch run is one click
// that produces many, and images are the only thing the two events have in
// common to add up. Recomputed here as one SQL aggregate rather than by
// importing stats.js's reducer, because that reducer pulls every row into
// memory to build a whole dashboard's worth of breakdowns; this endpoint
// only ever needs the one total and is hit by far more traffic (every
// homepage load) than the token-gated dashboard is.
//
// No auth: a single aggregate count carries no PII and reveals nothing
// /stats doesn't already show behind its key. Edge-cached so a viral spike
// in homepage traffic costs Cloudflare's cache, not D1 — the number does
// not need to be to-the-second accurate to be honest, only real.
import { ensureExportStats } from '../_export-stats.js';

export async function onRequestGet(context) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=120, stale-while-revalidate=600',
  };

  const db = context.env.DB;
  if (!db) return new Response(JSON.stringify({ count: null }), { headers }); // binding not set up yet

  try {
    // Bring the table into existence if /api/track hasn't run yet on this
    // database — same self-bootstrap as the dashboard, for the same reason:
    // a fresh DB with no exports yet must read as "no data", not throw.
    await ensureExportStats(db);

    // event is restricted to these two values at write time (see
    // /api/track), but the WHERE guards this query's meaning independently
    // of that — the CASE below is only correct for exactly these events.
    const row = await db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN event = 'batch_export' THEN images ELSE count END), 0) AS total
         FROM export_stats_v2
         WHERE event IN ('mockup_download', 'batch_export')`
      )
      .first();

    const count = Number(row?.total) || 0;
    return new Response(JSON.stringify({ count }), { headers });
  } catch {
    // Read-only or unavailable DB — the homepage counter hides itself on a
    // null count rather than showing a stale or fabricated number.
    return new Response(JSON.stringify({ count: null }), { headers });
  }
}

export function onRequestPost() {
  return new Response('Method Not Allowed', { status: 405 });
}
