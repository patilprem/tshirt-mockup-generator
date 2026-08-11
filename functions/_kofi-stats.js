// Shared shape of the Ko-fi click table, used by the writer (/api/kofi-click)
// and the reader (/stats). Same split as _export-stats.js and for the same
// reason: the reader has to be able to bring the table into existence on its
// own, or opening /stats before the first click ever lands renders every
// number as zero and that reads exactly like a page with no history.
//
// A click has none of export_stats_v2's columns — no garment, no template,
// no quality, because it isn't an exported image, it's someone opening a
// support link. Forcing it into that table's key would be the same mistake
// its own schema comment warns against, so this is a second, smaller table
// instead: one row per day per placement (footer / about / export).
//
// Underscore-prefixed files in functions/ are not routed, so this is a
// module rather than an endpoint.

export const KOFI_SCHEMA = `CREATE TABLE IF NOT EXISTS kofi_clicks (
  day TEXT NOT NULL,
  placement TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, placement)
)`;

export async function ensureKofiClicks(db) {
  await db.prepare(KOFI_SCHEMA).run();
}
