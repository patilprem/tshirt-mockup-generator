// First-party Ko-fi click endpoint. Same shape as /api/track: a small
// metadata-only beacon, rolled up per UTC day into D1. No cookies, no IPs,
// no user identifiers — just which placement (footer / about / export) got
// clicked, how many times.
//
// Kept separate from /api/track rather than added to its ALLOWED_EVENTS:
// that endpoint's validation and export_stats_v2's primary key are both
// built around export metadata a click doesn't have. Sharing the endpoint
// would mean every write there carries columns that mean nothing for half
// of what it accepts.
//
// Requires the same D1 binding (`DB`) /api/track already needs. Until that
// binding exists this endpoint silently no-ops, so it ships fine ahead of
// or alongside it.
import { ensureKofiClicks } from '../_kofi-stats.js';

const ALLOWED_PLACEMENTS = new Set(['footer', 'about', 'export']);

export async function onRequestPost(context) {
  const db = context.env.DB;
  if (!db) return new Response(null, { status: 204 }); // binding not set up yet

  let payload;
  try {
    const text = await context.request.text();
    if (text.length > 256) throw new Error('too large');
    payload = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }

  const placement = String(payload.placement || '');
  if (!ALLOWED_PLACEMENTS.has(placement)) {
    return new Response(null, { status: 400 });
  }

  const day = new Date().toISOString().slice(0, 10);

  try {
    // Self-bootstrapping schema, same reason as /api/track: no manual
    // migration step, and ahead of this request's own upsert so the table
    // is guaranteed to exist by the time the insert runs.
    await ensureKofiClicks(db);

    await db
      .prepare(
        `INSERT INTO kofi_clicks (day, placement, count)
         VALUES (?, ?, 1)
         ON CONFLICT (day, placement)
         DO UPDATE SET count = count + 1`
      )
      .bind(day, placement)
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
